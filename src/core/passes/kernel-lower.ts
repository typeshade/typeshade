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
//     are read only by their `.length`, so the call hands it the lengths alone. A loop whose range
//     reads an element, or the length of an array an earlier loop pushed onto, has a range the
//     device holds (change 0094, part 1): a range entry of one invocation computes it into a trip
//     buffer, the loop's entry reads its start and trip count there, and the call dispatches it
//     indirectly. WebGL2 runs the same range function over the host copies of the arrays. Such a
//     loop that pushes or reduces has a cap in its bound, `min(d, c)` (decision D6, `capOf`): a
//     CPU-tier function gives its start and `c`, for which the call sizes the loop's scratch. The
//     range entry then also writes how many partials each fold level of a reduction folds and its
//     workgroups, a fold level reads its count there, and the scan of a push reads the trip count
//     there and writes the length after the loop into it (stage 4).
//
// Each invocation takes one iteration: `i = start + k * step` for the `k`th. It replays the
// scalar statements before the loop, which write only its own locals (the body's shape, Rule
// 8.22), and a `continue` of the loop's own becomes its `return`.
//
// A lane past the trip count does not return early (change 0096, Rule 8.22): a workgroup wholly
// past the trip count returns as one, on a condition every invocation of it shares, and in the
// workgroup that holds the last iteration a lane past the trip count runs iteration `n - 1`,
// with its index clamped and every write of the iteration masked by its `_live` flag, so that
// every lane of the workgroup runs the same control flow (`docs/hardware-notes.md`, A1). Where
// the clamped lane would read what another lane of the dispatch writes, it skips the iteration
// under the same flag instead (`laneSkips`, decision D2).
//
// A loop that reduces (`s += xs[i]`) runs at a workgroup of 256 in the tree order (Rule 7.2,
// `core/kernel-tree.ts`): each invocation runs its iteration in a helper that starts the
// variable from the identity and returns what it holds; the workgroup folds the 256 values by
// the tree into one partial per workgroup, and a second entry folds the partials the same way,
// one dispatch per level, until one is left. The call then runs the tail on the CPU tier: the
// function's body with each loop replaced by combining its variables with what the GPU folded,
// which gives the function's result.
//
// After its last loop a function may store into elements of its arrays (change 0094): the stores
// run in a finish entry of one invocation, which the call dispatches after the loops. It replays
// the scalar statements, combines what each loop reduced with what the GPU folded, as the tail
// does, and runs the stores, each guarded by its array's length (`kernel-stores.ts`). A function
// with no loop and such stores lowers to that entry alone (decision D7).
//
// A loop that pushes (change 0078) runs in three entries, a count, a scan in one workgroup of 256
// and a store (`pushEntries`). An array that two loops push onto, or whose length the stores
// after the loops read, has a length word (change 0094): one `u32` of a storage binding, at the
// element a field of the uniform names. The first invocation of each scan starts the offsets at
// it and writes the new length into it, and the entry that stores reads it. A call that passes a
// held length runs the module lowered with `held`, in which every pushed array has its word;
// without it, a function whose arrays need none lowers to the module it always did.
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
import { EFFECTFUL_INTRINSICS, fnReads, fnWrites } from './effects.js';
import {
  combineOf as writeCombine,
  proveKernels,
  type KernelProof,
  type LoopReduction,
} from './parallel-loop.js';
import { KERNEL_TREE, KERNEL_WORKGROUP, treeIdentity } from '../kernel-tree.js';
import { deviceRangeLoops, lastLoopOf, readsElements, storeAfterLoops } from './kernel-stores.js';
import {
  bin,
  invocationIndex,
  kernelWorkgroups,
  u,
  vec3u,
  workgroupFirst,
  x,
  y,
  nwg,
} from '../kernel-workgroup.js';

import { WGSL_RESERVED } from '../reserved-words.js';
import { isGlslReserved } from '../backends/glsl-sanitize.js';

export { KERNEL_WORKGROUP };

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
  /** The textures the loop stores into at `vec2(i % W, i / W)` (change 0077), each with the
   *  CPU-tier function that returns its `W`, which the call checks against the texture's size
   *  first. */
  readonly texels?: readonly { readonly param: string; readonly width: string }[];
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
   *  and {@link checks} is empty: a write past an array's end is dropped (decision D2). For a loop
   *  that pushes or reduces (stage 4), `cap` is the CPU-tier function that returns its start and
   *  the `c` of its bound `min(d, c)` (decision D6), for which the call sizes its scratch; the
   *  range entry also writes the workgroup count of each fold level of a reduction. */
  readonly device?: { readonly entry: string; readonly at: number; readonly cap?: string };
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
}

/** What the call of a kernel function dispatches, when the function lowers. */
export interface KernelPlan {
  /** The module the entries are in; a target emits it as WGSL. */
  readonly module: ModuleDecl;
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

/** Lower kernel function `f` of `m`, whose loops `proof` judged, or say why it runs on the CPU. */
export function lowerKernel(
  f: FuncDecl,
  m: ModuleDecl,
  proof: KernelProof,
  options: LowerOptions = {},
): KernelPlan | { readonly noGpu: string } {
  if (proof.shape !== undefined)
    return { noGpu: "its body is not the kernel call's shape (TS8070)" };
  // The stores after the last loop (change 0094), which the front end guards by each array's
  // length (`kernel-stores.ts`); in a function with no loop, every store (decision D7).
  const arrayNames = new Set(f.params.filter((p) => isRuntimeArray(p.type)).map((p) => p.name));
  const lastLoop = lastLoopOf(f.body);
  const stores = f.body.flatMap((st, i) => {
    const found = i > lastLoop ? storeAfterLoops(st, arrayNames) : undefined;
    return found !== undefined ? [found] : [];
  });
  // A Map or a Set (change 0080): each add or set pushes a record, which the call applies.
  const collection = f.params.find((p) => p.type.kind === 'collection');
  if (collection !== undefined && stores.length > 0)
    return {
      noGpu: `it takes the ${collection.type.kind === 'collection' && collection.type.value === undefined ? 'Set' : 'Map'} "${collection.name}" and stores into an array after its loops`,
    };
  // A loop whose range the device holds (change 0094, part 1).
  const device = deviceRangeLoops(f);
  // A Map or a Set is uploaded, and its records sized, from trip counts the host knows.
  if (collection !== undefined && device.size > 0)
    return {
      noGpu: `it takes the ${collection.type.kind === 'collection' && collection.type.value === undefined ? 'Set' : 'Map'} "${collection.name}", and loop ${[...device][0]! + 1} reads its trip count from an array`,
    };
  if (collection !== undefined) return lowerCollections(f, m);
  const loops = f.body.filter((s): s is ForStmt => s.s === 'for');
  if (loops.length === 0 && stores.length === 0) return { noGpu: 'it has no loop to dispatch' };
  for (const v of proof.loops) {
    if (!v.ok) return { noGpu: 'a loop of it runs on the CPU (TS8070)' };
    for (const r of v.reductions) {
      const why = notReducible(r.type);
      if (why !== undefined) return { noGpu: `it reduces "${r.name}", ${why}` };
    }
  }
  // A loop that pushes (change 0078) runs on WebGPU in three steps: count, scan, store. The
  // first step runs the iteration only to count, so it may write nothing the iteration reads.
  for (const [j, v] of proof.loops.entries()) {
    const why = v.ok ? pushGap(v, j) : undefined;
    if (why !== undefined) return { noGpu: why };
  }
  // The loops that push onto each array, in order (change 0078). A second loop appends after the
  // first: both start at the array's length word, which each one's scan step advances (change
  // 0094, which closes deviation 3 of change 0078).
  const pushers = new Map<string, number[]>();
  for (const [j, v] of proof.loops.entries())
    for (const w of v.ok ? v.writes : [])
      if (w.kind === 'append') pushers.set(w.name, [...(pushers.get(w.name) ?? []), j]);
  // The length of a pushed array (`pushCount`) is known once its loops have run: the result reads
  // it, and so may a statement after the last loop, which the entry that stores after the loops
  // reads from the array's length word (change 0094). A loop, or a statement before the last
  // loop, would read it before the call knows it.
  // A statement before a later loop, or that loop's header, may read it too, when every loop that
  // pushes onto the array comes before the statement: the later loop's range is then the device's,
  // and its range entry reads the array's length word (change 0094, part 1).
  if (earlyPushCount(f.body, pushers))
    return {
      noGpu:
        'it reads the length of an array it pushes onto before its result, which the call knows once the loop has run',
    };
  const textures = f.params.filter((p) => isTextureParam(p.type));
  const scalars = f.params.filter((p) => !isRuntimeArray(p.type) && !isTextureParam(p.type));
  const arrays = f.params.filter((p) => isRuntimeArray(p.type));
  // A kernel call binds a texture_2d<f32> it reads and a 2D storage texture (change 0077).
  for (const p of textures)
    if (
      !(p.type.kind === 'texture' && p.type.dim === '2d' && p.type.elem === 'f32') &&
      !(p.type.kind === 'storage-texture' && p.type.dim === '2d')
    )
      return {
        noGpu: `parameter "${p.name}" is a texture a kernel call does not bind: it binds a texture_2d<f32> and a 2D storage texture`,
      };
  const textureNames = new Set(textures.map((p) => p.name));
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
  // The length word of each pushed array that needs one (change 0094): every pushed array for a
  // call that passes a held length; otherwise an array two loops push onto, and one whose length
  // a statement after the last loop reads when the entry that stores after the loops replays it.
  const afterLoops = f.body.slice(lastLoop + 1).filter((st) => st.s !== 'return');
  const lengthsRead = new Set([
    ...(stores.length > 0 ? pushCountsIn(afterLoops) : []),
    // A length a later loop's range reads (change 0094, part 1).
    ...pushCountsBetween(f.body),
  ]);
  const declared = declaredNames(m);
  const words: PushWord[] = [];
  const wordOf = new Map<string, PushWord>();
  for (const [k, name] of arrays
    .map((p) => p.name)
    .filter((n) => pushers.has(n))
    .entries()) {
    const loops = pushers.get(name)!;
    if (options.held !== true && loops.length < 2 && !lengthsRead.has(name)) continue;
    const binding = `${f.name}_len${String(k)}`;
    if (taken.has(binding) || declared.has(binding))
      return {
        noGpu: `the module already declares "${binding}", the name of the length word of "${name}"`,
      };
    const word: PushWord = { param: name, binding, field: `_off${String(k)}`, loops };
    words.push(word);
    wordOf.set(name, word);
  }

  // The trip buffer (change 0094, part 1): the range entries write it, and the loops' entries
  // read it, under two bindings of one buffer.
  let trips: { readonly write: string; readonly read: string } | undefined;
  if (device.size > 0) {
    trips = { write: `${f.name}_trips`, read: `${f.name}_tripsIn` };
    for (const n of [trips.write, trips.read])
      if (taken.has(n) || declared.has(n))
        return { noGpu: `the module already declares "${n}", the name of the call's trip buffer` };
  }

  // Rule 3.3: a storage binding is the WGSL name of an array parameter, and WGSL reserves some
  // of the names an author may give one. Only the emitted spelling changes: the face, the
  // loops' facts and the errors keep the authored name.
  const bindingNames = spellArrayBindings(
    [...arrays, ...textures].map((p) => p.name),
    new Set([
      ...declared,
      ...words.map((w) => w.binding),
      ...(trips !== undefined ? [trips.write, trips.read] : []),
    ]),
    (name) => WGSL_RESERVED.has(name),
  );
  const plans: KernelLoopPlan[] = [];
  const entries: FuncDecl[] = [];
  const ranges: FuncDecl[] = [];
  const extraStructs: StructDecl[] = [];
  const extraVars: ModuleVarDecl[] = [];
  const partBindings: { name: string; type: ShaderType }[] = [];
  const prelude: Stmt[] = [];
  let loopIndex = 0;
  // Where each loop's words of the trip buffer start (change 0094): eight a loop, and the room
  // for the fold levels of a loop that reduces over a range the device holds (stage 4).
  let tripAt = 0;
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
    // A range that reads only the arrays' `.length` is the host's: the call hands the range
    // function the lengths. One that reads an element, or a pushed array's length, is the
    // device's (change 0094, part 1): a range entry computes it, and the call dispatches the
    // loop indirectly from the counts the entry writes.
    const onDevice = device.has(j);
    // The CPU tier has no texture memory yet, so what the call computes there names none.
    const before = firstName(
      [
        ...prelude,
        { s: 'call', expr: header.start } as Stmt,
        { s: 'call', expr: header.bound } as Stmt,
      ],
      textureNames,
    );
    if (before !== undefined)
      return {
        noGpu: `the statements before loop ${j + 1} read the texture "${before}", which the call runs before it dispatches`,
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
    // The cap of a loop that pushes or reduces over a range the device holds (decision D6): the
    // CPU-tier function that returns its start and the `c` of its bound `min(d, c)`, from which
    // the call sizes the loop's scratch before anything runs.
    const sized =
      onDevice && v.ok && (v.reductions.length > 0 || v.writes.some((w) => w.kind === 'append'));
    const capped = sized ? capOf(header, prelude, new Set(arrays.map((p) => p.name))) : undefined;
    if (onDevice && v.ok) {
      const why = deviceGap(v, j, st, prelude, m, capped !== undefined);
      if (why !== undefined) return { noGpu: why };
    }
    let cap: FuncDecl | undefined;
    if (capped !== undefined) {
      cap = {
        name: `${f.name}__cap${j}`,
        params: f.params,
        ret: range.ret,
        body: [
          {
            s: 'return',
            expr: {
              op: 'construct',
              type: range.ret,
              args: [capped.start, capped.cap],
            },
          },
        ],
        kernel: true,
      };
      ranges.push(cap);
    }
    const at = tripAt;
    tripAt += TRIP_WORDS + (onDevice && v.ok && v.reductions.length > 0 ? 4 * TRIP_FOLDS : 0);
    const written = new Set<string>();
    if (v.ok) for (const w of v.writes) written.add(w.name);
    // A loop whose range the device holds is checked by no host: its writes past an array's end
    // are dropped on every tier, by the guard the front end gave them (decision D2).
    const checks: KernelLoopPlan['checks'][number][] = [];
    if (v.ok && !onDevice)
      for (const w of v.writes)
        if (w.kind === 'affine' && arrays.some((p) => p.name === w.name))
          for (const c of w.c) checks.push({ param: w.name, a: w.a, c });
    // Each texture the loop stores into, with the function that gives its row width `W`.
    const texels: NonNullable<KernelLoopPlan['texels']>[number][] = [];
    if (v.ok)
      for (const w of v.writes) {
        if (w.kind !== 'texel' || !textureNames.has(w.name)) continue;
        const reads = firstName([...prelude, { s: 'call', expr: w.width } as Stmt], textureNames);
        if (reads !== undefined)
          return {
            noGpu: `the row width loop ${j + 1} stores "${w.name}" at reads the texture "${reads}"`,
          };
        const width: FuncDecl = {
          name: `${f.name}__texel${j}_${texels.length}`,
          params: f.params,
          ret: w.width.type,
          body: [...prelude, { s: 'return', expr: w.width }],
          kernel: true,
        };
        ranges.push(width);
        texels.push({ param: w.name, width: width.name });
      }
    const reductions = v.ok ? v.reductions : [];
    for (const r of reductions) reduced.add(r.name);
    const loopCtx: LoopCtx = {
      bindingNames,
      f,
      wg: kernelWorkgroups.get(f) ?? KERNEL_WORKGROUP,
      loop: st,
      j,
      counter: counted.name,
      counterType: header.type,
      step: counted.step,
      prelude,
      scalars: scalars.map((p) => p.name),
      arrays: [...arrays, ...textures].map((p) => p.name),
      argsBinding,
      argsStruct,
      scatter,
      skip: v.ok && laneSkips(v, st.body, new Set(arrays.map((p) => p.name))),
      words: wordOf,
      ...(onDevice ? { trips: { binding: trips!.read, at }, tripsWrite: trips!.write } : {}),
    };
    // The range entry of a loop whose range the device holds (change 0094, part 1).
    let rangeEntry: FuncDecl | undefined;
    if (onDevice) {
      rangeEntry = rangeEntryFor(
        loopCtx,
        header,
        trips!.write,
        reductions.length > 0 ? KERNEL_TREE : loopCtx.wg,
        reductions.length > 0,
      );
      entries.push(rangeEntry);
    }
    const common = {
      range: range.name,
      cop: header.cop,
      step: counted.step,
      writes: [...written].filter((n) => arrays.some((p) => p.name === n)),
      checks,
      // Absent when the loop stores into no texture, so a face without one is the face it was.
      ...(texels.length > 0 ? { texels } : {}),
      ...(rangeEntry !== undefined
        ? {
            device: { entry: rangeEntry.name, at, ...(cap !== undefined ? { cap: cap.name } : {}) },
          }
        : {}),
    };
    const continues = hasOwnContinue(st.body);
    const pushedOnto = v.ok ? v.writes.find((w) => w.kind === 'append')?.name : undefined;
    if (pushedOnto !== undefined) {
      const lowered = pushEntries(
        loopCtx,
        pushedOnto,
        new Set(arrays.map((p) => p.name)),
        wordOf.get(pushedOnto),
      );
      entries.push(...lowered.funcs);
      extraVars.push(lowered.workgroup);
      partBindings.push({ name: lowered.binding, type: u32T });
      plans.push({
        ...common,
        entry: lowered.store,
        wg: loopCtx.wg,
        push: { count: lowered.count, scan: lowered.scan, binding: lowered.binding },
        iterates: lowered.store,
        iteration: lowered.iteration,
        continues,
      });
      continue;
    }
    if (reductions.length === 0) {
      const { entry, iteration } = entryFor(loopCtx);
      entries.push(entry);
      plans.push({
        ...common,
        entry: entry.name,
        wg: loopCtx.wg,
        iterates: entry.name,
        iteration,
        continues,
      });
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
      iterates: lowered.iterate,
      iteration: 0,
      continues,
    });
  }

  // The tail: the body with each loop replaced by combining what it reduced, and its return.
  let tail: FuncDecl | undefined;
  if (f.ret.kind !== 'void') {
    const folded: { name: string; type: ShaderType }[] = [];
    const pushCounts = new Map<string, string>();
    let k = 0;
    const body: Stmt[] = [];
    for (const st of f.body) {
      if (st.s !== 'for') {
        // A store after the loops is the finish entry's (change 0094): the result reads none.
        if (storeAfterLoops(st, arrayNames) === undefined) body.push(st);
        continue;
      }
      const v = proof.loops[k++]!;
      for (const r of v.ok ? v.reductions : []) {
        const t = { name: `_t${k - 1}_${r.name}`, type: r.type };
        folded.push(t);
        body.push(combineInto(r, { op: 'param', type: r.type, name: t.name }));
      }
      // The count a loop pushed, which the call reads back (change 0078).
      const pushed = v.ok ? v.writes.find((w) => w.kind === 'append')?.name : undefined;
      if (pushed !== undefined) {
        const t = { name: `_t${k - 1}_push_${pushed}`, type: u32T };
        folded.push(t);
        pushCounts.set(pushed, t.name);
      }
    }
    // `out.length` of a pushed array reads the count the loop pushed.
    const counted = (e: Expr): Expr => {
      const x = mapChildren(e, counted);
      const p = x.op === 'call' && x.fn === 'pushCount' ? x.args[0] : undefined;
      const t = p?.op === 'param' ? pushCounts.get(p.name) : undefined;
      return t === undefined ? x : { op: 'param', type: u32T, name: t };
    };
    body.splice(0, body.length, ...body.map((st) => mapStmt(st, counted)));
    if (
      !readsArraysByLengthOnly(
        body,
        arrays.map((p) => p.name),
      )
    )
      return {
        noGpu: "its result reads an array's elements, which the call computes on the CPU tier",
      };
    const named = firstName(body, textureNames);
    if (named !== undefined)
      return {
        noGpu: `its result reads the texture "${named}", which the call computes on the CPU tier`,
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

  // The stores after the loops (change 0094): one entry of one invocation, which the call
  // dispatches after the loops' dispatches, replays the function's scalar statements in order,
  // combines each variable a loop reduced with what the GPU folded, as the tail does, and runs
  // the stores, each guarded by its array's length. The CPU-tier function of the same body is
  // what WebGL2 runs over the host's arrays after its draws.
  let finish: KernelPlan['finish'];
  const atFields: { name: string; type: ShaderType }[] = [];
  if (stores.length > 0) {
    const replayed = f.body.filter((st) => st.s !== 'for' && st.s !== 'return');
    const atomic = firstName(replayed, scatter);
    if (atomic !== undefined)
      return {
        noGpu: `a statement after its loops reaches "${atomic}", which a loop scatters into: an atomic is read and written only by an atomic`,
      };
    const texture = firstName(replayed, textureNames);
    if (texture !== undefined)
      return { noGpu: `a statement after its loops reads the texture "${texture}"` };
    const args: Expr = {
      op: 'varref',
      type: { kind: 'struct', name: argsStruct },
      name: argsBinding,
    };
    const field = (name: string, type: ShaderType): Expr => ({
      op: 'member',
      type,
      base: args,
      field: name,
    });
    const scalarSet = new Set(scalars.map((p) => p.name));
    const arraySet = new Set(arrays.map((p) => p.name));
    const rewrite = (e: Expr): Expr => {
      if (e.op === 'param' && scalarSet.has(e.name)) return field(e.name, e.type);
      if (e.op === 'param' && arraySet.has(e.name))
        return { op: 'varref', type: e.type, name: bindingNames.get(e.name) ?? e.name };
      // The length of a pushed array is its length word, which the loops' scan steps advanced
      // (change 0094).
      const pushed = e.op === 'call' && e.fn === 'pushCount' ? e.args[0] : undefined;
      if (pushed?.op === 'param') {
        const word = wordOf.get(pushed.name)!;
        return {
          op: 'index',
          type: u32T,
          base: { op: 'varref', type: { kind: 'array', elem: u32T }, name: word.binding },
          idx: field(word.field, u32T),
        };
      }
      return mapChildren(e, rewrite);
    };
    const gpuBody: Stmt[] = [];
    const cpuBody: Stmt[] = [];
    const folded: { name: string; type: ShaderType }[] = [];
    let j = 0;
    for (const st of f.body) {
      if (st.s === 'return') continue;
      if (st.s !== 'for') {
        gpuBody.push(mapStmt(st, rewrite));
        cpuBody.push(st);
        continue;
      }
      const v = proof.loops[j]!;
      const vars = plans[j]!.reduce?.vars ?? [];
      const at = field(`_at${String(j)}`, u32T);
      if (vars.length > 0) atFields.push({ name: `_at${String(j)}`, type: u32T });
      for (const [i, r] of (v.ok ? v.reductions : []).entries()) {
        const local = `_f${String(j)}_${r.name}`;
        const part: Expr = {
          op: 'index',
          type: r.type,
          base: { op: 'varref', type: { kind: 'array', elem: r.type }, name: vars[i]!.binding },
          idx: at,
        };
        gpuBody.push(
          { s: 'var', name: local, type: r.type, init: identityOf(r) },
          {
            s: 'if',
            arms: [
              {
                cond: { op: 'compare', type: boolT, cop: '!=', a: at, b: u(0xffffffff) },
                body: [
                  { s: 'assign', target: { op: 'varref', type: r.type, name: local }, expr: part },
                ],
              },
            ],
          },
          combineInto(r, { op: 'varref', type: r.type, name: local }),
        );
        const t = { name: `_t${String(j)}_${r.name}`, type: r.type };
        folded.push(t);
        cpuBody.push(combineInto(r, { op: 'param', type: r.type, name: t.name }));
      }
      j++;
    }
    const entry = computeEntry(`${f.name}_finish`, gpuBody, false, 1);
    entries.push(entry);
    const fn: FuncDecl = {
      name: `${f.name}__finish`,
      params: [...f.params, ...folded],
      ret: { kind: 'void' },
      body: cpuBody,
      kernel: true,
    };
    ranges.push(fn);
    finish = {
      entry: entry.name,
      fn: fn.name,
      writes: [...new Set(stores.map((s) => s.array))],
    };
  }

  const argsDecl: StructDecl = {
    name: argsStruct,
    fields: [
      ...scalars.map((p) => ({ name: p.name, type: p.type })),
      // A function with no loop (change 0094, decision D7) counts nothing: its `_start` is a
      // `u32` the finish entry never reads.
      { name: '_start', type: counterType ?? u32T },
      { name: '_n', type: u32T },
      // Where a level of partials starts, and where the next is written.
      ...(partBindings.length > 0
        ? [
            { name: '_in', type: u32T },
            { name: '_out', type: u32T },
          ]
        : []),
      // Where the finish entry reads what each loop that reduces folded (change 0094).
      ...atFields,
      // The element of each length word's binding the word is at (change 0094).
      ...words.map((w) => ({ name: w.field, type: u32T })),
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
      name: bindingNames.get(p.name) ?? p.name,
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
    // Each texture parameter is a handle binding of its own type (change 0077).
    ...textures.map((p, k): BindingDecl => ({
      group: 0,
      binding: arrays.length + 1 + partBindings.length + k,
      name: bindingNames.get(p.name) ?? p.name,
      space: 'uniform',
      type: p.type,
    })),
    // The trip buffer's two bindings (change 0094, part 1), before the length words, so that the
    // second WGSL text of a call that passes a held length binds them where the first does.
    ...(trips !== undefined
      ? [
          {
            group: 0,
            binding: arrays.length + 1 + partBindings.length + textures.length,
            name: trips.write,
            space: 'storage',
            access: 'read_write',
            type: { kind: 'array', elem: u32T },
          } satisfies BindingDecl,
          {
            group: 0,
            binding: arrays.length + 2 + partBindings.length + textures.length,
            name: trips.read,
            space: 'storage',
            access: 'read',
            type: { kind: 'array', elem: u32T },
          } satisfies BindingDecl,
        ]
      : []),
    // Each length word's binding (change 0094), after every other, so that a module with words
    // binds the others where the module without them does.
    ...words.map((w, k): BindingDecl => ({
      group: 0,
      binding:
        arrays.length +
        1 +
        partBindings.length +
        textures.length +
        (trips !== undefined ? 2 : 0) +
        k,
      name: w.binding,
      space: 'storage',
      access: 'read_write',
      type: { kind: 'array', elem: u32T },
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
    if (entries.some((e) => readsOutsideAtomics(e.body, bindingNames.get(name) ?? name)))
      return {
        noGpu: `a loop reads "${name}", which a loop scatters into: an atomic is read only by an atomic`,
      };
    if (entries.some((e) => stillPlain(e.body, bindingNames.get(name) ?? name)))
      return { noGpu: `it scatters into "${name}" at a place other than an element` };
  }
  return {
    module,
    argsBinding,
    argsStruct,
    loops: plans,
    ranges,
    bindingNames,
    ...(tail !== undefined ? { tail: tail.name } : {}),
    ...(finish !== undefined ? { finish } : {}),
    ...(words.length > 0 ? { words } : {}),
    ...(trips !== undefined ? { trips } : {}),
  };
}

/** The words of the trip buffer each loop whose range the device holds has (change 0094): the
 *  start's bits, the trip count, and the workgroup count `[x, y, 1]` of its entry, then three
 *  words of room. A loop that pushes keeps the length after it in the first of those (stage 4),
 *  and a loop that reduces has {@link TRIP_FOLDS} levels of four words after them. */
export const TRIP_WORDS = 8;

/** The fold levels a reduction over a range the device holds has room for in the trip buffer
 *  (change 0094, stage 4): 2^32 iterations fold, 256 to a workgroup, in three. Each level has four
 *  words: how many partials it folds, then the workgroup count `[x, y, 1]` it is dispatched with. */
export const TRIP_FOLDS = 3;

/** The words of the trip buffer a loop whose range the device holds has (change 0094):
 *  {@link TRIP_WORDS}, and four for each of {@link TRIP_FOLDS} levels when it reduces. */
export function tripWordsOf(loop: Pick<KernelLoopPlan, 'reduce'>): number {
  return TRIP_WORDS + (loop.reduce !== undefined ? 4 * TRIP_FOLDS : 0);
}

/** The word of a loop's trip buffer that holds the length after a loop that pushes (change 0094,
 *  stage 4): the scan step writes it there, and the call reads it back for a result. */
export const TRIP_PUSHED = 5;

/**
 * The cap of loop `loop`'s range, which the device holds (change 0094, decision D6): its start,
 * and the value `c` of a bound written `min(d, c)`, each read through the constants (`let`s) of
 * the statements before the loop that it names and with those constants written out, so the CPU
 * tier computes them from the scalars and the arrays' lengths alone, before anything runs. `c` is
 * an operand of a `min` that reads no element, no pushed length and no variable; of `min(min(d,
 * c1), c2)` both, as `min(c1, c2)`. Undefined when the loop counts down, when its start reads what
 * the device holds, or when no operand of its bound is such a value: the call then cannot size the
 * scratch of a loop that pushes or reduces.
 */
function capOf(
  header: { start: Expr; bound: Expr; cop: KernelLoopPlan['cop'] },
  prelude: readonly Stmt[],
  arrays: ReadonlySet<string>,
): { readonly start: Expr; readonly cap: Expr } | undefined {
  if (header.cop !== '<' && header.cop !== '<=') return undefined;
  // The constants of the statements before the loop, and every name they write.
  const lets = new Map<string, Expr>();
  // Every name a statement writes or declares below the top level, and every variable.
  const written = new Set<string>();
  const walk = (st: Stmt, top: boolean): void => {
    if (st.s === 'var' || (st.s === 'let' && !top)) written.add(st.name);
    if (st.s === 'assign' || st.s === 'assignOp') {
      const root = placeRoot(st.target);
      if (root.op === 'varref' || root.op === 'param') written.add(root.name);
    }
    // A name a call writes through a reference (Rule 8.25).
    const byRef = (e: Expr): void =>
      eachExpr(e, (x) => {
        if (x.op !== 'call') return;
        x.declRef?.params.forEach((p, i) => {
          const root = x.args[i] !== undefined ? placeRoot(x.args[i]!) : undefined;
          if ((p.mode === 'inout' || p.mode === 'out') && root !== undefined && 'name' in root)
            written.add(root.name);
        });
      });
    eachStmtExpr(st, byRef, (inner) => walk(inner, false));
  };
  // A top-level `let` is a constant of the whole function; a nested one may shadow it.
  for (const st of prelude) {
    walk(st, true);
    if (st.s === 'let') {
      if (lets.has(st.name)) written.add(st.name);
      lets.set(st.name, st.expr);
    }
  }
  const inline = (e: Expr): Expr => {
    if (e.op === 'varref' && lets.has(e.name) && !written.has(e.name))
      return inline(lets.get(e.name)!);
    return mapChildren(e, inline);
  };
  // A value the host knows: no element, no pushed length, no variable and no effect.
  const known = (e: Expr): boolean => {
    let ok = !readsElements([{ s: 'call', expr: e } as Stmt], arrays);
    eachExpr(e, (x) => {
      if (x.op === 'varref') ok = false;
      if (x.op === 'param' && written.has(x.name)) ok = false;
      if (x.op !== 'call') return;
      if (x.declRef?.params.some((p) => p.mode === 'inout' || p.mode === 'out') === true)
        ok = false;
      else if (x.declRef === undefined && EFFECTFUL_INTRINSICS.has(x.fn)) ok = false;
    });
    return ok;
  };
  const capIn = (e: Expr): Expr | undefined => {
    if (known(e)) return e;
    if (e.op !== 'call' || e.fn !== 'min' || e.declRef !== undefined || e.args.length !== 2)
      return undefined;
    const [a, b] = [capIn(e.args[0]!), capIn(e.args[1]!)];
    if (a !== undefined && b !== undefined) return { ...e, args: [a, b] };
    return a ?? b;
  };
  const start = inline(header.start);
  if (!known(start)) return undefined;
  const cap = capIn(inline(header.bound));
  return cap === undefined ? undefined : { start, cap };
}

/** Why loop `j`, whose range the device holds, cannot run on WebGPU in this lowering (change 0094,
 *  part 1), or undefined. A loop that pushes or reduces needs scratch the call sizes on the host,
 *  so its bound has a cap the host knows, `min(d, c)` (decision D6, `capped`); a texture's rows are
 *  checked against the trip count on the host (change 0077); the GPU runs only an assignment over
 *  such a count, since a call that writes through a reference may sit inside an expression, where
 *  no guard reaches it; and each invocation replays the statements before the loop, so the loop
 *  may not write what they read. */
function deviceGap(
  v: Extract<KernelProof['loops'][number], { ok: true }>,
  j: number,
  loop: ForStmt,
  prelude: readonly Stmt[],
  m: ModuleDecl,
  capped: boolean,
): string | undefined {
  const at = `loop ${j + 1}`;
  const over = 'over a trip count it reads from an array';
  const cap = 'its bound is no min(d, c) with c a value the host knows';
  const pushed = v.writes.find((w) => w.kind === 'append');
  if (pushed !== undefined && !capped)
    return `${at} pushes onto "${pushed.name}" ${over}, and ${cap}, for which the call sizes the counts of a push`;
  if (v.reductions.length > 0 && !capped)
    return `${at} reduces "${v.reductions[0]!.name}" ${over}, and ${cap}, for which the call sizes the partials of a reduction`;
  for (const w of v.writes) {
    if (w.kind === 'texel')
      return `${at} stores into the texture "${w.name}" ${over}, and the call checks a texture's rows against a trip count the host knows`;
    if (writesThroughCall(loop, w.name, m))
      return `${at} writes "${w.name}" through a reference a call takes, ${over}, and the GPU runs only an assignment over such a count`;
    if (readsElements(prelude, new Set([w.name])))
      return `${at} writes "${w.name}", which the statements before it read, and each of its invocations runs those statements again`;
  }
  return undefined;
}

/**
 * The range entry of loop `c.j`, whose range the device holds (change 0094, part 1): one
 * invocation that runs the statements before the loop over the bound arrays, computes the start
 * and the trip count as the call's `tripsOf` does, and writes them, and the workgroup count of
 * the loop's entry, into the trip buffer `out` at `c.trips.at`. A count past 65,535 workgroups
 * spills into `y`, as the call's `grid` does, and a trip count of 0 gives `y = 0`, which
 * dispatches no workgroup.
 */
function rangeEntryFor(
  c: LoopCtx,
  header: { start: Expr; bound: Expr; cop: KernelLoopPlan['cop']; type: ShaderType },
  out: string,
  wg: number,
  folds: boolean,
): FuncDecl {
  const at = c.trips!.at;
  const rewrite = entryRewrite(c);
  const t = header.type;
  const isU = t.kind === 'scalar' && t.scalar === 'u32';
  const ref = (name: string, type: ShaderType): Expr => ({ op: 'varref', type, name });
  const asU = (e: Expr): Expr => (isU ? e : { op: 'call', type: u32T, fn: 'u32', args: [e] });
  const sub = (a: Expr, b: Expr): Expr => ({ op: 'binop', type: u32T, bop: '-', a, b });
  const div = (a: Expr, b: Expr): Expr => ({ op: 'binop', type: u32T, bop: '/', a, b });
  const ceilDiv = (target: string, a: Expr, by: number): Stmt[] => [
    { s: 'assign', target: ref(target, u32T), expr: div(a, u(by)) },
    {
      s: 'if',
      arms: [
        {
          cond: {
            op: 'compare',
            type: boolT,
            cop: '!=',
            a: { op: 'binop', type: u32T, bop: '%', a, b: u(by) },
            b: u(0),
          },
          body: [
            {
              s: 'assign',
              target: ref(target, u32T),
              expr: bin('+', ref(target, u32T), u(1)),
            },
          ],
        },
      ],
    },
  ];
  const s = ref('_rs', t);
  const b = ref('_rb', t);
  const up = header.cop === '<' || header.cop === '<=';
  const inclusive = header.cop === '<=' || header.cop === '>=';
  const span0 = up ? sub(asU(b), asU(s)) : sub(asU(s), asU(b));
  const span = inclusive ? bin('+', span0, u(1)) : span0;
  const store = (k: number, e: Expr): Stmt => ({
    s: 'assign',
    target: {
      op: 'index',
      type: u32T,
      base: ref(out, { kind: 'array', elem: u32T }),
      idx: u(at + k),
    },
    expr: e,
  });
  const body: Stmt[] = [
    ...c.prelude.map((st) => mapStmt(st, rewrite)),
    { s: 'let', name: '_rs', expr: rewrite(header.start) },
    { s: 'let', name: '_rb', expr: rewrite(header.bound) },
    { s: 'var', name: '_rn', type: u32T, init: u(0) },
    {
      s: 'if',
      arms: [
        {
          cond: { op: 'compare', type: boolT, cop: header.cop, a: s, b },
          body: [
            { s: 'let', name: '_span', expr: span },
            ...ceilDiv('_rn', ref('_span', u32T), Math.abs(c.step)),
          ],
        },
      ],
    },
    { s: 'var', name: '_rg', type: u32T, init: u(0) },
    ...ceilDiv('_rg', ref('_rn', u32T), wg),
    {
      s: 'let',
      name: '_rx',
      expr: {
        op: 'call',
        type: u32T,
        fn: 'max',
        args: [u(1), { op: 'call', type: u32T, fn: 'min', args: [ref('_rg', u32T), u(65535)] }],
      },
    },
    {
      s: 'let',
      name: '_ry',
      expr: div(sub(bin('+', ref('_rg', u32T), ref('_rx', u32T)), u(1)), ref('_rx', u32T)),
    },
    store(0, asU(s)),
    store(1, ref('_rn', u32T)),
    store(2, ref('_rx', u32T)),
    store(3, ref('_ry', u32T)),
    store(4, u(1)),
  ];
  // Each fold level of a reduction (stage 4): how many partials it folds, and its workgroup count,
  // one workgroup at least, so that a level of one partial or none writes the partial or the
  // identity where the next level reads it (`reductionEntries`).
  if (folds) {
    let parts: Expr = ref('_rg', u32T);
    for (let level = 0; level < TRIP_FOLDS; level++) {
      const next = `_rq${String(level)}`;
      const gx = `_rqx${String(level)}`;
      const base = TRIP_WORDS + 4 * level;
      body.push(
        store(base, parts),
        {
          s: 'let',
          name: next,
          expr: {
            op: 'call',
            type: u32T,
            fn: 'max',
            args: [u(1), div(bin('+', parts, u(KERNEL_TREE - 1)), u(KERNEL_TREE))],
          },
        },
        {
          s: 'let',
          name: gx,
          expr: { op: 'call', type: u32T, fn: 'min', args: [ref(next, u32T), u(65535)] },
        },
        store(base + 1, ref(gx, u32T)),
        store(base + 2, div(sub(bin('+', ref(next, u32T), ref(gx, u32T)), u(1)), ref(gx, u32T))),
        store(base + 3, u(1)),
      );
      parts = ref(next, u32T);
    }
  }
  return computeEntry(`${c.f.name}_range${c.j}`, body, false, 1);
}

/** How an entry of the function reads a parameter: a scalar as a field of the uniform, an array
 *  as the storage binding of its name, and the length of a pushed array as its length word, when
 *  it has one (change 0094). */
function entryRewrite(
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
function declaredNames(m: ModuleDecl): Set<string> {
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
function spellArrayBindings(
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
interface LoopCtx {
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
  /** The read-write binding of the same trip buffer, which a push's scan step reads its trip
   *  count from and writes the length after the loop into (change 0094, stage 4): it is
   *  dispatched directly, so it may bind the buffer writable. */
  readonly tripsWrite?: string;
}

const boolT: ShaderType = { kind: 'scalar', scalar: 'bool' };
const kRef: Expr = { op: 'varref', type: u32T, name: '_k' };
/** Whether the invocation's lane is within the trip count (change 0096). */
const liveRef: Expr = { op: 'varref', type: boolT, name: '_live' };
/** `_kc = min(_k, _n - 1)`: the invocation itself within the trip count, and the last
 *  iteration's past it (change 0096). A lane that reaches it is in a workgroup whose first index
 *  is below `_n`, so `_n` is at least 1 and the subtraction does not wrap. */
const kcRef: Expr = { op: 'varref', type: u32T, name: '_kc' };

/** The statements before the iteration of an entry whose lanes may lie past the trip count
 *  (change 0096, Rule 8.22): the invocation's index, the return of a workgroup wholly past the
 *  trip count, which every invocation of the workgroup takes alike, the lane's `_live` flag and
 *  its clamped index `_kc`. The number of them is the plan's `iteration`. `fuse-entry.ts` writes
 *  the same four for a fused group. */
function laneScaffold(wg: number, n: Expr): Stmt[] {
  return [
    invocationIndex(wg),
    {
      s: 'if',
      arms: [
        {
          cond: { op: 'compare', type: boolT, cop: '>=', a: workgroupFirst(wg), b: n },
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
        args: [kRef, { op: 'binop', type: u32T, bop: '-', a: n, b: u(1) }],
      },
    },
  ];
}

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

/** Whether a lane past the trip count must skip the iteration rather than run iteration `n - 1`
 *  beside the lane that runs it (change 0096, decision D2): where that iteration reads an
 *  element it also writes, the clamped lane would read what the other lane writes in the same
 *  dispatch, a data race. The cases: the loop reads back an element of an array it writes
 *  (R4), it loads a texel of a texture it stores (R4), or it writes through an `@inout` argument
 *  of a call (Rule 8.25), whose store is in the callee. A fused group with an edge is the
 *  fourth, decided in `fuse-entry.ts`. */
function laneSkips(
  v: Extract<KernelProof['loops'][number], { ok: true }>,
  body: readonly Stmt[],
  arrays: ReadonlySet<string>,
): boolean {
  if (v.stores.some((st) => st.readBack)) return true;
  const stored = new Set(v.writes.filter((w) => w.kind === 'texel').map((w) => w.name));
  let found = false;
  const see = (e: Expr): void =>
    eachExpr(e, (x) => {
      if (x.op !== 'call') return;
      const first = x.args[0];
      if (x.fn === 'textureLoad' && first?.op === 'param' && stored.has(first.name)) found = true;
      x.declRef?.params.forEach((p, i) => {
        const a = x.args[i];
        if (p.mode !== 'inout' || a === undefined) return;
        const root = placeRoot(a);
        if (root.op === 'param' && arrays.has(root.name)) found = true;
      });
    });
  const visit = (st: Stmt): void => eachStmtExpr(st, see, visit);
  body.forEach(visit);
  return found;
}

/** Word `k` after a device range's start in the trip buffer an entry reads (change 0094). */
function tripWord(c: LoopCtx, k: number): Expr {
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
function argsOf(c: LoopCtx): (name: string, type: ShaderType) => Expr {
  const args: Expr = {
    op: 'varref',
    type: { kind: 'struct', name: c.argsStruct },
    name: c.argsBinding,
  };
  return (name, type) => ({ op: 'member', type, base: args, field: name });
}

/** The `@compute` entry's parameters: the three ids every entry reads (the workgroup's for the
 *  return of a workgroup wholly past the trip count, change 0096), and what a tree reads. */
function entryParams(tree: boolean): FuncDecl['params'] {
  return [
    { name: '_gid', type: vec3u, builtin: 'global_invocation_id' },
    { name: '_nwg', type: vec3u, builtin: 'num_workgroups' },
    { name: '_wid', type: vec3u, builtin: 'workgroup_id' },
    ...(tree ? [{ name: '_lid', type: u32T, builtin: 'local_invocation_index' }] : []),
  ];
}

/** The iteration `_k` runs: its counter, the prelude replayed, and the loop's body, with each
 *  parameter a field of the uniform or the binding of its name, and each `continue` of the
 *  loop's own a return of `ret`. With `lane` (change 0096) the counter is the lane's `k`, each
 *  write is masked, and a lane that skips runs the rest under the mask, after the counter. */
function iterationOf(
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
  let rest = [
    ...c.prelude,
    ...reset,
    ...ownContinuesReturn(c.loop.body, ret).map((st) => toAtomics(st, c.scatter)),
  ].map((st) => mapStmt(st, rewrite));
  if (lane?.skip === true) rest = [{ s: 'if', arms: [{ cond: lane.mask, body: rest }] }];
  else if (lane !== undefined) {
    const outer = new Set(c.arrays.flatMap((n) => [n, c.bindingNames.get(n) ?? n]));
    rest = maskWrites(rest, lane.mask, outer);
  }
  return [
    { s: 'let', name: c.counter, expr: i },
    ...rest,
    ...(ret !== undefined ? [{ s: 'return', expr: ret } as Stmt] : []),
  ];
}

/** A map loop's entry, and the index in its body where the iteration starts: after the
 *  statements that index the invocation, return a workgroup wholly past the trip count and set
 *  the lane's flag (change 0096). */
function entryFor(c: LoopCtx): { entry: FuncDecl; iteration: number } {
  const n = c.trips === undefined ? argsOf(c)('_n', u32T) : tripWord(c, 1);
  const scaffold = laneScaffold(c.wg, n);
  const body: Stmt[] = [
    ...scaffold,
    ...iterationOf(c, undefined, [], { k: kcRef, mask: liveRef, skip: c.skip }),
  ];
  return {
    entry: computeEntry(`${c.f.name}_loop${c.j}`, body, false, c.wg),
    iteration: scaffold.length,
  };
}

function computeEntry(
  name: string,
  body: Stmt[],
  tree: boolean,
  size: number = KERNEL_WORKGROUP,
): FuncDecl {
  const wg = tree ? KERNEL_TREE : size;
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
  /** The helper that runs one iteration. */
  iterate: string;
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
  // The helper reads `_k` and the lane's `_live` as its parameters (change 0096): a lane past
  // the trip count runs iteration `_n - 1` through it with every write masked, and its entry
  // gives the tree the identity instead of what the helper returns.
  const liveParam: Expr = { op: 'param', type: boolT, name: '_live' };
  const iterate = iterationOf(
    c,
    sums,
    reductions.map((r): Stmt => ({
      s: 'assign',
      target: { op: 'varref', type: r.type, name: r.name },
      expr: identityOf(r),
    })),
    { k: kRef, mask: liveParam, skip: false },
  );
  const asParam = (e: Expr): Expr =>
    e.op === 'varref' && e.name === '_k'
      ? { op: 'param', type: u32T, name: '_k' }
      : mapChildren(e, asParam);
  const helper: FuncDecl = {
    name: `${base}_iteration`,
    params: [
      { name: '_k', type: u32T },
      { name: '_live', type: boolT },
    ],
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
  // Over a range the device holds (change 0094, stage 4), a level reads how many partials it
  // folds from the trip buffer, at the word the uniform's `_n` names: the range entry wrote it.
  const foldN: Expr =
    c.trips === undefined ? field('_n', u32T) : { op: 'varref', type: u32T, name: '_fn' };
  const inRange: Expr = { op: 'compare', type: boolT, cop: '<', a: kRef, b: foldN };
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
  const n = c.trips === undefined ? field('_n', u32T) : tripWord(c, 1);
  const runOf = (k: Expr): Expr => ({
    op: 'call',
    type: structT,
    fn: helper.name,
    args: [k, liveRef],
    declRef: helper,
  });
  // A lane past the trip count runs iteration `_n - 1` and gives the tree the identity (change
  // 0096); where the lane skips (decision D2), it runs nothing, as every lane did before.
  const ranRef: Expr = { op: 'varref', type: structT, name: '_ran' };
  const iteration: Stmt[] = c.skip
    ? [
        {
          s: 'if',
          arms: [{ cond: liveRef, body: [{ s: 'assign', target: sumsRef, expr: runOf(kRef) }] }],
        },
      ]
    : [
        { s: 'let', name: '_ran', expr: runOf(kcRef) },
        {
          s: 'if',
          arms: [{ cond: liveRef, body: [{ s: 'assign', target: sumsRef, expr: ranRef }] }],
        },
      ];
  const loopEntry = computeEntry(
    base,
    [
      ...laneScaffold(KERNEL_TREE, n),
      {
        s: 'var',
        name: '_sums',
        type: structT,
        init: { op: 'construct', type: structT, args: reductions.map(identityOf) },
      },
      ...iteration,
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
  // A level over a range the device holds runs whatever the counts hold, so a level of one partial
  // or none takes no tree: its one invocation copies the partial, or writes the identity for a
  // loop that ran no iteration, so the value is the one the call's levels of a known count give.
  const tripsIn: Expr = {
    op: 'varref',
    type: { kind: 'array', elem: u32T },
    name: c.trips?.binding ?? '',
  };
  const fewPartials: Stmt[] =
    c.trips === undefined
      ? []
      : [
          {
            s: 'let',
            name: '_fn',
            expr: { op: 'index', type: u32T, base: tripsIn, idx: field('_n', u32T) },
          },
          {
            s: 'if',
            arms: [
              {
                cond: { op: 'compare', type: boolT, cop: '<=', a: foldN, b: u(1) },
                body: [
                  {
                    s: 'if',
                    arms: [
                      {
                        cond: { op: 'compare', type: boolT, cop: '==', a: kRef, b: u(0) },
                        body: vars.flatMap((r): Stmt[] => [
                          { s: 'var', name: `_one_${r.name}`, type: r.type, init: identityOf(r) },
                          {
                            s: 'if',
                            arms: [
                              {
                                cond: { op: 'compare', type: boolT, cop: '==', a: foldN, b: u(1) },
                                body: [
                                  {
                                    s: 'assign',
                                    target: { op: 'varref', type: r.type, name: `_one_${r.name}` },
                                    expr: part(r, field('_in', u32T)),
                                  },
                                ],
                              },
                            ],
                          },
                          {
                            s: 'assign',
                            target: part(r, field('_out', u32T)),
                            expr: { op: 'varref', type: r.type, name: `_one_${r.name}` },
                          },
                        ]),
                      },
                    ],
                  },
                  { s: 'return' },
                ],
              },
            ],
          },
        ];
  const reduceEntry = computeEntry(
    `${base}_fold`,
    [
      invocationIndex(KERNEL_TREE),
      ...fewPartials,
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
    iterate: helper.name,
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

/** Whether the loop's body has a `continue` of its own: the ones {@link ownContinuesReturn}
 *  turns into a `return`, found by the same walk. */
function hasOwnContinue(body: readonly Stmt[]): boolean {
  return body.some((st) => {
    switch (st.s) {
      case 'continue':
        return true;
      case 'if':
        return (
          st.arms.some((a) => hasOwnContinue(a.body)) ||
          (st.elseBody !== undefined && hasOwnContinue(st.elseBody))
        );
      case 'switch':
        return (
          st.cases.some((c) => hasOwnContinue(c.body)) ||
          (st.defaultBody !== undefined && hasOwnContinue(st.defaultBody))
        );
      default:
        return false;
    }
  });
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
/** Whether `t` is a texture a kernel function takes as a parameter (change 0077). */
function isTextureParam(t: ShaderType): boolean {
  return t.kind === 'texture' || t.kind === 'storage-texture';
}

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
  /** The arrays the loop reads: each by its parameter and by the sampler the program names it. */
  readonly reads: readonly { readonly param: string; readonly name: string }[];
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
 *  through, `bump(out[i])` to an `@inout` parameter (Rule 8.25). */
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

/** `st` with each store the front end guarded by its array's length (`kernel-stores.ts`) in place
 *  of its guard, at any depth. */
function unguarded(st: Stmt, arrays: ReadonlySet<string>): Stmt {
  const found = storeAfterLoops(st, arrays);
  if (found !== undefined) return found.store;
  return mapStmtExpr(
    st,
    (e) => e,
    (b) => unguarded(b, arrays),
  );
}

export function lowerKernelGl(
  f: FuncDecl,
  m: ModuleDecl,
  proof: KernelProof,
): { readonly loops: readonly KernelGlLoopPlan[] } | { readonly noWebgl2: string } {
  if (proof.shape !== undefined) return { noWebgl2: "its body is not the kernel call's shape" };
  // WebGL2 has no atomics to build a Map or a Set with (change 0080).
  const collection = f.params.find((p) => p.type.kind === 'collection');
  if (collection !== undefined)
    return {
      noWebgl2: `it takes the Map or Set "${collection.name}", which the WebGL2 tier does not run (change 0080)`,
    };
  const scalars = f.params.filter((p) => !isRuntimeArray(p.type));
  const arrays = f.params.filter((p) => isRuntimeArray(p.type));
  // Rule 3.4: the WebGL2 program names each array's sampler, so a GLSL reserved word gets a
  // fresh spelling here, and the host keeps the authored name.
  const glNames = spellArrayBindings(
    arrays.map((p) => p.name),
    declaredNames(m),
    isGlslReserved,
  );
  for (const p of scalars) {
    const t = p.type;
    const s = t.kind === 'scalar' ? t.scalar : t.kind === 'vec' ? t.elem : undefined;
    if (s !== 'f32' && s !== 'i32' && s !== 'u32')
      return {
        noWebgl2: `parameter "${p.name}" is not a number or a vector, which a uniform holds`,
      };
  }
  const device = deviceRangeLoops(f);
  const arraySet = new Set(arrays.map((p) => p.name));
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
      // WebGL2 has no workgroup, so the size of the function is not read here (proposal 0067).
      wg: KERNEL_WORKGROUP,
      // The writes of a loop whose range the device holds keep the guard of their array's end
      // (change 0094, decision D2) on every other tier. WebGL2 writes the one array at `i`, and
      // the call draws only the iterations whose `i` is inside it, so the program drops the guard.
      loop: device.has(loopNo - 1)
        ? { ...st, body: st.body.map((b) => unguarded(b, arraySet)) }
        : st,
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
      // The program keeps its early return (change 0096, decision D3): no lane is masked.
      skip: false,
      bindingNames: glNames,
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
    const outName = glNames.get(w.name) ?? w.name;
    const toTexel = (s: Stmt): Stmt => {
      const inner = mapStmtExpr(s, (e) => e, toTexel);
      if (inner.s !== 'assign') return inner;
      let root: Expr = inner.target;
      while (root.op === 'index' || root.op === 'member') root = root.base;
      if (!((root.op === 'varref' || root.op === 'param') && root.name === outName)) return inner;
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
    const names = new Set(arrays.map((p) => glNames.get(p.name) ?? p.name));
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
          type: arrays.find((p) => (glNames.get(p.name) ?? p.name) === name)!.type,
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
    const param = (name: string): string =>
      arrays.find((p) => (glNames.get(p.name) ?? p.name) === name)!.name;
    plans.push({
      module,
      out: w.name,
      outScalar,
      reads: [...read].map((name) => ({ param: param(name), name })),
      uniforms,
    });
  }
  if (plans.length === 0) return { noWebgl2: 'it has no loop to draw' };
  return { loops: plans };
}

// ─── a loop that pushes (change 0078) ────────────────────────────────────────────────────────

/** Why loop `j`, which the proof accepted, cannot run in the three steps of a push, or undefined
 *  when it can or pushes nothing. The first step runs the iteration only to count its pushes:
 *  it stores nothing, so an iteration that reads back what it wrote would read other values
 *  there, and a reduction or a scatter would combine twice. */
function pushGap(
  v: Extract<KernelProof['loops'][number], { ok: true }>,
  j: number,
): string | undefined {
  const appends = v.writes.filter((w) => w.kind === 'append');
  if (appends.length === 0) return undefined;
  const loop = `loop ${j + 1}`;
  if (appends.length > 1)
    return `${loop} pushes onto ${appends.map((w) => `"${w.name}"`).join(' and ')}, and the call counts the pushes of one array a loop`;
  if (v.reductions.length > 0)
    return `${loop} pushes and reduces "${v.reductions[0]!.name}", which its counting step would combine twice`;
  for (const w of v.writes) {
    if (w.kind === 'append') continue;
    if (w.kind === 'scatter' || w.kind === 'texel')
      return `${loop} pushes and ${w.kind === 'scatter' ? 'scatters into' : 'stores into'} "${w.name}", which its counting step would write twice`;
    if (v.stores.find((s) => s.name === w.name)?.readBack === true)
      return `${loop} pushes and reads back what it writes to "${w.name}", which its counting step does not write`;
  }
  return undefined;
}

/** Whether `body` reads the length of an array it pushes onto (`pushCount`) before the call knows
 *  it: in a loop's body, or in a statement before the last loop or a loop's header while a loop
 *  at or after it pushes onto the array (changes 0078 and 0094). `pushers` holds the loops that
 *  push onto each array, by index. */
function earlyPushCount(
  body: readonly Stmt[],
  pushers: ReadonlyMap<string, readonly number[]>,
): boolean {
  const last = lastLoopOf(body);
  const later = (names: ReadonlySet<string>, j: number): boolean =>
    [...names].some((a) => (pushers.get(a) ?? []).some((k) => k >= j));
  let j = 0;
  for (const [i, st] of body.entries()) {
    if (i > last) break;
    if (st.s !== 'for') {
      if (later(pushCountsIn([st]), j)) return true;
      continue;
    }
    if (later(pushCountsIn(headerStmts(st)), j)) return true;
    if (pushCountsIn([st.update, ...st.body]).size > 0) return true;
    j++;
  }
  return false;
}

/** A loop's start and condition as statements a walk reads. */
function headerStmts(loop: ForStmt): Stmt[] {
  return [loop.init, { s: 'call', expr: loop.cond } as Stmt];
}

/** The arrays whose pushed length a statement before the last loop, or a loop's header, reads
 *  (change 0094): a later loop's range reads it from the array's length word. */
function pushCountsBetween(body: readonly Stmt[]): Set<string> {
  const last = lastLoopOf(body);
  return pushCountsIn(
    body.flatMap((st, i) =>
      i > last || st.s === 'return' ? [] : st.s === 'for' ? headerStmts(st) : [st],
    ),
  );
}

/** The array parameters whose pushed count, `pushCount`, `sts` read anywhere (change 0094). */
function pushCountsIn(sts: readonly Stmt[]): Set<string> {
  const found = new Set<string>();
  const visit = (e: Expr): void =>
    eachExpr(e, (x) => {
      if (x.op === 'call' && x.fn === 'pushCount' && x.args[0]?.op === 'param')
        found.add(x.args[0].name);
    });
  const walk = (st: Stmt): void => eachStmtExpr(st, visit, walk);
  sts.forEach(walk);
  return found;
}

/** `sts` with each statement `f` maps to the statements it gives, in nested bodies too. */
function mapBlock(sts: readonly Stmt[], f: (st: Stmt) => Stmt[] | undefined): Stmt[] {
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
function placeRoot(e: Expr): Expr {
  return e.op === 'index' || e.op === 'member' ? placeRoot(e.base) : e;
}

/**
 * The three steps a loop that pushes onto array `pushed` lowers to (change 0078):
 *
 *   1. `<base>_counts`: each invocation runs its iteration in `<base>_count`, which counts the
 *      pushes and stores nothing, and writes the count to its slot of the binding `<base>_push`;
 *   2. `<base>_scan`: one workgroup of 256 turns the counts into the exclusive scan in place,
 *      each invocation over a run of slots one after another, and writes the total at slot `n`;
 *   3. `<base>` (the loop's entry): each invocation runs its iteration again and stores its
 *      `j`th push at its offset plus `j`, while that is inside the array, and the loop's other
 *      writes.
 *
 * The elements land in the order of the iterations, as a sequential run appends them, and the
 * total is the count appended, which may exceed the array's length (decision 1).
 *
 * With the array's length `word` (change 0094), the pushes start at the length it holds: the
 * first invocation of the scan starts the offsets there and writes the new length into the word
 * after them, so slot `n` holds the length after the loop, and a later loop that pushes onto the
 * array appends after this one. The one invocation that reads the word is the one that writes it.
 */
function pushEntries(
  c: LoopCtx,
  pushed: string,
  arrays: ReadonlySet<string>,
  word?: PushWord,
): {
  funcs: FuncDecl[];
  workgroup: ModuleVarDecl;
  binding: string;
  count: string;
  scan: string;
  store: string;
  iteration: number;
} {
  const base = `${c.f.name}_loop${c.j}`;
  const binding = `${base}_push`;
  const field = argsOf(c);
  const lit = (n: number): Expr => ({ op: 'lit', type: u32T, value: n });
  const slots: ShaderType = { kind: 'array', elem: u32T };
  const slot = (at: Expr): Expr => ({
    op: 'index',
    type: u32T,
    base: { op: 'varref', type: slots, name: binding },
    idx: at,
  });
  const isPush = (st: Stmt): st is Stmt & { s: 'call'; expr: Expr & { op: 'call' } } =>
    st.s === 'call' &&
    st.expr.op === 'call' &&
    st.expr.fn === 'push' &&
    st.expr.declRef === undefined &&
    st.expr.args[0]?.op === 'param' &&
    st.expr.args[0].name === pushed;
  const plus1 = (name: string): Stmt => {
    const v: Expr = { op: 'varref', type: u32T, name };
    return { s: 'assign', target: v, expr: { op: 'binop', type: u32T, bop: '+', a: v, b: lit(1) } };
  };

  // 1. Count: each push adds one, and no array is written.
  const countBody = mapBlock(c.loop.body, (st) => {
    if (isPush(st)) return [plus1('_c')];
    if (st.s === 'assign' || st.s === 'assignOp') {
      const root = placeRoot(st.target);
      if (root.op === 'param' && arrays.has(root.name)) return [];
    }
    return undefined;
  });
  const cRef: Expr = { op: 'varref', type: u32T, name: '_c' };
  const counting = iterationOf({ ...c, loop: { ...c.loop, body: countBody } }, cRef, [
    { s: 'var', name: '_c', type: u32T, init: lit(0) },
  ]);
  const asParam = (e: Expr): Expr =>
    e.op === 'varref' && e.name === '_k'
      ? { op: 'param', type: u32T, name: '_k' }
      : mapChildren(e, asParam);
  const helper: FuncDecl = {
    name: `${base}_count`,
    params: [{ name: '_k', type: u32T }],
    ret: u32T,
    body: counting.map((st) => mapStmt(st, asParam)),
  };
  // Over a range the device holds (change 0094, stage 4), the count and store steps read the trip
  // count from the trip buffer's read-only binding, and the scan, which is dispatched directly,
  // from its read-write binding, where it also writes the length after the loop.
  const n = c.trips === undefined ? field('_n', u32T) : tripWord(c, 1);
  const tripsOut = (k: number): Expr => ({
    op: 'index',
    type: u32T,
    base: { op: 'varref', type: { kind: 'array', elem: u32T }, name: c.tripsWrite! },
    idx: u(c.trips!.at + k),
  });
  const scanN = c.trips === undefined ? n : tripsOut(1);
  const countOf = (k: Expr): Expr => ({
    op: 'call',
    type: u32T,
    fn: helper.name,
    args: [k],
    declRef: helper,
  });
  // A lane past the trip count counts iteration `_n - 1` and stores no count (change 0096);
  // where the lane skips (decision D2), it counts nothing, as every lane did before.
  const cntRef: Expr = { op: 'varref', type: u32T, name: '_cnt' };
  const counts: Stmt[] = c.skip
    ? [
        {
          s: 'if',
          arms: [
            { cond: liveRef, body: [{ s: 'assign', target: slot(kRef), expr: countOf(kRef) }] },
          ],
        },
      ]
    : [
        { s: 'let', name: '_cnt', expr: countOf(kcRef) },
        {
          s: 'if',
          arms: [{ cond: liveRef, body: [{ s: 'assign', target: slot(kRef), expr: cntRef }] }],
        },
      ];
  const countEntry = computeEntry(
    `${base}_counts`,
    [...laneScaffold(c.wg, n), ...counts],
    false,
    c.wg,
  );

  // 2. Scan: one workgroup of 256, each invocation over its run of slots, the runs' totals
  //    scanned by the first invocation, then each run written as its offsets.
  const wgName = `${base}_scan_runs`;
  const runs: ShaderType = { kind: 'array', elem: u32T, size: KERNEL_TREE };
  const run = (at: Expr): Expr => ({
    op: 'index',
    type: u32T,
    base: { op: 'varref', type: runs, name: wgName },
    idx: at,
  });
  const lid: Expr = { op: 'param', type: u32T, name: '_lid' };
  const ref = (name: string): Expr => ({ op: 'varref', type: u32T, name });
  const barrier: Stmt = {
    s: 'call',
    expr: { op: 'call', type: { kind: 'void' }, fn: 'workgroupBarrier', args: [] },
  };
  const minU = (a: Expr, b: Expr): Expr => ({ op: 'call', type: u32T, fn: 'min', args: [a, b] });
  // The array's length word, when its pushes start at a held length (change 0094).
  const length: Expr | undefined =
    word === undefined
      ? undefined
      : {
          op: 'index',
          type: u32T,
          base: { op: 'varref', type: slots, name: word.binding },
          idx: field(word.field, u32T),
        };
  const over = (counter: string, from: Expr, to: Expr, body: Stmt[]): Stmt => ({
    s: 'for',
    init: { s: 'var', name: counter, type: u32T, init: from },
    cond: { op: 'compare', type: boolT, cop: '<', a: ref(counter), b: to },
    update: plus1(counter),
    body,
  });
  const scanEntry = computeEntry(
    `${base}_scan`,
    [
      {
        s: 'let',
        name: '_run',
        expr: {
          op: 'binop',
          type: u32T,
          bop: '/',
          a: { op: 'binop', type: u32T, bop: '+', a: scanN, b: lit(KERNEL_TREE - 1) },
          b: lit(KERNEL_TREE),
        },
      },
      { s: 'let', name: '_lo', expr: minU(bin('*', lid, ref('_run')), scanN) },
      { s: 'let', name: '_hi', expr: minU(bin('+', ref('_lo'), ref('_run')), scanN) },
      { s: 'var', name: '_sum', type: u32T, init: lit(0) },
      over('_t', ref('_lo'), ref('_hi'), [
        {
          s: 'assign',
          target: ref('_sum'),
          expr: { op: 'binop', type: u32T, bop: '+', a: ref('_sum'), b: slot(ref('_t')) },
        },
      ]),
      { s: 'assign', target: run(lid), expr: ref('_sum') },
      barrier,
      {
        s: 'if',
        arms: [
          {
            cond: { op: 'compare', type: boolT, cop: '==', a: lid, b: lit(0) },
            body: [
              { s: 'var', name: '_acc', type: u32T, init: length ?? lit(0) },
              over('_r', lit(0), lit(KERNEL_TREE), [
                { s: 'let', name: '_v', expr: run(ref('_r')) },
                { s: 'assign', target: run(ref('_r')), expr: ref('_acc') },
                {
                  s: 'assign',
                  target: ref('_acc'),
                  expr: { op: 'binop', type: u32T, bop: '+', a: ref('_acc'), b: ref('_v') },
                },
              ]),
              // The new length, the held one plus what the loop appends (change 0094).
              ...(length !== undefined
                ? [{ s: 'assign', target: length, expr: ref('_acc') } as Stmt]
                : []),
            ],
          },
        ],
      },
      barrier,
      { s: 'var', name: '_at', type: u32T, init: run(lid) },
      over('_u', ref('_lo'), ref('_hi'), [
        { s: 'let', name: '_w', expr: slot(ref('_u')) },
        { s: 'assign', target: slot(ref('_u')), expr: ref('_at') },
        {
          s: 'assign',
          target: ref('_at'),
          expr: { op: 'binop', type: u32T, bop: '+', a: ref('_at'), b: ref('_w') },
        },
      ]),
      // The last invocation's run ends at `n`, so what it ends at is the total.
      {
        s: 'if',
        arms: [
          {
            cond: { op: 'compare', type: boolT, cop: '==', a: lid, b: lit(KERNEL_TREE - 1) },
            body: [
              { s: 'assign', target: slot(scanN), expr: ref('_at') },
              // The length after the loop, where the call reads it back (stage 4).
              ...(c.trips !== undefined
                ? [{ s: 'assign', target: tripsOut(TRIP_PUSHED), expr: ref('_at') } as Stmt]
                : []),
            ],
          },
        ],
      },
    ],
    true,
  );

  // 3. Store: the iteration again, each push at its offset while inside the array.
  const pRef = ref('_p');
  const storeBody = mapBlock(c.loop.body, (st) => {
    if (!isPush(st)) return undefined;
    const [arr, value] = st.expr.args as [Expr, Expr];
    return [
      {
        s: 'if',
        arms: [
          {
            cond: {
              op: 'compare',
              type: boolT,
              cop: '<',
              a: pRef,
              b: { op: 'call', type: u32T, fn: 'arrayLength', args: [arr] },
            },
            body: [
              {
                s: 'assign',
                target: { op: 'index', type: value.type, base: arr, idx: pRef },
                expr: value,
              },
            ],
          },
        ],
      },
      plus1('_p'),
    ];
  });
  // The same scaffold as a map's entry (change 0096): a lane past the trip count runs the last
  // iteration from its slot, and its stores are masked, so it stores no push.
  const scaffold = laneScaffold(c.wg, n);
  const storing = iterationOf(
    { ...c, loop: { ...c.loop, body: storeBody } },
    undefined,
    [{ s: 'var', name: '_p', type: u32T, init: slot(kcRef) }],
    { k: kcRef, mask: liveRef, skip: c.skip },
  );
  const storeEntry = computeEntry(base, [...scaffold, ...storing], false, c.wg);
  return {
    funcs: [helper, countEntry, scanEntry, storeEntry],
    workgroup: { name: wgName, space: 'workgroup', type: runs },
    binding,
    count: countEntry.name,
    scan: scanEntry.name,
    store: storeEntry.name,
    iteration: scaffold.length,
  };
}

// ─── A Map or a Set (change 0080) ────────────────────────────────────────────────────────────

/** How many `add` or `set` calls on `name` one run of `sts` makes at most, or undefined when one
 *  is inside a nested loop, whose trips the call does not count. */
function addsPerRun(sts: readonly Stmt[], name: string): number | undefined {
  const adds = (e: Expr): number => {
    let n = 0;
    eachExpr(e, (x) => {
      if (
        x.op === 'call' &&
        (x.fn === 'collectionAdd' || x.fn === 'collectionSet') &&
        x.args[0]?.op === 'param' &&
        x.args[0].name === name
      )
        n++;
    });
    return n;
  };
  let total = 0;
  let nested = false;
  const walk = (body: readonly Stmt[], inLoop: boolean): void => {
    for (const st of body) {
      let here = 0;
      eachStmtExpr(
        st,
        (e) => (here += adds(e)),
        () => {},
      );
      if (here > 0 && inLoop) nested = true;
      total += here;
      if (st.s === 'if') {
        for (const a of st.arms) walk(a.body, inLoop);
        if (st.elseBody !== undefined) walk(st.elseBody, inLoop);
      } else if (st.s === 'for') {
        walk(st.body, true);
      } else if (st.s === 'switch') {
        for (const c of st.cases) walk(c.body, inLoop);
        if (st.defaultBody !== undefined) walk(st.defaultBody, inLoop);
      }
    }
  };
  walk(sts, false);
  return nested ? undefined : total;
}

/** Whether `sts` read the Map or Set `name`: a `has`, a `get` or a `size`. */
function readsCollection(sts: readonly Stmt[], name: string): boolean {
  let found = false;
  const visit = (e: Expr): void =>
    eachExpr(e, (x) => {
      if (
        x.op === 'call' &&
        (x.fn === 'collectionHas' || x.fn === 'collectionGet' || x.fn === 'collectionSize') &&
        x.args[0]?.op === 'param' &&
        x.args[0].name === name
      )
        found = true;
    });
  const walk = (st: Stmt): void => eachStmtExpr(st, visit, walk);
  sts.forEach(walk);
  return found;
}

/**
 * Lower a kernel function that takes a Map or a Set (change 0080, part 2). Each loop that adds to
 * one pushes a record for each `add` or `set` onto an array of its own, as change 0078 lowers a
 * push: the records land in the order a sequential run makes them, and the call applies them to
 * the caller's Map or Set in that order. ECMAScript's own `add` and `set` then give the entries,
 * the value set last and the insertion order, on every tier the same.
 */
function lowerCollections(f: FuncDecl, m: ModuleDecl): KernelPlan | { readonly noGpu: string } {
  const loops = f.body.filter((st): st is ForStmt => st.s === 'for');
  const taken = declaredNames(m);
  const structs: StructDecl[] = [];
  const params: FuncDecl['params'][number][] = [];
  const collections: KernelCollection[] = [];
  const lookups: KernelLookup[] = [];
  const helpers: FuncDecl[] = [];
  const finders = new Map<
    string,
    { find: FuncDecl; keys: string; values: string | undefined; value: ShaderType | undefined }
  >();
  for (const p of f.params) {
    const t = p.type;
    if (t.kind !== 'collection') continue;
    const what = `the ${t.value === undefined ? 'Set' : 'Map'} "${p.name}"`;
    const adding = loops.flatMap((l, j) => (addsPerRun(l.body, p.name) !== 0 ? [j] : []));
    const reading = loops.flatMap((l, j) => (readsCollection(l.body, p.name) ? [j] : []));
    // A loop reads what the loops before it added: the call applies their records first. A loop
    // that adds after one that reads would change what the earlier one read.
    if (reading.length > 0 && adding.some((a) => a >= reading[0]!))
      return {
        noGpu: `loop ${adding.find((a) => a >= reading[0]!)! + 1} adds to ${what}, which loop ${reading[0]! + 1} reads before it, and the call uploads a collection once`,
      };
    if (reading.length > 0) {
      // The keys as order words with their count first, and a Map's values beside them.
      const fresh = (base: string): string => {
        let name = base;
        while (taken.has(name)) name = `_${name}`;
        taken.add(name);
        return name;
      };
      const keys = fresh(`_${p.name}_keys`);
      params.push({ name: keys, type: { kind: 'array', elem: u32T } });
      const values = t.value !== undefined ? fresh(`_${p.name}_values`) : undefined;
      if (values !== undefined)
        params.push({ name: values, type: { kind: 'array', elem: t.value! } });
      const find = findFunction(fresh(`${f.name}_${p.name}_find`), keys, t.key);
      helpers.push(find);
      lookups.push({
        param: p.name,
        keys,
        ...(values !== undefined ? { values } : {}),
        loop: reading[0]!,
      });
      finders.set(p.name, { find, keys, values, value: t.value });
      if (adding.length === 0) continue;
    }
    if (adding.length === 0) continue;
    if (adding.length > 1)
      return {
        noGpu: `loops ${adding[0]! + 1} and ${adding[1]! + 1} both add to ${what}, and the second adds after the first`,
      };
    const j = adding[0]!;
    const perIteration = addsPerRun(loops[j]!.body, p.name);
    if (perIteration === undefined)
      return {
        noGpu: `loop ${j + 1} adds to ${what} inside a nested loop, whose trips the call does not count`,
      };
    // The record: the key, and for a Map the value with it.
    let records = `_${p.name}_records`;
    while (taken.has(records)) records = `_${records}`;
    taken.add(records);
    const keyT: ShaderType = { kind: 'scalar', scalar: t.key };
    let elem: ShaderType = keyT;
    if (t.value !== undefined) {
      let name = `${f.name}_${p.name}_Entry`;
      while (taken.has(name)) name = `_${name}`;
      taken.add(name);
      structs.push({
        name,
        fields: [
          { name: 'k', type: keyT },
          { name: 'v', type: t.value },
        ],
      });
      elem = { kind: 'struct', name };
    }
    params.push({ name: records, type: { kind: 'array', elem }, mode: 'inout' });
    collections.push({ param: p.name, records, loop: j, perIteration });
  }
  // Each add or set, a push of its record.
  const byParam = new Map(collections.map((c) => [c.param, c]));
  const recordOf = (x: Expr & { op: 'call' }): Expr | undefined => {
    const target = x.args[0];
    const c = target?.op === 'param' ? byParam.get(target.name) : undefined;
    if (c === undefined) return undefined;
    const p = params.find((q) => q.name === c.records)!;
    const arr: Expr = { op: 'param', type: p.type, name: c.records };
    const elem = (p.type as { elem: ShaderType }).elem;
    const value: Expr =
      x.fn === 'collectionAdd'
        ? x.args[1]!
        : { op: 'construct', type: elem, args: [x.args[1]!, x.args[2]!] };
    return { op: 'call', type: u32T, fn: 'push', args: [arr, value] };
  };
  // Each has, get and size of a collection the loops read, a search of its keys.
  const lookupOf = (y: Expr & { op: 'call' }): Expr | undefined => {
    const target = y.args[0];
    const l = target?.op === 'param' ? finders.get(target.name) : undefined;
    if (l === undefined) return undefined;
    const keysT: ShaderType = { kind: 'array', elem: u32T };
    const keysRef: Expr = { op: 'param', type: keysT, name: l.keys };
    const lit = (n: number): Expr => ({ op: 'lit', type: u32T, value: n });
    if (y.fn === 'collectionSize') return { op: 'index', type: u32T, base: keysRef, idx: lit(0) };
    const at: Expr = {
      op: 'call',
      type: u32T,
      fn: l.find.name,
      args: [y.args[1]!],
      declRef: l.find,
    };
    if (y.fn === 'collectionHas')
      return {
        op: 'compare',
        type: { kind: 'scalar', scalar: 'bool' },
        cop: '!=',
        a: at,
        b: lit(NOT_FOUND),
      };
    const valuesT: ShaderType = { kind: 'array', elem: l.value! };
    return {
      op: 'index',
      type: l.value!,
      base: { op: 'param', type: valuesT, name: l.values! },
      idx: at,
    };
  };
  const rewrite = (e: Expr): Expr => {
    const y = mapChildren(e, rewrite);
    if (y.op === 'call' && (y.fn === 'collectionAdd' || y.fn === 'collectionSet'))
      return recordOf(y) ?? y;
    if (
      y.op === 'call' &&
      (y.fn === 'collectionHas' || y.fn === 'collectionGet' || y.fn === 'collectionSize')
    )
      return lookupOf(y) ?? y;
    return y;
  };
  const stmt = (st: Stmt): Stmt => mapStmtExpr(st, rewrite, stmt);
  // Only the loops are rewritten: the statements around them run on the CPU tier, which reads
  // the collection itself.
  const lowered: FuncDecl = {
    ...f,
    params: [...f.params.filter((p) => p.type.kind !== 'collection'), ...params],
    body: f.body.map((st) => (st.s === 'for' ? stmt(st) : st)),
  };
  // What is left of a collection outside the loops (a `size` the result reads) is the CPU
  // tier's: the call hands the range functions and the tail the collection itself.
  const m2: ModuleDecl = {
    ...m,
    structs: [...m.structs, ...structs],
    funcs: [...helpers, ...m.funcs.map((x) => (x === f ? lowered : x))],
  };
  const proof2 = proveKernels(m2).find((x) => x.fn === f.name);
  if (proof2 === undefined) return { noGpu: 'its records were not proved' };
  if (proof2.loops.some((l) => !l.ok)) return { noGpu: 'a loop of it runs on the CPU (TS8070)' };
  const plan = lowerKernel(lowered, m2, proof2);
  if ('noGpu' in plan) return plan;
  // The range functions and the tail take the function's own parameters, the collections among
  // them, and none of the record arrays, which only the loops write.
  const own = (fn: FuncDecl): FuncDecl => ({
    ...fn,
    params: [...f.params, ...fn.params.slice(lowered.params.length)],
  });
  return {
    ...plan,
    ranges: plan.ranges.map(own),
    ...(collections.length > 0 ? { collections } : {}),
    ...(lookups.length > 0 ? { lookups } : {}),
  };
}

/** What a search gives for a key the collection does not hold. */
const NOT_FOUND = 0xffffffff;

/**
 * The order word of a key (change 0080): one `u32` for each key, equal for two keys exactly when
 * SameValueZero calls them equal. A `u32` is itself, an `i32` its bits, and an `f32` its bits
 * with `-0` as `0` and every `NaN` as `0x7fc00000`. The call sorts the keys by it, and computes it
 * as `orderWord` in `core/host-kernel.ts` does.
 */
function orderWordOf(k: Expr, key: 'u32' | 'i32' | 'f32'): Expr {
  if (key === 'u32') return k;
  if (key === 'i32') return { op: 'call', type: u32T, fn: 'u32', args: [k] };
  const boolT: ShaderType = { kind: 'scalar', scalar: 'bool' };
  const f32: ShaderType = { kind: 'scalar', scalar: 'f32' };
  const bits: Expr = { op: 'call', type: u32T, fn: 'bitcastU32', args: [k] };
  const zero: Expr = {
    op: 'compare',
    type: boolT,
    cop: '==',
    a: k,
    b: { op: 'lit', type: f32, value: 0 },
  };
  const nan: Expr = { op: 'compare', type: boolT, cop: '!=', a: k, b: k };
  const lit = (n: number): Expr => ({ op: 'lit', type: u32T, value: n });
  return {
    op: 'select',
    type: u32T,
    cond: nan,
    ifTrue: lit(0x7fc00000),
    ifFalse: { op: 'select', type: u32T, cond: zero, ifTrue: lit(0), ifFalse: bits },
  };
}

/**
 * `fn <name>(k: K) -> u32`: the index of `k` among the sorted order words of `keys` (the count
 * at 0, the words after it), or {@link NOT_FOUND}. A binary search of at most 32 steps.
 */
function findFunction(name: string, keys: string, key: 'u32' | 'i32' | 'f32'): FuncDecl {
  const keyT: ShaderType = { kind: 'scalar', scalar: key };
  const boolT: ShaderType = { kind: 'scalar', scalar: 'bool' };
  const lit = (n: number): Expr => ({ op: 'lit', type: u32T, value: n });
  const ref = (n: string): Expr => ({ op: 'varref', type: u32T, name: n });
  const word = (at: Expr): Expr => ({
    op: 'index',
    type: u32T,
    base: { op: 'varref', type: { kind: 'array', elem: u32T }, name: keys },
    idx: at,
  });
  const add = (a: Expr, b: Expr): Expr => ({ op: 'binop', type: u32T, bop: '+', a, b });
  const cmp = (cop: '<' | '>=' | '==', a: Expr, b: Expr): Expr => ({
    op: 'compare',
    type: boolT,
    cop,
    a,
    b,
  });
  return {
    name,
    params: [{ name: 'k', type: keyT }],
    ret: u32T,
    body: [
      { s: 'let', name: '_w', expr: orderWordOf({ op: 'param', type: keyT, name: 'k' }, key) },
      { s: 'let', name: '_n', expr: word(lit(0)) },
      { s: 'var', name: '_lo', type: u32T, init: lit(0) },
      { s: 'var', name: '_hi', type: u32T, init: ref('_n') },
      {
        s: 'for',
        init: { s: 'var', name: '_s', type: u32T, init: lit(0) },
        cond: cmp('<', ref('_s'), lit(32)),
        update: { s: 'assign', target: ref('_s'), expr: add(ref('_s'), lit(1)) },
        body: [
          { s: 'if', arms: [{ cond: cmp('>=', ref('_lo'), ref('_hi')), body: [{ s: 'break' }] }] },
          {
            s: 'let',
            name: '_mid',
            expr: add(ref('_lo'), {
              op: 'binop',
              type: u32T,
              bop: '/',
              a: { op: 'binop', type: u32T, bop: '-', a: ref('_hi'), b: ref('_lo') },
              b: lit(2),
            }),
          },
          {
            s: 'if',
            arms: [
              {
                cond: cmp('<', word(add(ref('_mid'), lit(1))), ref('_w')),
                body: [{ s: 'assign', target: ref('_lo'), expr: add(ref('_mid'), lit(1)) }],
              },
            ],
            elseBody: [{ s: 'assign', target: ref('_hi'), expr: ref('_mid') }],
          },
        ],
      },
      {
        s: 'if',
        arms: [
          {
            cond: {
              op: 'logical',
              type: boolT,
              lop: '&&',
              a: cmp('<', ref('_lo'), ref('_n')),
              b: cmp('==', word(add(ref('_lo'), lit(1))), ref('_w')),
            },
            body: [{ s: 'return', expr: ref('_lo') }],
          },
        ],
      },
      { s: 'return', expr: lit(NOT_FOUND) },
    ],
  };
}
