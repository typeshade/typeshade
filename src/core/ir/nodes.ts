// ═══ Shader DSL — IR node + declaration interfaces ═══
//
// The pure data shapes of the IR: expression nodes (Expr), statement nodes
// (Stmt), and module-level declarations. No Node class, no runtime helpers —
// just the structural types the authoring layer (node.ts/builder.ts) builds and
// the backends consume. Imports only types.ts.

import type { ShaderType } from './types.js'

// ── Expression nodes ──

/** The operator tag on `Expr.binop`: arithmetic (`+ - * /`), remainder (`%`) and
 *  bitwise (`& | ^ << >>`). Each is spelled the same way in WGSL and GLSL and evaluated
 *  the same way by the CPU backend. On floats `%` is a truncating remainder, so its sign
 *  follows the dividend: WGSL's native `%` behaves this way, and the GLSL backend writes
 *  `a - b * trunc(a / b)` because GLSL ES 3.00's own `%` is integer-only. When a negative
 *  operand is possible and a floor modulo is wanted, use {@link mod}, which is floor-mod on
 *  every target; the `.mod()` method on `Node` emits this truncating `%`. For integer
 *  operands the CPU backend follows WGSL: two's-complement wrap, truncating `/` with
 *  `x / 0 = x` and `x % 0 = 0`, and `<<`/`>>` as logical shifts on `u32`, with `>>` on
 *  `i32` an arithmetic (sign-preserving) shift.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export type BinOp = '+' | '-' | '*' | '/' | '%' | '&' | '|' | '^' | '<<' | '>>'
/** The operator tag on `Expr.compare`: the six relational operators. A comparison
 *  produces a `bool`, or a `vecN<bool>` when the operands are vectors. The WGSL, GLSL
 *  and CPU backends spell or evaluate it identically.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export type CmpOp = '<' | '>' | '<=' | '>=' | '==' | '!='
/** The operator tag on `Expr.logical`: the short-circuiting boolean operators `&&` and
 *  `||`. Both operands and the result are `bool`. It is a separate `Expr.op` from
 *  `binop` because WGSL and GLSL give `&&` and `||` short-circuit evaluation, which a
 *  plain binary operator does not have.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export type LogOp = '&&' | '||'

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
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export type Expr =
  | { readonly op: 'lit'; readonly type: ShaderType; readonly value: number | boolean }
  | { readonly op: 'constref'; readonly type: ShaderType; readonly name: string }
  // A read of a pipeline SPECIALIZATION CONSTANT (#923) — a `ModuleDecl.overrides`
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
  // A read of a HOST-PROVIDED global (#1713) — a `ModuleDecl.externs` entry. The variable
  // twin of `externFn`: the host's prelude (MapLibre's injected GLSL globals, a host-owned
  // WGSL bind group) declares it, we only reference it, and the module emits NO
  // declaration for it. Its own `op` — not a reused `varref` — for three reasons that a
  // shared node cannot serve: `varref` names are function-SCOPED for mangling and would be
  // renamed; the GLSL stage scope intersects `RefSet.vars` against `m.bindings` to decide
  // which bindings a stage keeps, and a host global is in neither set; and `reflect()` has
  // to report it under `requires` rather than as a binding. Emits as the bare name, or as
  // the per-target spelling when the host spells it differently on each backend.
  | { readonly op: 'externref'; readonly type: ShaderType; readonly name: string }
  | { readonly op: 'param'; readonly type: ShaderType; readonly name: string }
  | { readonly op: 'varref'; readonly type: ShaderType; readonly name: string }
  | {
      readonly op: 'binop'
      readonly type: ShaderType
      readonly bop: BinOp
      readonly a: Expr
      readonly b: Expr
    }
  | { readonly op: 'unop'; readonly type: ShaderType; readonly a: Expr }
  | {
      readonly op: 'compare'
      readonly type: ShaderType
      readonly cop: CmpOp
      readonly a: Expr
      readonly b: Expr
    }
  | {
      readonly op: 'logical'
      readonly type: ShaderType
      readonly lop: LogOp
      readonly a: Expr
      readonly b: Expr
    }
  // `declRef` (present only on calls made through a real FnHandle — absent on externFn /
  // raw callFn string calls) points at the callee's FuncDecl so module() can auto-collect
  // transitively-called fns and key-naming can rewrite call spellings. NEVER read by the
  // emit path (the spelling stays `fn`), never serialized, dropped freely by pass rewrites
  // (collection runs at assembly time, before any pass).
  | {
      readonly op: 'call'
      readonly type: ShaderType
      readonly fn: string
      readonly args: readonly Expr[]
      readonly declRef?: FuncDecl
    }
  | {
      readonly op: 'member'
      readonly type: ShaderType
      readonly base: Expr
      readonly field: string
    }
  | { readonly op: 'construct'; readonly type: ShaderType; readonly args: readonly Expr[] }
  | {
      readonly op: 'select'
      readonly type: ShaderType
      readonly cond: Expr
      readonly ifTrue: Expr
      readonly ifFalse: Expr
    }
  | { readonly op: 'index'; readonly type: ShaderType; readonly base: Expr; readonly idx: Expr }
  // `match (scrutinee) { case v0: e0; ...; default: dflt }`. The WGSL backend
  // pre-emit pass (core/passes/match-lower.ts) lowers every matchExpr inside
  // an fn body into a hoisted `{ Stmt.var slot, Stmt.switch }` pair + a
  // varref to the slot; emitExpr never sees a `matchExpr` Expr post-lowering.
  // The CPU backend evaluates the scrutinee then returns the matched case's
  // value or the default. Phase 2.5 (US-001).
  | {
      readonly op: 'matchExpr'
      readonly type: ShaderType
      readonly scrutinee: Expr
      readonly cases: ReadonlyArray<readonly [number, Expr]>
      readonly default: Expr
    }

// ── Statement nodes ──

/** Every statement shape the IR can hold: the ordered `readonly Stmt[]` that makes up a
 *  `FuncDecl.body`. Like {@link Expr}, it is a discriminated union (on `s`) with no class
 *  behind it, so tsc checks a backend's emit switch for exhaustiveness and a pass can
 *  rebuild a body by mapping over plain data. You do not build these object literals
 *  directly; the {@link Builder} handed to an {@link fn} body as its second callback
 *  argument pushes them one at a time (`b.let(...)`, `b.var(...)`, `b.if(...)`,
 *  `b.ret(...)`, …), so a body is always assembled in source order.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export type Stmt =
  | { readonly s: 'let'; readonly name: string; readonly expr: Expr }
  | { readonly s: 'var'; readonly name: string; readonly type: ShaderType; readonly init?: Expr }
  | { readonly s: 'assign'; readonly target: Expr; readonly expr: Expr }
  | { readonly s: 'assignOp'; readonly target: Expr; readonly bop: BinOp; readonly expr: Expr }
  | {
      readonly s: 'if'
      readonly arms: ReadonlyArray<{ readonly cond: Expr; readonly body: readonly Stmt[] }>
      readonly elseBody?: readonly Stmt[]
    }
  | { readonly s: 'return'; readonly expr?: Expr }
  | {
      readonly s: 'for'
      readonly init: Stmt
      readonly cond: Expr
      readonly update: Stmt
      readonly body: readonly Stmt[]
    }
  | {
      readonly s: 'switch'
      readonly scrut: Expr
      readonly cases: ReadonlyArray<{ readonly value: number; readonly body: readonly Stmt[] }>
      readonly defaultBody?: readonly Stmt[]
    }
  | { readonly s: 'break' }
  | { readonly s: 'continue' }
  | { readonly s: 'discard' }
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
  | { readonly s: 'placeholder'; readonly tag: string }
  // Phase 2 PR 2e.B.2 — raw passthrough. Carries a pre-built target
  // fragment emitted verbatim (at the enclosing body indent) before the
  // surrounding statements. Used by the polygon composer's fill/stroke
  // preamble slot to inject the compiler-emitted match `_mcSS` chain
  // string directly, retiring the renderer's former post-emit string
  // splice (+ the compiler-side nodeToWgslString copy). GPU-only: the
  // CPU backend throws (raw text has no CPU evaluation), and the
  // lowerModule pass treats it as a leaf (no sub-Expr to lower).
  //
  // #1671 — PAIRED PER-TARGET PAYLOADS. One node carries the SAME statement
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
  | { readonly s: 'raw'; readonly wgsl: string; readonly glsl?: string }
  | { readonly s: 'raw'; readonly wgsl?: string; readonly glsl: string }

/** The `raw` statement node: a fragment of target source spliced verbatim into a
 *  function body, spelled per target. It carries a `wgsl` side, a `glsl` side, or both,
 *  and at least one is required. A {@link Backend} receives the whole node in its
 *  `rawStmt` method and emits its own side; when that side is absent it throws `SD0030`,
 *  so a one-sided raw statement means "this module does not build for that target" and
 *  never emits the wrong text. The CPU backend throws on every raw statement, since raw
 *  text has no CPU evaluation. Build one with {@link rawStmt}. */
export type RawStmt = Extract<Stmt, { s: 'raw' }>

/** The argument to {@link rawStmt}: the `wgsl` and `glsl` source text of a raw
 *  statement. At least one side is required, so `rawStmt({})` does not compile. */
export type RawPayload =
  | { readonly wgsl: string; readonly glsl?: string }
  | { readonly wgsl?: string; readonly glsl: string }

// ── Module-level declarations ──

/** A `ModuleDecl.consts` entry: a module-scope constant. For a scalar, write a plain
 *  object literal with one value per precision, for example
 *  `{ name: 'PI', type: f32T, wgslValue: 3.14159265, cpuValue: Math.PI }`: the WGSL and
 *  GLSL backends emit `wgslValue`, and the CPU backend, which runs the module in double
 *  precision, uses `cpuValue`. For a vector, array or struct constant use
 *  {@link constExpr}, which fills `valueExpr` instead. When both forms are present,
 *  `valueExpr` wins.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export interface ConstDecl {
  readonly name: string
  readonly type: ShaderType
  /** Scalar value emitted by the WGSL/GLSL backends (the truncated shader
   *  constant). Used when `valueExpr` is absent; ignored otherwise. */
  readonly wgslValue: number
  /** Scalar value used by the CPU backend, at full double precision. Used when
   *  `valueExpr` is absent; ignored otherwise. */
  readonly cpuValue: number
  /** Optional constant value as an IR literal expression, for example a `vec4<f32>(…)`
   *  colour, an `array<vec4<f32>, N>(…)` palette, or a struct literal. When present it
   *  replaces `wgslValue` and `cpuValue` on every backend: WGSL and GLSL emit it and the
   *  CPU backend evaluates it. It must be a constant-foldable literal expression (`lit`,
   *  `construct`, `unop` or `binop` over those, or a `constref` to an earlier constant);
   *  it may not read a binding, a parameter, or a runtime input. Ordinary `f32` scalars
   *  keep using the `wgslValue`/`cpuValue` pair. */
  readonly valueExpr?: Expr
}

/** A pipeline specialization constant, the declaration behind {@link overrideConst}.
 *  On WGSL it emits a module-scope `override name: type = default;`, which the host
 *  specializes through `createRenderPipeline({ constants: { name } })`. On GLSL ES 3.00 it
 *  emits `#define name default` after the `#version` line, and the host specializes it by
 *  emitting again with `emitGlslModule(m, stage, { overrideValues })`. The value is chosen
 *  when the pipeline is created, so a single authored module yields as many
 *  driver-specialized variants as the host needs, and the driver eliminates the branches
 *  a constant turns dead. Only WGSL scalar types are allowed (`bool`, `i32`, `u32`,
 *  `f32`); a vector, matrix, array or struct type is rejected at authoring with
 *  `SD0014`. */
export interface OverrideDecl {
  readonly name: string
  readonly type: ShaderType
  /** The default value emitted into the `override` declaration or `#define`: the
   *  value a pipeline gets when the host supplies nothing for this constant. */
  readonly default: number | boolean
}

/** One field of a {@link StructDecl}: a plain data member of a uniform or storage struct,
 *  or, in a vertex/fragment I/O struct, a member carrying a `@builtin` or `@location`
 *  attribute. Build these with {@link builtin} and {@link location}, which fill both
 *  `attr` and the structured `builtin`/`location` fields. The GLSL backend ignores `attr`
 *  and reads `location`/`builtin` directly: GLSL ES 3.00 has no struct-field attribute
 *  syntax, so an I/O struct is flattened into individual `in`/`out` globals keyed off
 *  those fields.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export interface StructField {
  readonly name: string
  readonly type: ShaderType
  /** Optional WGSL field attribute(s) for I/O structs, e.g.
   *  `@builtin(position)`, `@location(0)`, `@location(0) @interpolate(flat)`.
   *  This is the emitted spelling; the structured fields below (`location`,
   *  `builtin`, `interpolate`) are what the backends read. They never re-parse
   *  this string. */
  readonly attr?: string
  /** Structured `@location(n)`. Set by {@link location}. */
  readonly location?: number
  /** Structured `@builtin(name)`. Set by {@link builtin}. */
  readonly builtin?: string
  /** Structured `@interpolate(mode)` (set alongside `location`). */
  readonly interpolate?: string
}
/** A `ModuleDecl.structs` entry: a WGSL `struct` declaration. On GLSL it becomes a
 *  plain struct, or a flattened set of `in`/`out` globals when its fields carry
 *  `location`/`builtin` (see {@link StructField}). Use {@link uniformStruct} or
 *  {@link ioStruct} to derive one together with its binding and typed field access
 *  instead of writing this shape by hand.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export interface StructDecl {
  readonly name: string
  readonly fields: readonly StructField[]
}

/** The `BindingDecl.space` a resource binding lives in: WGSL's `var<uniform>` or
 *  `var<storage, ...>`. It selects the WGSL declaration spelling and, on GLSL, the choice
 *  between a `uniform` block and an emulated storage-buffer path (WebGL2 GLSL ES 3.00 has
 *  no native storage buffer). See {@link BindingDecl.access}, which applies only when
 *  this is `'storage'`.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export type AddressSpace = 'uniform' | 'storage'
/** A `ModuleDecl.bindings` entry: a resource bound at a `(group, binding)` slot. It is a
 *  uniform buffer, a storage buffer, a texture, or a sampler, keyed by `type` (a struct,
 *  scalar or array type means a buffer; a `texture` or `sampler` `ShaderType.kind` means
 *  a handle resource with no address space). WGSL emits both `group` and `binding`.
 *  GLSL ES 3.00 has a single binding namespace, so its backend reads `binding` only;
 *  `group` is still used by {@link reflect}, which groups resources per WGSL bind group.
 *  Use {@link uniformStruct}, {@link resource} or {@link storageBuffer} to derive one
 *  instead of constructing it directly.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export interface BindingDecl {
  readonly group: number
  readonly binding: number
  readonly name: string
  readonly space: AddressSpace
  /** Storage access, `read` or `read_write`. Ignored for `uniform`. */
  readonly access?: 'read' | 'read_write'
  readonly type: ShaderType
  /** Who owns this resource. `'module'` (the default) means the module declares it and
   *  describes its layout, and a host builds its bind group from {@link reflect}.
   *  `'host'` means the resource belongs to the surrounding host, such as a bind group a
   *  host-integrated WebGPU renderer hands the module, so the host's layout is the
   *  authority and {@link reflect} reports it under `hostResources`. Ownership does not
   *  change the spelling: a host-owned binding is still declared in the emitted source,
   *  which is what makes it type-checkable; it is just not the module's to allocate. For
   *  a symbol the host's prelude already declares, use {@link externVar}, which emits
   *  nothing. */
  readonly owner?: 'module' | 'host'
  /** GLSL ES 3.00 precision qualifier for this declaration. GLSL only; WGSL has no such
   *  concept and ignores it. Without it the declaration takes the stage default from the
   *  precision preamble, which is right for a module that owns its own header and wrong
   *  for a fragment composed into a host program whose preamble the module does not
   *  control. */
  readonly precision?: 'highp' | 'mediump' | 'lowp'
  /** How a struct-typed uniform binding is spelled on GLSL ES 3.00. Ignored on WGSL, which
   *  has exactly one spelling, and ignored for non-struct types.
   *
   *  `'std140-block'` (the default, and the only choice for a module-owned block) emits
   *  `layout(std140) uniform Name { … } var;`. `'loose'` emits one default-block
   *  `uniform <type> <field>;` per member and rewrites every `var.field` read to the bare
   *  `field`, which is the form a GLSL host prelude provides. Only a host-owned block may
   *  choose `'loose'`: for a module-owned block the two spellings are not interchangeable
   *  (std140 is the only one with a defined layout for a host to write into), so the
   *  choice would be a silent ABI change. */
  readonly glsl?: 'std140-block' | 'loose'
}

/** A host-provided global, the declaration behind {@link externVar}. It is the variable
 *  counterpart of {@link externFn}.
 *
 *  It emits nothing on either backend: the host's prelude declares the symbol. The
 *  declaration exists so that reads of it type-check, survive renaming, and appear in
 *  `reflect().requires`, where a host can check them against what its prelude provides.
 *
 *  `spelling` maps the logical name onto what each target writes, so moving to a host
 *  that exposes the same value differently (a WGSL struct member or a bound uniform in
 *  place of a GLSL prelude global) is a change to the spelling map and leaves the shader
 *  source alone. */
export interface ExternVarDecl {
  readonly name: string
  readonly type: ShaderType
  /** Per-target spelling. A missing side falls back to `name`. */
  readonly spelling?: { readonly wgsl?: string; readonly glsl?: string }
  /** Restrict the symbol to one stage, for a host global only that stage's prelude
   *  provides. Advisory metadata for `reflect().requires`; nothing gates on it. */
  readonly stage?: 'vertex' | 'fragment' | 'compute'
}

/** Non-enumerable marker key on a {@link FuncDecl}: the name the declaration was last
 *  assembled under by {@link module}. It is a `Symbol.for` symbol, so it survives two
 *  copies of the package loaded side by side. */
export const ASSEMBLED_AS = Symbol.for('xgis.shader-dsl.assembledAs')

/** A `ModuleDecl.funcs` entry: a WGSL/GLSL function, either an ordinary helper or a
 *  pipeline entry point (`stage` set). This is the object {@link fn} builds: the
 *  {@link FnHandle} it returns mixes these fields onto itself, so it is at once a typed
 *  callable in other function bodies and, unwrapped, the plain `FuncDecl` that
 *  `module({ funcs })` collects. Every backend (WGSL, GLSL, CPU) walks `body` directly.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export interface FuncDecl {
  readonly name: string
  readonly params: readonly {
    name: string
    type: ShaderType
    builtin?: string
    location?: number
    interpolate?: string
    attr?: string
  }[]
  readonly ret: ShaderType
  readonly body: readonly Stmt[]
  /** Stage and pipeline attributes emitted before `fn`, such as `@compute` or
   *  `@workgroup_size(64)`. Empty for ordinary helper functions. This is the emitted
   *  spelling; `stage` and `workgroupSize` below are what {@link reflect} and the
   *  backends read first, with these strings as the fallback for a hand-built
   *  `FuncDecl` literal. */
  readonly attrs?: readonly string[]
  /** Structured pipeline stage. Set by `fn()`'s `opts.stage`. */
  readonly stage?: 'vertex' | 'fragment' | 'compute'
  /** Structured workgroup size for a compute stage. */
  readonly workgroupSize?: number
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
  readonly portable?: boolean
  /** Return-value attribute for a bare (non-struct) stage output, e.g. a
   *  fragment `-> @location(0) vec4<f32>`. */
  readonly retAttr?: string
  /** Structured builtin id when `retAttr` came from a `builtin(name, type)`
   *  {@link FieldSpec}. The spelling stays in `retAttr`; the id lives here so a backend
   *  can check it against its builtin vocabulary without re-parsing the attribute
   *  string. */
  readonly retBuiltin?: string
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
  readonly opaque?: boolean
  /** Documented deviation from the single-exit lint rule: when true, the rule skips this
   *  function because it has an intentional early return, such as a guard that skips an
   *  expensive loop. Use sparingly, with a comment stating why. */
  readonly allowEarlyReturn?: boolean
  /** Documented lint deviations: rule ids whose diagnostics are suppressed for this
   *  function (the general form of `allowEarlyReturn`). Use sparingly, with a comment
   *  stating why. */
  readonly lintDisable?: readonly string[]
  /** The name this declaration was last assembled under by {@link module}, installed at
   *  assembly as a non-enumerable property. Declared at the type level only, so a read
   *  typechecks without a cast; it is never part of an authored `FuncDecl` literal. */
  readonly [ASSEMBLED_AS]?: string
}

/** A GPU or language feature a target backend may or may not support. Emitting a module
 *  that needs an unsupported feature throws {@link UnsupportedFeatureError}: a capability
 *  absent from the target's `capProfile` fails closed, naming the capability.
 *
 *  Ids are neutral; a module never names a raw `EXT_*` or `OVR_*` string. Each backend's
 *  `capProfile` row translates the id into that target's `hostFeature` (what the host
 *  activates: `gl.getExtension(...)` on WebGL2, a `requiredFeatures` entry on WebGPU) and
 *  its `directive` (what the emitted source says), so the same module ports across
 *  targets whose extension names differ.
 *
 *  There are three classes:
 *  - Derived resource capabilities, `storageBuffer`, `compute` and `msaaTextureLoad`, are
 *    inferred from a module's shape (a storage binding, a `@compute` entry, a
 *    multisampled texture load) and never declared.
 *  - Opt-in language capabilities, `f16` and `subgroups`, are declared in
 *    `ModuleDecl.enables`. Each is a WGSL `enable` directive with no GLSL ES 3.00
 *    counterpart, so a module using one fails closed on the GLSL backend.
 *  - Opt-in device capabilities are also declared in `ModuleDecl.enables`. They change
 *    what the device can do and leave what the source may spell unchanged.
 *    `floatRenderTarget` (WebGL2 `EXT_color_buffer_float`, WebGPU core), `float32Blend`
 *    (`EXT_float_blend`, WebGPU `'float32-blendable'`) and `float32Filterable`
 *    (`OES_texture_float_linear`, WebGPU `'float32-filterable'`) are host-side: on WebGL2
 *    the host activates them with `gl.getExtension` before creating the pipeline, and
 *    they have no shader-source token, so declaring one leaves the emitted source
 *    unchanged on both targets. `multiview` is the one source-directive capability:
 *    GLSL ES 3.00 needs `#extension GL_OVR_multiview2 : require` in the shader itself. It
 *    is absent from the WGSL profile, since WebGPU has no equivalent, so a multiview
 *    module fails closed there. Note that `multiview` buys the directive only: a module
 *    declaring it emits the `#extension` line and still renders single-view, because the
 *    DSL cannot spell `layout(num_views = N) in;` or read `gl_ViewID_OVR`.
 *
 *  A bit width appears in an id only where the feature is bit-width specific:
 *  `float32Blend` and `float32Filterable` carry the `32` because both underlying features
 *  are 32-bit-float only. `floatRenderTarget` carries none, because
 *  `EXT_color_buffer_float` makes both 16-bit and 32-bit float attachments renderable.
 *
 *  A host reads what to activate from `reflect().requiredFeatures`. */
export type Capability =
  | 'storageBuffer'
  | 'compute'
  | 'msaaTextureLoad'
  | 'f16'
  | 'subgroups'
  | 'floatRenderTarget'
  | 'float32Blend'
  | 'float32Filterable'
  | 'multiview'

/** Every {@link Capability}, as a runtime value: the list a capability matrix, a doc
 *  generator or a coverage check iterates. A union type has no runtime form, so the list
 *  is written out, and the `satisfies` clause keeps it in step with the union. */
export const ALL_CAPABILITIES = [
  'storageBuffer',
  'compute',
  'msaaTextureLoad',
  'f16',
  'subgroups',
  'floatRenderTarget',
  'float32Blend',
  'float32Filterable',
  'multiview',
] as const satisfies readonly Capability[]

/** The capabilities a module may name in `ModuleDecl.enables`: {@link Capability} minus
 *  the three derived resource capabilities. Those three are inferred from the module's
 *  shape by `requiredCaps` (a storage binding means `storageBuffer`, a `@compute` entry
 *  means `compute`, a multisampled texture means `msaaTextureLoad`), so declaring one
 *  would at best restate the shape and at worst assert a feature the module does not
 *  use. This type makes that a compile error.
 *
 *  Only the authoring surface narrows: `requiredCaps`, {@link Capabilities} and
 *  {@link CapProfile} keep reading the full `Capability`, because the derived ids are
 *  exactly what they must express. */
export type DeclarableCapability = Exclude<
  Capability,
  'storageBuffer' | 'compute' | 'msaaTextureLoad'
>

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
 *  {@link Capability} minus the three ids derived from the module's own shape:
 *  `storageBuffer` (a storage binding), `compute` (a `@compute` entry) and `msaaTextureLoad`
 *  (a multisampled texture load). Naming one of those here is a compile error, so it cannot
 *  read as a declaration that quietly does nothing. Each backend's own `capProfile` table is
 *  the authority for the ids that remain: it maps a neutral id to that target's `directive`
 *  and `hostFeature`, coverage is built from its keys, and a backend whose table has no row
 *  for a declared id fails closed at emit.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { module } from '@xgis/shader-dsl'
 *
 *  const m = module({ enables: ['floatRenderTarget'], structs: [VsOut.decl], funcs: [vs, fs] })
 *  ```
 *
 *  @see {@link module} for the assembler.
 *  @see {@link reflect} for the pipeline metadata read back out of one.
 *  @see {@link capabilityMatrix} for which target can spell which capability.
 */
export interface ModuleDecl {
  readonly consts: readonly ConstDecl[]
  readonly structs: readonly StructDecl[]
  readonly bindings: readonly BindingDecl[]
  readonly funcs: readonly FuncDecl[]
  /** Host-provided globals, the declarations {@link externVar} returns. Each emits
   *  nothing and appears in `reflect().requires`, so a host can check the module's
   *  expectations against what its prelude supplies. Absent or empty leaves the emitted
   *  source unchanged. */
  readonly externs?: readonly ExternVarDecl[]
  /** Pipeline specialization constants, the declarations {@link overrideConst} returns.
   *  Each emits a WGSL module-scope `override` and a GLSL `#define`, is reported by
   *  {@link reflect} so the host knows the WGSL `constants` dictionary and the GLSL
   *  define header, and reads as an opaque value in function bodies so the optimizer
   *  preserves the branches it guards for the driver to eliminate. Absent or empty means
   *  no override declaration and unchanged emitted source. */
  readonly overrides?: readonly OverrideDecl[]
  /** The opt-in capabilities this module turns on, by neutral id, such as
   *  `['floatRenderTarget']` or `['f16']`. Each folds into the module's required caps, so a
   *  backend whose `capProfile` lacks a row fails closed with `SD0030` naming the cap, and a
   *  backend whose row carries a `directive` emits it: `enable f16;` on WGSL, an
   *  `#extension` line on GLSL ES 3.00. A row with no directive is host-side only, the host
   *  activates it from `reflect(m).requiredFeatures` and the emitted bytes do not move.
   *  Absent or empty means no directive and unchanged emitted source.
   *
   *  The type is `DeclarableCapability`, which excludes the three caps derived from the
   *  module's shape (`storageBuffer`, `compute`, `msaaTextureLoad`); naming one here is a
   *  compile error. */
  readonly enables?: readonly DeclarableCapability[]
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
        : undefined)

/** The workgroup size of a compute entry: the structured `workgroupSize` field first,
 *  then the `@workgroup_size(n)` attribute string; `undefined` when neither is present. */
export const workgroupSizeOf = (
  f: Pick<FuncDecl, 'workgroupSize' | 'attrs'>,
): number | undefined => {
  if (f.workgroupSize !== undefined) return f.workgroupSize
  const m = f.attrs?.map((a) => a.match(/@workgroup_size\((\d+)/)).find(Boolean)
  return m ? Number(m[1]) : undefined
}

/** An entry-point parameter: it carries a `@builtin(...)` or a `@location(n)`. */
export interface EntryParam {
  readonly name: string
  readonly type: ShaderType
  readonly builtin?: string
  readonly location?: number
}
