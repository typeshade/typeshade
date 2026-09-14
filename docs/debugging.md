# Debugging a `"use typeshade"` shader

Status: **decided, open to revision against a measurement.** Written against `5f20c5e` on
`main`; §5 records eleven decisions the owner has taken. Milestones 1 and 2 have shipped: the
IR carries source spans, and `@xgis/shader-dsl/debug` steps one invocation of a
`"use typeshade"` shader. It proposes the layer that lets an
author set a breakpoint in a `.shade.ts` file and step through it, and it fixes the
compiler-side work that every viable design needs first.

Related: `docs/use-typeshade.md` (the surface), `docs/use-typeshade-surface.md` (the grammar),
`docs/use-typeshade-plan.md`, `docs/language-service-api.md` (the editor layer that exists,
and the layering rule this document reuses).

Where this sits in the plan. Phase 10, "Diagnostics + Source Mapping", names two mappings, and
milestone 1 closes one of them: the IR-to-source leg, which is what a debugger reads. The
source-to-WGSL leg is untouched, and that is the one the plan names as blocking Milestone B, so
Phase 10 stays open on it. Milestones 2 to 4 are not Phase 10 at all; they belong under Phase
21, where the plan tracks debugging.

## 0. Today's pieces, and the missing one

Three things already in the tree do most of the work a debugger needs.

- **The CPU oracle.** `compileModule` (`src/core/oracle.ts`) is a tree-walk interpreter over
  the same IR the WGSL and GLSL ES 3.00 writers emit. It is the third backend rather than a
  simulator written beside them: `src/core/oracle-backend-parity.test.ts` holds its intrinsic
  set to `INTRINSICS`, and `src/core/cpu-codegen.test.ts` differentially gates it against
  `compileModuleJs`, the `new Function` twin, so the two agree element for element under
  `Object.is`. `compile(src).eval` (`src/compiler/ts/eval-entry.ts`) already runs a
  `"use typeshade"` entry point on it.
- **Exact TypeScript spans in the front end.** Every construct the source compiler lowers is
  reached through a `ts.Node`, and `makeDiagnostic` (`src/compiler/ts/diagnostic.ts`) already
  turns that node into `start` / `length` plus line and character. The positions a debugger
  needs are computed today and then thrown away everywhere except on diagnostics.
- **An editor-neutral service.** `src/language-service/` resolves positions, symbols and
  definitions over the same front end, and `docs/language-service-api.md` §1 states the rule
  this document follows: the semantic layer lives in this repository, the editor adapters live
  outside it and contain no TypeShade knowledge.

What does not exist: **any mapping from an IR node back to source**. `src/core/ir/nodes.ts`
carries no source position on any `Stmt`, `Expr` or `FuncDecl` (`location?: number` on a
`FuncDecl` param is the `@location` attribute, a different thing entirely). The one thing that comes close,
`src/core/diagnostics/loc.ts`, is a line-level side table keyed by node identity, captured from
`Error` stacks, opt-in, and, by its own header, valid only on the authored module, because
`autoVars`, the lowering passes and the optimizer rebuild every node with a `{...}` spread and
break identity. It exists for the `fn()` EDSL, where there is no AST to read a span from.

So: the interpreter can run the program, and the front end knows where every statement came
from, and nothing connects them. That connection is §3, and it is the first milestone.

## 1. The meaning of debugging here

### 1.1 GPU stepping

Neither WebGPU nor WebGL2 exposes a breakpoint, a single-step, a register read or a
`printf` from inside a shader. There is no API to add; the abstraction does not have the
concept. A fragment shader runs as thousands of invocations scheduled across cores in an order
the driver picks, in lockstep quads, with no host-visible program counter.

Two things are therefore **out of scope**, and stay out:

- **Stepping on the GPU.** The only way to fake it is source-to-source instrumentation:
  rewrite the emitted WGSL so every intermediate value is written to a storage buffer, run the
  draw, read the buffer back, and reconstruct a trace. That changes the program being
  debugged (different register pressure, different scheduling, different optimizer decisions
  in the driver, and an unbounded buffer for any loop), so the thing you step through is not
  the thing that was wrong. It is also a large feature in its own right and belongs to a
  proposal about GPU capture.
- **`printf` on the GPU.** WGSL has no print. The same storage-buffer-ring trick would be
  needed, with the same objection plus a decode step, and it would move emitted bytes on every
  shader that used it. A "shader trace buffer" is a defensible separate feature; it is not
  debugging, and calling it debugging would set the wrong expectation.

What already exists for the shipped shader is the other half, and it stays as it is: `mangle`
fills a `renames` map that `decodeShaderLog` (`src/core/decode-log.ts`) uses to rewrite a
driver's error message back into authored names. That is the answer to "the driver said
something about a function called `b`". It is not stepping and does not try to be.

### 1.2 Oracle stepping

`compileModule` walks the same `ModuleDecl` the WGSL writer emits, statement by statement, in
a plain JavaScript function. Pausing it is a mechanical change: the interpreter already has a
`execBody(body, env, ctx)` loop over `readonly Stmt[]` and a per-call `env: Map<string,
CpuValue>`. Everything a debugger displays (the current statement, the frame's locals, the
parameters, the bindings) is already a value in that function.

So the promise this document proposes is exactly this, and nothing wider:

> Set a breakpoint on a line of a `.shade.ts` file. Choose one invocation (a vertex index, a
> fragment position, a compute global invocation id) and the values the shader reads:
> uniforms, storage buffers, vertex inputs. Run. Execution stops on the statement you marked,
> in your own source. Step over, step into a helper, step out, continue. While stopped,
> inspect parameters, locals, bindings and the value of an expression you type, in shader
> types rather than JavaScript ones.

### 1.3 Fidelity limits

The oracle's own header is blunt about its limits and this document inherits them rather than
softening them.

- **Default `'f64'` is an algebra oracle.** Every value is a JavaScript double evaluated with
  `Math.*` and no rounding. It proves the IR performs the right operations in the right order.
  It is structurally blind to f32 precision loss, which is the bug class that produces most
  "it looks wrong on the GPU" reports.
- **`precision: 'f32'` is a correctly-rounding f32 machine** over the same IR: `froundF32`
  (`src/core/passes/precision.ts`) rounds after every f32-typed operation, with infinities on
  overflow. This is the mode a debugger should default to, because the author's question is
  almost always "what does the GPU compute", not "what does the mathematics say". §5
  decision 6 makes this the default, with the mode visible in the UI.
- **Neither mode is a driver.** Fused multiply-add, a driver's own reassociation, a
  vendor-specific `fast-math`, undefined-behaviour corners, and anything about rasterization,
  interpolation of varyings across a triangle, or depth and blend state are outside what any
  CPU evaluation can tell you. A CPU pass is not evidence of GPU correctness; the repository
  already says so, and a debugger does not change it.
- **Derivatives and texture reads have no single-invocation meaning.** `dpdx`, `dpdy`,
  `fwidth` are defined over a 2×2 quad of neighbouring fragments; `textureSample` reads memory
  that a CPU run does not have. Today `GPU_STUBS` (`src/core/cpu-runtime.ts`) returns `0` and
  opaque black for these, and only when `gpuStubs: true` is passed; otherwise the call throws.
  §2.4 and §4.4 say what a debugger should do with that.

Two consequences worth stating up front, because they shape §2:

1. **One invocation.** A full 1920×1080 fragment pass is about two million
   invocations. Stepping is for one of them. The Playground's existing "run the whole preview
   on the CPU" path keeps using `compileModuleJs`, which is the fast backend, and is a
   different feature with a different implementation.
2. **Before the optimizer.** The author is debugging the program they wrote.
   `compileModule` already runs only `validate` and `autoVars` before evaluating, and a
   debugger should keep exactly that. Debugging the _optimized_ module is a real need for
   chasing an optimizer bug, but it is a separate mode, and it is honest only if the UI says
   which module is running.

## 2. Approaches

The three are compared on the criteria the brief names: fidelity to GPU semantics, effort in
this repository, effort in the editor extension, reuse by the Playground in the browser, how
helpers and loops step, what happens at a derivative or a texture read, compute workgroups,
and performance for one pixel against a full frame.

### 2.1 Approach A: a Debug Adapter Protocol server over a stepping oracle

The interpreter gains a stepping mode: `execBody` and the call path become generators that
`yield` a pause at every statement boundary, carrying the statement's source span and a
readable snapshot of the frame. A session object drives it with `stepOver`, `stepIn`, `stepOut` and
`continue`, and resolves breakpoints from an editor line to the spans that start on that
line. A DAP server in the extension repository translates the protocol to that object and
back.

The stepping engine lives here and knows nothing about DAP; that is the same split
`docs/language-service-api.md` §1 already made for the language service, for the same reason.

Sketch of the shape (§3 supplies `SourceSpan`):

```ts
export interface DebugPause {
  readonly reason: 'entry' | 'step' | 'breakpoint'
  readonly span: SourceSpan
  /** Innermost frame first; each names its function and its own span. */
  readonly frames: readonly DebugFrame[]
}
export interface DebugFrame {
  readonly fnName: string
  readonly span: SourceSpan
  /** A copy, taken at the pause: names in scope to their current values. */
  readonly locals: ReadonlyMap<string, CpuValue>
}
export interface DebugSession {
  readonly pause: DebugPause | undefined
  stepOver(): DebugPause | undefined
  stepIn(): DebugPause | undefined
  stepOut(): DebugPause | undefined
  continue(): DebugPause | undefined
  evaluate(expression: string): CpuValue
  readonly result: CpuValue | undefined
}
```

**Fidelity.** Identical to the oracle's, because it _is_ the oracle. That is the load-bearing
property: a stepping mode that re-implemented evaluation would be a fourth backend nobody
gates, and it would drift. The mitigation is a differential test in this repository: a
stepped run driven to completion must return the same value as `compileModule` for every
example, under `Object.is`, exactly as `cpu-codegen.test.ts` already gates the JS twin.

**Effort here.** Medium, and larger than "turn one function into a generator". `execBody`,
`evalExpr` and `setLValue` all become generators, with `yield*` at every recursive site, and
so does the per-function closure a call goes through: a pause raised inside a callee has to
propagate out through every frame between it and the driver, and a plain call cannot carry
one. Only `CpuModule.fns`, the outermost entry point, stays a plain function, because that is
where the driver takes over. Milestone 2 confirmed this shape. The op library
(`cpu-runtime.ts`) is untouched throughout, which is what keeps the change tractable. The real
cost is deciding where the pauses are and keeping one implementation rather than two, which
§2.5 takes up.

**Effort in the extension.** Medium. A DAP server is a known quantity: VS Code ships the
client, and the request set a first release needs is small (`initialize`, `launch`,
`setBreakpoints`, `stackTrace`, `scopes`, `variables`, `evaluate`, `next`, `stepIn`,
`stepOut`, `continue`, `terminate`). It is more code than approach B needs, and that is A's
one genuine cost.

**Playground reuse.** High, and this is the strongest argument for A. The session object takes
data and returns data; the Playground drives it from the worker it already runs the language
service in, with no DAP and no protocol, and renders pauses however it likes. The same object
also serves a _headless_ use nothing else offers: a test that asserts the value of `sum` at
line 31 on invocation 3.

**Helpers and loops.** Loops fall out: the `for` case already re-enters `execBody`, so each
iteration pauses at each statement. Helpers are the interesting case, because a call is an
expression: `return f(x) + g(y)` contains two calls inside one statement.
**Decision:** pauses are at statement boundaries, and a call pushes a frame, so `stepIn` on that
statement enters `f`, `stepOut` returns to the same statement with `f`'s frame gone, and
`stepIn` again enters `g`. That is the model every JavaScript debugger uses for the same
shape, so it needs no explanation to the author. It requires the interpreter to know which
call it is about to make, which is why §3 gives `call` expressions a span in milestone 1.

**Derivatives and textures.** See §2.4; the answer is the same for A and B.

**Compute workgroups.** A steps one invocation. That is not a limitation today, because the
`"use typeshade"` grammar has no spelling for workgroup-shared memory or a barrier, so there
is nothing for a second invocation to synchronise with. When those arrive, the generator
design is what makes a cooperative scheduler possible: run N generators, advance each until
it yields at a barrier, then release them together. That door stays open in A and is awkward
in B.

**Performance.** One fragment invocation through a generator-based walk is microseconds; the
generator overhead (roughly one allocation and one resume per statement) is irrelevant at that
scale. A full frame through it would be perhaps one to two orders of magnitude slower than
`compileModuleJs`, which is why §1.3 says stepping is for one invocation and the preview path
keeps its own backend.

### 2.2 Approach B: emit JavaScript with a V3 source map and let the stock debugger step it

Half of B already exists. `compileModuleJs` (`src/core/cpu-codegen.ts`) walks the same IR,
emits a JavaScript source string with one function per IR `FuncDecl`, and builds it with
`new Function`; it shares the whole op library with the interpreter. B is "add a source map
and a real script URL to a backend that ships today".

**What a V3 map can express, and what it cannot.**

- _One IR statement expanding to several JS statements_ is expressible. V3 maps generated
  positions to original positions many-to-one, so every generated statement in the expansion
  carries the same original span. The consequence is visible, though: "step" in the JS
  debugger stops once per generated statement, so the cursor sits on the same source line
  several times in a row. Line-granular stepping hides some of it; the stutter is real.
- _Hoisted temporaries_ are the sharper problem, and they exist in the shipped emitter by
  construction: `cpu-codegen` allocates every local as `$v0`, `$v1`, … and hoists all of them
  to the top of the function, and parameters become `$a0`, `$a1`. A V3 map has a `names` field
  that can associate a generated name with an original one, but neither VS Code's node
  debugger nor Chrome DevTools resolves scope variables through it reliably. So the variables
  view shows `$v3`, not `sum`. Fixing that means a second, debug-only JS emitter that keeps
  the authored names and declares each local where the author declared it, at which point B
  is no longer "reuse what exists", it is a new backend that must be gated against the other
  two.
- _f32 rounding_ is expressible and cheap: `froundF32` inserts the rounding into the IR before
  emit, so the generated JavaScript reads `$.B["__fround"](a * b)`, a lookup into the shared
  builtin table rather than a call an author would recognise. That strengthens the point: the
  rounding is exact and identical to the interpreter's, and the generated text it produces is
  one more thing a human reading the mapped output has to decode. It makes the generated source noisier, which matters only if a human ever
  reads it.
- _Variable display_ is where B loses regardless of the map. The CPU value model is
  `number[]` for vectors and matrices and a plain object for structs, deliberately, so that
  member mutation aliases the way the interpreter's does. A JS debugger renders `vec3(0.5,
0.5, 1)` as `(3) [0.5, 0.5, 1]` and a `mat4` as a flat 16-element array. Chrome DevTools has
  custom formatters; VS Code's node debugger has nothing equivalent short of wrapping values
  in classes with getters, which would change the values the shared op library operates on.

**Fidelity.** Identical to A's, for the same reason: same IR, same op library, and
`cpu-codegen.test.ts` already gates the twin against the interpreter.

**Effort here.** Medium, and not much below A. B still needs §3 in full, because a source map
is nothing but spans. On top of that it needs a VLQ mapping emitter, the debug-only naming
changes above, and a place to put the generated file: a temporary `.mjs` the node debugger
can load, or a blob URL with `//# sourceURL` for DevTools, neither of which a zero-dependency
browser-safe package is comfortable owning.

**Effort in the extension.** Low, and this is B's prize: for milestone 1 there is no extension
at all. A `launch.json` entry of `"type": "node"` pointed at the generated file gets
breakpoints in the `.shade.ts` for free.

**Playground reuse.** High in a different way: Chrome DevTools steps the generated code and
shows the `.shade.ts` as the original source with no Playground code at all. But the
Playground then has no control over presentation, cannot show bindings as a scope, and cannot
offer anything TypeShade-shaped.

**Helpers and loops.** Excellent and free. The JS call stack is the shader call stack, because
the emitter already produces one JS function per `FuncDecl`. This is B's best property.

**Compute workgroups.** Possible but awkward: a cooperative scheduler needs the emitter to
produce generator functions, which steps fine in a JS debugger but means the emitter and the
scheduler now both exist in the generated-code world where we have least control.

**Performance.** The compiled backend is the fast one, so B is better at "run the whole frame
on the CPU", but under a debugger that is still hopeless at two million invocations, so in
practice the two approaches are equal at the thing either is used for.

**The decisive objection.** In B, the stepping model, the stepping unit, and the display are
the JavaScript debugger's. We cannot say "this whole `if`/`else if` chain is one
shader statement"; we cannot render a `vec3` as a `vec3`; we cannot make `evaluate` mean
"evaluate this shader expression in this scope" rather than "evaluate this JavaScript
expression over the CPU value model"; and we cannot add a bindings scope, a "this value is a
GPU stub" marker, or an invocation switcher. Everything TypeShade-specific about the
experience has to be given up or fought for.

### 2.3 Approach C, the hybrid, and the recommendation

**Recommended: A as the engine, with the Playground and the extension as two thin adapters
over it, and B kept as an explicitly open door rather than a rejected idea.**

Concretely:

- One stepping interpreter in this repository, exported from a `./debug` subpath as plain
  data-in / data-out objects. It knows nothing about DAP, nothing about VS Code, nothing about
  the DOM.
- A DAP server in `typeshade/vscode-typeshade`, beside the LSP server that
  `docs/language-service-api.md` §10 item 8 already plans, translating the protocol to that
  object. It holds no TypeShade knowledge; its size is a measure of drift, exactly as that
  document says of the language server.
- A "Step on the CPU" panel in the Playground driving the same object from its worker.
- Milestone 1's spans are precisely what a V3 map needs, so if the stepping engine ever proves
  too slow or too narrow, B is additive on top of the same foundation rather than a rewrite.

**Why A over B**, in order of weight:

1. **The stepping unit is a shader statement, and only A owns it.** The author thinks in the
   statements they wrote. A JS debugger steps the statements the emitter produced.
2. **The value model is ours.** Vectors, matrices, structs and the f64 emulated-double pairs
   display correctly only if we render them. In B they are JavaScript arrays and objects.
3. **One engine, three consumers.** The extension, the Playground and a headless assertion in
   a test all get the same object. B gives the first two a debugger and the third nothing.
4. **The effort gap is smaller than it looks.** B still needs §3, still needs a runtime, still
   needs a debug-only emitter to make variables legible, and still needs somewhere to write a
   file. Its saving is the DAP server, which is a bounded, well-documented piece of work.
5. **It matches the layering the repository already chose.** An editor-neutral core here, thin
   adapters outside. A second, differently-shaped tooling stack would be the drift the
   language-service document exists to prevent.

**What A costs, admitted plainly.** Someone must write and maintain a DAP server, which B
would not need. And a stepping interpreter is a second traversal of the IR that can drift from
the reference one, which is why §2.5 makes the shape of the change part of the
recommendation rather than an implementation detail.

### 2.4 Derivatives and texture sampling

Neither approach changes what the CPU can compute, so both need the same policy.

- **Derivatives.** `dpdx` / `dpdy` / `fwidth` are defined over a 2×2 quad. Two honest options
  exist: return zero and say so, or evaluate the entry four times at the quad's four fragment
  positions and take the differences. The second is real fidelity and is implementable,
  since the interpreter is re-entrant and one invocation is cheap, but it costs four evaluations,
  and under divergent control flow the GPU's answer depends on lockstep execution of the quad,
  which a sequential re-evaluation does not reproduce. **Decision:** milestone 2 returns the
  existing stub value and marks it in the variables view as a stand-in rather than a computed
  value, so no one mistakes `0` for a result; quad evaluation becomes an opt-in
  `derivatives: "quad"` when someone has a derivative bug to chase. This is §5 decision 4.
- **Texture sampling.** There is no texture memory in a CPU run, and, worth noting because
  it decides the milestone, the `"use typeshade"` type map (`src/compiler/ts/type-map.ts`)
  has no `texture` or `sampler` spelling at all today, so no `"use typeshade"` shader can
  declare one. Textures are therefore **unsupported in this milestone**, because there is
  nothing yet to support. §4.4 specifies the shape for when they arrive.

### 2.5 Interpreter duplication

The risk A carries is that `execBody` gets a stepping twin and the two drift. Three ways to
hold it, in order of preference:

1. **Make the existing walk the stepping walk.** `execBody` and the user-call path become
   generators; `compileModule` drives the generator to completion internally and returns
   exactly what it returns today. There is then one traversal, and the non-stepping path pays
   one resume per statement. Whether that cost is acceptable on the hot path is a measurement,
   not a guess, and `src/core/measure.ts` cannot supply it: its axes are op count and emit
   size, neither of which is interpreter throughput. Milestone 2 added a benchmark of its own,
   `scripts/bench-stepping.ts` (`bun run bench:stepping`), and measured the generator walk at
   roughly **five times** the tree-walk: a median between 5.0x and 5.5x across runs, individual
   repetitions between about 4x and 9x. It is a range rather than a figure because a single run
   is not reproducible on a loaded machine; an earlier draft of this document quoted 3.1x from
   one sample and a reviewer measuring the same thing got 4.1x, which is what moved the
   benchmark out of a comment and into a script. Several-fold on every use of the reference
   backend is the cost option 1 would impose, so the answer is option 3.
2. **Generate both from one description.** Not worth it here: the walk is one `switch` with
   thirteen arms, and a code generator over it would be more machinery than the duplication.
3. **A second walk with a differential gate.** A stepped run must return the same value as
   `compileModule` on every example in the registry and on the `"use typeshade"` corpus. This
   is what `cpu-codegen.test.ts` already does for the JS twin, so the pattern and the corpus
   both exist.

**Decision:** attempt 1, measure, and fall back to 3 with the gate. Milestone 2 reports the
measurement either way.

### 2.6 Milestone plan

**In this repository (`typeshade/typeshade`).** M1 is the Phase 10 work; M2 to M4 sit under
Phase 21, per the note above the table of contents.

| #   | What                                                                                                                                                                                                                                                         | Why it is separable                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| M1  | Source spans on the IR (§3): `SourceSpan`, a `span?` field on every `Stmt` and `FuncDecl`, on an authored `call` expression and on an assignment's target, capture in the source compiler, propagation through the passes, a public `sourceSpanOf` read API. | Every approach needs it. It moves no emitted byte and nothing depends on the debugger. |
| M2  | **Shipped.** The stepping mode of the CPU oracle (§2.1), on a `./debug` subpath: pauses at statement boundaries with the span, the frame environment as a readable snapshot, step over / in / out / continue, breakpoints by span.                           | Usable headlessly the day it lands; no editor work required to test it.                |
| M3  | The launch configuration (§4) as a published TypeScript type plus a baked JSON Schema, the invocation builder for the three stages, binding defaults from `zeroOf`, and a value formatter that renders `CpuValue` in shader types.                           | This is what the two adapters share; baking it here is what stops them diverging.      |
| M4  | Derivative policy (`derivatives: "zero" \| "quad"`) and, once the grammar has textures, the texture value shapes of §4.4.                                                                                                                                    | §5 decision 4 sets the first; the second waits on the language surface.                |

**In `typeshade/vscode-typeshade`** (not created by this work; it is the repository
`docs/language-service-api.md` §1 already names for the language server):

- A DAP server registering the `typeshade` debug type, contributing the `launch.json` schema
  from M3, resolving breakpoints from line to span, and mapping `scopes` to three scopes,
  Locals, Parameters and Bindings, plus `evaluate` for watches and hovers.
- A "Debug this entry" code lens over each `@vertex` / `@fragment` / `@compute` function,
  built from the language service's existing `getDocumentSymbols`.
- No TypeShade semantics of its own, per §1 of the language-service document.

**Site and Playground.**

- A "Step on the CPU" panel beside the existing output pane, driving M2 from the worker the
  language service already runs in: the current statement highlighted in the editor, the three
  scopes, and the invocation and bindings as an editable form defaulted to zeros.
- A shareable invocation in the URL, so a bug report can carry "this pixel, these uniforms".
- A documentation page derived from this document once it is no longer a draft.
- The Playground pins the published package or a public subpath, never a deep path, which is
  the rule §10 item 7 of the language-service document sets for the Monaco adapter.

## 3. Source positions in the IR

This is milestone 1, and it is the part every approach needs: A resolves a breakpoint to a
statement and reports where it paused; B has nothing to write into a source map without it.

### 3.1 The span type

```ts
/** Where an IR node came from in its authored source. */
export interface SourceSpan {
  /** The compilation unit's file name, as the compiler was given it. */
  readonly file: string
  /** UTF-16 offset of the first character, into that file's text. */
  readonly start: number
  /** Length in UTF-16 code units. `start + length` is the exclusive end. */
  readonly length: number
  /** Zero-based line of `start`. */
  readonly line: number
  /** Zero-based UTF-16 character of `start` within its line. */
  readonly character: number
  /** Zero-based line of the exclusive end. */
  readonly endLine: number
  /** Zero-based UTF-16 character of the exclusive end within its line. */
  readonly endCharacter: number
}
```

`start` and `length` are the authority. The other four are precomputed rather than derived on
demand, and they earn their place on one argument: the consumer that needs them has no
`ts.SourceFile` to convert with. A debug adapter holds a span and a protocol message; a
source-map writer holds a span and a VLQ encoder. Neither has the parsed file, and neither
should have to re-read the source to answer "which line". The compiler does hold it, so
`getLineAndCharacterOfPosition` is one call per statement at the one moment it is free.

Lines and characters are **zero-based**, matching `docs/language-service-api.md` §2 and LSP.
`TsCompilerDiagnostic`'s own `line` and `character` are one-based, which looks like an
inconsistency and is better described as two conventions answering to two different readers.
The one-based pair IS read, by three places, and all three format it into a human-readable
`file:line:col` string: `compile()`'s "cannot evaluate" error (`src/compiler/ts/compile.ts`),
the Vite plugin's build failure (`src/compiler/ts/vite.ts`) and the example gate's report
(`examples/_shade.ts`). What no reader does is consume it as a POSITION: the language service
re-derives zero-based positions from the same `start` and `length` this type carries, and never
from the pair. So one-based is the convention a person reading a terminal line expects, and a
type meant for an editor should follow the editor's. Changing the diagnostic shape is a
breaking change with nothing to do with debugging, so it stays as it is. This is §5 decision 1.

`SourceSpan` is a third position shape beside the language service's `TypeshadeTextSpan` and
`TypeshadeRange`, and it does not compose from them on purpose: `src/core/` cannot import
`./language-service`, which sits above it and depends on the compiler front end. The shape is
duplicated with only the zero-basing shared, and the alternative, hoisting a position type
into `core/` for the service to import, is a larger change than a debugger should force.

### 3.2 Field versus side table

**Decision: an optional `span` field on the IR shapes.** The reasons, in order:

1. **The passes propagate it for free.** `mapStmtExpr` and `mapChildren`
   (`src/core/ir/visit.ts`) and `mapExpr` / `mapStmt` (`src/core/passes/opt/ir-transform.ts`)
   rebuild every node as `{ ...s, <rewritten children> }`. An optional field on the original
   object is carried by that spread with no code change anywhere. It is lost only where a pass
   constructs a genuinely new node, which is exactly where there is no authored origin to
   carry, and where inventing one would be a lie.
2. **A side table dies at the first rebuild.** `loc.ts` says this itself, in its own header:
   identity keys are valid only on the authored module because `autoVars`, `lowerModule` and
   `cse` spread every node. That is not a fixable property of the technique; it is the
   technique.
3. **A side table the passes _propagate_ means changing every pass.** It would have to be
   threaded through every pass signature, and a new pass would silently opt out of it by
   forgetting a parameter, a failure that is invisible until a debugger misreports a line.

**Why the emitted bytes cannot move.** Every emitter dispatches on `s` or `op` and reads named
fields; none of them enumerates keys, serializes a node, or hashes one. `emitIdentity`
(`src/core/emit-identity.ts`) hashes emit _options_ rather than the IR. So an added field is invisible
to emit by construction, and `examples/emit-goldens.test.ts` plus the `"use typeshade"`
goldens in `examples/shade-examples.test.ts` prove it per commit.

One comparison does enumerate keys, and it is not an emitter: `irEqual`, the fixpoint's
"did this pass change anything" test. A field it can see is a field that makes two otherwise
equal trees compare unequal, which costs an extra iteration rather than a wrong byte. Measured
on a registered example while milestone 1 was reviewed, the span doubled the fixpoint's
iterations. `irEqual` therefore filters `span` and `nameSpan`, which is the correct reading of
what it is for: it asks whether a pass changed the PROGRAM, and where a statement was written
is not part of the program. The `no-self-assign` lint rule compares two nodes the same way, and
takes the same filter.

**Why the IR-equality suites cannot break.** `src/compiler/ts/ir-equality.test.ts` and
`src/core/ir/seam-ir-equality.test.ts` both normalise field by field before comparing:
`normalizeStmt` and `normStmt` construct fresh objects from named fields, so a `span` on one
side and not the other is invisible to them. That matters, because the `"use typeshade"`
compiler will carry spans and the `fn()` EDSL will not.

**Naming.** `span`, not `loc`. `loc` is taken by `SourceLoc` and its side table, and the two
mean different things; and `location` on a `FuncDecl` param is the `@location` attribute, which
is exactly the collision worth avoiding.

### 3.3 The nodes that carry a span

- **Every `Stmt` variant.** The stepping unit. Non-negotiable.
- **`FuncDecl`.** The frame's identity in a stack trace, and what "step out lands here" means.
  The span covers the function's declaration through its closing brace; a separate `nameSpan`
  covers the identifier, for a stack-frame label that highlights the name rather than the body.
- **A `call` expression the author wrote.** Needed for step-into, where a statement contains
  more than one call, and for a stack frame that says where the call was made. A call the front
  end synthesises carries none, and several do: the `random` hash expansion, the array
  higher-order-function lowering, the `Math.*` expansions, and a scalar cast all build call
  nodes from whole cloth. The read API says "when the node came from source", never "every
  call".
- **An assignment's target.** The lvalue a statement writes, so a debugger can highlight what
  is about to change rather than the whole line. It is the one other expression position an
  author points at while stepping.
- **Nothing else, in milestone 1.** A span on every `Expr` would roughly double the field count
  of the IR's most numerous objects to serve hover and expression-level stepping, neither of
  which the first milestone promises. It is additive later, at the same capture sites. This is
  §5 decision 3.

Statement spans use the TypeScript node's `getStart(sourceFile)` through `getEnd()`, the same
pair `makeDiagnostic` uses, so a span never covers leading trivia and a breakpoint on a
comment line resolves to the statement after it, which is what an author expects.

### 3.4 Capture sites

Capture is in the source compiler, at the sites that already have both the `ts.Node` and the
finished IR node. In `src/compiler/ts/lower/statement.ts` that is `lowerStatement`, which
stamps every statement it produced, plus the finer sites that stamp first:
`lowerVariableDeclaration` for one declarator of a multi-declarator `let`, and `lowerLValue`
for an assignment's target. In `lower/control.ts` it is `lowerFor`, for the loop header's own
`init` and `update`, and `lowerUpdate`, which owns the target of a standalone `i++` as well as
a `for` header's. In `lower/function.ts` it is `parseSignature`, for the `FuncDecl` and its
`nameSpan`; in `lower/expression.ts`, the one line that dispatches a call. The shape at each
site is one helper applied to an existing return value, so the change is additive and does not
restructure lowering.

**A statement with no span executes without pausing, and breakpoint resolution ignores it.**
That is the policy, and it is not a corner: the front end synthesises spanless statements
today, and passes create more. A stepping session therefore skips such a statement rather than
reporting a pause it cannot place in a file, which would leave an IDE with a stop and no line
to show. The known spanless statements, as of milestone 1:

| Statement                                 | Where it comes from                                                    |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| the `_w` counter's `var` and its `assign` | `lowerWhile` lowers a `while` to a `for` over a counter nobody wrote   |
| an `_av` materialisation                  | `autoVars`, for a value the author assigned to without naming          |
| every `if`, at O1 and above               | `dead-branch` rebuilds the node from named fields instead of spreading |
| an `fp64Lower` helper's whole body        | injected, with no authored origin at all                               |

The third row is a defect rather than a fact of life, and milestone 1 fixes it by spreading:
a pass that rewrites a node's children should carry the rest of it. The first, second and
fourth are correct and permanent, because there is no authored statement to point at.

**Capture is always on.** `loc.ts` is opt-in because it allocates an `Error` and
parses a stack. Here there is no stack: the node is in hand and the cost is one frozen object
per statement. More decisively, an IDE cannot set a flag retroactively, and a debugger that only
works when the compile was run with tracing enabled is a debugger nobody can start. The PR that
lands this reports the measured effect on the test suite's wall time and on the goldens
(which must be byte-identical).

**The `fn()` EDSL keeps its own mechanism, and the two are not merged.** One read API,
`sourceSpanOf(node)`, returns the exact span; `getLoc(node)` continues to return the line-level
`SourceLoc` the EDSL's stack capture can produce. Deliberately **no** adapter manufactures a
`SourceSpan` from a `SourceLoc`: a stack frame gives a point (`file:line:col`), and a span has
a width, so any conversion would have to invent the width, and every consumer downstream would
then be highlighting a range the author never wrote. The honest statement is that the two
surfaces can produce different things, that the debugger needs the exact one, and that it
therefore supports `"use typeshade"`, which is precisely what was asked for. Should the EDSL
ever want stepping, the answer is not an adapter but a `fn()` that captures widths, which
stacks cannot give.

### 3.5 The read API

```ts
/** The authored source span of an IR node, when the node came from a `"use typeshade"`
 *  compilation and no pass has rebuilt it from scratch. */
export function sourceSpanOf(node: Stmt | Expr | FuncDecl): SourceSpan | undefined
```

A function rather than a bare field read, for three reasons: it is the one place to document
what "undefined" means (the EDSL, a synthesised node, a pass that rebuilt rather than spread);
it keeps the field itself out of the shape a consumer is encouraged to construct by hand; and
it gives a later expression-span increment, or a side-table fallback for a node kind that
cannot carry a field, somewhere to live without a breaking change. The field stays visible in
the IR types, because `src/__api__/surface.md` records the shape either way and hiding it would
be worse.

## 4. The launch configuration

### 4.1 One schema, three carriers

The same object describes a debug run whether it arrives as a `launch.json` entry in VS Code,
a form in the Playground, or an argument to a headless test. It is defined here, as an
exported TypeScript type and a JSON Schema baked like `src/__api__/surface.md`, so that the
extension's `launch.json` contribution and the Playground's form cannot drift from each other
or from the engine.

```jsonc
{
  "type": "typeshade",
  "request": "launch",
  "name": "fs at (100, 50)",
  "program": "${workspaceFolder}/examples/hello.shade.ts",
  "entry": "fs",
  "stopOnEntry": true,
  "precision": "f32",
  "derivatives": "zero",
  "invocation": {
    "position": [100.5, 50.5, 0.0, 1.0],
    "front_facing": true,
    "inputs": { "uv": [0.5, 0.25] },
  },
  "bindings": {
    "camera": { "view": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], "pos": [0, 0, 5] },
    "pixels": [0, 0, 0, 0, 0, 0, 0, 0],
  },
}
```

`program` and `entry` are required. Everything else has a default, and the default is the
zero of the type, which is what the Playground's "Run on the CPU" does today and what
`zeroOf` (`src/core/cpu-runtime.ts`) already computes from a `ShaderType`.

### 4.2 The invocation

**Decision: one object keyed by WGSL builtin id, plus an `inputs` map keyed by parameter or
entry-IO field name, rather than three per-stage shapes.** The grammar
(`docs/use-typeshade-surface.md` §3) already makes stage inputs explicit parameters carrying
`@builtin(...)` or `@location(n)`, and `reflect()` already reports them as `EntryIo`. Keying
the configuration the same way means the debugger validates it against reflection rather than
against a hand-written table per stage, and an unknown key is an error naming the builtins the
entry actually declares.

| Stage       | Keys that mean something                                                                                                                                                                                    | Defaults                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `@vertex`   | `vertex_index`, `instance_index`; `inputs` for each `@location(n)` vertex attribute, by field name                                                                                                          | `0`, `0`, zeros                  |
| `@fragment` | `position` (a `vec4`: x, y in pixels with the half-pixel centre the author must supply themselves, then z, w), `front_facing`, `sample_index`; `inputs` for each interpolated `@location(n)`, by field name | `[0,0,0,1]`, `true`, `0`, zeros  |
| `@compute`  | `global_invocation_id`, `local_invocation_id`, `workgroup_id`, `local_invocation_index`, `num_workgroups`, and `dispatch`                                                                                   | all zeros, with derivation below |

Four builtins the front end accepts as an entry input have no row above: `sample_mask`
(fragment), `subgroup_invocation_id` and `subgroup_size` (compute), and `clip_distances`, which
`builtin-check.ts` leaves unconstrained. Nothing special happens to them. The resolver is keyed
by the entry's OWN declarations rather than by this table, so each of the four is namable where
an entry declares it, and each reads as the zero of its type when omitted, the same default
every other omitted input gets. The table is what a reader needs, not what the resolver
consults.

For compute, supplying `global_invocation_id` alone is the common case, so three of the others
are **derived** from it and the entry's workgroup size rather than left at zero:

```
size                   = [workgroupSize, 1, 1]
workgroup_id           = floor(gid / size)
local_invocation_id    = gid % size
local_invocation_index = local.x + local.y * size.x + local.z * size.x * size.y
```

The size is `[workgroupSize, 1, 1]`, from the scalar `reflect()` reports, because that is all
the backend carries: `@compute([x, y, z])` with a `y` or `z` other than `1` is rejected at the
front end (`TS8026`), precisely so a shape the backend would silently drop cannot be written.
A genuinely three-dimensional derivation waits on the backend carrying three extents, and the
formulas above are already written for it.

`num_workgroups` is the exception, and it is not derivable: the number of workgroups is a
property of the **dispatch** rather than of any one invocation, and nothing else in the configuration
knows it. So the invocation object carries a `dispatch: [x, y, z]` field, defaulting to
`[1, 1, 1]` rather than zeros, since a dispatch of zero workgroups runs nothing and zero is
never the value a session wants, and `num_workgroups` is that field. Supplying `num_workgroups`
directly overrides it.

Supplying one of the derived values explicitly overrides the derivation. Supplying an
inconsistent pair is an error rather than a silent pick, because a wrong invocation id is
exactly the kind of thing that makes a whole debugging session lie.

### 4.3 The bindings

`bindings` is keyed by the declared name, the same key `CpuModule.setBinding` takes. Values are
JSON in the CPU value model, which is already the model the oracle and `compile(src).eval` use:

| Shader type                         | JSON                                                            |
| ----------------------------------- | --------------------------------------------------------------- |
| `f32` / `i32` / `u32`               | a number                                                        |
| `bool`                              | a boolean                                                       |
| `vecN` / `mat4`                     | a flat array of numbers, column-major for matrices as the IR is |
| a struct                            | an object keyed by field name                                   |
| `array<T, N>` / `storage<array<T>>` | an array of the element's form                                  |

An omitted binding is the zero of its type. A binding given a value whose shape does not match
its declared type is an error before the run starts, naming the binding and both shapes,
again because a silently reshaped buffer produces a plausible wrong answer, which §1.3 calls
the worst failure mode a reference can have.

### 4.4 Textures and samplers

**Unsupported in this milestone**, because the `"use typeshade"` type map has no `texture` or
`sampler` spelling: no shader written in the source language can declare one, so there is
nothing for the configuration to fill. A shader that reaches a `textureSample` through some
other route gets the stub value and the "this is a stand-in" marker of §2.4, never a silent
zero.

When the grammar gains them, the shape this document proposes is a binding value that is one
of three forms, so that the cheap case stays cheap:

```jsonc
"albedo": { "color": [1, 0, 0, 1] },                        // a constant: every texel
"albedo": { "image": "./fixtures/albedo.png" },             // a small image beside the shader
"albedo": { "size": [2, 2], "texels": [ /* rgba rows */ ] } // inline, for a test
```

with `addressMode` and `filter` optional and defaulting to `clamp-to-edge` and `nearest`.
Nearest only at first: a bilinear filter is easy, but mip selection is not, because
`textureSample`'s implicit LOD is derived from the same quad derivatives §2.4 defers. An
explicit-LOD read (`textureSampleLevel`) can be exact from the start.

### 4.5 Watch expressions

A DAP `evaluate` request and a Playground watch box both ask the same question: what is the
value of this expression, here, now. The proposal reuses the front end rather than building a
second evaluator: synthesise a `"use typeshade"` source that carries the module's own
declarations plus one helper whose parameters are the frame's in-scope names with their
recorded types and whose body returns the typed expression, compile it with `compileTsSource`,
and evaluate that one function against the frame's environment.

What that buys: the snippet is checked by the real compiler, so a type error in a watch is the
same diagnostic the editor would show, and a watch can call the module's own helpers. What it
costs: a compile per distinct expression (cacheable by text and frame shape), and the snippet
sees only what the frame has names for, never a value mid-expression, which would need the
expression spans §3.3 defers.

## 5. Decisions

These were the document's open questions. The owner answered all eleven, through the
orchestrating session, on 2026-09-14, taking the suggested answer in every case. They are
recorded here as decisions rather than proposals, and the sections above follow them.

1. **Line and character on `SourceSpan` are zero-based.** The language service is zero-based
   (LSP); `TsCompilerDiagnostic` is one-based. `SourceSpan` follows the editor-facing
   convention, the diagnostic shape is left alone, both are documented, and the two converge
   only when diagnostics take a breaking change for some other reason.
2. **Spans are always captured, never behind a compile option.** An IDE cannot set a flag
   retroactively, and the cost is one object per statement with no stack walk. Revisit only
   against a measurement.
3. **In milestone 1, a span goes on `call` expressions and on an assignment's target, and on
   no other expression.** Hover and expression-level stepping want more; they are additive at
   the same capture sites and wait until something needs them.
4. **A derivative reads as the existing stub value, visibly marked in the variables view as a
   stand-in rather than a computed value**, so no one mistakes `0` for a result.
   `derivatives: "quad"` is an opt-in for later, when someone has a derivative bug, carrying
   the divergence caveat of §2.4.

   Which milestone delivers which half is worth writing down, because M2 shipped only one of
   them. M2 has `DebugSession.stubbedIntrinsics`, a run-wide list of intrinsic NAMES: it
   answers "did anything stand in during this session, and what", which is a banner, not a
   marking. Marking a VALUE needs to distinguish one local from another, and a name cannot;
   that is `DebugStackFrame.stubbedLocals`, which lands with the milestone-3 work. This
   decision is met when both are in, and until then a variables view can say that the run
   stubbed something but not which number it stubbed.

5. **The debugger runs the module before the optimizer**, because the author is debugging the
   program they wrote. The passes it does run are the ones `compileModule` runs: `validate`,
   then `autoVars`, then, once decision 6 makes `f32` the default, `froundF32`. That third one
   has two consequences worth writing down. A stepper resolving a call to step into must look
   through the `__fround` wrapper the pass puts around an f32-typed call, or every step-into
   lands on the rounding rather than the callee. And §4.5's watch snippet evaluates at the
   session's precision, so a watched expression agrees with the locals beside it rather than
   answering in a different arithmetic. "Debug the optimized module" is a separate, honestly
   labelled mode for chasing optimizer bugs.
6. **Stepping evaluates at `f32` by default**, because the author's question is what the GPU
   computes, and the mode is visible in the UI: `f64` answers a different question, and the two
   disagree exactly where the interesting bugs are.
7. **The engine ships on its own `./debug` subpath.** `./dev` is lint,
   diagnostics and optimizer measurement, consumed by tests; the debugger's consumer is an IDE,
   and a subpath is the cheapest way to keep the two dependency graphs apart.
8. **The DAP server lives in `typeshade/vscode-typeshade`**, beside the LSP server that
   `docs/language-service-api.md` §1 and §10 already place there. This repository ships the
   engine and the schema and nothing editor-shaped.
9. **Compute steps one invocation; there is no workgroup scheduler yet.** No barrier or
   workgroup-shared spelling exists in the grammar, so there is nothing to schedule; the
   generator design of §2.1 is what keeps the scheduler possible later.
10. **Approach B is not built now, and is not rejected.** Milestone 1's spans are exactly what
    a V3 map consumes, so the decision can be made later against a measurement of the stepping
    engine rather than a guess about it.
11. **A debug session becomes shareable as a file in milestone 3**, where the schema is baked:
    a `.typeshade-debug.json` beside the shader, so a bug report carries the invocation and the
    bindings that reproduce it. It is the §4 object with no `launch.json` wrapper.

## 6. Still open

Nothing about the design. Two things this document deliberately leaves to the milestone that
meets them, so they are not questions waiting on an answer but work waiting on a reason:

- **When quad derivative evaluation is worth its four evaluations** (decision 4 defers it, §2.4
  says what it would cost).
- **Whether the stepping engine's performance ever justifies approach B** (decision 10 keeps
  the door open, §2.2 says what it would buy and what it would give up).

Last updated: 2026-09-14
