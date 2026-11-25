import type { ShaderType } from './types.js';
import type { SourceSpan } from './span.js';
import type { DeclarableCapability } from './nodes/capabilities.js';
import type { BinOp, CmpOp, LogOp } from './nodes/operators.js';
import type { StructDecl } from './nodes/struct-decl.js';
import type { OverrideDecl, BindingDecl, ExternVarDecl } from './nodes/host-interface-decls.js';
import type { DiagnosticDirective, WorkgroupShape } from './nodes/entry-and-directive.js';
export type {
  DiagnosticDirective,
  WorkgroupShape,
  EntryParam,
} from './nodes/entry-and-directive.js';
export type {
  OverrideDecl,
  AddressSpace,
  BindingDecl,
  ExternVarDecl,
} from './nodes/host-interface-decls.js';
export type { StructField, StructDecl } from './nodes/struct-decl.js';
export type { BinOp, CmpOp, LogOp } from './nodes/operators.js';
export { ALL_CAPABILITIES } from './nodes/capabilities.js';
export type { Capability, DeclarableCapability } from './nodes/capabilities.js';

/** Every expression shape the IR can hold: the closed set that {@link Node} and
 *  {@link ReadonlyNode} build and that the WGSL, GLSL and CPU backends walk to emit or
 *  evaluate. It is a discriminated union on `op` with no methods, so a pass can
 *  pattern-match it exhaustively (tsc reports a missing `case` in a backend's switch) and
 *  share subtrees freely. Every variant carries its own `type: ShaderType`: the IR is
 *  fully typed when it is built, and a backend never re-infers a type while emitting. You
 *  do not build these object literals by hand; the fluent methods on `Node` (`.add()`,
 *  `.mul()`, …) and the free functions such as {@link vec4} and {@link mod} fill in
 *  `type` and validate the operands before the shape is constructed.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export type Expr =
  | { readonly op: 'lit'; readonly type: ShaderType; readonly value: number | boolean }
  | { readonly op: 'constref'; readonly type: ShaderType; readonly name: string }
  // A read of a pipeline SPECIALIZATION CONSTANT (X-GIS #923) — a `ModuleDecl.overrides`
  // entry. Structurally a named leaf like `constref`, but SEMANTICALLY OPAQUE to the
  // authoring-time optimizer: its value is fixed at PIPELINE CREATION (WGSL `constants:
  // {}` / a GLSL `#define` per permutation), NOT module build, so const-fold /
  // const-prop / dead-branch must treat it as symbolic and preserve every branch it
  // guards for the DRIVER to eliminate (same opacity discipline as the df64 `one`
  // guard). Its own `op` — not reused `constref` — precisely so no pass ever folds it
  // (a future "inline a known-value const" pass could legally fold a real constref;
  // it can never fold an overrideref). Emits as the bare name on both backends
  // (WGSL: the `override` identifier; GLSL: the `#define` macro).
  | { readonly op: 'overrideref'; readonly type: ShaderType; readonly name: string }
  // A read of a HOST-PROVIDED global (X-GIS #1713) — a `ModuleDecl.externs` entry. The variable
  // twin of `externFn`: the host's prelude (MapLibre's injected GLSL globals, a host-owned
  // WGSL bind group) declares it, we only reference it, and the module emits NO
  // declaration for it. Its own `op` — not a reused `varref` — for three reasons that a
  // shared node cannot serve: `varref` names are function-SCOPED for mangling and would be
  // renamed; the GLSL stage scope intersects `RefSet.vars` against `m.bindings` to decide
  // which bindings a stage keeps, and a host global is in neither set; and `reflect()` has
  // to report it under `requires` rather than as a binding. Emits as the bare name, or as
  // the per-target spelling when the host spells it differently on each backend.
  | { readonly op: 'externref'; readonly type: ShaderType; readonly name: string }
  | {
      readonly op: 'param';
      readonly type: ShaderType;
      readonly name: string;
      /** Where this was written, when it is the TARGET of an assignment — the lvalue a
       *  statement is about to write, so a debugger can highlight what changes rather than the
       *  whole line. A read of the same name carries none in this increment. Read it with
       *  {@link sourceSpanOf}. */
      readonly span?: SourceSpan;
    }
  | {
      readonly op: 'varref';
      readonly type: ShaderType;
      readonly name: string;
      /** Where this was written, when it is the TARGET of an assignment — the lvalue a
       *  statement is about to write, so a debugger can highlight what changes rather than the
       *  whole line. An authored workgroup-variable read also carries its span for stage
       *  diagnostics; it adds no debugger step. Read it with {@link sourceSpanOf}. */
      readonly span?: SourceSpan;
    }
  | {
      readonly op: 'binop';
      readonly type: ShaderType;
      readonly bop: BinOp;
      readonly a: Expr;
      readonly b: Expr;
    }
  | { readonly op: 'unop'; readonly type: ShaderType; readonly a: Expr }
  | {
      readonly op: 'compare';
      readonly type: ShaderType;
      readonly cop: CmpOp;
      readonly a: Expr;
      readonly b: Expr;
    }
  | {
      readonly op: 'logical';
      readonly type: ShaderType;
      readonly lop: LogOp;
      readonly a: Expr;
      readonly b: Expr;
    }
  // `declRef` (present only on calls made through a real FnHandle — absent on externFn /
  // raw callFn string calls) points at the callee's FuncDecl so module() can auto-collect
  // transitively-called fns and key-naming can rewrite call spellings. NEVER read by the
  // emit path (the spelling stays `fn`), never serialized, dropped freely by pass rewrites
  // (collection runs at assembly time, before any pass).
  | {
      readonly op: 'call';
      readonly type: ShaderType;
      readonly fn: string;
      readonly args: readonly Expr[];
      readonly declRef?: FuncDecl;
      /** Where this call was written, when it is the outermost call node lowered from a
       *  `ts.CallExpression`. Stepping into a helper has to tell two calls in one statement
       *  apart, which is why this expression kind carries a span at all. A call the front end
       *  synthesises while expanding one (the `random` hash, an array higher-order function,
       *  a `Math.*` expansion, a numeric cast) carries none, because it was written nowhere.
       *  Read it with {@link sourceSpanOf}. */
      readonly span?: SourceSpan;
      /** On a `console.*` call whose author wrote a string literal among the arguments: every
       *  argument in the order written, a string for a label and a number for the index of a
       *  value in `args`. A label has no GPU representation and is never an `Expr`; it lives
       *  here, on the host's side of the call (Rule 7.8, surface §66). Absent when every
       *  argument is a value, which is then `args` in order. */
      readonly labels?: readonly (string | number)[];
    }
  | {
      readonly op: 'member';
      readonly type: ShaderType;
      readonly base: Expr;
      readonly field: string;
    }
  | { readonly op: 'construct'; readonly type: ShaderType; readonly args: readonly Expr[] }
  | {
      readonly op: 'select';
      readonly type: ShaderType;
      readonly cond: Expr;
      readonly ifTrue: Expr;
      readonly ifFalse: Expr;
    }
  | {
      readonly op: 'index';
      readonly type: ShaderType;
      readonly base: Expr;
      readonly idx: Expr;
      /** Where this was written, when it is the TARGET of an assignment — the lvalue a
       *  statement is about to write, so a debugger can highlight what changes rather than the
       *  whole line. A read of the same name carries none in this increment. Read it with
       *  {@link sourceSpanOf}. */
      readonly span?: SourceSpan;
    }
  // `match (scrutinee) { case v0: e0; ...; default: dflt }`. The WGSL backend
  // pre-emit pass (core/passes/match-lower.ts) lowers every matchExpr inside
  // an fn body into a hoisted `{ Stmt.var slot, Stmt.switch }` pair + a
  // varref to the slot; emitExpr never sees a `matchExpr` Expr post-lowering.
  // The CPU backend evaluates the scrutinee then returns the matched case's
  // value or the default. Phase 2.5 (US-001).
  | {
      readonly op: 'matchExpr';
      readonly type: ShaderType;
      readonly scrutinee: Expr;
      readonly cases: ReadonlyArray<readonly [number, Expr]>;
      readonly default: Expr;
    };

/** Every statement shape the IR can hold: the ordered `readonly Stmt[]` that makes up a
 *  `FuncDecl.body`. Like {@link Expr}, it is a discriminated union (on `s`) with no class
 *  behind it, so tsc checks a backend's emit switch for exhaustiveness and a pass can
 *  rebuild a body by mapping over plain data. You do not build these object literals
 *  directly; the {@link Builder} handed to an {@link fn} body as its second callback
 *  argument pushes them one at a time (`b.let(...)`, `b.var(...)`, `b.if(...)`,
 *  `b.ret(...)`, …), so a body is always assembled in source order.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export type Stmt =
  | {
      readonly s: 'let';
      readonly name: string;
      readonly expr: Expr;
      /** Where this statement came from in its authored `"use typeshade"` source; absent on
       *  an EDSL-authored or pass-synthesised statement. Read it with {@link sourceSpanOf}. */
      readonly span?: SourceSpan;
    }
  | {
      readonly s: 'var';
      readonly name: string;
      readonly type: ShaderType;
      readonly init?: Expr;
      /** Where this statement came from in its authored `"use typeshade"` source; absent on
       *  an EDSL-authored or pass-synthesised statement. Read it with {@link sourceSpanOf}. */
      readonly span?: SourceSpan;
    }
  | {
      readonly s: 'assign';
      readonly target: Expr;
      readonly expr: Expr;
      /** Where this statement came from in its authored `"use typeshade"` source; absent on
       *  an EDSL-authored or pass-synthesised statement. Read it with {@link sourceSpanOf}. */
      readonly span?: SourceSpan;
    }
  | {
      readonly s: 'assignOp';
      readonly target: Expr;
      readonly bop: BinOp;
      readonly expr: Expr;
      /** Where this statement came from in its authored `"use typeshade"` source; absent on
       *  an EDSL-authored or pass-synthesised statement. Read it with {@link sourceSpanOf}. */
      readonly span?: SourceSpan;
    }
  | {
      readonly s: 'if';
      readonly arms: ReadonlyArray<{ readonly cond: Expr; readonly body: readonly Stmt[] }>;
      readonly elseBody?: readonly Stmt[];
      /** Where this statement came from in its authored `"use typeshade"` source; absent on
       *  an EDSL-authored or pass-synthesised statement. Read it with {@link sourceSpanOf}. */
      readonly span?: SourceSpan;
    }
  | {
      readonly s: 'return';
      readonly expr?: Expr;
      /** Where this statement came from in its authored `"use typeshade"` source; absent on
       *  an EDSL-authored or pass-synthesised statement. Read it with {@link sourceSpanOf}. */
      readonly span?: SourceSpan;
    }
  | {
      readonly s: 'for';
      readonly init: Stmt;
      readonly cond: Expr;
      readonly update: Stmt;
      readonly body: readonly Stmt[];
      /** What the front end proved counts this loop (Rule 7.5): present on a `for` and a
       *  `for…of` it lowered, absent on a `while`, which is a `for` over a synthetic counter,
       *  and on a pass-synthesised loop. The independence proof of a kernel function's loop
       *  (Rule 8.22) reads it rather than guessing from the counter's name. */
      readonly counted?: {
        /** The counter's IR name. */
        readonly name: string;
        readonly op: 'add' | 'mul' | 'div';
        /** The addend of an additive step (`i++` is `1`, `i -= 2` is `-2`), and the factor or
         *  divisor of a multiplicative one. */
        readonly step: number;
        /** Present when the header folds to constants, absent for a runtime start or bound. */
        readonly start?: number;
        readonly bound?: number;
        readonly trips?: number;
      };
      /** Where this statement came from in its authored `"use typeshade"` source; absent on
       *  an EDSL-authored or pass-synthesised statement. Read it with {@link sourceSpanOf}. */
      readonly span?: SourceSpan;
    }
  | {
      readonly s: 'switch';
      readonly scrut: Expr;
      /** One clause per entry. `values` is the SELECTORS that share the clause's body, in
       *  source order: WGSL spells them `case 0, 1: { … }` and GLSL ES 3.00
       *  `case 0: case 1: { … }`, which is why the IR carries the list rather than one
       *  number and a fall-through. Never empty. */
      readonly cases: ReadonlyArray<{
        readonly values: readonly number[];
        readonly body: readonly Stmt[];
      }>;
      readonly defaultBody?: readonly Stmt[];
      /** Where this statement came from in its authored `"use typeshade"` source; absent on
       *  an EDSL-authored or pass-synthesised statement. Read it with {@link sourceSpanOf}. */
      readonly span?: SourceSpan;
    }
  | { readonly s: 'break'; readonly span?: SourceSpan }
  | { readonly s: 'continue'; readonly span?: SourceSpan }
  | { readonly s: 'discard'; readonly span?: SourceSpan }
  | {
      /** A call kept for its effect and nothing else: `store(gid.x);` today, and the
       *  `workgroupBarrier();`, `textureStore(...)` and `atomicAdd(...)` family it makes a place
       *  for. `expr` is the `call` the front end lowered; an op other than `call` reaches here
       *  only through a pass that folded one, and both emitters still spell it. WGSL takes a
       *  user function's dropped result bare and needs `_ = ` before a value-returning builtin;
       *  GLSL ES 3.00 takes the bare call in every case; the CPU backends evaluate it for its
       *  effect. A pass that assumes expressions are pure must treat this statement as the
       *  one place an effect is kept on purpose (see `passes/effects.ts`). */
      readonly s: 'call';
      readonly expr: Expr;
      /** Where this statement came from in its authored `"use typeshade"` source; absent on
       *  an EDSL-authored or pass-synthesised statement. Read it with {@link sourceSpanOf}. */
      readonly span?: SourceSpan;
    }
  // Phase 2.5 US-007 — composer-swap marker. The polygon DSL module
  // (shaders/polygon.ts) lays down a placeholder Stmt at each
  // variant-injection site (`fill-return` / `stroke-return`); the
  // composer (emitPolygonWgsl) walks the cloned module and replaces
  // each placeholder with the variant's fill-/stroke- return expr.
  // emitStmt emits a defensive `// __placeholder: ${tag}` comment if
  // a placeholder leaks past the composer; the CPU backend throws
  // (the comment would silently no-op a missing return). The
  // lowerModule pre-emit pass treats placeholder as a leaf — no
  // matchExpr lowering descends into it.
  | { readonly s: 'placeholder'; readonly tag: string; readonly span?: SourceSpan }
  // Phase 2 PR 2e.B.2 — raw passthrough. Carries a pre-built target
  // fragment emitted verbatim (at the enclosing body indent) before the
  // surrounding statements. Used by the polygon composer's fill/stroke
  // preamble slot to inject the compiler-emitted match `_mcSS` chain
  // string directly, retiring the renderer's former post-emit string
  // splice (+ the compiler-side nodeToWgslString copy). GPU-only: the
  // CPU backend throws (raw text has no CPU evaluation), and the
  // lowerModule pass treats it as a leaf (no sub-Expr to lower).
  //
  // X-GIS #1671 — PAIRED PER-TARGET PAYLOADS. One node carries the SAME statement
  // spelled for each backend; the MEANING is fixed ("splice verbatim here")
  // and only the SPELLING is per-target — the same per-target-spelling pattern
  // `INTRINSICS`' `Spelling` record already uses (intrinsics.ts:15-19). Unlike
  // `Spelling` (which requires BOTH sides), ONE side may be omitted here — a
  // deliberate "this module does not build for that target" — but AT LEAST ONE
  // side is required at the type level, which is why this is spelled as two
  // members: a raw with NO payload is unrepresentable.
  // Each backend emits ITS side and fails closed (SD0030) when its side is
  // absent — SYMMETRICALLY: a wgsl-only raw throws on the GLSL backend and a
  // glsl-only raw throws on the WGSL one. A one-sided raw is therefore still
  // a hard "this module does not build for that target", never a silent
  // mis-emit.
  | { readonly s: 'raw'; readonly wgsl: string; readonly glsl?: string; readonly span?: SourceSpan }
  | {
      readonly s: 'raw';
      readonly wgsl?: string;
      readonly glsl: string;
      readonly span?: SourceSpan;
    };

/** The `raw` statement node: a fragment of target source spliced verbatim into a
 *  function body, spelled per target. It carries a `wgsl` side, a `glsl` side, or both,
 *  and at least one is required. A {@link Backend} receives the whole node in its
 *  `rawStmt` method and emits its own side; when that side is absent it throws `SD0030`,
 *  so a one-sided raw statement means "this module does not build for that target" and
 *  never emits the wrong text. The CPU backend throws on every raw statement, since raw
 *  text has no CPU evaluation. Build one with {@link rawStmt}. */
export type RawStmt = Extract<Stmt, { s: 'raw' }>;

/** The argument to {@link rawStmt}: the `wgsl` and `glsl` source text of a raw
 *  statement. At least one side is required, so `rawStmt({})` does not compile. */
export type RawPayload =
  | { readonly wgsl: string; readonly glsl?: string }
  | { readonly wgsl?: string; readonly glsl: string };

/** A `ModuleDecl.consts` entry: a module-scope constant. For a scalar, write a plain
 *  object literal with one value per precision, for example
 *  `{ name: 'PI', type: f32T, wgslValue: 3.14159265, cpuValue: Math.PI }`: the WGSL and
 *  GLSL backends emit `wgslValue`, and the CPU backend, which runs the module in double
 *  precision, uses `cpuValue`. For a vector, array or struct constant use
 *  {@link constExpr}, which fills `valueExpr` instead. When both forms are present,
 *  `valueExpr` wins.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export interface ConstDecl {
  readonly name: string;
  readonly type: ShaderType;
  /** Scalar value emitted by the WGSL/GLSL backends (the truncated shader
   *  constant). Used when `valueExpr` is absent; ignored otherwise. */
  readonly wgslValue: number;
  /** Scalar value used by the CPU backend, at full double precision. Used when
   *  `valueExpr` is absent; ignored otherwise. */
  readonly cpuValue: number;
  /** Optional constant value as an IR literal expression, for example a `vec4<f32>(…)`
   *  colour, an `array<vec4<f32>, N>(…)` palette, or a struct literal. When present it
   *  replaces `wgslValue` and `cpuValue` on every backend: WGSL and GLSL emit it and the
   *  CPU backend evaluates it. It must be a constant-foldable literal expression (`lit`,
   *  `construct`, `unop` or `binop` over those, or a `constref` to an earlier constant);
   *  it may not read a binding, a parameter, or a runtime input. Ordinary `f32` scalars
   *  keep using the `wgslValue`/`cpuValue` pair. */
  readonly valueExpr?: Expr;
}

/** One entry of {@link ModuleDecl.vars}: a module-scope variable that is not a resource
 *  (roadmap 0.2 item 5, #82). `workgroup` is WGSL's `var<workgroup>`, memory one workgroup's
 *  invocations share, zero at the start of each workgroup and never initialised. `private` is
 *  WGSL's `var<private>`, a value each invocation owns for its lifetime, `init` or zero at its
 *  start. Neither has a group, a binding or a byte layout, so {@link reflect} reports nothing
 *  for one; a host never binds it.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export interface ModuleVarDecl {
  readonly name: string;
  readonly space: 'workgroup' | 'private';
  readonly type: ShaderType;
  /** The initial value, a constant expression over literals and module consts. Only a
   *  `private` variable carries one; WGSL forbids an initializer on `workgroup` memory. */
  readonly init?: Expr;
}

/** Non-enumerable marker key on a {@link FuncDecl}: the name the declaration was last
 *  assembled under by {@link module}. It is a `Symbol.for` symbol, so it survives two
 *  copies of the package loaded side by side. */
export const ASSEMBLED_AS = Symbol.for('typeshade.assembledAs');

/** A `ModuleDecl.funcs` entry: a WGSL/GLSL function, either an ordinary helper or a
 *  pipeline entry point (`stage` set). This is the object {@link fn} builds: the
 *  {@link FnHandle} it returns mixes these fields onto itself, so it is at once a typed
 *  callable in other function bodies and, unwrapped, the plain `FuncDecl` that
 *  `module({ funcs })` collects. Every backend (WGSL, GLSL, CPU) walks `body` directly.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export interface FuncDecl {
  readonly name: string;
  readonly params: readonly {
    name: string;
    type: ShaderType;
    builtin?: string;
    location?: number;
    interpolate?: string;
    attr?: string;
    /** How the function takes this parameter. Absent is by value, which is every parameter
     *  but one that the callee writes through to the caller's own value. `'inout'` says it
     *  does: GLSL ES 3.00 spells that `inout T name`, WGSL a pointer.
     *
     *  The IR says WHICH parameters are written, not how a target spells it, because the two
     *  targets do not agree on that. GLSL's `inout` is copy-in/copy-out and takes any l-value
     *  argument; WGSL's pointer is a reference and carries the ADDRESS SPACE in its type, so a
     *  function taking `ptr<function, T>` cannot be handed `&buf[i]`. The WGSL backend's own
     *  pass makes one copy of the function per address space its calls use; nothing about
     *  that reaches here, and GLSL emits the one function. */
    mode?: 'inout';
  }[];
  readonly ret: ShaderType;
  readonly body: readonly Stmt[];
  /** Stage and pipeline attributes emitted before `fn`, such as `@compute` or
   *  `@workgroup_size(64)`. Empty for ordinary helper functions. This is the emitted
   *  spelling; `stage` and `workgroupSize` below are what {@link reflect} and the
   *  backends read first, with these strings as the fallback for a hand-built
   *  `FuncDecl` literal. */
  readonly attrs?: readonly string[];
  /** Structured pipeline stage. Set by `fn()`'s `opts.stage`. */
  readonly stage?: 'vertex' | 'fragment' | 'compute';
  /** Structured workgroup size for a compute stage: the `x` extent. */
  readonly workgroupSize?: number;
  /** The three workgroup extents of a compute stage, present when `y` or `z` is not 1. An
   *  absent shape is `[workgroupSize, 1, 1]`; read it through {@link workgroupShapeOf}. */
  readonly workgroupShape?: WorkgroupShape;
  /** Override identifiers that specialize the corresponding workgroup-shape axes. The
   *  numeric `workgroupShape` retains each override's declared default. */
  readonly workgroupSizeOverrides?: readonly [
    string | undefined,
    string | undefined,
    string | undefined,
  ];
  /** Marks a compute entry as a portable kernel. Set by `fn()`'s `opts.portable`, which
   *  rejects it on any other stage with `SD0110`. A portable kernel emits on both
   *  backends: as a native `@compute` entry on WGSL, and through the
   *  {@link lowerComputeToFragment} rewrite on GLSL ES 3.00, which runs it as a fragment
   *  shader. The kernel must keep to the gather-only shape, where each invocation reads
   *  freely and stores exactly once to its own index of the output; any construct outside
   *  that shape fails validation with `SD0111` on every emit, on both backends.
   *
   *  Structured only, with no `attrs` spelling: `portable` is not a WGSL attribute, so
   *  declaring it changes nothing in the emitted source. */
  readonly portable?: boolean;
  /** Marks a kernel function (Rule 8.22): an exported function, not an entry, that takes an
   *  array with no size. It runs on the host's side of the call, which dispatches its loops, so
   *  the WGSL and GLSL backends leave it out of what they emit, and no function calls it
   *  (Rule 8.6). Its array parameters are the caller's storage, passed by reference (Rule 8.23).
   *
   *  Structured only, with no `attrs` spelling: it is not a WGSL attribute. */
  readonly kernel?: boolean;
  /** Return-value attribute for a bare (non-struct) stage output, e.g. a
   *  fragment `-> @location(0) vec4<f32>`. */
  readonly retAttr?: string;
  /** Structured builtin id when `retAttr` came from a `builtin(name, type)`
   *  {@link FieldSpec}. The spelling stays in `retAttr`; the id lives here so a backend
   *  can check it against its builtin vocabulary without re-parsing the attribute
   *  string. */
  readonly retBuiltin?: string;
  /** Keep this function's body out of its call sites: the emit optimizer never inlines a
   *  call to it. {@link fp64Lower} sets it on every double-float helper it injects,
   *  because those bodies are error-free transformations that are algebraically trivial
   *  (`e = b - (s - a)` is 0 in real arithmetic), and flattening them hands the terms to
   *  passes and drivers that may legally cancel them.
   *
   *  It is a property of the declaration, so it survives every rename a production emit
   *  applies to the function's name.
   *
   *  Structured only, with no `attrs` spelling (like `portable` above): it is not a WGSL
   *  attribute and changes nothing in the emitted source. */
  readonly opaque?: boolean;
  /** Where this function was declared in its authored `"use typeshade"` source: the whole
   *  declaration, from the first decorator or the `export` keyword through the closing brace.
   *  Absent on an EDSL-authored or pass-synthesised function. Read it with
   *  {@link sourceSpanOf}. */
  readonly span?: SourceSpan;
  /** The span of just this function's name in its authored source, so a stack frame can
   *  highlight the identifier rather than the whole body. Absent whenever `span` is. */
  readonly nameSpan?: SourceSpan;
  /** Documented deviation from the single-exit lint rule: when true, the rule skips this
   *  function because it has an intentional early return, such as a guard that skips an
   *  expensive loop. Use sparingly, with a comment stating why. */
  readonly allowEarlyReturn?: boolean;
  /** Documented lint deviations: rule ids whose diagnostics are suppressed for this
   *  function (the general form of `allowEarlyReturn`). Use sparingly, with a comment
   *  stating why. */
  readonly lintDisable?: readonly string[];
  /** The name this declaration was last assembled under by {@link module}, installed at
   *  assembly as a non-enumerable property. Declared at the type level only, so a read
   *  typechecks without a cast; it is never part of an authored `FuncDecl` literal. */
  readonly [ASSEMBLED_AS]?: string;
}

/** The whole-shader unit: everything a backend needs to emit a complete WGSL or GLSL ES 3.00
 *  module, or to evaluate one on the CPU oracle. It holds the four declaration arrays,
 *  `consts`, `structs`, `bindings` and `funcs`, plus the opt-in seams `overrides`, `externs`
 *  and `enables`. It is the argument every backend entry point takes, {@link emitModule},
 *  {@link emitGlslModule} and {@link compileModule}, so it is the seam where authoring ends
 *  and backend-neutral emit begins.
 *
 *  Assemble one with {@link module}, which also derives structs, bindings and consts from the
 *  handles passed in `uses`. A hand-built object literal works too, since backends only ever
 *  read this shape, and gives up that convenience.
 *
 *  `enables` is where a module names the GPU features its emit needs, by neutral id, and its
 *  type is what keeps that list honest. It is `readonly DeclarableCapability[]`, which is
 *  {@link Capability} minus every id DERIVED from the module's own shape — `storageBuffer` (a
 *  storage binding), `compute` (a `@compute` entry), `msaaTextureLoad` (a multisampled load),
 *  `storageTexture`, `texture1d`, `textureCubeArray` and `textureGather` (the binding or the
 *  call that needs each), `bgra8unormStorage` (a storage texture's format) and
 *  `packed4x8Dot` (the packed 4x8 calls). Naming one of those here is a compile error, so it cannot
 *  read as a declaration that quietly does nothing. Each backend's own `capProfile` table is
 *  the authority for the ids that remain: it maps a neutral id to that target's `directive`
 *  and `hostFeature`, coverage is built from its keys, and a backend whose table has no row
 *  for a declared id fails closed at emit.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { module } from 'typeshade/core/ir'
 *
 *  const m = module({ enables: ['floatRenderTarget'], structs: [VsOut.decl], funcs: [vs, fs] })
 *  ```
 *
 *  @see {@link module} for the assembler.
 *  @see {@link reflect} for the pipeline metadata read back out of one.
 *  @see {@link capabilityMatrix} for which target can spell which capability.
 */
export interface ModuleDecl {
  readonly consts: readonly ConstDecl[];
  readonly structs: readonly StructDecl[];
  readonly bindings: readonly BindingDecl[];
  readonly funcs: readonly FuncDecl[];
  /** Module-scope variables that are not resources (roadmap 0.2 item 5, #82): the
   *  `var<workgroup>` and `var<private>` declarations. WGSL emits each between the structs and
   *  the bindings; GLSL ES 3.00 spells a private one as a plain global and has no form for
   *  workgroup memory. Absent or empty leaves the emitted source unchanged. */
  readonly vars?: readonly ModuleVarDecl[];
  /** Host-provided globals, the declarations {@link externVar} returns. Each emits
   *  nothing and appears in `reflect().requires`, so a host can check the module's
   *  expectations against what its prelude supplies. Absent or empty leaves the emitted
   *  source unchanged. */
  readonly externs?: readonly ExternVarDecl[];
  /** Pipeline specialization constants, the declarations {@link overrideConst} returns.
   *  Each emits a WGSL module-scope `override` and a GLSL `#define`, is reported by
   *  {@link reflect} so the host knows the WGSL `constants` dictionary and the GLSL
   *  define header, and reads as an opaque value in function bodies so the optimizer
   *  preserves the branches it guards for the driver to eliminate. Absent or empty means
   *  no override declaration and unchanged emitted source. */
  readonly overrides?: readonly OverrideDecl[];
  /** The opt-in capabilities this module turns on, by neutral id, such as
   *  `['floatRenderTarget']` or `['f16']`. Each folds into the module's required caps, so a
   *  backend whose `capProfile` lacks a row fails closed with `SD0030` naming the cap, and a
   *  backend whose row carries a `directive` emits it: `enable f16;` on WGSL, an
   *  `#extension` line on GLSL ES 3.00. A row with no directive is host-side only, the host
   *  activates it from `reflect(m).requiredFeatures` and the emitted bytes do not move.
   *  Absent or empty means no directive and unchanged emitted source.
   *
   *  The type is `DeclarableCapability`, which excludes all NINE caps derived from the
   *  module's shape — `storageBuffer`, `compute`, `msaaTextureLoad`, `storageTexture`, the
   *  three texture ids, and `bgra8unormStorage` and `packed4x8Dot` (#147, #152), derived from
   *  a binding's format and from the calls; naming one here is a compile error. The caps
   *  derived from a `@builtin(...)` id instead (`clipDistances`, `primitiveIndex`,
   *  `subgroups`, §50) are NOT excluded: deriving and declaring fold into one set, so naming
   *  one is harmless. */
  readonly enables?: readonly DeclarableCapability[];
  /** The WGSL `diagnostic(<severity>, <rule>);` directives this module carries (§54). One
   *  rule today: `derivative_uniformity`, whose default severity is `error`, so switching it
   *  off is how an author says "I know this sample is under a non-uniform branch and I want it
   *  anyway". MODULE-SCOPE, though the author writes it on an entry: WGSL's `@diagnostic` on a
   *  function covers that function's own body and not the functions it calls, and a sample is
   *  as often in a helper as in the entry.
   *
   *  The WGSL writer emits one line each, before every other directive. GLSL ES 3.00 has no
   *  equivalent and needs none — implicit derivatives in non-uniform control flow are
   *  undefined there rather than refused (glsl-es-300.txt:3751-3752) — so the GLSL text does
   *  not move. Absent or empty leaves the emitted source unchanged. */
  readonly diagnostics?: readonly DiagnosticDirective[];
}

/** The stage of a function declaration: `'vertex'`, `'fragment'` or `'compute'` for an
 *  entry point, `undefined` for a helper. It reads the structured `stage` field first and
 *  falls back to the `attrs` strings for a hand-built `FuncDecl` literal. Every stage
 *  decision in the package ({@link reflect}, the capability gate, GLSL entry
 *  classification, the roots of dead-function elimination) goes through this one
 *  function. */
export const stageOf = (
  f: Pick<FuncDecl, 'stage' | 'attrs'>,
): 'vertex' | 'fragment' | 'compute' | undefined =>
  f.stage ??
  (f.attrs?.some((a) => a.startsWith('@vertex'))
    ? 'vertex'
    : f.attrs?.some((a) => a.startsWith('@fragment'))
      ? 'fragment'
      : f.attrs?.some((a) => a.startsWith('@compute'))
        ? 'compute'
        : undefined);

/** The `x` workgroup size of a compute entry: the structured `workgroupSize` field first,
 *  then the `@workgroup_size(n)` attribute string; `undefined` when neither is present. A
 *  two- or three-dimensional workgroup has more invocations than this; read
 *  {@link workgroupShapeOf} for the grid. */
export const workgroupSizeOf = (
  f: Pick<FuncDecl, 'workgroupSize' | 'attrs'>,
): number | undefined => {
  if (f.workgroupSize !== undefined) return f.workgroupSize;
  const m = f.attrs?.map((a) => a.match(/@workgroup_size\((\d+)/)).find(Boolean);
  return m ? Number(m[1]) : undefined;
};

/** The workgroup shape of a compute entry: the structured `workgroupShape` field first, then
 *  `[workgroupSize, 1, 1]`, then the extents of the `@workgroup_size(x, y, z)` attribute
 *  string; `undefined` when none is present. Every consumer that sizes a grid (the CPU
 *  dispatch, {@link reflect}, a runner) reads this, so the three extents have one source. */
export const workgroupShapeOf = (
  f: Pick<FuncDecl, 'workgroupSize' | 'workgroupShape' | 'attrs'>,
): WorkgroupShape | undefined => {
  if (f.workgroupShape !== undefined) return f.workgroupShape;
  if (f.workgroupSize !== undefined) return [f.workgroupSize, 1, 1];
  const m = f.attrs
    ?.map((a) => a.match(/@workgroup_size\((\d+)(?:\s*,\s*(\d+))?(?:\s*,\s*(\d+))?\s*,?\s*\)/))
    .find(Boolean);
  return m ? [Number(m[1]), Number(m[2] ?? 1), Number(m[3] ?? 1)] : undefined;
};
