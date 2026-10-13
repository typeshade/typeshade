// Implements: Rule 11.13 (docs/language-design.md; traced in reqs/).
// ═══ The fused entry: one compute entry for a group of kernel-function loops (change 0058) ═══
//
// The planner (`core/fuse-group.ts`) settles which calls become one dispatch; this file builds
// the entry they run as. The input is IR the compiler already lowered: each kernel function's
// face carries its lowered module as portable IR under `typeshade({ fuse: true })`
// (`KernelFace.fuse`). The fused module is ordinary IR, built from those and no new one:
//
//   1. Each member's module is read back with `fromPortable`, once for each call, since a pass
//      keys on the identity of a node and two members must share none.
//   2. The body of each member's entry from `FuseLoop.iteration` on, which is one iteration of
//      its loop, is appended to one entry in the order of the calls. The statements before it
//      (the index of the invocation and the guard on the trip count) are the first member's,
//      once: the members have one trip count.
//   3. A name a member declares in its iteration gets the member's prefix. The module of a
//      kernel function declares each name once (`SD0112`), and two members both count with `i`.
//   4. One storage binding for each distinct array of the group, whatever the parameters that
//      reach it are called, `read_write` when any member writes it. One uniform holds every
//      member's scalar parameters, `_start` and `_n`, each field prefixed with its member.
//   5. A helper function is included once for each (origin, name) a member reaches. The
//      same name in two origins is two functions: the later is renamed, in its declaration and
//      in every call to it.
//   6. An array one member wrote and a later member reads, each at exactly `i`, is an edge. The
//      writer keeps its write, so the host may read the array after the scope. A later member
//      reads the value from a local that the entry loads from the array after the writer's
//      statements, so the local holds what the later call would read from storage: the value
//      the writer wrote, or the old contents where it wrote nothing. The local is a `var`, never
//      a `let`. Constant propagation reads through a `let` of one write and not through a `var`,
//      and a stored literal propagated to a read moves the bits (`x + 0.0` is `+0.0` for a
//      stored `-0.0`, and the optimizer folds it to `x`), which the unfused calls, with a store
//      and a load between them, never meet.
//   7. A slot the planner contracts is a scratch array that no call outside the group names and
//      that every call of the group accesses at exactly `i`. It has no binding and no edge: it is
//      one `var` local of its element type at the top of the entry, and every access of it in
//      every member, the writer's included, is the local with the index dropped. The local starts
//      at zero, as a new buffer does, so a write the writer makes under a condition leaves the
//      value the unfused call leaves. The builder trusts the planner for the facts, and checks
//      what it needs to build: the element is a scalar, and no member measures the array.
//   8. The module is emitted by the writer `typeshade/emit` uses, with the validation it runs,
//      and the entry is cached for the shape of the group: the faces, the slot each array
//      parameter takes and which slots are contracted, and no length and no value. A uniform
//      and a buffer are not part of a shape.
//   9. A group whose last member reduces (F6) keeps that member's lowering: its loop entry, which
//      indexes the invocation at 256, runs the iteration in a helper and folds the invocations of
//      a workgroup by the tree into one partial each; its fold entry, which folds a level of
//      partials; its `Sums` struct and its workgroup arrays. They are rewritten for the merged
//      uniform and the slots as any member's statements are, and the tree order of Rule 7.2 is
//      untouched. Only the helper is replaced. The new one takes the invocation's index as its
//      parameter, holds the locals of the group, runs the iteration of each call before the last,
//      in order, as a prologue, and then the last member's own iteration, as the compiler lowered
//      it. The calls before the last lose their index and their guard: the loop entry guards the
//      trip count, and the helper runs only in range. A partials binding for each variable the
//      last member folds follows the arrays' bindings.
//
// This builds no module for a group the planner refused, and checks no fact: it checks only
// what it needs to build (a lowered shape it knows, an IR of this version, names that agree, a
// reduction that is the last call of its group). A group it cannot build is reported as `{ none }`
// with the reason.
//
// Like the rest of `typeshade/runtime` it imports no compiler, and `typeshade/fuse` is the only
// subpath that imports this file.

import { emitModule } from './backends/wgsl.js';
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
import { typeKey, type ShaderType } from './ir/types.js';
import { eachStmtExpr, mapChildren, mapStmtExpr } from './ir/visit.js';
import { layoutOf } from './manifest.js';
import { invocationIndex } from './kernel-workgroup.js';
import { KERNEL_WORKGROUP } from './kernel-tree.js';
import { VERSION } from './version.js';

/** One call of a group as the builder reads it. */
export interface FusedMember {
  readonly k: KernelFace;
  /** For each parameter in order, the slot of its array; undefined for a value parameter. */
  readonly slots: readonly (number | undefined)[];
}

/** A storage binding of the fused entry: one distinct array of the group that the entry binds. */
export interface FusedSlot {
  /** The binding's name in the fused module; no parameter's name is one. */
  readonly name: string;
  readonly binding: EntryBinding;
  /** Whether any member writes it. */
  readonly written: boolean;
  /** The array it binds, as the index the planner's slots give it: a contracted slot has no
   *  binding, so this is not the binding's position. */
  readonly array: number;
}

/** What a group whose last call reduces runs besides its entry (F6): the entry that folds a level
 *  of partials, and what the levels read of the last call's face. */
export interface FusedReduce {
  /** The entry that folds a level of partials. */
  readonly fold: ComputeEntry;
  /** What the last call reduces, as its face describes it, with the binding of each variable's
   *  partials as the fused module numbers it. */
  readonly vars: NonNullable<KernelLoop['reduce']>['vars'];
  /** The fields of the merged uniform that say how many partials a level folds, where they start
   *  and where the level writes its own: the last call's `_n`, `_in` and `_out`. */
  readonly fields: { readonly n: string; readonly in: string; readonly out: string };
}

/** The entry a group runs as, and what a dispatch of it binds. */
export interface Fused {
  /** What an error names it by: the kernel functions of the group, in order. */
  readonly label: string;
  /** What the call layer dispatches. For a group that ends in a loop that reduces, this is the
   *  loop's entry, and {@link Fused.reduce} says the rest. */
  readonly entry: ComputeEntry;
  /** Present when the last call of the group reduces. */
  readonly reduce?: FusedReduce;
  /** The module the entry was emitted from, before any pass. */
  readonly module: ModuleDecl;
  /** The merged uniform. */
  readonly args: EntryBinding;
  /** The workgroup size of the entry: a dispatch takes `ceil(n / wg)` workgroups. It is 256 when
   *  the last call reduces, else the size the calls declare with `@workgroup_size`, else 64 (F7). */
  readonly wg: number;
  /** One for each distinct array the entry binds, in the order the calls first reach them: the
   *  arrays the planner contracted have none. */
  readonly slots: readonly FusedSlot[];
}

/** The fused entries built so far. A face keeps the entries of the groups it starts, and the
 *  entries die with it, so a module that is loaded again leaves none behind. */
const built = new WeakMap<KernelFace, Map<string, Fused | { readonly none: string }>>();

const faceIds = new WeakMap<KernelFace, number>();
let faceCount = 0;
const faceId = (k: KernelFace): number => {
  let id = faceIds.get(k);
  if (id === undefined) faceIds.set(k, (id = faceCount++));
  return id;
};

/** The shape of a group: for each member the face (its origin, function and loop, the entry that
 *  folds the partials of a loop that reduces, and the identity that tells a module loaded again
 *  from the one it replaced) and the slot each array parameter takes, then which slots are
 *  contracted. Neither a length nor a value is in it: they are the uniform's and the buffers'. */
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

/**
 * The fused entry of `members`, built once for each shape. `contracted` lists the slots the entry
 * holds as locals and binds no buffer for: the scratch arrays the planner contracted. A group the
 * builder cannot build is `{ none }` with the reason, and stays so for its shape.
 */
export function fusedFor(
  members: readonly FusedMember[],
  contracted: readonly number[] = [],
): Fused | { readonly none: string } {
  const head = members[0]!.k;
  let per = built.get(head);
  if (per === undefined) built.set(head, (per = new Map()));
  const local = new Set(contracted);
  const key = shapeOf(members, local);
  let fused = per.get(key);
  if (fused === undefined) {
    try {
      fused = assemble(members, local);
    } catch (e) {
      fused = { none: e instanceof Error ? e.message : String(e) };
    }
    per.set(key, fused);
  }
  return fused;
}

/**
 * The values of the merged uniform for a dispatch: each member's `_start` and `_n`, and its
 * scalar parameters, in the fields the builder named for them. A member that reduces also has
 * `_in` and `_out`, which are 0 for its loop's dispatch and which each level of its fold changes.
 * `hosts` is what each call's parameters hold on the host.
 */
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

// ─── building ────────────────────────────────────────────────────────────────────────────────

/** A member with its module read back. */
interface Part {
  readonly k: KernelFace;
  readonly origin: string;
  readonly loop: FuseLoop;
  readonly mod: ModuleDecl;
  readonly entry: FuncDecl;
  /** The function whose body holds the iteration: the entry, or for a loop that reduces the
   *  helper that runs one iteration. */
  readonly iterates: FuncDecl;
  /** The entry that folds a level of partials, for a loop that reduces. */
  readonly fold?: FuncDecl;
  readonly slots: readonly (number | undefined)[];
  /** The slot of each array parameter, by name. */
  readonly slotOf: Map<string, number>;
}

/** A distinct array of the group. */
interface Slot {
  readonly index: number;
  readonly name: string;
  readonly type: ShaderType;
  /** The first parameter that reaches it: its layout and TypeShade type are the binding's. */
  readonly param: KernelParam & { readonly k: 'array' };
  written: boolean;
  /** The member that writes it first, or -1. */
  writer: number;
  /** Whether the entry holds it as a local `name` and binds no buffer for it. */
  readonly contracted: boolean;
  /** The local a later member reads it from, when a member reads what an earlier one wrote. */
  edge?: string;
}

const elemOf = (t: ShaderType): ShaderType => (t as { elem: ShaderType }).elem;

/** The names a body declares: `let`, `var`, and the counters of `for`s. */
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

/** Whether a body returns. The fused entry has one body for all members, so a `return` of one
 *  would end the others for that index. */
function returns(body: readonly Stmt[]): boolean {
  let found = false;
  const walk = (st: Stmt): void => {
    if (st.s === 'return') found = true;
    eachStmtExpr(st, () => undefined, walk);
  };
  body.forEach(walk);
  return found;
}

/** `decls` of every part by name; a name two parts declare differently is a refusal. */
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

/** The `_fp64` guard binding the WGSL of a module that emulates `f64` declares, if any. */
function guardOf(wgsl: string): { group: number; binding: number } | undefined {
  const m = /@group\((\d+)\)\s*@binding\((\d+)\)\s*var\s+_fp64\b/.exec(wgsl);
  return m === null ? undefined : { group: Number(m[1]), binding: Number(m[2]) };
}

function assemble(members: readonly FusedMember[], contracted: ReadonlySet<number>): Fused {
  const parts: Part[] = members.map((m) => {
    const fuse = m.k.fuse;
    if (fuse === undefined || fuse.facts.length !== 1 || m.k.gpu === undefined)
      throw new Error(`${m.k.name}() carries no fuse record of one loop`);
    // The IR is not a stable format: only the version that wrote it reads it.
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
    // A loop that reduces: its entry, the helper that runs an iteration of it from the start, and
    // the entry that folds a level of partials, all as the compiler lowered them.
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
  // Only the last call of a group may reduce: nothing runs after the fold.
  parts.forEach((p, j) => {
    if (p.loop.reduces && j < parts.length - 1)
      throw new Error(`${p.k.name}() reduces, and only the last call of a group may`);
  });
  const last = parts.length - 1;
  const reducing = parts[last]!.loop.reduces ? parts[last] : undefined;

  // A prefix that no name of any member starts with.
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

  // One storage binding for each distinct array, whatever the parameters that reach it are called.
  const found = new Map<number, Slot>();
  parts.forEach((p, j) => {
    p.k.params.forEach((prm, i) => {
      const at = p.slots[i];
      if (prm.k !== 'array' || at === undefined) return;
      // The IR names the array's binding by its emitted spelling (Rule 3.3), which the face does
      // not: the face's array binding gives the group and the slot that finds it.
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
            // A buffer is `r`, and a local is `s`.
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
      // Keyed by the emitted name, the one the IR's references carry.
      p.slotOf.set(decl.name, at);
      if (prm.writes) {
        // A later member reads the local of the member that wrote, so there is one writer.
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
    // A local holds one scalar.
    if (slot.type.kind !== 'array' || elemOf(slot.type).kind !== 'scalar')
      throw new Error(`an array of ${typeKey(elemOf(slot.type))} cannot be held as a local`);
  }

  // An edge: an array a member wrote and a later member reads at exactly `i`. The later member
  // reads a local. A read that is not at `i` is no edge: the planner refuses such a group, and a
  // group built anyway reads the array, so that it shows the race it has.
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

  // The declarations the members share. A name two origins declare differently stops the group.
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
  // A group that ends in a reduction declares two more functions beside its entry.
  while (
    taken.has(entryName) ||
    (reducing !== undefined &&
      (taken.has(`${entryName}_fold`) || taken.has(`${entryName}_iteration`)))
  )
    entryName += '_';
  const [foldName, iterationName] = [`${entryName}_fold`, `${entryName}_iteration`];
  // The names the fused module declares at its top level. A name is one declaration there,
  // whatever it declares.
  const used = new Set<string>([
    entryName,
    ...(reducing !== undefined ? [foldName, iterationName] : []),
    ...structs.map((s) => s.name),
    ...consts.map((c) => c.name),
    ...vars.map((v) => v.name),
    ...overrides.map((o) => o.name),
  ]);

  // A helper is one function for each (origin, name). Another origin's of the same name is
  // renamed, in its declaration and in every call to it.
  const helperKey = new Map<string, string>();
  const helperRename: Map<string, string>[] = parts.map(() => new Map());
  const helpers: { decl: FuncDecl; to: string; part: number }[] = [];
  parts.forEach((p, j) => {
    for (const f of p.mod.funcs) {
      if (f.stage !== undefined) continue;
      // The helper that runs the iteration of a loop that reduces is the one the group replaces.
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

  // The merged uniform: every field of every member's, prefixed with the member.
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

  /** Member `j`'s statements, moved into the fused entry: its uniform is the merged one, its
   *  array parameters the slots, a read of an edge a write earlier reads the edge's local, its
   *  helpers are the renamed ones, and what it declares gets its prefix (`names`). In the helper
   *  of a loop that reduces the index of the invocation is a parameter (`asParam`), and not a
   *  local of the entry. */
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
    // A node used in more than one place stays one node: the passes key on its identity.
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
          // An element of an array the entry holds as a local is the local: the index is dropped.
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
          else if (asParam && r.name === '_k') out = { op: 'param', type: r.type, name: '_k' };
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

  // A helper is rewritten for the calls it makes to the others, and nothing else.
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

  // The locals of the group, at the top of the one function that runs the iterations: the scratch
  // arrays it holds, and the locals of the edges. A `var` starts at zero, as a new buffer does.
  const locals: Stmt[] = [];
  for (const slot of slots)
    if (slot.contracted) locals.push({ s: 'var', name: slot.name, type: elemOf(slot.type) });
  for (const slot of slots)
    if (slot.edge !== undefined)
      locals.push({ s: 'var', name: slot.edge, type: elemOf(slot.type) });

  /** The iteration of the map member `j`, as the function that runs the iterations holds it, and
   *  then what the member wrote for a later member to read: the local takes it from the array. */
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
  // The size of the group (F7, proposal 0067): a loop that reduces runs at the tree of 256, and a
  // group of map loops at the size its calls declare, or at 64 when none declares one. The planner
  // settles that no declared size differs, so a member that declares another size is refused here.
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
    // The entry: the first member's guard, the locals, and each member's iteration in the order of
    // the calls. The index of the invocation counts in workgroups of the group's size, so it is
    // written again here rather than taken from the first member, which may have another size.
    const [index, ...guard] = head.entry.body.slice(0, head.loop.iteration);
    if (index?.s !== 'let' || index.name !== '_k')
      throw new Error(`${head.k.name}() does not start its entry with the invocation index`);
    entry = {
      ...head.entry,
      name: entryName,
      workgroupSize: groupWg,
      attrs: [`@compute @workgroup_size(${groupWg})`],
      body: [
        invocationIndex(groupWg),
        ...rewrite(0, guard, false),
        ...locals,
        ...parts.flatMap((_, j) => iterationOf(j, false)),
      ],
    };
    own = [entry];
  } else {
    // The last member's lowering stays: its loop entry and its fold entry are rewritten for the
    // merged uniform, and its helper is replaced by one that runs the iterations of the calls
    // before it first. The loop entry guards the trip count, so the calls before the last bring
    // no index and no guard of their own.
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

  // The arrays the entry binds: all but the ones it holds as locals. A loop that reduces adds the
  // partials of each variable it folds, after them.
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
  // The same validation and writer `typeshade/emit` runs.
  const wgsl = emitModule(module);

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
  // An emulated `f64` makes the writer declare the `_fp64` guard, which the runtime binds.
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
