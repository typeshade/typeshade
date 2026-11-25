// Implements: Rule 11.13, Rule 8.22 (docs/language-design.md; traced in reqs/).

import { emitModule } from './backends/wgsl.js';
import type { Fp64Flavor } from './passes/fp64-lower.js';
import type { ComputeEntry, DrawBinding, EntryBinding } from './host-entry.js';
import type { FuseLoop, KernelFace, KernelLoop, KernelParam } from './host-kernel.js';
import type {
  BindingDecl,
  ConstDecl,
  Expr,
  FuncDecl,
  ModuleDecl,
  ModuleVarDecl,
  OverrideDecl,
  Stmt,
  StructDecl,
  StructField,
} from './ir/nodes.js';
import { fromPortable } from './ir/portable.js';
import { typeKey, u32T, type ShaderType } from './ir/types.js';
import { eachStmtExpr, mapChildren, mapStmtExpr } from './ir/visit.js';
import { layoutOf } from './manifest.js';
import { invocationIndex, workgroupFirst } from './kernel-workgroup.js';
import { KERNEL_WORKGROUP } from './kernel-tree.js';
import { VERSION } from './version.js';

export interface FusedMember {
  readonly k: KernelFace;
  readonly slots: readonly (number | undefined)[];
}

export interface FusedSlot {
  readonly name: string;
  readonly binding: EntryBinding;
  readonly written: boolean;
  readonly array: number;
}

export interface FusedReduce {
  readonly fold: ComputeEntry;
  readonly vars: NonNullable<KernelLoop['reduce']>['vars'];
  readonly fields: { readonly n: string; readonly in: string; readonly out: string };
}

export interface Fused {
  readonly label: string;
  readonly entry: ComputeEntry;
  readonly reduce?: FusedReduce;
  readonly module: ModuleDecl;
  readonly args: EntryBinding;
  readonly wg: number;
  readonly slots: readonly FusedSlot[];
}

const built = new WeakMap<KernelFace, Map<string, Fused | { readonly none: string }>>();

const faceIds = new WeakMap<KernelFace, number>();
let faceCount = 0;
const faceId = (k: KernelFace): number => {
  let id = faceIds.get(k);
  if (id === undefined) faceIds.set(k, (id = faceCount++));
  return id;
};

function shapeOf(members: readonly FusedMember[], contracted: ReadonlySet<number>): string {
  const slots = members
    .map((m) => {
      const loop = m.k.fuse?.facts[0];
      const fold = loop?.fold !== undefined ? `/${loop.fold}` : '';
      return `${faceId(m.k)}:${m.k.fuse?.origin ?? ''}#${m.k.name}#${loop?.entry ?? ''}${fold}[${m.slots.map((s) => s ?? '-').join(',')}]`;
    })
    .join(';');
  return contracted.size === 0
    ? slots
    : `${slots}|${[...contracted].sort((a, b) => a - b).join(',')}`;
}

export function fusedFor(
  members: readonly FusedMember[],
  contracted: readonly number[] = [],
  flavor: Fp64Flavor = 'float',
): Fused | { readonly none: string } {
  const head = members[0]!.k;
  let per = built.get(head);
  if (per === undefined) built.set(head, (per = new Map()));
  const local = new Set(contracted);
  const key = `${flavor}:${shapeOf(members, local)}`;
  let fused = per.get(key);
  if (fused === undefined) {
    try {
      fused = assemble(members, local, flavor);
    } catch (e) {
      fused = { none: e instanceof Error ? e.message : String(e) };
    }
    per.set(key, fused);
  }
  return fused;
}

export function uniformFor(
  members: readonly {
    readonly k: KernelFace;
    readonly hosts: readonly unknown[];
    readonly range: { readonly start: number; readonly n: number };
  }[],
): Record<string, unknown> {
  const u: Record<string, unknown> = {};
  members.forEach((m, j) => {
    u[`c${j}__start`] = m.range.start;
    u[`c${j}__n`] = m.range.n;
    if (m.k.gpu?.loops[0]?.reduce !== undefined) {
      u[`c${j}__in`] = 0;
      u[`c${j}__out`] = 0;
    }
    m.k.params.forEach((p, i) => {
      if (p.k === 'value') u[`c${j}_${p.name}`] = m.hosts[i];
    });
  });
  return u;
}

interface Part {
  readonly k: KernelFace;
  readonly origin: string;
  readonly loop: FuseLoop;
  readonly mod: ModuleDecl;
  readonly entry: FuncDecl;
  readonly iterates: FuncDecl;
  readonly fold?: FuncDecl;
  readonly slots: readonly (number | undefined)[];
  readonly slotOf: Map<string, number>;
}

interface Slot {
  readonly index: number;
  readonly name: string;
  readonly type: ShaderType;
  readonly param: KernelParam & { readonly k: 'array' };
  written: boolean;
  writer: number;
  readonly contracted: boolean;
  edge?: string;
}

const elemOf = (t: ShaderType): ShaderType => (t as { elem: ShaderType }).elem;

function declared(body: readonly Stmt[]): Set<string> {
  const names = new Set<string>();
  const walk = (st: Stmt): void => {
    if (st.s === 'let' || st.s === 'var') names.add(st.name);
    if (st.s === 'for' && st.counted !== undefined) names.add(st.counted.name);
    eachStmtExpr(st, () => undefined, walk);
  };
  body.forEach(walk);
  return names;
}

function returns(body: readonly Stmt[]): boolean {
  let found = false;
  const walk = (st: Stmt): void => {
    if (st.s === 'return') found = true;
    eachStmtExpr(st, () => undefined, walk);
  };
  body.forEach(walk);
  return found;
}

function merged<T extends { readonly name: string }>(
  what: string,
  parts: readonly Part[],
  of: (p: Part) => readonly T[],
  skip: (x: T, p: Part) => boolean = () => false,
): T[] {
  const out = new Map<string, { readonly decl: T; readonly origin: string }>();
  for (const p of parts)
    for (const x of of(p)) {
      if (skip(x, p)) continue;
      const had = out.get(x.name);
      if (had === undefined) out.set(x.name, { decl: x, origin: p.origin });
      else if (JSON.stringify(had.decl) !== JSON.stringify(x))
        throw new Error(
          `${what} "${x.name}" is declared differently in ${had.origin} and in ${p.origin}`,
        );
    }
  return [...out.values()].map((x) => x.decl);
}

function guardOf(wgsl: string): { group: number; binding: number } | undefined {
  const m = /@group\((\d+)\)\s*@binding\((\d+)\)\s*var\s+_fp64\b/.exec(wgsl);
  return m === null ? undefined : { group: Number(m[1]), binding: Number(m[2]) };
}

function assemble(
  members: readonly FusedMember[],
  contracted: ReadonlySet<number>,
  flavor: Fp64Flavor,
): Fused {
  const parts: Part[] = members.map((m) => {
    const fuse = m.k.fuse;
    if (fuse === undefined || fuse.facts.length !== 1 || m.k.gpu === undefined)
      throw new Error(`${m.k.name}() carries no fuse record of one loop`);
    if (fuse.ir.version !== VERSION)
      throw new Error(
        `${m.k.name}() was built by typeshade ${fuse.ir.version}, and this runtime is typeshade ${VERSION}, which reads only its own version's IR; build the module again with this version`,
      );
    const loop = fuse.facts[0]!;
    const mod = fromPortable(fuse.ir);
    const entry = mod.funcs.find((f) => f.name === loop.entry);
    if (!loop.reduces) {
      if (entry === undefined || loop.iterates !== loop.entry)
        throw new Error(`${m.k.name}() has no map entry "${loop.entry}" in its fuse record`);
      return {
        k: m.k,
        origin: fuse.origin,
        loop,
        mod,
        entry,
        iterates: entry,
        slots: m.slots,
        slotOf: new Map(),
      };
    }
    const iterates = mod.funcs.find((f) => f.name === loop.iterates);
    const fold = mod.funcs.find((f) => f.name === loop.fold);
    if (
      entry === undefined ||
      iterates === undefined ||
      fold === undefined ||
      loop.iteration !== 0 ||
      m.k.gpu.loops[0]?.reduce === undefined
    )
      throw new Error(
        `${m.k.name}() has no reducing entry "${loop.entry}" with its helper and fold entry in its fuse record`,
      );
    return {
      k: m.k,
      origin: fuse.origin,
      loop,
      mod,
      entry,
      iterates,
      fold,
      slots: m.slots,
      slotOf: new Map(),
    };
  });
  parts.forEach((p, j) => {
    if (p.loop.reduces && j < parts.length - 1)
      throw new Error(`${p.k.name}() reduces, and only the last call of a group may`);
  });
  const last = parts.length - 1;
  const reducing = parts[last]!.loop.reduces ? parts[last] : undefined;

  const taken = new Set<string>();
  for (const p of parts) {
    for (const x of [
      ...p.mod.funcs,
      ...p.mod.structs,
      ...p.mod.bindings,
      ...p.mod.consts,
      ...(p.mod.vars ?? []),
      ...(p.mod.overrides ?? []),
    ])
      taken.add(x.name);
    for (const f of p.mod.funcs) {
      for (const prm of f.params) taken.add(prm.name);
      for (const n of declared(f.body)) taken.add(n);
    }
  }
  let P = '_f';
  while ([...taken].some((t) => t.startsWith(P))) P += 'f';
  const argsStruct = `${P}Args`;
  const argsBinding = `${P}args`;
  const argsType: ShaderType = { kind: 'struct', name: argsStruct };

  const found = new Map<number, Slot>();
  parts.forEach((p, j) => {
    p.k.params.forEach((prm, i) => {
      const at = p.slots[i];
      if (prm.k !== 'array' || at === undefined) return;
      const face = p.k.gpu!.arrays.find((a) => a.name === prm.name);
      const decl =
        face === undefined
          ? undefined
          : p.mod.bindings.find((b) => b.group === face.group && b.binding === face.binding);
      if (decl === undefined) throw new Error(`${p.k.name}() has no binding for "${prm.name}"`);
      let slot = found.get(at);
      if (slot === undefined)
        found.set(
          at,
          (slot = {
            index: at,
            name: `${P}${contracted.has(at) ? 's' : 'r'}${at}`,
            type: decl.type,
            param: prm,
            written: false,
            writer: -1,
            contracted: contracted.has(at),
          }),
        );
      else if (typeKey(slot.type) !== typeKey(decl.type))
        throw new Error(
          `one array is ${typeKey(slot.type)} in one call and ${typeKey(decl.type)} in ${p.k.name}()`,
        );
      p.slotOf.set(decl.name, at);
      if (prm.writes) {
        if (slot.writer >= 0)
          throw new Error(`${parts[slot.writer]!.k.name}() and ${p.k.name}() both write one array`);
        slot.written = true;
        slot.writer = j;
      }
    });
  });
  const slots: Slot[] = Array.from({ length: found.size }, (_, at) => {
    const slot = found.get(at);
    if (slot === undefined) throw new Error('the slots of the group have a gap');
    return slot;
  });
  for (const at of contracted) {
    const slot = found.get(at);
    if (slot === undefined) throw new Error(`the group has no array in slot ${at} to contract`);
    const elem = elemOf(slot.type);
    const held =
      elem.kind === 'scalar' || (elem.kind === 'vec' && elem.n === 4 && elem.elem === 'f32');
    if (slot.type.kind !== 'array' || !held)
      throw new Error(`an array of ${typeKey(elem)} cannot be held as a local`);
  }

  const readsAtI = (p: Part, slot: Slot): boolean =>
    p.k.params.some((prm, i) => {
      const fact = p.loop.arrays.find((a) => a.param === prm.name);
      return p.slots[i] === slot.index && fact?.access === 'read' && fact.atI;
    });
  let edges = 0;
  for (const slot of slots)
    if (
      !slot.contracted &&
      slot.writer >= 0 &&
      parts.some((p, j) => j > slot.writer && readsAtI(p, slot))
    )
      slot.edge = `${P}e${edges++}`;

  const structs = merged(
    'struct',
    parts,
    (p) => p.mod.structs,
    (s, p) => s.name === p.k.gpu!.args.s,
  );
  const consts: ConstDecl[] = merged('const', parts, (p) => p.mod.consts);
  const vars: ModuleVarDecl[] = merged('variable', parts, (p) => p.mod.vars ?? []);
  const overrides: OverrideDecl[] = merged('override', parts, (p) => p.mod.overrides ?? []);
  const enables = [...new Set(parts.flatMap((p) => p.mod.enables ?? []))];

  const label = members.map((m) => m.k.name).join('+');
  let entryName = `fused_${label.replace(/[^A-Za-z0-9_]/g, '_')}`;
  while (
    taken.has(entryName) ||
    (reducing !== undefined &&
      (taken.has(`${entryName}_fold`) || taken.has(`${entryName}_iteration`)))
  )
    entryName += '_';
  const [foldName, iterationName] = [`${entryName}_fold`, `${entryName}_iteration`];
  const used = new Set<string>([
    entryName,
    ...(reducing !== undefined ? [foldName, iterationName] : []),
    ...structs.map((s) => s.name),
    ...consts.map((c) => c.name),
    ...vars.map((v) => v.name),
    ...overrides.map((o) => o.name),
  ]);

  const helperKey = new Map<string, string>();
  const helperRename: Map<string, string>[] = parts.map(() => new Map());
  const helpers: { decl: FuncDecl; to: string; part: number }[] = [];
  parts.forEach((p, j) => {
    for (const f of p.mod.funcs) {
      if (f.stage !== undefined) continue;
      if (p === reducing && f === p.iterates) {
        helperRename[j]!.set(f.name, iterationName);
        continue;
      }
      const key = `${p.origin}#${f.name}`;
      let to = helperKey.get(key);
      if (to === undefined) {
        to = f.name;
        let n = 0;
        while (used.has(to)) to = `${P}h${++n}_${f.name}`;
        used.add(to);
        helperKey.set(key, to);
        helpers.push({ decl: f, to, part: j });
      }
      helperRename[j]!.set(f.name, to);
    }
  });

  const argsFields: StructField[] = parts.flatMap((p, j) => {
    const decl = p.mod.structs.find((s) => s.name === p.k.gpu!.args.s);
    if (decl === undefined) throw new Error(`${p.k.name}() has no struct "${p.k.gpu!.args.s}"`);
    return decl.fields.map((f) => ({ ...f, name: `c${j}_${f.name}` }));
  });
  const argsDecl: StructDecl = { name: argsStruct, fields: argsFields };
  const argsLayout = layoutOf(
    argsType,
    'std140',
    new Map([...structs, argsDecl].map((s) => [s.name, s])),
  );
  if ('none' in argsLayout) throw new Error(argsLayout.none);

  const rewrite = (j: number, stmts: readonly Stmt[], names: boolean, asParam = false): Stmt[] => {
    const p = parts[j]!;
    const mine = names ? declared(stmts) : new Set<string>();
    const local = (n: string): string => `${P}c${j}_${n}`;
    const slotNames = new Map(
      [...p.slotOf].map(([param, at]) => [param, slots[at]!.name] as const),
    );
    const edgeReads = new Map(
      slots.flatMap((s) =>
        s.edge !== undefined && s.writer < j && readsAtI(p, s) ? [[s.name, s.edge] as const] : [],
      ),
    );
    const held = new Set(slots.filter((s) => s.contracted).map((s) => s.name));
    const args = p.k.gpu!.args.name;
    const memo = new Map<Expr, Expr>();
    const rw = (e: Expr): Expr => {
      const had = memo.get(e);
      if (had !== undefined) return had;
      const r = mapChildren(e, rw);
      let out: Expr = r;
      switch (r.op) {
        case 'member':
          if (r.base.op === 'varref' && r.base.name === args)
            out = {
              ...r,
              base: { op: 'varref', type: argsType, name: argsBinding },
              field: `c${j}_${r.field}`,
            };
          break;
        case 'index': {
          const base = r.base.op === 'varref' ? r.base.name : undefined;
          if (base !== undefined && held.has(base))
            out = { op: 'varref', type: r.type, name: base };
          else {
            const edge = base !== undefined ? edgeReads.get(base) : undefined;
            if (edge !== undefined) out = { op: 'varref', type: r.type, name: edge };
          }
          break;
        }
        case 'varref': {
          const slot = slotNames.get(r.name);
          if (slot !== undefined) out = { ...r, name: slot };
          else if (mine.has(r.name)) out = { ...r, name: local(r.name) };
          // In the helper of a loop that reduces the index is the parameter `_k`, clamped by the
          // entry that calls it, and the lane's flag the parameter `_live` (change 0096).
          else if (asParam && (r.name === '_k' || r.name === '_kc'))
            out = { op: 'param', type: r.type, name: '_k' };
          else if (asParam && r.name === '_live')
            out = { op: 'param', type: r.type, name: '_live' };
          break;
        }
        case 'call': {
          const named = r.args[0];
          if (r.fn === 'arrayLength' && named?.op === 'varref' && held.has(named.name))
            throw new Error(`${p.k.name}() measures an array the entry holds as a local`);
          const to = helperRename[j]!.get(r.fn);
          if (to !== undefined) out = { ...r, fn: to };
          break;
        }
        default:
          break;
      }
      memo.set(e, out);
      return out;
    };
    const S = (st: Stmt): Stmt => {
      const r = mapStmtExpr(st, rw, S);
      if (!names) return r;
      if (r.s === 'let' || r.s === 'var') return { ...r, name: local(r.name) };
      if (r.s === 'for' && r.counted !== undefined)
        return { ...r, counted: { ...r.counted, name: local(r.counted.name) } };
      return r;
    };
    return stmts.map(S);
  };

  const helperDecls: FuncDecl[] = helpers.map(({ decl, to, part }) => {
    const memo = new Map<Expr, Expr>();
    const fix = (e: Expr): Expr => {
      const had = memo.get(e);
      if (had !== undefined) return had;
      const r = mapChildren(e, fix);
      const callee = r.op === 'call' ? helperRename[part]!.get(r.fn) : undefined;
      const out: Expr = callee !== undefined && r.op === 'call' ? { ...r, fn: callee } : r;
      memo.set(e, out);
      return out;
    };
    const S = (st: Stmt): Stmt => mapStmtExpr(st, fix, S);
    return { ...decl, name: to, body: decl.body.map(S) };
  });

  const locals: Stmt[] = [];
  for (const slot of slots)
    if (slot.contracted) locals.push({ s: 'var', name: slot.name, type: elemOf(slot.type) });
  for (const slot of slots)
    if (slot.edge !== undefined)
      locals.push({ s: 'var', name: slot.edge, type: elemOf(slot.type) });

  const iterationOf = (j: number, asParam: boolean): Stmt[] => {
    const p = parts[j]!;
    const iteration = p.entry.body.slice(p.loop.iteration);
    if (returns(iteration))
      throw new Error(`${p.k.name}() returns inside its loop, which would end the others`);
    const counter = iteration[0];
    if (counter?.s !== 'let')
      throw new Error(`${p.k.name}() does not start its iteration with the loop's counter`);
    const out = rewrite(j, iteration, true, asParam);
    for (const slot of slots)
      if (slot.edge !== undefined && slot.writer === j)
        out.push({
          s: 'assign',
          target: { op: 'varref', type: elemOf(slot.type), name: slot.edge },
          expr: {
            op: 'index',
            type: elemOf(slot.type),
            base: { op: 'varref', type: slot.type, name: slot.name },
            idx: { op: 'varref', type: counter.expr.type, name: `${P}c${j}_${counter.name}` },
          },
        });
    return out;
  };

  const head = parts[0]!;
  const declaring = parts.find((p) => p.loop.declared === true);
  const groupWg =
    reducing !== undefined ? reducing.loop.wg : (declaring?.loop.wg ?? KERNEL_WORKGROUP);
  for (const p of parts)
    if (p.loop.declared === true && p.loop.wg !== groupWg)
      throw new Error(
        `${p.k.name}() runs in workgroups of ${p.loop.wg} and the group in workgroups of ${groupWg}`,
      );
  let entry: FuncDecl;
  let fold: FuncDecl | undefined;
  let own: FuncDecl[];
  if (reducing === undefined) {
    const [index] = head.entry.body.slice(0, head.loop.iteration);
    if (index?.s !== 'let' || index.name !== '_k')
      throw new Error(`${head.k.name}() does not start its entry with the invocation index`);
    const n: Expr = {
      op: 'member',
      type: u32T,
      base: { op: 'varref', type: argsType, name: argsBinding },
      field: 'c0__n',
    };
    const boolT: ShaderType = { kind: 'scalar', scalar: 'bool' };
    const kRef: Expr = { op: 'varref', type: u32T, name: '_k' };
    const live: Expr = { op: 'varref', type: boolT, name: '_live' };
    const iterations = parts.flatMap((_, j) => iterationOf(j, false));
    entry = {
      ...head.entry,
      name: entryName,
      workgroupSize: groupWg,
      attrs: [`@compute @workgroup_size(${groupWg})`],
      body: [
        invocationIndex(groupWg),
        {
          s: 'if',
          arms: [
            {
              cond: { op: 'compare', type: boolT, cop: '>=', a: workgroupFirst(groupWg), b: n },
              body: [{ s: 'return' }],
            },
          ],
        },
        { s: 'let', name: '_live', expr: { op: 'compare', type: boolT, cop: '<', a: kRef, b: n } },
        {
          s: 'let',
          name: '_kc',
          expr: {
            op: 'call',
            type: u32T,
            fn: 'min',
            args: [
              kRef,
              { op: 'binop', type: u32T, bop: '-', a: n, b: { op: 'lit', type: u32T, value: 1 } },
            ],
          },
        },
        ...locals,
        ...(slots.some((s) => s.edge !== undefined)
          ? [{ s: 'if', arms: [{ cond: live, body: iterations }] } as Stmt]
          : iterations),
      ],
    };
    own = [entry];
  } else {
    const iteration: FuncDecl = {
      ...reducing.iterates,
      name: iterationName,
      body: [
        ...locals,
        ...parts.slice(0, last).flatMap((_, j) => iterationOf(j, true)),
        ...rewrite(last, reducing.iterates.body, true),
      ],
    };
    entry = {
      ...reducing.entry,
      name: entryName,
      body: rewrite(last, reducing.entry.body, false),
    };
    fold = { ...reducing.fold!, name: foldName, body: rewrite(last, reducing.fold!.body, false) };
    own = [iteration, entry, fold];
  }

  const bound = slots.filter((s) => !s.contracted);
  const folds = reducing?.k.gpu!.loops[0]!.reduce!.vars ?? [];
  const partials = folds.map((v, k) => {
    const decl = reducing!.mod.bindings.find((b) => b.name === v.binding.name);
    if (decl === undefined)
      throw new Error(`${reducing!.k.name}() has no binding for "${v.binding.name}"`);
    return {
      decl,
      at: bound.length + 1 + k,
      entry: { ...v.binding, binding: bound.length + 1 + k },
    };
  });
  const bindings: BindingDecl[] = [
    { group: 0, binding: 0, name: argsBinding, space: 'uniform', type: argsType },
    ...bound.map((s, k): BindingDecl => ({
      group: 0,
      binding: k + 1,
      name: s.name,
      space: 'storage',
      access: s.written ? 'read_write' : 'read',
      type: s.type,
    })),
    ...partials.map((x): BindingDecl => ({ ...x.decl, group: 0, binding: x.at })),
  ];
  const module: ModuleDecl = {
    consts,
    structs: [...structs, argsDecl],
    bindings,
    funcs: [...helperDecls, ...own],
    overrides,
    vars,
    ...(enables.length > 0 ? { enables } : {}),
  };
  const wgsl = emitModule(module, { fp64Flavor: flavor });

  const args: EntryBinding = {
    name: argsBinding,
    group: 0,
    binding: 0,
    space: 'uniform',
    writes: false,
    layout: argsLayout,
    s: argsStruct,
  };
  const fusedSlots: FusedSlot[] = bound.map((s, k) => ({
    name: s.name,
    written: s.written,
    array: s.index,
    binding: {
      name: s.name,
      group: 0,
      binding: k + 1,
      space: 'storage',
      writes: s.written,
      ...(s.written ? { rw: true as const } : {}),
      layout: s.param.layout,
      s: s.param.s,
    },
  }));
  const guard = guardOf(wgsl);
  const handles: DrawBinding[] =
    guard === undefined
      ? []
      : [{ name: '_fp64', ...guard, space: 'texture', s: 'texture_2d<f32>', guard: true }];
  const wg = groupWg;
  const computeEntry = (f: FuncDecl, bindings: readonly DrawBinding[]): ComputeEntry => ({
    name: label,
    fn: f.name,
    wgsl,
    wg: [wg, 1, 1],
    params: f.params.map((prm) => prm.builtin!),
    bindings,
    workgroupZero: {},
  });
  const partialBindings = partials.map((x) => x.entry);
  const reduce: FusedReduce | undefined =
    reducing === undefined || fold === undefined
      ? undefined
      : {
          fold: computeEntry(fold, [args, ...partialBindings, ...handles]),
          vars: folds.map((v, k) => ({ ...v, binding: partialBindings[k]! })),
          fields: { n: `c${last}__n`, in: `c${last}__in`, out: `c${last}__out` },
        };
  return {
    label,
    entry: computeEntry(entry, [
      args,
      ...fusedSlots.map((s) => s.binding),
      ...partialBindings,
      ...handles,
    ]),
    ...(reduce !== undefined ? { reduce } : {}),
    module,
    args,
    wg,
    slots: fusedSlots,
  };
}
