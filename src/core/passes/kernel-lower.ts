// Implements: Rule 8.22, a kernel function's accepted loops lowered to compute entries (docs/language-design.md; traced in reqs/).
// ═══ A kernel function's loops, lowered to the compute entries its call dispatches (0013) ═══
//
// The proof (`parallel-loop.ts`) says which of a kernel function's loops may run in any order.
// This pass turns a function whose every loop it accepted into what the host call dispatches:
//
//   - one module, which every target but WGSL ignores, holding a `@compute` entry per loop, the
//     functions the loops call, a uniform struct of the function's scalar parameters and each
//     loop's start and trip count, and a storage binding per array parameter, read or
//     read-write as the body uses it (Rule 8.23);
//   - per loop, a range function the host runs on the CPU tier first: the statements before the
//     loop, then the loop's start and bound, from which the call takes the trip count. Its arrays
//     are read only by their `.length`, so the call hands it the lengths alone.
//
// Each invocation takes one iteration: `i = start + k * step` for the `k`th, and returns at once
// past the trip count. It replays the scalar statements before the loop, which write only its
// own locals (the body's shape, Rule 8.22), and a `continue` of the loop's own becomes its
// `return`.
//
// A loop that reduces (`s += xs[i]`) runs at a workgroup of 256 in the tree order (Rule 7.2,
// `core/kernel-tree.ts`): each invocation runs its iteration in a helper that starts the
// variable from the identity and returns what it holds; the workgroup folds the 256 values by
// the tree into one partial per workgroup, and a second entry folds the partials the same way,
// one dispatch per level, until one is left. The call then runs the tail on the CPU tier: the
// function's body with each loop replaced by combining its variables with what the GPU folded,
// which gives the function's result.
//
// A function this pass cannot lower runs on the CPU tier, and `noGpu` says why. A loop that
// scatters or writes a texture, one that reaches a module binding or variable, a `bool`, and an
// emulated `f64`, run on the CPU until the parts of change 0013 that add them.

import type {
  BindingDecl,
  Expr,
  FuncDecl,
  ModuleDecl,
  ModuleVarDecl,
  Stmt,
  StructDecl,
} from '../ir/nodes.js';
import type { ShaderType } from '../ir/types.js';
import { u32T } from '../ir/types.js';
import { eachExpr, eachStmtExpr, mapChildren, mapStmtExpr } from '../ir/visit.js';
import { eachOperand, isAtomicAccess } from './access.js';
import { fnReads, fnWrites } from './effects.js';
import {
  combineOf as writeCombine,
  type KernelProof,
  type LoopReduction,
} from './parallel-loop.js';
import { KERNEL_TREE, treeIdentity } from '../kernel-tree.js';

type ForStmt = Stmt & { s: 'for' };

/** One loop of a lowered kernel function. */
export interface KernelLoopPlan {
  /** The `@compute` entry that runs it, one invocation per iteration. */
  readonly entry: string;
  /** The CPU-tier function that returns `vec2(start, bound)` for it. */
  readonly range: string;
  /** How the counter compares with the bound, as the loop writes it (`i < n`). */
  readonly cop: '<' | '<=' | '>' | '>=';
  readonly step: number;
  /** The array parameters the loop writes, which the call reads back. */
  readonly writes: readonly string[];
  /** `a*i + c` writes, which the call checks against each array's length first. */
  readonly checks: readonly { readonly param: string; readonly a: number; readonly c: number }[];
  /** The workgroup size the loop's entry runs at: {@link KERNEL_TREE} for a loop that
   *  reduces, {@link KERNEL_WORKGROUP} otherwise. */
  readonly wg: number;
  /** What the loop reduces, when it does: the entry that folds a level of partials, and per
   *  variable the storage binding its partials are in. */
  readonly reduce?: {
    readonly entry: string;
    readonly vars: readonly (LoopReduction & { readonly binding: string })[];
  };
}

/** What the call of a kernel function dispatches, when the function lowers. */
export interface KernelPlan {
  /** The module the entries are in; a target emits it as WGSL. */
  readonly module: ModuleDecl;
  /** The uniform binding of the scalar parameters, `_start` and `_n`. */
  readonly argsBinding: string;
  readonly argsStruct: string;
  readonly loops: readonly KernelLoopPlan[];
  /** The range functions, and the tail when there is one, for the CPU tier's code. */
  readonly ranges: readonly FuncDecl[];
  /** The CPU-tier function that gives the result: the function's parameters, then what the
   *  GPU folded for each reduction in loop order, when the function returns a value. */
  readonly tail?: string;
}

/** The workgroup size every lowered loop runs at. */
export const KERNEL_WORKGROUP = 64;

/** Lower kernel function `f` of `m`, whose loops `proof` judged, or say why it runs on the CPU. */
export function lowerKernel(
  f: FuncDecl,
  m: ModuleDecl,
  proof: KernelProof,
): KernelPlan | { readonly noGpu: string } {
  if (proof.shape !== undefined)
    return { noGpu: "its body is not the kernel call's shape (TS8070)" };
  const loops = f.body.filter((s): s is ForStmt => s.s === 'for');
  if (loops.length === 0) return { noGpu: 'it has no loop to dispatch' };
  for (const v of proof.loops) {
    if (!v.ok) return { noGpu: 'a loop of it runs on the CPU (TS8070)' };
    if (v.writes.some((w) => w.kind === 'texel'))
      return { noGpu: "a loop of it writes a texture, whose host value is #204's image" };
    for (const r of v.reductions) {
      const why = notReducible(r.type);
      if (why !== undefined) return { noGpu: `it reduces "${r.name}", ${why}` };
    }
  }
  const scalars = f.params.filter((p) => !isRuntimeArray(p.type));
  const arrays = f.params.filter((p) => isRuntimeArray(p.type));
  // An integer array a loop scatters into (`bins[k] += 1`) is `array<atomic<T>>` in the
  // module, and each such write an atomic, which is exact in any order. Each write keeps its own
  // operator: two loops may scatter into one array with `&` and `|`.
  const scatter = new Set<string>();
  for (const v of proof.loops)
    if (v.ok)
      for (const w of v.writes)
        if (w.kind === 'scatter') {
          if (ATOMIC_OF[w.op] === undefined)
            return { noGpu: `it scatters into "${w.name}" with ${w.op}, which no atomic does` };
          if (!arrays.some((p) => p.name === w.name))
            return { noGpu: `it scatters into "${w.name}", which is not a parameter` };
          scatter.add(w.name);
        }
  for (const v of proof.loops)
    if (v.ok)
      for (const w of v.writes)
        if (w.kind !== 'scatter' && scatter.has(w.name))
          return {
            noGpu: `a loop writes "${w.name}" in place, and another scatters into it`,
          };
  for (const p of scalars) {
    const why = notUniform(p.type, m);
    if (why !== undefined) return { noGpu: `parameter "${p.name}" is ${why}` };
  }
  for (const p of arrays) {
    const why = notStorage((p.type as { elem: ShaderType }).elem, m);
    if (why !== undefined) return { noGpu: `parameter "${p.name}" holds ${why}` };
  }
  // What the loops reach beyond their own parameters: a module binding or variable is not
  // something the call passes.
  const reads = fnReads(m);
  const writes = fnWrites(m);
  const moduleNames = new Set([
    ...m.bindings.map((b) => b.name),
    ...(m.vars ?? []).map((v) => v.name),
  ]);
  for (const n of [...(reads.get(f.name) ?? []), ...(writes.get(f.name) ?? [])])
    if (moduleNames.has(n)) return { noGpu: `it reaches "${n}", which the call does not pass` };

  const argsStruct = `${f.name}_Args`;
  const argsBinding = `${f.name}_args`;
  const taken = new Set([
    ...m.funcs.map((x) => x.name),
    ...m.structs.map((s) => s.name),
    ...m.bindings.map((b) => b.name),
  ]);
  if (taken.has(argsStruct) || taken.has(argsBinding))
    return {
      noGpu: `the module already declares "${argsBinding}", the name the call's uniform takes`,
    };

  const plans: KernelLoopPlan[] = [];
  const entries: FuncDecl[] = [];
  const ranges: FuncDecl[] = [];
  const extraStructs: StructDecl[] = [];
  const extraVars: ModuleVarDecl[] = [];
  const partBindings: { name: string; type: ShaderType }[] = [];
  const prelude: Stmt[] = [];
  let loopIndex = 0;
  let counterType: ShaderType | undefined;
  // A statement after a loop that reduces, reading what it reduces: the loops after it would
  // replay it before the GPU has folded the variable.
  const reduced = new Set<string>();
  let readsReduced: string | undefined;
  for (const st of f.body) {
    if (st.s !== 'for') {
      if (st.s === 'return') continue;
      if (readsReduced === undefined) readsReduced = firstName([st], reduced);
      prelude.push(st);
      continue;
    }
    const j = loopIndex++;
    if (readsReduced !== undefined)
      return {
        noGpu: `a statement before loop ${j + 1} reads "${readsReduced}", which an earlier loop reduces`,
      };
    const counted = st.counted!;
    const header = rangeOf(st);
    if (header === undefined)
      return { noGpu: `loop ${j + 1} compares its counter in a way the call cannot count` };
    if (counterType !== undefined && typeKey(counterType) !== typeKey(header.type))
      return { noGpu: 'its loops count with counters of two types' };
    counterType = header.type;
    // The range function reads an array only by its `.length`: the call hands it the lengths.
    if (
      !readsArraysByLengthOnly(
        [
          ...prelude,
          { s: 'call', expr: header.start } as Stmt,
          { s: 'call', expr: header.bound } as Stmt,
        ],
        arrays.map((p) => p.name),
      )
    )
      return {
        noGpu: `the statements before loop ${j + 1} read an array's elements, which the call runs before it dispatches`,
      };
    const range: FuncDecl = {
      name: `${f.name}__range${j}`,
      params: f.params,
      ret: {
        kind: 'vec',
        n: 2,
        elem: header.type.kind === 'scalar' ? (header.type.scalar as 'i32') : 'i32',
      },
      body: [
        ...prelude,
        {
          s: 'return',
          expr: {
            op: 'construct',
            type: { kind: 'vec', n: 2, elem: (header.type as { scalar: 'i32' }).scalar },
            args: [header.start, header.bound],
          },
        },
      ],
      kernel: true,
    };
    ranges.push(range);
    const v = proof.loops[j]!;
    const written = new Set<string>();
    if (v.ok) for (const w of v.writes) written.add(w.name);
    const checks: KernelLoopPlan['checks'][number][] = [];
    if (v.ok)
      for (const w of v.writes)
        if (w.kind === 'affine' && arrays.some((p) => p.name === w.name))
          for (const c of w.c) checks.push({ param: w.name, a: w.a, c });
    const reductions = v.ok ? v.reductions : [];
    for (const r of reductions) reduced.add(r.name);
    const loopCtx: LoopCtx = {
      f,
      loop: st,
      j,
      counter: counted.name,
      counterType: header.type,
      step: counted.step,
      prelude,
      scalars: scalars.map((p) => p.name),
      arrays: arrays.map((p) => p.name),
      argsBinding,
      argsStruct,
      scatter,
    };
    const common = {
      range: range.name,
      cop: header.cop,
      step: counted.step,
      writes: [...written].filter((n) => arrays.some((p) => p.name === n)),
      checks,
    };
    if (reductions.length === 0) {
      const entry = entryFor(loopCtx);
      entries.push(entry);
      plans.push({ ...common, entry: entry.name, wg: KERNEL_WORKGROUP });
      continue;
    }
    const lowered = reductionEntries(loopCtx, reductions);
    entries.push(...lowered.funcs);
    extraStructs.push(lowered.struct);
    extraVars.push(...lowered.workgroup);
    partBindings.push(...lowered.vars.map((r) => ({ name: r.binding, type: r.type })));
    plans.push({
      ...common,
      entry: lowered.entry,
      wg: KERNEL_TREE,
      reduce: { entry: lowered.reduceEntry, vars: lowered.vars },
    });
  }

  // The tail: the body with each loop replaced by combining what it reduced, and its return.
  let tail: FuncDecl | undefined;
  if (f.ret.kind !== 'void') {
    const folded: { name: string; type: ShaderType }[] = [];
    let k = 0;
    const body: Stmt[] = [];
    for (const st of f.body) {
      if (st.s !== 'for') {
        body.push(st);
        continue;
      }
      const v = proof.loops[k++]!;
      for (const r of v.ok ? v.reductions : []) {
        const t = { name: `_t${k - 1}_${r.name}`, type: r.type };
        folded.push(t);
        body.push(combineInto(r, { op: 'param', type: r.type, name: t.name }));
      }
    }
    if (
      !readsArraysByLengthOnly(
        body,
        arrays.map((p) => p.name),
      )
    )
      return {
        noGpu: "its result reads an array's elements, which the call computes on the CPU tier",
      };
    tail = {
      name: `${f.name}__tail`,
      params: [...f.params, ...folded],
      ret: f.ret,
      body,
      kernel: true,
    };
    ranges.push(tail);
  }

  const argsDecl: StructDecl = {
    name: argsStruct,
    fields: [
      ...scalars.map((p) => ({ name: p.name, type: p.type })),
      { name: '_start', type: counterType! },
      { name: '_n', type: u32T },
      // Where a level of partials starts, and where the next is written.
      ...(partBindings.length > 0
        ? [
            { name: '_in', type: u32T },
            { name: '_out', type: u32T },
          ]
        : []),
    ],
  };
  const writtenArrays = writes.get(f.name) ?? new Set<string>();
  const bindings: BindingDecl[] = [
    {
      group: 0,
      binding: 0,
      name: argsBinding,
      space: 'uniform',
      type: { kind: 'struct', name: argsStruct },
    },
    ...arrays.map((p, k): BindingDecl => ({
      group: 0,
      binding: k + 1,
      name: p.name,
      space: 'storage',
      access: writtenArrays.has(p.name) ? 'read_write' : 'read',
      type: scatter.has(p.name) ? atomicArray(p.type) : p.type,
    })),
    ...partBindings.map((p, k): BindingDecl => ({
      group: 0,
      binding: arrays.length + 1 + k,
      name: p.name,
      space: 'storage',
      access: 'read_write',
      type: { kind: 'array', elem: p.type },
    })),
  ];
  const module: ModuleDecl = {
    consts: m.consts,
    structs: [...m.structs, argsDecl, ...extraStructs],
    bindings,
    funcs: [...m.funcs.filter((x) => x.kernel !== true && x.stage === undefined), ...entries],
    overrides: m.overrides ?? [],
    vars: [...(m.vars ?? []).filter((x) => x.space !== 'workgroup'), ...extraVars],
    ...(m.enables !== undefined ? { enables: m.enables } : {}),
  };
  for (const name of scatter) {
    if (entries.some((e) => readsOutsideAtomics(e.body, name)))
      return {
        noGpu: `a loop reads "${name}", which a loop scatters into: an atomic is read only by an atomic`,
      };
    if (entries.some((e) => stillPlain(e.body, name)))
      return { noGpu: `it scatters into "${name}" at a place other than an element` };
  }
  return {
    module,
    argsBinding,
    argsStruct,
    loops: plans,
    ranges,
    ...(tail !== undefined ? { tail: tail.name } : {}),
  };
}

// ─── one loop's entry ────────────────────────────────────────────────────────────────────────

/** What building one loop's entries reads. */
interface LoopCtx {
  readonly f: FuncDecl;
  readonly loop: ForStmt;
  readonly j: number;
  readonly counter: string;
  readonly counterType: ShaderType;
  readonly step: number;
  readonly prelude: readonly Stmt[];
  readonly scalars: readonly string[];
  readonly arrays: readonly string[];
  readonly argsBinding: string;
  readonly argsStruct: string;
  /** The arrays the function scatters into, by name. */
  readonly scatter: ReadonlySet<string>;
}

const vec3u: ShaderType = { kind: 'vec', n: 3, elem: 'u32' };
const boolT: ShaderType = { kind: 'scalar', scalar: 'bool' };
const u = (n: number): Expr => ({ op: 'lit', type: u32T, value: n });
const x = (v: Expr): Expr => ({ op: 'member', type: u32T, base: v, field: 'x' });
const y = (v: Expr): Expr => ({ op: 'member', type: u32T, base: v, field: 'y' });
const bin = (bop: '+' | '*', a: Expr, b: Expr): Expr => ({ op: 'binop', type: u32T, bop, a, b });
const gid: Expr = { op: 'param', type: vec3u, name: '_gid' };
const nwg: Expr = { op: 'param', type: vec3u, name: '_nwg' };
const kRef: Expr = { op: 'varref', type: u32T, name: '_k' };

/** The uniform of the call, and one of its fields. */
function argsOf(c: LoopCtx): (name: string, type: ShaderType) => Expr {
  const args: Expr = {
    op: 'varref',
    type: { kind: 'struct', name: c.argsStruct },
    name: c.argsBinding,
  };
  return (name, type) => ({ op: 'member', type, base: args, field: name });
}

/** `_k = gid.x + gid.y * (nwg.x * wg)`: a dispatch past 65535 workgroups spills into y. */
function indexOf(wg: number): Stmt {
  return {
    s: 'let',
    name: '_k',
    expr: bin('+', x(gid), bin('*', y(gid), bin('*', x(nwg), u(wg)))),
  };
}

/** The `@compute` entry's parameters: the two ids every entry reads, and what a tree reads. */
function entryParams(tree: boolean): FuncDecl['params'] {
  return [
    { name: '_gid', type: vec3u, builtin: 'global_invocation_id' },
    { name: '_nwg', type: vec3u, builtin: 'num_workgroups' },
    ...(tree
      ? [
          { name: '_lid', type: u32T, builtin: 'local_invocation_index' },
          { name: '_wid', type: vec3u, builtin: 'workgroup_id' },
        ]
      : []),
  ];
}

/** The iteration `_k` runs: its counter, the prelude replayed, and the loop's body, with each
 *  parameter a field of the uniform or the binding of its name, and each `continue` of the
 *  loop's own a return of `ret`. */
function iterationOf(c: LoopCtx, ret: Expr | undefined, reset: readonly Stmt[]): Stmt[] {
  const field = argsOf(c);
  const start = field('_start', c.counterType);
  const kAs: Expr = { op: 'call', type: c.counterType, fn: typeKey(c.counterType), args: [kRef] };
  const stepLit: Expr = { op: 'lit', type: c.counterType, value: Math.abs(c.step) };
  const i: Expr = {
    op: 'binop',
    type: c.counterType,
    bop: c.step < 0 ? '-' : '+',
    a: start,
    b: { op: 'binop', type: c.counterType, bop: '*', a: kAs, b: stepLit },
  };
  const scalarSet = new Set(c.scalars);
  const arraySet = new Set(c.arrays);
  // A parameter is a field of the uniform, or the storage binding of its name.
  const rewrite = (e: Expr): Expr => {
    if (e.op === 'param' && scalarSet.has(e.name)) return field(e.name, e.type);
    if (e.op === 'param' && arraySet.has(e.name))
      return { op: 'varref', type: e.type, name: e.name };
    return mapChildren(e, rewrite);
  };
  return [
    { s: 'let', name: c.counter, expr: i },
    ...[
      ...c.prelude,
      ...reset,
      ...ownContinuesReturn(c.loop.body, ret).map((st) => toAtomics(st, c.scatter)),
    ].map((st) => mapStmt(st, rewrite)),
    ...(ret !== undefined ? [{ s: 'return', expr: ret } as Stmt] : []),
  ];
}

function entryFor(c: LoopCtx): FuncDecl {
  const field = argsOf(c);
  const k = kRef;
  const index = indexOf(KERNEL_WORKGROUP);
  const body: Stmt[] = [
    index,
    {
      s: 'if',
      arms: [
        {
          cond: { op: 'compare', type: boolT, cop: '>=', a: k, b: field('_n', u32T) },
          body: [{ s: 'return' }],
        },
      ],
    },
    ...iterationOf(c, undefined, []),
  ];
  return computeEntry(`${c.f.name}_loop${c.j}`, body, false);
}

function computeEntry(name: string, body: Stmt[], tree: boolean): FuncDecl {
  const wg = tree ? KERNEL_TREE : KERNEL_WORKGROUP;
  return {
    name,
    params: entryParams(tree),
    ret: { kind: 'void' },
    body,
    stage: 'compute',
    workgroupSize: wg,
    attrs: [`@compute @workgroup_size(${wg})`],
  };
}

// ─── a loop that reduces ─────────────────────────────────────────────────────────────────────

/** The functions, the struct and the workgroup memory a reduction loop lowers to: a helper that
 *  runs iteration `_k` from the identity and returns the variables, the loop's entry that folds
 *  what its workgroup's helpers returned into one partial each, and the entry that folds a level
 *  of partials (`_n` of them from `_in`, written from `_out`). */
function reductionEntries(
  c: LoopCtx,
  reductions: readonly LoopReduction[],
): {
  funcs: FuncDecl[];
  struct: StructDecl;
  workgroup: ModuleVarDecl[];
  vars: (LoopReduction & { binding: string })[];
  entry: string;
  reduceEntry: string;
} {
  const base = `${c.f.name}_loop${c.j}`;
  const field = argsOf(c);
  const struct: StructDecl = {
    name: `${base}_Sums`,
    fields: reductions.map((r) => ({ name: r.name, type: r.type })),
  };
  const structT: ShaderType = { kind: 'struct', name: struct.name };
  const vars = reductions.map((r) => ({ ...r, binding: `${base}_${r.name}` }));
  const shared = (r: LoopReduction): string => `${base}_tree_${r.name}`;
  const workgroup: ModuleVarDecl[] = reductions.map((r) => ({
    name: shared(r),
    space: 'workgroup',
    type: { kind: 'array', elem: r.type, size: KERNEL_TREE },
  }));
  const sums: Expr = {
    op: 'construct',
    type: structT,
    args: reductions.map((r) => ({ op: 'varref', type: r.type, name: r.name })),
  };
  const iterate = iterationOf(
    c,
    sums,
    reductions.map((r): Stmt => ({
      s: 'assign',
      target: { op: 'varref', type: r.type, name: r.name },
      expr: identityOf(r),
    })),
  );
  // The helper reads `_k` as its parameter.
  const asParam = (e: Expr): Expr =>
    e.op === 'varref' && e.name === '_k'
      ? { op: 'param', type: u32T, name: '_k' }
      : mapChildren(e, asParam);
  const helper: FuncDecl = {
    name: `${base}_iteration`,
    params: [{ name: '_k', type: u32T }],
    ret: structT,
    body: iterate.map((st) => mapStmt(st, asParam)),
  };
  const lid: Expr = { op: 'param', type: u32T, name: '_lid' };
  const wid: Expr = { op: 'param', type: vec3u, name: '_wid' };
  const slot = (r: LoopReduction, at: Expr): Expr => ({
    op: 'index',
    type: r.type,
    base: {
      op: 'varref',
      type: { kind: 'array', elem: r.type, size: KERNEL_TREE },
      name: shared(r),
    },
    idx: at,
  });
  const part = (r: LoopReduction & { binding: string }, at: Expr): Expr => ({
    op: 'index',
    type: r.type,
    base: { op: 'varref', type: { kind: 'array', elem: r.type }, name: r.binding },
    idx: at,
  });
  const barrier: Stmt = {
    s: 'call',
    expr: { op: 'call', type: { kind: 'void' }, fn: 'workgroupBarrier', args: [] },
  };
  const inRange: Expr = { op: 'compare', type: boolT, cop: '<', a: kRef, b: field('_n', u32T) };
  // The tree: at stride 128, then 64, down to 1, slot `t` becomes `slot[t] op slot[t + s]`.
  const tree: Stmt[] = [barrier];
  for (let stride = KERNEL_TREE >> 1; stride > 0; stride >>= 1) {
    tree.push({
      s: 'if',
      arms: [
        {
          cond: { op: 'compare', type: boolT, cop: '<', a: lid, b: u(stride) },
          body: reductions.map((r): Stmt => ({
            s: 'assign',
            target: slot(r, lid),
            expr: combineOf(r, slot(r, lid), slot(r, bin('+', lid, u(stride)))),
          })),
        },
      ],
    });
    tree.push(barrier);
  }
  const group = bin('+', x(wid), bin('*', y(wid), x(nwg)));
  const store = (at: Expr): Stmt => ({
    s: 'if',
    arms: [
      {
        cond: { op: 'compare', type: boolT, cop: '==', a: lid, b: u(0) },
        body: vars.map((r): Stmt => ({ s: 'assign', target: part(r, at), expr: slot(r, u(0)) })),
      },
    ],
  });
  const sumsRef: Expr = { op: 'varref', type: structT, name: '_sums' };
  const loopEntry = computeEntry(
    base,
    [
      indexOf(KERNEL_TREE),
      {
        s: 'var',
        name: '_sums',
        type: structT,
        init: { op: 'construct', type: structT, args: reductions.map(identityOf) },
      },
      {
        s: 'if',
        arms: [
          {
            cond: inRange,
            body: [
              {
                s: 'assign',
                target: sumsRef,
                expr: { op: 'call', type: structT, fn: helper.name, args: [kRef], declRef: helper },
              },
            ],
          },
        ],
      },
      ...reductions.map((r): Stmt => ({
        s: 'assign',
        target: slot(r, lid),
        expr: { op: 'member', type: r.type, base: sumsRef, field: r.name },
      })),
      ...tree,
      store(group),
    ],
    true,
  );
  const reduceEntry = computeEntry(
    `${base}_fold`,
    [
      indexOf(KERNEL_TREE),
      ...vars.flatMap((r): Stmt[] => [
        { s: 'var', name: `_v_${r.name}`, type: r.type, init: identityOf(r) },
        {
          s: 'if',
          arms: [
            {
              cond: inRange,
              body: [
                {
                  s: 'assign',
                  target: { op: 'varref', type: r.type, name: `_v_${r.name}` },
                  expr: part(r, bin('+', field('_in', u32T), kRef)),
                },
              ],
            },
          ],
        },
        {
          s: 'assign',
          target: slot(r, lid),
          expr: { op: 'varref', type: r.type, name: `_v_${r.name}` },
        },
      ]),
      ...tree,
      store(bin('+', field('_out', u32T), group)),
    ],
    true,
  );
  return {
    funcs: [helper, loopEntry, reduceEntry],
    struct,
    workgroup,
    vars,
    entry: loopEntry.name,
    reduceEntry: reduceEntry.name,
  };
}

/** `a op b` in `r`'s type. */
function combineOf(r: LoopReduction, a: Expr, b: Expr): Expr {
  return r.op === 'min' || r.op === 'max'
    ? { op: 'call', type: r.type, fn: r.op, args: [a, b] }
    : { op: 'binop', type: r.type, bop: r.op, a, b };
}

/** `s = s op t`, in the tail. */
function combineInto(r: LoopReduction, t: Expr): Stmt {
  const target: Expr = { op: 'varref', type: r.type, name: r.name };
  return { s: 'assign', target, expr: combineOf(r, target, t) };
}

/** The identity of `r`'s operator in its type, spelled exactly: `-0` and the largest finite
 *  `f32` through their bits. */
function identityOf(r: LoopReduction): Expr {
  const t = r.type;
  if (t.kind === 'f64' || t.kind === 'vec64') {
    // An emulated double's range is its `hi` f32's, and an infinity is no literal Tint takes, so
    // `min` and `max` start from the largest finite f32, as an `f32` one does.
    const one = treeIdentity(r.op, 'f64') as number;
    const value = Number.isFinite(one) ? one : one > 0 ? F32_MAX_VALUE : -F32_MAX_VALUE;
    const e: Expr = { op: 'lit', type: { kind: 'f64' }, value };
    return t.kind === 'vec64'
      ? { op: 'construct', type: t, args: new Array<Expr>(t.n).fill(e) }
      : e;
  }
  const scalar = (t.kind === 'vec' ? t.elem : (t as { scalar: string }).scalar) as 'f32';
  const one = treeIdentity(r.op, scalar) as number;
  const st: ShaderType = { kind: 'scalar', scalar };
  let e: Expr;
  if (scalar === 'f32' && (Object.is(one, -0) || Math.abs(one) > 1e38)) {
    const bits = Object.is(one, -0) ? 0x80000000 : one > 0 ? 0x7f7fffff : 0xff7fffff;
    e = { op: 'call', type: st, fn: 'bitcastF32', args: [u(bits)] };
  } else e = { op: 'lit', type: st, value: one };
  return t.kind === 'vec' ? { op: 'construct', type: t, args: new Array<Expr>(t.n).fill(e) } : e;
}

/** The largest finite f32, the emulated double's `min` identity on the GPU. */
const F32_MAX_VALUE = 3.4028234663852886e38;

/** Why a reduction variable of type `t` cannot be folded on the GPU, or undefined. */
function notReducible(t: ShaderType): string | undefined {
  // An emulated double folds by the same tree, its combine the emulation's own.
  if (t.kind === 'f64' || t.kind === 'vec64') return undefined;
  const scalar = t.kind === 'scalar' ? t.scalar : t.kind === 'vec' ? t.elem : undefined;
  if (scalar === undefined) return `a ${t.kind}, which the GPU does not fold`;
  if (scalar === 'f32' || scalar === 'i32' || scalar === 'u32') return undefined;
  if (scalar === 'bool') return 'a bool, which no buffer holds';
  return `an ${scalar}, which the call does not fold on the GPU`;
}

/** The first of `names` that `sts` read. */
function firstName(sts: readonly Stmt[], names: ReadonlySet<string>): string | undefined {
  if (names.size === 0) return undefined;
  let found: string | undefined;
  const visit = (e: Expr): void => {
    if (found !== undefined) return;
    if ((e.op === 'varref' || e.op === 'param') && names.has(e.name)) {
      found = e.name;
      return;
    }
    forEachChild(e, visit);
  };
  for (const st of sts)
    mapStmt(st, (e) => {
      visit(e);
      return e;
    });
  return found;
}

/** The loop's body with each `continue` of its own, which ends this iteration, as a `return`,
 *  which ends this invocation. One inside a nested loop is that loop's and stays. */
function ownContinuesReturn(body: readonly Stmt[], ret?: Expr): Stmt[] {
  const visit = (st: Stmt): Stmt => {
    switch (st.s) {
      case 'continue':
        return {
          s: 'return',
          ...(ret !== undefined ? { expr: ret } : {}),
          ...(st.span !== undefined ? { span: st.span } : {}),
        };
      case 'if':
        return {
          ...st,
          arms: st.arms.map((a) => ({ ...a, body: a.body.map(visit) })),
          ...(st.elseBody !== undefined ? { elseBody: st.elseBody.map(visit) } : {}),
        };
      case 'switch':
        // A `continue` in a switch continues the loop around it, which is this one.
        return {
          ...st,
          cases: st.cases.map((c) => ({ ...c, body: c.body.map(visit) })),
          ...(st.defaultBody !== undefined ? { defaultBody: st.defaultBody.map(visit) } : {}),
        };
      default:
        return st;
    }
  };
  return body.map(visit);
}

/** `s` with `f` applied to every expression it holds, nested statements included. */
function mapStmt(st: Stmt, f: (e: Expr) => Expr): Stmt {
  const S = (x: Stmt): Stmt => mapStmt(x, f);
  switch (st.s) {
    case 'let':
      return { ...st, expr: f(st.expr) };
    case 'var':
      return st.init !== undefined ? { ...st, init: f(st.init) } : st;
    case 'assign':
    case 'assignOp':
      return { ...st, target: f(st.target), expr: f(st.expr) };
    case 'call':
      return { ...st, expr: f(st.expr) };
    case 'return':
      return st.expr !== undefined ? { ...st, expr: f(st.expr) } : st;
    case 'if':
      return {
        ...st,
        arms: st.arms.map((a) => ({ cond: f(a.cond), body: a.body.map(S) })),
        ...(st.elseBody !== undefined ? { elseBody: st.elseBody.map(S) } : {}),
      };
    case 'for':
      return {
        ...st,
        init: S(st.init),
        cond: f(st.cond),
        update: S(st.update),
        body: st.body.map(S),
      };
    case 'switch':
      return {
        ...st,
        scrut: f(st.scrut),
        cases: st.cases.map((c) => ({ ...c, body: c.body.map(S) })),
        ...(st.defaultBody !== undefined ? { defaultBody: st.defaultBody.map(S) } : {}),
      };
    default:
      return st;
  }
}

// ─── a scatter ───────────────────────────────────────────────────────────────────────────────

const ATOMIC_OF: Readonly<Record<string, string>> = {
  '+': 'atomicAdd',
  '&': 'atomicAnd',
  '|': 'atomicOr',
  '^': 'atomicXor',
  min: 'atomicMin',
  max: 'atomicMax',
};

/** `array<T>` as `array<atomic<T>>`, the same bytes. */
function atomicArray(t: ShaderType): ShaderType {
  const elem = (t as { elem: ShaderType }).elem as { scalar: 'u32' | 'i32' };
  return { kind: 'array', elem: { kind: 'atomic', elem: elem.scalar } };
}

/** `st` with each write into an array it scatters into, `a[k] op= e`, as the atomic of `op` on
 *  `a[k]`, in nested statements too. A write at any other place is left for `stillPlain`. */
function toAtomics(st: Stmt, scatter: ReadonlySet<string>): Stmt {
  if (scatter.size === 0) return st;
  const inner = mapStmtExpr(
    st,
    (e) => e,
    (b) => toAtomics(b, scatter),
  );
  if (inner.s !== 'assign' && inner.s !== 'assignOp') return inner;
  const t = inner.target;
  if (t.op !== 'index' || t.base.op !== 'param' || !scatter.has(t.base.name)) return inner;
  const combine = writeCombine(inner).combine;
  if (combine === undefined) return inner;
  const at = atomicArray(t.base.type);
  const atomicT = (at as { elem: ShaderType }).elem;
  const place: Expr = { ...t, type: atomicT, base: { ...t.base, type: at } };
  return {
    s: 'call',
    expr: {
      op: 'call',
      type: t.type,
      fn: ATOMIC_OF[combine.op]!,
      args: [place, combine.with],
    },
    ...(inner.span !== undefined ? { span: inner.span } : {}),
  };
}

/** Whether `sts` read the array `name` other than as an atomic's place or through its length,
 *  the two operands `access.ts` says read no element as a value (#348). */
function readsOutsideAtomics(sts: readonly Stmt[], name: string): boolean {
  let found = false;
  const visit = (e: Expr): void => {
    if (found) return;
    if ((e.op === 'varref' || e.op === 'param') && e.name === name) {
      found = true;
      return;
    }
    eachOperand(e, (c, access) => {
      if (access === 'value') visit(c);
      else if (isAtomicAccess(access)) {
        // The place's own indices are still read.
        for (let b = c; b.op === 'index' || b.op === 'member'; b = b.base)
          if (b.op === 'index') visit(b.idx);
      }
    });
  };
  for (const st of sts)
    mapStmt(st, (e) => {
      if (st.s === 'assign' || st.s === 'assignOp') {
        // A write's target is not a read; `stillPlain` answers for it.
        if (e === st.target) return e;
      }
      visit(e);
      return e;
    });
  return found;
}

/** Whether `sts` still write the array `name` as a plain place, which `toAtomics` did not turn
 *  into an atomic. */
function stillPlain(sts: readonly Stmt[], name: string): boolean {
  let found = false;
  const walk = (st: Stmt): void => {
    if ((st.s === 'assign' || st.s === 'assignOp') && rootOf(st.target) === name) found = true;
    mapStmtExpr(
      st,
      (e) => e,
      (b) => {
        walk(b);
        return b;
      },
    );
  };
  sts.forEach(walk);
  return found;
}

function rootOf(e: Expr): string | undefined {
  let b: Expr = e;
  while (b.op === 'index' || b.op === 'member') b = b.base;
  return b.op === 'varref' || b.op === 'param' ? b.name : undefined;
}

// ─── the loop's range ────────────────────────────────────────────────────────────────────────

/** The loop's start, its bound, the comparison between them and the counter's type. */
function rangeOf(
  loop: ForStmt,
): { start: Expr; bound: Expr; cop: KernelLoopPlan['cop']; type: ShaderType } | undefined {
  const c = loop.counted;
  if (c === undefined || loop.init.s !== 'var' || loop.init.init === undefined) return undefined;
  const cond = loop.cond;
  if (cond.op !== 'compare') return undefined;
  const flip = { '<': '>', '<=': '>=', '>': '<', '>=': '<=' } as const;
  const isCounter = (e: Expr): boolean =>
    (e.op === 'varref' || e.op === 'param') && e.name === c.name;
  let cop: KernelLoopPlan['cop'];
  let bound: Expr;
  if (isCounter(cond.a) && cond.cop in flip) {
    cop = cond.cop as KernelLoopPlan['cop'];
    bound = cond.b;
  } else if (isCounter(cond.b) && cond.cop in flip) {
    cop = flip[cond.cop as keyof typeof flip];
    bound = cond.a;
  } else return undefined;
  // The step moves toward the bound (Rule 7.5): up for `<`, down for `>`.
  if ((cop === '<' || cop === '<=') !== c.step > 0) return undefined;
  return { start: loop.init.init, bound, cop, type: loop.init.type };
}

/** Whether `sts` read the arrays `names` only as `arrayLength(a)`: only through an operand
 *  `access.ts` says is measured and not read (#348). */
function readsArraysByLengthOnly(sts: readonly Stmt[], names: readonly string[]): boolean {
  const set = new Set(names);
  let ok = true;
  const visit = (e: Expr): void => {
    if (!ok) return;
    if ((e.op === 'param' || e.op === 'varref') && set.has(e.name)) {
      ok = false;
      return;
    }
    eachOperand(e, (c, access) => {
      if (access !== 'length') visit(c);
    });
  };
  const walk = (st: Stmt): void => {
    mapStmt(st, (e) => {
      visit(e);
      return e;
    });
  };
  sts.forEach(walk);
  return ok;
}

function forEachChild(e: Expr, f: (c: Expr) => void): void {
  mapChildren(e, (c) => {
    f(c);
    return c;
  });
}

// ─── what the call can bind ──────────────────────────────────────────────────────────────────

const isRuntimeArray = (t: ShaderType): boolean => t.kind === 'array' && t.size === undefined;

function typeKey(t: ShaderType): string {
  return t.kind === 'scalar' ? t.scalar : t.kind;
}

/** Why a scalar parameter cannot be a uniform field, or undefined. */
function notUniform(t: ShaderType, m: ModuleDecl): string | undefined {
  return notShareable(t, m, new Set());
}

/** Why an array element cannot live in a storage buffer the call packs, or undefined. */
function notStorage(t: ShaderType, m: ModuleDecl): string | undefined {
  return notShareable(t, m, new Set());
}

function notShareable(t: ShaderType, m: ModuleDecl, seen: Set<string>): string | undefined {
  switch (t.kind) {
    case 'scalar':
      return t.scalar === 'bool' ? 'a bool, which no buffer holds' : undefined;
    case 'vec':
      return t.elem === 'bool' ? 'a bool vector, which no buffer holds' : undefined;
    case 'mat':
      return t.elem === 'f64' ? 'a matrix of f64, which has no host value yet' : undefined;
    // An emulated double: two f32s in the buffer, which the call splits and joins (0013's
    // f64 split), and the module's `_fp64` guard, which the call binds.
    case 'f64':
    case 'vec64':
      return undefined;
    case 'array':
      return t.size === undefined ? 'an array with no size' : notShareable(t.elem, m, seen);
    case 'struct': {
      if (seen.has(t.name)) return undefined;
      seen.add(t.name);
      const s = m.structs.find((x) => x.name === t.name);
      if (s === undefined) return `struct ${t.name}, which is not declared`;
      for (const fl of s.fields) {
        const why = notShareable(fl.type, m, seen);
        if (why !== undefined) return why;
      }
      return undefined;
    }
    default:
      return `a ${t.kind}, which the call does not pack yet`;
  }
}

// ─── the WebGL2 tier (Rule 11.8) ─────────────────────────────────────────────────────────────

/** One loop of a kernel function as the WebGL2 tier runs it: a fragment program over an `R32UI`
 *  target, one texel per iteration (`lowerComputeToFragment`, `backends/glsl.ts`). */
export interface KernelGlLoopPlan {
  /** The module of the loop's portable `@compute` entry, which the GLSL writer lowers. */
  readonly module: ModuleDecl;
  /** The array the loop writes, at exactly `i`, and its element's scalar. */
  readonly out: string;
  readonly outScalar: 'f32' | 'i32' | 'u32';
  /** The arrays the loop reads, each a data texture of its name. */
  readonly reads: readonly string[];
  /** The loose uniforms the program reads: the scalar parameters, then `_start`. */
  readonly uniforms: readonly { readonly name: string; readonly type: ShaderType }[];
}

/** The binding that carries the dispatch: `.x` the iteration count, `.y` the grid's width. */
export const GL_DISPATCH = '_dispatch';
/** The `R32UI` target the loop's writes land in. */
export const GL_OUT = '_out';

/**
 * Lower kernel function `f`'s loops for the WebGL2 tier, or say why it cannot run there.
 *
 * WebGL2 has no compute stage and no storage buffer; the fragment lowering the compute runner
 * uses takes a loop that writes one array of 4-byte elements (`f32`, `i32`, `u32`) at exactly
 * `i`, reads others as data textures, and takes its scalars as uniforms. Each such loop is one
 * program; every other shape goes to the next tier.
 */
/** Whether a call in `loop` hands an element of `array` to a parameter its callee writes
 *  through, `bump(ref(out[i]))` (Rule 8.25). */
function writesThroughCall(loop: Stmt, array: string, m: ModuleDecl): boolean {
  const byName = new Map(m.funcs.map((g) => [g.name, g]));
  let found = false;
  eachStmtExpr(loop, (e) =>
    eachExpr(e, (x) => {
      if (found || x.op !== 'call') return;
      const callee = byName.get(x.fn);
      if (callee === undefined) return;
      callee.params.forEach((p, i) => {
        if (p.mode !== 'inout' || x.args[i] === undefined) return;
        let root: Expr = x.args[i]!;
        while (root.op === 'index' || root.op === 'member') root = root.base;
        if ((root.op === 'varref' || root.op === 'param') && root.name === array) found = true;
      });
    }),
  );
  return found;
}

export function lowerKernelGl(
  f: FuncDecl,
  m: ModuleDecl,
  proof: KernelProof,
): { readonly loops: readonly KernelGlLoopPlan[] } | { readonly noWebgl2: string } {
  if (proof.shape !== undefined) return { noWebgl2: "its body is not the kernel call's shape" };
  const scalars = f.params.filter((p) => !isRuntimeArray(p.type));
  const arrays = f.params.filter((p) => isRuntimeArray(p.type));
  for (const p of scalars) {
    const t = p.type;
    const s = t.kind === 'scalar' ? t.scalar : t.kind === 'vec' ? t.elem : undefined;
    if (s !== 'f32' && s !== 'i32' && s !== 'u32')
      return {
        noWebgl2: `parameter "${p.name}" is not a number or a vector, which a uniform holds`,
      };
  }
  const argsStruct = `${f.name}_GlArgs`;
  const argsBinding = `${f.name}_glargs`;
  const plans: KernelGlLoopPlan[] = [];
  const prelude: Stmt[] = [];
  let j = 0;
  for (const st of f.body) {
    if (st.s !== 'for') {
      if (st.s !== 'return') prelude.push(st);
      continue;
    }
    const v = proof.loops[j];
    const loopNo = ++j;
    if (v === undefined || !v.ok) return { noWebgl2: `loop ${loopNo} runs on the CPU` };
    if (v.reductions.length > 0)
      return { noWebgl2: `loop ${loopNo} reduces, which WebGL2 has no workgroup memory for` };
    const w = v.writes[0];
    if (v.writes.length !== 1 || w === undefined)
      return { noWebgl2: `loop ${loopNo} writes more than one array, and WebGL2 draws one` };
    if (w.kind !== 'affine' || w.a !== 1 || w.c.length !== 1 || w.c[0] !== 0)
      return { noWebgl2: `loop ${loopNo} writes "${w.name}" other than at i` };
    const outParam = arrays.find((p) => p.name === w.name);
    const elem = (outParam?.type as { elem?: ShaderType } | undefined)?.elem;
    const outScalar = elem?.kind === 'scalar' ? elem.scalar : undefined;
    if (
      outParam === undefined ||
      (outScalar !== 'f32' && outScalar !== 'i32' && outScalar !== 'u32')
    )
      return {
        noWebgl2: `loop ${loopNo} writes "${w.name}", whose element is not one f32, i32 or u32`,
      };
    // The invocation's texel is the loop's one ASSIGNMENT to the array (`toTexel` below); a
    // write a call makes through a reference to it (Rule 8.25) is no assignment to take.
    if (writesThroughCall(st, w.name, m))
      return {
        noWebgl2: `loop ${loopNo} writes "${w.name}" through a reference a call takes, and WebGL2 writes its texel by an assignment`,
      };
    const header = rangeOf(st);
    if (header === undefined) return { noWebgl2: `loop ${loopNo} compares its counter oddly` };
    const uniforms = [
      ...scalars.map((p) => ({ name: p.name, type: p.type })),
      { name: '_start', type: header.type },
    ];
    const c: LoopCtx = {
      f,
      loop: st,
      j: loopNo - 1,
      counter: st.counted!.name,
      counterType: header.type,
      step: st.counted!.step,
      prelude: [...prelude],
      scalars: scalars.map((p) => p.name),
      arrays: arrays.map((p) => p.name),
      argsBinding,
      argsStruct,
      scatter: new Set(),
    };
    const vec3uT: ShaderType = { kind: 'vec', n: 3, elem: 'u32' };
    const gidParam: Expr = { op: 'param', type: vec3uT, name: '_gid' };
    const gidX: Expr = { op: 'member', type: u32T, base: gidParam, field: 'x' };
    const dispatchT: ShaderType = { kind: 'vec', n: 4, elem: 'u32' };
    const count: Expr = {
      op: 'member',
      type: u32T,
      base: { op: 'varref', type: dispatchT, name: GL_DISPATCH },
      field: 'x',
    };
    const outT: ShaderType = { kind: 'array', elem: u32T };
    const bits = (e: Expr): Expr =>
      outScalar === 'u32'
        ? e
        : outScalar === 'f32'
          ? { op: 'call', type: u32T, fn: 'bitcastU32', args: [e] }
          : { op: 'call', type: u32T, fn: 'u32', args: [e] };
    // The loop's one write, at `i`, is the invocation's texel.
    const toTexel = (s: Stmt): Stmt => {
      const inner = mapStmtExpr(s, (e) => e, toTexel);
      if (inner.s !== 'assign') return inner;
      let root: Expr = inner.target;
      while (root.op === 'index' || root.op === 'member') root = root.base;
      if (!((root.op === 'varref' || root.op === 'param') && root.name === w.name)) return inner;
      return {
        s: 'assign',
        target: {
          op: 'index',
          type: u32T,
          base: { op: 'varref', type: outT, name: GL_OUT },
          idx: gidX,
        },
        expr: bits(inner.expr),
        ...(inner.span !== undefined ? { span: inner.span } : {}),
      };
    };
    const body: Stmt[] = [
      { s: 'let', name: '_k', expr: gidX },
      {
        s: 'if',
        arms: [
          {
            cond: { op: 'compare', type: boolT, cop: '>=', a: kRef, b: count },
            body: [{ s: 'return' }],
          },
        ],
      },
      ...iterationOf(c, undefined, []).map(toTexel),
    ];
    // What the body reads of the arrays: each is a data texture of its name.
    const read = new Set<string>();
    const names = new Set(arrays.map((p) => p.name));
    const see = (e: Expr): void => {
      if (e.op === 'varref' && names.has(e.name)) read.add(e.name);
      forEachChild(e, see);
    };
    body.forEach((s) =>
      mapStmt(s, (e) => {
        see(e);
        return e;
      }),
    );
    const entry: FuncDecl = {
      name: `${f.name}_gl${loopNo - 1}`,
      params: [{ name: '_gid', type: vec3uT, builtin: 'global_invocation_id' }],
      ret: { kind: 'void' },
      body,
      stage: 'compute',
      portable: true,
      workgroupSize: KERNEL_WORKGROUP,
      attrs: [`@compute @workgroup_size(${KERNEL_WORKGROUP})`],
    };
    const module: ModuleDecl = {
      consts: m.consts,
      structs: [...m.structs, { name: argsStruct, fields: uniforms }],
      bindings: [
        { group: 0, binding: 0, name: GL_DISPATCH, space: 'uniform', type: dispatchT },
        {
          group: 0,
          binding: 1,
          name: argsBinding,
          space: 'uniform',
          type: { kind: 'struct', name: argsStruct },
          owner: 'host',
          glsl: 'loose',
        },
        ...[...read].map((name, k): BindingDecl => ({
          group: 0,
          binding: 2 + k,
          name,
          space: 'storage',
          access: 'read',
          type: arrays.find((p) => p.name === name)!.type,
        })),
        {
          group: 0,
          binding: 2 + read.size,
          name: GL_OUT,
          space: 'storage',
          access: 'read_write',
          type: outT,
        },
      ],
      funcs: [...m.funcs.filter((x) => x.kernel !== true && x.stage === undefined), entry],
      overrides: m.overrides ?? [],
      vars: (m.vars ?? []).filter((x) => x.space !== 'workgroup'),
    };
    plans.push({ module, out: w.name, outScalar, reads: [...read], uniforms });
  }
  if (plans.length === 0) return { noWebgl2: 'it has no loop to draw' };
  return { loops: plans };
}
