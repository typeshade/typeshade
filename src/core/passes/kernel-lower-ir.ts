// Shared kernel plan contracts and IR construction for WebGPU and WebGL2 lowering.
import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/nodes.js';
import type { ShaderType } from '../ir/types.js';
import { u32T } from '../ir/types.js';
import { eachExpr, eachStmtExpr, mapChildren, mapStmtExpr } from '../ir/visit.js';
import { treeIdentity } from '../kernel-tree.js';
import { bin, u } from '../kernel-workgroup.js';
import { EFFECTFUL_INTRINSICS } from './effects.js';
import { combineOf as writeCombine, type LoopReduction } from './parallel-loop.js';

export type ForStmt = Stmt & { s: 'for' };

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
  /** `a*i + c` writes, and reads of an array the loop does not write (`read`, #655), which the
   *  call checks against each array's length first. */
  readonly checks: readonly {
    readonly param: string;
    readonly a: number;
    readonly c: number;
    readonly read?: true;
    /** For a read that stands under comparisons of the counter with a bound (#997): each
     *  comparison and the CPU-tier function that gives its bound. The call checks the read over
     *  the iterations where every comparison holds. Absent when the read stands under none, or
     *  under none whose bound the host can compute. */
    readonly guards?: readonly { readonly cop: '<' | '<=' | '>' | '>='; readonly fn: string }[];
  }[];
  /** The textures the loop stores into at `vec2(i % W, i / W)` (change 0077), each with the
   *  CPU-tier function that returns its `W`, which the call checks against the texture's size
   *  first. */
  readonly texels?: readonly { readonly param: string; readonly width: string }[];
  /** The arrays the loop writes at one index `i*k + b` (the `scaled` form of R3, #775), each
   *  with the CPU-tier functions that give `k` and `b`; the call refuses `k = 0` and an index
   *  past the array's end. Absent when the loop writes none. */
  readonly strides?: readonly {
    readonly param: string;
    readonly coefficient: string;
    readonly base: string;
  }[];
  /** The arrays the loop writes at `i*W + x` over a nested `x < W` (the `row-major` form of R3,
   *  #775), each with the CPU-tier function that gives `W`; the call refuses a last row past the
   *  array's end. Absent when the loop writes none. */
  readonly rows?: readonly { readonly param: string; readonly width: string }[];
  /** The workgroup size the loop's entry runs at: {@link KERNEL_TREE} for a loop that
   *  reduces, {@link KERNEL_WORKGROUP} otherwise. */
  readonly wg: number;
  /** What the loop reduces, when it does: the entry that folds a level of partials, and per
   *  variable the storage binding its partials are in. */
  readonly reduce?: {
    readonly entry: string;
    readonly vars: readonly (LoopReduction & { readonly binding: string })[];
  };
  /** For a loop that pushes onto an array (change 0078): the entry that counts each iteration's
   *  pushes, the entry that scans the counts into offsets and the total, and the storage binding
   *  that holds them, `n + 1` `u32`s. {@link entry} is the entry that stores. */
  readonly push?: { readonly count: string; readonly scan: string; readonly binding: string };
  /** For a loop whose range the device holds (change 0094, part 1): the `@compute` entry of one
   *  invocation that computes the range, and the element of the call's trip buffer it writes at:
   *  the start's bits, the trip count, and the workgroup count `[x, y, 1]` of the loop's entry,
   *  which the call dispatches indirectly. The loop's entry reads its start and trip count there,
   *  and {@link checks} is empty: a write past an array's end is dropped (decision D2). */
  readonly device?: { readonly entry: string; readonly at: number };
  /** The function whose body holds the iteration itself (change 0058): the loop's entry, or, for
   *  a loop that reduces, the helper that runs one iteration from the identity and returns what
   *  it reduced. This and the next two fields are for the fuse record: the call layer reads none
   *  of them, and the face leaves them out of the loops it dispatches. */
  readonly iterates: string;
  /** The index in the body of {@link iterates} of the first statement of the iteration: its
   *  counter. The two statements before it in an entry index the invocation and drop the ones
   *  past the trip count; a helper has none. */
  readonly iteration: number;
  /** Whether the loop's body has a `continue` of its own, which the iteration spells as a
   *  `return`: in an entry it ends the invocation, so it would end whatever a fused entry runs
   *  after it. */
  readonly continues: boolean;
  /** Whether the subgroup variant of the plan (change 0119) folds this loop inside a subgroup:
   *  a reduction every operator of which gives one value in every order, or a scatter whose
   *  writes a lane makes at most once. Absent when the variant runs this loop as the tree and
   *  the per-lane atomics do. */
  readonly subgroupFold?: true;
}

/** What the call of a kernel function dispatches, when the function lowers. */
export interface KernelPlan {
  /** The module the entries are in; a target emits it as WGSL. */
  readonly module: ModuleDecl;
  /** The subgroup variant of {@link module} (change 0119): the same entries and
   *  bindings, with each loop {@link KernelLoopPlan.subgroupFold} marks folded inside a subgroup
   *  first, by the subgroup function of its operator, so it needs the `subgroups` feature. The
   *  bits it writes are the tree's and the atomics'. Absent when no loop has a variant. */
  readonly subgroupModule?: ModuleDecl;
  /** The uniform binding of the scalar parameters, `_start` and `_n`. */
  readonly argsBinding: string;
  readonly argsStruct: string;
  readonly loops: readonly KernelLoopPlan[];
  /** The range functions, the tail and the function of the stores after the loops when there
   *  are, for the CPU tier's code. */
  readonly ranges: readonly FuncDecl[];
  /** The storage binding each array parameter is emitted under, by its authored name (Rule 3.3).
   *  A name the WGSL reserves gets a fresh spelling; the host keeps the authored name. */
  readonly bindingNames: ReadonlyMap<string, string>;
  /** The CPU-tier function that gives the result: the function's parameters, then what the
   *  GPU folded for each reduction in loop order, when the function returns a value. */
  readonly tail?: string;
  /** The stores after the loops (change 0094), when the function has any: `entry`, the
   *  `@compute` entry of one invocation the call dispatches after the loops; `fn`, the CPU-tier
   *  function that runs the same stores over the host's arrays, with the tail's parameters, which
   *  WebGL2 calls after its draws; and the array parameters they write. The entry reads what loop
   *  `j` reduced at slot `_at<j>` of the uniform, `0xffffffff` when the loop ran no iteration. */
  readonly finish?: {
    readonly entry: string;
    readonly fn: string;
    readonly writes: readonly string[];
  };
  /** The length word of each array parameter whose pushes start at a length the device holds
   *  (change 0094), when the function has any: see {@link PushWord}. */
  readonly words?: readonly PushWord[];
  /** The trip buffer of a function with a loop whose range the device holds (change 0094): the
   *  `array<u32>` binding the range entries write, read-write, and the binding of the same buffer
   *  the loops' entries read, read-only, so that one dispatch may also read its workgroup count
   *  from it. Each such loop has {@link TRIP_WORDS} words of it, from its `device.at`. */
  readonly trips?: { readonly write: string; readonly read: string };
  /** Each Map or Set parameter a loop adds to (change 0080): the array the loop pushes a record
   *  onto for each `add` or `set`, in the order a sequential run makes them, and the most records
   *  one iteration pushes. The call makes the array, `n` times that long, and applies the records
   *  to the caller's Map or Set in order, which gives ECMAScript's entries and insertion order. */
  readonly collections?: readonly KernelCollection[];
  /** Each Map or Set parameter a loop reads and no loop adds to (change 0080): the arrays the
   *  call fills from the caller's collection, its keys as order words with their count first,
   *  sorted, and a Map's values in the same order. A loop finds a key by a binary search. */
  readonly lookups?: readonly KernelLookup[];
}

/**
 * The length word of an array parameter that a loop pushes onto (change 0094): one `u32` of a
 * storage binding, which holds the array's length when the call runs. Each loop that pushes onto
 * the array starts its pushes at the word, and its scan step writes the new length into it, so a
 * second loop appends after the first. The call binds the `Resident<Uint32Array>` of a held length
 * there, or a zeroed word of its own when the caller holds none.
 */
export interface PushWord {
  /** The array parameter, by its authored name. */
  readonly param: string;
  /** The `array<u32>` storage binding that holds the word. */
  readonly binding: string;
  /** The field of the call's uniform that holds the element of the binding the word is at. */
  readonly field: string;
  /** The loops that push onto the array, by index: each one's scan step reads the word and
   *  writes the new length into it. */
  readonly loops: readonly number[];
}

/** A Map or Set parameter a loop of a kernel function adds to, as the call collects it. */
export interface KernelCollection {
  /** The parameter's name. */
  readonly param: string;
  /** The array parameter of the lowered function its records are pushed onto. */
  readonly records: string;
  /** The loop that adds to it, by index. */
  readonly loop: number;
  /** The most `add` or `set` calls one iteration makes. */
  readonly perIteration: number;
}

/** A Map or Set parameter the loops read, as the call uploads it (change 0080). */
export interface KernelLookup {
  /** The parameter's name. */
  readonly param: string;
  /** The `array<u32>` of the count, then each key's order word, sorted ({@link orderWord}). */
  readonly keys: string;
  /** A Map's `array<V>` of values, in the order of {@link keys}; absent for a Set. */
  readonly values?: string;
  /** The first loop that reads it, by index. A loop before it may add to it: the call applies
   *  that loop's records first, and uploads what the collection then holds. */
  readonly loop: number;
}

/** What {@link lowerKernel} is asked for beside the function. */
export interface LowerOptions {
  /** Whether every array a loop pushes onto starts its pushes at a length word (change 0094):
   *  the module of a call that passes a held length. Without it, only an array that two loops
   *  push onto, or whose length the stores after the loops read, has a word, so a function whose
   *  pushes start at 0 lowers to the module it always did. */
  readonly held?: boolean;
}

/** How an entry of the function reads a parameter: a scalar as a field of the uniform, an array
 *  as the storage binding of its name, and the length of a pushed array as its length word, when
 *  it has one (change 0094). */
export function entryRewrite(
  c: LoopCtx,
  field: (name: string, type: ShaderType) => Expr = argsOf(c),
): (e: Expr) => Expr {
  const scalarSet = new Set(c.scalars);
  const arraySet = new Set(c.arrays);
  const rewrite = (e: Expr): Expr => {
    if (e.op === 'param' && scalarSet.has(e.name)) return field(e.name, e.type);
    if (e.op === 'param' && arraySet.has(e.name))
      return { op: 'varref', type: e.type, name: c.bindingNames.get(e.name) ?? e.name };
    const pushed = e.op === 'call' && e.fn === 'pushCount' ? e.args[0] : undefined;
    const word = pushed?.op === 'param' ? c.words?.get(pushed.name) : undefined;
    if (word !== undefined)
      return {
        op: 'index',
        type: u32T,
        base: { op: 'varref', type: { kind: 'array', elem: u32T }, name: word.binding },
        idx: field(word.field, u32T),
      };
    return mapChildren(e, rewrite);
  };
  return rewrite;
}

/** Every name the module declares: its functions, structs, fields, module values, and each
 *  parameter and local. A fresh spelling must avoid all of them. */
export function declaredNames(m: ModuleDecl): Set<string> {
  const names = new Set<string>([
    ...m.consts.map((c) => c.name),
    ...m.bindings.map((b) => b.name),
    ...(m.overrides ?? []).map((o) => o.name),
    ...(m.vars ?? []).map((v) => v.name),
    ...m.structs.flatMap((s) => [s.name, ...s.fields.map((x) => x.name)]),
    ...m.funcs.map((x) => x.name),
  ]);
  const collect = (body: readonly Stmt[]): void => {
    for (const st of body) {
      if (st.s === 'let' || st.s === 'var') names.add(st.name);
      mapStmtExpr(
        st,
        (e) => e,
        (child) => {
          collect([child]);
          return child;
        },
      );
    }
  };
  for (const fn of m.funcs) {
    fn.params.forEach((p) => names.add(p.name));
    collect(fn.body);
  }
  return names;
}

/** The emitted storage binding of each array parameter: its own name unless the target reserves
 *  it, then `name_`, `name_1` and so on, avoiding every name the module declares and each other. */
export function spellArrayBindings(
  params: readonly string[],
  declared: ReadonlySet<string>,
  reserved: (name: string) => boolean,
): ReadonlyMap<string, string> {
  const used = new Set(declared);
  const out = new Map<string, string>();
  for (const name of params) {
    if (!reserved(name)) continue;
    for (let i = 0; ; i++) {
      const candidate = i === 0 ? `${name}_` : `${name}_${i}`;
      if (!reserved(candidate) && !used.has(candidate)) {
        used.add(candidate);
        out.set(name, candidate);
        break;
      }
    }
  }
  return out;
}

// ─── one loop's entry ────────────────────────────────────────────────────────────────────────

/** What building one loop's entries reads. */
export interface LoopCtx {
  readonly f: FuncDecl;
  /** The workgroup size of the loop's entry when it does not reduce: `f`'s `@workgroup_size`,
   *  or {@link KERNEL_WORKGROUP}. */
  readonly wg: number;
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
  /** The emitted storage binding of each array parameter (Rule 3.3). */
  readonly bindingNames: ReadonlyMap<string, string>;
  /** Whether a lane past the trip count skips the iteration instead of running the last one with
   *  its writes masked (change 0096, decision D2): see {@link laneSkips}. */
  readonly skip: boolean;
  /** The length word of each pushed array that has one (change 0094), which an entry reads for
   *  the array's length. */
  readonly words?: ReadonlyMap<string, PushWord>;
  /** For a loop whose range the device holds (change 0094, part 1): the read-only binding of the
   *  trip buffer, and the element its start's bits are at, the trip count after it. The entry
   *  reads them there instead of the uniform's `_start` and `_n`. */
  readonly trips?: { readonly binding: string; readonly at: number };
  /** The subgroup variant (change 0119): a loop that reduces folds each subgroup with the
   *  subgroup function of its operator before the workgroup slots. */
  readonly subgroup?: boolean;
  /** The subgroup variant of a map loop that scatters (change 0119): each write is deferred to
   *  the end of the iteration, folded over the lanes of the subgroup that share its key, and one
   *  lane adds the fold. */
  readonly subgroupScatter?: boolean;
}

export const boolT: ShaderType = { kind: 'scalar', scalar: 'bool' };

export const kRef: Expr = { op: 'varref', type: u32T, name: '_k' };

/** Whether the invocation's lane is within the trip count (change 0096). */
export const liveRef: Expr = { op: 'varref', type: boolT, name: '_live' };

/** How an entry's iteration treats a lane past the trip count (change 0096): the invocation it
 *  runs as (`k`), the flag that masks each write of an outer array, texture, atomic or
 *  collection (`mask`), and whether the lane skips the iteration under that flag instead. */
interface Lane {
  readonly k: Expr;
  readonly mask: Expr;
  readonly skip: boolean;
}

/** `sts` with each write that leaves the invocation under `mask`: an assignment whose place is
 *  rooted at a name of `outer`, and a call statement of a builtin with an effect (an atomic, a
 *  `textureStore`, a collection's `add` or `set`). A write to a name the body declares is the
 *  lane's own and stays. */
function maskWrites(sts: readonly Stmt[], mask: Expr, outer: ReadonlySet<string>): Stmt[] {
  const writes = (st: Stmt): boolean => {
    if (st.s === 'assign' || st.s === 'assignOp') {
      const root = placeRoot(st.target);
      return (root.op === 'varref' || root.op === 'param') && outer.has(root.name);
    }
    return st.s === 'call' && st.expr.op === 'call' && EFFECTFUL_INTRINSICS.has(st.expr.fn);
  };
  const visit = (st: Stmt): Stmt =>
    writes(st) ? { s: 'if', arms: [{ cond: mask, body: [st] }] } : mapStmtExpr(st, (e) => e, visit);
  return sts.map(visit);
}

/** Word `k` after a device range's start in the trip buffer an entry reads (change 0094). */
export function tripWord(c: LoopCtx, k: number): Expr {
  return {
    op: 'index',
    type: u32T,
    base: { op: 'varref', type: { kind: 'array', elem: u32T }, name: c.trips!.binding },
    idx: u(c.trips!.at + k),
  };
}

/** The start of a device range, as the counter's type: the trip buffer holds its bits, which
 *  `i32()` of a `u32` reads back unchanged (change 0094). */
function tripStart(c: LoopCtx): Expr {
  const w = tripWord(c, 0);
  const t = c.counterType;
  return t.kind === 'scalar' && t.scalar === 'u32'
    ? w
    : { op: 'call', type: t, fn: typeKey(t), args: [w] };
}

/** The uniform of the call, and one of its fields. */
export function argsOf(c: LoopCtx): (name: string, type: ShaderType) => Expr {
  const args: Expr = {
    op: 'varref',
    type: { kind: 'struct', name: c.argsStruct },
    name: c.argsBinding,
  };
  return (name, type) => ({ op: 'member', type, base: args, field: name });
}

/** The iteration `_k` runs: its counter, the prelude replayed, and the loop's body, with each
 *  parameter a field of the uniform or the binding of its name, and each `continue` of the
 *  loop's own a return of `ret`. With `lane` (change 0096) the counter is the lane's `k`, each
 *  write is masked, and a lane that skips runs the rest under the mask, after the counter. */
export function iterationOf(
  c: LoopCtx,
  ret: Expr | undefined,
  reset: readonly Stmt[],
  lane?: Lane,
): Stmt[] {
  const field = argsOf(c);
  const start = c.trips === undefined ? field('_start', c.counterType) : tripStart(c);
  const kAs: Expr = {
    op: 'call',
    type: c.counterType,
    fn: typeKey(c.counterType),
    args: [lane?.k ?? kRef],
  };
  const stepLit: Expr = { op: 'lit', type: c.counterType, value: Math.abs(c.step) };
  const i: Expr = {
    op: 'binop',
    type: c.counterType,
    bop: c.step < 0 ? '-' : '+',
    a: start,
    b: { op: 'binop', type: c.counterType, bop: '*', a: kAs, b: stepLit },
  };
  // A parameter is a field of the uniform, or the storage binding of its name; the length of a
  // pushed array, which only a loop whose range the device holds reads, is its length word.
  const rewrite = entryRewrite(c, field);
  // The subgroup variant of a scatter (change 0119): each write becomes an assignment of its
  // key and its value to the lane's slots, and the folds after the iteration add them.
  const deferred: DeferredScatter[] = [];
  const body = ownContinuesReturn(c.loop.body, ret);
  let rest = [
    ...c.prelude,
    ...reset,
    ...(c.subgroupScatter === true
      ? deferScatters(body, c.scatter, deferred)
      : body.map((st) => toAtomics(st, c.scatter))),
  ].map((st) => mapStmt(st, rewrite));
  if (lane?.skip === true) rest = [{ s: 'if', arms: [{ cond: lane.mask, body: rest }] }];
  else if (lane !== undefined) {
    const outer = new Set(c.arrays.flatMap((n) => [n, c.bindingNames.get(n) ?? n]));
    rest = maskWrites(rest, lane.mask, outer);
  }
  return [
    { s: 'let', name: c.counter, expr: i },
    ...deferred.flatMap(scatterSlots),
    ...rest,
    ...deferred.flatMap((d) => scatterFold(d).map((st) => mapStmt(st, rewrite))),
    ...(ret !== undefined ? [{ s: 'return', expr: ret } as Stmt] : []),
  ];
}

// ─── the subgroup variant (change 0119) ──────────────────────────────────────────
//
// On a device that has the `subgroups` feature the runtime may dispatch a second text of the
// module, in which a reduction folds each subgroup with the subgroup function of its operator
// before the workgroup slots, and a scatter folds the lanes of a subgroup that share a key
// before one of them adds. Both are emitted only for an operator that gives one value in every
// order, so the bits are the tree's and the per-lane atomics' (Rule 7.2), and a float sum or
// product keeps the tree in both texts.

/** The subgroup function that folds a subgroup with `op` (change 0117, surface §77). */
export const SUBGROUP_FOLD_OF: Readonly<Record<LoopReduction['op'], string>> = {
  '+': 'subgroupAdd',
  '*': 'subgroupMul',
  '&': 'subgroupAnd',
  '|': 'subgroupOr',
  '^': 'subgroupXor',
  min: 'subgroupMin',
  max: 'subgroupMax',
};

/** One deferred write of the scatter variant: its slots, its operator and the array it adds
 *  to, as the write named it (a parameter, which the entry's rewrite binds). */
interface DeferredScatter {
  readonly i: number;
  readonly op: LoopReduction['op'];
  /** The array, typed `array<atomic<T>>`. */
  readonly array: Expr;
  /** `T`, a `u32` or an `i32`. */
  readonly elem: ShaderType;
}

const scatterRef = (d: DeferredScatter, what: 'w' | 'k' | 'v' | 'p'): Expr => ({
  op: 'varref',
  type: what === 'w' || what === 'p' ? boolT : what === 'k' ? u32T : d.elem,
  name: `_sg${what}${d.i}`,
});

/** `sts` with each write into an array of `scatter` replaced by the assignment of the lane's
 *  slots: whether it wrote (`_live`, so a lane past the trip count adds nothing), the key as a
 *  `u32`, and the value. Nested statements too. */
function deferScatters(
  sts: readonly Stmt[],
  scatter: ReadonlySet<string>,
  deferred: DeferredScatter[],
): Stmt[] {
  return mapBlock(sts, (st): Stmt[] | undefined => {
    if (st.s !== 'assign' && st.s !== 'assignOp') return undefined;
    const t = st.target;
    if (t.op !== 'index' || t.base.op !== 'param' || !scatter.has(t.base.name)) return undefined;
    const combine = writeCombine(st).combine;
    if (combine === undefined) return undefined;
    const at = atomicArray(t.base.type);
    const d: DeferredScatter = {
      i: deferred.length,
      op: combine.op,
      array: { ...t.base, type: at },
      elem: { kind: 'scalar', scalar: (at as { elem: { elem: 'u32' | 'i32' } }).elem.elem },
    };
    deferred.push(d);
    const key: Expr =
      t.idx.type.kind === 'scalar' && t.idx.type.scalar === 'u32'
        ? t.idx
        : { op: 'call', type: u32T, fn: 'u32', args: [t.idx] };
    return [
      { s: 'assign', target: scatterRef(d, 'w'), expr: liveRef },
      { s: 'assign', target: scatterRef(d, 'k'), expr: key },
      { s: 'assign', target: scatterRef(d, 'v'), expr: combine.with },
    ];
  });
}

/** The identity of `op` in `elem`, as a literal. */
function scatterIdentity(d: DeferredScatter): Expr {
  const scalar = (d.elem as { scalar: 'u32' | 'i32' }).scalar;
  return { op: 'lit', type: d.elem, value: treeIdentity(d.op, scalar) as number };
}

/** The slots of a deferred write, before the iteration: nothing written, key 0, the identity. */
function scatterSlots(d: DeferredScatter): Stmt[] {
  return [
    { s: 'var', name: `_sgw${d.i}`, type: boolT, init: { op: 'lit', type: boolT, value: false } },
    { s: 'var', name: `_sgk${d.i}`, type: u32T, init: u(0) },
    { s: 'var', name: `_sgv${d.i}`, type: d.elem, init: scatterIdentity(d) },
  ];
}

/** The fold of a deferred write, after the iteration, in uniform control flow: while a lane of
 *  the subgroup still has a write pending, the pending lanes' least key is served: the lanes
 *  that hold it fold their values with the subgroup function of the operator (the others give
 *  the identity), one lane adds the fold to the element with the atomic, and those lanes are
 *  done. Each turn serves one distinct key, so a subgroup whose keys are all equal takes one
 *  atomic in place of one per lane, and the loop is bounded by the subgroup size. */
function scatterFold(d: DeferredScatter): Stmt[] {
  const w = scatterRef(d, 'w');
  const k = scatterRef(d, 'k');
  const v = scatterRef(d, 'v');
  const p = scatterRef(d, 'p');
  const j: Expr = { op: 'varref', type: u32T, name: `_sgj${d.i}` };
  const key: Expr = { op: 'varref', type: u32T, name: `_sgkey${d.i}` };
  const mine: Expr = { op: 'varref', type: boolT, name: `_sgm${d.i}` };
  const sum: Expr = { op: 'varref', type: d.elem, name: `_sgs${d.i}` };
  const atomicT = (d.array.type as { elem: ShaderType }).elem;
  const none = u(0xffffffff);
  return [
    { s: 'var', name: `_sgp${d.i}`, type: boolT, init: w },
    {
      s: 'for',
      init: { s: 'var', name: `_sgj${d.i}`, type: u32T, init: u(0) },
      cond: { op: 'compare', type: boolT, cop: '<', a: j, b: u(SUBGROUP_MAX) },
      update: { s: 'assign', target: j, expr: bin('+', j, u(1)) },
      body: [
        {
          s: 'if',
          arms: [
            {
              cond: { op: 'call', type: boolT, fn: 'subgroupAny', args: [p] },
              body: [
                {
                  s: 'let',
                  name: `_sgkey${d.i}`,
                  expr: {
                    op: 'call',
                    type: u32T,
                    fn: 'subgroupMin',
                    args: [{ op: 'select', type: u32T, cond: p, ifTrue: k, ifFalse: none }],
                  },
                },
                {
                  s: 'let',
                  name: `_sgm${d.i}`,
                  expr: {
                    op: 'logical',
                    type: boolT,
                    lop: '&&',
                    a: p,
                    b: { op: 'compare', type: boolT, cop: '==', a: k, b: key },
                  },
                },
                {
                  s: 'let',
                  name: `_sgs${d.i}`,
                  expr: {
                    op: 'call',
                    type: d.elem,
                    fn: SUBGROUP_FOLD_OF[d.op],
                    args: [
                      {
                        op: 'select',
                        type: d.elem,
                        cond: mine,
                        ifTrue: v,
                        ifFalse: scatterIdentity(d),
                      },
                    ],
                  },
                },
                {
                  s: 'if',
                  arms: [
                    {
                      cond: { op: 'call', type: boolT, fn: 'subgroupElect', args: [] },
                      body: [
                        {
                          s: 'call',
                          expr: {
                            op: 'call',
                            type: d.elem,
                            fn: ATOMIC_OF[d.op]!,
                            args: [{ op: 'index', type: atomicT, base: d.array, idx: key }, sum],
                          },
                        },
                      ],
                    },
                  ],
                },
                {
                  s: 'assign',
                  target: p,
                  expr: {
                    op: 'select',
                    type: boolT,
                    cond: mine,
                    ifTrue: { op: 'lit', type: boolT, value: false },
                    ifFalse: p,
                  },
                },
              ],
            },
          ],
          elseBody: [{ s: 'break' }],
        },
      ],
    },
  ];
}

/** The most lanes a WGSL subgroup has: the fold's loop serves at least one key a turn, so it
 *  ends within this many turns. */
const SUBGROUP_MAX = 128;

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
export function mapStmt(st: Stmt, f: (e: Expr) => Expr): Stmt {
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

export const ATOMIC_OF: Readonly<Record<string, string>> = {
  '+': 'atomicAdd',
  '&': 'atomicAnd',
  '|': 'atomicOr',
  '^': 'atomicXor',
  min: 'atomicMin',
  max: 'atomicMax',
};

/** `array<T>` as `array<atomic<T>>`, the same bytes. */
export function atomicArray(t: ShaderType): ShaderType {
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

// ─── the loop's range ────────────────────────────────────────────────────────────────────────

/** The loop's start, its bound, the comparison between them and the counter's type. */
export function rangeOf(
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

export function typeKey(t: ShaderType): string {
  return t.kind === 'scalar' ? t.scalar : t.kind;
}

/** `sts` with each statement `f` maps to the statements it gives, in nested bodies too. */
export function mapBlock(sts: readonly Stmt[], f: (st: Stmt) => Stmt[] | undefined): Stmt[] {
  const block = (b: readonly Stmt[]): Stmt[] => mapBlock(b, f);
  return sts.flatMap((st): Stmt[] => {
    const own = f(st);
    if (own !== undefined) return own;
    switch (st.s) {
      case 'if':
        return [
          {
            ...st,
            arms: st.arms.map((a) => ({ ...a, body: block(a.body) })),
            ...(st.elseBody !== undefined ? { elseBody: block(st.elseBody) } : {}),
          },
        ];
      case 'for':
        return [{ ...st, body: block(st.body) }];
      case 'switch':
        return [
          {
            ...st,
            cases: st.cases.map((c) => ({ ...c, body: block(c.body) })),
            ...(st.defaultBody !== undefined ? { defaultBody: block(st.defaultBody) } : {}),
          },
        ];
      default:
        return [st];
    }
  });
}

/** The root a written place names: `out` for `out[i].pos`. */
export function placeRoot(e: Expr): Expr {
  return e.op === 'index' || e.op === 'member' ? placeRoot(e.base) : e;
}

export function forEachChild(e: Expr, f: (c: Expr) => void): void {
  mapChildren(e, (c) => {
    f(c);
    return c;
  });
}

// ─── what the call can bind ──────────────────────────────────────────────────────────────────

export const isRuntimeArray = (t: ShaderType): boolean =>
  t.kind === 'array' && t.size === undefined;

/**
 * Lower kernel function `f`'s loops for the WebGL2 tier, or say why it cannot run there.
 *
 * WebGL2 has no compute stage and no storage buffer; the fragment lowering the compute runner
 * uses takes a loop that writes one array of 4-byte elements (`f32`, `i32`, `u32`) at exactly
 * `i`, reads others as data textures, and takes its scalars as uniforms. Each such loop is one
 * program; every other shape goes to the next tier.
 */
/** Whether a call in `loop` hands an element of `array` to a parameter its callee writes
 *  through, `bump(out[i])` to an `@inout` parameter (Rule 8.25). */
export function writesThroughCall(loop: Stmt, array: string, m: ModuleDecl): boolean {
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
