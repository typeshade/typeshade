// ═══ Shader DSL: the stepping tree-walk (docs/debugging.md §2.1) ═══
//
// The CPU oracle's walk, re-spelled as a generator that yields at every statement boundary.
// A debug session drives it: each `yield` is a pause carrying the statement about to run and
// the live frame stack, and resuming continues exactly where it stopped.
//
// A THIRD WALK, NOT A THIRD SEMANTICS. Everything that decides a VALUE (the builtin table,
// the GPU stubs, `applyBin`'s integer rules, the saturating float-to-integer conversions,
// `zeroOf`, `FIELD_IDX`) comes from `cpu-runtime.ts`, the single authority `oracle.ts` and
// `cpu-codegen.ts` already share. This file owns only the CONTROL FLOW, which is the half
// that has to suspend. That is the same split the `new Function` twin makes, and it gets the
// same protection, in two files because the corpora live in two places:
// `step-differential.test.ts` sweeps the seeded random-IR corpus, and
// `examples/debug-step.test.ts` sweeps all 44 registered examples; both run every function
// through this walk and `compileModule` and require equality.
//
// The second of those was added after a review found what the first cannot see: `random-ir.ts`
// builds vectors of f32 scalars only, so WGSL's element-CONVERTING constructor `vecN<T>(v:
// vecN<S>)` was never generated, and this walk's `construct` arm had missed the conversion
// that `oracle.ts` applies. A generated corpus is only as wide as its generator; the
// registered examples are as wide as the language the backends accept.
//
// WHY NOT MAKE `oracle.ts` ITSELF A GENERATOR. `docs/debugging.md` §2.5 puts that option
// first and asks for a measurement rather than a guess. `scripts/bench-stepping.ts` is that
// measurement, committed so it can be re-run: a 32-iteration `sin` accumulation loop, 2000
// invocations, nine interleaved repetitions, median reported with the spread.
//
//   new Function codegen       ~0.3 µs / invocation
//   oracle tree-walk          ~13 µs / invocation
//   this generator walk       ~63 µs / invocation
//
// ABOUT FIVE TIMES the tree-walk, and that looseness is the honest form. The script's median
// has come back between 4.7x and 5.8x on different runs of the same tree, and repetitions
// inside one run span roughly 4x to 7x. An earlier version of this comment quoted 3.1x from a
// single run and a reviewer measuring the same thing got 4.1x; neither is wrong so much as
// over-precise. Run the script and read the band it prints rather than trusting this comment.
//
// The conclusion does not turn on the exact multiple: making the reference backend steppable
// would put SOME several-fold cost on every use of it, and `compileModule` is production-used
// and sits under property suites that already run for over a minute. The walk is therefore
// duplicated and differentially gated, which is §2.5's option 3. The multiple is irrelevant
// where it is paid: one invocation is still well under a millisecond, and stepping is for one
// invocation (§1.3), never a frame.
//
// PAUSE POINTS. Before each statement in a body, including the `init` and each `update` of a
// `for`. The condition of an `if`, a `for` or a `switch` is evaluated as part of pausing on
// that statement, never on its own: a shader statement is the unit the author wrote.
//
// A KERNEL FUNCTION'S REDUCTION LOOP is the one loop this walk does not run in iteration order.
// Rule 7.2 folds it in the tree order on every tier, so `execTreeFor` runs it as the oracle's
// `execTreeFor` does, each iteration from the operator's identity, and `kernelTree` folds what
// the iterations left: a stepped run returns what `compileModule` returns (#362). The two
// corpora above never loop over a kernel function's array (a random helper takes none, and
// `debug-step.test.ts` hands an array parameter `0`), so `examples/loop-examples.test.ts` steps
// the registered kernel functions over real arrays, and arm S of
// `src/core/testing/random-kernel-differential.test.ts` steps the generated ones.

import { consoleArgs, consoleTableRows, type ConsoleMethod, type ConsoleSink } from '../console.js';
import type { Expr, FuncDecl, ModuleDecl, ShaderType, Stmt, StructDecl } from '../ir/index.js';
import type { SourceSpan } from '../ir/span.js';
import { parameterLocalsOf } from '../ir/parameter-locals.js';
import {
  type CpuValue,
  FIELD_IDX,
  isArr,
  applyBin,
  BUILTINS,
  GPU_STUBS,
  zeroOf,
  matVecShaped,
  matTransposeShaped,
  matColumn,
  setMatColumn,
  matMulShaped,
  vecMatShaped,
  f32ToU32Sat,
  f32ToI32Sat,
  numKindOf,
  wrapValue,
  elemKindOf,
  convertComponent,
  convertComponents,
  atomicStep,
  compareValues,
  comparesAsF32,
  selectComponents,
  TYPED_BIT_BUILTINS,
  bitBuiltin,
  cloneValue,
  copiedParams,
  isAggregateType,
} from '../cpu-runtime.js';
import { barrierOutsideDispatch, isAtomicIntrinsic, isBarrierIntrinsic } from '../intrinsics.js';
import { kernelTree, reductionIdentity, ScatterRun } from '../kernel-tree.js';
import { fnWrites } from '../passes/effects.js';
import { treeCombine, type LoopReduction, type TreeLoop } from '../passes/parallel-loop.js';

/** One call frame of a paused run, innermost last. Mutable on purpose: the session reads a
 *  frame's `current` at each pause, and a snapshot is taken there rather than here. */
export interface StepFrame {
  readonly fnName: string;
  readonly fnSpan: SourceSpan | undefined;
  /** The span of the call that created this frame; absent on the entry frame. */
  readonly callSpan: SourceSpan | undefined;
  readonly env: Map<string, CpuValue>;
  /** The declared type of every name this frame can hold: its parameters, and every `let` or
   *  `var` its body declares. Without it a pause has values and no way to render them: a
   *  `vec3` and a three-element array are the same `number[]` at runtime. */
  readonly types: ReadonlyMap<string, ShaderType>;
  /** Authored input names mapped to their mutable value locals. */
  readonly parameterLocals?: ReadonlyMap<string, string>;
  /** The names in THIS frame whose current value came, directly or through arithmetic, from a
   *  GPU stub rather than from the shader's own data — `docs/debugging.md` §2.4's "mark it in
   *  the variables view as a stand-in rather than a computed value". Maintained at every
   *  assignment: a name is added when the value assigned to it was stub-derived and removed
   *  when it is next assigned something that was not, so it describes the value a pause is
   *  showing, not the history of the run. */
  readonly stubbed: Set<string>;
  /** The statement this frame is about to execute, set at every pause. */
  current: Stmt | undefined;
}

/** What the interpreter hands the driver at a statement boundary. */
export interface StepEvent {
  readonly stmt: Stmt;
  /** Frame stack, outermost first. Live, so read it before resuming. */
  readonly frames: readonly StepFrame[];
  /** Set on the event yielded when a CALLEE HAS JUST RETURNED and control is back in the
   *  caller, part-way through the statement that made the call. `stmt` is that caller's
   *  statement, and the callee's frame is already gone.
   *
   *  It exists for `stepOut`, which `docs/debugging.md` §2.1 defines as "returns to the same
   *  statement with `f`'s frame gone", so that a following `stepIn` enters the SECOND call of
   *  `return f(x) + g(y)`. Without it a step-out could only be "run until the stack is
   *  shallower", which reaches the caller's NEXT statement and skips `g` entirely.
   *
   *  No other move stops here: `stepIn` and `stepOver` would otherwise stop twice on one
   *  statement, which is not what either means. */
  readonly afterCall?: true;
  /** Set, in a lockstep `dispatch` only, on the two events an atomic operation makes: `'before'`
   *  once its operands are evaluated and before it reads and writes its location, and `'after'`
   *  once it has. `dispatch` holds each invocation at `'before'` and performs the operations of
   *  every invocation of the workgroup in index order before any runs on (change 0054, decision
   *  3a), as the WebGL2 tier's resolve pass does. */
  readonly atomic?: 'before' | 'after';
}

/** Everything the walk needs that is not the program: the module's declarations, the host's
 *  binding values, and the two switches `compileModule` takes. */
export interface StepCtx {
  readonly consts: Map<string, CpuValue>;
  readonly overrides: Map<string, CpuValue>;
  readonly decls: Map<string, FuncDecl>;
  readonly bindings: Record<string, CpuValue>;
  /** The workgroup variables (roadmap 0.2 item 5), zero from `makeCtx`, shared by every
   *  invocation of a workgroup that `dispatch` runs against one context. */
  readonly vars: Record<string, CpuValue>;
  /** The per-invocation (`private`) variables, at their initializers from `makeCtx`: one
   *  table per invocation, which is why they are not in `vars`. */
  readonly privates: Record<string, CpuValue>;
  /** Whether this run is one invocation of a workgroup `dispatch` holds in lockstep, which is
   *  the only run a barrier means anything in. `makeCtx` says no; `dispatch` says yes. */
  readonly lockstep: boolean;
  readonly structs: Map<string, StructDecl>;
  /** The module's declared uniform and storage names, so a binding nobody supplied is NAMED
   *  rather than reported as an unbound local. Since #18 a binding read is a `varref` like any
   *  other name, and this set is what tells the two apart. */
  readonly bindingNames: Set<string>;
  readonly gpuStubs: boolean;
  /** Where a `console.*` call goes (surface §66): `dispatch` passes the sink `compileModule`
   *  took, with the invocation each event came from. Absent, a call delivers nothing. */
  readonly consoleSink?: ConsoleSink;
  readonly invocation?: readonly number[];
  readonly frames: StepFrame[];
  /** The INTRINSICS that stood in at some point during this run, by name: `dpdx`,
   *  `textureSample`.
   *
   *  Not, as this said before a review caught it, "names whose value came from a stub". It
   *  holds `e.fn`, the intrinsic's own name, so it answers whether anything stood in and what,
   *  and cannot distinguish one local from another. For which of a frame's names is currently
   *  showing a stand-in VALUE, which is `docs/debugging.md` §2.4's other half, see
   *  {@link StepFrame.stubbed}. */
  readonly stubbed: Set<string>;
  /** How many times a stub has produced a value, or a stub-derived name has been read, since
   *  the run began. Never read as a total: a statement reads it before and after evaluating an
   *  expression, and a change across those two reads means that expression touched a stub
   *  somewhere inside it, at any depth and through any number of calls. That is what makes
   *  taint propagate without threading a second return value through `evalExpr`. */
  stubHits: number;
  /** Which of each function's by-value parameters it copies as it is entered, as the
   *  interpreter does (`copiedParams`, cpu-runtime.ts). */
  readonly copies: Map<string, readonly boolean[]>;
  /** The loops of a kernel function that fold a reduction in the tree order (Rule 7.2), with
   *  what each reduces: `treeLoops`, as the oracle takes it. Absent, every loop runs in
   *  iteration order. */
  readonly trees?: ReadonlyMap<Stmt, TreeLoop>;
  /** Whether a combine of `f32` rounds to `f32`: the run's precision is `'f32'`. */
  readonly f32?: boolean;
  /** Where each write to memory (a binding or a workgroup variable) is recorded, with how to
   *  undo it and how to do it again. Present only in a phased dispatch (change 0054,
   *  `phased.ts`), which undoes an invocation's writes when its pass ends and does them again,
   *  in invocation order, once every invocation has run: the WebGL2 tier's write log and
   *  scatter. Absent, a write is just a write. */
  readonly journal?: JournalEntry[];
  /** Memory as 32-bit words, for a phase function whose memory `lowerMemoryWords` rewrote
   *  (change 0054): `_phLoad(root, word)` and `_phStore(root, word, bits)` go here. Present
   *  only in the CPU model of the WebGL2 executor. */
  readonly words?: WordMemory;
}

/** What `_phLoad` and `_phStore` read and write. */
export interface WordMemory {
  load(root: number, word: number): number;
  store(root: number, word: number, bits: number): void;
}

/** One write to memory, as {@link StepCtx.journal} records it. */
export interface JournalEntry {
  readonly undo: () => void;
  readonly redo: () => void;
}

/** A generator that yields statement pauses and finally produces `T`. */
export type Step<T> = Generator<StepEvent, T, void>;

/** The non-local exits a body can take, exactly as `oracle.ts` spells them. */
export type Signal =
  | { kind: 'normal' }
  | { kind: 'return'; value: CpuValue | undefined }
  | { kind: 'break' }
  | { kind: 'continue' }
  | { kind: 'discard' };
const NORMAL: Signal = { kind: 'normal' };

/** A binding the module declares and the session was not given a value for. Named rather than
 *  read as a zero: a debugger that invents an input silently answers a question about a
 *  different program. */
const noValueFor = (name: string): Error =>
  new Error(
    `typeshade/debug: no value supplied for binding '${name}'; pass it in the session's bindings`,
  );

export function* evalExpr(e: Expr, env: Map<string, CpuValue>, ctx: StepCtx): Step<CpuValue> {
  switch (e.op) {
    case 'lit':
      return e.value;
    case 'constref': {
      const v = ctx.consts.get(e.name);
      if (v === undefined) throw new Error(`typeshade/debug: unknown const ${e.name}`);
      return v;
      // This arm once also resolved a BINDING named by a constref, because the front end
      // spelled a read of `declare const camera: uniform<Camera>` that way and the oracle
      // therefore threw `unknown const` on any source-compiled module with a binding. #18
      // (issue #14) changed the lowering to a `varref`, so that shape can no longer be built
      // by either surface, and the resolution moved to the `param`/`varref` case above. The
      // workaround is gone rather than kept: unreachable code that answers differently from
      // `oracle.ts` is a divergence nothing exercises, which is exactly what
      // `step-differential.test.ts` exists to prevent.
    }
    case 'overrideref': {
      const v = ctx.overrides.get(e.name);
      if (v === undefined) throw new Error(`typeshade/debug: unknown override ${e.name}`);
      return v;
    }
    case 'externref':
      throw new Error(`typeshade/debug: host-provided global '${e.name}' has no CPU value`);
    case 'param':
    case 'varref': {
      if (env.has(e.name)) {
        if (ctx.frames[ctx.frames.length - 1]?.stubbed.has(e.name)) ctx.stubHits++;
        return env.get(e.name) as CpuValue;
      }
      if (e.name in ctx.bindings) return ctx.bindings[e.name];
      if (e.name in ctx.privates) return ctx.privates[e.name];
      if (e.name in ctx.vars) return ctx.vars[e.name];
      if (ctx.bindingNames.has(e.name)) throw noValueFor(e.name);
      throw new Error(`typeshade/debug: unbound ${e.name}`);
    }
    case 'binop': {
      const av = yield* evalExpr(e.a, env, ctx);
      const bv = yield* evalExpr(e.b, env, ctx);
      // The SHAPE comes from the static type, as it does in the interpreter and the codegen:
      // a flat column-major list cannot tell a mat2x3 from a mat3x2 (#149). All three
      // evaluators dispatch identically, which is what `debug-step.test.ts` checks.
      if (
        e.bop === '*' &&
        e.a.type.kind === 'mat' &&
        (e.b.type.kind === 'vec' || e.b.type.kind === 'vec64')
      ) {
        return matVecShaped(av as number[], bv as number[], e.a.type.cols, e.a.type.rows);
      }
      if (e.bop === '*' && e.a.type.kind === 'mat' && e.b.type.kind === 'mat') {
        return matMulShaped(
          av as number[],
          bv as number[],
          e.a.type.cols,
          e.a.type.rows,
          e.b.type.cols,
        );
      }
      // vecR * matCxR — the row-vector product, `transpose(m) * v`.
      if (e.bop === '*' && e.a.type.kind === 'vec' && e.b.type.kind === 'mat') {
        return vecMatShaped(av as number[], bv as number[], e.b.type.cols, e.b.type.rows);
      }
      return applyBin(e.bop, av, bv, numKindOf(e.type));
    }
    case 'unop': {
      const a = yield* evalExpr(e.a, env, ctx);
      return wrapValue(isArr(a) ? a.map((v) => -(v as number)) : -(a as number), numKindOf(e.type));
    }
    case 'compare': {
      const a = yield* evalExpr(e.a, env, ctx);
      const b = yield* evalExpr(e.b, env, ctx);
      return compareValues(e.cop, a, b, comparesAsF32(e.a.type));
    }
    case 'logical': {
      const a = (yield* evalExpr(e.a, env, ctx)) as boolean;
      if (e.lop === '&&') return a ? ((yield* evalExpr(e.b, env, ctx)) as boolean) : false;
      return a ? true : ((yield* evalExpr(e.b, env, ctx)) as boolean);
    }
    case 'call': {
      // A barrier is where `dispatch` holds the invocation, at the yield before this
      // statement; by the time the statement runs every invocation of the workgroup has
      // arrived, so the call itself is a no-op. A session stepping one invocation alone has
      // no one to wait for, and the values past the barrier would be ones no workgroup
      // produces (the zeros the others never wrote), so it refuses as the oracle does.
      if (e.declRef === undefined && isBarrierIntrinsic(e.fn)) {
        if (!ctx.lockstep) throw barrierOutsideDispatch(e.fn);
        return 0;
      }
      // An atomic builtin takes its first argument as a LOCATION (roadmap 0.2 item 4); the
      // oracle's `evalAtomic` is mirrored here step for step so the two walks stay
      // bit-identical over a kernel that counts with `atomicAdd`.
      if (e.declRef === undefined && isAtomicIntrinsic(e.fn)) return yield* evalAtomic(e, env, ctx);
      if (
        e.declRef === undefined &&
        ctx.words !== undefined &&
        (e.fn === '_phLoad' || e.fn === '_phStore')
      ) {
        const root = (yield* evalExpr(e.args[0]!, env, ctx)) as number;
        const word = (yield* evalExpr(e.args[1]!, env, ctx)) as number;
        if (e.fn === '_phLoad') return ctx.words.load(root, word);
        ctx.words.store(root, word, (yield* evalExpr(e.args[2]!, env, ctx)) as number);
        return undefined as unknown as CpuValue;
      }
      const args: CpuValue[] = [];
      // Measured per argument, so that stepping INTO the callee shows which of its parameters
      // is holding a stand-in. Without it a `dpdx` result crossing a call boundary would go
      // unmarked for the whole of the callee's frame.
      const argStubbed: boolean[] = [];
      // An `inout` argument that is a field or an element is resolved ONCE, read there and
      // written back there, as the oracle's `storeBack` does (Rule 8.25).
      const inoutOf = ctx.decls.get(e.fn)?.params;
      const places: ({ readonly set: (v: CpuValue) => void } | undefined)[] = [];
      for (const [i, a] of e.args.entries()) {
        const before = ctx.stubHits;
        if (inoutOf?.[i]?.mode === 'inout' && (a.op === 'member' || a.op === 'index')) {
          const place = yield* refOf(a, env, ctx);
          places[i] = place;
          args.push(place.get());
        } else args.push(yield* evalExpr(a, env, ctx));
        argStubbed.push(ctx.stubHits > before);
      }
      // A console call computes nothing (Rule 11.9): its arguments are evaluated above, once, in
      // order, and the event goes to the sink when there is one.
      if (e.declRef === undefined && e.fn.startsWith('console.')) {
        ctx.consoleSink?.({
          method: e.fn.slice('console.'.length) as ConsoleMethod,
          args: consoleArgs(
            args,
            e.labels,
            consoleTableRows(
              e.fn.slice('console.'.length),
              e.args.map((a) => a.type),
            ),
          ),
          ...(e.span ? { span: e.span } : {}),
          ...(ctx.invocation ? { invocation: ctx.invocation } : {}),
        });
        return undefined as unknown as CpuValue;
      }
      if (e.fn === 'u32' || e.fn === 'i32') {
        const src = e.args[0]!.type;
        if (src.kind === 'f64' || (src.kind === 'scalar' && src.scalar === 'f32')) {
          return e.fn === 'u32' ? f32ToU32Sat(args[0] as number) : f32ToI32Sat(args[0] as number);
        }
      }
      // `transpose` needs the matrix's shape, which a flat list cannot carry — the same arm
      // the interpreter has, so the stepper and the oracle stay bit-identical (#149).
      if (e.declRef === undefined && e.fn === 'transpose') {
        const t = e.args[0]!.type;
        if (t.kind === 'mat') return matTransposeShaped(args[0] as number[], t.cols, t.rows);
      }
      if (e.declRef === undefined && TYPED_BIT_BUILTINS.has(e.fn)) {
        return bitBuiltin(e.fn, args, elemKindOf(e.args[0]!.type) === 'i32' ? 'i32' : 'u32');
      }
      const b = BUILTINS[e.fn];
      if (b) return wrapValue(b(...args), numKindOf(e.type));
      const stub = GPU_STUBS[e.fn];
      if (stub) {
        if (!ctx.gpuStubs) {
          throw new Error(
            `typeshade/debug: '${e.fn}' is GPU-only and not computable here; start the session with gpuStubs: true to accept placeholder values`,
          );
        }
        ctx.stubbed.add(e.fn);
        ctx.stubHits++;
        return stub(...args);
      }
      const decl = ctx.decls.get(e.fn);
      if (decl) {
        if (!decl.params.some((p) => p.mode === 'inout')) {
          return yield* callFunction(decl, args, e.span, ctx, argStubbed);
        }
        // What each `inout` parameter holds as the callee returns goes back into the place
        // passed there, as the interpreter's `storeBack` does.
        const returned: CpuValue[] = [];
        const value = yield* callFunction(decl, args, e.span, ctx, argStubbed, returned);
        for (const [i, p] of decl.params.entries()) {
          const arg = e.args[i];
          if (p.mode !== 'inout' || arg === undefined) continue;
          if (arg.op === 'varref' || arg.op === 'param') {
            yield* setLValue(arg, returned[i] as CpuValue, env, ctx);
          } else places[i]?.set(returned[i] as CpuValue);
        }
        return value;
      }
      throw new Error(`typeshade/debug: unknown fn ${e.fn}`);
    }
    case 'member': {
      const base = yield* evalExpr(e.base, env, ctx);
      if (isArr(base)) {
        if (e.field.length > 1) return [...e.field].map((c) => base[FIELD_IDX[c]!] as number);
        return base[FIELD_IDX[e.field]] as CpuValue;
      }
      return (base as Record<string, CpuValue>)[e.field];
    }
    case 'construct': {
      if (e.type.kind === 'array') {
        const out: CpuValue[] = [];
        for (const a of e.args) out.push(yield* evalExpr(a, env, ctx));
        return out as CpuValue;
      }
      if (e.type.kind === 'struct') {
        const decl = ctx.structs.get(e.type.name);
        if (decl === undefined)
          throw new Error(`typeshade/debug: struct '${e.type.name}' not declared`);
        const obj: Record<string, CpuValue> = {};
        for (let i = 0; i < decl.fields.length; i++) {
          obj[decl.fields[i]!.name] = yield* evalExpr(e.args[i]!, env, ctx);
        }
        return obj as CpuValue;
      }
      // Vector constructor. Each component is converted to the constructed vector's element
      // kind, exactly as `oracle.ts` does it and out of the same op library: for an ordinary
      // composing constructor every kind already matches and `convertComponent(s)` hands the
      // value back untouched, and for WGSL's element-CONVERTING form `vecN<T>(v: vecN<S>)` it
      // applies the same saturating and reinterpreting rules the scalar cast path applies.
      //
      // Pushing the raw components instead is what the review caught: `vec2u(v)` skipped the
      // saturation, so a stepped `convert-grid:fs` answered -3 where the oracle answers 0.
      const elem = e.type.kind === 'vec' ? e.type.elem : undefined;
      const out: number[] = [];
      for (const a of e.args) {
        const v = yield* evalExpr(a, env, ctx);
        const from = elemKindOf(a.type);
        if (elem === undefined || from === undefined) {
          if (isArr(v)) out.push(...(v as number[]));
          else out.push(v as number);
          continue;
        }
        if (isArr(v)) out.push(...convertComponents(v as number[], from, elem));
        else out.push(convertComponent(v as number, from, elem));
      }
      if ((e.type.kind === 'vec' || e.type.kind === 'vec64') && out.length === 1)
        return new Array(e.type.n as number).fill(out[0]);
      return out;
    }
    case 'select': {
      const c = yield* evalExpr(e.cond, env, ctx);
      if (isArr(c)) {
        const t = yield* evalExpr(e.ifTrue, env, ctx);
        const f = yield* evalExpr(e.ifFalse, env, ctx);
        return selectComponents(c, t, f);
      }
      return c ? yield* evalExpr(e.ifTrue, env, ctx) : yield* evalExpr(e.ifFalse, env, ctx);
    }
    case 'index': {
      const base = (yield* evalExpr(e.base, env, ctx)) as CpuValue[];
      const idx = (yield* evalExpr(e.idx, env, ctx)) as number;
      // `m[j]` is COLUMN j — see matColumn; the three evaluators must agree.
      if (e.base.type.kind === 'mat') return matColumn(base as number[], idx, e.base.type.rows);
      return base[idx];
    }
    case 'matchExpr': {
      const sv = (yield* evalExpr(e.scrutinee, env, ctx)) as number;
      const hit = e.cases.find(([v]) => v === sv);
      return yield* evalExpr(hit ? hit[1] : e.default, env, ctx);
    }
  }
}

/** Push a frame, run the callee's body with pauses, pop. This is what makes "step into" a
 *  frame change rather than a jump: the call site's own span rides on the frame, so a stack
 *  trace can say where each caller stopped. */
export function* callFunction(
  decl: FuncDecl,
  args: readonly CpuValue[],
  callSpan: SourceSpan | undefined,
  ctx: StepCtx,
  stubbedArgs?: readonly boolean[],
  /** Filled, by parameter index, with what each parameter holds as the function returns, for
   *  the caller to store an `inout` one back. Handed back through the call rather than the
   *  interpreter's shared slot: the pause below may run another invocation first. */
  returned?: CpuValue[],
): Step<CpuValue> {
  const r = yield* runFunction(decl, args, callSpan, ctx, stubbedArgs, returned);
  // The callee's frame has been popped by now (`runFunction`'s `finally`), so this event
  // reports the CALLER, stopped part-way through the statement that made the call. See
  // `StepEvent.afterCall`.
  const caller = ctx.frames[ctx.frames.length - 1];
  if (caller?.current) yield { stmt: caller.current, frames: ctx.frames, afterCall: true };
  // A void function invoked as a statement never has its value read, exactly as the oracle
  // bridges `undefined` here.
  return r.kind === 'return' ? (r.value as CpuValue) : (undefined as unknown as CpuValue);
}

/** The same call, handing back the whole {@link Signal} rather than just a value, which is what an
 *  entry point needs, because `discard` is an outcome a fragment debugger has to report and a
 *  returned value cannot express. */
export function* runFunction(
  decl: FuncDecl,
  args: readonly CpuValue[],
  callSpan: SourceSpan | undefined,
  ctx: StepCtx,
  stubbedArgs?: readonly boolean[],
  returned?: CpuValue[],
): Step<Signal> {
  const env = new Map<string, CpuValue>();
  const copies = ctx.copies.get(decl.name);
  decl.params.forEach((p, i) =>
    env.set(p.name, copies?.[i] === true ? cloneValue(args[i]!) : (args[i] as CpuValue)),
  );
  const frame: StepFrame = {
    fnName: decl.name,
    fnSpan: decl.span,
    callSpan,
    env,
    types: declaredTypes(decl),
    parameterLocals: parameterLocalsOf(decl),
    stubbed: new Set(decl.params.filter((_, i) => stubbedArgs?.[i]).map((p) => p.name)),
    current: undefined,
  };
  ctx.frames.push(frame);
  try {
    const signal = yield* execBody(decl.body, env, ctx);
    if (returned !== undefined) decl.params.forEach((p, i) => (returned[i] = env.get(p.name)!));
    return signal;
  } finally {
    ctx.frames.pop();
  }
}

/** The variable an assignment target ultimately writes into: `p` for `p.pos.x`, `out` for
 *  `out[i]`. `undefined` when the target bottoms out in something that is not a name, which
 *  `setLValue` rejects anyway. */
function rootName(target: Expr): string | undefined {
  let e = target;
  for (;;) {
    if (e.op === 'varref' || e.op === 'param') return e.name;
    if (e.op === 'member' || e.op === 'index') {
      e = e.base;
      continue;
    }
    return undefined;
  }
}

/** Whether an assignment to `target` replaces the whole variable, rather than one field or
 *  element of it. It decides whether a clean assignment may CLEAR the mark: `p = vec2(0., 0.)`
 *  replaces everything the stub touched, while `p.x = 0.` leaves `p.y` as it was, and calling
 *  `p` clean on the strength of one component would under-report. Marking stays conservative
 *  in the direction that cannot mislead — it may say "stand-in" about a value that has since
 *  become real, never the reverse. */
function whole(target: Expr): boolean {
  return target.op === 'varref' || target.op === 'param';
}

/** Add or remove one name from the frame's stub-derived set. */
function markStub(
  frame: StepFrame | undefined,
  name: string | undefined,
  derived: boolean,
  canClear: boolean,
): void {
  if (!frame || name === undefined) return;
  if (derived) frame.stubbed.add(name);
  else if (canClear) frame.stubbed.delete(name);
}

/** Whether a write whose target bottoms out in `root` writes memory a phased dispatch logs: a
 *  binding or a workgroup variable, not a local, a parameter or a private variable. */
function isMemoryRoot(root: string | undefined, env: Map<string, CpuValue>, ctx: StepCtx): boolean {
  return (
    root !== undefined &&
    !env.has(root) &&
    !(root in ctx.privates) &&
    (root in ctx.bindings || root in ctx.vars)
  );
}

/** Set `container[key]` to `value`, recording the write in `ctx.journal` when there is one and
 *  `logged` says the container is memory. */
function setSlot(
  container: Record<string | number, CpuValue>,
  key: string | number,
  value: CpuValue,
  ctx: StepCtx,
  logged: boolean,
): void {
  if (ctx.journal !== undefined && logged) {
    const before = container[key] as CpuValue;
    const after = value;
    ctx.journal.push({
      undo: () => {
        container[key] = before;
      },
      redo: () => {
        container[key] = after;
      },
    });
  }
  container[key] = value;
}

/** Write a matrix column, recording the write as {@link setSlot} does. */
function setColumn(
  m: number[],
  j: number,
  rows: number,
  v: number[],
  ctx: StepCtx,
  logged: boolean,
): void {
  if (ctx.journal !== undefined && logged) {
    const before = matColumn(m, j, rows);
    const after = [...v];
    ctx.journal.push({
      undo: () => setMatColumn(m, j, rows, before),
      redo: () => setMatColumn(m, j, rows, after),
    });
  }
  setMatColumn(m, j, rows, v);
}

/** The stepping twin of the oracle's `refOf`: one resolved read-and-write handle on an atomic
 *  location, so the index expression is evaluated once. */
function* refOf(
  target: Expr,
  env: Map<string, CpuValue>,
  ctx: StepCtx,
): Step<{ readonly get: () => CpuValue; readonly set: (v: CpuValue) => void }> {
  if (target.op === 'varref' || target.op === 'param') {
    const name = target.name;
    if (env.has(name))
      return { get: () => env.get(name) as CpuValue, set: (v) => env.set(name, v) };
    for (const table of [ctx.privates, ctx.vars, ctx.bindings]) {
      if (name in table) {
        return {
          get: () => table[name] as CpuValue,
          set: (v) => setSlot(table, name, v, ctx, table !== ctx.privates),
        };
      }
    }
    if (ctx.bindingNames.has(name)) throw noValueFor(name);
    throw new Error(`typeshade/debug: unbound ${name}`);
  }
  if (target.op === 'member') {
    const base = yield* evalExpr(target.base, env, ctx);
    const key: string | number = isArr(base) ? FIELD_IDX[target.field]! : target.field;
    const obj = base as unknown as Record<string | number, CpuValue>;
    const logged = isMemoryRoot(rootName(target), env, ctx);
    return {
      get: () => obj[key] as CpuValue,
      set: (v) => setSlot(obj, key, v, ctx, logged),
    };
  }
  if (target.op === 'index') {
    const base = (yield* evalExpr(target.base, env, ctx)) as CpuValue[];
    const i = (yield* evalExpr(target.idx, env, ctx)) as number;
    const logged = isMemoryRoot(rootName(target), env, ctx);
    // A matrix's column, as the oracle's `refOf` resolves it (Rule 8.25).
    if (target.base.type.kind === 'mat') {
      const rows = target.base.type.rows;
      return {
        get: () => matColumn(base as number[], i, rows),
        set: (v) => setColumn(base as number[], i, rows, v as number[], ctx, logged),
      };
    }
    const slots = base as unknown as Record<number, CpuValue>;
    return {
      get: () => base[i] as CpuValue,
      set: (v) => setSlot(slots, i, v, ctx, logged),
    };
  }
  throw new Error(`typeshade/debug: bad atomic location ${target.op}`);
}

function* evalAtomic(
  e: Extract<Expr, { op: 'call' }>,
  env: Map<string, CpuValue>,
  ctx: StepCtx,
): Step<CpuValue> {
  const loc = e.args[0];
  if (loc === undefined) throw new Error(`typeshade/debug: ${e.fn} needs a location`);
  const ref = yield* refOf(loc, env, ctx);
  const arg = e.args[1] === undefined ? 0 : ((yield* evalExpr(e.args[1], env, ctx)) as number);
  const store =
    e.args[2] === undefined ? undefined : ((yield* evalExpr(e.args[2], env, ctx)) as number);
  const at = ctx.frames.at(-1)?.current;
  if (ctx.lockstep && at !== undefined) yield { stmt: at, frames: ctx.frames, atomic: 'before' };
  const step = atomicStep(e.fn, ref.get() as number, arg, numKindOf(loc.type), store);
  if (e.fn !== 'atomicLoad') ref.set(step.next);
  if (ctx.lockstep && at !== undefined) yield { stmt: at, frames: ctx.frames, atomic: 'after' };
  return step.result;
}

function* setLValue(
  target: Expr,
  value: CpuValue,
  env: Map<string, CpuValue>,
  ctx: StepCtx,
): Step<void> {
  if (target.op === 'varref' || target.op === 'param') {
    // The oracle's rule: a module-level name not shadowed by a local is written in the
    // module's own table.
    if (!env.has(target.name)) {
      for (const table of [ctx.privates, ctx.vars, ctx.bindings]) {
        if (target.name in table) {
          setSlot(table, target.name, value, ctx, table !== ctx.privates);
          return;
        }
      }
    }
    env.set(target.name, value);
    return;
  }
  if (target.op === 'member') {
    const base = yield* evalExpr(target.base, env, ctx);
    const logged = isMemoryRoot(rootName(target), env, ctx);
    if (isArr(base)) {
      setSlot(
        base as unknown as Record<number, CpuValue>,
        FIELD_IDX[target.field]!,
        value,
        ctx,
        logged,
      );
    } else setSlot(base as Record<string, CpuValue>, target.field, value, ctx, logged);
    return;
  }
  if (target.op === 'index') {
    const base = (yield* evalExpr(target.base, env, ctx)) as CpuValue[];
    const idx = (yield* evalExpr(target.idx, env, ctx)) as number;
    const logged = isMemoryRoot(rootName(target), env, ctx);
    // `m[j] = v` writes COLUMN j into the flat list — see setMatColumn.
    if (target.base.type.kind === 'mat') {
      setColumn(base as number[], idx, target.base.type.rows, value as number[], ctx, logged);
      return;
    }
    setSlot(base as unknown as Record<number, CpuValue>, idx, value, ctx, logged);
    return;
  }
  throw new Error(`typeshade/debug: bad assignment target ${target.op}`);
}

/** A value about to be STORED under a name, copied when it is an aggregate: the rule
 *  `oracle.ts` (`bindValue`) and the codegen (`bindExpr`) apply at every `let`, `var` and
 *  assignment, because both GPU targets store a copy. The stepper bound the same object
 *  instead, so `const before = p` followed by `p.bump()`, a method that changes its object in
 *  place (§26), showed `before` bumped here and not on the GPU or on the other two paths. */
function bindValue(v: CpuValue, t: ShaderType): CpuValue {
  return isAggregateType(t) ? cloneValue(v) : v;
}

export function* execBody(
  body: readonly Stmt[],
  env: Map<string, CpuValue>,
  ctx: StepCtx,
): Step<Signal> {
  const frame = ctx.frames[ctx.frames.length - 1];
  for (const s of body) {
    if (frame) frame.current = s;
    yield { stmt: s, frames: ctx.frames };
    switch (s.s) {
      case 'let': {
        const before = ctx.stubHits;
        env.set(s.name, bindValue(yield* evalExpr(s.expr, env, ctx), s.expr.type));
        markStub(frame, s.name, ctx.stubHits > before, true);
        break;
      }
      case 'var': {
        const before = ctx.stubHits;
        env.set(
          s.name,
          s.init
            ? bindValue(yield* evalExpr(s.init, env, ctx), s.type)
            : zeroOf(s.type, ctx.structs),
        );
        markStub(frame, s.name, ctx.stubHits > before, true);
        break;
      }
      case 'assign': {
        const before = ctx.stubHits;
        const value = bindValue(yield* evalExpr(s.expr, env, ctx), s.expr.type);
        // Measured across `setLValue` too, so the target's OWN base and index expressions
        // count: in `out[i] = 1.` the `1.` is real but, if `i` is a stand-in, the element it
        // landed in is fiction and `out` is no longer trustworthy. Marking it is the
        // conservative direction.
        yield* setLValue(s.target, value, env, ctx);
        markStub(frame, rootName(s.target), ctx.stubHits > before, whole(s.target));
        break;
      }
      case 'assignOp': {
        const before = ctx.stubHits;
        const cur = yield* evalExpr(s.target, env, ctx);
        const kind = numKindOf(s.target.type);
        const rhs = yield* evalExpr(s.expr, env, ctx);
        // The old value is an input here, so a `+=` onto a stub-derived name stays stub-derived
        // whatever the right-hand side is — which the read of `s.target` above already counted.
        yield* setLValue(s.target, applyBin(s.bop, cur, rhs, kind), env, ctx);
        markStub(frame, rootName(s.target), ctx.stubHits > before, whole(s.target));
        break;
      }
      case 'return':
        return { kind: 'return', value: s.expr ? yield* evalExpr(s.expr, env, ctx) : undefined };
      case 'break':
        return { kind: 'break' };
      case 'continue':
        return { kind: 'continue' };
      case 'discard':
        return { kind: 'discard' };
      case 'call':
        // Evaluated for its effect; the value is dropped. The callee's own statements step
        // through this same loop, so a binding it writes is marked there.
        yield* evalExpr(s.expr, env, ctx);
        break;
      case 'if': {
        let taken = false;
        for (const arm of s.arms) {
          if (yield* evalExpr(arm.cond, env, ctx)) {
            const r = yield* execBody(arm.body, env, ctx);
            if (r.kind !== 'normal') return r;
            taken = true;
            break;
          }
        }
        if (!taken && s.elseBody) {
          const r = yield* execBody(s.elseBody, env, ctx);
          if (r.kind !== 'normal') return r;
        }
        break;
      }
      case 'for': {
        const tree = ctx.trees?.get(s);
        if (tree !== undefined) {
          const r = yield* execTreeFor(s, tree, env, ctx);
          if (r !== undefined) return r;
          break;
        }
        yield* execBody([s.init], env, ctx);
        while (yield* evalExpr(s.cond, env, ctx)) {
          const r = yield* execBody(s.body, env, ctx);
          if (r.kind === 'break') break;
          if (r.kind === 'return' || r.kind === 'discard') return r;
          yield* execBody([s.update], env, ctx);
        }
        break;
      }
      case 'switch': {
        const v = (yield* evalExpr(s.scrut, env, ctx)) as number;
        // A clause may hold SEVERAL selectors (`case 0, 1:` in WGSL), so the match is
        // membership, not equality.
        const hit = s.cases.find((c) => c.values.includes(v));
        const chosen = hit ? hit.body : s.defaultBody;
        if (chosen) {
          const r = yield* execBody(chosen, env, ctx);
          if (r.kind !== 'normal' && r.kind !== 'break') return r;
        }
        break;
      }
      case 'placeholder':
        throw new Error(
          `typeshade/debug: placeholder Stmt reached the stepping backend; composer forgot to splice tag=${s.tag}`,
        );
      case 'raw':
        throw new Error(
          'typeshade/debug: raw Stmt reached the stepping backend; raw passthrough is GPU-only',
        );
    }
  }
  return NORMAL;
}

/** A kernel function's reduction loop (Rule 7.2), stepped: the oracle's `execTreeFor`, which
 *  the differential gates hold this to. Each iteration starts from the operator's identity in
 *  each variable the loop reduces, as one of the GPU's invocations does, so a pause inside the
 *  loop shows the variable as that invocation holds it, not a running total. What each iteration
 *  leaves is collected as its body ends, before its update pauses; when the loop is over, the
 *  variable becomes what it held before combined with the collection folded in the tree order
 *  (`kernel-tree.ts`), and a loop that ran no iteration leaves it as it was. The proof leaves no
 *  `return` and no `break` of the loop's own, so only a `discard` leaves early.
 *
 *  A variable's stub mark (`StepFrame.stubbed`) is left as it is through all of this: it says a
 *  value came from a stand-in, and the marks are allowed to say so of a value that has since become
 *  real, so the identity a pause shows may carry the mark of what an earlier iteration read. */
function* execTreeFor(
  s: Stmt & { s: 'for' },
  loop: TreeLoop,
  env: Map<string, CpuValue>,
  ctx: StepCtx,
): Step<Signal | undefined> {
  const { reductions } = loop;
  const saved = reductions.map((r) => env.get(r.name) as CpuValue);
  const bags = reductions.map((): CpuValue[] => []);
  const identity = (r: LoopReduction) => (): CpuValue => reductionIdentity(r.op, r.type);
  // `treeCombine`'s expression, evaluated by this walk's `evalExpr` as the oracle's is by its own.
  // It calls nothing the module declares, so evaluating it never pauses.
  const combine = (r: LoopReduction) => {
    const e = treeCombine(r, ctx.f32 ?? false);
    return (a: CpuValue, b: CpuValue): CpuValue =>
      drain(
        evalExpr(
          e,
          new Map([
            ['$ta', a],
            ['$tb', b],
          ]),
          ctx,
        ),
      );
  };
  // The scatter targets (change 0056, option C): read and written through the run's view, as the
  // oracle's `execTreeFor` does, so a pause inside shows the target as this iteration holds it.
  const scatter = loop.scatters;
  const arrays = scatter.map((n) => env.get(n) as number[]);
  const run = scatter.length === 0 ? undefined : new ScatterRun(arrays, ctx.f32 ?? false);
  scatter.forEach((n, j) => env.set(n, run!.view(j)));
  const leave = (): void => {
    if (run === undefined) return;
    run.finish();
    scatter.forEach((n, j) => env.set(n, run.real(j)));
  };
  yield* execBody([s.init], env, ctx);
  while (yield* evalExpr(s.cond, env, ctx)) {
    reductions.forEach((r) => env.set(r.name, identity(r)()));
    const res = yield* execBody(s.body, env, ctx);
    reductions.forEach((r, k) => bags[k]!.push(env.get(r.name) as CpuValue));
    run?.end();
    if (res.kind === 'return' || res.kind === 'discard') {
      leave();
      return res;
    }
    yield* execBody([s.update], env, ctx);
  }
  reductions.forEach((r, k) => {
    const c = combine(r);
    const folded = kernelTree(bags[k]!, c, identity(r));
    env.set(r.name, folded === undefined ? saved[k]! : c(saved[k]!, folded));
  });
  leave();
  return undefined;
}

/** Build the evaluation context for `m`, with module constants already evaluated. The consts
 *  walk is not steppable: a module constant is fixed before any entry point runs, so there is
 *  no invocation to pause inside. Its pauses are drained rather than reported. */
export function makeCtx(m: ModuleDecl, gpuStubs: boolean): StepCtx {
  const writes = fnWrites(m);
  const ctx: StepCtx = {
    consts: new Map<string, CpuValue>(),
    overrides: new Map<string, CpuValue>((m.overrides ?? []).map((o) => [o.name, o.default])),
    decls: new Map(m.funcs.map((f) => [f.name, f])),
    copies: new Map(
      m.funcs.map((f) => [f.name, copiedParams(f.params, (writes.get(f.name)?.size ?? 0) > 0)]),
    ),
    bindings: {},
    vars: {},
    privates: {},
    lockstep: false,
    structs: new Map(m.structs.map((s) => [s.name, s])),
    bindingNames: new Set(m.bindings.map((b) => b.name)),
    gpuStubs,
    stubHits: 0,
    frames: [],
    stubbed: new Set<string>(),
  };
  for (const c of m.consts) {
    ctx.consts.set(c.name, c.valueExpr ? drain(evalExpr(c.valueExpr, new Map(), ctx)) : c.cpuValue);
  }
  // A session is one invocation of one workgroup: workgroup memory starts zero and a private
  // variable at its initializer, evaluated the way a const is. `dispatch` rebuilds the private
  // table per invocation and the workgroup table per workgroup from the same rule.
  for (const v of m.vars ?? []) {
    if (v.space === 'private') {
      ctx.privates[v.name] = v.init
        ? drain(evalExpr(v.init, new Map(), ctx))
        : zeroOf(v.type, ctx.structs);
    } else {
      ctx.vars[v.name] = zeroOf(v.type, ctx.structs);
    }
  }
  return ctx;
}

/** Every name a call to `decl` can hold, with the type it was declared at: the parameters,
 *  then every `let` and `var` in the body, at every depth.
 *
 *  Flat, because the evaluator's environment is: `oracle.ts` keeps one `Map` per call with no
 *  per-block child scope, since the only way to reference a binding is the node the builder
 *  returned and the host language already scoped that lexically. A name declared twice in two
 *  sibling blocks therefore has one entry here, the last one seen, the same conflation the
 *  environment itself makes, so the type a pause reports always matches the value beside it.
 *
 *  Computed once per frame push. A body is walked in full, which is linear in its statements
 *  and happens once per call rather than once per pause.
 */
function declaredTypes(decl: FuncDecl): ReadonlyMap<string, ShaderType> {
  const out = new Map<string, ShaderType>();
  for (const p of decl.params) out.set(p.name, p.type);
  const walk = (body: readonly Stmt[]): void => {
    for (const s of body) {
      switch (s.s) {
        case 'let':
          out.set(s.name, s.expr.type);
          break;
        case 'var':
          out.set(s.name, s.type);
          break;
        case 'if':
          for (const arm of s.arms) walk(arm.body);
          if (s.elseBody) walk(s.elseBody);
          break;
        case 'for':
          walk([s.init]);
          walk([s.update]);
          walk(s.body);
          break;
        case 'switch':
          for (const c of s.cases) walk(c.body);
          if (s.defaultBody) walk(s.defaultBody);
          break;
        default:
          break;
      }
    }
  };
  walk(decl.body);
  return out;
}

/** Run a generator to completion, discarding its pauses. */
export function drain<T>(g: Step<T>): T {
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}
