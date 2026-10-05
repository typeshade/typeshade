# Changelog

All notable changes to `typeshade` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before `1.0.0` the minor is the breaking
position: a breaking change ships only in a new `0.N.0`, and a `0.N.P` only fixes and adds.
What counts as breaking, and the deprecation window a change of meaning takes, are design rules
13.9 and 13.10 (`docs/language-design.md`; the procedure is `RELEASING.md#7-versions-and-deprecations`).
A released version is headed `## [X.Y.Z] - YYYY-MM-DD`.

This file starts where TypeShade was separated from the X-GIS monorepo. Everything before that
— the IR, the three backends, the pass pipeline, and the breaking changes that shaped them — is
in [`docs/HISTORY.md`](docs/HISTORY.md), kept as its generator produced it. Nothing in this
repository was published to npm before **`0.1.0`, the first release**.

## [Unreleased]

### Added

- **A texture read back as bytes or as numbers, in the order it was submitted** (proposal 0028,
  item 5; design rule 11.11; surface §69; #407). `texture.read()` copies every uncompressed
  colour format of WebGPU and `depth32float` as bytes, rows tightly packed, where it copied
  sixteen formats, and `texture.readFloats()` resolves to a `Float32Array` of the same texels'
  channels as numbers, in the format's channel order: a float format decoded (a half float
  exactly), a `unorm` format 0 to 1, an `snorm` format -1 to 1, and `depth32float`. An integer
  format rejects with a `TypeError` that names `read()`. A host that read an `rgba16float`
  target decoded the half floats itself (stepinside wrote a `halfToFloat`), and the site's
  storage textures of `rgba8snorm` and of the integer formats were refused.
  - A read reads what was submitted before the call. Its copy is recorded and submitted before it
    awaits anything, so the queue runs it after every submit made before the call and before
    every one made after it: a frame submitted while the read is pending draws after the copy.
    `frame.submit()` and `rt.submit(…)` hand the queue their commands before their own first
    `await`, so a frame counts as submitted from the call and not from the moment its promise
    resolves; a frame recorded and not yet submitted is not read. The JSDoc of `read()` and
    `readFloats()` and surface §69 say so. The read also keeps the size the texture had at the
    call: it read `width` and `height` again after its `await`, so a `resize()` while it was
    pending unpacked the copy at a size it was not made at.
  - The formats are read from their names, the channels, the bits and how each is stored, with
    the four packed ones beside them, so a texel's bytes follow from the format: the 43
    uncompressed colour formats `@webgpu/types` lists, `r16unorm` and the other 16-bit `unorm`
    and `snorm` ones among them, and `depth32float`. A compressed format and `stencil8`,
    `depth16unorm`, `depth24plus` and the two combined depth and stencil formats reject with a
    `TypeError` that names what `read()` copies, before anything reaches the queue. The four
    packed formats decode too: `rgb10a2unorm` as a `unorm` format, `rg11b10ufloat` and
    `rgb9e5ufloat` as floats, and `rgb10a2uint` is an integer format.
  - Two choices the proposal left open. A `bgra8unorm` texel is blue, green, red, alpha, in the
    order its bytes hold it and its name says, so `readFloats()` and `read()` agree channel for
    channel. An sRGB format gives the numbers it stores, its bytes over 255, and not the linear
    values a shader reads.
  - `Texture` gains `readFloats()`, the one export that changes; `src/__api__/surface.md` records
    it.
  - `src/runtime/runtime.test.ts` holds, against the recording device, the bytes and the copy
    each format WebGPU has is given (the list read from `@webgpu/types`, so a format the types
    add is a failure until it is stated), the refusal of each format it cannot copy, the numbers
    each float, `unorm`, `snorm` and packed format decodes to (all 65536 half floats among them,
    held to the standard's formula), the refusal of each integer format, and, against a queue
    that runs each command buffer when it is given it, that a read started before a frame's
    `submit()` reads the texture as it was and one started after it reads the frame, from a frame
    and from the host's own encoders. Each test was shown to fail when `resources.ts` is broken
    in the matching way, among them a copy that waits for a tick before it is recorded.
  - `journeys/hdr-target/` draws values above 1 and below 0 into an `rgba16float` target on
    WebGPU through `typeshade/runtime` and reads the target back with `readFloats()`, each value
    a small dyadic number that is exactly the half float the target stores, so a readback that
    decodes one bit wrong fails. The harness starts the read while the frame is pending and
    draws a later frame that clears the target to -1 before the read resolves; the read holds the
    first frame, and the target afterwards the clear. A run names its float `target`
    (`journeys/README.md`).
  - `typeshade/runtime` is now 11,722 bytes minified and gzipped, 580 more than the 11,142 it
    was, and its budget in `scripts/bundle-budget.json` moves from 11,600 to 12,900 in this
    change, where a reviewer reads it: the size and about a tenth more, as the script's header
    says. The table of formats and their bytes is 138 of them, and `readFloats()` with its
    decoders is 442, about 90 of those the three packed formats'. `typeshade/emit` is as it was.

- **A program packed under emit options** (proposal 0028, item 4; design rules 11.10 and 11.11;
  surface §69). `packModule(m, { emit: { level, parens, fp64Flavor, plugins } })` emits the
  manifest's `wgsl`, its recorded variant's `wgsl`, its `glsl` and the fragment program of each
  of its WebGL2 draws, and its `bindings`, under those options: the WGSL writer's own and an
  optimization level, `'O0'`, `'O1'` or `'O2'`. `fp64Flavor` changes the bindings too, since the
  `'float'` flavor of the `f64` emulation binds the `_fp64` guard and the `'integer'` one binds
  none, so the manifest lists the guard its WGSL declares. The GLSL writer has no level, so
  `level` is the WGSL's alone. `packModule(m)` emitted the program at the defaults, so a host that
  shows or ships it under other options, an application's WGSL tab, could not hand the runtime
  the program it showed.
  - The manifest records what the build gave of `level`, `parens` and `fp64Flavor` in `emit`, so
    `repack` from `typeshade/emit` emits the program again under them and Rule 11.10's promise,
    that the IR emitted again gives every other field byte for byte, holds for a manifest packed
    under options, the recorded variant a load adds included. A manifest built with none has no
    `emit`, and absent stands for the default, so a manifest written before this one reads as it
    did.
  - A plugin is a function, which a manifest cannot record, so `{ ir: true }` with `plugins` is a
    `TypeError` that says the load-time emitter could not emit the program again. A word an
    option does not take is a `TypeError` too, naming what the option takes: the writers read an
    unknown level as the full optimizer, an unknown `parens` as `'minimal'` and an unknown flavor
    as `'float'`, and the manifest would have recorded the word it was given. A WebGL2 draw reads
    the block and sampler names it binds by from the program the plugins leave alone, since a
    text plugin such as `minify` writes a declaration this reads by its spacing, and ships the
    program the plugins write; the names a plugin keeps are the ones a host binds by.
  - `PackOptions` gains `emit` and `Pack` gains `emit`, the two exports that change, and
    `src/__api__/surface.md` records both; no name is new. `PackOptions` is declared beside the
    builder now, in `src/core/manifest.ts`, since it names the writers' types, and `Pack['emit']`
    spells the words out, so that the program runtime's module closure is the 29 modules it was
    and reaches no emitter; the build stops when a word is in one and not in the other. The
    plugin's options are as they were (`typeshade({ console, ir })`, surface §64).
  - `src/core/manifest.test.ts` packs every example under each of three levels with each of the
    two flavors, under `parens: 'minimal'` and under all three, and holds the manifest's WGSL to
    what the writers emit under those options and `repack` to giving the manifest back byte for
    byte; and, for six subjects, two of them programs that emulate `f64`, that each level, flavor
    and `parens` gives the GLSL, the bindings, the recorded variant and the WebGL2 draws those
    options emit, the guard among the bindings only under the `'float'` flavor. It holds each
    refusal's sentence, and
    fails when an option is left out of the WGSL, the GLSL, the recorded variant, the bindings
    or a draw, when the manifest does not record its options, and when `repack` does not read
    them. `src/runtime/runtime.test.ts` holds, against the recording device, that the runtime
    makes its shader module from the manifest's text and lays it out by its bindings, and that
    the variant a load-time emitter adds is the one the recorded options emit.
  - `journeys/emit-options/` runs a compute entry and a full-screen draw that compute in emulated
    doubles on WebGPU through `typeshade/runtime`, each packed at the defaults and under four
    sets of options, and holds every result to plain JavaScript's doubles and to the CPU oracle's.
    It fails when the WGSL leaves out the flavor its bindings follow ("Binding doesn't exist"),
    and it found the bug listed under Fixed: Tint refused the WGSL that `parens: 'minimal'` wrote
    for an arithmetic operand of a bitwise or shift operator.
  - `typeshade/runtime` is still 11,142 bytes minified and gzipped, and `typeshade/emit`, which
    carries the manifest builder, is now 76,132, 6,368 under its budget. Rule 11.11's rationale,
    surface §69 and the header of `scripts/bundle-boundary.ts` said about 10 KB for the runtime,
    which it was before the overrides, the sample types and the console's counts, and about 75 or
    78 KB for the emitter; they say about 11 and 76.

- **The console's counts, to the host** (proposal 0028, item 3; design rule 11.11; surface §69).
  `frame.submit()` and `rt.submit(…)` resolve to what the console buffers of that submit held,
  `{ console: [{ entry, lines, dropped }, …] }`: a row for each dispatch and draw that recorded,
  in the order they were recorded, with its entry (a draw's is its fragment entry), the lines the
  buffer kept and the calls that did not fit it. A runtime given a sink,
  `createRuntime({ console: sink })`, prints nothing now: it printed the warning for the calls
  that did not fit on the host's console beside the sink, so a host that shows the lines itself
  could not show how many were dropped. The default, `'print'`, prints the lines and the warning
  as it did.
  - `Frame`'s and `Runtime`'s `submit` are the two exports that change; they resolved to nothing.
    The row type is written where `Frame.submit` declares it, and `Runtime.submit` returns the
    same type, so no name is new. `src/__api__/surface.md` records both.
  - `lines` counts each `console.*` call the buffer kept once, as the sink receives it, so a
    `console.table`, which is printed as two calls of the host's console, is one line. A
    dispatch whose entry made no call is a row all the same, with no lines.
  - `src/runtime/runtime.test.ts` holds, against the recording device, a row for each dispatch
    and each draw with its entry, in the order recorded, from a frame and from the host's own
    encoders; a submit that recorded nothing; that each submit gets the rows of its own; that a
    runtime given a sink prints nothing, the warning included; and that the default prints the
    lines and the warning as it did. `journeys/_harness.mjs` read the dropped count by patching
    the page's `console.warn`, which a runtime given a sink no longer prints to; it reads the
    counts from `submit()` now, holds the rows to the entry that records, the lines to what the
    sink was handed and the dropped count to what the buffer had no room for, and fails when the
    runtime prints the warning.
  - `typeshade/runtime` is now 11,142 bytes minified and gzipped, 458 under its budget.

- **A texture's sample type, from the calls that read it** (proposal 0028, item 2; design rules
  11.10 and 11.11; surface §69; #404). `reflect()` reports each sampled texture's `sampleType`,
  WebGPU's word for what a `GPUTextureBindingLayout` takes: `depth` for a depth texture, `uint` or
  `sint` for an integer one, `float` for an `f32` texture that a call pairs with a `sampler`, and
  `unfilterable-float` for every other `f32` texture, which no sampler reads: one the program only
  loads, measures or counts, one no entry reaches, and a multisampled one (#414). The manifest
  carries it in the binding's `resource`, and the program runtime lays each texture out by it. The
  runtime laid out every `f32` texture `float`, which takes filterable formats only, so a host
  could not bind an `r32float` or an `rgba32float` texture that a program only loads, and WebGPU
  named the layout in its error and not the binding.
  - The pairs are read where the handles flow, not only where a call names two bindings: a
    `textureSample` of any form or a `textureGather`, which puts its component first, through a
    helper function's parameters, and through a `const` of the texture and of the sampler.
    Measured on Dawn (Chromium 153, SwiftShader), a texture laid out `unfilterable-float` beside a
    `filtering` sampler is refused for each of them and accepted when the texture is only loaded.
    `texturePairs`, which gave the WebGL2 tier the sampler each texture is fused with, read a
    call's first two arguments through plain names, so it missed `textureGather(0, t, s, uv)`, a
    helper's parameters and a `const`, and would have left the `albedo` of `cube-array-gather` an
    `unfilterable-float` texture a sampler gathers. It is now one analysis,
    `src/core/passes/texture-pairs.ts`, for both consumers: the WebGL2 tier's `samplers` name the
    sampler of a texture read through a `const`, which they left `null`.
  - The sample type follows the texture and not one entry: a texture one entry samples and another
    loads is `float` for both. A module with a `raw` statement in what its entries reach is opaque,
    so its `f32` textures are `float`, as they all were; a module with no entry is read whole,
    since a host writes the entries over it. A manifest written before the sample type existed
    carries none, and the runtime lays its texture out from its element, as it did.
  - `BindEntry` gains `sampleType`, the one export that changes, and `src/__api__/surface.md`
    records it; the manifest's `PackResource` carries the same word.
  - `src/core/passes/texture-pairs.test.ts` holds each way a call pairs a texture with a sampler
    and each it does not, `src/core/manifest.test.ts` holds every example's texture to the calls
    in its WGSL, and `src/runtime/runtime.test.ts` holds, against the recording device, the layout
    of a texture only loaded and of one a sampler reads. `journeys/textures/` binds an `r32float`
    level a program only loads, beside two textures a sampler reads, on WebGPU through
    `typeshade/runtime`; it fails when the runtime lays the level out `float`, and when a texture a
    sampler reads is laid out `unfilterable-float`.
  - `typeshade/runtime` is now 11,105 bytes minified and gzipped, 495 under its budget, and
    `typeshade/emit`, which carries `reflect()`, 75,526.

- **A host sets a program's overrides by name** (proposal 0028, item 1; design rule 11.11; surface
  §69). `RenderState.constants` and `program.compute(entry, { constants })` take a record of
  override name to value, and every stage of the pipeline is created with it as WebGPU's
  `constants`, keyed by the name the source declares, which is the name the WGSL declares. An
  override the record leaves out keeps the default its declaration states. The runtime made every
  pipeline with no values, so a host had no way to set one.
  - A name the manifest's `overrides` does not list is a `TypeError` that names the program's
    overrides; a value its type cannot hold is a `TypeError` that says what the type takes: an
    `f32` takes a finite number no larger than 3.4028234663852886e38, an `i32` or a `u32` a whole
    number in its range, and a `bool` a boolean or a number, where 0 is false. Measured on
    Chromium 141, WebGPU alone refuses an undeclared name without saying which overrides the
    module has, and converts silently a fraction for an `i32` or a `u32`, and a string or a
    boolean for any type.
  - The pipeline cache keys on the values, so two states that differ in an override are two
    pipelines and the same values give the same pipeline back, whatever order the record is
    written in and whether a `bool` is spelled `true` or `1`. An `f32` tells `-0` from `0`, which a
    shader can tell apart; an integer has no `-0`.
  - `Program`'s `compute` takes the options as its second argument, and `RenderState` gains
    `constants`; each option's default is in its JSDoc, and `src/__api__/surface.md` records both.
  - `src/runtime/runtime.test.ts` holds, against the recording device, the values each stage is
    created with, each type's refusal with its sentence, the values each type holds and the
    cache's key. `journeys/overrides/` runs a compute entry and a render pair on WebGPU through
    `typeshade/runtime` at their defaults, at other values and at one value with the rest at
    their defaults, each result held to a plain JavaScript reference and to the CPU oracle's run
    of the module with the values as the overrides' defaults. The journey fails when the compute
    stage, the vertex stage or the fragment stage is created with no values.
  - `typeshade/runtime` is now 11,099 bytes minified and gzipped, 501 under its budget.

- **CI runs the type check and the unit suite on TypeScript 5.9 and 6.0, beside the pinned 5.6.3**
  (#259; Rule 13.4). `typecheck + unit` installs the 5.6.3 that `package.json` pins, and the
  editors that load the language service ship newer ones. A newer TypeScript had already changed
  what the compiler reads once, with the pinned one silent: TS2454 on workgroup memory, reported
  from 5.7 (#247). The `typescript-versions` job installs 5.9.3 and 6.0.3 over the pin with
  `bun add --no-save`, fails a leg that does not run the version it names, and runs
  `bun run build` and `bun run test`. Each leg is a check of its own, named for its version:
  `typecheck + unit (TypeScript 5.9.3)` and `typecheck + unit (TypeScript 6.0.3)`. The release
  workflow waits on both. With #247's rule disabled, `src/language-service/ambient.test.ts`
  passes 228 of 228 on 5.6.3 and fails four Playground examples on each new version: the editor
  half, which the pinned version could not read.
  - `src/api-surface.test.ts` was red on both new versions with the surface unchanged. TypeScript
    5.7 prints a typed array with its default type argument, `Uint8Array<ArrayBufferLike>`, in 4
    shapes, and 6.0 turns `strict` on by default, which put `| undefined` on the optional members
    and moved 166 lines. The reader now sets `strict: false` and drops that type argument, so
    `src/__api__/surface.md` is byte for byte the same baked on 5.6.3, 5.9.3 and 6.0.3, and two arms
    hold the reader to each.
  - The peer range stays `>=5.0.0 <6`. 6.0.3 passing is what admitting it would rest on, and
    that decision is not part of this change.

### Changed

- **The CPU tier's code is written by type, and a host call of a small function is several
  times faster** (#410; Rules 11.7 and 8.21). The generated CPU code wrapped every
  subexpression in the generic `$.B["__fround"](…)`, which made a new array for a vector at each
  use, built a swizzle's index list on every call, sent vector arithmetic through `applyBin` and
  its operator string, and rounded a parameter again at every read. It now reads the IR's
  types: a vector operation of a known width is written out one component at a time, each
  component the scalar operation the runtime helper applies to it; a per-component builtin
  calls the one scalar function its `BUILTINS` entry is built from (`COMPONENTWISE`); `dot`,
  `length`, `distance`, `normalize` and `cross` are summed term by term in their entries' order;
  `Math.fround` and every helper are bound once at the top of the module; an `f32` parameter is
  rounded once as the function is entered; and a value the code has just built is stored
  without a copy. An operand with an effect, and every operand before one, is still evaluated
  once and in order. A vector operand that may be missing when the code runs (the result of a
  function that reaches a `discard`, an element read past the end of an array, a matrix column
  past its last) keeps the runtime helper, which takes it as a scalar, as the interpreter does,
  where a component read would throw; the module is followed once for where such a value goes.
  At the boundary, `toShader` converts a number that fits without descending the parameter's
  type and a vector or matrix with one loop for its element kind, `fromShader` copies an array
  without `Array.from`, and the call takes its arguments without an array spread. Results and
  refusals are unchanged bit for bit, but for one thing: a component that nothing reads is no
  longer computed, so an error that only it would raise (a field read of an array element past
  the array's end) is not raised. `src/core/cpu-codegen.test.ts` holds each new path to the
  interpreter in both precisions at NaN, ±0, the infinities, subnormals and the integer wrap,
  with shared argument arrays, calls that write an operand between the operands, and values the
  module leaves missing; `src/core/host-values.test.ts` holds each conversion to the one it
  replaces, its refusals' text and what it reads of a host array (an accessor, a `Proxy`)
  included; and the compile gate's entry calls and the GPU differential's WebGL2 leg hold the
  generated code to a GPU. The issue's two functions, called
  in Bun: a host call pair from about 3.4 µs to 0.5 µs, the two bodies alone from 1.25 µs to
  0.1 µs (medians of ten timings on a loaded machine; the same code by hand is 0.05 µs).

- **The `typescript` peer range takes TypeScript 6** (#259). `peerDependencies` reads
  `>=5.0.0 <7`, where it read `<6`. CI runs the type check and the whole suite on 6.0.3 as well
  as on the pinned 5.6.3 and on 5.9.3, so a project on TypeScript 6, the version VS Code ships,
  installs `typeshade` without a peer conflict. TypeScript 7 stays out: its default export has
  no `SyntaxKind`, and the package throws on import against it. A wider range breaks nothing
  (Rule 13.9 counts only a narrower one).

### Fixed

- **`parens: 'minimal'` keeps an arithmetic operand of a bitwise or shift operator wrapped**
  (found by proposal 0028's journey of programs packed under emit options). WGSL's grammar takes
  unary operands for `&`, `|`, `^`, `<<` and `>>`, so `a & b - c` is "mixing '&' and '-' requires
  parenthesis" to Tint, and the writer had left the operand bare: `a & (b - c)` was written
  `a & b - c`, and `h << (24u - n)` `h << 24u - n`. Tint refused the WGSL of 27 examples under
  `{ parens: 'minimal', fp64Flavor: 'integer' }`, whose emulated-double helpers are made of such
  masks and shifts, and of `module-const` and `rng-method` under either flavor. GLSL ES 3.00 reads
  the bare form as intended, so it was right there and gets the parens too. Measured on Tint
  (Chromium 153, SwiftShader): every example's WGSL compiles under each of the twelve
  combinations of level, `parens` and `fp64Flavor`, but `clip-planes`, which needs the
  `clip-distances` feature of the device. `src/core/emit-parens.test.ts` holds each shape, and
  scans every example's WGSL under `'minimal'`, in both flavors, for a bitwise or shift operator
  beside another operator at one level; it fails without the fix and reaches 243 and 2,704
  such operators.

- **An editor's output pane prints the WGSL and GLSL `compile()` emits** (Rule 12.7). The
  language service's `getCompiledOutput`, which the VS Code preview's WGSL and GLSL tabs show,
  built its module without the overrides, the enables and the `diagnostic(...)` directives. A
  program with an override printed WGSL that reads it and never declares it, and a program whose
  entry turns off `derivative_uniformity` printed WGSL without the directive; WebGPU refuses
  both. It now builds the module `compile()` does. `src/language-service/compiled-output-parity.test.ts`
  holds the pane's text to `compile()`'s for every example: byte for byte, but for
  `inferred-returns`, whose functions the two runs of the front end lower in another order and
  whose texts hold the same lines.

- **A stepped run folds a kernel function's reduction in the tree order** (Rule 7.2, #362). A debug
  session ran a reduction loop the proof accepts in iteration order, where `compileModule`,
  `compileModuleJs` and the GPU fold it in the tree (`src/core/kernel-tree.ts`): stepping
  `total(xs)`, `let s = 0.; for (const x of xs) { s += x; }`, over `[1e8, 1, -1e8, 1]` in `f32`
  returned 1 where every tier returns 2, so a developer who stepped through it to see why it
  returns 2 was shown 1. The session now takes the loops `treeLoops` names, as the oracle does:
  each iteration starts from the operator's identity, what it leaves is collected, and when the
  loop is over the variable becomes what it held before the loop combined with the fold. The
  oracle and the session share one `reductionIdentity`. A pause inside such a loop shows the
  variable as one GPU invocation holds it, the identity at the top of an iteration (`-0` for a
  float sum) and then what the iteration has combined into it, no longer a running total, and
  `docs/debugging.md` §1.3 says so. `src/core/kernel-tree.test.ts` holds the interpreter, the
  generated CPU code and the session to the same bits on the issue's sum, in `f32` and in `f64`,
  and on a start value, a product, a vector, two variables, a `continue`, a nested loop and an
  emulated double, and to iteration order in a loop the proof refuses and in a function that is
  no kernel; `src/core/debug/step.test.ts` holds what each pause shows. The stepping arm of the
  generated-kernel differential (#349) no longer leaves a float reduction's result out of its
  comparison; it compares in `f32` as well as `f64`, and pins seeds 35 and 51, which caught the
  walk.

- **The determinism report lists a `textureGather` on an integer texture** (Rule 11.2, #175).
  A gather on a `texture_2d<u32>`, a `texture_cube<i32>` or any other integer shape (2d,
  2d-array, cube, cube-array; `u32` and `i32`) was dropped: the walk reads a call's float kind
  from its result, a `vec4<u32>` or a `vec4<i32>` has none, and the node was gone before
  `accuracyOf` was asked. The four packs had hit the same drop, and #164 fixed them and filed
  this one, on the reading that reporting it meant widening `DeterminismEntry.elem`. It needs
  no widening. A gather reads an `f32` coordinate, and the coordinate is what its `filtered`
  row is about, the four texels a footprint selects, whatever the texels hold. So the row is
  listed under the float the gather reads, as a pack's is: `elem: 'f32'`, the same row a float
  texture's gather gets, and one row with a count of 2 for an `f32` gather and an integer one in
  one module, since a row is per operation and float. A module whose only float read was an
  integer cube's gather, the one read a cube of integers has, reported `[]`, which surface §38
  says means every operation has one answer. The shape of `DeterminismEntry`, the words of §38
  and every answer of `accuracyOf` are unchanged; the depth and comparison gathers answer a
  `vec4<f32>` and were listed already.
  `src/core/passes/determinism.test.ts` reads every shape with `u32` and `i32`, the `f32`
  texture beside each as the control, and every depth and comparison form, in `compile()` and
  in the language service on the same source (the `it.fails` that pinned the gap is a plain
  `it`); `src/language-service/ambient-parity.test.ts` has a row for each integer shape.

- **The editor declares the `Math` members the compiler already compiles** (Rule 12.7, #186).
  `Math.log10`, `Math.log1p`, `Math.expm1`, `Math.cbrt` and `Math.hypot` compiled, and the editor
  said "Property 'cbrt' does not exist on type 'MathObject'" (TS2339, and TS2551 on the three it
  could name a neighbour for). `Math.atan(y, x)`, which lowers to WGSL's `atan2` (Rule 9.2), was
  TS2554, "Expected 1 arguments, but got 2". `MathObject` was a list of names written out beside
  the compiler's tables, the 27 aliases and none of the five expansions. Its members are now read
  from those tables, `MATH_FN_ALIAS`, `MATH_EXPAND_ALIAS` and `MATH_CONST_ALIAS`, each function
  with the count of arguments the compiler checks (`EXPAND_ARITY` in `math-expand.ts` for an
  expansion, so `hypot` takes two and a third), and a member joins the editor's `Math` by joining
  the compiler's table. Hover, completion and signature help show them, `Math.atan` with both its
  forms. A wrong count is one diagnostic: TypeScript's TS2554 on `Math.hypot(x)` folds into the
  compiler's TS8003, the code it words the count of an expanded member under (Rule 12.4). No
  value and no emitted text changes: `Math.cbrt(-8)` is still NaN and `Math.log1p(1e-8)` still
  cancels, which #186 records as answering otherwise than ECMAScript does. Measured over every
  member either side names, at every count of arguments from none to four, TypeScript's half
  read unmerged, 9 of 165 cells disagreed, over 7 members, before the fix and 2 do after it, both
  `Math.random`'s (#181: its declaration takes no argument and the compiler takes one seed), which
  is the one exclusion. `ambient-parity.test.ts` holds the sweep, reads its rows from the two
  tables, and reports a name that one of them lacks. Still open, and outside what it reads, since
  it passes `f32` arguments: the compiler takes a vector where a member lowers to a WGSL builtin
  (`Math.sin(v)` on a `vec3`), and the editor says TS2345.

- **A generic whose name nothing declares is an unknown type, with the remedy Rule 12.1 gives**
  (Rule 12.1, #218). `let tile: groupshared<array<f32, 64>>`, the only way an HLSL or GLSL address
  space is written here, was `TS8002 Type arguments are not supported yet (got "groupshared<...>").`
  on the whole `groupshared<array<f32, 64>>`, which names no fix: the base of a generic was outside
  the one order every other name is refused in, so the table's rows for `groupshared` and `shared`,
  and the "Did you mean" for a typo such as `arrray<f32, 4>`, never spoke. It is the sentence of a
  bare name now, on the name, wherever a type is mapped: a module `let`, an entry's body, a
  parameter, a return, a field, an argument of `array` or `uniform`.

  ```text
  TS8002 Unknown type "groupshared". HLSL's groupshared is the workgroup address space here: let x: workgroup<T>.
  TS8002 Unknown type "arrray". Did you mean "array"?
  TS8002 Unknown type "Foo". Declare it in this file, or import it from another shader module.
  ```

  A generic whose name is known keeps its sentence, since what is wrong with it is its arguments:
  `ptr<function, f32>`, `f32<u32>` and a generic alias of the file are still "Type arguments are
  not supported yet". `Map<K, V>`, `Promise<T>` and `Partial<T>`, which a shader has none of, are
  unknown types now, as their bare names were. No program that compiled is refused, and none that
  was refused is accepted. `src/compiler/ts/foreign-names.test.ts` holds both address spaces in
  a module `let`, an entry's body, a parameter, a return type, a field of a class and an argument
  of `array`, in `compile()` and in the editor, with the span on the name and the `workgroup<T>`
  the sentence names compiling clean;
  `src/compiler/ts/unknown-names.test.ts` holds the typo, the two remedies a name nothing is
  spelled like takes, and the generics that keep their sentence.

- **The editor shows the compiler's remedy for a GLSL or HLSL name in a construct the compiler
  refused** (Rule 12.7, #218). The compiler reads a name where it lowers the construct that holds
  it, and it does not lower a `try` and its blocks, a list with no type annotation, a `for…of`
  over a list, an object spread, a `typeof`, a `delete`, a `new Map(...)` or a labelled loop, so
  no one but TypeScript read an `fmod` or a `lerp` written in one. Its report stood beside the
  compiler's refusal of the construct, raw: `Cannot find name 'fmod'. Did you mean 'mod'?`, the one
  spelling that compiles and answers otherwise for a negative operand, since `mod` floors and
  `fmod` truncates, and `Cannot find name 'lerp'.` with no remedy. A list with two calls,
  `const w = [fmod(a, 2.), fmod(b, 2.)]`, showed the compiler's `TS8002` for the missing
  annotation and two of those, in the editor, in `tshc check` and in the MCP server's check. The
  merge now puts the compiler's sentence for the name in TypeScript's place, the one `compile()`
  gives it once the construct is fixed, under the same code and on the name:

  ```text
  TS8002 "const w" needs an array type annotation to take a list, e.g. const w: array<f32, 2> = [...].
  TS8004 Unknown function "fmod". HLSL's fmod is the % operator, which truncates like fmod; mod() floors.
  TS8004 Unknown function "fmod". HLSL's fmod is the % operator, which truncates like fmod; mod() floors.
  ```

  It does so for a name of the table (`FOREIGN_NAMES`) and only where a refusal of the compiler's
  covers the name, which includes the arguments of a generic it refused at its name
  (`foo<groupshared<f32>>`): with none, `compile()` accepts the program and a `typeshade` error
  would say what it does not, and TypeScript's sentence for any other name is the compiler's less
  its remedy. The sentence is built by the functions the lowering builds it with, a value, a callee,
  an assignment target (`gl_Position = …`) and the base of a generic (`groupshared<f32>`) each
  under its own code, so the two cannot drift; an argument of a generic that says what it takes of
  one (`vec3<float>`) gets no sentence from this, since that generic's is the compiler's one
  diagnostic for it (Rule 12.4). `src/language-service/diagnostics.test.ts` holds each of these
  names in every construct it can be written in, eleven for an expression and four for a
  statement, and in the arguments of a generic the compiler refused, against `compile()`'s
  sentence for it, and `src/language-service/check.test.ts` the command's list for the list
  above. `src/compiler/ts/foreign-names.test.ts` reads the editor, which it had read for `fmod`
  alone, on every row it pins through `compile()` and on the controls (`myHelper`, `colr`, a
  declared `lerp`): the same code, text and span, and no TypeScript report beside them.

## [0.1.0] - 2026-09-29

### Changed

- **The user journeys run on the program runtime** (proposal 0025, step 5, first half; Rule
  11.11). `journeys/_harness.mjs` wrote its own WebGPU, 521 lines of it, to run each journey. It
  now imports `typeshade/runtime` in the page as the packed tarball installs it, with no
  bundler; loads each run's manifest from `packModule`; binds each binding by name with the
  journey's host value; and reads the result back through a `Resident` or the target texture.
  The console lines come from the runtime's sink, and its dropped count from its warning. A
  journey's `bindings` are now `{ name: value }`, the host value alone, which the runtime and the
  CPU oracle both take, in place of the packed bytes each journey wrote beside it.

- **The license is Apache 2.0** (was MIT). `LICENSE` holds the Apache License, Version 2.0,
  `NOTICE` is new and ships in the package, and `package.json` says `"license": "Apache-2.0"`.
  Apache 2.0 adds an explicit patent grant and says the license grants no right to use the
  TypeShade name (section 6). What was released before this change stays available under MIT.

- **The command is `tshc`** (proposal 0023; design rules 3.8, 3.9, 12.7 and 13.10; surface §64
  and §68). The package installs its command as `tshc`, the way `typescript` installs `tsc`:
  `typeshade check` and `typeshade sync`, in the entries below, are `tshc check` and `tshc sync`,
  with the same options, output and exit statuses. A `prepare` script that runs `typeshade sync`
  runs `tshc sync`, and a run that may not have the package installed names it:
  `npx -p typeshade tshc check src/`. The command's usage text and the prefix of its errors say
  `tshc`, and a host view's first line names `tshc sync` as what rewrites it. The package, its
  import specifiers, the directive, the host view's name and a diagnostic's `source` stay
  `typeshade`.

- **A name is what declares it, not how it is spelled, and `new` answers by its target** (proposal
  0008 §1 and §2; design rules 2.1, 2.2 and 8.13; surface §7, §26 and §28). The front end kept a
  list of 59 JavaScript globals and refused an identifier by its text as `TS8012` "is a host/JS
  API", at the declaration and at every use, so `enum Status { Ok, Error }`, a `window` parameter of
  a windowing function, a `class Date`, a module `let process`, a generic `<Map>` and a local
  function `self` were each refused although TypeScript and the editor took them; where nothing
  declared the name, `TS8012` came beside the unknown-name
  sentence. The list and `TS8012` are gone, and its number stays a gap (Rule 12.2). A name the
  file declares is the file's whatever it spells, and all six compile, measured on Tint; so do
  a `class Mat`, a `class String` and an `interface Pick` (in `uniform<Pick>` too), whose names
  the ambient library also gives types of its own, in every position a type is written. Two
  spellings are the exception, as ECMAScript's strict mode makes them: `eval` and `arguments`
  bound by a variable, a parameter or a function are `TS8068`, once, on the name, `"eval" is
reserved in ECMAScript's strict mode, which every "use typeshade" file is in, so a local of that
name cannot be declared. Rename it.`, where the editor says TS1215 (which merges into it, with
  its word on a later write of the name) and the host import's generated module would not load;
  a class, an enum, a namespace or a type of either name compiles, as TypeScript takes it. The
  host import's generated module binds no name the file declares: each export is bound under a
  name of the generator's own and exported under the file's, so an export named `Object`, `Math`
  or `NaN` no longer shadows the `Object.freeze` of an enum or the `Math.imul` of the CPU tier,
  which left the module unable to load; a kernel function (0013) is bound the same way, where it
  was exported as written. A name nothing declares is one diagnostic, in proposal
  0007's words and with its remedy, in a body a call lowers and in one no call lowers alike (an
  uncalled generic, a function that takes a function, a method of a class nothing builds), where
  the lowering never reads it (`window`
  there was `TS8012`, and `nope` nothing at all): `TS8022` for a value (`window`, `Date.now()`, `Map`) and
  for a written target (`Date = 1.`, "Cannot assign to unknown name"), `TS8004` on the callee's
  name (`fetch("x")`), where a string or a function handed to an unknown callee now says nothing
  more, as it did while the list stood, and `TS8002` for a type wherever it is written: a
  parameter, a return type, a local, a field, a claim (`0.5 as window`, which compiled as
  `0.5`), a type argument (`x: B<Date>` emitted `fn g(x: B)` with no struct `B`, and so did
  `x: B<vec3<Foo>>`, which Tint refuses; `new B<vec3<Foo>>()` was told the file writes no type
  argument), an alias no one uses, a type-parameter default, an overload signature, an
  interface method, a function type, an `implements` clause, the base a class or an interface
  extends (`class C extends Date` was `TS8010 "C" extends "Date", which this file does not
declare as a struct` beside TypeScript's TS2304, and an unused `interface I extends Date` said
  nothing; `TS8010` stays for a base the file declares and does not collect) and a body no call
  lowers. An argument of a WGSL generic (`vec3<Foo>`, `texture_2d<Foo>`) is the generic's own
  sentence alone, and a module `let`, a static field or a module `const` whose type nothing
  declares is `TS8002` alone, where it also said `"K" is declared struct:Foo but its initializer
is f32`; so is a binding of one, `uniform<Foo>`, where a read `u.a` also said `Unknown field
"a" on Foo.` A name the ambient library declares is declared. A type it declares for
  TypeScript's own use says so where a shader type is due, when the file declares none of its
  name: `x: Number` is `"Number" is not a shader type: the library declares it for TypeScript's
own use. Write f32, i32 or u32.`, where it was `Unknown type`; and where a value is read or
  called: `Number(x)` is `"Number" is a type, not a value: the library declares it for
TypeScript's own use. Write f32(x), i32(x) or u32(x).` (`TS8004`), where it was `Unknown
function "Number". Declare it in this file`, and `const o = Object` the same sentence under
  `TS8022`. `Math` and `console` read as a value are objects of functions, `"Math" is an object
of functions, not a value. Call one of them, Math.sin(x).`, and `Symbol`, which the library
  declares for TypeScript's `for…of`, is `"Symbol" is no value a shader has` (a function, a
  class, where it is called or built), where each was `Unknown identifier`. A declaration of the file wins over
  a §9.3 constant of its name, as it does in the editor: `enum E`, `namespace PI`, `class TAU`
  and `function PI` read as a value compiled to e, π and τ with no diagnostic, and now read as
  the file's (an interface declares no value, so `LN2` still reads through one). None of them is
  a value a shader holds, and neither is any enum, namespace, class or type the file declares:
  read as one, each says what it is and the value it offers, once, where it was `Unknown
identifier "E"` of a name the file declares and the editor added TypeScript's TS2322 about
  `typeof E`: `"E" is an enum, whose values are its members: E.A.`, `"N" is a namespace, not a
value: its values are its members, N.a.`, `"P" is a class, not a value. Build one with "new
P(...)".` (`"N.P"` through a namespace, and no `new` offered in a module constant), `"S" is a
class of static members, not a value: its values are its members, S.k.` and `"I" is a type, not
a value.` A static read or called on a class inside a namespace, `N.P.K` or `N.P.g()`, is not
  the class read as a value, and says what it is: `"N.P" is a class inside a namespace, and a
shader does not read the static members of one ("N.P.g"). Declare "P" at the top level of the
file and use "P.g".`; an enum inside a namespace is refused where it is declared (TS8014), and a
  read of it through the namespace adds nothing. A member is
  looked up on its receiver: a class field `reverse`, an interface field `map` and a getter
  `join` compile, where each was refused as a JS array method by its spelling, and a class
  method named `swizzle` compiles, where every `.swizzle()` call was routed to the IR builder's
  method by its name. A method called on a vector is a member the vector does not have
  (`TS8022`, Rule 2.2), and the sentence names what to write only where it compiles:
  `v.swizzle("yxz")` is `v.yxz`, `v.clamp(0., 1.)` is `clamp(v, vec3(0.), vec3(1.))`,
  `b.any()` is `any(b)`, and `v.sqrt()` on a `vec3u` or `v.swizzle("xyzw")` on a `vec3` is told
  that a vector's members are its components.
  `new` resolves its target as TypeScript does and says what it is once for the file, where it
  is written, so a generic body lowered for three type arguments says it once and a body no
  call lowers says it too, all under `TS8035`: a WGSL constructor or a cast
  (`new vec3f(1., 2., 3.)`, `new f32(1)`), a type alias of one (`type S = vec3`, whose remedy was
  an object literal a vector has no fields for) and a function (`Math.sin` included, and one
  another file declares) are called without `new`, and the sentence gives the call; a WGSL type
  with no constructor (`new sampler()`) and a type the library declares for TypeScript
  (`new Array(4)`) are types; an enum's values are its members; `Math` and `console` are
  objects of functions; a mixin applied to a class is built through a class that extends it; a
  local, a parameter, a §9.3 constant, an enum member, a namespace and a type parameter are no
  class; an interface, a type alias, an `abstract` class and `new this()` outside a static
  member keep their sentences and move from `TS8013` to `TS8035`. `new Date()` is `TS8022`, and
  so is a member the object before it does not have (`new Math.Foo()`); the name a misspelled
  target is spelled like is a class the `new` can build, never a value (`new Pos()` beside a
  parameter `pos` was told `Did you mean "pos"?`, and `new pos()` is refused). A `new` on
  `const A = B` adds nothing to the refusal of that declaration. The "allocates a JS object,
  which a shader has no heap for" reason is gone: `new P(1., 2.)` on the file's own class is
  `P_new(1.0, 2.0)`. `new N.P()` and a bare `new P()` inside `namespace N` build a namespace
  class with no written constructor as a top-level one is built (it was `TS8035 "N_P" has no
constructor here`), `new (C)()` is `new C()`, and every sentence names the class and its type
  arguments as the file writes them, `N.P`, `Pair<N.Q>`, `new Pair<Box<f32>>`, never `N_P`,
  `Pair_N_Q` or `Pair_Box_f32`. A constructor refused at its signature or for a colliding
  `P_new` is that refusal alone: neither the `new` nor a use of the local it builds adds a
  word. So is an import that resolves to no file (`"./nothere"`, or `"./lib.js"`, the usual ESM
  spelling, which `compileTsSources` reads as `lib.js.ts`): the `new` on it was dropped in
  silence and each read of the local it built said `Unknown identifier "o"`. A file compiled on
  its own, as the editor compiles each document, sees no file it imports from and says a `new`
  of an imported name is an unknown name, once for the file, as a call of one is `TS8004`. In
  the editor each of these is one diagnostic: TypeScript's TS7009, TS2351, TS2693, TS2511 and
  TS2708 on a `new` (TS7009 also on the `new` of an import a document compiled on its own
  cannot see, and TS7017 on `new globalThis.Date()`), its TS2304 or TS2339 on a name in the
  target, its TS2583, TS2584, TS2591 and TS2580 on `Map`, `document`, `process`, `require` or
  `Buffer`, and its TS2693 on a library type read or called, merge into the compiler's.
  A module const, a static field (`this.f()` included), a module `let` or an enum member whose
  initializer calls a function or builds a class of the module, imported ones included, is one
  sentence from the declaration's own check, naming it as written (`S.K`, `N.K`): `TS8003
Module const "K" must be constant, and "g()" calls a function this file declares. A module
constant is folded before any function exists, so build the value inside the function that
reads it.`, `TS8033` for a `let`, where it was `TS8004 Unknown function "g()". Declare it in
this file` or `"P" has no constructor here`, then `TS8022` at every read. A read or a write of
  it, a module `let` built from it, and a static field that is not constant (`dpdx(1.)`, which
  was spelled `S_K`) add nothing. Tint refuses the same WGSL with "user-declared functions
  cannot be called at module-scope".
  THREE PROGRAMS THAT COMPILED NOW MEAN WHAT THEY SAY. Inside `namespace N`, a short name `P` is
  the class its own block declares, or one another block of `N` exports, for a `new` and for a
  type annotation alike, ahead of a top-level `P`, as TypeScript resolves it: `new P()` in `N`
  built the top-level class (`N.mk().a` was 7 where TypeScript gives 1, also from a second block
  of `N`), and `const p: P = new P()` there read the top-level class too (7); a class another
  block does not export is not merged, so there `P` is the top-level class, as TypeScript reads
  it. A field initializer that builds a sibling class of the namespace (`a: A = new A()` in
  `N.B`) was dropped from `N_B_new`, so `new N.B().a.x` read 0; it is 1. Each value is pinned on
  the CPU paths and passes Tint. AND ONE THAT COMPILED IS NOW REFUSED: a function of `N` whose
  parameter is written `P` takes `N.P`, so a caller outside the namespace that hands it the
  top-level `P` (`N.f(new P())`, which compiled to 7, and which TypeScript takes structurally)
  is `TS8003 Argument 1 of "N.f" type mismatch.`, as two same-shaped classes of the file already
  are (Rule 12.7's nominal structs); `N.f(new N.P())` compiles.
  Measured: the 82 examples, the 72 `"use typeshade"` fences of the docs and journeys, and 120
  valid neighbours of every changed check (a `new` of every class shape, merged, exported and
  private namespace blocks, calls of every callee kind, the §9.3 constants beside the file's
  names, module-scope builtin calls and literals, writes to module lets and statics, every WGSL
  type and type-parameter form in every type position, type aliases of WGSL types, a mixin's
  `AnyClass` constraint, nested generic instances, mapped and conditional types) give
  byte-identical diagnostics, WGSL and GLSL on main and on this change, but for the namespace
  programs above, an interface field `map` and a class method `swizzle`, which now compile, the
  host names the file declares, and the programs main compiled in silence that name something
  nothing declares, which are now refused where TypeScript refuses them: a name in a body no
  call lowers (`const d = nope` in an uncalled generic), `B<vec3<Foo>>`, and an unused
  `interface I extends Foo`; every program that now compiles passes Tint, every remedy a new
  sentence names compiles, and the emit goldens and the API surface do not move. A name nothing
  declares in a statement the lowering refused on an earlier mistake is said too, as TypeScript
  says it: `f = clmap(f, 0., 1.)` after `const f` is the write's `TS8005` and `Unknown function
"clmap". Did you mean "clamp"?`, where the typo was TypeScript's alone.

- **The editor takes `vec4(x, v3)`, `vec4(v2, v2)` and `vec3(v)` on a `vec3`** (surface §49, Rule
  12.7, proposal 0017). The compiler and WGSL always took them; the editor reported "No overload
  matches this call". The two compositions were left out while declaring them broke the
  inference of `vec4(mix(c * 0.5, d, 0.5), 1.)`, which the projection has since fixed. Every
  constructor and conversion over scalars and vectors is now held to both halves.

- **A static builder says the class the call names with a `this` parameter** (surface §26, Rule
  8.13, proposal 0020). `static unit<C extends Disc>(this: { new (): C; SIZE: f32 }): C` is the
  TypeScript spelling of a static that builds its value with `new this()`, and `Capped.unit()` is a
  `Capped` in the editor as it always was in the compiler. The spelling that wrote the declaring
  class, `static unit(): Disc`, is refused with `TS8035` where a class inherits it, since the editor
  read it as a `Disc`; a static no class inherits keeps it.

- **The atomics, the barriers and `arrayLength` are declared from Tint's overload table** (surface
  §49, Rule 12.7, proposal 0017). Their editor declarations are generated from `core.def`'s rows,
  as the math builtins' are, and the compiler types each call from the same rows. What an author
  sees does not change: the declarations read as they did, and a call's type is the one it had.

- **`array(...)` and an array's `reduce` from a value have the compiler's type in the editor**
  (surface §49, Rule 12.7, proposal 0015). `array(uv.x, uv.y, 1.)` hovers as `array<f32, 3>`
  where it said `array<number>`, and `xs.reduce((a, x) => a + x, 0.)` as `f32` where it said
  `number`: the ambient `array` reads its element and count off its values, and the language
  service writes the running value's type in as `reduce`'s type argument.

- **An unannotated scalar field or return has the compiler's type in the editor** (surface §49,
  Rule 12.7, proposal 0015). `#width = 0.05`, `static readonly MIN_WIDTH = 0.01` and a getter
  that returns `this.r * 2.` hover as `f32` where they said `number` (or the literal `0.01`):
  the language service writes the front end's type in, as it does for a vector. Plain `tsc`
  reads the file as written and still says `number`.

- **A builtin's result has the compiler's type in the editor** (surface §49, Rule 12.7,
  proposal 0017). The math builtins' declarations are generated from Tint's overload table,
  `core.def`, one overload per row, so `dot(a, b)` on two `vec3u` hovers as `u32`, `max(n, m)` on
  two `u32` as `u32`, and `smoothstep(0.3, 0.55, h)` on an `f32` as `f32`, where each said
  `number`; so are the derivatives (`fwidth`, `dpdx`, …) and the bit and packing builtins
  (`countOneBits(u32)` is a `u32`, `pack4x8snorm` a `u32`), all but `bitcast`. A call whose
  numeric arguments are all literals stays `number`, the abstract numeric
  TypeScript cannot tell apart. TypeScript's own report of a wrong argument to one of these names
  is now TS2769 ("No overload matches this call") where it was TS2345; the editor's merged list
  shows the compiler's `TS8036` for it, as it did.

- **A storage binding's access mode is its second type argument, and a binding is declared
  `const`** (§1 and §7, design rules 6.1 and 6.2). `declare const src: storage<array<f32>>` is
  `var<storage, read>` and `declare const dst: storage<array<f32>, "read_write">` is
  `var<storage, read_write>`; the two words are `"read"` and `"read_write"`, WGSL's own
  enumerants, spelled as string literal types the way a storage TEXTURE already spells them
  (`texture_storage_2d<"r32float", "read_write">`). `declare let` no longer means anything: the
  keyword never said what it was read as saying, because a TypeScript `const` array forbids
  rebinding the name and permits `arr[0] = 1`, which is the opposite of what a `const` storage
  buffer meant. `uniform<T>` keeps one type parameter, because a uniform buffer is read-only and
  has no mode to ask for. The `{ access }` option of the call form is gone with it.
  THIS BREAKS EVERY FILE THAT DECLARES A WRITABLE BUFFER, which is most shaders that compute
  anything, and the migration is one substitution: `declare let x: storage<T>` becomes
  `declare const x: storage<T, "read_write">` (a call form's `{ access: "read_write" }` becomes
  the same second type argument), and nothing else in the file moves.
  THE EMIT DOES NOT MOVE. Measured over 15 recorded cases (a read beside a read_write binding,
  atomics, a uniform struct in a render pair, runtime-sized arrays with `arrayLength` on both
  modes, a storage element passed by pointer, storage textures beside a read_write buffer) and
  over all 66 authored examples: the diagnostics, `module.bindings`, the WGSL, both GLSL stages
  and `reflect()` are identical, the 318 files under `examples/__emit-goldens__` did not move
  (102 `.wgsl`, 172 `.glsl`, 22 `.diff`, 22 `.json`, counted with
  `git ls-files examples/__emit-goldens__ | wc -l`; `compute-reduction-twin.semantic.json` pins
  `space/access` explicitly), and the compile gate is 102 examples with 0 failures on Tint and
  on WebGL2.
  THE EDITOR NOW REFUSES WHAT THE COMPILER REFUSES. The ambient library resolves `uniform<T>`
  and `storage<T>` to `ReadView<T>`, one homomorphic mapped type that makes every field, lane
  and index signature `readonly` all the way down while passing the symbol-keyed brands through
  untouched, and resolves `storage<T, "read_write">` to `T` itself. So `src[0] = 1.` on a read
  binding is TS2542 and `u.scale = 1.` on a uniform is TS2540, where TypeScript used to be
  silent and only `compile()` answered; `dst[0] = 1.` on a read_write binding stays clean, which
  is the false positive the readonly index signature was removed for and which is now per
  binding. A read stays a read: `length(p.offset)`, a struct copied out of a read array, a read
  view handed to a mutable parameter and `array<f32, 3>` against `array<f32, 2>` all behave as
  before, measured, and the view costs nothing measurable in the language service. `array<T, N>`
  now picks its members from the surface's own `interface Array<T>` (`Pick<Array<T>, ArrayOps>`
  with `ArrayOps = never`), so an array operation that becomes a method later is declared in one
  place and reaches the read view through `ReadView`'s function-type arm.
  WHAT IS REFUSED. `declare let x: storage<T>` and `declare let x: uniform<T>` are `TS8099`,
  each naming the `declare const` line to write; both report and then COLLECT the binding
  anyway, because dropping it trails `TS8022 Unknown identifier` at every use. An access word
  outside the two is `TS8002` (`storage<T, Access> Access is "read" or "read_write"; got
"write". A storage BUFFER has no write-only mode; that is a storage texture's,
texture_storage_2d<Format, "write">.`) and recovers as `read_write`, which leaves exactly one
  sentence on the program; the storage-TEXTURE half of that sentence is printed only for
  `"write"`, the one mistake it answers, and not for every word outside the two. A second type
  argument on a `uniform` is `TS8002`. The retired `{ access }` option is `TS8099` naming the
  type-argument spelling to write, with its own sentence on a `uniform`
  (`The { access } option is gone, and a uniform buffer is read-only: it has no access mode to
ask for.`), which has no access mode to move into a type argument and no two-type-argument form
  to be sent to. `uniform` and `storage` now DECLARE the slot the call form may name (a binding
  number, a group and a binding, or `{ group, binding }`): every call form that named its slot
  was `TS2554 Expected 0 arguments, but got 1` in the editor on a program the compiler accepts,
  and the retired `{ access }` option is now `TS2353` there as well. A write to a read
  binding is still `TS8005`, and its sentence now names the remedy
  (`Cannot assign to "src" — it is a read-only resource. Write "declare const src:
storage<array<f32>, "read_write">" to write to it.`); the atomics sentence, which used to read
  `which is declared const; declare it with let`, names the mode and the declaration instead.
  EVERY REMEDY NAMES A LINE THAT COMPILES. The type is spelled as an AUTHOR spells it and not
  by the compiler's own key, so a vector is `vec4` and not `vec4<f32>`, a matrix `mat2x3`, an
  emulated double `vec2f64` (the key was `TS2315 Type 'vec4' is not generic` in the editor the
  moment it was pasted); the form is the one the file uses, so a call-form binding is answered
  with `const src = storage<array<f32>, "read_write">()` rather than a `declare const` that
  would be a second resource of the same name; the retired `{ access }` option's remedy
  VALIDATES the word before naming it, so `{ access: "write" }` is answered with `"read_write"`
  and not with a line the next compile refuses; a `declare let` with an explicit mode keeps it,
  so `declare let x: storage<T, "read">` is answered with `"read"` and recovered as `read`; and
  a write no mode would permit gets no remedy at all. The root's access is checked once the
  target is known to be a place, and for both shapes of target: for a MEMBER after all three of
  its refusals rather than after the first (`src.length = 2` is `TS8018`, `dv[0].x = f64(1.)` on
  an emulated-double lane is `TS8018` and `v.xy = vec2(1., 2.)` on a swizzle is `TS8018`, each
  the same sentence on either mode), and for an ELEMENT, so `md[0] = …` on a `storage<mat3<f64>>`
  reads `TS8003 Cannot index mat3x3<f64>` — which is the sentence `main` gave the writable form
  — on either mode.
  Three more lines are named honestly, each measured by pasting it back. The `TS8033` that says
  a resource type needs `declare` carries the mode the KEYWORD asked for, so `let dst:
storage<array<f32>>` names `declare const dst: storage<array<f32>, "read_write">`: the same
  reading of the same keyword `bindings.ts` makes (`isConst ? 'read' : 'read_write'`, because a
  `let` author wanted to write), where quoting the author's text back named the READ form and
  left a program that writes through the binding refused after the paste — one mistake in two
  steps, where `main` closed it in one. A binding whose declared value TYPE was itself refused
  names no line at all, because the line would be built from a type the compiler could not read:
  `storage<mat2x3<f64>>` was answered with `storage<mat2x3, "read_write">`, the `<f64>` silently
  dropped, and `storage<array<vec2h>>` with `storage<array, "read_write">`, the type argument
  dropped entirely, and in both the FIRST sentence is the one the author has to act on. And a
  resource with no type argument names a SHAPE rather than a line, `declare const s:
storage<...>`, since the type is one only the author knows.
  `src/compiler/ts/remedy-lines.test.ts` is the structural pin: it finds every refusal whose
  sentence quotes a declaration, writes that declaration back into the program it came from,
  and requires the result to compile clean AND to be clean in the editor. Pasting alone cannot
  see everything, so two assertions stand beside it: a case may name the line it expects, because
  the paste REPLACES the declaration and a `declare const` written over a call form looks clean
  while an author would be ADDING a second resource of the same name (`TS8023`, measured in both
  placements); and one declaration must draw ONE line, because a program whose refusals quoted
  two different lines for one declaration had the second pasted over the first and only the last
  was ever compiled.
  Three names enter the surface with their §9.3 rows: `StorageBufferAccess`, `ReadView` and
  `ArrayOps`. `declare let x: uniform<T>` closes both halves of the Appendix B row for Rule 6.1,
  which is deleted. Appendix B GAINS a row for Rule 6.2, for the two writes to a read binding
  that the compiler refuses alone: `atomicAdd(bins[0], 1)`, because an `atomic<T>` is one
  symbol-keyed brand with no property to make `readonly` and is written through a call, and
  `acc.add(1.)` on a class-typed read binding, because the view stops at the method boundary and
  `Acc.add` is declared once for read and read_write bindings alike. Both are measured, both are
  listed in §49, and the rule's normative sentence is left as it stands.
  THE RULES MOVED FIRST, as design rule 13.2 requires. Rule 6.1 now says a resource is
  `declare const` and that both `let` spellings are refused, Rule 6.2 says the access mode is
  the second type argument and lists the codes each layer raises, Appendix A's binding row
  carries all three spellings, and Appendix B's row for Rule 6.1 is DELETED: it recorded that
  `declare let x: uniform<T>` compiled with no diagnostic and that the `TS8033` sentence named
  `declare let` as its remedy, and this change closes both halves. Rule 3.6's rationale and
  family 6's shape sentence name the mechanism the surface now uses rather than the one it was
  going to.
  THE TREE MOVED WITH IT, in the same commit: 11 example bindings across seven `.shade.ts`
  files, the storage declarations of 31 of the 32 changed test files (`surface-names.test.ts` is
  the one that is not, and carries the three new extension rows), the two doc comments in
  `SHADE_DTS` that still called a binding transparent — `override<T>`'s "Transparent for the
  same reason as `uniform<T>`" and `workgroup<T>`'s "Transparent like `storage<T>`", both of
  which ship in `dist/shade.d.ts` and are what hover shows — the `README.md` sample and its
  editor-coverage notes — where the TS2542 on a storage write was recorded as a FALSE POSITIVE
  tracked as a fix to the declarations, and is now the correct refusal of a read binding — and
  the north-star block plus the eleven sections of `docs/use-typeshade-surface.md` that carried
  the old form (§1, §5, §7, §8, §9, §19, §20, §23, §24, §25 and §43). §1 and §7 gained the teaching:
  the read form, the read_write form, the WGSL each emits, and every refusal quoted as the
  author reads it; §49, which exists for the places the editor and the compiler disagree, gained
  the row for this one, since the drift it closes runs the OTHER way from the four rows already
  there — the editor was silent where the compiler refused, not noisy where it accepted — and
  three sections more: the two writes only the compiler refuses; the three places the layers
  still part on the second type argument (a non-literal one is `TS8002` and clean in the editor,
  a third one is clean in the compiler and `TS2707` in the editor, and a recovered `declare let`
  binding is one sentence to the compiler and two in the editor); and the two writes the EDITOR
  refuses where the compiler does not, which is the direction §49 calls the worse failure. The
  first of those two is this change's own price and is recorded rather than left to be found: a
  WHOLE-binding write, `s = 1.` on a `storage<f32, "read_write">`, is `TS2588 Cannot assign to
's' because it is a constant` in the editor, because a binding is `declare const` now and no
  value type can make a `const` assignable — it reaches only a scalar, vector, struct or
  emulated double assigned as one, never the `out[gid.x] = …` a kernel writes, which is why no
  example and no test met it until `remedy-lines.test.ts` pasted a remedy in and measured what
  was left. The second is older and unchanged by the read view: a SQUARE matrix column
  (`m[0] = vec4(1.)`) is `TS2322` on `never` on `main` too, since only the square aliases take
  the element as a type parameter and resolve through a conditional. Appendix B's row for design
  rule 12.7 carries both, and the README's "Not covered" list names the first. What
  still reads `declare let` reads it on purpose: the two tests of the new refusal, the handle
  and override refusals in `src/compiler/ts/texture-sampler.test.ts`, the rules and the
  documentation rows that name the refusal, and the #74 entry below, which quotes the spelling
  of the day it records and would become false if it were rewritten.
- **`@compute([8, 8])` is a two-dimensional workgroup** (Rule 8.7, surface §3). The front end
  refused a `y` or `z` other than 1 with `TS8026`, because the IR carried the `x` extent alone.
  All three extents now reach the emitted `@workgroup_size(8, 8)`, the reflection, and the CPU
  `dispatch`, which runs the grid per axis. `FuncDecl.workgroupShape` holds a shape whose `y` or
  `z` is not 1, `workgroupShapeOf(f)` reads it for every consumer, and `fn()` takes
  `workgroupSize: [8, 8]`. `EntryInfo.workgroupShape` is the `[x, y, z]` a host sizes a dispatch
  with; `workgroupSize` stays the `x` extent. A one-dimensional shape emits the bytes it did,
  and every existing golden is unchanged. `TS8026` is now a warning for a shape over WebGPU's
  default compute limits (`x` and `y` 256, `z` 64, 256 invocations in all), naming the limit a
  host has to raise; `x` above 256 compiled with no word before. A `portable` kernel keeps a
  one-dimensional workgroup (`SD0111`), since the WebGL2 lowering has no workgroup to give `y`
  and `z` to. `examples/workgroup-tile-2d.shade.ts`, an 8x8 tile blur through workgroup memory,
  compiles on the gate's Tint.
- **GVN shares a value between an `if` condition and the arms it dominates.** gvn numbered
  one straight-line block at a time: it minted a temp only for a key repeated in two
  statements of the same block, and it handed an enclosing temp to no arm of an `if` that
  wrote one of its roots anywhere. So an escape loop that tests `zx*zx + zy*zy <= 16` and then
  steps with `zx*zx - zy*zy` squared z twice a trip, in f32 and in df64. A key whose first
  occurrence is unconditional is now also minted when a nested block, or a later `if`
  condition, reads it before any root moves; `if` arms and `switch` cases receive the enclosing
  temps and retire each one at the first statement that writes a root; `for` bodies keep the
  whole-statement filter (the back edge). No temp is ever read once. Across the 287 WGSL and
  GLSL goldens, 14 move, all fp64 escape loops: `df64_mul` call sites 362 -> 334 and the
  escape trip 351 -> 277 f32 operations in julia, mandelbrot and burning-ship (362 -> 288 in
  mandelbrot-de). Emitting all 107 examples takes about 8% longer (2211 -> 2383 ms, medians
  of 12 runs), most of it the read table below.
- **A square is `df64_sqr`, and a multiply by a power of two is exact scaling** (§39). `x * x`
  on an f64, when the operand has no effect, lowers to `df64_sqr` (one Veltkamp split and one
  doubled cross term, against `df64_mul`'s two splits and two cross terms); `x * c` or `x / c`
  with `c` an f64 literal equal to ±2^k scales both words by `c` in f32, which is exact under
  round-to-nearest barring overflow or underflow. A scale that can grow a word applies only to
  an operand proven to be a run-time value, so a constant never becomes a WGSL
  const-expression that overflows f32 at shader creation, and a vec64 scale never computes its
  vector twice. The float escape loop is 351 -> 272 f32 operations a trip on its own, the
  integer flavor's 9708 -> 7708, and the fp64 goldens' `df64_mul` call sites 140 -> 56. Over
  seed 0x5a5a, 20,000 pairs, the square's worst error is 2^-46.15 against 2^-46.41 for
  `df64_mul(a, a)`, and along a julia orbit its error grows exactly as fast (mean log₁₀
  relative error after 32 steps -13.50 against -13.53). A module whose only f64 work is
  comparison, widening, narrowing, negation or power-of-two scaling now reads no guard and
  gets no `_fp64` binding; bind what `reflect()` lists.
- **`fp64-julia`, `fp64-mandelbrot` and `fp64-burning-ship` escape the way a practitioner
  writes it.** The loop carries |z|² beside z,
  takes the escape test in f32 from the narrowed words on the double half (48 bits move a
  value across 16 only from within an f32 rounding of it; `f64Parts` is internal, Rule 2.2,
  so `f32(zx)` is the spelling), carries the f32 half's squares, and leaves with a `break` at
  the first escaped z. The `for` condition `j < 128 && m2 <= 16.0` would say the same and is
  TS8006 under Rule 7.5. An active double trip is 354 -> 195 f32 operations with the two
  changes above, and a wave whose every lane has escaped stops instead of running out its
  128 trips. Over 256×256 samples
  a half at spans 1e-4 to 1e-13 no escape count moved; bisecting 560 count boundaries finds 3
  of 10,080 samples that escape one step later, and the true double sides with the f32 test
  at one of them, which `fp64-twins.test.ts` now samples. `fp64-mandelbrot` (in its
  `escape_f32` / `escape_f64` helpers) and `fp64-burning-ship` and its twin take the same shape;
  their double halves lower to `df64_sqr` for the squares and an exact `* 2.0` for the
  doubled cross term (after `df64_abs` on the burning ship).
- **A two-row matrix in a uniform is refused, as Rule 4.8 says** (§40). A `mat2x2`, `mat3x2`
  or `mat4x2` (and `mat2`) in a uniform binding, directly or through a struct or an array, is
  `TS8051` at the declaration with the remedy (`mat{C}x4`, or two `vec2` fields). It was a
  `TS8015` warning that kept a WGSL whose layout disagreed with std140. Storage (std430) is
  unaffected.
- **An integer literal outside its declared type reports §13's sentence.** For
  `const a: u32 = 4294967296` the compiler says
  `TS8003 The value has to fit: 4294967296 is outside u32, which holds 0 to 4294967295 (§13).`
  on the literal, in declarations, assignments, `for` inits, returns, arguments, struct fields,
  vector constructors and conditional arms. It was an int/float mismatch the author never
  wrote, and a refused `let` no longer leaves its name unbound.
- **The fp64 guard is read once per function, and its redundant multiplies are gone** (§39).
  Every float `df64_*` helper fetched the `_fp64` guard texel itself, so every helper CALL
  fetched it again: the `fp64-mandelbrot` escape loop read the texture up to 40 times per
  iteration, every one inside the loop. The helpers now take the guard as a trailing
  `_fp64_g: f32` parameter, the module's own functions pass the fetch, and after the optimizer
  `hoistGuardFetch` reads it into one `let _fp64_g` at the top of each function, so that loop
  reads it once per call of the function that holds it and never per iteration. The read moves
  after the optimizer rather than into `fp64Lower` because a `let` there makes every df64 call
  reference a local, and LICM, which hoists only what references none, would then leave a
  loop-invariant `df64_mul(a, b)` inside its loop; the optimizer treats the fetch as a leaf
  (`isCompound`) for the same reason, and the single read holds at `O0` too. A `var<private>`
  guard was measured and rejected: Tint refuses an f64 comparison that decides a branch around
  `textureSample` with the guard held there, and accepts it passed as a parameter. twoSum's
  error term multiplied by the guard three times in a row, a chain carried over from luma.gl;
  `guard(guard(x))` is `guard(x)`, so the scalar and vec twoSum and twoSqr are written with one,
  and `foldGuardChain` folds any chain that reaches the pass. The force-inlined `a / b` kernel
  is 408 arithmetic ops to 376, every removed op one of those multiplies (16 twoSums × 2). On
  GLSL ES 3.00 the guard is declared `uniform highp sampler2D _fp64;`, since that spec defaults
  `sampler2D` to lowp in both stages; a texture binding now honours `BindingDecl.precision` to
  spell it. Only the fp64 goldens move, and with the guard rewrite normalised away all 50
  WGSL and GLSL goldens are byte-identical to before. The docs now say what the ~48 bits rest
  on: round-to-nearest-even `f32` `+ - *`, which is hardware practice, while GLSL ES 3.00
  §4.5.1 leaves the rounding mode undefined and allows subnormal flush, and WGSL fixes no
  rounding mode.
- **A call that writes, inside a larger expression, runs in source order** (Rule 7.9, §26). A
  front-end pass, `src/compiler/ts/sequence.ts`, binds each such call (a method that changes its
  object, a helper that writes a module variable or a storage binding, an atomic) to a `let` of
  its own ahead of its statement, in the order TypeScript and WGSL evaluate it, and binds ahead
  of it an operand evaluated before it that reads what it writes: `vec2(rng.next(), rng.next())`
  is `let _seq0 = Rng_next(&rng); let _seq1 = Rng_next(&rng);` and a `vec2` of the two, and
  `rng.state + rng.next()` adds the state from before the draw. An arm of `?:` and the right
  operand of `&&` or `||` that hold one become an `if`, so the call runs only when it is chosen,
  where WGSL's `select` evaluated both arms. A call that is the whole of its statement is left
  where it is, and so is every registered example: no golden moved. What it fixes, measured
  before it: GLSL ES 3.00 leaves the order of an operator's operands open (§5.11); the algebraic
  pass folded `rng.bits() - rng.bits()` to `0u` and dropped both calls; GLSL's float `%` spelled
  a call in its operand twice; and `xs[c.n] = c.bump()` stored into different elements on the two
  targets, which evaluate the target first, and on the three CPU paths, which evaluated the value
  first. A `while` condition runs on every iteration, so it may hold such a call only as one side
  of its comparison, `while (rng.next() < 0.9)`; anywhere deeper is `TS8006` with the remedy.
  The rule is new in `docs/language-design.md`, with Rule 7.2's table naming the lowering.
- **`random` has a source, and the check that should have asked for one was reading the wrong
  thing** (§55, [#181](https://github.com/typeshade/typeshade/issues/181)). The free
  `declare function random(seed)` had no §9.3 row, no `TYPESHADE_EXTENSIONS` entry and no
  mention in any document, and `surface-names.test.ts` was green: `unaccounted()` classified by
  BARE NAME, so a free top-level function was credited to the ECMAScript MEMBER `Math.random`
  while `declaredNames()` recorded, and the classifier discarded, the declaration kind that says
  the two are different names (Rule 2.1(b)). The classifier now reads the kind: `Math` and
  `console` account for their MEMBERS, a free declaration must be a WGSL name or carry a row,
  and an unknown kind throws rather than defaulting to the permissive case. Twelve names lost
  their source when it was tightened, every one of them real and none of them new to the
  surface, and all twelve are recorded rather than removed: `random`, the five free spellings of
  a `Math` member WGSL has no builtin for (`log10`, `log1p`, `expm1`, `cbrt`, `hypot`) and the
  six free spellings of a `Math` constant (`PI`, `E`, `LN2`, `LN10`, `LOG2E`, `LOG10E`) beside
  `TAU`, which already had its row for exactly this reason. The table is 61 rows to 73, family 5
  is `mod`, `fill`, the five expansions and `random`, family 9 is the constants, and the eleven
  that are not `random` have no surface `§` of their own yet, which is now an Appendix B row
  against Rule 9.7.
- **`random`'s declaration says what its refusal says** (§55, #181). The parameter was
  `seed: number | vec2 | vec3` while the compiler answers
  `TS8003 random(seed) seed must be f32, vec2, or vec3` to a `u32`, an `i32` and an `f64`; it
  reads `seed: f32 | vec2 | vec3` now, and the hover with it. What that did NOT do is the
  measurement worth keeping: the three programs do not move into TypeScript's own checker,
  because the scalar brands are OPTIONAL properties
  (`type f32 = number & { readonly [f32Tag]?: true }`), so a `u32` is structurally an `f32` and
  the editor shows the same one `TS8003` it showed before. `vecTag` is required and carries the
  arity, which is why a `vec4` seed draws TypeScript's `2345` as well. An `f32` variable, a
  float literal and an integer literal (`random(3)`, an `f32` seed of 3.0 by Rule 5.1) compile
  exactly as before, each pinned in `src/language-service/random-seed.test.ts` together with the
  editor's silence and the reason for it. The return type is untouched: `f32` was always right.
- **What `random(seed)` actually computes is written down, including the part that is wrong**
  (§55, #181). The name was documented nowhere — zero mentions in the surface document,
  `AUTHORING.md`, `README.md` and this file — and the hover claimed "the same seed always gives
  the same value", which is true of the IR and false of a GPU. §55 gives the three seed shapes,
  the emitted text for each, the refusals, and the defect: WGSL bounds `sin` to 2⁻¹¹ absolute
  error on [-π, π] and not at all outside it, which is where a hash of
  `dot(seed, vec2(12.9898, 78.233))` lives, so moving `sin` by 2⁻¹¹ moves `random(0.5)` from
  0.9642 to 0.3306 and `random(12.)` from 0.3497 to 0.7161, and #181 measures the emitted
  expression against the f64 oracle at up to 0.8078 apart on a [0, 1) range. Nothing in the
  front end says so, which is the new Appendix B row against Rule 12.6; #181 replaces the hash
  with murmur3's `fmix32` over a counter, bit-exact on all four legs, and this change deliberately
  does not touch the lowering or `Math.random`.

- **A barrier's placement rule is the spec's, not a stricter one** (§54,
  [#161](https://github.com/typeshade/typeshade/issues/161)). `workgroupBarrier()` and
  `storageBarrier()` were refused inside any `if` or `switch` at all. What WGSL and Tint refuse
  is a branch on a value the invocations do not share: measured on Chromium 141 and 153 alike,
  a barrier under a condition on a uniform buffer value is ACCEPTED, and one under
  `if (id.x > 4u)` on `local_invocation_id` is `'workgroupBarrier' must only be called from
uniform control flow`. The rule is now the uniformity walk's verdict, which reports a barrier
  unless the control flow is PROVABLY uniform — so a kernel branching on a dispatch-wide flag
  compiles, a shape the walk cannot read keeps the refusal it had, and the code that moved is
  `TS8034` becoming `TS8052`.

- **A loop over data compiles: a `for` bound may be a runtime value, the 256-trip ceiling is
  gone, and a `while` is an open loop** (Rule 7.5, #203). A `for` still has to be counted: an
  `i32` or `u32` induction variable, a constant step and an exit that compares the variable to
  a bound. But the start and the bound may now be any integer expression the body does not
  write: a uniform field, a parameter, `a.length`, `verts.length / 3`. The loop emits as
  written on both targets, which #203 measured on Tint and on ANGLE. With a runtime part the
  compiler still checks what the header proves. A step away from the bound, or a
  multiplicative step from 0, is `TS8007`. `TS8006` covers `==` or `!=` against a runtime
  bound, a runtime-headed multiplicative step whose factor is not a whole 2 or more, and a
  bound the body writes. A constant header is still counted exactly. It has no ceiling:
  `for trip count 1024 exceeds 256.` is gone, since neither target limits a trip count and
  nothing read `MAX_LOOP_TRIPS` but the check. A `while` takes any `bool` condition. It is
  refused only as `while (true)` with no `break` or `return` of its own in the body (`TS8007`),
  where it used to need a comparison with a constant, which let `while (sp > 0)` and
  `while (i < 100000)` through by accident and refused `while (i < data.length)`. The counter
  the IR's one loop form gives a `while` is now an `i32` whatever the condition compares. It
  used to take the type of the comparison's left side, so `while (a < 4.)` emitted
  `var _w: f32`. The uniformity walk sees a runtime-bounded loop, so a barrier in a loop
  bounded by `local_invocation_index` is `TS8052`. `examples/loops-over-data.shade.ts` holds a
  uniform-bounded `for`, a stack walk and a converging `while (true)`, on the compile gate.
  An unannotated counter whose start is a non-negative integer literal takes the type of a
  `u32` bound, so `for (let i = 0; i < data.length; i++)`, the loop a TypeScript author writes
  first, compiles as written instead of `TS8003 cannot compare i32 and u32`. Checked end to
  end from the packed tarball in a fresh project: a mesh ray cast over `verts.length / 3`
  triangles, a stack walk with a converging `while (true)`, and a strided sum to a uniform
  count, compiled with `compile()`, run on WebGPU (SwiftShader), and matched to plain
  JavaScript and to the CPU oracle within 1.2e-6.
  Two user journeys carry it: a mesh ray cast over `verts.length / 3` triangles, and a tree
  walked with a stack beside a strided sum to a uniform count.
  Language design Rule 7.5 and its two §14 rows, and surface §17, change with it.

### Removed

- **The unexported `typeshadeVite()` pack transform** (`src/compiler/ts/vite.ts`). It was on no
  subpath, and it default-exported a JSON pack that dropped overrides, module variables and
  enables. `typeshade()` from `typeshade/vite` replaces it (change 0009).

- **`perInvocation<T>`, the second spelling of the per-invocation variable** (§24,
  [#83](https://github.com/typeshade/typeshade/issues/83)). #83 added it as the wrapper for
  WGSL's `var<private>`. #85 then made a plain top-level `let` that variable, because a
  module-level `let` already means "a value this run of the program owns" to a TypeScript reader
  and in a shader the run is the invocation, and kept the wrapper as an explicit alternative
  spelling. One variable with two spellings is a thing to learn and not a thing to use, so the
  wrapper is gone and the plain `let` is the whole surface. It could go without moving a byte of
  output: measured over 13 declaration shapes (scalar, vector, matrix, sized array, struct, bool,
  a negative initializer, no initializer, two names on one `let`, a helper that reads and writes
  it) and both authored examples, the two spellings emitted byte-identical WGSL and
  byte-identical GLSL for every stage, reflected the same, and gave the same answers from the
  oracle and the CPU codegen. The one difference found anywhere was the source spans, every one
  after the annotation shifted by the wrapper's own 15 characters, which is the position of the
  author's text in the author's file and not something downstream of the front end can see.
  `examples/private-state.shade.ts` and `examples/workgroup-scratch.shade.ts` write the plain
  `let` and their emit goldens did not move. Writing the wrapper is now TS8033 at the
  annotation, one sentence with the line to write instead:
  `perInvocation<T> was removed: a top-level let is already the per-invocation variable. Drop the wrapper and write let seed: u32.`
  The editor's ambient library no longer declares the name, so the hover and the `gpu` semantic
  token go with it. `workgroup<T>` stays required: workgroup memory has no TypeScript
  counterpart and no plain-`let` meaning. The rule it rests on is the language design rules'
  2.1(c) with §9.3, that a name an author can write is a WGSL name, an ECMAScript name as
  TypeScript spells it, or a reviewed row of the extension table, and a second spelling of a
  variable the surface already has is not a decision anyone reviewed; 13.7 governs the removal,
  so the §9.3 row is deleted, the Appendix A row now reads a bare top-level `let` for
  `var<private>`, and family 2's shape is that the private address space is the one with no
  spelling of its own (Rule 6.5).

### Added

- **The load-time emitter, `typeshade/emit`** (proposal 0025, step 6; design rules 11.10 and
  11.11; surface §64 and §69). `repack(manifest, { console })` emits a manifest again from the
  portable IR it carries. The program runtime takes it as a plug-in,
  `createRuntime({ emit: repack })`, so `load(m, { console: true })` records a program whose
  build did not record, as a host needs in a deployed build for one session.
  - The manifest carries the IR only on request: `packModule(m, { ir: true })` or
    `typeshade({ ir: true })`. The IR is written by `src/core/ir/portable.ts`: a callee by
    reference, one node where it is used twice, `-0`, `NaN` and the infinities kept, and spans
    only where an output reads them.
  - Emitted again, the IR gives every example's WGSL, GLSL, `reflect()`, console variant and
    manifest byte for byte.
  - Only the version that wrote the IR reads it. `repack` refuses another version's IR, naming
    both versions, and a manifest with no IR. The runtime refuses `console: true` without the
    emitter, naming the remedy.
  - The emitter's closure is 107 modules of `src/core/` and no front end or `typescript`,
    74,968 bytes minified and gzipped. `scripts/bundle-boundary.ts` holds both in CI with a
    budget of 82,500. Of what the proposal names the backends pulling in without using it:
    - the CPU runtime is gone, 3,112 bytes. Constant folding imported the CPU tier's builtin
      table, which is built when its module loads, so the whole table was bundled. It now folds
      with `src/core/scalar-arith.ts`, the arithmetic and the builtins with one correct answer,
      which the CPU tier applies too, so the fold and the oracle still agree by construction;
    - the lint engine reaches it only as `validate()`'s core rules, which every emit runs;
    - the IR builder stays, since the `f64` library is built with it when it loads. Written as
      IR, the library would be 15,862 bytes gzipped, more than the code that builds it.

- **The kernel proof's corpus, and what a nested loop dispatches** (Rule 8.22, surface §65,
  #350). `src/compiler/ts/kernel-corpus.test.ts` holds 15 loop patterns, each with the answer the
  proof must give, read in the compiler and in the editor. The accepted patterns are a stencil, a
  gather, an integer and a fixed-point scatter, a sum, a structure of arrays, two stages, a 2D grid
  written as nested loops and a 3D grid written as one flat loop. The refused ones are a read of a
  neighbour of the written array, a float scatter, an append, an outer iteration loop and a prefix
  sum. Each also runs on the CPU tier against a plain JavaScript reference. Rewrites that keep a
  pattern's meaning must keep its answer, the refusal's line and names included:
  - the bound from a parameter, or from another array of the same length;
  - a subexpression named with `const`;
  - two independent statements swapped;
  - the value computed by a helper.

  A rewrite that changes the meaning is shown to change the answer. The rewrites found #398.
  Surface §65 and `AUTHORING.md` now say that a loop nested in the dispatched one runs whole
  inside each invocation. A grid is one flat loop, `x = i % w`, when each cell should be its own
  invocation.

- **The engine journey** (proposal 0025, step 5; Rule 11.11; the gate #335 set before a reference
  engine). `journeys/engine/` is a small engine written as a host application writes one, on
  `typeshade/runtime`'s public exports alone. It has two materials that share a camera and lights,
  a shadow pass read by comparison, a render to a half-float texture and a tonemap pass. The
  camera is a `Resident` both materials bind, rewritten every frame for 60 frames. The harness
  (`kind: 'engine'`) refuses the engine on any import but `typeshade/runtime` and on any WebGPU
  call of its own. It runs the frames on a device it instruments and fails on any GPU object
  made after the first frame. It holds the last frame to a reference computed pixel by pixel in
  plain JavaScript: on SwiftShader the worst error is 0. Each check was shown to fail when broken:
  a texture made each frame, the shadow pass left out, and a buffer the engine makes itself.

- **A console line says where it ran, and a production build records when asked** (proposal
  0025, step 4; design rule 8.24; surface §64, §66 and §67).
  - Every `console.*` event the call layer or the program runtime prints starts with its tier,
    `GPU` or `CPU`, drawn as a label in a browser, then the call's file and line and the
    invocation: `GPU  particles.shade.ts:14  [3, 0, 0]  x 4.5`. The prefix is the format string
    and the event's arguments follow it, so the method stays and a label holding `%d` prints as
    written. A `console.table` prints the prefix on its own line, and the warning for calls that
    did not fit names the entry after the same prefix.
  - The call layer's CPU tier gives each event its invocation, the `global_invocation_id` of a
    dispatch or the pixel of a draw.
  - `typeshade({ console })` in `typeshade/vite` takes `'dev'`, the default and today's
    behaviour, `'always'`, which records in a production build too and says so when the build
    starts, or `'never'`, which records in neither. `TypeshadeViteOptions` is exported.

- **The call layer runs on the program runtime** (proposal 0025, step 3; design rules 8.24 and
  11.8; surface §65 and §69). `configure({ runtime })` hands the call layer a runtime, and every
  generated host function then dispatches and draws on its device; `runtime()` with no runtime
  configured wraps the device the call layer requested, so the two layers share one device either
  way. A `Resident` is a runtime binding as well as a call argument: `resident(value)` takes any
  host value, `write(value)` replaces its contents and `destroy()` frees its buffer, and a value
  both layers read is uploaded once and not again until a write. A `Texture` the runtime made is
  an image argument of a generated function on WebGPU; the WebGL2 path refuses it with a
  `TypeError` that says so. `typeshade/runtime` is now 10,151 bytes minified and gzipped, still
  inside its budget.

- **A shader module imports a package's by the package's name** (change 0024; Rules 3.9 and 3.2,
  surface §68 and §64, roadmap X6). `import { fbm } from "shade-noise"` in a `"use typeshade"`
  file finds `shade-noise` in `node_modules` from the file's directory up and reads the shader
  module its `package.json` publishes under the `typeshade` condition of `exports`, beside the
  JavaScript it publishes for hosts. `compile()`, the Vite plugin, `tshc check`, `tshc sync` and
  the language service resolve it by one rule, `resolveSpecifier` in
  `src/compiler/ts/specifier.ts`.
  - `exports` is read as Node reads it: a string target, subpaths with `*` patterns, an array's
    first valid target and `null` blocking a path, with the conditions `typeshade`, `import` and
    `default` tried in that order. Without `exports`, a subpath names a file of the package by
    the relative rule, and the name alone is refused with the file to write.
  - `readDocument` is asked for each `package.json` too, so a host that reads from disk follows a
    package with no change. A host that serves only files that begin with the directive serves
    `package.json` as well.
  - A program holds one copy of a package version, keyed by its name, its version and the file's
    path in it, however many paths reach it; the language service gives TypeScript the same
    `packageId`. Two versions are two copies, and a helper the module renames is named for its
    package and file, `shade_noise_noise_hash`, then `shade_noise_noise_hash_2`.
  - `TS8072`'s sentence for a package ("… is a package, and a shader module imports only a file
    of its own program …") is gone. A package no `node_modules` holds, a subpath `exports` does
    not name or blocks, the name alone of a package with no `exports`, a package's file that does
    not begin with the directive, a `#` specifier and a specifier that is neither relative nor a
    package name each have their own sentence (surface §68's table).
  - `tshc sync` compiles each module under its full path, so a package installed above the
    working directory is found; an error is still printed relative to it.
  - The README's `tsconfig.shade.json` sets `customConditions: ["typeshade"]`, so plain `tsc`
    reads the package's shader module too. Without it, measured on a package that publishes
    `dist/index.js` under `default`, the import is `TS7016` and a subpath only `typeshade` names
    is `TS2307`.
  - The import journey installs a packed shader package with npm, `journeys/_shade-package/`, and
    calls a function of it through a module that imports it by name.

- **The program runtime, `typeshade/runtime`** (proposal 0025, step 2; design rules 11.7 and
  11.11; surface §64 and §69). A host loads a compiled program's manifest and runs it on WebGPU:
  `createRuntime({ device })` on the host's device, or with no device on one it requests with the
  features `programs` need; `rt.load(manifest)`, which refuses another schema and a missing
  feature; `program.compute(entry)` and `program.render(state)`, cached pipelines laid out from
  the manifest; bindings by the source's names, a plain value packed by its layout into buffers
  the runtime reuses, a `Texture` or `Sampler` it makes, or the host's own GPU objects; `rt.frame()`
  with `dispatch()` and `pass()`, or the host's encoders with `rt.submit(encoder)`; and the
  recorded console, read back at the submit and handed to a sink or the console. A refusal names
  the entry, its line and the binding. The subpath imports nothing of the compiler, which
  `scripts/bundle-boundary.ts` holds in CI with a size budget: 26 modules, 9,493 bytes minified and
  gzipped. The op library generated modules import moves to `typeshade/runtime/internal`, still
  not API; `typeshade/runtime` keeps exporting `resident` and `configure`. The compile gate
  dispatches every compute entry of the examples through the runtime from its module's manifest,
  and each written value equals the call layer's on WebGPU.

- **A compiled program has a manifest, with a version** (proposal 0025, step 1; design rules 6.8
  and 11.10; surface §64 and §69). `packModule(m, options)` returns schema 1: `schema` and
  `compiler`, the version that wrote it; each binding with its `resource` in `reflect()`'s words,
  the `stages` that reach it, and a buffer's byte `layout` with every offset, size and stride
  under its `rule`, the `_fp64` guard among them; each entry with its `workgroupSize`, its
  `inputs` and `outputs` with their interpolation, the `bindings` it reaches and writes, a vertex
  entry's `vertex` buffer and its `line`; `overrides` and `features`; with `{ console: true }` the
  recorded variant; and `gl`, how the WebGL2 tier draws each full-screen fragment entry, and a
  storage array's `dataTexture`. The fields `packModule()` always gave keep their meaning. The
  builder is `src/core/manifest.ts`, which imports no TypeScript. A module's host import has a
  default export, its manifest, typed `Pack` in the host view; a bundle that imports it alone
  carries no CPU tier. `reflect().vertex` now reports the tightly packed layout the manifest
  carries, and the located fields of a struct parameter, where it gave std430-aligned offsets for
  loose parameters only (for `f32`, `vec3`, `vec2`: 0, 4, 16 and a stride of 24, where it said 0,
  16, 32 and 40).

- **A kernel function over doubles runs on the GPU** (change 0013, the last part; Rule 8.22,
  surface §65). A kernel function that takes an `f64` or an `array<f64>` now lowers and
  dispatches on WebGPU. Each double is two `f32`s in the buffers, and the runtime binds the
  module's `_fp64` guard.
  - An `f64` or `vecNf64` reduction folds by the same 256-wide tree, with the emulation's add,
    min and max. Its partials are `f64`s the runtime joins.
  - `min` and `max` start from the largest finite `f32`, the emulation's range, since Tint takes
    no infinity as a literal.
  - The CPU tier computes each double natively, so the tiers agree to about 2^-44, not bit for
    bit.
  - In the import journey, `dstats` (a map, a sum and a min over 70 000 doubles, WebGPU
    required) matches the double reference to 2.2e-14 in each element and 1.8e-15 relative in
    the sum.
  - The one refusal left was "an emulated f64, which a later part of change 0013 folds", and it
    is gone.

- **An emulated `f64` crosses the host boundary** (changes 0013 and 0016, the f64 split; Rules
  8.21 and 8.24, surface §65 and §67). The host passes an `f64` binding as a `number`, a
  `vecNf64` as a tuple, and an array of either as a `Float64Array`. The WGSL and the GLSL hold
  each double as two `f32`s, `hi` and `lo`, and a `vecNf64` as a plane of each. The runtime
  splits the caller's doubles into them and joins them back.
  - The runtime binds the `_fp64` guard of a module that emulates `f64`: a texel of 1.0, on
    WebGPU, and on WebGL2 where the program reads it. The host never passes it.
  - A `@compute` entry, a full-screen draw and a kernel function in such a module are no longer
    `never`. Each was refused with "waits for change 0013's f64 split".
  - The CPU tier computes each `f64` as a JavaScript double. A kernel function that takes one
    runs there until the next part of 0013 dispatches it on the GPU.
  - In the import journey, WebGPU results are within 7.4e-15 of the double reference. A band
    that an `f32` would smear draws the same on WebGPU, WebGL2 and the CPU tier.
  - A `matNxN<f64>` binding has no host value yet.
- A kernel function that writes a texture waits for #204's image (0013's decision 5, amended).
  Surface §65's "Not yet" says so.

- **The compile gate calls every entry of the examples on every tier** (change 0016, Rule 8.24).
  - The new leg, `scripts/entry-calls.ts` with its page half `scripts/entry-calls-page.ts`,
    bundles each `.shade.ts` example's generated host module with `typeshade/runtime`.
  - In the gate's Chromium it calls each `@compute` entry on WebGPU and on the CPU tier, and
    draws each full-screen `@fragment` entry on WebGPU, WebGL2 and the CPU tier. Each tier is
    compared with WebGPU.
  - A tier an entry has no form for is printed as skipped, with the reason.
  - Coverage: 9 compute entries (3 of them WebGPU only, through a barrier) and 10 fragment
    entries. Today every one matches WebGPU exactly.
  - With the leg in place, proposal 0016 is implemented.

- **A draw reads a `Resident`** (change 0016; Rules 8.21 and 11.8, surface §67).
  - A full-screen `@fragment` entry's storage array with no size may be a `Resident`, as a
    compute entry's may.
  - A draw that reads one runs among the kernel and entry calls, in the order they were made. It
    draws what the calls before it wrote, and a call made after it writes after the draw.
  - WebGPU binds the handle's device buffer, so a kernel function can compute an array that a
    draw shows without leaving the GPU. The CPU tier reads the handle's copy, brought up to date
    first.
  - A `Resident` for any other binding is a `TypeError`.

- **A `@compute` entry takes a `Resident`, queues, and follows `configure`** (change 0016; Rules
  8.24 and 11.8, surface §67).
  - A storage array binding with no size may be a `Resident`, 0013's handle. On WebGPU it is
    bound as the buffer it already has on the device, and nothing is read back until
    `await r.read()`. So one entry's output can be the next one's input without leaving the GPU.
  - When every binding the entry writes is a `Resident`, the host view's first signature returns
    `void`, and the call only queues.
  - Entry calls run in the same order as kernel calls, so the two can share a handle.
  - `configure({ prefer })` orders and restricts the entry's tiers, WebGPU and the CPU. A list
    that leaves only WebGL2, which has no compute stage, throws, naming why.
  - A `Resident` for a sized or non-storage binding, or one handle passed as two bindings, is a
    `TypeError`.
  - A misspelled binding in the bindings object is now `TS2769` (no overload matches) rather than
    `TS2353`, as it is for a kernel function.

- **The determinism report lists a kernel function's floating-point reduction** (change 0013;
  Rule 7.2, surface §38 and §65). `compile().determinism` gains the kind `order`: an `f32` or
  `f64` sum or product that a kernel function's accepted loop reduces. Every tier folds it in the
  256-wide tree, so it has one answer everywhere, but that answer is not the one the loop's
  sequential order gives. The row is listed under the function, after its own operations. A
  reduction by `min` or `max`, on integers, or in a loop that stays on the CPU is not listed.
  `DeterminismKind` gains `'order'`, and `DeterminismAccuracy` excludes it, as it excludes
  `'emulated'`.
- **A kernel function runs on WebGL2** (change 0013, part 8; Rule 11.8, surface §65). Where there
  is no WebGPU, or with `configure({ prefer: ['webgl2'] })`, a function whose every loop writes one
  array of `f32`, `i32` or `u32` at exactly `i` runs each loop as a fragment program: one pixel of
  an `R32UI` target per iteration, the arrays it reads as data textures, its scalars as uniforms,
  through the same compute→fragment lowering the compute runner uses. The target starts out
  holding the array, so a `continue` leaves its element as it was. Any other loop goes on to the
  CPU tier, with the reason in the tier error. The import journey renders the terrain and runs a
  map with a `continue` with WebGL2 required, in Chromium, and the compile gate links each
  kernel's WebGL2 program.

- **A `"use typeshade"` file imports what another one exports** (change 0022; Rules 3.9 and 3.2,
  surface §68). `import { fbm } from "./noise.shade.ts"` compiles on every path: `compile()` reads
  each import through a new `readDocument` option (with `resolveImport` beside it, the rule the
  language service resolves by), the Vite plugin and `typeshade sync` read from disk and the
  plugin watches what it read, `typeshade check` checks an imported module under its own path,
  and the editor's TypeShade half analyses the program its TypeScript half already read. Any
  top-level declaration can be imported (functions, generic ones included, classes, enums,
  constants, bindings, module variables, namespaces), by name, as a type, through `import * as`
  or a re-export. The file and what it imports are one module, holding what the file reaches and
  none of an imported file's own entry points; each file keeps its own scope, so two private
  `hash` helpers are two functions, the second emitted as `b_hash`, and an entry point, a binding
  or an override keeps its name. A mistake in an imported file is reported at that file. An import
  the compiler does not follow is the new `TS8072` on the import, and the use of its names says
  nothing more; before, every public path compiled one file, and a call into another was
  `TS8004`. A package import (roadmap X6) is `TS8072` too.
- **The particles journey is a loop** (change 0013, part 7). Its `step` is a kernel function over
  `array<Particle>` with the simulation's settings as a struct argument: no `@compute`, no
  `global_invocation_id`, no binding and no packing, and the host hands it plain objects. The
  harness gains a `kind: 'kernel'` run, which it checks on the CPU oracle; the import journey
  steps the particles 20 frames on WebGPU on a `resident` array, which only queues until its one
  read, against the same reference.

- **Four examples of a loop that becomes a kernel** (change 0013, part 6, surface §65).
  `loop-kernel` is the roadmap's terrain, `loop-reduction` a sum, a mean and a variance, and a
  histogram, `loop-struct-array` the particle step over `array<Particle>`, and `loop-on-cpu` one
  loop the proof refuses per rule (R1 to R6), each carrying its `TS8070` warning; the module still
  compiles. `examples/loop-examples.test.ts` holds every kernel function of the four to one answer
  on the CPU tier and the oracle, reductions included, and the compile gate now also hands Tint the
  WGSL each kernel function lowers to.

- **`resident` and `configure`: a kernel function's arrays stay on the device, and the caller
  orders the tiers** (change 0013, part 5; Rules 8.21 and 11.8, surface §65). `resident(array)`,
  from `typeshade` and `typeshade/runtime`, wraps a typed array or an array of objects once; a call
  on WebGPU uploads it the first time and binds the same buffer after, reading nothing back, and
  `await dev.read()` returns a new array of what it holds. A call whose written arrays are all
  resident and that returns nothing is typed `void` and only queues; kernel calls run in the order
  they were made, and a queued call's error is thrown by `read()`. `configure({ prefer })` sets the
  order of WebGPU, WebGL2 and the CPU tier; a list of one makes that tier required, and a call it
  cannot run on throws, naming why. With two signatures, a wrong array at a kernel call is `TS2769`
  in `tsc` where it was `TS2345`. The import journey renders into and reduces over resident arrays
  on WebGPU in Chromium.

- **A kernel function's scatter runs on the GPU by atomics** (change 0013, part 4; Rules 7.2 and
  8.22, surface §65). A loop the proof accepts that adds into an integer array at an index it
  computes, `bins[k] += 1` (and `&= |= ^=`, `min`, `max`), lowers to `atomicAdd(&bins[k], 1u)` on
  an `array<atomic<u32>>` binding, the same bytes as the caller's `Uint32Array`, which comes back
  with the counts added. The import journey builds a 64-bin histogram of 300 000 values on WebGPU
  in Chromium and matches the reference exactly.

- **A kernel function's reduction runs on the GPU, in one order on every tier** (change 0013,
  part 3; Rules 7.2 and 8.22, surface §65). `s += x`, `s *= x`, `min`, `max` (and `& | ^` on
  integers) in a loop the proof accepts are folded as the GPU folds them: each iteration from the
  operator's identity, 256 at a time by the workgroup tree, then the partials the same way until
  one is left. On WebGPU that is the loop's dispatch and one more per level of partials, and the
  function's `return` runs on the CPU tier with what they folded, so `await total(img)` returns
  the sum; the CPU tier, the oracle and the generated CPU code run the same tree
  (`core/kernel-tree.ts`), so a sum is the same bits on every tier, where the sequential reading
  differs in the last places. An `f32` `min` or `max` starts from the largest finite `f32`, since
  WGSL refuses an infinity in a constant expression. The import journey sums 300 000 `f32`s on
  WebGPU in Chromium and gets the tree's bits.

- **`console.table` in a shader** (§66, design rule 11.9, `changes/0019-console-table.md`). It
  takes one value (an array, a struct, a vector, a matrix or a scalar) and the host prints it with
  its own `console.table`: an array of structs as a row per element. A matrix is delivered as its
  columns, so `console.table(m)` of a `mat4x4f` is four rows of four; `console.log` keeps the flat
  form. It is recorded on WebGPU under `console: 'gpu'` like the other methods, and a stepped
  debug session delivers it too. The editor completes it after `console.`, and the host's second
  argument, the columns to show, is `TS8099` with the remedy.

- **A host file calls a kernel function through the import, and its loops run on the GPU**
  (change 0013, part 2; Rules 8.20 to 8.23, surface §64 and §65). `await render(k, 512, img)`
  dispatches each loop of `render` on WebGPU, one invocation per iteration, and fills `img` in
  place: the plugin lowers a kernel function whose every loop the proof accepts as a map to one
  `@compute` entry per loop, with its scalar parameters in a uniform and its arrays as storage, and
  a range function the call runs first for each loop's start and trip count. Before anything runs,
  the call checks each array against the indices a loop writes and refuses one too short, naming
  both numbers. A function that does not lower (a reduction, a refused loop, a `bool`, a module
  binding) and every call where there is no WebGPU run on the CPU tier, and the view's comment says
  why. The import journey calls three kernel functions on WebGPU in Chromium.
- **A kernel function, whose loops the compiler proves independent** (change 0013, part 1;
  Rules 7.5, 8.6, 8.8, 8.22 and 8.23, surface §65). An exported function that takes an array with
  no size, `render(k: vec4, size: u32, out: array<f32>)`, is a kernel function: its array is the
  caller's storage, written in place (`out[i] = …`) and sized at run time (`xs.length`), which
  `TS8018` and `TS8032` refused before. Each `for` at the top level of its body is proved
  independent (R1 to R6 of #252): a map at `a*i + c`, row-major or a texel, a reduction
  `s += x`, `s = max(s, x)`, or an integer scatter `bins[k] += 1` is accepted, and any other loop
  runs on the CPU with a warning, `TS8070`, that names the line and the author's names and gives
  the remedy, in the compiler and in the editor. The IR `for` carries the counted fact the front
  end proved (`counted`), and `FuncDecl` the `kernel` mark every backend reads to leave the
  function out of what it emits. A kernel function runs on the CPU oracle; its call through the
  import, which dispatches the accepted loops on the GPU, is the next part.

- **A debug session delivers the `console` calls it steps over** (§66,
  `changes/0018-debugger-console-sink.md`). `startDebugSession(m, entry, args, { consoleSink })`
  hands each call to the sink when the step that runs it runs, and nothing at a step that skips
  it; `startDebugSessionFromConfig(m, config, { consoleSink })` takes the sink beside the JSON
  launch configuration. An event is the one `compile().eval` delivers for the same entry and
  arguments, labels, span and `invocation` included. Without a sink a session behaves as it did.

- **`console.*` in an entry a host calls prints from the GPU in `vite dev`** (change 0016, part
  3; Rule 8.24, surface §67). The plugin compiles with the console recorded (0014) in `vite dev`,
  and the runtime reads the `_console` buffer back after each dispatch or draw and prints the
  events in the CPU tier's order; a production build records nothing. An entry's pipeline layout
  is now written out from its bindings, so a binding the optimizer stops using (a read only a
  dropped `console.*` call made) still binds. The import journey also runs the particles and
  plasma journeys' programs through the import, against their own references.

- **A host file draws a full-screen `@fragment` entry into a canvas through the import** (change
  0016, part 2; Rules 8.20, 8.21, 8.24 and 11.7, surface §67). `fs(canvas, { frame })` draws one
  frame with a full-screen triangle the runtime supplies, on WebGPU, then WebGL2, then the CPU
  tier, and the promise resolves at submission. The entry reads no builtin but `position` and
  `front_facing` and writes one `@location(0)` `vec4`. The first draw into a canvas decides its
  tier, and `position` counts rows from the top on every tier: the WebGL2 tier draws into a
  framebuffer and copies it upside down. A `texture_2d<f32>` binding takes an image source and a
  `sampler` takes `{ filter?, address? }`, for a draw and for a compute entry, on the GPU tiers.
  The import journey draws two entries on all three tiers in Chromium and holds each frame to the
  reference.
- **A host file calls a `@compute` entry through the import, and it runs on the GPU** (change
  0016, part 1; Rules 8.20, 8.21, 8.24 and 11.7, surface §67). `await step({ sim, particles }, 4)`
  dispatches the imported entry as written over four workgroups on WebGPU, with a device the
  runtime requests on first use, and reads every storage binding it writes back into the
  caller's values in place: a typed array element by element, an array of structs object by
  object. The bindings object is typed exactly in the host view, one property per binding the
  entry reaches. A runtime-sized array of scalars or vectors is a `Float32Array`, `Int32Array` or
  `Uint32Array`, padded to the WGSL stride by the call, and a written one-scalar binding is a
  typed array of length one. The plugin writes the WGSL and each binding's byte layout into the
  generated module at build time, so the bundle still ships no compiler. Where there is no
  WebGPU, as in Node, the entry runs on the CPU tier, invocation by invocation, and equals the
  interpreter's own dispatch; an entry that reaches a barrier needs WebGPU and says so, naming
  the barrier's line. The import journey now also calls two entries in Chromium on WebGPU from
  the packed tarball. A texture or sampler binding, a fragment entry, `Resident` and
  `configure` come later (0016 part 2, and 0013).

- **A host file imports a `.shade.ts` and calls its helper functions, on the CPU** (change 0009,
  roadmap item 16 first half; Rules 3.8, 8.20, 8.21 and 11.7, surface §64). Nothing here runs on
  the GPU: an entry point is `never` to the host until the second half of item 16 (16b). With `typeshade()` from the new
  `typeshade/vite` subpath in `vite.config.ts`, an ordinary `.ts` file writes
  `import { height } from './terrain.shade.ts'` and calls `height([0.5, 0.5], k)`. The call runs
  the module's own code on the CPU tier, the oracle's generated code at `f32` precision, written
  into the bundle as module code with no `new Function`. That code runs over the op library in
  `typeshade/runtime`, a subpath only generated modules import and which is not API. Host values
  are plain, and each argument is checked and converted (a `TypeError` names the function, the
  parameter and its type). A result aliases no argument, and the call is synchronous.
  A host can call an exported function that is not an entry point, not generic, takes no
  function, has a host value for each parameter and its result, and reaches no binding, no
  workgroup variable and no GPU-only builtin. Constants and enums are values, and structs are
  types. Every other export is declared `never` with the reason. `tsc` reads a generated host
  view, `name.shade.typeshade.ts`, through two lines of the host `tsconfig`
  (`moduleSuffixes: [".typeshade", ""]` and an `exclude` of the shader sources). The plugin
  rewrites the view as the module changes, and the new `typeshade sync` (`--check` to verify)
  writes every view before `tsc` runs on a clean checkout. A `.ts` that begins with the
  directive under another name is refused with the rename, and a module that does not compile
  fails the build with its `TS80xx` diagnostics. `bun run gate:journeys` gains the import
  journey: the tarball in a fresh Vite project, `tsc` clean and a wrong call caught,
  `vite build`, and Node running the bundle against a plain-JavaScript reference.

- **The `gpu-console` example and the `console-log` journey** (§66, `changes/0014-gpu-console.md`,
  now implemented). The compile gate hands Tint the WGSL of every example that logs twice, as
  written and under `console: 'gpu'` (`gpu-console+console`), and the journey gate runs a logging
  kernel from the packed tarball on WebGPU: the 163 lines `decodeConsole` reads back equal the
  CPU run's and the host's plain-JavaScript ones. A journey run takes a `console` field for it.

- **`console` calls reach the host from WebGPU, when the compile asks** (§66, design rules 6.11
  and 11.9, `changes/0014-gpu-console.md`; roadmap 0.2 item 6). `compile(src, { console: 'gpu' })`
  makes the WGSL record each `console.*` call a compute or fragment entry reaches, in one storage
  buffer the compiler binds, `_console`, at group 0 past the module's bindings (the `_fp64` rule).
  `result.console` gives the slot and the table of calls. `decodeConsole(words, result.console)`
  turns the buffer the host copies back into the `ConsoleEvent`s the CPU sink receives, ordered
  as the CPU runs a dispatch, each with its `invocation`. A call reserves its words with one
  `atomicAdd`; one that does not fit the buffer, whose size is the host's, is dropped whole and
  counted. `reflect(m, { console: 'gpu' })` lists the buffer. Measured on Tint and SwiftShader in
  Chromium 141: 331 events of a kernel decoded equal to the CPU's, invocation ids included; a
  fragment's helper and discarded invocations write nothing; a vertex stage that reaches the
  buffer is refused by Tint, so such a call is a new `TS8071` warning, as are an argument with no
  fixed size and a stage that already binds eight storage buffers. The default, `'cpu'`, moves no
  emitted byte, and GLSL ES 3.00 records nothing.

- **A string literal argument of a `console` call is a label** (§66, design rule 7.8,
  `changes/0014-gpu-console.md`). `console.warn("large value at", gid.x, y)` compiles; it was
  `TS8099 A string has no GPU representation`. The label never reaches a target: it is kept on
  the host, and the event the sink receives carries it where it was written
  (`["large value at", 136, 272]`), on the interpreter, the generated CPU code and the stepper
  alike. `ConsoleEvent.args` is `readonly (string | CpuValue)[]`, and the IR's `call` node gains
  an optional `labels` field, the arguments in the order written. A template with a value in it
  is still refused, now once and with the arguments to write (`TS8013 … Pass the text and the
value as two arguments: console.log("x =", x).`), where it drew a second `TS8099` about the
  same template. The editor's `Console` takes what the standard one does, so a label, a struct,
  an array and a matrix draw no error there either; the compiler already took the last three.
  WGSL and GLSL emit no byte more. The WebGPU half of 0014 is not in this entry.

- **`typeshade check`: the editor's answer and the backends', from the command line** (Rule
  12.7, Rule 12.3). The package gains a `typeshade` command whose `check` reports, for every
  `*.shade.ts` under the given paths, the language service's merged list (TypeScript over the
  ambient lib, with the false positives it filters, and the TypeShade front end) together with
  what `compile()` adds that the service never computes: a WGSL emitter that throws (`TS8015`,
  an error) and a GLSL ES 3.00 shortfall on a render module (`TS8015`, a warning). It exits 0
  with no error, 1 with one and 2 when it cannot run, and prints `tsc --pretty`'s layout
  without colour (`--format text`), one line per diagnostic (`--format short`) or the report as
  versioned JSON (`--format json`); `--deprecations` adds `TS8053`. Each file is analysed on its
  own, so two `"use typeshade"` files with no import or export, which TypeScript reads as
  scripts sharing one global scope, do not report each other's names. Measured over the 73
  `.shade.ts` examples: no error and 5 warnings, each a GLSL shortfall `compile()` also reports,
  where plain `tsc` configured as the README describes reports 542 errors on the same files,
  none of them real. It is the check CI and a coding agent should run, since an agent treats a
  compiler's errors as the truth and rewrites correct code to silence false ones. The npm
  tarball runs `dist/src/cli/bin.js` under Node (`scripts/publish-manifest.ts` derives the `bin`
  by the rule it applies to `exports`); this tree and a submodule run
  `bun src/cli/bin.ts check <paths>`. What it inherits from the service it inherits whole: an
  import from another shader file is `TS8004` (#187). The check is exported from
  `typeshade/language-service` as `checkDocuments`, and as `checkOpenDocument` for a tool that
  keeps its own service, so the MCP server in typeshade/vscode-typeshade can call it rather than
  keep a copy that could drift (Rule 12.7).

- **An array's `map`, `forEach`, `some`, `every` and `reduce` take a function and run as
  TypeScript runs them** (Rules 2.1, 7.2 and 8.18; surface §63, new, and §14; proposal 0005).
  Every method of an array was refused with `TS8099` and the advice to use a fold. The five now
  compile on an `array<T, N>`, and all but `map` on a runtime-sized storage array. Each call is a call of a function of the module made once for each
  array type and function handed over, a counted loop over the indices (Rule 7.5) that hands the
  function the element, its `i32` index and the array: `xs.map(sq)` calls `array_map_sq(xs)`, and
  a call stands in an argument, beside `&&` or in a loop's condition. The function is handed over
  as Rule 8.18 hands one, by its name or as an arrow function written in the call, and what it
  captures the loop takes and passes on, by reference where it writes it. The array is read as it
  goes, as TypeScript reads it: a binding, a module variable or a module constant in place, a
  variable the function captures through the one reference both use, so
  `xs.forEach((x, i) => { xs[i + 1] += x; })` adds each element into the next, and any other
  array by value. `some` and `every` stop at the element that decides them, and `reduce`'s running
  value takes its type from the function's first parameter or from the value to start from.
  Refused, each with the fix: the other methods of `Array.prototype`, whose message names the
  five and `for (const x of xs)`, `map` on a runtime-sized array, `reduce` with no value to start
  from on one, a function that takes a runtime-sized array, a `thisArg`, and every refusal Rule
  8.18 makes of a function handed over. The editor types the five: `interface Array<T>` declares
  them with a `this` of `array<T, N>` and `index: i32`, and `array<T, N>` picks them through
  `ArrayOps`. `src/compiler/ts/array-methods.test.ts` holds WGSL, GLSL ES 3.00, the CPU oracle,
  the codegen and the debugger to one value for each; `examples/array-methods.shade.ts` joins the
  compile gate, and the light-list journey runs them over a storage buffer on WebGPU.
  `src/compiler/ts/array-hof.ts`, a sketch of a free `map` and `reduce` that nothing imported, is
  gone.

- **A method, a static method, a constructor, a field that holds a function and a local function
  take a function, as a function of the file does** (Rule 8.18; Rules 7.2 and 8.10; surface §14
  and §26; proposal 0002). A parameter of function type on any of them was refused with
  `TS8020`, since only a function declared at the top of the file or of a namespace could take
  a function. Each is now compiled once for each set of functions its calls hand it, as a function of the
  file is: `s.each(sq)` calls `Swarm_each_sq(s)`, `new C(sq)` calls `C_new_sq()`, and a local
  `twice` handed an arrow function calls `run_twice_run_f(k, x)`. A copy of a method takes its
  object as the method does (Rule 8.10), and a copy of a local function its own captures. A
  variable both the copy and the function handed over reach is one parameter, by reference
  where either side writes it: a variable both capture, and the object the method is called on
  when the function handed over writes it. So `w.sixteen((i) => { w.x += … })` is
  `Walker_sixteen_walk_step(&rng, &w)`, and the steps move the walker `sixteen` reads, as in
  TypeScript. A call through `super`, an inherited method and a parameter handed on to another
  method copy the same way. Still refused, each with the fix: a parameter of function type on
  an accessor, whose value an assignment gives it, and on an entry point (`TS8020`), and a call
  that would take two references into one variable, one of them written, which WGSL's alias
  analysis refuses (`TS8099`). `src/compiler/ts/higher-order.test.ts` holds WGSL, GLSL ES 3.00
  and every CPU path to one value for each place and for the shared variable;
  `examples/higher-order.shade.ts` draws a ring of dots through a method, and the random-walk
  journey's `sixteen` is a method of `Walker`.

- **A setter with no type takes the type its getter's body returns** (Rule 8.19; surface §14
  and §26; proposal 0003). `get x() { return this.v * 2.; }` beside `set x(n) { this.v = n / 2.; }`
  was `TS8002 The setter "Gauge.x" needs a type for "n": write "set x(n: T)", or give the getter a
return type.` The value now takes what the getter returns, written or said by its body, as
  TypeScript types it: `fn Gauge_set_x(self_: ptr<function, Gauge>, n: f32)` on WGSL and
  `void Gauge_set_x(inout Gauge self_, float n)` on GLSL ES 3.00, for an instance and a static
  pair. An assignment that needs the type before the getter's body is lowered lowers it first,
  from any body and with the setter above its getter. Still refused with `TS8002`, once: a
  setter whose value has no type and no getter (TypeScript's implicit `any`), where an
  assignment to it used to add `TS8022 Unknown field` as well, and one beside a getter that
  returns nothing. `examples/inferred-returns.shade.ts` sets its orbit's size through such a
  pair; `src/compiler/ts/return-inference.test.ts` holds every CPU path to one value and to the
  program that writes the types.

- **A function that writes no return type returns what its body does, as TypeScript infers it**
  (Rule 8.19, new; Rules 7.2 and 8.16; surface §14 and §26). A helper with no annotation was
  `void` beside a `TS8021` "defaulting to void" warning, so one that returned a value was a type
  mismatch at every call; a local arrow function with an expression body was `"f" returns a
value straight away, so it needs a return type`, a getter with none `The getter "C.y" needs a
return type`, and a field that holds a function with an expression body refused the same way.
  A function of the file or of a namespace, a local function, each instance of a generic
  function and of a function that takes a function, a method, a getter and a field that holds a
  function now take the type of their first `return` with a value, and the ones after it are
  typed against it as against a written type. A call that needs the type before the body's turn
  lowers that body first, so a function may be called above its declaration and from another
  file. An arrow function whose expression body is an assignment, `++`, `--` or a call of a
  function that returns nothing runs it as a statement; a method whose every `return` is
  `return this` chains as one written `this` does. A call cycle, whose type would wait on
  itself, is refused as one, once, with its path; so are returns of two types, a bare `return`
  beside a value, and a default parameter value that calls such a function. The warning is
  gone. `src/compiler/ts/return-inference.test.ts`
  holds WGSL, GLSL ES 3.00 and every CPU path to one value for each form and each form to the
  program that writes its types; `examples/inferred-returns.shade.ts` joins the compile gate.

- **A function takes a function, and a call hands one over by its name or as an arrow function**
  (Rule 8.18, new; surface §14). `f: (x: f32) => f32` was `TS8002 Unsupported type syntax`, and an
  arrow function written as an argument `TS8099 Unsupported expression`. A function whose parameter
  has a function type, written out or through a type alias, is now compiled once for each function
  its calls hand it, as a generic function is once for each set of type arguments: `apply(sq, x)`
  calls `apply_sq(x)`, in which `f(x)` is `sq(x)`. A call hands a function over by its name (a
  module function, a local function, or a parameter of function type handed on) or as an arrow
  function or a function expression written there, which is a local function of the calling body:
  it takes its types from the parameter's type, may leave parameters off at the end, and reads and
  writes the variables around it (Rule 8.17), which the copy takes and passes on,
  `repeat3_run_body(&s, k)`. An arrow function whose type returns `void` runs an expression body
  as a statement, `() => n += k`. The folds `any`, `all`, `none` and `zip` take an arrow function
  the same way, and the one `zip` is handed returns what its body does; `sum`, `none` and `zip`
  join the §9.3 extension table, and the editor's ambient declarations gain every array fold, each
  of which it underlined before (TS2304, TS2554). A generic function a namespace declares can be
  called by its qualified name, `N.pick(a, b)`, which was `"N" has no function "pick"`. A function
  that does not fit, a choice made at run time, a parameter of function type on a method, a
  constructor, a local function or an entry point, a function type anywhere else, and copies that
  would never end are refused, each with the fix. `src/compiler/ts/higher-order.test.ts` holds WGSL,
  GLSL ES 3.00 and every CPU path to one value for each form; `examples/higher-order.shade.ts`
  joins the compile gate.

- **A local function reads and writes the variables around it, as a TypeScript closure does**
  (Rule 8.17, new; Rule 8.8; surface §14). A local function that read a name from the body
  around it was `TS8099 "f" reads "k" from the function around it. … Pass "k" as a parameter.`,
  and a `function` declaration inside a body was an unsupported statement. Each variable a local
  function reads from a function around it is now a parameter the emitted function takes ahead
  of its own, and every call passes it: by value while nothing writes it, and by reference once
  the function, or a local function it calls, writes it, `fn run_inc(n: ptr<function, f32>, k:
f32)` called as `run_inc(&n, k)` in WGSL and `void run_inc(inout float n, float k)` in GLSL
  ES 3.00. `this` in an arrow function is the method's object, written through as the method's
  own `this` is (Rule 8.10); a `function` declaration is hoisted; a local function in a method,
  and one in a generic function, made once per instance, compile where each was "Unknown
  function" at its call; and a fold's
  callback (`any(xs, near)`, `zip(xs, ys, f)`) passes what it captures to each call. A call at a
  point where a variable the function reads is not declared yet is refused, as TypeScript throws
  there, and a function named as a value (`const g = f`) is refused where it was "Unknown
  identifier". `src/compiler/ts/closures.test.ts` holds the oracle and the codegen at both
  precisions, the debugger, and the oracle over the optimized module to one value for each form;
  `examples/closures.shade.ts` is in the compile gate.

- **A path tracer example** (`examples/path-tracer.shade.ts`). Four spheres with diffuse and
  emissive materials, eight bounces as an iterative loop with an early `break`, cosine-weighted
  sampling from `random(seed)`, a constant array of structs as the scene, and sixteen paths per
  pixel, tone-mapped. It compiles with no diagnostic on both targets and in the editor, passes
  the compile gate's Tint, WebGL2 and render-pipeline legs, and renders on WebGPU (measured on
  Tint with SwiftShader). Writing it found what #203 (loop bounds) and #204 (multi-pass
  rendering) now ask to decide.
- **`grad(m, fn, param)` differentiates a function in forward mode** (roadmap 0.7 item 18). It
  is an IR → IR pass exported from `typeshade`: it adds `<fn>_d_<param>`, which takes `fn`'s
  arguments and returns the derivative of its result, and a `<g>_jvp` helper for each function
  the parameter reaches through a call. Every `f32`, float vector and float matrix carries a
  tangent beside its value; `if`, `switch` and `for` keep their primal conditions; the
  component-wise builtins, `dot`, `cross`, `length`, `distance`, `normalize`, `reflect`,
  `transpose`, `mix`, `smoothstep`, `pow` and `atan(y, x)` have their textbook rules; and
  `floor`, `ceil`, `round`, `trunc`, `sign` and `step` differentiate to zero. A vector parameter
  takes `{ direction }` and gives the directional derivative. Anything else the parameter
  reaches, a texture sample, `refract`, a struct or an array that would carry the derivative, a
  module variable written with it, is refused with the new `SD0118`, naming it, rather than
  given a zero derivative. Every rule is checked against a central finite difference on both
  CPU modules, and the generated functions for three modules covering every rule compile on
  Tint and on ANGLE. `grad` is a host API: no `"use typeshade"` spelling is added (Rule 2.1,
  §2.1), so the §9.3 extension table does not change.
- **A user-journey gate, `bun run gate:journeys`, in CI as `user-journeys`.** It packs the
  tarball the way the publish workflow does and installs it into a fresh project, with the
  README's `tsconfig.shade.json` copied verbatim. Then it checks each program in `journeys/`
  as its author would meet it. The installed `compile()` must report nothing, and so must the
  language service. Plain `tsc` may report only the error classes the README documents. Every
  run must match the journey's own plain-JavaScript reference on WebGPU (headless Chromium,
  SwiftShader) and on the CPU oracle. Two journeys to start, both written as a TypeScript
  developer writes them: a fullscreen fragment effect, read back per pixel (16,384 channels,
  worst error 2.1e-3 of a 5.9e-3 tolerance), and a particle system stepped once per frame for
  20 frames (1,600 floats, exact on WebGPU). A deliberately wrong reference, the README's
  previous tsconfig and a shader the compiler refuses each fail it. Its first run found an
  editor error on correct code: `const uv = p.xy * frame.scale` is a `number` to the editor,
  so `uv.x` is TS2339 (#162). The journey carries the annotation and names the issue, and
  `journeys/README.md` requires that of every workaround.
- **`for (const x of xs)` over an array** (Rules 7.2, 7.5). The other loop a TypeScript author
  writes over data was `TS8013 for-of / for-in iterate JS objects`. Over an `array<T, N>` or a
  runtime-sized storage array it is now a counted loop over the indices. The element is read at
  the top of each trip, and `let x` is a copy the body may change. The bound is the array's size,
  or `arrayLength(&xs)`. A vector (`TS8003`) and an array that is not a name or a path to one
  (`TS8006`) are refused with the remedy. `for…in` stays `TS8013`, now with a message that names
  both loops to use instead. The editor used to report TS2488 (the type "must have a
  `[Symbol.iterator]()` method") on every such loop. The ambient `array<T, N>` and list types are now iterable: the
  ambient file restates `Symbol` and `SymbolConstructor` as the standard library spells them,
  and the compiler still refuses `Symbol` as a value. `examples/loops-over-data.shade.ts` weighs
  its samples with one, on the compile gate.

- **Hover documents every type name the compiler takes.** `TYPE_DOCS` has rows for
  `sampler`, `sampler_comparison` and every `texture_*` name, each with its `declare const` form
  and the capability that keeps it off GLSL ES 3.00 where one does. `DOCUMENTED_TYPE_NAMES` is
  the documented rows, and a test holds it to every name the compiler supports.

- **Hover documents every matrix type, not only `mat4`** (Rule 12.7, surface §40). The language
  service's type table, which hover, completions and the reference pages read, had rows for
  `mat4` and `mat4x4` alone, while the compiler takes all nine `matCxR` and the three square
  `matN` shorthands; hovering `mat3x2` said nothing. The ten missing rows are there now, in the
  same voice, and `src/language-service/docs.test.ts` requires a row for every matrix name
  `SUPPORTED_TYPE_NAMES` holds.
- **A method that changes its object may return a value** (§26, Rule 8.10). A generator's
  `gen(): f32` that assigns `this.seed = …` and returns the draw was `TS8035 A method that
changes its object returns nothing (§26)` at the assignment: the rule of the protocol that
  returned the struct itself for the caller to store back. Since such a method takes its object
  by reference, the return is free, and it is WGSL's own idiom for a generator:
  `fn Random_gen(self_: ptr<function, Random>) -> f32` and `float Random_gen(inout Random
self_)`, with `const a = rng.gen()` emitting `let a = Random_gen(&rng);` and `float a =
Random_gen(rng);`. Called on its own line the value is dropped and the write kept. The
  receiver rules are the `void` method's, in any position: a `const`, a parameter or a value
  nothing holds is refused with the fix, and one that returns nothing still has no value to
  give. A write to `this` is now refused only in a base's body called through `super`, which
  reads its object only, and the message says that and names the `super` call, where it used to
  tell a `void` method to be `void`. `examples/rng-method.shade.ts` draws inside a `vec3(...)`
  and in an arm of `?:`; it compiles on Tint and links on a WebGL2 driver, and the CPU oracle,
  the codegen and the debugger agree on the generator in `class-methods.test.ts`. Rule 8.10 is
  new in `docs/language-design.md`, and Rule 8.8 says the object is not an authored parameter.
- **Getters and setters, private names, parameter properties and the rest of an ordinary
  TypeScript class** (§26, Rules 8.11 to 8.14). An accessor is a function of the module for each
  half, `get area()` as `fn Rect_get_area(self_: Rect) -> f32` and `set width(v)` as
  `fn Rect_set_width(self_: ptr<function, Rect>, v: f32)`: `r.area` calls the getter,
  `r.width = 4.` the setter, and `r.width += 1.`, `++` and `--` read through the one and write
  through the other; a static accessor is read on the class. A private name `#x` is emitted
  without its `#` (the field `#count` is the member `count`, the method `#step` is `Cls_step`)
  and may be named only inside the class that declares it, which the front end checks since it
  does not run TypeScript's checker. `constructor(public x: f32)` declares the field and assigns
  it before the initializers run; a field written without a type takes the one its initializer
  names (`hits = 0` an `f32` by Rule 5.1, `on = false` a `bool`, `v = vec3(0.)`, `p = new P()`);
  a static field the file writes is a `var<private>`, the variable a top-level `let` is, and
  `this` in a static member is its class, so `this.hits += 1.` writes it; a `readonly` field
  takes a write only in its class's constructor. Refused, each with the fix: a read of an accessor
  with no getter and a write of one with no setter, a write into what a getter returns (a copy),
  `#x` outside its class body, two members of one class chain that would share an emitted name,
  an object literal of a class with a private field, a field whose initializer names no type, a
  write to a `readonly` field, and a static block. What was measured before this: a getter or a
  setter was `TS8035` with "write it as a method", `#x` was `TS8010` ("Field names must be plain
  identifiers"), a parameter property declared no field (a class of them alone was `Struct has
no fields`), a field written without a type was dropped from the struct with nothing said at
  its declaration and `Unknown field` at every use, a static block was passed over in silence, a write to a static field was `Cannot assign to unknown name`, and a
  write to a `readonly` field compiled. `examples/class-syntax.shade.ts` compiles on Tint and
  links on a WebGL2 driver, and `class-syntax.test.ts` holds WGSL, GLSL ES 3.00, the CPU oracle,
  the codegen and the debugger to one value for each form. The four rules are new in
  `docs/language-design.md`, Rules 3.2 and 6.9 name private names and parameter properties, and
  Rule 7.2's table gains the three lowerings.
- **`super` on an accessor and on a base method that writes its object, statics through a class
  that extends, `new this()`, `private` and `protected`, and a chain of calls on one object**
  (§26, Rules 8.10, 8.11, 8.13 and 8.15). `super.value` in an override reads through the base's
  getter and `super.value = v` writes through its setter, the base's half lowered once more for
  the derived class (`Clamped_super_Counter_set_value`); a base's body called through `super`
  that writes `this` takes the object by reference, as any method that writes it does. A class
  inherits its base's statics, `Big.SCALE` and `Big.unit()`, and `this` in a static member is the
  class the call names, as TypeScript binds it, so `Big.unit()` runs `Shape`'s body lowered for
  `Big` (`fn Big_unit() -> Big`): `new this()` builds a `Big`, `this.SCALE` reads `Big.SCALE`,
  and `super.describe()` in a static member runs the class above's static with `this` still
  `Big`. `private` and `protected` are enforced as TypeScript's TS2341, TS2445 and TS2446 have
  them, and an object literal cannot build such a class. A method whose every `return` is
  `return this` hands back its object, and a chain that is the whole of a statement, an
  initializer or a `return` runs each call but the last on the place it starts from:
  `v.setX(1.).setY(2.)` is `V_setX(&v, 1.0); V_setY(&v, 2.0);`, and a `new` at the root is held in
  a temporary `_chain`. Refused, each with the fix: `super.x` naming a field or a half the class
  above does not declare, a write to a static through a class that does not declare it
  (`Big.count += 1.`, TS8005, write `Shape.count`), `super.K = v` in a static member (TypeScript
  writes `this.K`), `this.#k` in a static a derived class reaches (TypeScript throws), and a call
  that writes its object on the copy a `return this` method hands back inside a larger
  expression. What was measured on `main` before this: `super.v` was TS8099 ("`super` has no form
  here yet"), `super.v = x` TS8018, a write to `this` in a base's body called through `super`
  TS8035, `B.K` on a class that inherits it TS8022, `B.k()` on a class of statics alone that
  inherits it TS8035, `new this()` TS8013, `super.k()` in a static member TS8035,
  `v.setX(1.).setY(2.)` TS8035 ("a value that is dropped"), and `new A().n` on a `private n` or a
  `protected n` compiled. Rule 8.15 is new, Rules 8.10, 8.11 and 8.13 say the rest, and Rule
  7.2's table gains the chain and the inherited static.
  `examples/class-builder.shade.ts` compiles on Tint and links on a WebGL2 driver, and
  `class-syntax.test.ts` holds WGSL, GLSL ES 3.00, the CPU oracle, the codegen and the debugger to
  one value for each form.
- **A method that changes an object its object holds, a `const` object, a field that holds a
  function, an interface with methods, and a call cycle through methods** (§26, Rules 6.9, 6.10,
  8.4, 8.10 and 8.16). `this.hull.step(dt)` changes `this` when `step` changes its object,
  whichever class declares `step`: which methods change their object is worked out for every
  class of the file at once, through a field, an element, a getter and a `return this` chain, so
  `fn Ship_drift(self_: ptr<function, Ship>, dt: f32)` calls `Body_step(&(*self_).hull, dt)`. A
  local `const` leaves what it holds writable, as TypeScript's does: after
  `const ship = new Ship()`, the call `ship.drift(0.5)` makes the declaration a `var` at the first
  write through it, for `new`, an object literal, an array literal and a type's constructor, and
  a `const` nothing writes through stays WGSL's `let`; one that copies another name's value is
  refused as before, now saying why (TypeScript would change the object both names hold) and
  naming both fixes. That a struct local is a value, `let` or `const`, so `const w = v` copies
  where TypeScript shares the object, was so before and is recorded now, in Rule 7.2's table
  and §26. A field that holds
  an arrow function or a function expression is the method it is written as:
  `focus = (d: f32): f32 => d * this.gain` is `fn Lens_focus(self_: Lens, d: f32) -> f32`, and
  `this` is the object. A static one, type parameters, `async`, a generator and an expression
  body with no return type are refused with the fix. An interface that declares a method is a
  contract: `implements Shape` and `<T extends Shape>` compile, `total<T extends Shape>` being one
  function for each class it is called with, and a value of the interface's own type is refused
  once, where the interface declares the method, with the type parameter to write. A call cycle
  through methods, accessors or `new` is TS8031 at the call that closes it
  (`Recursive call: "N.f" -> "N.g" -> "N.f".`), read off the lowered calls; a static called
  through its class is named `"N.f"` rather than `"N_f"`, and a generic function's cycle is said
  once, under the name it was written with. What was measured on `main` before this: `drift`
  above was TS8035 ("reads its object only, so it cannot write "this""), a changing call on
  `const ship` TS8035 ("declare it with let"), each arrow field TS8035 ("A field holding a
  function is a method") with `"Lens" has no method "focus"` after it, `<T extends Shape>`
  TS8010 ("cannot have methods"), and mutual recursion through `this` compiled to WGSL that Tint
  refuses. Rules 6.10 and 8.16 are new, Rules 6.9, 8.4 and 8.10 say the rest, and Rule 7.2's
  table gains the `const` and the field. `examples/class-parts.shade.ts` compiles on Tint and
  links on a WebGL2 driver, a pointer to a field of the object behind a pointer,
  `Mover_step(&(*self_).center, dt)`, among it, and `class-syntax.test.ts` holds WGSL, GLSL ES
  3.00, the CPU oracle, the codegen and the debugger to one value for each form.
- **Each `.shade.ts` example registers itself** (#65). Every example used to be registered by
  appending an object literal to one hand-ordered array in `examples/_shade.ts`, so two branches
  that each added an example added adjacent lines to the same region and git could not tell the
  two additions apart: every such pair conflicted on every merge, five hand resolutions across
  three branches in one afternoon, none of them a real disagreement — and resolving one by
  taking a side dropped an example silently. The hand-written half `compile()` cannot infer
  (`title`, `blurb`, `renderable`, `twinOf`, and the refusal `reason`) now lives in the shader
  it describes, as a JSON block in a comment after the `"use typeshade"` directive, and
  `_shade.ts` scans the directory for them in id order. Two branches adding two examples touch
  two NEW files and no shared line.

  A sibling MODULE per example — the shape first proposed — does not work: `shadeExamples` is
  consumed at module scope as a plain array by five callers, so discovery has to be synchronous,
  which rules out `import()`; static imports would leave one import line and one array entry per
  example, halving the conflict class rather than removing it. A comment costs no new file and
  cannot drift away from, or outlive, the shader it describes. A `.shade.ts` file stays exactly
  as non-importable as it was, and the block is REQUIRED — a shader without one, or with one
  that is not JSON, or that claims `renderable: false` with no reason, fails loudly instead of
  going unregistered. No golden changed by the registry itself, and the gate is unmoved: it
  covers the same examples it did, discovered rather than listed.

- **The surface baker prints a union's members sorted** (#61). A union's constituent order in
  TypeScript is a function of the whole program rather than of the declaration, so adding
  `./debug` to `API_SUBPATHS` re-spelled `TypeshadeSymbolKind` in `src/__api__/surface.md` while
  `src/language-service/types.ts` was byte-identical on both sides — and every future subpath
  addition would have shuffled unrelated rows into its own surface diff, which is the noise that
  trains a reviewer to skim the one file this gate exists to have read. Members are a set, so
  sorting them loses nothing; the guard is that the printed form must split into balanced parts,
  which leaves `boolean` (internally `false | true`), an enum, and any union nested inside a
  signature exactly as TypeScript printed them. 27 such nested unions remain, all inside
  parameter lists, and sorting those needs the signature rebuilt from the type rather than
  post-processed as text. Measured both ways: before, removing `./debug` moved
  `TypeshadeSymbolKind`; after, it moves only `./debug`'s own rows. The re-bake in this commit
  is reordering alone — all 50 changed rows were checked to be permutations of their old
  members, token for token — and a new arm keeps every top-level union sorted from here.
- **The order that makes a shadowed varying correct is now asserted** (#62). Three porting
  twins emit a fragment `main()` that declares a local with the same name as an `in` varying,
  and the shader is correct only because the gather prelude is emitted BEFORE the body, so the
  one read of the global precedes the declaration that shadows it. Nothing said so and nothing
  checked it, while three plausible changes would reverse it — materialising the input aggregate
  lazily at first use, hoisting user declarations to the top of `main()`, or extending
  field-inlining to substitute the reads its collision guard currently rejects. Under any of
  them the shader still compiles, still links and reads the wrong `uv`, and the only signal
  would be a re-baked golden, which says "this moved" rather than "this is now wrong".
  `glsl-stages-parity.test.ts` now re-emits every renderable example, finds each varying a local
  shadows, and asserts the read is in front and is the only use in front — changing no golden
  and no emitter.
- **The roadmap carries the audit's twelve new rows** (#159, from #144 §8). Seven deferrals that
  existed only as a sentence in the surface document, and five gaps with no row at all, are now
  items with a size and an issue: 13a and 13b for the texture argument, stage and query work
  (#145, #147) and 13c for the §36 deferral list (offsets, `textureNumLevels`,
  `textureSampleBaseClampToEdge`, `texture_external`, storage 1d and 3d); 8a, 8b and 9a for the
  builtins (#150, #152, #154); and T11 to T15 and T17 for the language work, four of them the
  audit's BLOCKERs — uniform array stride (#156), `@interpolate(flat)` on an integer varying
  (#158), the shift right-hand side (#160) and derivative uniformity (#161) — beside literal
  typing (#148) and the `enable` spelling with the missing capabilities (#146). **Five of those
  seven rows are already gone again**, which is what a roadmap row is for: #168 shipped T11,
  T12, T14 and T17 whole, and most of T13, so those four were deleted and T13 narrowed to the
  two statement forms that measurably remain (`do…while` and a labelled `break`, each refused
  as TS8099 today). T15 stays, because #148 shipped only its deprecation window: `let i = 0`
  still types the literal `f32` and `xs[i]` is still `Index must be i32 or u32`, measured rather
  than assumed. Item 23 gains
  the five override rows in its Notes, the `f16` row gains the wiring order #153 records, and
  After 1.0 gains `atomic<vec2<u32>>`. The two rows this branch also proposed, for the matrices
  and the f64 holes, are not here: #166 shipped both while it was open, and `main`'s own T18
  records the f64 work as delivered.
- **Four structural tests, so a whole class of omission cannot come back** (#155, from the WGSL
  spec audit #144). A texture feature arrives in layers — a type spelling, an argument check, a
  stage rule, an emit, an ambient declaration, a CPU stub — and nothing forced them to arrive
  together, which is how six classes of program that this front end accepts and Tint refuses
  came to exist. Four suites now read an authority instead of a hand list.
  `src/core/spec-conformance/coredef-texture-overloads.test.ts` reads Tint's own overload table,
  baked from `core.def` into a checked-in fixture by `scripts/bake-coredef-textures.ts`
  (`bun run bake:coredef`), and
  forces every one of its 184 `fn texture*` rows to be claimed: SUPPORTED by a `"use typeshade"`
  witness synthesised from the row's own parameter list, or DEFERRED with a reason and the issue
  that owns it. `stage-rules.test.ts` derives the fragment-only, fragment-or-compute and
  compute-only sets from a second fixture off the same `core.def` — every builtin carrying a
  `@stage`, the derivatives, the barriers and the atomics included — and compares them with the
  two hand-written sets the compiler keeps in two layers, the pair that lost
  `textureSampleCubeArray`. `ambient-registry-closure.test.ts` pins the ambient library against
  the lowerer in both directions, the one pair of the four authorities nothing compared.
  `capability-reachability.test.ts` gains a `"use typeshade"` SOURCE witness per `Capability`,
  seven of thirteen today; of the six without one, the three a program could exist for carry the
  very probe that must keep failing, and the three host-only device features carry the reason
  there is no program to write.
  Every allowlist in the four is shrink-only: three of them by MEASUREMENT — an entry whose
  program has since started to work fails the suite that holds it — and the ambient closure by
  set membership, since "is this name declared" needs no program to answer.
- **The compile gate creates a render pipeline** (#155). `createShaderModule` compiles a module;
  it does not create a pipeline, so everything WebGPU validates about a module rather than
  inside it — the vertex state against the entry's `@location` inputs, the colour targets
  against its outputs — went unseen, and a shader whose attributes no buffer supplies compiles
  and cannot draw. The gate now builds one render pipeline per render pair (74 of the 85
  examples), with the layouts and targets derived from the IR entries rather than authored, and
  prints the reason for every example it does not build one for. Its own instrument check sits
  beside the two existing ones: a module Tint compiles, with a `@location` vertex input and no
  buffer supplying it, must be REPORTED, or the leg is blind. The audit expected the stage rules
  to surface here too; measured on this SwiftShader build they do not — `createShaderModule`
  reports them itself, and the gate's existing WGSL leg already sees that class.
- **The Tint-invalid emits were pinned as `it.fails` rows that a fix must flip, and every one
  of them has now been flipped** (#155). `src/compiler/ts/tint-invalid.test.ts` held four
  language programs that compiled clean here and were refused by Chromium: an `array<f32, N>` in
  a `var<uniform>` (stride 4 where WGSL requires 16), a shift with an `i32` right-hand side, an
  integer varying with no `@interpolate(flat)`, and a helper that assigns to its whole
  parameter. Each was re-measured on Tint on 2026-09-21, and each is now an ordinary assertion
  of the rule that closed it: #156 PADS the uniform array (`@align(16) xs: array<_Pad16_f32,
4>`), #160 wraps the shift operand as `u32(...)` and refuses the parameter write as TS8018
  naming the copy to make, and #158 derives `@interpolate(flat)` for an integer varying and
  leaves a float one alone. The ratchet is what reported all of it — with one instructive
  exception recorded in the file's header: the uniform-array row's body asked for a DIAGNOSTIC,
  and #156 closed it by padding, which produces none, so that row stayed green and its companion
  arm on the EMIT is what caught the fix. Where the defect is a non-const integer in a slot the spec types otherwise
  — the shift, and the texture rows — the operand comes from a UNIFORM, which is load-bearing:
  written as a `const` the front end folds it to a literal, and a WGSL integer literal is an
  abstract-int that converts on its own, so Tint accepts that program. The same shape covers the texture rows
  (`texture-dims.test.ts`, `storage-textures.test.ts`, `ambient.test.ts`), and the sweeps the
  audit asked for: every GPU stub's placeholder value and strict-mode throw, every PORTABLE id's
  CPU twin and its identical spelling through both real writers, every `INTRINSICS` row's text
  from one literal table, every `MATH_ARG_SPECS` rule against a wrong kind, a wrong count and a
  wrong shape, the precision line for each of the thirteen sampler types GLSL ES 3.00 does not
  predeclare, every handle kind `reflect()` can hold, and the golden set of both example
  registries with no orphan. The f64 rows this issue asked for are not here either: #166 landed
  a sweep driven by the pass's own exported twin registry, which supersedes the hand table. The
  fifth program the suite found — a struct field named with a WGSL reserved keyword, which used
  to compile with zero diagnostics and emit a module Tint refuses — is a closed row rather than a
  row waiting on a fix: #165 shipped the refusal, so it reads as a plain `it` pinning TS8068 over
  all ten names, the name and the target in the message, and a remedy.

- **Packing, bitcast and the constructors WGSL spells** (§44, #150). The IR and both backends
  have spelled the eight pack/unpack ids and the two `bitcast` ids since the registry was
  written, and nothing on this surface could NAME them: every one was `Unknown function`.
  `pack4x8unorm`, `pack2x16float`, `unpack2x16snorm` and their siblings are authorable now, with
  `pack4x8snorm`, `unpack4x8snorm` and `quantizeToF16` appended beside them. A pack takes exactly
  the vector its name says and yields a `u32`, an unpack the reverse, and a wrong shape is one
  sentence naming the single overload each has; the bit pattern of an unpack may be written as a
  bare number, since an integer literal is retargeted in every integer position. `bitcast<u32>(x)`
  names its target as a TYPE ARGUMENT as WGSL does, and says which of reinterpreting and
  converting it is when handed the wrong one. `quantizeToF16(x)` rounds to what an IEEE-754
  binary16 holds and comes back as an `f32`, on a scalar or a vector; WGSL spells it natively,
  and GLSL ES 3.00, which has no such builtin, gets a `packHalf2x16`/`unpackHalf2x16` round trip,
  one component at a time — pairing two into one `packHalf2x16` was measured to let an
  overflowing component carry into its neighbour, which WGSL's per-component builtin cannot do.
  It is a `target` row in the determinism report, naming the three divergences measured on a
  real driver: the exact half (the GLSL round trip rounds to nearest even, the driver moved),
  the magnitudes above the largest finite binary16 (an infinity on WGSL, a NaN through the GLSL
  round trip) and those below the smallest normal one (flushed to zero by the driver, kept by
  the round trip). `pack4x8snorm` is a `target` row beside its unorm twin for the same reason
  measurement gave rather than the one reasoning suggested: its inline spells WGSL's own
  `floor(0.5 + x)`, and the WGSL driver still rounded the tie to even. Its CPU twin rounds the
  scale to f32 before rounding, and clamps by WGSL's NaN rule, because a driver does both.
- **The three constructor spellings, and `all`/`any` on a bool** (§44, #150). `vec3()` is the
  zero value, `vec3<u32>(1, 2, 3)` names its element as a type argument, and `array(1., 2., 3.)`
  infers both its element type and its count. The middle one was a silent bug rather than a
  missing feature: the type argument was read by nobody, so `vec3<u32>(1, 2, 3)` compiled clean
  and emitted `vec3<f32>(1.0, 2.0, 3.0)` — a program that asked for an unsigned vector got a
  float one, and a following `f32(v.x)` looked like a cast while casting nothing. A short name
  already says its element, so `vec3u<f32>` is refused as a contradiction; `array(...)` refuses
  elements that disagree rather than guessing which was meant. `all(e)` and `any(e)` on a plain
  `bool` are overloads of both builtins in WGSL and both return the argument: the ambient lib
  always admitted the scalar and the front end refused it, so the editor and the compiler
  disagreed about a program WGSL defines. It lowers to the ARGUMENT, not to a call, since GLSL
  ES 3.00 has no `all(bool)` overload to emit. `f32()`, `i32()`, `u32()` and `bool()` are the
  scalar half of the same zero-value row and are spelled now too.
  The ambient lib gained the zero and type-argument forms, and it distinguishes `vec3<u32>` from
  `vec3<f32>` by `keyof` rather than by assignability, because the scalar brands are optional
  properties and so are mutually assignable. Only the SCALAR-component forms take a type
  argument: an ambient parameter has to be a concrete type for the vector-arithmetic filter
  (#43) to read a shape off it, so composing from a shorter vector or converting a whole one
  keeps the short name and the compiler refuses the long one, naming it.
  `examples/packing-bitcast.shade.ts` runs all of it on both halves of the gate.
- **Eleven fp64 twins: the `f64` surface read back as source** (§39). The thirteen `fp64-*`
  examples existed only as `fn()` EDSL modules, so the surface section that defines the `f64`
  type had no example an author could read in the language it describes. Eleven of them are
  now `.shade.ts` twins registered beside their originals: `fp64-deep-zoom`,
  `fp64-checker-plane`, `fp64-loran`, `fp64-rtc`, `fp64-julia`, `fp64-burning-ship`,
  `fp64-newton`, `fp64-mandelbrot-de`, `fp64-clock`, `fp64-cancellation` and
  `fp64-sine-sweep`. Each is the same shader rather than a second program that computes
  something similar: the same uniform struct field for field and in declaration order, the
  same binding at the same group and slot, the same entry names and stages, the same constants
  and the same arithmetic in the same order, so `reflect()` of the twin deep-equals
  `reflect()` of its original and `shade-twins.test.ts` pins what is left as goldens. Between
  them they spell most of §39: a lane read on a `vec2<f64>` (`u.center.x`), a literal lifted
  to a full double beside an `f64` (`* 0.5`, `let zx: f64 = 0.`), `f64(x)` to widen and
  `f32(x)` to narrow, `/` through `df64_div`, and `abs`, `floor`, `fract`, `sin` and
  `distance` through their `df64` bodies, with `pow`, `exp`, `log`, `step` and `smoothstep`
  reached only after a narrow the original already wrote. What the family does not reach is
  `min`, `max`, `mix`, `normalize` and a `sqrt` written directly on an `f64`: §39 gives all
  five an emulated-double body, but every `min`, `max` and `mix` these eleven shaders write
  sits on a narrowed f32 colour or coordinate, `normalize` is in none of the thirteen
  originals, and `df64_sqrt` is emitted only where `distance` on a `vec2<f64>` reduces to it.
  Nothing an author writes crosses an entry boundary as a double: each fragment stage reads
  the uniform itself, which is the remedy the `TS8038` varying refusal names.

  What each target emits is unchanged. The 55 new goldens are new files and not one existing
  golden moved, and the difference the structural goldens record is the one the earlier twins
  already showed: an EDSL `const` without `Let()` is a build-time JavaScript binding that
  inlines, a source-language `const` is a shader `let`, so each twin carries a few more lets
  and the literals that moved into them. The `interface` and `resources` buckets, the two a
  twin may never differ in, are empty in all eleven. The compile gate runs 98 examples with 0
  failures including the new twins, WGSL through Tint and GLSL ES 3.00 compiled and linked on
  a real WebGL2 context.

  Tint says a shader is legal, not that it computes the double it claims to, so
  `examples/fp64-twins.test.ts` is a third leg for this family: every twin and its original
  evaluated on the CPU oracle at the 101 inputs the port was measured on, as authored, where
  an `f64` is a JavaScript double, and fp64-lowered under `precision: 'f32'`, where every
  `f64` is the `splitF64` pair the host packs. The twin agrees with its original at |Δ| of
  exactly 0 on both rows on all 101, and on the 53 samples where the emulation is asked to
  track its own double it lands within 1e-6, the bound `fp64-lane-stripes.test.ts` holds the
  pair to. The other 48 are the f32 half, the `fp64: 0` toggle and the f64-half points where
  the emulation parts from its own double, which is the contrast these split screens are drawn
  to show, and the suite refuses a sample set that is all of one kind so neither arm can go
  quiet. `fp64-mercator-tiles` and `fp64-mandelbrot` have no twin and are recorded
  rather than rewritten: both read a loop bound from a uniform their sliders drive, a zoom
  level and an iteration budget, and §17 requires a counted `for` over a constant bound
  (`TS8006`). `examples/PORTING.md` moves the eleven rows from blocked to portable, strikes N1
  (a lane read on a `vec2<f64>`) and N2 (an f64 literal) as landed the way A6-f64 already was,
  leaves L-loop holding the two, and recomputes "Portable today" from 13 of 36 to 24 of 36.

- **Every `matCxR` is a type** (§40). `mat4x4` was the only float matrix the surface admitted,
  on the recorded ground that "a 2×2 or 3×3 float matrix lays out differently under the WGSL
  and GLSL std140 rules". Measured on a real WebGL2 driver and on Tint, that is half right:
  std140 rounds every matrix column up to 16 bytes while WGSL's column stride is
  `AlignOf(vecR<f32>)`, so a TWO-ROW matrix diverges (`mat2x2`, `mat3x2`, `mat4x2` — stride 8
  against 16) and a 3×3 does not. The divergence belongs to the uniform layout rather than to
  the type, so all nine shapes are types now and `wgslLayout` refuses exactly the three it
  cannot describe honestly, naming `matCx4` and the `vec2` fields as the spellings that work.
  An author can write `mat3(a, b, c)` from columns, `mat2x3(...)` from components column by
  column, `mat2()` for the zero matrix and `mat3(m4)` to truncate (widening is refused: the
  column it would have to invent is the author's choice); `m * s`, `s * m`, `m * v`, the ROW
  product `v * m` and `matKxR * matCxK`, each typed per wgsl.txt:9960-9995; `transpose` on
  every shape, which swaps the dimensions, and `determinant` on the square ones, which is
  where it exists. The IR matrix carries `cols` and `rows` instead of one `n`, so a shape that
  is not square can be spelled at all; `matT(cols, rows)` builds one. WGSL emits `matCxR<f32>`
  and GLSL `matN` or `matCxR`, both measured on Tint and a real WebGL2 context through
  `examples/normal-matrix.shade.ts`. Three bugs fell out of the shapes being real: `m[j]` read
  one component instead of column j in all three CPU evaluators, `v * m` threw in two of them,
  and `transpose` recovered its shape from the array length, which cannot tell a `mat2x3` from
  a `mat3x2`. The emulated-double matrices stay square, since the fp64 pass has one `df64`
  body per dimension, and a non-square `matCxR<f64>` is refused where it is written.
- **The emulated double as an authored type** (§39, roadmap T18). The `f64` surface now admits
  exactly what the fp64 lowering pass can lower, and refuses the rest where it is written. An
  author can write `s * 2.5` and `s * t` beside a scalar `f64` (the literal is lifted to an f64
  literal carrying the whole double, an `f32` widens exactly as `vec2<f32>(x, 0.)`, the rule
  `binResultType` already applied in the fn() EDSL); `const k: f64 = 0.1`, a literal in any
  declared `f64` position; `p.x`, `p.xy` and `p[1]` on a `vec64`, which the pass has always
  lowered as a swizzle of the hi and lo planes; `vec3(p)`, the per-lane narrow; `round(x)`,
  through a new `df64_round`. `length`, `distance`
  and `dot` on a `vec64` are now typed `f64` — the front end typed them `f32` while the pass
  emitted the f64 pair, so a correct program could not be written (the BLOCKER of the spec
  audit). What the pass cannot lower is refused at the CALL, the operator or the cast, with the
  twin list and a narrow that actually lowers, instead of reaching emit as an SD0041 with no
  source span: every builtin with no `df64` body, `determinant` on a matrix of doubles, `mix`
  with an `f64` interpolant, an operand the pass would mis-walk (a `vec3` beside a `vec3f64`,
  which compiled clean and emitted `w.hi` on an `f32` vector), `%` and `%=`, `i32(x)`/`u32(x)`
  on a double, an `f64` in a texture's level, bias, reference-depth, mip-level or layer slot,
  and an `f64` on an entry's `@location` or return — the last under its own code, `TS8038`,
  naming two ORDINARY remedies (narrow with `f32(x)`, or read the double in the stage that
  needs it, since a uniform or storage binding carries one and every stage can see it). There
  is deliberately no author-facing way to split a double into its two `f32` words and rebuild
  it: the words are the emulation's business, and a program written against them would be
  written against an implementation detail. Carrying them as flat varyings transparently
  would be exact but is not done, because the surface has no `@interpolate` attribute, so an
  author could neither ask for a flat varying nor see that one had been chosen. A SCALAR `f64` vertex attribute stays accepted:
  that `@location` is a buffer read, not a varying, and one slot holds the pair. A lane is a
  READ: `v.x = …` and `v[0] = …` are refused, since after lowering the vector is two hi/lo
  planes and a lane of it is a swizzle of both — the indexed form had been dropping the write
  silently and the swizzle form emitted text both compilers reject. `round` is WGSL's
  ties-to-even and is deliberately NOT `df64_nint`, whose ties go toward +∞ for the mod-2π
  reduction; the twelve points where the two conventions disagree, including `2³⁰ + 0.5` and
  `2³⁰ + 1.5` where the low word carries the parity, are pinned against the oracle. WGSL and
  GLSL ES 3.00 are unchanged in shape (pairs of `f32`); no existing golden moved. The ambient
  library follows the compiler — the componentwise twins take a `vec64` in the editor because
  the pass has a body for them, the ones it has no body for stay refused, and numeric-literal
  lane keys make the editor accept `p[1]` and refuse `p[i]` and `p[2]` on a `vec2f64` exactly
  as the compiler does. `examples/fp64-lane-stripes.shade.ts` runs both halves of the gate,
  WGSL on Tint and GLSL ES 3.00 on a real WebGL2 context, with nothing crossing its entry
  boundary, and its numeric core is evaluated twice — on the oracle as a double and on the lowered module under f32 rounding — with a
  discriminative case plain `f32` provably cannot compute.

- **A deprecation window before an integer-written literal types as `i32`** (§13,
  [#148](https://github.com/typeshade/typeshade/issues/148)). Where nothing declares a type —
  `let i = 0`, `const K = 5` — a literal still takes `f32`, so `xs[i]` is `Index must be i32 or
u32`. WGSL concretizes an abstract integer to `i32` when nothing else decides, GLSL's `5` is
  an `int`, and a TypeScript reader expects `let i = 0` to index an array, so that default will
  change. **It has not changed here.** This release carries step one of the window and nothing
  else: `compile(source, { deprecations: true })` reports a `TS8053` WARNING on every
  declaration the flip will move, naming the one-line edit that keeps `f32`, and the flag moves
  no emitted byte — `wgsl` and `glsl` are byte-identical with it on and with it off, which is
  what makes it safe to turn on in a build. A literal written as a float, and one in a position
  that declares a type, are both left alone: the flip does not move them.

  `RELEASING.md` §7 now states the policy a meaning change follows — one release with the
  diagnostic and no behaviour change, then one release that flips the default as a breaking
  change with every golden re-baked and reviewed — and carries the list of windows that are
  open. A change to what a spelling ACCEPTS breaks nobody; a change to what it MEANS breaks
  everybody, silently, and a shader is the hardest place to see a silent change.

- **Derivative uniformity is analysed, or switched off on request, before Tint sees the module**
  (§54, [#161](https://github.com/typeshade/typeshade/issues/161)). WGSL requires
  `textureSample`, `textureSampleBias`, `textureSampleCompare` and the screen-space derivatives
  to be called from uniform control flow, and its `derivative_uniformity` rule has default
  severity `error`. `textureSample` inside an `if` on a fragment input compiled here with zero
  diagnostics and died at `createShaderModule`. It is refused at the call now, naming the value
  the control flow depends on — `"VsOut.uv" (a fragment input at @location(0))` — and the three
  ways out: hoist the call, use `textureSampleLevel`, or write
  `@diagnostic("off", "derivative_uniformity")` on the entry, which emits WGSL's module-scope
  `diagnostic(off, derivative_uniformity);` and takes the module as written.
  `examples/sample-branch.shade.ts` compiles that whole path on Tint and on ANGLE.

  Measured on Chromium 141 (`chromium_headless_shell-1194`) and 153
  (`chromium_headless_shell-1243`, the build CI installs), identically on both, with the
  broken-shader instrument check passing on both compilers first: the bare form is
  `'textureSample' must only be called from uniform control flow`, the same under a uniform
  buffer value is accepted, `textureSampleLevel` is accepted anywhere, `dpdx` gets the same
  message, and both spellings of the diagnostic filter are accepted. All of it is reported by
  `createShaderModule` rather than only by `createRenderPipeline`, so the compile gate already
  runs Tint's own check on every example and needs no pipeline leg — the issue's acceptance
  item rests on a premise the measurement disproves.

  The severity is honoured rather than merely emitted: `off` silences the rule, `info` and
  `warning` demote it to a warning, `error` is the default it already has — and none of them
  silences a BARRIER, whose requirement is not `derivative_uniformity` and is not filterable
  (measured: Tint still answers `'workgroupBarrier' must only be called from uniform control
flow` with the directive in the module).

  The analysis is three-valued on purpose, because the two callers want opposite answers from
  one walk: a derivative is refused only when its control flow is DEFINITELY non-uniform, so
  anything the walk cannot follow goes through to Tint rather than becoming a false positive;
  a barrier is reported unless its control flow is DEFINITELY uniform, so the relaxation can
  only ever admit what has been proven and a shape the walk cannot read keeps its old refusal.
  It is FLOW-SENSITIVE — the environment threaded in statement order, branches merged at their
  join, loop bodies iterated to a fixpoint — and INTERPROCEDURAL, with entries starting uniform
  and each call site handing its callee both the control flow it is reached under and the class
  of each argument, joined per parameter position. Both are what make those thresholds true
  rather than merely stated: order decides, so `let g = v.uv.x; g = 0.25;
if (g > 0.5)` is accepted as Tint accepts it, and a copy chain of any length is followed, so
  a barrier under one is refused as Tint refuses it. A call into a user function is AT LEAST
  `unknown` and AT MOST as uniform as the arguments its RESULT DEPENDS ON — never `uniform`,
  since its body can read a module `var` or a built-in value the walk never sees; never more
  uniform than the arguments that reach the result, since otherwise a one-line helper launders
  the value; and never less, since an argument spent on a local, a side effect or a branch the
  return does not sit under cannot make the value vary. The fixpoint therefore computes a
  SUMMARY per function — the parameter positions its return value depends on, by data and by
  control dependence, transitively through its own callees — and a call site joins those
  arguments alone. Measured on Chromium 141, instrument first: Tint refuses
  `if (edge(v.uv.x)) { textureSample(…) }` for an `edge` that is just `x > 0.5`, refuses a
  sample under `if (x > 0.5)` inside a helper called as `shade(v.uv.x, …)`, and ACCEPTS
  `if (lightingMode(v.uv, k)) { … }` where the helper's answer comes from the uniform `mode` —
  so a helper is not a policy boundary in either direction. All nine programs are pinned in one
  table, because this arm was answered wrong twice before, each time in the direction opposite
  the last.

  Two more rules, both found as FALSE PROOFS rather than gaps. A write's TARGET is a
  computation: `a[u32(x)] = y` makes every element of `a` depend on `x`, and reading only the
  assigned value and the enclosing branch accepted a sample under `if (idx(v.uv.x, k) > 0.5)`,
  which Tint refuses — so the target's index expressions now join the written variable's class,
  in the walk and in the summary alike. And a read of `private`, `workgroup` or `read_write`
  storage is NON-UNIFORM BY ADDRESS SPACE, with no regard for what was written into it: that is
  Tint's own rule, measured down to its refusing a read of a variable nothing in the module
  writes, and `workgroupUniformLoad` is the carve-out — uniform by construction, and with a
  workgroup read non-uniform on sight it is the only spelling left that can carry a barrier.
  A `uniform` binding, a read-only storage binding, a module `const` and an `override` stay
  uniform. One bit on the return summary carries the answer out of a nullary helper, since a
  call's class floors at `unknown` and never looks inside a body. Every row was measured on
  Chromium 141 with the instrument reporting first, and no example in the corpus refuses under
  the new rule. A `return` under a non-uniform condition makes everything after it
  non-uniform; a `discard` does not, both measured — an invocation that discards is demoted to
  a helper and goes on contributing the neighbour a derivative differences against, which is
  why `discard` beside `fwidth` is the ordinary antialiased-cutout idiom. GLSL ES 3.00 needs
  none of it — an implicit derivative in non-uniform control flow is undefined there rather
  than refused — and its text does not move.

- **Entry IO attributes, and the interpolation an integer varying has no choice about** (§53,
  [#158](https://github.com/typeshade/typeshade/issues/158)). WGSL requires every integral
  user-defined IO to carry `@interpolate(flat)` — there is no interpolation for a `u32` — and
  the compiler emitted `@location(0) id: u32,` bare while the GLSL writer had always added
  `flat`. One source described two different programs, and the WGSL half was one Tint refuses.
  Measured on Chromium 141 (`chromium_headless_shell-1194`), with the broken-shader instrument
  check passing on both compilers first: the bare WGSL form is `integral user-defined vertex
outputs must have a '@interpolate(flat)' attribute` and the bare GLSL form is `'in' : must
use 'flat' interpolation here`; both are accepted with the qualifier. The attribute is
  derived from the TYPE now, for a scalar and a vector alike, on both writers, and for both
  spellings of a varying — a struct field and a bare entry parameter, which reaches no struct
  and so stayed bare (`integral user-defined fragment inputs must have a '@interpolate(flat)'
attribute`). A vertex entry's `@location` parameters are vertex attributes, not varyings, and
  are left alone. `examples/id-pick.shade.ts` compiles it on Tint and on ANGLE.

  `@interpolate`, `@invariant` and `@blend_src` are attributes an author writes, and all three
  reach the emitted struct: `@interpolate("perspective", "centroid")` is
  `@interpolate(perspective, centroid)` on WGSL and `smooth centroid` on GLSL ES 3.00,
  `@invariant` on `@builtin("position")` is `invariant gl_Position;` there, and a
  `@blend_src(0)` / `@blend_src(1)` pair at one `@location` derives the `dualSourceBlending`
  capability and emits `enable dual_source_blending;`. The three shapes GLSL ES 3.00 does not
  have — `"linear"`, the `"sample"` position, and the second blend source — fail the module
  CLOSED there rather than emitting something else: it simply has no GLSL half, the way a
  storage texture already does not. No example carries `@blend_src`:
  `adapter.features.has('dual-source-blending')` is false on the gate's adapter and Tint
  answers `extension 'dual_source_blending' is not allowed in the current environment`, so a
  gate example would test the adapter rather than the emit.

  **And seven shapes that emitted clean text nothing would run.** A `bool` at a `@location`;
  two members at one `@location` (a dual-source pair excepted — there the slot is the location
  AND the blend source), checked after `extends` splices a base's fields in and across an
  entry's parameter list as well as a struct; a `@location` on a compute entry, in both the
  bare-parameter and the struct spelling; a `@builtin` declared with a type WGSL does not give
  it; a non-`flat` `@interpolate` on an integer varying, which Tint refuses with
  `interpolation type must be 'flat' for integral user-defined IO types` while GLSL answers
  from the type and emits `flat` regardless; a `@blend_src` with no pair; and a vertex output
  and fragment input that disagree at one slot. The interstage pair is compared in WGSL's own
  canonical form, so `@interpolate(flat)` and `@interpolate(flat, first)` are one answer and so
  are `@interpolate(perspective, center)` and no attribute at all — comparing the spelling
  refused pairs both targets take. The last
  is the one that needed somewhere new to live: when both stages share a struct they agree by
  construction, but two structs — which is what an author writes when the fragment reads a
  subset — let them drift, and a `vec2` output read as a `vec3` input emitted clean WGSL and
  clean GLSL with the failure arriving at pipeline creation, in a message naming neither struct
  nor field. It is a CORE lint rule on the IR, so every authoring surface is covered at every
  emit, and the front end runs the same function to point at the fragment declaration. A vertex
  output the fragment ignores stays legal: WGSL constrains only the slots the fragment names.
  The slot and varying-type rules moved to the struct collector on the way, because raising
  them per entry printed one mistake twice — a vertex output and a fragment input are the same
  struct.

- **Operators, switch and statements as WGSL spells them** (§52,
  [#160](https://github.com/typeshade/typeshade/issues/160)). A shift amount is a `u32`
  whatever it shifts: `x << n` with an `i32` `n` emitted `(x << n)`, which Tint refuses with
  `no matching overload for 'operator << (i32, i32)'`, while `x << 1u` — the one spelling it
  accepts — was refused here by the equal-types rule. The binary path now casts the way the
  compound path always did, retyping a bare integer literal rather than wrapping it; `&`, `|`
  and `^` keep the equal-types rule. The kind rule reads the ELEMENT, so `vec2u << vec2u` is
  two lanes shifted rather than a type error, and a `vec2i` amount takes the same conversion
  one lane wider; a scalar amount on a vector target is refused naming the splat, because
  WGSL's only vector overload is `vecN<T> << vecN<u32>`. Measured on Chromium 141
  (`chromium_headless_shell-1194`): Tint takes `vec2<u32> << vec2<u32>` and
  `vec2<i32> << vec2<u32>`, and refuses both `vec2<i32> << vec2<i32>` and
  `vec2<u32> << u32` with `no matching overload`, while ANGLE takes all four — so the
  conversion is load-bearing and the broadcast GLSL ES 3.00 §5.9 allows is refused here. There
  is no gate example for it: TypeScript's own `<<` yields `number`, so a lane-wise shift is
  TS2322 under the ambient lib before the compiler sees it, and the rule lives in the lowering
  to keep one kind rule across `&`, `|`, `^` and the scalar shifts. `~x` lowers to `~x` on both targets, with the CPU oracle
  routing it by the static kind (`~5` is `-6` on an `i32`, `4294967290` on a `u32`); unary `+`
  is the identity both targets give it; and `-u` on a `u32` is refused naming both fixes,
  since WGSL defines unary minus for the signed and float kinds only. One switch clause may
  carry several selectors: `case 0: case 1:` is `case 0, 1:` on WGSL and stacked labels on
  GLSL ES 3.00, which is what the IR now holds, and it used to be refused as "fall-through" —
  the one shape that is not fall-through. An empty clause above `default:` is refused instead
  of joined, because a WGSL selector list cannot carry `default` and the selector would have to
  attach to some other clause's body: `case 1: default: r = 10.; break; case 2: r = 20.;`
  lowered to `case 1, 2: { r = 20.0; }` beside `default: { r = 10.0; }`, so `f(1)` was 20 on
  both GPUs and in the oracle where TypeScript says 10. The mirror image is refused too: an
  empty `default:` with a clause after it falls through into that clause in TypeScript and
  runs nothing on both targets, and it emitted `default: { }` with no diagnostic. An empty
  `default:` as the last clause does nothing in either language and stays legal. Calling an entry point is refused, `_ = f()` is
  WGSL's phony assignment rather than an unknown name — and has no second meaning, since §62's
  reserved-name rule refuses a local of that name — and a decimal literal past the f32 range is
  refused instead of reaching the writer as `1e+40`.

  **A parameter is a value, and the shadow that would have hidden it is not spellable.**
  `a = 1.` emitted `a = 1.0;`, which Tint refuses (`cannot assign to parameter 'a'`); the
  docs called it a bug the compiler did not catch. It is caught now, with the line to add in
  the message. The obvious fix — shadowing the parameter with `var a = a;` — was measured on
  Chromium 141 and is `redeclaration of 'a'`, because a WGSL function's parameters and its
  top-level locals share one scope; a shadow would have to rename what the author wrote, so
  the line is asked for instead. Every spelling that writes a parameter reaches the rule, not
  just `a = v`: `a++`, `++a`, `a--` and a `for` whose update is `a += k` each built their own
  write target and so emitted `a = (a + 1);` past it; one function raises it now, so the three
  sites cannot drift apart again.

  `do … while` and a labelled `break` are likewise refused with their own reason rather than the
  catch-all. For the first the reason is the IR's loop node, not a missing header — `while (c)`
  has no header either and is accepted, reading its bound from the condition. The IR has one
  loop shape, a top-tested `for`, and a `do … while` runs its body before the first test; both
  targets could carry it (`loop { body; break if !(c); }` on WGSL, `do … while` outright on
  GLSL ES 3.00), so what is missing is a bottom-tested `Stmt` kind through all three backends
  and the trip-count analysis. It is a recorded deferral, and its code says so: `TS8099`, not
  the loop-bound code it borrowed. Neither target has a label for the second.

  The bitwise complement's intrinsic id is the operator `~`, not a name. CSE keys a call by its
  `fn` alone, so an id an author could also spell would let a user function of that name and
  `~x` fold into each other — silently, on the GPU and in the oracle alike; `~` is not a
  TypeScript identifier, so no declaration can collide with it.

- **A uniform lays out the bytes `reflect()` reports** (§51,
  [#156](https://github.com/typeshade/typeshade/issues/156)). WGSL's uniform address space
  aligns every array element to 16 bytes, so `array<f32, 4>` in a `uniform` is sixty-four bytes
  and not sixteen. The compiler emitted it as written, with zero diagnostics, while `reflect()`
  had always reported it at stride 16 — the emit and the reflection described different memory,
  and the GLSL ES 3.00 std140 block linked on WebGL2 with the layout reflection described. The
  WGSL writer now pads: a wrapper struct carrying `@size(16)` for the element stride,
  `@align(16)` on the member for the array's offset, and every read rewritten one field deeper
  (`U.xs[i].v`). Both attributes are load-bearing — a struct's alignment comes from its members
  and `@size` does not raise it, so with the stride alone a member following a scalar lands at
  offset 4, which is the same disagreement one level down. Where a padded array is read WHOLE
  rather than indexed — a local, a call argument, a return, a struct built by value — the
  authored array is rebuilt from its elements rather than letting the wrapper type leak.
  A storage array is untouched (std430 has no such rule) and the GLSL text does not move, since
  std140 gives `float[4]` the 16-byte stride natively.

  **What was measured, and on which build.** Chromium 141 (`chromium_headless_shell-1194`) has
  no `uniform_buffer_standard_layout` language feature and therefore refuses the unpadded module
  (`'uniform' storage requires that array elements are aligned to 16 bytes, but array element of
type 'f32' has a stride of 4 bytes`), refuses `@align(16) @size(64)` on the member of a bare
  array with the same text (the stride rule is on the element), and reports the padded struct's
  offsets as exactly the ones `reflect()` gives, checked by hand on nine shapes. Chromium 153 —
  what `gate:compile` launches when `TYPESHADE_CHROMIUM` is unset, and what CI installs — HAS
  that feature and accepts the unpadded form. So the padding is not justified by "every driver
  refuses it": it is justified by emit and reflection agreeing, and by the module running where
  the relaxation is absent. A green compile gate is not evidence for it;
  `src/compiler/ts/uniform-layout.test.ts` and the `emit-reflection-conformance` sweep are.
  `examples/uniform-array.shade.ts` runs on both halves of the gate as the two-target example.

  **What the padding cannot reach is refused, not emitted.** A list of lists needs the rule at
  both levels and has one member to carry the attribute; a bare list as the whole binding has no
  member at all, and `reflect().uniforms` describes nothing for it; and one struct bound as both
  a uniform and a storage buffer would have its storage half's bytes moved by padding the
  uniform half. Each is refused naming the shape and the fix, and a list of `vec4` is exempt
  from all three.

  **Three shapes a struct used to hide.** A field's type does not say which address space it
  lands in, so each of these reached a backend as text a driver refuses: `bool` in a `uniform`
  or `storage` struct (`type 'bool' cannot be used in address space 'uniform' as it is
non-host-shareable` on both builds, and silently emitted into the std140 block by the GLSL
  writer — a divergence between the targets, not a shared failure), a runtime-sized `array<T>`
  that is not its struct's last field, and a runtime-sized array in a uniform. All three are
  `TS8051`. Separately, `array<T, 0>` and a negative or fractional length are refused at the
  type as `TS8002`, wherever written. A `bool` local, parameter or return is untouched: the
  rules are about host-shared bytes. `@size` and `@align` stay refused as author attributes,
  because applying them would mean teaching the layout engine `reflect()` shares with the GLSL
  writer to read them, and a half-applied attribute is the disagreement this change closes.

- **`enable`, `requires`, and the built-in values behind an extension** (§50,
  [#146](https://github.com/typeshade/typeshade/issues/146)). WGSL puts
  some built-in values behind an `enable` extension, and writing the id is now the whole
  declaration: `@builtin("clip_distances")` derives `enable clip_distances;`, the neutral
  capability `clipDistances` on `reflect().requiredFeatures` and the host feature
  `clip-distances`, and `@builtin("primitive_index")` the same for `primitiveIndex`. Both were
  previously unreachable or silently wrong — `clip_distances` was admitted by name with no
  stage rule and no size rule, so it sat on a fragment input and emitted WGSL Tint refuses
  (`use of '@builtin(clip_distances)' requires enabling extension 'clip_distances'`). Each id
  now carries its stage, direction and type at the authoring line: `clip_distances` is a vertex
  output of `array<f32, N>` with N from 1 to 8, `primitive_index` a `u32` fragment input, and
  the subgroup pair is accepted on a fragment entry as well as a compute one, which the spec
  always gave it. All four fail closed on GLSL ES 3.00, which has no row for any of them. The
  two extensions no use can derive have an author spelling at last: a `"enable subgroups"`
  string directive beside `"use typeshade"`, whose vocabulary is the WGSL backend's capability
  profile — `clip_distances`, `f16`, `primitive_index` and `subgroups` when this landed, and
  `dual_source_blending` since §53 — and whose misspelling is `TS8050` naming that list and
  enabling nothing. The other WGSL axis is reported too:
  `reflect().requiredLanguageFeatures` lists the language extensions a module needs and the
  writer emits `requires <feature>;`, with one row today —
  `readonly_and_readwrite_storage_textures` for a storage texture bound `read` or `read_write`,
  since core WGSL gives one `write` only. Measured against the Tint the compile gate runs:
  `requires readonly_and_readwrite_storage_textures;` is accepted;
  `requires uniform_buffer_standard_layout;` is refused by Chromium 141 and accepted by
  Chromium 153, and is emitted by neither — a `requires` naming a feature an implementation
  lacks is itself a shader-creation error, so it could only narrow where a module runs;
  `@builtin("global_invocation_index")`, `@builtin("workgroup_index")` and
  `@builtin("frag_depth", "less")` are all refused by that Tint, so none of the three is
  admitted and §50 records each with its message. A file that enables nothing emits the bytes
  it always did.

  **The compile gate asks for the features the corpus needs.** An extension-gated id costs a
  device feature, and `requestDevice()` with no `requiredFeatures` gives a device with none —
  Tint then says `extension 'clip_distances' is not allowed in the current environment`, which
  reads like a bad emit and is not one. `scripts/compile-gate.ts` now derives the list from the
  modules themselves (`hostFeaturesFor(wgslBackend, reflect(m).requiredFeatures)`), requests
  what the adapter has and prints what it lacks. `examples/clip-planes.shade.ts` is the new
  evidence: four user clip planes, WGSL-only, compiling on the gate's real Tint.
  `primitive_index` gets no example — `primitive-index` is not among that adapter's features —
  so its emit is pinned by `src/compiler/ts/builtin-values.test.ts`, and its host-feature
  string is the one value here no measurement could confirm. The one existing example whose
  bytes moved is `examples/storage-texture.shade.ts`, which now leads with `requires
readonly_and_readwrite_storage_textures;` for its `read_write` binding; that directive can
  only ever narrow what compiles, since a `requires` naming a feature an implementation lacks
  is itself a shader-creation error, and the feature is present on every WebGPU this compiler
  targets (measured in `navigator.gpu.wgslLanguageFeatures`).

- **The determinism report** (§38, roadmap 0.7 item 22). `compile()` returns `determinism`, the
  operations in the module whose result may differ by driver: a builtin WGSL §15.7.4 gives a
  ULP or absolute bound (`sin`, `exp`, `atan2`, `/`), one inherited from a formula the driver
  may reassociate or fuse (`pow`, `mix`, `fma`, `fract`, the matrix products), a derivative or
  `determinant`, a filtered texture read or gather, an operation the GLSL ES 3.00 spelling may
  answer differently on an input WGSL settles (`ldexp` at `e = 128`, the `pack` builtins at an
  exact half), and every emulated `f64` arithmetic operator and bounded builtin, each with the
  spec's bound in words, its count and the constants, variables and functions it occurs in, in
  first-appearance order. An empty list means every operation has one answer. `accuracyOf(op)`
  answers for one operation, and a structural test requires every intrinsic the compiler can
  emit to be placed in the exact column or the table.
- **Multisampled loads** (§37, roadmap 0.4 item 13). `textureLoad(t, coords, sampleIndex)` on a
  `texture_multisampled_2d<T>` yields one sample as a `vec4<T>`, and on the new
  `texture_depth_multisampled_2d` an `f32`; `textureNumSamples(t)` is the count. The type existed
  and nothing read it. A multisampled texture cannot be used with a sampler (WGSL §6.6.3), so
  every sampling, comparison and gather form is refused in one sentence naming the load. WGSL-only
  under the `msaaTextureLoad` capability the binding already derived, for the depth twin too. The
  element is no longer pinned to `f32`, as the spec parameterises the type by `f32`, `i32` or
  `u32`. `examples/msaa-resolve.shade.ts` runs on the Tint half of the gate.
- **The WGSL-only textures: `texture_1d`, `texture_cube_array`, `textureGather`** (§36, roadmap
  0.4 item 12, the second half). `declare const ramp: texture_1d<f32>` is sampled and fetched by
  one number and its size is a `u32`; `declare const envs: texture_cube_array<f32>` samples like
  a cube with the layer after the direction, on every sampling form, and
  `texture_depth_cube_array` compares the same way; `textureGather(component, tex, smp, coords)`
  reads one channel of the four texels a linear filter would blend, as a `vec4` of the
  texture's element, in any stage, with the component first on a colour texture and absent on a
  depth one, and `textureGatherCompare(tex, smpCmp, coords, ref)` returns four pass results.
  GLSL ES 3.00 has none of the three (measured on a WebGL2 driver), so each derives its own
  capability (`texture1d`, `textureCubeArray`, `textureGather`) with a WGSL row and no GLSL row;
  `reflect().requiredFeatures` reports them. An integer cube (`texture_cube<u32>`) is admitted
  now that gather reads it. Each refusal is one sentence: a component outside 0..3 or not written
  in the call, a component on a depth texture, a bias or gradient on a 1d texture, the wrong
  sampler kind. `examples/cube-array-gather.shade.ts` runs on the Tint half of the gate.
- **Cube and 3D textures, bias and gradient sampling** (§35, roadmap 0.4 item 12, the portable
  half). `declare const env: texture_cube<f32>` is looked up by a `vec3` direction and
  `declare const lut: texture_3d<f32>` by a `vec3` coordinate, with the read ids a 2D texture
  already has; `textureSampleBias(t, s, coord, bias)` shifts the implicit level of detail and is
  fragment-only on both targets, `textureSampleGrad(t, s, coord, ddx, ddy)` takes the gradients
  explicitly and is legal in any stage; `texture_depth_cube` is the shadow map of a point light,
  compared by direction. All core in both targets, so no capability. The front end checks each
  coordinate's and gradient's width against the texture's dim and refuses a cube `textureLoad`
  (neither target has one) and an integer cube (only sampled, and sampling is float-only), each
  in one sentence with the read to use instead. `textureDimensions` on a 3D texture is a `vec3u`.
  Measured on Tint and a WebGL2 driver: GLSL ES 3.00 has no `textureLod` for a
  `samplerCubeShadow`, so level 0 there is `textureGrad` with zero gradients, as on the 2D array
  shadow. Reflection's `textureDim` gains `'cube'` and `'3d'`. `examples/cube-env.shade.ts`
  runs on both halves of the gate.
- **Depth textures and comparison samplers** (§34, roadmap 0.4 item 11). The texture a
  shadow map is, read by comparison: `declare const shadowMap: texture_depth_2d`,
  `declare const shadowSmp: sampler_comparison`, then
  `textureSampleCompare(shadowMap, shadowSmp, uv, ref)` yields how much of the filter footprint
  passed, as an `f32`; `textureSampleCompareLevel` is the any-stage form at level 0, and both
  take a `texture_depth_2d_array` with the layer before the reference. Portable, unlike a
  storage texture: WGSL keeps two bindings and puts the comparison on the sampler, GLSL ES 3.00
  fuses them into one `sampler2DShadow` and folds the reference into the coordinate, and the
  header declares the precision a shadow sampler has no default for. A depth texture and a
  comparison sampler are each their own IR kind, so the two sampler kinds cannot be read as one
  another by accident; the front end refuses both pairings, and a comparison in a compute entry,
  in the words Tint would use a step later, and `tsc` refuses them independently through the
  ambient lib. Reflection carries `textureDepth` and `samplerComparison` for the host's
  `sampleType: 'depth'` and `type: 'comparison'`. A plain read of a depth texture is refused for
  now with the reason: on GLSL the fused sampler's type is decided by the read, so a texture
  read both ways needs separate samplers, a capability for a later item. Measured on Tint and on
  a WebGL2 driver, both of which take every accepted shape and refuse every refused one.

- **Storage textures and `textureStore`** (§33, roadmap 0.4 item 10). An image a shader reads and
  writes by texel coordinate, with no sampler and no filtering:
  `declare const dst: texture_storage_2d<"rgba8unorm", "write">`, then
  `textureStore(dst, at, vec4(...))`. The format and the access mode are part of the type, as
  they are in WGSL, and are written as string literal types, so `tsc` checks a mistyped format
  in the editor and a conditional type in the ambient lib gives the texel its format's own kind:
  a `"…uint"` format stores a `vec4u`, a `"…sint"` one a `vec4i`, every other one a `vec4`. A
  storage texture is its own IR kind rather than another `dim` on a sampled texture, so every
  site that has to decide between them fails to compile until it does. Reflection carries
  `storageFormat` and `storageAccess` in WebGPU's spelling, which a host's bind group layout has
  to repeat exactly. WGSL-only: GLSL ES 3.00 has no image load/store — that is ES 3.10 — so the
  new `storageTexture` capability fails a module closed on that target, the way a storage buffer
  or an atomic does.

  **Two refusals Tint does not make, because Tint compiles a shader and a device binds one.**
  Asked directly, Tint accepts every format at every access mode; a device asked to build a bind
  group layout for each pair accepts `"read_write"` at `"r32uint"`, `"r32sint"` and `"r32float"`
  only, and accepts no format outside the sixteen core ones without a feature request. Both were
  measured rather than read off a spec. Either spelling would otherwise pass the compile gate and
  then fail at `createBindGroupLayout` — a wrong program emitted without a diagnostic, which is
  the shape [#113](https://github.com/typeshade/typeshade/issues/113) was.

- **A generic class, by monomorphisation** (§32, roadmap 0.3 item T9,
  [#92](https://github.com/typeshade/typeshade/issues/92)). A WGSL or GLSL struct is one layout,
  its fields' types fixed, so `class Slot<T>` written at `f32` and at `vec3` is collected twice:
  `Slot_f32` and `Slot_vec3` are separate structs, each with its own constructor and its own copy
  of every method. Nothing called `Slot` is emitted, and a generic class nothing writes emits
  nothing at all. The instances are read off the source rather than discovered as the lowering
  runs, because a struct has to exist before anything is lowered against it; every use is a type
  node, an `extends`, or a `new`, so one walk finds them all. A type argument may itself be an
  instance (`Box<Box<f32>>`), and a class inside a namespace is reached by its dotted name
  (`N.Pair<f32>`). Alongside it: a type parameter's default is read the way TypeScript reads it,
  so `class Level<T = f32>` makes `Level` and `Level<f32>` one struct; a `new` may leave its type
  arguments to inference, answered from the instances the file writes, with one sentence naming
  the fix when several are in play; a static is one function under the class's own name, since
  TypeScript refuses a static that mentions the class's type parameters; and `extends Slot<f32>`
  now inherits that instance, where a base with type arguments used to be refused outright with
  "one declaration per argument set" as the reason. `examples/generic-class.shade.ts` carries the
  surface on both targets.

### Fixed

- **The Vite plugin keeps a module's `diagnostic(...)` directive** (surface §54). An entry with
  `@diagnostic("off", "derivative_uniformity")` samples a texture under a branch its invocations
  do not share, and `compile()`'s WGSL carries `diagnostic(off, derivative_uniformity);` for it.
  The module the plugin writes for a `.shade.ts` lost it: in a build, the manifest the program
  runtime creates the pipeline from; under `vite dev`, that manifest, its console-recording
  variant and the recorded WGSL a host call of the entry draws with. WebGPU refuses that WGSL,
  on a program `compile()` and the language service accept. The plugin's host face now carries
  the directives as `compile()` does, and `src/vite.test.ts` holds each of them to `compile()`'s
  directive, in a build and under `vite dev`.

- **`tshc` runs on Windows** (#384). `tshc check` and `tshc sync` said "no file or directory"
  for every path, since the command joined the working directory, `D:/work`, into `/D:/work`,
  which names nothing on a drive. A path on a drive now keeps its drive; `D:/`, `D:\` and a path
  that starts with `/` on the working directory's drive are absolute; `\` separates the segments
  of a path on a drive; and paths still print relative to the working directory. Off a drive a
  backslash stays a character of a name, as POSIX has it. `tshc --version` read the package's
  manifest from `/D:/...` too, and printed `unknown`. `src/cli/run.test.ts` drives the command
  from `D:/work` with relative, `D:/` and `D:\` paths, an import, and `sync`.

- **The program runtime lays out a multisampled `f32` texture as `unfilterable-float`** (Rule
  11.11). It gave every `texture_2d<f32>`-like binding `sampleType: 'float'`, and WebGPU refuses
  that on a multisampled texture, which no sampler filters: a render pipeline that loads a
  `texture_multisampled_2d<f32>`, as `msaa-resolve` does, could not be made. `unfilterable-float`
  takes every float format. `src/runtime/runtime.test.ts` holds the layout of a multisampled
  colour texture, a multisampled depth texture and a sampled one.

- **A module written with `fn()` has its GLSL and its vertex layout in its manifest** (Rule
  11.10). `buildManifest` read each entry's stage from the `stage` field, and a `fn()` handle,
  which is what `module()` puts in `funcs`, has none: its stage is in `attrs`. `stageOf`, which
  every other stage decision goes through, reads either. So each of the 34 examples assembled
  from `fn()` entries had no `glsl` pair in its manifest, though the GLSL ES 3.00 writer spells
  it. A module of `fn()` entries with a vertex input also lost its vertex layout, which
  `reflect()` reports. The manifest builder and `vertexLayoutOf` now read `stageOf`.
  `src/core/manifest.test.ts` holds, over every example, that the pair is there exactly when the
  module has an entry of each stage and the writer spells them. It also holds a `fn()` module's
  vertex layout to `reflect()`'s.

- **The editor takes vector arithmetic written as a texture read's argument** (Rule 12.7, #387).
  `textureSample(hdr, smp, p.xy / size)` compiled, but the editor reported TS2769, "No
  overload matches this call". TypeScript reports the first argument the last overload refused,
  here the texture, and the rule that drops TS2769 on vector arithmetic gave up on an argument
  that is not a vector. The whole-signature test now decides, every argument included, so a
  coordinate of the wrong size or the wrong sampler is still refused in both halves. The engine
  journey's tonemap pass writes the call inline again.

- **A storage array of vectors or structs indexed with an `i32` has GLSL** (#388). WebGL2
  reads a storage array from a data texture, and an element's first lane is its index times the
  element's stride, a `u32`. An index written as a literal (`vs[0]`, `ls[1].b`) or held in an
  `i32` made that product `i32 * u32`, which the module validator refuses. `compile()` gave the
  WGSL and no GLSL, with a `TS8015` warning in the validator's words. The index is now converted
  to `u32` first. The five shapes, and their `u32` neighbour, compile and link on WebGL2.

- **A kernel loop's row-major write runs on the GPU only with one width for the whole loop**
  (Rule 8.22, surface §65, #398). R3 takes a write at `i*W + x` over a nested loop of `x` below
  `W`, and the proof checked only that the width at the index and the inner loop's bound were
  the same expression. It accepted a width that changes from row to row, such as
  `out[y * (h - y) + x]` over `x < h - y`, or the same through a const the body declares. Rows of
  different widths overlap, so two invocations raced on one element: rows 0 and 1 both write
  `out[3]` when `h` is 4. It also accepted a const whose initializer reads a `let` set again
  before the loop (`const W2 = s * w; s = 2;`), and compared that initializer with the bound as
  if `s` had not changed. Each now runs on the CPU with TS8070. The proof now reads a row-major
  index through constants, as it already read `a*i + c`, so `const at = y * w + x; out[at] = …`
  and `out[row + x]` over `const row = y * w` now run on the GPU as `out[y * w + x]` does. The
  metamorphic tests of #350 found that they were refused.

- **Surface §38 no longer says an empty determinism report means one answer on every driver**
  (#378). WGSL lets a driver regroup a chain of operations (§15.7.5, "An implementation may
  reassociate operations"), and SwiftShader computed `(x + 1e8) - 1e8` as 2, where the expression
  as written gives 0 in `f32`. The report still reads one operation at a time. §38 now says that
  an empty list means each operation has one answer on its own, and names regrouping as the room
  outside the report, with the measurement.

- **A `clamp` whose constant bounds cross, and an `f32` constant expression past the range, are
  refused where they are written** (Rule 12.6, surface §22 and §52, #373, #374). Tint refused
  both, and `compile()` accepted both:
  - `clamp(x, 5, 2)`, and the same pair through module or local consts, compiled as
    `min(max(x, 5u), 2u)`, since #372 writes a pair the optimizer makes constant that way. It is
    now TS8003, which gives the value of a const bound and the component of a vector pair:
    `Crossed clamp bounds: the low bound 5 is above the high bound 2 on every invocation.`
  - `y + 1e30 * 1e30`, `const K: f32 = 1e30 * 1e30`, and `K * K` over `const K: f32 = 1e30`,
    reached Tint as a value no `f32` holds. Each is now TS8003 in the sentence a literal past
    the range gets, `"K * K" is about 1e+60, outside the range of f32 (about ±3.4e38)`.

  Both fold as the zero-divisor proof does. A float value is refused only where both of WGSL's
  readings leave the range or cross, exactly and in `f32` steps, so `clamp(y, 1.00000001, 1.)`
  and `1e38 * 3.4028234` compile as Tint compiles them. Each was measured on Tint with its valid
  neighbours, and each test reads both halves: `compile()`'s diagnostics and the language
  service's.

- **On WebGL2, an integer division, remainder and shift, and a float's conversion to an integer,
  give WGSL's answer on every input** (proposal 0027, Rule 11.12, surface §11 and §22, #382). The
  GLSL writer spelled each with the bare GLSL operator, and GLSL ES 3.00 gives some inputs no
  result. ANGLE answered otherwise than WebGPU and the CPU tier: `7 / 0` was -7 where WGSL gives
  7, `-7 % 3` was 2 where WGSL gives -1, and `i32(3e9)` was the least `i32` where WGSL saturates
  to 2147483520. So `i % n` over a negative `i` meant one thing on WebGPU and another on WebGL2.
  The GLSL writer now spells:
  - an integer `/` and `%` by a run-time divisor through `_idiv`, `_irem`, `_udiv` and `_urem`;
  - a shift by a run-time amount with the amount masked, `& 31u`;
  - a float's conversion to an integer through `_f2i` and `_f2u`, which saturate and turn NaN
    into 0.

  Each helper is written once per type the module uses. The bare operator stays for a literal
  divisor no input makes undefined and for a literal shift amount. The GLSL of 25 examples'
  goldens changes. The GPU differential's WebGL2 arm now holds these inputs to the oracle: over
  the 48 seeds CI runs, 47 816 values that reach one agree bit for bit.

- **The two examples drawn in several passes draw the same picture on WebGPU as on WebGL2**
  (change 0026). `feedback-trail` and `separable-blur` read a pass's output through `uv`, a
  varying computed from the clip-space position, which runs up the screen on both backends. A
  texture's rows run down from the top on WebGPU and up from the bottom on WebGL2, and a pass
  writes each pixel where its position says on both, so on WebGPU the texture came back upside
  down: the trail pass read its frame before mirrored on every frame and drew the dot's path
  beside its mirror image. Both now read a pass at the pixel's own position, as
  `textureLoad(trail, vec2i(v.pos.xy), 0)` or as the position over the resolution, and
  `examples/README.md` says so.
  The compile gate's passes leg drew each graph on WebGL2 alone; it now draws each on WebGPU too
  and holds frame 30 to WebGL2's.

- **The oracle's `abs` and negation of the least `i32` are that value itself, as on both
  targets** (Rule 1.3, surface §45). 2^31 has no `i32`, so `abs(-2147483648)` and
  `-(-2147483648)` wrap back to `-2147483648` on WebGPU and WebGL2 (wgsl.txt:21451-21453). The
  interpreter, the generated CPU code and the stepper answered `2147483648`, a value no `i32`
  holds: `max(2, abs(i32(u)))` over `u = 2147483648` was 2 on WebGL2 and 2147483648 on the CPU.
  A builtin is handed plain numbers, and the `f32` of the same magnitude has the real
  `+2147483648` answer, so each CPU walk now wraps an integer-typed builtin's result and a
  negation by its IR type. The GPU differential's GLSL arm (#349) drew it; the row #154 had left
  as an `it.fails` now passes.

- **A name that contains `$` is refused on its declaration** (Rule 3.2, surface §62, #376).
  TypeScript takes `$` in an identifier and WGSL does not, so `function scale$()` compiled with
  no diagnostic and Tint refused the module with `invalid character found`. Rule 3.2 required
  the refusal, and Appendix B listed it as not enforced. It is now `TS8068` on the declaration,
  in the compiler and in the editor alike, for a struct, a field, a binding, a module constant,
  a function, a parameter and a local:

  ```text
  "k$" contains "$", which a WGSL identifier cannot hold, so a local of that name cannot be
  emitted for the WebGPU target. Rename it.
  ```

- **A runtime-sized array's length on WebGPU is the length the host passed** (Rules 8.21, 8.24
  and 11.11, #367). The call layer packed a storage binding padded to a multiple of 16 bytes and
  bound the buffer whole, and the program runtime bound the buffer its pool had rounded up.
  WGSL's `arrayLength` is the bound size over the stride, so five `u32`s were an array of 8 to
  the kernel:

  ```ts
  export function stamp(out: array<u32>) {
    for (let i: u32 = 0; i < out.length; i++) { out[i] = out.length; }
  }
  ```

  `stamp(new Uint32Array(5))` wrote `[8, 8, 8, 8, 8]` on WebGPU and `[5, 5, 5, 5, 5]` on the CPU
  tier, and `bins[ks[i] % bins.length] += 1` over five bins lost the counts of the three it
  thought were past the fifth. An array whose byte size is a multiple of 16 was right, which is
  every array the journeys passed. A storage binding's bytes are now its data and no more, in a
  kernel call, an entry call, a draw and a `Resident`, and the program runtime binds a pooled
  buffer at its data's size. A uniform's bytes stay padded to 16. The GPU differential of #349
  found it: its own harness padded buffers the same way.

- **`compile()` emits no constant expression Tint refuses** (Rule 1.1, #368). WGSL evaluates a
  constant expression when it creates the shader, and refuses some that have an answer at run
  time. Each of these compiled with no diagnostic, and Tint refused the WGSL:

  ```ts
  data[1] = 7 / (x - x); // (7u / 0u): integer division by zero is invalid
  data[1] = y << ((x - x) + 33); // (y << 33u): shift left value must be less than the bit width…
  data[1] = x + (S << 31); // const S: i32 = 3: shift left operation results in sign change
  data[1] = clamp(x, (y - y) + 5, (y - y) + 2); // clamp called with 'low' (5) greater than 'high' (2)
  ```

  The optimizer folds `x - x`, `x ^ x` and `x * 0` to 0 on an integer, so the first, second and
  last lines were refused at the default level, O2, only. An operation over constants whose
  value its type cannot hold was refused at every level over a module `const` (the third line,
  and `M / -1` and `M % -1` over `i32`'s most negative value), and at O0 and O1 over literals,
  which O2 folded (`i32(2147483647) + i32(1)`); `u32(n)` of a negative local `const n` was
  refused at O1. A float constant converted to an integer divided by zero too: `u32(K)` of a
  module `const K: f32 = 0.5` at every level, and `u32(k)` of a local `const k: f32 = -0.25`
  at O2. Each emit now writes the value the target computes at run time, which is the
  value the CPU oracle already gave: `a / 0` is `a` and `a % 0` is 0, a shift amount keeps its
  low five bits, the operation over constants is its wrapped value, and a `clamp` whose
  constant bounds cross is `min(max(e, low), high)`. A module Tint accepted emits the same
  bytes. GLSL ES 3.00 gets the same answers: ANGLE compiled `(7u / 0u)` with a divide-by-zero
  warning and a value of its own. The generated-kernel differential of #349 found the first
  line on Tint.

- **An integer vector the optimizer folds to zero compiles** (#370). `(v - v).x`, `(v ^ v).y` and
  `(v * 0).x` over a `vec2u` failed with `TS8015`, whose text names the cause:
  `SD0017: literal cannot be spelled by the target`. The fold's zero was a vector-typed literal,
  which no target spells; it is `vec2<u32>(0u, 0u)` now.

- **Each scatter of a kernel function runs its own operator's atomic on WebGPU** (Rule 8.22). A
  kernel function whose loops combine one integer array at any index with different operators
  ran every loop's combine as the last loop's atomic:

  ```ts
  for (let i: u32 = 0; i < ks.length; i++) { bits[ks[i] % bits.length] &= ks[i]; }
  for (let i: u32 = 0; i < ks.length; i++) { bits[ks[i] % bits.length] |= 1; }
  ```

  The first loop's `&=` was dispatched as `atomicOr`. It set the bits of `ks[i]` where the program
  keeps only those bits. The CPU tier ran it as written. The lowering recorded one operator per
  array, the last it saw; each write now takes its own. The generated-kernel differential of #349
  found it.

- **A kernel loop may read the length of the array it writes** (Rule 8.22, #345). This loop ran
  on the CPU with `TS8070`, "line 5 reads "out", which another iteration writes":

  ```ts
  for (let i: u32 = 0; i < out.length; i++) { out[i] = f32(out.length); }
  ```

  `out.length` lowers to `arrayLength(out)`, which reads the length the host fixed when it bound
  the buffer and no element, and the proof read it as a read of `out`. It is a GPU kernel now, one
  dispatch, and Tint (Chromium 141) takes the WGSL it lowers to, which reads `arrayLength(&out)`.
  A read of an element the loop writes at another index is refused as before. The Rule 7.5 bound
  check had the same bug, fixed on its own ("A loop can write the array whose length bounds
  it", below).
  - What a builtin does with each argument is written once now, in `src/core/passes/access.ts`:
    the array `arrayLength` measures, an atomic's place, and the texture `textureStore` writes a
    texel of (#348). The bound check, uniformity and the kernel lowering each skipped inside
    `arrayLength` by hand, and the proof knew the atomics by name; all four ask the table.
  - `src/core/spec-conformance/argument-access.test.ts` holds the table to every overload of
    Tint's `core.def` that TypeShade takes, so a builtin that takes a pointer cannot arrive
    without an answer.

- **A struct member of a uniform sits where `reflect()` says** (§51's rule, extended from arrays
  to structs). In the uniform address space, WGSL aligns a member of struct type to 16 and
  starts the next member at least 16 bytes further on. `reflect()`'s std140 layout already
  reported those offsets, but the emit did not write them.
  - A uniform `interface U { k: f32; inner: In }` put `inner` at offset 4 against `reflect()`'s 16.
  - A `vec2f64` field, which the f64 emulation makes a `DF64Vec2` struct, landed at offset 8.
    Tint (Chromium 141) refused it with `the offset of a struct member of type 'DF64Vec2' in
address space 'uniform' must be a multiple of 16 bytes`, and a host that packs by
    `reflect()` would write bytes the shader read elsewhere.
  - The uniform layout pass now writes `@align(16)`, and `@size` rounded to 16, on such a
    member. The fp64 examples' WGSL goldens gain `@align(16)` on their `vec2f64` uniform
    members.
  - A struct bound as both a uniform and storage whose member would move is refused, as its
    padded arrays already are.

- **A fragment entry that takes its position in a struct marks its console lines with the pixel
  on the CPU, as it does on the GPU** (surface §66; design rule 11.9). `compile().eval` and a
  debug session looked for the invocation of a `console.*` event only in a parameter that takes
  `global_invocation_id` or `position`, so `fs(v: VsOut)`, whose position is a field of its
  input struct, delivered its lines with no `invocation`, where the same call decoded from the
  GPU carries `[x, y, 0]`: the recorded WGSL reads `v.pos`. The CPU now reads the builtin where
  the recorded WGSL reads it, from the parameter that takes it, else from the struct field that
  carries it.

- **The `TS8072` refusal of a package names the file once** (design rule 3.9; surface §68). For a
  specifier with a path after the package, the relative path it suggests took the last segment
  whole and added `.shade.ts`, so `import { fbm } from "shade-noise/noise.shade.ts"` was told to
  write `"./noise.shade.ts.shade.ts"`. The suggestion now leaves the segment's extension and a
  `.shade` off first, and says `"./noise.shade.ts"`; `"shade-noise"` still suggests
  `"./shade-noise.shade.ts"`, and `"#noise"`, a package's import map, suggests `"./noise.shade.ts"`
  where it suggested `"./#noise.shade.ts"`. `src/compiler/ts/link.test.ts` pins both halves on a
  subpath, a scoped package written with `.js` and a `#` specifier.
- **One mistake is one diagnostic where two passes both refused it, in `compile()` and in the
  editor** (proposal 0008 §3; design rule 12.4; surface §28 and §32). `semantic.ts` refused
  `for…in`, `try`, `throw`, `await`, `yield`, a template string and a spread, and the lowering then
  reached its catch-all and added `TS8099 Unsupported statement` or `Unsupported expression` about
  the same node; `throw new Error("neg")` read as four diagnostics in `compile()` and five in the
  editor. `semantic.ts` now records the nodes it refuses, per file, and the lowering's catch-alls
  leave those to it; a node the record does not hold still gets the catch-all, so no statement is
  dropped in silence. What a refused `throw`, `await`, `yield`, template string or spread holds
  is not read again, so `throw new Error("neg")` is one `TS8013`, and so is `await g(...xs)`,
  `await new Date()`, `yield await a` and a tagged template holding an `await`.
  The editor's merged list drops TypeScript's report of what the compiler refused whole: inside
  a refused `throw`, `await`, `yield`, template, spread, async function or generator, or a
  statement a namespace refuses whole (`Cannot find name 'Error'`, TS1308 on an `await`, TS2556
  on a spread argument, TS2322 on `export let T: array<f32, 3> = [...A, 3.]` in a namespace),
  about a value that holds one (TS2322 on a list with a spread, in a local, a field, a static
  field or a default), a global type TypeScript cannot find for such a form (TS2318, `Promise`), TS1103 on
  a refused `for await`, TS2407 on a scalar or a bool a refused `for…in` enumerates
  (`for (const k in 1.)`), and TypeScript's type of the rest element of a list the compiler
  refused as an assignment target. A class whose `extends` writes a base with its own type
  parameter, `class D<T> extends B<T>`, is that `TS8002` alone, where it was followed by `TS8010
"D<f32>" extends "B_f32"` naming the emitted struct, `TS8010` "has no fields" of a class whose
  base has one, `TS8035 "D" declares only static members … Call "D.f(...)"` at its `new`, and
  `Unknown field "x"` at a read of what the base would have given it. So `throw new Error("neg")`, `await fetch(a)` and an
  `async function` are one diagnostic in the editor too, where they were two or three.
  A `var` is refused once: `TS8013` in a body, and `TS8014` at the top level and in a namespace,
  in `compile()` and in the multi-file path alike. One in a body is lowered as the `let` it would
  have been, where the lowering refused it again with `TS8099`, and a `var` override is read as
  the `const` it is. A `var` that declares a parameter or an earlier `var` again is that
  variable, as JavaScript has it, where lowering it as a `let` added `TS8023 Duplicate binding`;
  a sentence about the declaration quotes it as written, `"var b" needs an array type annotation
to take a list, e.g. let b: array<f32, 2> = [...].`, where it quoted `let b`. A use of the name
  says nothing more wherever the `var` is written: `refused-names.ts` finds a `var` anywhere in
  the function around a read, as TypeScript scopes it, and `N.x` and `N.M.x` for a variable a
  namespace was refused no longer add `Unknown identifier "N"`; in the editor, TypeScript's
  TS2454 at a read after the block and its TS2403 on a redeclaration go too.
  An `async` function or a generator is one diagnostic on the function wherever it is written,
  in a body no call lowers too, under the code its position had (`TS8013` on a declaration,
  `TS8020` on a function written as a value, `TS8035` on a class's method or on the function a
  class field holds) and with a true reason in place of "TypeShade functions are pure and
  synchronous", "Generators are not TypeShade functions." and "a plain function or nothing: no
  async, no generator": `"h" is async, and a shader function runs to completion in one call:
there is no event loop to wait on. Remove "async" and each "await".` When the return type
  written is the wrapper, `Promise<f32>` or `IterableIterator<f32>`, the remedy names the type
  to write, `…, and write its return type as f32.`, where following it left a `Promise<f32>`
  the compiler refuses as a type. A mixin's method is named on the class that applies it, `"TD.m"`. Its
  `await` and `yield` add nothing, its body is not lowered, and a call of it is silent: `h(a)`,
  `N.h(a)`, one through an import, `c.m()`, `C.s()` and a mixin's `t.m()`, where these added a
  false `"N" has no function "h"` or `"TD" has no method "m"`; so is a local declared from one,
  `const y = h(a)`, where a read of `y` added `Unknown identifier "y"`. An object literal's async
  method is the literal's one refusal, where its `await` added `TS8013`.
  An interface or an object-type alias inside a namespace is refused once, where the same
  `TS8014` came twice on one span, and a type that names it, `N.I`, adds nothing, where it added
  `TS8002 "N.I" names no struct this file declares`.
  A spread in a list is refused wherever it is written, before the list is counted or asked for
  its type, and names the elements to write when the lowering reads its operand as a vector or an
  array of fixed length: `"...a" spreads a list into a list, which a shader array does not do:
write its elements, a[0], a[1].` (a vector's are `v.x, v.y, v.z`; a long array's `a[0], a[1],
…, a[7]`). Otherwise (a struct, a scalar, a body no call lowers, a namespace's constant, which
  reads no other by its short name) it is `"...s" spreads into a list, which a shader array does
not do: write the elements one by one.` It was `TS8013` "Spread is a JS runtime operation."
  beside `TS8099` "An array literal element must be a value", or beside a count sentence naming
  an arity the author never wrote. The name the list initializes says nothing more where it is
  used, a static field `C.K` included, where it added `"C" has no static field "K"`. A spread
  argument, `f(...args)`, keeps its sentence, once, and `...q` in a list assigned to,
  `[p, ...q] = a`, is the target's `TS8018` alone.
  A generic interface or object-type alias that something uses, directly or through a plain alias
  (`type GF = G<f32>`), is one `TS8010` naming the spelling §32 collects per instance, `"G" is a
generic interface; a generic struct is written as a class, class G<T> { x: T } (surface
§32).`, in place of the "no single set of field types" reason §32 retired and the `TS8002 Type
arguments are not supported yet` at each use. Nothing that names `G<f32>` adds to it: a
  parameter or a return of a function, a method, a static function, a constructor or a function
  a field holds, and a call, a `new` or a local declared from one, in the file that declares it
  or one that imports it (which said `"lib.ts" has no function "h"`); a local, a module constant
  or variable, a binding that holds one or an array of them (which said `Cannot index
struct:array`), and an `as`; and a field of a class or an interface, which a literal of it
  leaves out (it said `Struct H has no field "g"` or `Object literal { x } does not match a known
struct`), and a struct left with no other field. A method, a static function or a constructor
  whose signature names a type refused at its declaration, and a static field holding a function
  that `structs.ts` refused, are refused where written, so a call of one adds nothing.
  `honest-refusals.test.ts` pins 107 shapes whole, code and text, in `compile()` and in the
  editor's merged list with TypeScript's entries included, and seven in `compileTsSources`; each
  new pin fails with the source changes reverted. Measured against `main`: the 82 examples, 205
  neighbours of the changed checks and the docs' 66 `"use typeshade"` fences give identical
  diagnostics, WGSL and GLSL; of 202 fences read as shader files, the 36 that differ are host
  code whose top-level statement is now its one diagnostic in the editor too. Every remedy the
  new sentences name compiles and passes Tint. No code is added or renumbered.

- **A loop the compiler does not lower is refused, never dropped; `i = i + 1` is a counted
  step; `while (ON)` is `while (true)`; a loop's hidden counter is the compiler's own name; and
  an `&&` exit names the clause that is not its bound** (proposal 0008 §4 and §6; design rules
  7.5, 7.1, 2.2, 12.4 and 12.6; surface §17).
  A `FOR` WHOSE UPDATE ASSIGNS A MEMBER, AN ELEMENT OR AN UNKNOWN NAME WAS DELETED.
  `for (let i: i32 = 0; i < 16; v.x += 1.)`, `…; xs[0] += 1)` and `…; zz += 1)` compiled with
  no diagnostic, and the whole loop, body and all, was missing from the WGSL and the GLSL, which
  Tint accepted. The first two are now the sentence `v.x++` and `j += 1` already got,
  `TS8008 for-update must be i++ / i += <const>, or i *= / /= <const>.`, and the third is
  `TS8022 Cannot assign to unknown name "zz".`, as `zz++` is: the same sentence, on the name,
  with the remedy #210 gives a misspelled name (`Did you mean "count"?`) or one written above
  its declaration, and nothing more after a refused declaration of it. `lowerFor` keeps the
  invariant: a `for` it does not lower always leaves an error, and one no other refusal
  explains is a `TS8099` that says the loop was refused rather than left out. A header that
  reads a name whose declaration was refused (`i < n` after a refused `declare const n: i32`)
  is explained by that refusal and adds nothing to it (Rule 12.4), in `compile()` and in the
  editor; for `i = i + n` that also drops main's second `TS8099 Unsupported for-update.`. So
  does a header that calls a function whose signature was refused (`i < lim(1)` after
  `function lim(x?: i32)`, a parameter or return type nothing declares, a string, a rest
  parameter, `number[]`, `this: Foo`, an overload), in the bound, the start, the step and an
  `&&` clause: the one `TS8020` or `TS8002` main gives.
  ONE UPDATE MISTAKE, ONE SENTENCE. `i <<= 1`, `i %= 3`, `i = i * 2`, `i++, j++` and `-i` were
  `TS8099 Unsupported for-update.` (or `Unsupported update operator.`), which named no form,
  while `j += 1` was `TS8008`; every update that is none of the counted forms is that `TS8008`
  sentence now (Rule 12.4). `i = i + c`, `i = c + i` and `i = i - c` are `i += c` and `i -= c`
  spelled out, which the counter already read as `i++` lowers to, and they compile (Rule 7.5):
  `for (…; i = i + 1)` emits `i = (i + 1)`. The sum is typed as the same assignment in the
  body is (Rule 7.1): `i = i + 2.`, `i = i + f32(2)`, `i = i + u32(1)` and `i = i + s` for a
  `u32` `s` on an `i32` counter are the body's
  `TS8003 Type mismatch: cannot + i32 and f32 — no implicit int/float conversion. …` or
  `… cannot + i32 and u32 — WGSL has no implicit integer conversion. …`, where the header alone
  would have lowered the step, retyped it to `i32` and dropped the conversion the author wrote.
  `WHILE (ON)` NEVER ENDS, AND SAYS SO. `const ON = true; while (ON) { … }` with nothing that
  leaves it compiled with no diagnostic, a loop that never ends, where `while (true)` was
  `TS8007`. The loop's check now folds a module constant, a namespace's and a static readonly
  (`ON`, `N.ON`, `C.ON`), a local `const` copied from one, and `!`, `&&`, `||` and a
  comparison over constants (`!PAUSED`, `!false`, `ON && ON`, `N > 0`), so each is the same
  `TS8007`, naming the condition as written:
  `while (!PAUSED) has no break or return in its body, so it never ends. Leave it with a break, or write the exit into the condition.`
  A comparison of floats is folded only over literals and module constants that f32 holds
  exactly, with no arithmetic between (`while (H > 0.)` for `const H = 0.5` is `TS8007`),
  because both targets compute it in f32: `const A = 0.1; const B = 0.2;` then
  `while (A + B > 0.3)` is false there and the loop runs no trip, as `X > 16777216.` over
  `16777217.`, `E > 0.` over `1e-46` and `A + B !== C` are, and each compiles as on main. A
  `?:`, a call, a float comparison over arithmetic or a local (`H + H > H`), or a local `const`
  holding one of those (`const go = !OFF`) is still read as a runtime condition, as Appendix B's
  Rule 7.5 row records. The fold is the loop's own: what a `const` is given as its value, and so
  what a module constant emits, is unchanged.
  A `WHILE` CONDITION IS A `BOOL`, AS AN `IF` OR A `FOR` CONDITION IS. TypeScript reads any value
  there by its truthiness, and `while (k)` on an `f32`, `while (u)` on a `vec3u`, `while (a)` on
  an array, `while (new P())` and `while (E.A)` compiled with no diagnostic, and Tint refused the
  module (`for-loop condition must be bool, got f32`). Each is `TS8003` on the condition, naming
  its type as written, with the spelling that says a number's or a mask's truthiness:
  `while condition must be bool, got f32. Compare it with zero: while (k !== 0.).`, and
  `Reduce it: while (any(b)) or while (all(b)).` for a `vec2b`; a struct, an array, a vector of
  numbers or a constant is told its type alone.
  A LOOP'S COUNTER IS NOT A NAME THE SOURCE CAN REACH (Rule 2.2). A `while` counted with an IR
  local written as `_w` outright, so an author's `_w` in the function, or a second `while`,
  failed in the backend as `TS8015 … '_w' is declared more than once in fn 'main'`, anchored on
  the `"use typeshade"` directive. A `for…of` bound its counter `_i` as a source name, so an
  author's `let _i: u32 = 7` read inside the body read the counter instead, with no diagnostic
  (`s += y + f32(_i)` summed 16 where the program says 38), and `for (const _i of xs)` was
  `TS8023 Duplicate binding`. And a counter named after an author's `function _w`, `function _i`
  or `class _w` hid it from the loop's body, so Tint refused the module
  (`cannot use 'var _w' as call target`, `… as type`) and the compiler said nothing. Both
  counters, like every temporary the lowering names, take a name no local, module constant,
  binding, function or struct has, and bind no source name: `_w_1` and `_i_1` when the name is
  taken, an author's `_i` is the author's, and an `_i` nothing declares is `TS8022`, as the
  editor's `TS2304` already said.
  AN `&&` EXIT IS TOLD WHICH CLAUSE IS REFUSED. `for (let i: i32 = 0; i < 8 && i !== 3; i++)`
  was `TS8006 for exit must compare "i" to a bound`, which it does. It is now
  `TS8006 for exit joins the bound "i < 8" with "i !== 3", and a counted loop's exit is its bound alone. Make "if (i === 3) { break; }" the body's first statement, or write the loop as a while.`
  The bound may stand on either side; the extra clause is negated as one comparison only where
  that is exact (an equality, or an ordering of integers), as `ok` for `!ok`, and as `!(…)`
  otherwise, since `!(x > 0.)` is not `x <= 0.` for a NaN; a clause keeps the parentheses that
  make it one clause (`i < 8 && (a > 0 || b > 0) && c > 0` is told
  `"(a > 0 || b > 0) && c > 0"` and `if (!((a > 0 || b > 0) && c > 0)) { break; }`); and an
  unannotated counter takes its type from the clause that compares it, so
  `i < data.length && data[i] > 0.` gets this sentence and not `cannot compare i32 and u32`.
  Every remedy the sentence names compiles, Tint accepts it, and on the CPU it runs the trips
  of the header written as a `while`, for every input a test tries.
  MEASURED. On main, the member, element and unknown-name updates, `while (ON)`, `while (C.ON)`,
  `while (N.ON)`, `while (!PAUSED)`, `while (!false)`, `while (ON && ON)` and `while (N > 0)`
  gave no diagnostic; an author `_w`, two or nested `while` loops and an author `_i` failed in
  the backend or read the wrong value, and an author `function _w` or `function _i` called in
  the loop gave a module Tint refused. 450 valid programs (the neighbours of every change, all
  examples and journeys and all `"use typeshade"` fences of the docs) give the same
  diagnostics, WGSL and GLSL on main and here, except those main refused or handed Tint a module
  it refused. Measured again after #210: the 89 examples and journeys, the 66 docs fences and
  192 neighbours are identical, the 78 programs of this change that compile pass Tint, and a
  loop that reads a refused declaration is that declaration's one diagnostic in each of the 11
  shapes probed, where main gives two for a spelled-out step (`i = i + n`). Measured again for
  the review: 51 headers that call a function with a refused signature, or a refused class,
  namespace, method, generic or constant, give main's one diagnostic in `compile()` and in the
  editor; of 40 `while` loops on float, integer and bool constants, which main all compiles,
  33 compile identically here and the 7 that never end on either target are `TS8007`, and
  Tint's `const_assert` gives the f32 answer this fold now gives where doubles differed. The
  emit goldens and the API surface did not move. In one case a valid program's emit moves: a
  temporary whose name a function or a struct of the file already has, where nothing in its
  scope reaches that function or struct, takes the next free name (`_w_1`).

- **An operator is checked by the kind of its operands, a bool vector stays out of a binding,
  and a decorator nothing reads is refused** (proposal 0008 §4; design rules 6.7, 6.8 and 7.1;
  surface §1, §4, §7, §27 and §51). Each of these compiled with no diagnostic and then failed in
  Tint, or was silently not the program written (Rule 12.6).
  AN OPERATOR TAKES THE KINDS WGSL GIVES IT. The lowering checked that two operands had one
  type and stopped there, so `a + b` on two class instances or two arrays, `<` or `*` on two
  bools, arithmetic on a `vec3b`, `^` on a bool, `&` on two structs or matrices, `===` on two
  matrices, structs or arrays, any operator on a texture or a sampler, unary `-` on a bool, a
  matrix, a struct or an array, and `+`, `-`, `+=`, `-=` or `*=` on a matrix of doubles
  reached Tint as `no matching overload for 'operator + (A, A)'` (or, for a matrix of doubles,
  as a span-less `TS8015` from the fp64 pass). Unary `+` on a struct, an array or a texture
  lowered to the value itself, where TypeScript's `+a` is `NaN`. Each is now one `TS8003` on
  the line, naming the operator and the type as the author writes it, with the spelling that
  works where there is one:
  `Cannot + A: WGSL has no arithmetic on a struct. Write it field by field.`,
  `Cannot ^ bool: WGSL's ^ takes integers, not a bool. Write a !== b, which is the same.`,
  `Cannot === mat3x3: WGSL compares scalars and vectors, not a matrix. Compare it column by column, all(m[0] === n[0]).`,
  `Cannot *= mat3x3<f64>: the fp64 pass lowers the product of two matrices of doubles and not its compound assignment. Write m = m * n.`,
  `Unary "+" is not defined on A; it takes a number, a vector or a matrix, not a struct. Remove it.`
  `&` and `|` on a bool or a vector of bools stay, as WGSL's non-short-circuiting logical
  operators, and on two scalar `bool`s the editor now reads them as the compiler does: it kept
  TypeScript's TS2447 on the operator and, where the `number` TypeScript types the result as
  reached a `bool`, TS2322, TS2345, TS2363, TS2367 or TS2769, on a program that compiles. The
  projection reads the operation as the `bool` it is, `((a & b) as unknown as bool)`, and a
  cursor on the first character of the left operand reads that operand, not the inserted
  parenthesis, so hover, definition, references and rename on `p` in `p & q` work as they do on
  `u32` operands (the same holds for the parenthesis written before an arrow's one parameter,
  `xs.map(x => …)`); and the
  TS2447 filter's reason no longer calls `^` WGSL's xor on a vector of bools; `+m` on a matrix and `+x` on a number or a vector stay the identity. A float under
  `&`, `|` or `^` keeps the refusal #236 gave it, which leaves two whole numbers the front end
  folds alone: `const AB = A | B`, `const F: u32 = 1 | 2` and `case 1 | 2:` compile as before.
  The one table is `src/compiler/ts/lower/operator-kinds.ts`, and every remedy it names
  compiles. The editor shows the compiler's sentence alone: its merge drops TypeScript's
  TS2365, TS2362, TS2363 or TS2447 on the same operator, and any report about the value, which
  TypeScript types a `number` from the operator alone, in place, through a member or an element
  or through a local declared from it (`(a & b).x` was TS2339, `const b = -a; b[0]` TS7053,
  `const c = a * b; return c` TS2322). `a + b` on two class instances was TS2365 in the editor,
  and `a * b` on two bools returned from a `bool` function three TypeScript diagnostics.
  A VECTOR OF BOOLS IS NOT HOST-SHAREABLE EITHER. Only a scalar `bool` was refused in a
  uniform or storage binding; a `vec3b` field, a `storage<array<vec2b>>` and a bare
  `uniform<vec4b>` reached Tint as `type 'vec3<bool>' cannot be used in address space
'uniform' as it is non-host-shareable`. Each is `TS8051` now:
  `"U.b" is a vec3b; a uniform binding holds no bool, alone or in a vector (WGSL's host-shareable rule). Use vec3u.`
  A workgroup variable, a module `let` and a local hold one as before.
  A DECORATOR NOTHING READS IS REFUSED. TypeScript parses one on a `const` and its checker
  refuses it (TS1206), which `compile()` never ran, so `@group(2) @binding(5) declare const u:
uniform<U>` was emitted at group 0, binding 0, and `@id(7)` on an override and `@bogus` on a
  constant, a namespace's constant, a function's local, an enum, an interface, a type alias, a
  function declared in another function's body, a `static` field, a constructor, an overload
  signature, an abstract member, a mixin, a class expression or a local class vanished;
  `@fragment` on an overload signature left the module with no entry. So did a decorator that
  is not a name (`@N.k`, `@(fragment)`) anywhere, and an attribute of the list where the place
  does not apply it: `@location` on a class or a function, `@fragment` on a field or a
  parameter, `@blend_src` on a parameter, `@diagnostic` on a namespace's function. Each is
  `TS8028` now: `@group` and `@binding` as not applied, since `reflect()` reports the group and
  slot each binding gets, whichever form declares it
  (`"@group" is WGSL's attribute, and is not applied: reflect() reports the group and slot each binding gets. Remove it, and read the slot from reflect() on the host.`),
  `@id` as not applied since the host sets an override by its name, an attribute of the list
  by what it marks
  (`"@fragment" does not apply to a local function: it marks an entry function. Remove it.`;
  on an overload signature, `Write it on the implementation.`), a decorator that is not a name
  as not applied (`"@N.k" is not applied: an attribute is written "@name" or "@name(...)". Remove it.`),
  and any other name by the unknown-attribute sentence. `@builtin` or `@location` on a
  parameter of a function that is not an entry (a helper, a local function, a method) reached
  Tint as `'@location' is not valid for non-entry point function parameters`, and is
  `"@location" does not apply to a parameter of a function that is not an entry: it marks an entry's input or output. Remove it.`
  `@std140`, which vanished everywhere but on a class, says it is not applied:
  `"@std140" is not applied: WGSL lays out a struct by its own rules, which reflect() reports. Remove it.`
  A field that holds a function is a method (Rule 8.16), and its decorator is the method's
  `TS8035`, once, by the class's written name (`Box.get`, where a generic class said
  `Box_f32.get` and `Box_vec3.get`); a decorated method is lowered all the same, so a call of
  it no longer adds `"M" has no method "f"`, and a generic function's misplaced attribute is
  refused once, not once per instance. The editor's merge drops whatever TypeScript says
  inside a decorator the compiler refuses whole (TS1206, TS1239, TS1249, and TS2304 on a name
  the ambient library does not declare), in any decorator of a refused method, and the
  span-less TS2318 for `TypedPropertyDescriptor` a method's `@fragment` drew, so it says the
  one mistake once. A namespace's entry (`namespace N { @fragment export function fs() }`,
  emitted as `@fragment fn N_fs`) drew TS1206 in the editor on each decorator, a program the
  compiler accepts; the service's TS1206 filter takes a namespace's function and its
  parameters as it takes a top-level one's. Surface §4 no longer claims TypeScript cannot parse
  a decorator on a `const`.
  WGSL'S OWN ATTRIBUTES ARE NOT "UNKNOWN". `@workgroup_size`, `@size`, `@align`, `@group`,
  `@binding`, `@id`, `@must_use` and `@subgroup_size` are WGSL's (Rule 2.1), and the sentence
  says so and where the intent goes:
  `"@workgroup_size" is WGSL's attribute, written here as @compute's argument: @compute([64]) or @compute([8, 8]).`
  `@size` anywhere but a struct field, and `@align` anywhere but a field or a class, are named
  as the field's: `"@align" is WGSL's attribute for a struct field, not a function. Remove it.`
  `@align` on a function or a parameter, which compiled as if unwritten, is refused with it;
  `@align` on a class keeps `@align on a class is not applied.` A test holds these lists and
  the attributes the compiler reads to WGSL's own list in the spec-names fixture, `@const`
  aside (a keyword TypeScript does not parse as a decorator).
  MEASURED against main (`6c78035`): every program of the group's findings and of the two
  reviews, each of which main compiled into a module Tint refused or with the decorator
  dropped, is one diagnostic in `compile()` and in the editor. 362 files of examples,
  journeys, documentation fences and valid neighbours (folded bit flags, `+` on numbers,
  vectors, matrices and doubles, undecorated static fields, local functions, namespaces and
  declarations, overloads, a namespace's entry, a constructor, an arrow-function field, an
  abstract class, a mixin, a generic function, an entry's `@invariant @builtin("position")`
  and `@interpolate` parameters, `@diagnostic` on a helper, a `@blend_src` struct) give the
  same diagnostics, WGSL and GLSL as main, but for one intended refusal, a `*=` of two
  matrices of doubles Tint refused; the editor differs only on the three namespace entries,
  which lose TS1206. The emit goldens and the API surface did not move. The one test that wrote `@group(0) @binding(0)` on a declaration, and
  relied on it being ignored, drops it; the projection test that did `a + a` on a `mat<f64>`,
  which Tint refuses, does `a * a`; and three `BUILTIN_NAME` tests whose `vs` had no `@vertex`
  are vertex entries now.

- **A `break`, a `continue`, `&&`, `||` and `?:`, and `workgroupUniformLoad` answer to the
  uniformity walk** (proposal 0008 §4; design rule 8.5; surface §48 and §54). The walk modelled
  `return` alone, so after `if (lid.x > 2u) { break; }` or `continue;` the rest of the loop read as
  uniform, and a barrier, a derivative or an implicit-LOD sample in the body compiled with no
  diagnostic and failed at `createShaderModule`. A `break` or `continue` under a non-uniform
  condition now makes the rest of its loop non-uniform, the next iterations included, so a
  barrier above the jump is `TS8052` as well as one below it. The flow after the loop is the
  loop's own again, so a barrier below the loop still compiles. This holds for `for`, `while` and
  `for…of`. A `break` out of a `switch` case makes the rest of that case non-uniform and nothing
  after the `switch`. A jump carries the environment it was taken in to where it lands, so a
  local that a loop writes is non-uniform after a loop that a non-uniform jump left. A loop's
  condition is read on every iteration, so `i < lid.x + workgroupUniformLoad(w)` is refused. The
  right side of `&&` and `||` is under a branch on a non-uniform left side, so
  `lid.x > 2 && workgroupUniformLoad(w) > 0` and a `textureSample` right of a fragment input are
  refused. So is an arm of a `?:` that WGSL writes as an `if` because its `select` takes no
  struct, array, matrix or vector of doubles: `lid.x > 2 ? workgroupUniformLoad(tile) : z` on an
  array, and a `textureSample` in a struct `?:` on a fragment input, compiled and failed in Tint.
  A `?:` on a scalar or a vector is `select`, which evaluates both arms, and still compiles. An
  `&&`, `||` or `?:` whose operand calls a helper that writes, which the compiler writes as an
  `if` of its own (§26), reads as the operator the author wrote. A jump, a left side or a
  condition that the walk cannot classify, such as `if (done(i)) { break; }` on a helper, narrows
  nothing, as before. `out.length` on a `read_write` storage array (`arrayLength`) is the size
  the host bound, which is uniform: a barrier under `if (out.length > 4)` compiles now, where it
  was refused.
  `workgroupUniformLoad` goes through the same walk as a barrier. It had a rule of its own,
  `TS8034` for any `if` or `switch` around it. That rule refused `if (k > 0.5)` on a uniform and
  `if (wid.x > 2u)`, which now compile. It passed a load after `if (lid.x > 2u) { return; }`, in
  a helper called under a branch on `lid`, in a `while` or `for` that `lid` bounds, below a
  non-uniform `break`, and handed to a helper that writes on the right of `lid.x > 2 &&`, each of
  which is now `TS8052`. Where the walk cannot classify the flow, the load is refused inside an
  `if` or `switch` the author wrote, as before, and compiles elsewhere, as before:
  `opaque() > 0.5 && bump(workgroupUniformLoad(w))` still compiles.
  `TS8052` names the statement whose own condition first made the flow non-uniform, and the move
  that fits it. It used to say "Move it out of the branch" of a barrier that was in no branch:
  `workgroupBarrier() is reached in a loop some invocations leave by a break taken under "lid"
(@builtin(local_invocation_id)), and every invocation of the workgroup has to reach it: one that
does not is a workgroup that waits forever. Move it out of the loop, or break on a value the
whole workgroup shares (a uniform, a module const, @builtin("workgroup_id")).` The other places
  are a return, a loop condition, a continue, a break out of a switch case, the right side of
  `&&` or `||`, an arm of a `?:` ("in an arm of a ?: whose condition reads …", "Call it before
  the ?:"), and a return inside a loop. A loop inside a branch on `lid` is still reached "under"
  that branch, and a `break` on a uniform inside a loop that `lid` bounds names the bound. A
  derivative's sentence hoists the call to the same places. Each move compiles on Tint. The value
  is named as the author wrote it: a helper as it is called, `Lim.hit(…)`, `done(…)` or
  `Gate.open(…)`, where the sentence printed the emitted `Lim_hit(…)`, `main_done(…)` or
  `Gate_open(…)`, and a helper the walk cannot see through by its name, `opaque(…)`, where the
  sentence said "the expression" or "the entry". A derivative's sentence offers
  `@diagnostic("off", "derivative_uniformity")` where the file can carry it: on the entry when
  every entry is top-level, as before, on a top-level function when an entry is a namespace's,
  whose own `@diagnostic` is `TS8028`, and not at all when the file has no top-level function;
  it told a namespace's entry to write the attribute it then refused.
  Measured against main (`6c78035`, with #210) over 9674 probe programs on Chromium 141: 117 that
  compiled before are refused now. Tint refuses 112 of them as written. The other 5 passed Tint on
  main only because loop-invariant code motion moved the derivative out of the loop, which the
  front end does not count, as it did not before for a loop with a non-uniform bound. 25 that main
  refused now compile, and Tint accepts each. 41 refusals read the new sentences, and every other
  program is unchanged. The `?:` and writing-helper cases were measured on their own, on
  Chromium 141 and 153 alike: main compiled each refused one and Tint refuses it, and each one
  kept compiling passes Tint. The editor reports each refusal as `compile()` does, and each pin
  reads both. The examples and journeys give the same diagnostics, WGSL and GLSL as before, and
  the emit goldens and API surface did not move.

- **The editor says what the compiler says, and a message names a type as the author writes it**
  (proposal 0008 §5; design rule 12.7; surface §19, §20 and §52). A runtime-sized storage
  array's `length` hovers the `u32` the compiler reads through `arrayLength` (#271 declared it),
  a sized binding's and a local's keep their literal size, and the hover is pinned beside the
  compiler's one refusal of `src.length * 0.5`, which is also the editor's only diagnostic
  there. WGSL's phony assignment `_ = max(a, 1.)`, which
  compiles, drew TS2304 "Cannot find name '_'" in the editor, and `_ = a + 1.` read as two
  diagnostics. `_` has no WGSL, ECMAScript or §9.3 source, so it is not declared in the ambient
  library; the language service drops TS2304 on the `_` of the statement the compiler lowers as
  phony (an expression statement, or the body of an arrow that returns nothing) and nowhere
  else, so `_ = max(a, 1.)` is clean, `_ = a + 1.` is the compiler's one TS8099, and a `_` read
  as a value is the compiler's one TS8022 in the merged list.
  A message the front end writes names the type of a value, a field, a parameter or a return,
  and a class its sentence is about as a whole, through `authorTypeText` instead of the IR key
  or the emitted struct name: `Function "k" return type mismatch: declared B, got A.` where it
  said `declared struct:B, got struct:A`; `N.P` for a class in a namespace, which printed as the
  emitted `N_P`; `Slot<f32>` for an instance of a generic class, which printed as `Slot_f32`;
  `cannot * vec3u and vec3` for `vec3<u32> and vec3<f32>`; `mat3x3` for `mat3x3<f32>`; `vec3f64`
  and `vec2b` for `vec3<f64>` and `vec2<bool>`; `array<vec3u, 4>` for `array<vec3<u32>,4>`; a
  storage texture with the string literals the author writes, `texture_storage_2d<"rgba8unorm",
"write">`; and what `atomicCompareExchangeWeak` returns as the ambient library declares it,
  `{ old_value: u32; exchanged: bool }`. The sentences about a class read its written name too:
  its declaration (`Field "x" is declared twice on "Slot<f32>"`, `Optional field "y?" on "N.P"`,
  `Field names on "N.P" must be plain identifiers`, `Struct "N.P" is declared more than once`,
  `Struct "S.E" has no fields`), its base and its mixins (`"N.Q" extends "E"`, `"C" extends
"B<f32>"` where it printed `B_f32`, `"N.D" gets the field "t" twice through its mixins`,
  `"B" declares "f" as f32, and "A" declares it as N.P`), a literal, an entry or a
  method call of it (`Struct N.P has no field "z"`, `give "S.VOut" a field with
@builtin("position")`, `"N.P" has no method "q"`), and a struct two files of one program
  declare (`Struct "N.P" is declared in both "a.ts" and "b.ts"`). The interstage refusal (TS8010)
  reads `@location(0) leaves "vs" as vec3 (VOut.uv) and enters "fs" as vec2 (FIn.uv)`.
  A remedy that quotes a type or a call compiles when pasted: `Cast it, e.g. vec3(...)` was
  `vec3<f32>(...)` and `add ": vec4" to the signature` was `": vec4<f32>"`, both TS2315 in the
  editor; a module const whose annotation no call converts (`const K: A = sin(1.)`,
  `mat3x3<f64>`, and `const K: vec3u = u32(floor(2.))`, whose splat `vec3u(u32(...))` is not
  constant) is told `Change the annotation to u32.`, while `const K: vec3i = countOneBits(5)`
  keeps `Cast it, e.g. vec3i(...)`; a class built as a literal is told `new Slot<f32>(...)`; an
  array element of a struct type is no longer told to "cast it"; and a static called on a value
  names its class with no type arguments, `"Slot.m" is static; call it on the class:
Slot.m(...).`, where it said `"Slot<f32>" has no method "m"`. A static of a class in a
  namespace is called nowhere yet (`N.P.m()` reads `N` as an unknown value), so its sentence
  names no call: `"N.P.m" is static, so a value of N.P does not have it.`, where it named
  `N_P.m(...)`. A read or a write of a storage binding whose declared type was refused says
  nothing more (Rule 12.4): `storage<array<vec2h>>` and `storage<mat2x3<f64>>` hold a
  placeholder struct, and `vh[0]`, `vh++`, `mnd = mat2x3()` and `mnd *= 2.` each added a
  sentence about it (`Cannot index struct:array`, `cannot assign to struct:mat2x3
struct:mat2x3 and mat2x3<f32>`), and a function that writes no return type and returns such a
  read, `function g() { return vh[0].x; }`, a method or an arrow alike, made its caller say
  `cannot assign to f32 f32 and void`; each program is now its one TS8002 or TS8027, and a
  write to a read binding keeps its TS8005. A value returned from a function that says it
  returns nothing reads `returns a value of type vec3`, where #249's sentence said `vec3<f32>`.
  An assignment reads in the order it is written, `cannot assign B to A. Types must match.`,
  where it named the place twice (`cannot assign to A A and B`), and its remedy casts the value,
  `e.g. a = vec3(f32(b.x), f32(b.y), f32(b.z))` and `a = i32(b)`, where it added to the place
  (`a + vec3(…)`); a vector assigned to a scalar is no longer told to splat. An argument of
  another class names both, `Argument 1 of "N.f" is P, and "N.f" takes N.P. A struct is its own
type whatever its fields, so pass a value of type N.P.`, where it said `Argument 1 of "N.f" type
mismatch.` and nothing more: TypeScript takes one class for another with the same fields, so
  the editor is silent, and `N.f(new P())` with a top-level `P` beside the namespace's compiled on
  main only because the parameter's `P` resolved to the top-level class (§1); and the note on a
  base and a derived class names them as written;
  and the host import names a type as written where a call or a binding has no host value, `a
vec3f64 waits for change 0013's f64 split` for `an vec3<f64>`, and a binding in its runtime
  errors, `binding "pts" (array<vec2>)` for `(array<vec2<f32>>)`. So do the sentences main
  added since: an array with no size in a parameter, a result or a local (Rule 12.6) reads
  `array<vec4>` for `array<vec4<f32>>` and `N.T` for the struct `N_T`, and 0020's refusal of a
  static builder names an instance of a generic base `Base` and `Base<f32>`, where it said
  `Base_f32`; the form it names, `static make<C extends Base<f32>>(this: { new (): C; … }): C`,
  compiles, where the generic class's own copy of the static returned the class `Base`, which is
  no struct, and was refused as `declared Base, got Base<f32>`. The backend's TS8015, from
  `src/core`'s uniform layout, keeps WGSL's spelling (`array<vec2<f32>,4>`). Measured: the
  audit's and three reviews' probe programs (a class, a namespaced and a generic class, a
  vector, a matrix, an array, a sampler and a texture in each message family) print the author's
  spelling in `compile()` and in
  the editor, and `type-spelling.test.ts` pins them by code and text and pastes every spelling and
  every remedy back; 22 valid programs around `.length`, `_`, namespaced, generic and mixin
  classes, statics, object literals, entries, module consts, binding reads and writes and
  unannotated returns, and a two-file program, give the same diagnostics, WGSL and GLSL as on
  `main`, Tint accepts each, and the emit goldens and the API surface did not move.

- **Sentences written before classes say what is true now, once, where the member is written**
  (proposal 0008 §6; design rules 12.1 and 12.4; surface §26 and §27). Two bodies for one method
  were `TS8035 "C.m" is declared twice; a method has one body and no overloads.`, written before
  overload signatures compiled (#190). They are `"C.m" has two bodies; a method has one body, with
overload signatures above it for each shape it takes.`, said once of the class as it is written,
  where a generic class said it once per instance (`"P_f32.m"`, `"P_vec3.m"`) and a namespaced class
  named its struct (`"N_C.m"`). A second constructor of a generic class is `"P" declares two
constructors; ...` once, where it was `"P_f32"` and `"P_vec2"`, and one of
  a class in a namespace names it as the author writes it outside, `"N.P"`.
  Two bodies for a method, a getter or a constructor in a mixin's class expression compiled, the
  first winning where JavaScript runs the second; each is refused where the mixin writes it,
  `"Tinted(…).lit" has two bodies; ...` and `"Tinted(…)" declares two constructors; ...`, once,
  whether or not a class applies the mixin or writes the member over it.
  Two members that would be emitted under one name are said in the words they are written in,
  with no emitted function and no generic instance: `"P.f" and the static "P.f" would be emitted
under one name. Rename one of them.`, `"P.#m" and "P.m" ...`, `The getter "C.y" and "C.get_y"
...`, where the sentence was `"P_f32.f" and "P_f32.static f" would both be the function
"P_f32_f".` A call of either member adds nothing, where a call on the other side was told to
  call the one that won (`"C.m" is static; call it on the class: C.m(...).`) and a call on a
  generic class's instance was `"P_f32" has no method "m".`
  An `abstract` member with a body was `"D.m" is abstract; a shader function has one body.`,
  named for each class that inherited it, followed by `"D" has no method "m"` at a call, and
  not said at all when the class that extends overrode it (TS1245 in the editor). It is one
  `TS8035` where it is written: `"B.m" is abstract and has a body; remove "abstract", or remove
the body and let each class that extends "B" write it.` (a class that is not abstract, or a
  field that holds a function, is told only the first), for a method, an accessor and a field
  that holds a function alike, and `"Tinted(…).lit" is abstract and has a body; remove
"abstract".` once for a mixin's member. It is said whatever a generic class is instantiated
  with or when nothing instantiates it, and whether or not a class applies the mixin or
  overrides the member. An abstract field with an initializer (TS1267), which compiled, is
  `"B.x" is abstract and has an initializer; ...`.
  An abstract method or accessor with no body in a class that is not abstract (TS1244)
  compiled while nothing called it, and a call was `"B" has no method "m"`. It is one sentence
  at the member: `"B.m" is abstract, and "B" is not; mark "B" abstract, or remove "abstract" and
give "m" a body.`, and in a mixin, whose class cannot be abstract, `"Tinted(…).lit" is
abstract, and the class a mixin returns cannot be; remove "abstract" and give "lit" a body.`
  An abstract overload signature of a method whose body is not (TS2512) compiled, and a class
  extending one that wrote it first was told `"D" does not implement "m", which "C" declares
abstract`, though `C` writes the body `D` inherits; it is `A signature of "C.m" is abstract,
and its body is not; remove "abstract".` (`remove the signature.` below the body, where
  TypeScript takes no signature), and a method any of whose declarations has a body is
  implemented, whichever comes first.
  A class that is not abstract and leaves an abstract method or accessor of its chain
  unimplemented (TS2515) compiled while nothing called the member, and a call was `"D" has no
method "m"`. It is one `TS8035` at the class, `"D" does not implement "m", which "B" declares
abstract; write "m" in "D".`, the members listed in one sentence when there are several. In
  each of these a call, a read, a write or an inherited body that reaches the member adds
  nothing. The check reads the classes collected as structs, so a class in a function body is
  its one `TS8099`; it does not follow a mixin or a base the file does not resolve. An abstract
  field is a member of every struct below the class that declares it, so a class that does not
  declare it again still compiles, where TypeScript refuses it (TS2515).
  None of these sentences says why a class has no field, so a class with none is told that too
  (`Struct "Shape" has no fields. ...`), where the sentence about the member stood in for it and
  a class extending it was told only that its base is no struct; a call of what such a base
  would have given adds nothing. A class of statics alone with a second body for a static stays
  the namespace it is, where it was an empty struct and every use of it `Unknown identifier`.
  A statement at the top level was `TS8014 Unsupported top-level "IfStatement". A TypeShade
file is directive + types + functions + imports.`, TypeScript's node name (a `debugger` was
  "LastStatement") and an inventory from before classes, enums, namespaces and module
  variables. It is named by its keyword: `An "if" statement at the top level runs nowhere; a
shader file declares functions, classes, types, enums, namespaces, constants, module variables
and resources. Move it into a function.`, with the move offered only for what a function body
  takes, "Remove it." for an empty `;` and `debugger`, its own sentence for `import x =
require("./lib")` and `import k = N.k`, and the written text for any other statement. A
  top-level `try`, `throw` or `for…in` was that and `TS8013` on one span, and is `TS8014` alone.
  In a namespace a statement was `A namespace holds functions, constants, classes and
namespaces; this inside "N" has no flattened form. Declare it at the top level of the file.`,
  a remedy the top level refuses; it is `An "if" statement inside "N" runs nowhere; a namespace
holds functions, constants, classes and namespaces. Move it into a function.`, the namespace
  written as the author writes it (`A.B`), and a `try`, a `throw` or a `for…in` there keeps the
  one `TS8013` it gets anywhere. A statement a namespace refuses whole is that one sentence: a
  `try` inside an `if` there was also `TS8013`.
  Each of these reads once in the editor too. TypeScript refuses the same class shapes and
  top-level statements, and the editor showed its report beside the compiler's sentence:
  TS1245 beside `"B.m" is abstract and has a body`, TS2515 beside `"D" does not implement "m"`,
  TS2393 on each of two bodies, TS1108 beside a top-level `return`. The merged list (#210)
  pairs TS1244, TS1245, TS1253, TS1267, TS1318, TS2512, TS2676, TS2300, TS2392, TS2393, TS2515
  and TS2654 with `TS8035`, by the member or the class each is about (every declaration of a
  name declared twice or overloaded, and a class that inherits a base's abstract member with a
  body, through a generic base or a mixin), and TS1101, TS1104, TS1105, TS1108, TS1202, TS1315
  and TS2410 with `TS8014`, and keeps the compiler's sentence.
  Pinned with code and text in `class-methods.test.ts`, `inheritance.test.ts`,
  `semantic.test.ts` (20 top-level and 10 namespace shapes, each asserting the whole diagnostic
  list) and `class-syntax.test.ts`, the class and top-level pins reading both halves, the
  compiler's list and the editor's; each new pin fails without its fix. Measured against `main`:
  147 programs written to compile, the 82 examples among them (abstract members implemented by
  a method, an arrow field, a getter, a field, a parameter property, a class between and a
  mixin; overload signatures, of a method and of a constructor; generic and namespaced classes
  and their statics; a mixin's methods, accessors and a constructor a class overrides, and one
  nothing applies; a static beside an instance method of another name; a class extending a class
  of statics; namespace members; every top-level declaration), give identical diagnostics in
  `compile()` and in the editor, WGSL and GLSL, and every remedy the sentences name compiles and
  passes Tint. A program TypeScript refuses for an abstract member (TS1244, TS1245, TS1267,
  TS2512, TS2515) or for two bodies in a mixin (TS2392, TS2393) that compiled on `main` is
  refused now. No code is added or renumbered.
  A `new` of a class of statics alone names one of its statics, `Call "U.half(...)" directly.`,
  or for one of static fields alone `"K" declares only static members, so there is no value of
it to build. Read "K.a" directly.`, where it named a literal `U.f(...)` the class need not have.

- **A compound assignment to an `f32` rounds in the CPU backends' `f32` mode.** `s += x` computed
  its sum inside the statement, where `froundF32` (`core/passes/precision.ts`) did not reach it, so
  the interpreter and the generated CPU code kept it an f64 sum where `s = s + x` rounded; a host
  call (Rule 11.7) summing in a loop could part from the GPU in the last places. The pass now spells
  it `s = s + x` first, component-wise for a vector.

- **An array with no size is refused where it would leave its storage binding, not by Tint**
  (Rule 12.6, surface §20). A parameter or a result typed `array<T>`, or a struct whose last field
  is one, and a `let` that would copy one, compiled with no diagnostic and reached Tint, which
  refused the module (`runtime-sized arrays can only be used in the <storage> address space`).
  The front end now refuses each in the author's words (`TS8020` for a parameter or a result,
  `TS8099` for a local), with the remedy. A `const` that names the binding (`const a = src`) is
  now the binding, as in TypeScript: it used to emit `let a = src`, which Tint refused as soon as
  `a` was indexed, and now `a[i]`, `a.length` and writes through `a` read and write `src`.

- **`dispatch` and the debugger no longer throw on a `console` call.** The lockstep interpreter
  (`src/core/debug/interp.ts`) had no arm for one: `cpu.dispatch` of a kernel that logged threw
  `typeshade/debug: unknown fn console.log`, as did stepping over the call. It now evaluates the
  arguments and delivers the event to the sink `compileModule` took, with the invocation.

- **`f64()` keeps the whole double of a negated or computed literal** (Rule 5.2, §39).
  `f64(-0.1)`, `f64(-(0.1))` and `f64(1. / 3.)` carried only the `f32` rounding of their value,
  widened as `(x, 0.0)` with the tail lost, while `f64(0.1)` and `const k: f64 = -0.1` carried
  the double. §39 says the cast folds a literal argument at full precision, but it lifted only a
  bare literal: a negated one lowers to a unary minus over it, and `1. / 3.` to a division. The
  cast now folds its argument first, as the retype beside an `f64` does, so each emits the pair
  a declared `f64` carries. For `-0.1` that is
  `vec2<f32>(-0.10000000149011612, 1.4901161415892261e-9)`, where it emitted
  `vec2<f32>(-0.1, 0.0)`. That is the splat the `vecNf64` constructor refusals name, so
  `vec3f64(f64(-0.1))` now carries the double as well. `f64(f32(0.1))` moves the other way. The
  inner cast folds to an `f32` literal that still holds the double 0.1, and the outer one lifted
  that whole, undoing the narrow the author wrote. A call says which precision it means, as it
  does beside an `f64` operand, so the cast now widens that `f32` exactly, to
  `vec2<f32>(0.10000000149011612, 0.0)`, and the CPU oracle reads the same `f32`. The test is
  the retype's own, on the argument as a whole, so `f64(-f32(0.1))` folds as `s * -f32(0.1)`
  does and the two spellings still emit one pair. `f64-types.test.ts` pins each spelling on the
  oracle and on the lowered module under f32 rounding.
- **A refused declaration is the one diagnostic for its name** (Rule 12.4, #171). A declaration
  the front end refuses binds no name, so every later read of it added a
  `TS8022 Unknown identifier` to the refusal, naming a symbol the author did declare: `const y: f32 = g(x)` with
  a mismatched argument, `const r = g(x)` with one missing, `const c = a + b` on two vector
  sizes, `declare const x: f32`, a top-level `let x: uniform<f32>`, each reported once and then
  once per use. An assignment to the name, a compound assignment and a write through it
  (`y.x = 1.`) added `Cannot assign to unknown name` the same way, and `Date.now()` was
  `TS8012` and `TS8022` on the same identifier. The unknown-name report is now dropped only when
  an error stands inside the declaration the name resolves to, or on the name itself, and that
  is checked rather than assumed, so a declaration that was dropped without a diagnostic still
  has every use reported. The name is resolved by TypeScript's lexical rule, so a name read
  outside the block that refused it, read before its declaration, or declared nowhere is still
  `TS8022`. Appendix B's Rule 12.4 row is removed.

- **A GLSL or HLSL name is refused with TypeShade's spelling as the remedy** (#218, Rule 12.1).
  Models, and authors coming from those languages, write the names they know, and the
  compiler refuses them, which is right, but the second sentence pointed the wrong way: for
  `lerp(a, b, 0.5)` it was "Declare it in this file, or import it from another shader module."
  The refusal now names TypeShade's spelling, for the 112 names of the table:

  ```text
  TS8004 Unknown function "lerp". HLSL's lerp is mix here.
  TS8002 Unknown type "float3". HLSL's float3 is vec3 here.
  TS8022 Unknown identifier "gl_FragCoord". GLSL's gl_FragCoord is a parameter here: @builtin("position") pos: vec4.
  ```

  The same holds for `gl_Position = …` and `@numthreads`. `fmod` names the `%` operator and
  says that `mod` floors, since TypeScript's own guess for it, "Did you mean 'mod'?", is the
  one spelling that compiles and answers differently for a negative operand; the editor shows
  the compiler's sentence in its place. `TS8004` quotes the callee's name rather than the
  whole call, for every unknown function, and sits on the name. The table is the MCP server's from
  typeshade/vscode-typeshade, moved into the compiler (`src/compiler/ts/foreign-names.ts`) with
  the two invariants its tests held: every target is a name TypeShade has, and no source is
  one. It is exported from `typeshade/language-service` as `FOREIGN_NAMES`, so that server can
  read it from the compiler it pins. No name is added: accepting `lerp` as a second spelling of `mix` is what Rules 2.1 and
  9.6 exclude, and an alias for `fmod` would change what a program means.

- **One mistake reads as one diagnostic in the editor and in `typeshade check`** (Rule 12.4). A
  mistake both halves see was reported by both: `y = 2.` on a `const` as TypeScript's TS2588 and
  the compiler's `TS8005`, `g(x)` one argument short as TS2554 and `TS8019`, `colr` as TS2304
  and `TS8022`, `cross(v, w)` on a `vec2` `w` as TS2345 and `TS8036`. The language service now
  merges the two halves: where they report one mistake the compiler's diagnostic is kept, since
  it is what `compile()` and the build report and names the remedy in the surface's words, with
  no exception, a misspelled name included (below).
  TypeScript's own knock-on of a value it could not type goes as well: `return max(v, w)` with
  a `vec2` `w` added a TS2322 on the `return`, and now reads as the compiler's `TS8036` alone.
  The same holds for a name or a field TypeScript cannot find, which it types `any`, and for
  what is computed from it: after `const c = lerp(a, b, t)`, `vec4(c * x, 1.)` added a TS2345,
  and after `const t = frame.tiem * 2.`, a `vec3` declared from `t` a TS2322. A return of the
  wrong type was two diagnostics as well, the compiler's on the function's name and
  TypeScript's on the `return`; the compiler reports it on the `return` now, which also says
  which of two returns is wrong, and it reads once.
  `typeshade check` no longer adds a compiler row the service merged away: from `compile()` it
  takes only what the service cannot compute, the backends' `TS8015` and the opt-in `TS8053`.

- **A name the compiler cannot find names the one it is spelled like, in the build as in the
  editor** (Rule 12.1). The editor showed TypeScript's "Did you mean 'albedo'?" for `albdo`,
  and `compile()`, the build and an agent reading either said `Unknown identifier "albdo".` and
  nothing more. The compiler names the fix itself now, at every place a name is written: a
  value, a callee, a type, a field, a field of a struct literal, a `Math` member, a method, a
  static, an enum member, a function of a namespace, an assignment target, an attribute, a
  `@builtin` id, an `enable` extension and an import:

  ```text
  TS8022 Unknown identifier "albdo". Did you mean "albedo"?
  TS8004 Unknown function "clmap". Did you mean "clamp"?
  TS8002 Unknown type "vce3". Did you mean "vec3"?
  TS8022 Unknown field "tiem" on Frame. Did you mean "time"?
  TS8035 "P" has no method "lne". Did you mean "len"?
  ```

  One order holds everywhere: TypeShade's spelling of a GLSL or HLSL name first (`fmod` is the
  `%` operator, not `mod`), then a name of the same kind that exists there and is spelled like
  it, then the place's own remedy. The spelling rule is TypeScript's, so the editor loses no
  suggestion it showed (a test holds the compiler to every one TypeScript makes over a sweep of
  misspellings), with a swap of two adjacent letters counted as one edit, which finds `time` for
  `tiem` and `vec3` for `vce3` where TypeScript finds nothing. A callee is measured against the
  functions only, so `normailze(normal)` names `normalize` where TypeScript named the parameter
  `normal`. A name read above its declaration says that it is read before its declaration, and
  `discard()` that `discard` is a statement. The span is the name itself, and an unknown field
  names its struct as the author wrote it, `Frame`, where it said `struct:Frame`. A call of an
  unknown function still reports what its arguments get wrong, so
  `g(colr)` is both mistakes in the build too. With that, the merge keeps no TypeScript side for
  a misspelling: its TS2552 exception and the foreign-name check it needed are gone.

- **A type the file declares nowhere is refused** (Rule 12.6). A capitalized type name that
  named nothing became a struct of that name, so `l: Lihgt`, `uniform<Frmae>` and a `VsOt`
  return compiled with no diagnostic and died at Tint on a struct the author never declared,
  and `const v: Vec3 = …` read as a mismatch between `struct:Vec3` and `vec3<f32>`. Each is
  `TS8002 Unknown type "Lihgt". Did you mean "Light"?` now. A class declared below its use, an
  interface, an alias, an import and a type parameter stay the types they are, by TypeScript's
  lexical rule. The surface document's first resource snippet, which bound a `Camera` it never
  declared, declares one.

- **Every swizzle draws no error in the editor or in `typeshade check`** (Rule 12.7). The
  ambient library declared a vector's components and its prefix swizzles only, so `v.yx`,
  `v.xx`, `v.zyx`, `c.bgra` and `v.xyzz`, all ordinary WGSL the compiler takes, were TS2339 (the
  last with a wrong "Did you mean 'xyz'?"), so `typeshade check` failed each such program. Each
  vector type is now an interface with every swizzle its size admits, typed by its length, and
  keeps the index signature a native vector takes (below).
  The members are written out rather than generated by a mapped type: that form made every
  check about twice as slow, measured over the examples, and this one costs nothing measurable
  (3.1 s for the 81 examples, against 3.2 s before). A completion still lists the components
  and the prefix swizzles only. `VecOf`, `ScalarOf`, `ComponentKeys` and `Vec64`, the type
  machinery the old shape needed, are gone from the ambient library and from the extension
  table of the language design rules (§9.3), which is shrink-only.

- **An object literal of a class that declares methods draws no TypeScript error.** A local
  `let rng: Rng = { state: 1 }` was TS2741 "Property 'next' is missing" in the editor, the
  surface document's own `Rng` snippet among the programs, while the compiler builds the value from
  its fields (Rule 6.9). The diagnostic is dropped when every member TypeScript finds missing
  is a method or an accessor, and a literal that leaves out a field still reports. Each
  documentation snippet is now checked in the editor as well as compiled.

- **A destructured name whose declaration was refused says nothing more** (Rule 12.4, #171).
  `const { tiem } = frame` followed by a read of `tiem` added `Unknown identifier "tiem"` to the
  refusal of the pattern; a refused declaration is found through a destructuring pattern now,
  as through a plain name.

- **A local declared from a refused one says nothing more either** (Rule 12.4, #171).
  `const u = t * 2.` after a refused `const t = a * b` binds no `u`, since its read of `t` is one
  of the reads kept quiet, so `return u` read `Unknown identifier "u"` beside the one mistake in
  `t`. A declaration that reads a name whose own declaration was refused is now refused with it,
  and says nothing more.

- **A comparison, a bitwise or shift operator, a power or a unary operator on a vector draws no
  TypeScript error** (Rule 12.7). TypeScript types `a < b` on two vectors as a `boolean`, and
  `a & b`, `a << b`, `a ** b`, `~a` and `!m` as a `number` or a `boolean`, where the compiler has
  a mask, an integer vector or a vector of floats. On programs the compiler accepts,
  `return a < b` in a function that returns a `vec3b` was TS2322, `(a < b).x` was TS2339, and
  `select(a, b, (a < b) & (b > a))` was TS2447 and TS2345. The filters that drop arithmetic's
  false positives now read the operator table the projection reads (`ERASING_OPERATORS`), a
  comparison's shape being the `bool` vector of its operands' width, and a local declared from
  such an operation, or a function that returns one with no type written, is written into like
  one declared from arithmetic. A comparison of vectors of
  two sizes, or of a vector and a scalar, is one diagnostic, the compiler's `TS8003`: TypeScript's
  TS2365 and TS2367 are paired with it. The uses of a local whose operation the compiler
  refused, which has no type to write in, draw nothing beside the compiler's report either. `&`,
  `|` and `^` on two scalar booleans, which the compiler takes too, still draw TS2447.

- **A `case` that runs on into the next one is refused** (Rule 7.3, #202). WGSL's `switch` has
  no fall-through, so the lowering ended every clause where its statements ended, and a body
  with no `break` compiled to a different program than the one TypeScript runs, with no
  diagnostic: `case 0: x = 1.` above `case 1: x += 2.; break` gave `k = 0` the value 3 in
  TypeScript and 1 on the GPU. Such a clause, a `case` or a `default:`, is now `TS8017` at its
  label, and the message names the two fixes: end it with `break`, or repeat the shared
  statements in each case. Whether a body falls through is TypeScript's own reachability, the
  analysis `tsc` applies
  with `noFallthroughCasesInSwitch`: an `if` with no `else` leaves on one path only, and a
  `break` inside a loop leaves the loop. A clause that runs on only into empty clauses at the
  end of the switch runs nothing more in TypeScript either, so it is not refused. A program
  ported from WGSL, whose cases need no `break`, gains one per case. Appendix B's Rule 7.3 row
  is removed.

- **A read of workgroup memory no longer shows as unassigned in the editor on TypeScript 5.7 and
  later** (`docs/language-service-api.md` §6, surface §24). `let tile: workgroup<array<f32, 64>>`
  takes no initializer, and a kernel writes it through an element (`tile[i] = x`), so
  TypeScript 5.7 and later reported every read of it as TS2454,
  `Variable 'tile' is used before being assigned.` TypeScript 5.6, the version this repository
  installs, never reports it. The site's Playground bundles TypeScript 5.9, where
  `workgroup-scratch`, `workgroup-reduce`, `compute-sync` and `workgroup-tile-2d` showed the
  error and would not compile. The language service now drops TS2454 when the name resolves to
  a top-level `let` annotated `workgroup<T>`, and since the next entry to any module variable.
  A local read before its first assignment still reports it. Measured over the Playground's 82
  examples under TypeScript 5.9.3: 4 with an error before, 0 after.

- **A module variable with no initializer is zero on GLSL ES 3.00 too** (surface §24, Rule
  6.5). §24 says a per-invocation variable with no initializer is zero, and WGSL, the CPU oracle
  and the CPU codegen start it there, but the GLSL writer declared it bare, `uint hits;`, and
  GLSL ES 3.00 §4.3 lets such a global enter `main()` with an undefined value. A counter that
  starts at zero on WebGPU counted up from whatever the driver left in it on WebGL2, and so did
  a static field the file writes, which is the same variable (Rule 8.13). The writer now spells
  the zero of every shape the variable can hold: `uint hits = 0u;`, `vec3 tint = vec3(0.0);`,
  `mat3x2 m = mat3x2(0.0);`, `float[3] ring = float[3](0.0, 0.0, 0.0);`, and a struct's
  constructor over the zeros of its fields. The WGSL does not move, and no golden moves: no
  example that renders on WebGL2 declares such a variable. Each shape compiles and links on
  ANGLE and on Tint, the compile gate's two compilers. With the value defined on every target,
  the editor drops TS2454 on a per-invocation `let` as it does on workgroup memory: under
  TypeScript 5.7 and later, `let hits: u32` counted with `hits += 1` read as used before being
  assigned.

- **An `f64` module variable compiles** (surface §24 and §39, Rule 6.5). §39 says a pass
  rewrites every `f64` into `vec2<f32>` before a backend sees one, and the pass rewrote the
  constants, the structs, the bindings and the functions but not the module variables. So
  `let big: f64`, with or without an initializer, and a `vec3f64` or an `array<f64, 2>` one,
  reached the writers as `f64`, and `compile()` failed with TS8015
  (`SD0040 f64 type leaked past fp64Lower`) while the editor reported nothing. A module
  variable is now rewritten as a binding is, and its initializer, which the front end folds to
  literals, lowers to the pair a declared `f64` carries: `let big: f64 = 0.1` is
  `var<private> big: vec2<f32> = vec2<f32>(0.10000000149011612, -1.4901161415892261e-9);`, and
  with no initializer GLSL writes the zero, `vec2 big = vec2(0.0);`. Each shape compiles and
  links on ANGLE and on Tint, and the CPU oracle computes it as the double.

- **A module variable hovers as `let`** (Rule 6.5, Rule 12.7). #188 made every binding hover as
  `const name: T`, since a binding is always declared `const`. The front end records a module
  variable as a binding too, so from then on `let hits: u32` hovered as `const hits: u32`, and
  workgroup memory as `const tile: array<u32, 64>`. The hover now says `let` for a module
  variable, and a binding beside it keeps `const`.

- **The editor indexes a vector and an `f32` matrix by a runtime value** (Rule 12.7, surface
  §49). `m[i]` on a `mat4` or a `mat2x3` with an `i: u32`, a `for` counter as the index, `v[i]`
  and `v[0]` on a vector, and `m[0][1]` were `TS7053` in the language service on programs the
  compiler lowers, because the ambient library gave both types numeric literal keys only, the
  rule of an emulated double's constant lane. Both take an index signature now, as
  `array<T, N>` does. A `mat4<f64>` still takes no runtime index in either layer. An index past
  the end (`m[4]`) and an `f32` index are the compiler's to refuse (`TS8016`, `TS8003`), as on
  an array, and no longer draw a `TS7053` beside its sentence. A swizzle outside the components
  and the prefix swizzles (`v.yx`, `v.zyx`), which the README and the ambient library had called a
  false negative, was a false positive; every swizzle is declared now (above).

- **Two refusals around a vector of doubles name the reason and a remedy that compiles**
  (Rule 12.1, Rule 12.5, §27, §39). `select(a, b, m)` with `vec3f64` arms and a `vec3b` mask,
  which a comparison of two `vec3f64` now gives, read
  `select with a vec3<bool> condition picks per component and needs 3-component arms; got vec3<f64>.`
  The arms had three. The fp64 pass picks a vector of doubles whole, by one bool, and has no
  per-component pick over its hi/lo planes, so the `TS8003` now reads
  `select with a vec3<bool> condition has no emulated-double form; got vec3<f64> arms. The fp64 pass picks a vector of doubles whole, by one bool — narrow the arms, select(vec3(a), vec3(b), m), or keep the doubles with min(a, b) or max(a, b) where the pick is a componentwise minimum or maximum.`
  A mask of another width keeps the count sentence. A `vecNf64` compared with an `f64` or an
  `f32`, `a < b` or `a < 0.5` (whose literal is lifted to `f64`), read
  `Type mismatch: cannot compare vec3<f64> and f64. Types must match.` It now ends the way
  `vec3 < f32` does:
  `A vector of doubles combines with a scalar only through + - * /; splat the scalar with vec3f64(f64(x)) to get a vector.`
  The splat wraps the scalar in `f64()` because the constructor takes `f64` components only, so
  `vec3f64(0.5)` and `vec3f64(t)` with an `f32` `t` are `TS8019`, and `f64()` of an `f64` is
  that value. A `vecNf64` declared, assigned or a field given such a scalar gets the same
  sentence. Where a splat fixes nothing, the text is unchanged: `Types must match.` for an
  integer, another width, a vector of `f32`, and a `vecNf64` given to a declared `f64`. No code
  changes.

- **`&`, `|` and `^` refuse a float operand where it is written** (Rules 7.1 and 12.6). The
  binary operators compared only the two operand types, so `a & b` on two `f32`s compiled with
  no diagnostic and emitted `return (a & b);`, which Tint refuses with
  `no matching overload for 'operator & (f32, f32)'`. Two `vec3`s did the same, and two `f64`s
  or two `vec3f64`s reached the fp64 pass and came back as a span-less
  `TS8015 Backend emit failed: … [SD0041]`. Each is now one `TS8003` on the expression, naming
  the conversion that compiles:

  ```
  Bitwise "&" needs i32 or u32 operands, got f32. Convert first, e.g. u32(a) & u32(b), or
  reinterpret the bits with bitcast<u32>(a).
  ```

  A vector is told `vec3u(a)`, and an emulated double to narrow first, `u32(f32(a))` or
  `vec3u(vec3(a))`. A float beside an integer (`u & a`) gets the same sentence; it was a type
  mismatch whose remedy began with `f32(intVal)`, which makes two floats. Two whole numbers the
  front end folds are kept: `1 | 2`, or flags declared `const A = 1`, are `f32` by Rule 5.1's
  default, and an enum member, a module constant and a `case` label take the number (§12), as
  before. Where such a pair is emitted rather than folded, as `const x = 1 | 2` is in a function
  body, it still reaches the targets as `(1.0 | 2.0)`. The compound forms (`&=`, `|=`, `^=`)
  already refused a float target, `f32` included.

- **A comparison of two emulated-double vectors is a vector of bools** (Rule 7.1, §27, §39).
  `a < b` on two `vec3f64` was typed as one scalar `bool`, where every other vector comparison
  is the `vecN<bool>` of its width, as WGSL's typing table has it. So it was refused wherever a
  mask goes (`TS8003` returned as a `vec3b` or passed to a `vec3b` parameter, `TS8022` on `.x`)
  and accepted where a bool goes: `if (a < b)` compiled with no diagnostic and reached Tint as a
  `<` on two `DF64Vec3` structs, `no matching overload for 'operator < (DF64Vec3, DF64Vec3)'`.
  All six comparisons of two `vecNf64` of one width now yield `vecNb`, which `any`, `all` and
  `!` take, and `if (a < b)` is the `TS8003` two `vec3` operands get. The fp64 pass lowers them
  to `df64_vN_lt` through `df64_vN_ne`, which run the scalar comparator on each lane, so each
  operand is evaluated once. Like the scalar comparisons they read no guard, and a module whose
  only f64 work is comparing vectors gets no `_fp64` binding. A vec64 beside a scalar, another
  width or a vector of `f32` is still `TS8003`. Measured on SwiftShader: all six comparisons at
  widths 2 to 4, in both flavors, compile on Tint (module and render pipeline) and on WebGL2
  (both stages, linked). `f64-types.test.ts` holds the double on the CPU oracle and the lowered
  module on the f32-rounding oracle to one answer, lane by lane, where only the low word decides.
  The `double-bounds` journey tests points against a box near 1e7 with
  `all(box.lo <= p) && all(p <= box.hi)` on `vec3f64`, whose quarter-unit margins an f32 cannot
  see; it compiled before this with no diagnostic and emitted the structs' `<=`.
- **A vector of doubles built from an `f32` says so, and names `f64()` of it** (Rule 12.1,
  Rule 12.5, §39). `vec3f64(0.5)`, and `vec3f64(t)` with an `f32` `t`, read
  `Vector constructor component count mismatch.`, though one argument is the right count for a
  splat. A vector of doubles takes `f64` components only, and a constructor is not one of the
  places §39 retypes a literal, so the `0.5` is an `f32`. The `TS8019` now reads
  `vec3f64 splats an f64; got f32. Widen the scalar first: vec3f64(f64(x)).`
  Written out, `vec3f64(0.5, 0.5, 0.5)` read `Vector constructor element type mismatch: expected f64.`,
  which named no remedy. The `TS8003` now reads
  `vec3f64 takes f64 components; got f32. Widen each f32 component first, e.g. vec3f64(f64(x), f64(y), f64(z)).`
  Each sentence names the constructor as written, `vec3<f64>(0.5)` included, and the remedy
  at its width. Where `f64()` is not the fix, the text is unchanged: an integer, a bool, a
  vector of `f32`, a wrong count, and an `f32` given to a vector of integers. The constructor
  still takes no literal and no `f32`, and the codes are unchanged.

- **A loop can write the array whose length bounds it** (Rule 7.5). This loop over a
  runtime-sized storage array was `TS8006`, "for bound reads xs, which the loop body writes":

  ```ts
  for (let i = 0; i < xs.length; i++) { xs[i] = f32(i); }
  ```

  That is the loop the rule is written around, and the most common one over data. The bound
  check treated a write to an element as a write to the name, and `xs.length` lowers to
  `arrayLength(xs)`, which reads the name. A runtime array's length is fixed when the host binds
  the buffer, so the check no longer looks inside `arrayLength`. A bound that reads an element,
  or a field beside the array, is still refused when the body writes it.

- **The four noise twins hash their lattice exactly** (#184). `domain-warp`, `ocean`,
  `kaleidoscope` and `starfield` hashed a lattice point with `fract(sin(dot(p, k)) * 43758.5453)`
  on both surfaces. WGSL bounds `sin` only to 2^-11 on [-π, π], and the multiply puts that
  error above the fraction, so the GPU need not reproduce the oracle's value. Each now uses an
  integer hash, lowbias32 with xxHash's primes, keeping its top 24 bits and scaling them by
  `2^-24` rather than dividing, because WGSL lets `/` round. Nothing in the hash may differ by
  driver. `examples/lattice-hash.test.ts` pins that with the determinism report, and checks the
  oracle and the generated CPU code against a JavaScript reference bit for bit, negative
  lattice points included. The twins still reflect identically to their originals. The emit
  goldens of the eight files moved.

- **A hex literal with an `e` in it is an integer** (#182, Rule 5.1). `x * 0x9e3779b9` on a
  `u32` was `TS8003`, because the classifier took any `e` or `E` in a literal's text for a
  decimal exponent, prefix or not. `0xE` was the smallest case. Every standard hash constant
  has an `e` (`0x9e3779b9`, `0x85ebca6b`, `0xc2b2ae35`), so none of them could be written the
  way references spell them. A `0x`, `0b` or `0o` literal is now an integer whatever its
  digits, and emits the decimal it spells. A literal type in a union had the opposite defect:
  it read TypeScript's normalized text, in which `1.0` is `1`, so `type L = 1.0 | 2.0` was an
  `i32`. It is an `f32` now. Both read the source text through one helper, `isIntegerWritten`.
- **The editor types a function whose return is vector arithmetic as the vector it returns**
  (#162, surface §14, proposal 0004). A function that writes no return type returns what its
  body does (Rule 8.19), and TypeScript typed `return p * 0.5` on a `vec2` as a `number`: on a
  program the compiler accepts, `glow(uv).x` was TS2339, `tint(glow(uv))` TS2345, completion
  after `glow(uv).` offered nothing, and an arrow function handed to a call whose parameter
  returns a `vec2`, `apply((x) => x * k, uv)`, was TS2322 on its body beside a global
  `Cannot find global type 'Promise'`. The language service now writes the return type the front
  end gave the function into the text TypeScript reads, `: vec2` after the parameter list of a
  function, a method, a getter, an arrow function or a function expression whose return does
  arithmetic, with parentheses around an arrow function's bare parameter, and reads an arrow
  function's expression body as the value its TS2322 rule is about. The front end records each
  such type in a side table keyed by the function's node, so `CompileTsSourceResult` keeps its
  shape. Plain `tsc` is unchanged, and the README lists its TS2339 on such a call. The plasma
  journey's `toUv` returns a product with no type written, and the gate's editor check passes on
  it; `examples/inferred-returns.shade.ts` returns one from `Orbit.at`, and the path tracer drops
  the annotations it carried for the editor's sake.

- **The editor types a local built by vector arithmetic as the vector it is** (#162).
  `const uv = p.xy * frame.scale` gave `uv` the type `number` in the language service, because
  TypeScript has no operator overloading. So on a program the compiler accepts, `uv.x` was
  TS2339, `tint(uv)` was TS2345, completion after `uv.` offered nothing, and hover said
  `number`. The TypeScript program now reads each open document with the front end's type
  written in (`const uv: vec2 = …`), and every answer maps back to the text as written:
  diagnostics, hover, completion, references, rename, semantic tokens and `positionAt`. Only
  an unannotated `const` or `let`, a local or a module constant, is written into, when its
  initializer applies an operator TypeScript types as a `number` or a `boolean` and its type
  is a vector (of `f32`, `i32`, `u32`, `bool` or emulated doubles) or a matrix (of `f32` or
  `f64`). Plain `tsc` is unchanged: the README now lists the TS2339
  it reports on a swizzle of such a local among the documented classes. The plasma and ray-cast
  journeys drop their annotations, and the gate's editor check passes on them as written.

- **A local function or a parameter that takes a function is what its name means, whatever
  builtin shares it** (Rule 9.5). `step(i)` on a parameter `step: (i: i32) => void` reached
  WGSL's two-argument `step` and was `TS8019 step expects 2 argument(s), got 1`, and a local
  `const log = (x: f32): f32 => x * 100.` called as `log(2.)` computed WGSL's `log`, 0.693
  where TypeScript computes 200, with nothing said. A name a body declares now wins over every
  builtin, as TypeScript's lookup finds it first, a fold's callback included; a function of the
  module keeps the precedence Rule 9.5 records. An arrow function whose body is a barrier,
  `const sync = () => workgroupBarrier()`, runs it, where it was `TS8034 … is a statement with
no value`.
- **`return g()` where `g` returns nothing calls `g` and returns nothing** (Rule 8.19). In a
  function written `: void`, it emitted `return g();`, which WGSL refuses: a call of a function
  with no return type is no value to return. It is `g(); return;` now, in any function. A field
  that holds a function written `: void` whose body is an assignment, `hit = (d: f32): void =>
this.hp -= d`, was `TS8099 Unsupported binary operator`; it runs the assignment.
- **The CPU paths hand a function a copy of an aggregate it takes by value, as both GPU targets
  do.** A JavaScript vector, matrix, array or struct is the caller's own object, so a function
  that wrote what its caller passed changed its by-value parameter too: `a.add(a)`, with `add`
  writing its object, computed 4 on the oracle, the codegen and the debugger where WGSL and GLSL
  ES 3.00 compute 3, and `f(g)`, with `f` writing the module variable `g`, read 5 where both
  targets read 1. A function that writes anything now copies such a parameter as it is entered,
  and one that writes nothing, which cannot tell the two apart, pays for no copy. What an `inout`
  parameter holds as a function returns is stored back into the variable passed there, which a
  scalar a closure writes needs. The f32 rounding the debugger runs by default no longer wraps a
  parameter taken by reference, which is storage it would have made `__fround(n) = …` of.
  `src/core/cpu-aliasing.test.ts` pins both cases on every path.
- **`this` in a static a derived class inherits is the class the call names** (Rule 8.13, §26).
  It was the class that wrote the member, silently: `Derived.twice()` read `Base.K` where
  `Derived` declares its own `K` (6 where TypeScript computes 10), an overridden `this.k()` ran
  the base's (1, TypeScript 7), and `this.hits += 1.` run through `Derived.record()` wrote
  `Base.hits`, where TypeScript gives `Derived` a `hits` of its own. The static is lowered again
  for each class that inherits it, with `this` as that class, and the last is refused with the
  fix.
- **A static field beside a function of its name is refused, and a mistake in a body a class
  inherits is said once** (Rules 8.9, 8.12 and 12.4). `static #k = 2.` beside `static k()`
  compiled to `const A_k: f32 = 2.0;` beside `fn A_k() -> f32`, which WGSL refuses as a
  redeclaration, and so did a public static field beside an instance method of its name, which
  TypeScript keeps on two sides of the class; both are TS8035 now, naming the two members and the
  name they share. A body a class inherits is lowered again for that class, and an error in it was
  reported once per class that inherits it (`Unknown identifier "nope".` twice for one base and
  one derived class); it is reported once. One that fails only for the class that inherits it
  (`weigh(this)` with `weigh` taking the base, `this.#k`, a write through `this` to a static that
  class does not declare) is reported when an entry or a top-level function reaches it through
  calls, and dropped, with every function that calls it, when nothing does: a derived class that
  never called `score()` could not be declared before.
- **A member a class that extends declares as another kind is refused, as TypeScript refuses
  it** (Rule 8.16, §26). A method over a field of the class above, a method over an accessor
  and an accessor over a method compiled, each to the derived class's member, where TypeScript
  refuses the program (TS2425, TS2426, TS2423); each is TS8035 now, naming both members, and so
  are the same changes where one side is a field that holds a function, and `super.f` on such a
  field (TS2855). An accessor over an abstract field, which TypeScript takes, computed 0 where
  TypeScript computes the getter's value: the abstract field is a member of every struct below
  the class that declares it, and a body that class wrote read the member. It is refused with the
  fix, `abstract get f(): f32`, which means the same and reaches the accessor.
- **Field initializers run in TypeScript's order** (Rule 8.14, §26). Every initializer ran
  before the constructor's body, base first, and a derived class's initializer for a field its
  base initializes too was dropped: `class B extends A { limit: f32 = 5. }` built a `B` whose
  `limit` was `A`'s 1, where TypeScript gives 5. A base's initializers now run in its
  constructor, the derived class's parameter properties and its own initializers when
  `super(...)` returns, and those of a class that inherits its constructor when that body
  returns, so an initializer that reads `this.limit` reads what the base's constructor left.
  Measured on `main`: `B` above with `constructor() { super(); this.limit *= 10. }` over an `A`
  whose constructor adds 1 gave 20, TypeScript 50; it gives 50.

- **GLSL declares a struct before a module constant or variable of its type** (#179). The GLSL
  ES 3.00 writer emitted the constants and the top-level `let`s above the struct section, so a
  `const SPHERES: array<Sphere, 4>` or a struct-typed top-level `let` named a type that was not
  declared yet. ANGLE refused it with `'[' : syntax error` or `'Cursor' : syntax error`, on both
  stages, while Tint accepted the WGSL. The struct section now comes first. A module variable's
  struct type is also in every stage's scope, as a constant's already was, because a module
  variable is emitted into every stage: the #179 reproducer failed in the vertex shader for that
  reason alone, although only the fragment entry reads the variable. Measured on the compile
  gate's WebGL2: both stages compile and link. One golden moves, `class-syntax.fragment.glsl`,
  by the order of three lines.
- **The optimizer no longer shares a value across a write to what its callee reads.** A call's
  value depends on its arguments and on every module name its callee reads, and cse, licm and
  gvn saw only the arguments: `let a = h(x * 2.); gp = 5.; let c = h(x * 2.)`, with `h`
  reading the module variable `gp`, gave 12 at O1 where O0 gives 36, and licm lifted the same
  call out of a loop that writes `gp`. `passes/effects.ts` now keeps a second table, `fnReads`
  (the module names each function reads, through the functions it calls), and a call's roots
  include it. A helper that holds a barrier or `workgroupUniformLoad` now counts as an effect
  (it was taken for pure: `sync();` was dropped at O2 and two `ld()` were shared), and
  `workgroupUniformLoad` itself is an effectful intrinsic. DCE keeps an unread binding whose
  initializer has an effect: a write becomes the call statement it amounts to, and an effect
  that writes nothing, such as `workgroupUniformLoad`, keeps its declaration, since a
  `@must_use` builtin cannot stand as a call statement. None of these moves a golden byte.
- **`array<i32, N>(…)` and `array<u32, N>(…)` emit integer literals** (§18). The call form
  emitted `array<i32, 3>(1.0, 2.0, 3.0)`, which neither target accepts; it now types each
  element the way the list form does, one helper for both, so `array<u32, 2>(-1, 2)` is refused
  at the source.
- **The documents and comments name what the class rules and the directives accept.** The
  `TS8035` catalogue matches what #190 left refused, and surface §50 and AUTHORING.md no longer
  call `subgroups` an extension no use can derive (the subgroup built-in values derive it).
- **Test reasons cite roadmap rows by name, not line number**, and a test checks the cited row
  exists; CI's actions run on Node 24 (`actions/checkout`, `actions/setup-node` v5).

- **`capabilityMatrix` says `declarable: false` for all nine derived capabilities** (Rule 10.1,
  §50). `bgra8unormStorage` (#147, derived from a storage texture's format) and `packed4x8Dot`
  (#152, derived from the packed 4x8 calls) came back `declarable: true`, although
  `DeclarableCapability` excludes both and `module({ enables })` refuses them at compile time:
  the matrix read a hand list in `src/core/backend.ts` that still stopped at the seven kind- and
  call-derived ids, and its JSDoc still said three. The list now lives once, in
  `src/core/ir/derived-capabilities.ts`, private: `DeclarableCapability` is `Capability` minus
  its members and the matrix reads the same array, so the type and the table cannot part
  again. Measured after: eighteen rows, nine derived, nine declarable. `AUTHORING.md`'s
  capabilities section said "the seven", and says nine now; surface §50 and
  `docs/language-design.md` §10.1 state the same count. Pinned in
  `src/core/capability-matrix.test.ts`, whose expected set is checked against the type.
- **A bare `@location` parameter takes its value from a debug configuration** (`typeshade/debug`,
  `docs/debugging.md` §4). `fs(@location(0) uv: vec2)` with `"inputs": { "uv": [0.5, 0.25] }`
  ran on `[0, 0]` and returned `[0, 0, 0, 1]`: the resolver filed the value under `uv.uv`,
  the spelling it builds for a struct field, and the run read the parameter back under `uv`.
  A bare parameter is now spelled by its own name and nothing else, so the unknown-input
  sentence names `uv` rather than `uv, uv.uv`, and beside a struct field of the same name the
  bare name is the parameter and `s.uv` the field. The struct form is unchanged. Pinned in
  `src/core/debug/config.test.ts` through `startDebugSessionFromConfig` from `typeshade/debug`.
- **`TS8004` names what to do instead of a plan phase** (Rule 12.1, Rule 12.5). After
  `Unknown function "foo(a)".`, a call to a name nothing declares read
  `Function calls (Phase 6) need a visible callee.`, a pointer into a plan that finished long
  ago. The second sentence is now the remedy,
  `Declare it in this file, or import it from another shader module.`, and the code is the same.
- **The optimizer keeps what a call writes, and the debugger copies what it stores** (§19,
  §26). Each of these made the emitted shader, or the stepper, disagree with the CPU oracle:
  dead-code elimination dropped an unread `let` whole, write and all, so `const unused = next()`
  on a helper that bumps a module variable vanished from both emits while the oracle, which runs
  no optimizer, ran it (it now keeps the call as a statement); the effect table named a method's
  write by the callee's own `self_` instead of the receiver, so copy propagation read `p` where
  `const before = p` was written before `p.bump()`, and the GPU returned the bumped value where
  the oracle returned the one before; the struct-constructor fold turned `o.b = rng.next();
o.a = rng.next(); return o` into a constructor that evaluates its fields in declaration order,
  swapping the two draws, and now leaves a run with a call that has an effect as written; and the
  debug stepper bound an aggregate at `let`, `var` and assignment by reference, where the oracle
  and the codegen copy it as both targets do, so `before` showed the bumped value while stepping.
  Each is pinned in `src/compiler/ts/sequence.test.ts`, which fails with the fix taken out.
- **A product of two matrices of one non-square shape is refused at the operator**
  ([#169](https://github.com/typeshade/typeshade/issues/169)). WGSL's matrix product cancels
  the shared dimension, `matKxR * matCxK -> matCxR`, so the left operand's columns must equal
  the right operand's rows. `lowerBinary` compared the two operands' type keys and, when they
  agreed, typed the expression as the left operand — and two matrices of one non-square shape
  have one key, so nothing ever looked at their dimensions. `mat2x3 * mat2x3` compiled with
  zero diagnostics and reached Tint as `(a * b)`, which answers `no matching overload for
'operator * (mat2x3<f32>, mat2x3<f32>)'`; `binResultType` had refused the same pair in the
  `fn()` EDSL all along (`SD0001`), so the two surfaces disagreed. The check now runs on both
  spellings: `a * b` and `a *= b`, the latter also requiring the product to land back in the
  target's own shape. The compound path had a second hole of the same family — the refusal of
  `/` and `%` on a matrix lived only in `lowerBinary`, so `m /= n` and `m %= n` emitted on a
  shape WGSL gives neither operator; both are refused now. §40 said "A pair whose dimensions
  do not meet is refused, naming both shapes", which was true only of `m * v` and of two
  square shapes of different size; it is true as written now.

- **Two GLSL spellings that parted from WGSL, and two comments that misread the specs**
  (#141). `ldexp` built 2^e from ONE biased exponent, and `(e + 127) << 23` is the bit pattern
  of 2^e only while `e + 127` lands in [1, 254]. Swept against WGSL over every legal exponent,
  -149 to 128, on a WebGL2 driver with x = 1.0 and x = 0.75: the old spelling disagreed on 22 of
  278 (23 for 0.75) and the disagreements were not near misses — `ldexp(0.5, 128)` was +Inf
  where WGSL gives the finite 2^127, and below e = -127 the biased sum goes NEGATIVE, so
  `ldexp(1.0, -149)` was -1.6225928e32 where WGSL gives 0. That second, worse half was not in
  the issue. The scale is now built in two halves, which the same sweep found agrees on all 278
  for both mantissas; the alternative `e / 2` split was swept too and also agreed, and the
  comment says so in case a driver is ever found whose signed `>>` is logical.
  `pack4x8unorm`'s GLSL inline used `round()`, whose exact half GLSL ES 3.00 §8.3 lets an
  implementation resolve either way, where WGSL §17.12 DEFINES the pack as
  `⌊ 0.5 + 255 × min(1, max(0, e)) ⌋`. It now spells WGSL's own formula, which is the right
  spelling either way — but it does NOT make the pack deterministic across the two targets, and
  the first measurement that said it did was taken wrong. Eight inputs whose f32 product with
  255 is exactly an odd half were passed to a WGSL driver's native builtin as CONSTANTS, and the
  driver, the new inline and the CPU oracle all answered half-up. Tint const-evaluates a literal
  argument and answers its own way, so that says nothing about the instruction a driver issues:
  swept at RUNTIME over 511 inputs `e = f32(i) / 510`, the driver's builtin and the inline part
  on 34 of them (i = 1 packs 0 on WGSL and 1 on GLSL, i = 5 packs 2 and 3). The sweep carries
  the intermediates out losslessly, which settles the mechanism rather than guessing it: `e` and
  the f32 product `clamp(e, 0, 1) * 255` come back BIT-IDENTICAL from the two targets, so
  nothing upstream of the rounding differs; 66 of those products land exactly on k + 0.5, and on
  the 34 whose k is even the builtin answers k — the even one — while both the GLSL inline and a
  WGSL inline of the same formula answer k + 1. `pack4x8snorm` is the same picture and harder:
  509 inputs, 244 exact halves, 122 partings, and at a product of -125.5 the builtin packs the
  byte 130 (-126) against both inlines' 131 (-125). So both 4×8 packs stay `target` rows with
  the sweep in their notes; only `ldexp` leaves the column. The same const/runtime split is what
  made `ldexp(1.0, -149)` look like a subnormal. The `pack2x16*` rows stay too: those are native
  GLSL builtins defined with `round()`, and no spelling of ours reaches them.
  And the four `pack` rows are REACHABLE now. The determinism walk takes a node's float kind
  from its RESULT type, and a pack answers a `u32` of bytes, so every one of them was dropped
  before its accuracy row was consulted — a module calling all four and nothing else reported an
  EMPTY list. A pack's float kind is the one it READS, and the two `pack2x16*` rows had been
  dead the same way since the report was written. One row of that shape is left and is filed
  rather than fixed ([#175](https://github.com/typeshade/typeshade/issues/175)): a
  `textureGather` on an INTEGER texture is `filtered` for the same footprint reason a float one
  is, but `DeterminismEntry.elem` is the exported `'f32' | 'f64'` and an integer gather has no
  float kind, so reporting it widens a public union. An `it.fails` pins it.
- **The CPU oracle rounds a pack's scale in f32, the way both targets do.** `pack4x8unorm`,
  `pack2x16unorm` and `pack2x16snorm` multiplied by the scale in f64 and rounded that. A GPU
  multiplies in f32, so on a value whose f32 product lands exactly on k + 0.5 while its f64
  product lands just under, the oracle rounded DOWN where both targets round up: measured
  against the emitted GLSL inline over the 511 inputs `e = i/510`, the f64 form parted from it
  on 127 of them, and at `e = 0.8098039031028748` the oracle packed 206 against both targets' 207. An oracle that agrees with NEITHER target is the one thing it may not be. `pack4x8snorm`
  already had the `Math.fround` and documents the mechanism; its three siblings now match it.
  The `fma` comment claimed WGSL's is "a SINGLE rounding, atomic" in contrast to GLSL's
  `a * b + c`. Neither spec says that: WGSL §15.7.4.1 makes `fma` inherited from `x * y + z` and
  its note allows an ordinary multiply then an ordinary add, and GLSL ES 3.00 §4.5.1 allows the
  same two-step. The comment now states what both specs allow, and keeps the real point — that
  the `fma` spelling is the form Apple/Metal has not been observed to fold back into a plain f32
  product — as the observation about a compiler that it is. `const-fold`'s `EXACT_BUILTINS`
  comment now names `fract` as the entry whose exactness was checked rather than assumed:
  `fract` of a tiny negative may be 1.0 or the f32 below it, and measured,
  `fract(-1e-30)` is exactly 1.0 on WGSL AND on a WebGL2 driver, with the fold agreeing.
- **The ambient library declares what the compiler lowers** (§49, #157). Four rules the editor
  stated more NARROWLY than the compiler, which is the worse of the two drifts: red squiggles on
  a program that compiles. `select` takes any scalar or vector WGSL gives it, bools and bool
  vectors and emulated doubles included, where `T extends Numeric` refused the first two; the
  vector constructors take a component vector anywhere rather than first only, so `vec3(x, v2)`,
  `vec4(x, v2, w)` and `vec4(x, y, v2)` are clean in the editor as they always were in the
  compiler; and a cast takes a `bool` (`f32(true)` is 1.0), except `f64`, which widens an `f32`
  and takes nothing else. A new `ambient-parity.test.ts` asserts the AGREEMENT rather than
  either verdict, with rows on both sides — a row where both refuse is as much the subject as
  one where both accept, and several rows the audit listed as disagreements
  (`normalize` of a scalar, `sign` of an unsigned vector, `ldexp` with a float exponent,
  `arrayLength` of a fixed array) turned out to agree already and are pinned so.
  TWO rows are left disagreeing on purpose, with the cost measured: `vec4(x, v3)` and
  `vec4(v2, v2)` are real WGSL the compiler takes, and declaring either adds a second
  TWO-argument `vec4` overload, which costs TypeScript the contextual type it uses to infer
  through vector arithmetic — `vec4(mix(c * 0.5, d, 0.5), 1.)` then reports TS2769 on a program
  that compiles, because `mix` infers from the `number` the arithmetic erased rather than from
  the `vec3` the context supplied. `vec4(c * 0.5, 1.)` is far more common than either, so the
  editor is better off without them until the #43 filter can restore a shape through a nested
  call; both are pinned as `it.fails`. A binding declared with a TYPE LITERAL rather than an
  interface is still refused by both layers: accepting it means synthesising an anonymous
  struct, which is a compiler feature rather than a parity fix, and it is pinned as it stands.
- **Compare-exchange, the uniform load and the texture barrier** (§48, #152).
  `atomicCompareExchangeWeak(x, cmp, val)` stores `val` only when the location holds `cmp` and
  answers a STRUCT — what the location held before, and whether the store happened. WGSL gives
  that struct no writable name: measured on Tint, a variable declared with
  `__atomic_compare_exchange_result<u32>` is "invalid type for variable declaration", and
  `r.oldValue` is "struct member oldValue not found". So the result is bound by inference, its
  fields are spelled `old_value` and `exchanged` the way the target spells them, and NO struct
  declaration is emitted — WGSL's is built in, and declaring one would shadow it. The type
  exists in the IR and in the editor and in neither backend's output. `workgroupUniformLoad(w)`
  reads one value out of workgroup memory with a barrier on each side, so it carries a
  barrier's placement rules (Tint: "'workgroupUniformLoad' must only be called from uniform
  control flow") and takes a place in `workgroup<T>` memory rather than storage ("no matching
  call to 'workgroupUniformLoad(ptr<storage, u32, read_write>)'"); a render entry needs no rule
  of its own, because a workgroup variable read from one is already refused where it is read.
  `textureBarrier()` joins `workgroupBarrier` and `storageBarrier` with the same two rules, and
  belongs to the `readonly_and_readwrite_storage_textures` language feature, which
  `reflect().requiredLanguageFeatures` reports — it compiles with no storage texture in sight,
  so nothing else in the module says so. All three are WebGPU-only and fail closed on GLSL ES
  3.00, which has no compute stage. `examples/compute-sync.shade.ts` is the gate witness,
  registered `renderable: false`. The oracle does not exercise the "weak" in the name: it runs
  one invocation at a time, so a comparison that holds cannot be beaten to the location, and
  the retry loop WGSL documents is correct on a device and here.
  While adding that example the compile gate caught `'shared' is a reserved keyword` from Tint
  with no diagnostic from the compiler first: the identifier sanitiser guards GENERATED names
  only, so an author's local named after a WGSL reserved word reaches the driver unchanged. The
  example renames its own local and says why; closing the gap is its own change.
- **The packed 4x8 integer builtins** (§47, #152). Eight builtins that read a `u32` as four bytes
  or write four back — `dot4U8Packed`, `dot4I8Packed`, `pack4xU8`, `pack4xI8`, their two `Clamp`
  twins, `unpack4xU8` and `unpack4xI8` — were each an unknown name. They are authorable now,
  with the types WGSL gives them: the unsigned dot is a `u32` and the signed one an `i32`, but
  BOTH packs answer a `u32` — the signed pair included (index.bs:20307, :20341), because the
  result is four bytes in a word and not a number with a sign — and a plain pack TRUNCATES each
  component to its low byte while the `Clamp` form saturates first. Typing the signed packs
  `i32` emitted WGSL Tint refuses ("cannot assign 'u32' to 'i32'"). The
  values are not read off a specification: each call was DISPATCHED on a real device and the
  buffer read back, and the CPU oracle was written to those numbers — `dot4U8Packed(0x01010101,
0x01010101)` is 4, `dot4I8Packed(0x80808080, 0x01010101)` is -512,
  `pack4xU8(vec4u(0x1FF, 0, 0, 0))` truncates to 0xFF, `pack4xU8Clamp(vec4u(400, …))` saturates
  to the same byte, and `unpack4xI8(0x04FD02FF)` is (-1, 2, -3, 4).
  GLSL ES 3.00 has no form of any of them, so a module using one derives the new
  `packed4x8Dot` capability and fails closed there with the capability named, while its WGSL
  half still emits. On the WGSL side there is NOTHING to declare, and the issue's expectation of
  an `enable` directive is measurably wrong: Tint refuses `enable
packed_4x8_integer_dot_product;` as not an extension ("Possible values: 'clip_distances',
  'dual_source_blending', 'f16', 'primitive_index', 'subgroups'") and compiles every one of the
  eight with nothing declared. It is a WGSL LANGUAGE feature, so the emitted module carries no
  directive and `reflect().requiredLanguageFeatures` reports
  `packed_4x8_integer_dot_product` for a host to check on `navigator.gpu.wgslLanguageFeatures`.
  A file that declares its own function under one of the eight names keeps the call to its own
  function, and then needs neither the capability nor the language feature.
  `examples/packed-bytes.shade.ts` is the gate witness, registered `renderable: false`.
- **An unsigned texel coordinate reaches GLSL in a form it takes** (§46, #147). WGSL types a
  texel coordinate `i32, or u32` and this surface accepted both, but GLSL's `texelFetch` has no
  unsigned overload: measured on a WebGL2 driver, `texelFetch(t, uvec2(0u, 0u), 0)` is "no
  matching overloaded function found" while `texelFetch(t, ivec2(uvec2(0u, 0u)), 0)` compiles.
  So `textureLoad(t, vec2u(...), 0)` compiled clean here and failed on WebGL2. An unsigned
  coordinate now takes an id that wraps it in the signed constructor of the texture's own width,
  on the 2d, 3d and array forms; a SIGNED coordinate keeps the ids every existing program
  already uses, so no emit that worked moves a byte.
- **A texture is asked about a level, a storage array about its layers, and a gather about a
  const** (§46, #147). `textureDimensions(t, level)` was `expects 1 argument(s), got 2` while
  the GLSL column had spelled `textureSize(t, int(level))` all along — measured accepted on
  Tint and on WebGL2, including with a non-constant level. `textureNumLayers` on a
  `texture_storage_2d_array` answered "takes a sampled texture; … has no sampler", the wrong
  answer and the wrong reason; it is a `u32` now, WGSL-only like the rest of the storage family.
  And `textureGather`'s component takes a module `const`, because WGSL asks for a
  const-expression rather than a literal (a local is still refused: its value is not known until
  the shader runs).
- **`bgra8unorm` storage, behind the capability the device makes it need** (§46, #147). The
  format list held the sixteen a device stores to with nothing requested, because a format
  outside them compiles on Tint and then fails at `createBindGroupLayout`. `bgra8unorm` is the
  seventeenth and the first that is not core: measured on two independent Chromium builds, a
  device with no feature requested refuses it ("Texture format TextureFormat::BGRA8Unorm does
  not support storage texture access StorageTextureAccess::WriteOnly"), a device that requested
  `bgra8unorm-storage` takes it at `write`, and BOTH refuse it at `read` and at `read_write`.
  Tint compiles every one of those spellings, so no shader compiler and no compile gate can
  tell them apart. So the format is authorable at `write`, refused at the other two with the
  reason that is about this format, and derives the new `bgra8unormStorage` capability from the
  binding's own format — which is how `reflect().requiredFeatures` tells a host which feature
  to request.
- **`reflect().requiredLanguageFeatures`** (§46, #147). A WGSL LANGUAGE feature is not a device
  feature: it is not requested at `requestDevice`, it is either in the browser's WGSL
  implementation or not, and a host checks for it before it creates the shader module.
  Reflection now reports `readonly_and_readwrite_storage_textures` when the module binds a
  storage texture at `"read"` or `"read_write"`. Measured on Chromium:
  `navigator.gpu.wgslLanguageFeatures` reports the name, the module compiles with and without a
  `requires` directive, and a `requires` naming a feature the browser lacks is refused — so the
  check belongs at the host and the emitted source carries no directive.
- **A storage `textureDimensions` takes no mip level** (§46, #147). The sampled and depth
  textures gained the two-argument form with this item; a storage texture must not have it, and
  the difference is measured rather than reasoned: Tint answers `no matching call to
'textureDimensions(texture_storage_2d<r32float, read>, u32)'` against 33 candidates, because a
  storage texture has exactly one mip level. The extra argument is refused where it is written.
- **The ambient texture declarations describe what the compiler lowers** (§46, #147). `E` is
  constrained to `f32`, `i32` and `u32` ("T must be f32, i32, or u32"), so `texture_2d<bool>` is
  red in the editor as it always was in the compiler; `textureLoad` and `textureGather` are
  typed by the texture's element — the ARRAY gathers included, which declared the element
  parameter and then returned a plain `vec4` anyway — so a fetch or gather from a
  `texture_2d<u32>` is a `vec4u` in both layers rather than a `vec4` in one; every texel coordinate takes either integer vector; and
  the level query and the storage layer count are declared. Each of these was a program one
  layer accepted and the other refused.

- **The two portable spellings that were not** (§45, #154). `abs` and `dot` carried no registry
  entry, which claims a builtin spells the same on every target. Measured on a WebGL2 driver,
  `abs(uvec3)`, `abs(uint)`, `dot(ivec3, ivec3)` and `dot(uvec3, uvec3)` are each "no matching
  overloaded function found", while `abs(ivec3)` and `dot(vec3, vec3)` compile — so the claim
  held for most forms and not for two, and a shader using either emitted GLSL that no WebGL2
  context would take. An unsigned `abs` is now the identity on GLSL (which is what it is), and
  an integer `dot` becomes a `_idot` helper with one overload per vector type the module uses —
  a helper rather than an inline sum, because an inline splices both arguments once per
  component after every optimizer pass has run. The signed `abs` and the float `dot` keep the
  portable spelling. The choice is one exported rule, not one per front end: the `fn()` node
  graph is the other authoring surface, and while it built the portable id it kept emitting the
  same `abs(uvec3)` and `dot(ivec3, ivec3)`. It now asks the same function, and an integer `dot`
  there returns the integer kind its operands share instead of an `f32` the value never was.
  `examples/integer-math.shade.ts` is the gate witness: its GLSL half links only because of
  this.
- **The scalar conversions take a scalar, and a literal that fits** (§45, #154). `u32(-1)`
  emitted `u32(-1.0)` — a negated literal is not a literal, so the fold that retypes one never
  saw it — and Tint accepts that while refusing the `u32(-1)` the author wrote; it is now
  `u32(-1) is out of range: a u32 holds 0 to 4294967295, and the two targets compute different
values for a float that does not. …`, with the two numbers each of them answers and a `clamp`
  example carrying the TARGET's own bounds. The refusal is for FLOATS, because that is where the
  two targets disagree: measured, `u32(-1.)` is 0 on WGSL and 4294967295 on GLSL ES 3.00, and
  `u32(4.3e9)` is 4294967295 there and 5032960 here. It reaches a `const` REFERENCE as well as a
  spelled-out literal, which is the shape that actually got to a driver — const propagation
  writes the value into the call before either backend sees it — so a negated literal, an alias
  of another const and a `Math.floor(…)` initializer are all values the rule can see. A RUNTIME
  conversion is untouched: `let k: i32 = -1; u32(k)` stays a call, bit-preserving on both.
- **An integer conversion is folded, not range-checked** (§45, #154). `u32(i)` on an `i32` is a
  bit REINTERPRETATION, and both targets perform it and agree: measured, `u32(-1i)` compiles on
  Tint and is 4294967295, and a WebGL2 driver compiles `uint(-1)` and answers 4294967295 too.
  What Tint refuses is the unsuffixed `u32(-1)`, because an unsuffixed integer literal is an
  ABSTRACT integer and an abstract integer must be representable in its target — a fact about
  the spelling, not about the program. This backend writes `u32` literals with their `u` and
  `i32` literals with no suffix, so once const propagation had substituted a negative `i32`
  constant into a `u32()` call, the module Tint saw was the one it refuses, with nothing in the
  author's file saying `-1`. The conversion is now folded to the literal it yields — `u32(-1)`
  is emitted as `4294967295u` — so no spelling Tint refuses is produced and no legal program is
  turned away. The fold WRAPS the way the hardware wraps, through the same helper the const-fold
  pass uses: the compile-time folder worked in doubles while the pass worked in 32-bit integers,
  so the two disagreed about the same expression (`i32 100000 * 100000` is 1410065408 on both
  targets and 10000000000 in doubles, `i32 1 / 2` is 0 there and 0.5 here), and every rule that
  compares a compile-time value against what the GPU will compute was comparing the wrong one.
- **The scalar conversions, continued.** `f32(vec3(...))` was accepted by
  the surface, refused by Tint ("no matching constructor") and compiled by a WebGL2 driver as
  `float(vec3)`, which silently takes `.x` — the two targets disagreed about whether the
  program existed, and it is now `f32() takes a scalar; got vec3<f32>.` An emulated double is a
  scalar for this rule, so `f32(f64(x))` is unchanged. An integer-written literal in a builtin
  with no float form types as `i32`, the way WGSL materialises an AbstractInt, so
  `countOneBits(5)` compiles where it used to be refused as an `f32`; `countOneBits(5.)` keeps
  its refusal. On the CPU oracle, `length(e)` and `distance(e1, e2)` answer for a scalar (WGSL
  defines them as `abs(e)` and `abs(e1 - e2)`, and both targets compile them) where the oracle
  threw `v.reduce is not a function` on a program the GPU ran. `abs(-2147483648)` on an `i32`
  is recorded rather than fixed, with the reason, and pinned as an `it.fails`.

- **Every texture argument is checked before emit** (§42, #145). WGSL types each plain argument
  of a texture read exactly, and only the WIDTH of a coordinate and a whole-number LITERAL were
  checked, so anything else went through untouched: `const l: i32 = 2` as a level emitted
  `textureSampleLevel(t, s, p.xy, 2)`, an `f32` layer emitted
  `textureSampleLevel(t, s, p.xy, 1.0, 0.0)`, `textureSample(t, s, vec2i(0, 0))` emitted an
  integer sampling coordinate, `textureLoad(t, vec2(0., 0.), 0)` a float fetch coordinate,
  `textureSample(ramp, smp, u32(2))` on a `texture_1d` emitted `2u`, and a storage texture's
  coordinate was checked by nobody at all — Tint answers "no matching call" to each about
  generated code, and GLSL ES 3.00 silently rounds. An author now reads one sentence naming the
  cast in their own file: `textureSampleLevel level must be an f32; got i32. Write f32(l).`,
  `textureStore on a texture_storage_2d<rgba8unorm, write> takes a vec2 coordinate; got
vec3<i32>.` A sampled read takes a normalised `f32` coordinate, a texel fetch a whole `i32` or
  `u32` one, a layer, mip level and sample index an integer, and a `level`, `bias` and
  `depth_ref` an `f32`. A BARE number is still retargeted rather than refused, because it has no
  type of its own on this surface — `textureSampleLevel(t, s, uv, 0)` still emits `0.0` and
  `textureStore(dstArr, at, 0, v)` still spells its layer `0` — but an explicit `i32(0)` is
  answered like any other `i32` instead of having its cast silently deleted. The whole family
  now carries one code, `TS8041`: the width check and the fractional-literal check were
  `TS8003` before, and splitting one sentence shape across two codes gave no caller a reason to
  care. The TEXTURE being wrong — a sampled texture handed to `textureStore`, an access mode
  that forbids the call — stays `TS8003`.
- **The stage a texture read and an atomic belong to** (§43, #145). Three WGSL rules are now
  checked at the entry, over the call graph, with the chain named. `textureSample` and
  `textureSampleArray` join the front end's fragment-only table, which already held the bias and
  comparison forms, so a vertex entry sampling a plain 2D texture reads the front end's sentence
  and a span in its own file rather than the backend lint's `SD0109`; the lint's own table gains
  the thirteen ids it was missing (the three bias forms, the four comparison forms and the six
  coarse and fine derivatives), so the two layers now hold the same nineteen. `textureStore` was
  the only member of the fragment-or-compute table; it now holds every `atomic*` builtin
  ("Atomic built-in functions must not be used in a vertex shader stage", wgsl.txt:25422), read
  off the intrinsic catalogue so one added there is covered by existing, and ANY call touching a
  storage texture declared `"read_write"` — a read, a `textureDimensions`, a `textureNumLayers`
  — recognised by the argument's own type, because that rule is about the RESOURCE and
  `textureLoad` is the id a sampled texture uses too. A `"read"` storage texture and every
  sampled fetch stay legal in a vertex entry. The refusal is `"atomicAdd" is only valid in a
fragment or compute shader; "vs" is a vertex entry. WGSL allows an atomic built-in in a
fragment or compute stage only.`; `textureStore`'s wording moved from "is not valid in a
  vertex shader" to the same shape. `FRAGMENT_ONLY_CALLS` and the new
  `FRAGMENT_OR_COMPUTE_CALLS` are exported for the derivative-uniformity walk to seed from, and
  the front end's table and the lint's are pinned EQUAL by a test that derives what they should
  hold from the intrinsic catalogue, with every fix string pinned beside it. No emit changed:
  the compile gate's whole corpus (91 examples at this commit) is byte-identical.

- **A hover at the end of a name answers for that name**
  ([#56](https://github.com/typeshade/typeshade/issues/56)). The language service resolves a
  hover through `nodeAtPosition`, whose span test is half-open, so one offset past `k` in
  `let k = 1.` was the whitespace after it: the service fell through to TypeScript's quick
  info and answered `let k: number` where the compiler lowered an `f32` — the very answer the
  symbol-table hover replaced. The end of a name is where an editor leaves the caret after
  typing it. `getHover` now resolves through `touchingNodeAtPosition`, which mirrors
  `ts.getTouchingPropertyName`: a position inside a token still belongs to that token, and only
  one that lands in no identifier answers for the identifier ending exactly there. A local, a
  parameter and a struct field are each pinned at `name.end`. `nodeAtPosition` keeps its
  half-open rule for completions, rename and the TS1206 filter, which are written against it.
- **A name a target reserves is reported where it is written** (§62,
  [#103](https://github.com/typeshade/typeshade/issues/103), `TS8068 RESERVED_NAME`). A struct
  field named `half` compiled to WGSL Tint accepts and to GLSL ANGLE answers with
  `'half' : Illegal use of reserved word` — a line number in generated text, for a word the
  author wrote on a line of their own; the same held for a module constant, an override, a
  module variable, a struct's own name and, on the WGSL side, for each of the 146 tokens that
  spec reserves for future use. (A binding was already refused, but by the GLSL writer, with
  only the file's directive to point at.) The check runs on the name the emit CARRIES, so a
  class's static field is judged as `Cls_member` and a namespace's member as `Ns_member`, and
  the message names both spellings when they differ while underlining what the author typed;
  all three spellings of a struct are read, since a `class`, an `interface` and a `type` alias
  are one struct to the emitters. The severity follows the target's role: a WGSL word is an
  error, because WGSL is the program, and a GLSL ES 3.00 word a warning, this package's
  existing answer for "the second target cannot take this module" — `wgsl` stays, `glsl` comes
  back undefined, and the GLSL writer fails the emit closed on the same names, so a module that
  would not have produced GLSL anyway is never refused outright for a word it never emits. A
  compute kernel has no GLSL form at all and is not held to that list: `examples/array-length.shade.ts`
  now carries the `half` field and Tint takes it on every gate run. What the GLSL writer renames
  for itself — a local, a parameter, a function name — is not reported. Both lists are the
  target's own: WGSL's 26 keywords and 146 reserved words transcribed from the spec source,
  GLSL ES 3.00's read off ANGLE's version-gated lexer at shader version 300, which is why
  `buffer`, `shared` and `packed` are absent — all three are spellings a WebGL2 driver accepts
  and a later spec does not. Each language's SHAPE rules are read too: `__` at the front and
  the bare `_` for WGSL, and `gl_` at the front or `__` anywhere for GLSL ES 3.00, both
  measured on ANGLE rather than read off the spec.
- **The GLSL writer's rename can no longer land on a name already in scope**
  ([#103](https://github.com/typeshade/typeshade/issues/103)). `sanitizeReservedIdents` renames
  a local, a parameter or a function whose name GLSL ES 3.00 reserves, and it chose the new
  spelling knowing only the function's own names: a local named `float` beside a module
  constant named `float_` became two `float_`s in one scope, and the GLSL compiled cleanly and
  answered `4` where WGSL and the CPU oracle answered `12`. The rename now sees every
  module-scope name, and it numbers the suffix (`float_1`) instead of repeating the underscore,
  because `float__` is itself illegal: measured on ANGLE, an identifier containing `__` is
  "reserved as possible future keywords". The pass also renames a helper named `main`, which
  had been emitting a second `main` beside the stage entry of that name.
- **A `bool` module const that is neither true nor false is refused on its declaration**
  (§12, [#64](https://github.com/typeshade/typeshade/issues/64)). `const K: bool = 2` reached
  the fail-closed bool arm of each writer's `literal` and came back as
  `TS8015 Backend emit failed: … [SD0017]: bool literal 2`, anchored on the file's
  `"use typeshade"` directive — the one line that says nothing about the declaration — while
  its integer siblings have reported `TS8003` on the declaration since #17. The check now sits
  beside theirs at lowering: `true`, `false`, `1` and `0` still emit, and anything else is
  `Module const "K" is bool, but 2 is neither true nor false. Write true, false, 1 or 0.` on
  the `K: bool = 2` it underlines. Like the integer arms, the constant is not defined, so each
  use adds its own `TS8022`; the writers' `SD0017` arms stay, since the `fn()` EDSL surface can
  hand them a `ConstDecl` carrying anything.
- **Three texture programs Tint refused compiled clean.** `textureSample` on a
  `texture_cube_array` in a vertex or compute entry (the cube-array id was in neither
  fragment-only table) is now refused under the written name like the other implicit-LOD
  forms; `textureStore` in a vertex entry, or in a helper one reaches, is refused in one sentence
  (WGSL allows a texture write in a fragment or compute stage only); and the layer of
  `textureLoad` and `textureStore` on a `texture_storage_2d_array` is retyped to an integer, so
  a bare `0` no longer emits `0.0`. Found by the spec audit's test critique and confirmed with
  `compile()` on main.
- **`getDiagnostics` lists the two halves in document order.** The language service appended
  every TypeShade diagnostic after every TypeScript one, so a problem list could read 28:1
  before 27:3. The merged list is now sorted by span start, then span length, then source.
- **`compileTsSources` keeps the structs, bindings and overrides `compileTsSource` accepts**
  ([#74](https://github.com/typeshade/typeshade/issues/74), roadmap 0.5 item 14). The multi-file
  entry point lowered functions and module constants and collected nothing else, so a one-file
  program with a `class` struct, a `declare const atlas: texture_2d<f32>` or a
  `declare let heights: storage<array<f32>>` compiled through `compile()` and was refused
  through `compileTsSources` with "Unknown identifier", and a two-file program with either could
  not be compiled at all. Every file's structs, bindings and overrides are collected and merged
  now, a multi-file program being one module: a name two files declare is reported once, naming
  both, each file's `declare` bindings are numbered after the earlier files' so two firsts do
  not share a slot, and the result reports `structs`, `bindings` and `overrides`. Module
  constants keep the entry-only rule.
- **`@compute(...)` refuses an argument it cannot read instead of defaulting to 64**
  ([#118](https://github.com/typeshade/typeshade/issues/118), `TS8037 WORKGROUP_ARG`).
  `@compute({ workgroup: [8, 8, 1] })`, `@compute(128)`, `@compute("big")` and `@compute(SIZE)`
  compiled with zero diagnostics and emitted `@workgroup_size(64)`, so the author asked for one
  size and dispatched against another. The decorator is now read from its AST: `@compute` and
  `@compute()` keep the default of 64, an array literal of one to three whole numbers (across
  lines, or through `as const`) is the size, and anything else is reported at the argument in
  one sentence naming the form. The y/z rule (`TS8026`) is unchanged.

- **A conditional on a struct or a fixed-length array emitted code both backends reject** (§31,
  [#113](https://github.com/typeshade/typeshade/issues/113)). `c ? a : b` on two structs compiled
  with zero diagnostics and emitted `select(Ray, Ray, bool)` on WGSL, which Tint refuses —
  `select` is declared for a scalar or a vector, and WGSL has no ternary — and `((c) ? r1 : r2)`
  on GLSL, which a WebGL2 driver refuses too: `'?:' : ternary operator is not allowed for
structures in ESSL 1.0 and webgl`, and the same for arrays. That second half corrects a
  reading of the ES 3.00 spec, whose ternary takes any two operands of one type; the driver is
  what the emitted code has to satisfy. Neither target has an operator, so the rewrite is
  neutral and runs in the shared pipeline: the conditional is hoisted into a slot and an `if`,
  exactly as a multi-arm conditional expression is hoisted into a slot and a `switch`. A helper
  function would have been shorter and wrong — its arguments are evaluated before the call, so
  both arms would run, and an arm holding a call that discards would discard unconditionally.
  The `if` also retires a documented under-fix in the ANGLE workaround pass, which used to skip
  a conditional's arms for that reason and now hoists inside the branch. A scalar or vector
  conditional keeps the operator each target has, and the CPU backends read the IR and need
  none of it. `examples/pick-composite.shade.ts` joins the corpus
  so the gate compiles the shape on both targets from now on — nothing in it did before, and the
  constant folder hides the easy case, so it takes a runtime condition AND two distinguishable
  arms to reach.
- **The README's `tsconfig.shade.json` loads `typeshade/shade`.** Copied as written into a
  fresh project with `typeshade` installed, it failed with TS2688 (no type definition file for
  `typeshade/shade`) and TS2318 for `Array` and nine more global types, so no shader was
  type-checked at all. `typeshade/shade` is a subpath export, and TypeScript 5.x falls back to
  `node10` resolution, which does not read `exports`. The snippet now sets `"module": "esnext"`
  and `"moduleResolution": "bundler"`, and the README says why. Copied again, it leaves exactly
  the two error classes the README documents: TS1206 on decorators, and operators on vectors.

### Changed

- **Four sentences in the surface document, and three code comments, now say what main does**
  (#159, from the WGSL spec audit #144). Each was re-measured on this tree before it was
  rewritten. §8's field-metadata paragraph said `@size`, `@offset`, `@interpolate` and `@ignore`
  "parse but do not reach the emitted struct yet"; all four are `TS8028 Unknown attribute`, and
  the `@interpolate("linear")` in the example above it now carries the `(target)` marker
  `@align(16)` already had. §11 said `transpose` has no `f32` form — it and `determinant` take a
  `mat4` on both targets and have since roadmap 0.2 item 8; what is missing is the rest of the
  matrix table, which is now a roadmap row. §13 said a `u32` module constant is emitted as
  `const N: u32 = 16.0;` — it is emitted as `16u`, and the issue that paragraph described was
  fixed by #17. In the source: the ambient library's cube-texture JSDoc still said the editor
  refuses `texture_cube<u32>`, which stopped being true when `textureGather` admitted an integer
  cube; `ModuleDecl.enables` described `DeclarableCapability` as excluding "the three ids derived
  from the module's own shape" when it excludes seven; and the GLSL capability table said "FIVE
  of the six fail closed" when nine capabilities have no GLSL row and eight fail closed.
- **`renderable: false` now states WHY** (#155). A `.shade.ts` registration that claims no GLSL
  ES 3.00 form carries the refusal it expects, and `shade-examples.test.ts` checks it rather than
  accepting any refusal — so an example that loses its GLSL form for a NEW reason keeps a flag
  that no longer means what it says.
- **`examples/block-scope.shade.ts` carries a float `%=` on a vector to the gate** (§22,
  [#20](https://github.com/typeshade/typeshade/issues/20)). The compound-assignment emit sites
  route a float `%` through the backend's `floatMod` spelling at any width, but the corpus
  carried the scalar only, so the vector form — `cell %= 1.`, which WGSL keeps as the operator
  and GLSL ES 3.00 takes componentwise as `(cell - 1.0 * trunc(cell / 1.0))` — was pinned by a
  unit test and by no driver. The example now carries both, and Tint and a real WebGL2 driver
  compile each of them on every run of `bun run gate:compile`.
- **A method that changes its object takes it by reference** (§26). It took the struct and
  RETURNED it — `Particle_step(self_in: Particle, dt: f32) -> Particle` opening with
  `var self_ = self_in` and closing with `return self_` — and the call site read the receiver,
  called, and stored the result back: three copies of a struct for one method that moves a
  point. The reason the source gave was that both targets take a struct by value "so the IR is
  unchanged". Measured on real Tint and a real WebGL2 driver, both targets have something
  better: GLSL ES 3.00 has `inout Particle self_`, which takes any l-value argument, an array
  element included; WGSL has a pointer, `self_: ptr<function, Particle>`, read through as
  `(*self_)`, and it accepts `&ps[i]` into a `ptr<storage, …, read_write>` parameter.
  `FuncDecl.params[i].mode` now says which parameters a callee writes through, and each target
  spells it its own way. The call is a plain statement; nothing about the source changed.
- **The WGSL backend gives such a function one copy per address space its calls use.** The
  address space is part of a WGSL pointer's type, so a method called on both a local and a
  storage element is emitted as `P_bump_function` and `P_bump_storage`, each call naming the
  one it needs; one space and the function keeps its plain name. It is the backend's own pass
  and reaches neither the IR nor the GLSL, which writes one `inout` function.
- **The effect table counts a write through a reference** (§19). A write to a parameter used to
  read as "owned", which was true while every parameter was by value; with `inout` it is the
  caller's own value being written, so the callee is a writer and its call statement is not dead
  code. A callee's name for it means nothing to the caller, so it is translated:
  `ps[gid.x].step(dt)` writes `ps`.
- **`examples/orbit-inout.shade.ts`** joins the corpus: the render twin of `particle-step`, so
  the gate compiles AND links the `inout` spelling on a real WebGL2 driver rather than only
  checking WGSL on Tint.

### Added

- **Generics on a function, by monomorphisation** (§30, roadmap 0.3 item T9,
  [#92](https://github.com/typeshade/typeshade/issues/92)). Neither target has generics, so a
  generic declaration is compiled once per set of argument types the file calls it with:
  `pick<T>` on an f32 and on a vec3 emits `pick_f32` and `pick_vec3`, and nothing called `pick`.
  Two calls at the same types reach one instance, a generic nothing calls emits nothing, and a
  generic calling a generic instantiates both. A type parameter is a type wherever a type is
  written — a parameter, a return, inside `array<T, N>`, a local — and shadows a type of the
  same name. The type arguments come from what the call writes, `id<u32>(1)`, or from what its
  arguments show; a parameter neither form reaches is refused, naming the type argument as the
  fix. The substitution binds the name where a name becomes a shader type rather than rewriting
  the source. `examples/generic-helpers.shade.ts` is the gate's evidence, on Tint and on WebGL2.
  A generic CLASS is not here yet.

- **The mixin pattern, run when the file is compiled** (§29, roadmap 0.3 item T8,
  [#92](https://github.com/typeshade/typeshade/issues/92)). `class TintedDisc extends
Tinted(Disc)` is a class whose base is decided by running a function; TypeScript runs it at
  run time and gets a constructor, and there is no run time here, so it runs at compile time and
  gives a list of members. A mixin is a function whose body is one `return class … { … }`, whose
  class expression may extend the function's own parameter, a declared class, or nothing. Its
  members are spliced into the class that applied it, behind the base's and ahead of that class's
  own, which is the order TypeScript's mixin produces; chains nest innermost first, and
  `const Mixed = Aged(Particle)` names an application a class may extend. A mixin may carry a
  constructor (`super(…)` included), a static function, a decorated field that reaches entry I/O,
  and a method reading a base field. Nothing named `Tinted(Disc)` reaches the emitted code: it is
  no layout a value has, and dispatch is static, so each applying class carries its own copy of
  the methods. A name declared twice in the chain is an override, closest to the value winning;
  two fields of that name with different types are reported rather than picked between.
  `examples/mixin-surface.shade.ts` is the gate's evidence, on Tint and on WebGL2.
- **`AnyClass` in the ambient lib**: `new (...args: any[]) => object`, the constructor type
  TypeScript needs before it will take `class extends Base`. A mixin has to type-check in the
  editor before it compiles, and this is so a shader author does not have to know the
  incantation; declaring your own, as the TypeScript handbook does, reads the same to the
  compiler, which never looks at the constraint.

- **A tuple, a literal union and a brand are shapes TypeScript writes and the GPU already has**
  (§28, roadmap 0.3 item T10, [#92](https://github.com/typeshade/typeshade/issues/92)). A tuple
  is a list of a length the type fixes, which is what `array<T, N>` is, so `[f32, f32]` IS
  `array<f32, 2>`, named elements included; both targets take it wherever the array goes, a
  return included, spelled `array<f32, 2>` on WGSL and `float[2]` on GLSL ES 3.00. A union whose
  members all name one type names it too: `0 | 1 | 2` is an `i32`, `0.5 | 1.5` an `f32`,
  `true | false` a `bool`. A brand, `f32 & { readonly [m]: 'm' }` with
  `declare const m: unique symbol`, is erased: the parameter is an `f32` and the `declare`
  reaches no binding. `examples/tuple-and-brand.shade.ts` is the gate's evidence, on Tint and on
  WebGL2.
- **A list takes its type from the position it is written in.** It was accepted in a `const`
  with an array annotation and nowhere else; a return declared `array<f32, 2>`, an argument
  whose parameter declares one, and a struct field take it now. Every such position already
  carried its declared type into the expression lowering.
- **The examples show all three struct spellings** (§2): 32 example files declared a `class`,
  none declared an `interface` or an object type alias, and 14 of those structs were plain data
  with no decorator and no method. `hello-camera.shade.ts` declared `class Camera` while §2
  illustrates the same struct, by name, as `type Camera = { ... }`, so the document and its own
  example disagreed. `hello-camera` now matches §2 and one twin's uniform block is written as an
  interface. Nothing could have caught this: the three spellings produce the identical
  `StructDecl`, so the WGSL, the GLSL and the reflection are byte-for-byte the same, and the
  goldens confirm it, none of them changed. `examples/struct-spelling.test.ts` is the check,
  since a reader is the only instrument that sees the difference.
- **An entry's return: two constraints removed, one moved into the compiler** (§3,
  [#86](https://github.com/typeshade/typeshade/issues/86)). Checked against real Tint, five
  shapes compiled with zero errors and were rejected by the backend, and one that Tint accepts
  silently lost its WebGL2 target.
  - A **fragment** entry's bare return takes `@location(0)` at any width. Only `vec4` got the
    attribute before, so a bare `f32`, `vec2` or `vec3` emitted WGSL with no entry-point IO
    attribute on the return, which Tint refuses.
  - A **vertex** entry returning a bare `vec4` keeps its GLSL ES 3.00 target. The emitter
    refused every bare non-struct vertex output because a bare VARYING cannot link by name
    across the stages; a return carrying a builtin is `gl_Position`, links nothing, and is the
    simplest vertex shader there is. The refusal now covers only the varying it was written for.
  - A **vertex** entry that produces no position is refused where it is written: a struct return
    with no `@builtin("position")` field, a `void` return, and a bare type that is not a `vec4`.
    Each compiled clean before and was refused by Tint with "a vertex shader must include the
    'position' builtin in its return type".
  - New example `bare-position`, the smallest render pair, so the compile gate proves the pair
    compiles on Tint and links on WebGL2.
- **A class inside a `namespace`** (§26, [#107](https://github.com/typeshade/typeshade/issues/107)):
  a class there was "a class inside "N" has no flattened form. Declare it at the top level of
  the file", which was the one place left where declaring a class and constructing it did not
  work. It takes the same `Ns_member` flattening a function and a constant already take, so the
  struct is `N_P`, a method `N_P_at`, the constructor `N_P_new`, and `new N.P(...)` and
  `new P(...)` inside the namespace both call it. Nesting nests the name, and a namespace struct
  works as a field, a parameter, a return and a binding type. Two shapes are refused rather than
  guessed at: a short name two namespaces both declare, and, where a top-level declaration
  shares the name, the top-level one wins and the other is written `N.P`.
- **`new` says why, and a class of statics alone no longer emits a broken constructor** (§26,
  [#86](https://github.com/typeshade/typeshade/issues/86)): a `new` on anything but a declared
  class said "`new` allocates a JS object" first, which reads as a ban on `new` itself and sent
  a reader looking for a workaround they did not need. A class the file declares is built with
  `new`, and always was. Each refusal now names its own reason: an interface or a type alias
  carries no constructor, an `abstract` class has no instance to build, an unknown name is a
  host allocation, and `new P(1., 2.)` on a class with no constructor names both ways to write
  it. The abstract case is reported once rather than twice. `new U()` on a class whose members
  are all static emitted `fn U_new() -> U` with no `struct U` anywhere, which Tint refuses, and
  reported nothing; it is refused with the reason.
- **A local function is a function of the module** (§14, roadmap 0.3 item T7,
  [#92](https://github.com/typeshade/typeshade/issues/92)): `const f = (x: f32): f32 => x * 2.`
  was "TS8099 Unsupported expression" and the call after it "Unknown function". Neither target
  has a function value, so it becomes a function named after the body that declares it, `fs_f`,
  which is what lets two bodies each declare an `f` while both still write `f(x)`. A local
  function may declare one of its own, and one at the module top level or in a `namespace` is a
  module function already, under its own name or the flattened one. It may not capture: a name
  read from the body around it is refused with the parameter to add instead, since a shader
  function has no environment to carry one in. An expression body with no return type, a `let`,
  and a type on the const rather than on the function are refused with the reason.
- **`...` spreads a struct's fields into an object literal** (§16, roadmap 0.3 item T7,
  [#92](https://github.com/typeshade/typeshade/issues/92)): `{ ...p, y: 9. }` was `TS8013 Spread
is a JS runtime operation`, which is true of `f(...args)` and `[...xs]` and is not true of
  this one. It is the fields of `p` with `y` written over one of them, one read per field, and
  later wins as it does in TypeScript. The target struct comes from an annotation or from the
  field names the literal ends up with, a spread may fill part of a bigger struct, and a nested
  read (`...o.i`) spreads too. Refused with the reason: a value with no fields, a value that is
  not a plain read, since the spread reads it once per field, and a field the target struct has
  not got.
- **`extends`, `abstract` and `implements`** (§26, roadmap 0.3 item T5,
  [#92](https://github.com/typeshade/typeshade/issues/92)): every `extends` was refused, "A
  TypeShade struct is exactly the members written here, so the inherited ones would be dropped",
  and an `abstract` method was an unknown one. A derived struct is its base's layout with the
  derived fields on the end, through a chain of any depth, on a class or an interface, and an
  interface may extend several. A method is inherited by lowering the base's body again with
  `this` typed as the derived class, since WGSL has no vtable and dispatch here is static; an
  inherited body therefore calls an override, as it does in TypeScript. Static functions, field
  initializers and constructors come down the same way. `super(a, b)` runs the base's
  constructor and copies its fields in, and `super.m(p)` runs the base's body on this object,
  emitted per class and named after the base so a three-deep chain terminates. An abstract class
  is a base and never a value: no instance method of its own, and a constructor only because a
  derived `super(...)` calls it. A name typed as the base cannot hold a derived value, which is
  what makes static dispatch mean what TypeScript's does, and saying so is the refusal. Also
  refused with the reason: an undeclared base, a cycle, a field that changes type on the way
  down, a generic base and a base that is a call.
- **An overload signature is skipped, and the implementation is lowered** (§14, roadmap 0.3
  item T6, [#92](https://github.com/typeshade/typeshade/issues/92)): a function's overloads are
  body-less declarations above the one that has a body, and each was `TS8020 Function "lum"
needs a body (no ambient declarations)`, so a file using the shape did not compile. One
  function is emitted now, from the implementation, inside a `namespace` under the flattened
  name as well. A method, a static function and a constructor already took the shape and keep
  it. A body-less declaration with no implementation, and `declare function`, keep the error.
- **A default parameter value is filled in at the call site** (§14, roadmap 0.3 item T7,
  [#92](https://github.com/typeshade/typeshade/issues/92)): `function tint(c: vec3, k: f32 = 0.5)`
  parsed, and every `tint(c)` was then `TS8019 "tint" expects 2 argument(s), got 1`. Neither
  target has default arguments, so the emitted function keeps every parameter and the omitted
  ones are written where the call is. A default works on a function, a method, a static function
  and a constructor; it is lowered once in the module's scope, so it may read a module const, a
  binding or a variable, build a struct, and call another function, in either declaration order
  and with a default of its own. A default that reads another parameter or `this` is refused,
  since at the call site that parameter is an expression and would run twice; so are a default on
  an entry parameter and one that waits on itself. `b?: f32` stays refused and now names the
  default to write instead. The arity message counts the defaults: `"f" takes 2 to 3 argument(s),
got 1`.
- **A call cycle a default closes is caught** (§ recursion): a filled-in default carries its
  calls into the body that wrote the call, which the syntax-tree walk cannot see. `g` returning
  `f()`, where `f` defaults to `g()`, emits `f(g())` and calls itself; it compiled, and left Tint
  to refuse the module and the CPU oracle to overflow. Those calls are in the graph now, reported
  at the call that closes the cycle.
- **Argument checks for the math builtins** (§10, roadmap 0.2 item 9, #57): every free math
  builtin checks its arguments against WGSL's signature and reports the one that does not fit as
  `TS8036`, on that argument, with the fix (splat the scalar, cast one side, give the vectors one
  size). `dot(vec3, vec2)`, `clamp(v, 0., 1.)` on a vector, `mix` on integer vectors,
  `normalize(s)`, `cross` on a `vec2` and the rest compiled with no diagnostic before and were
  refused by Tint. `mix`'s factor and `mod`'s divisor keep their scalar forms; `refract`'s eta,
  `ldexp`'s exponent and the bit offsets have their own shapes. The result type follows the
  operand deciding the shape: `dot` of integer vectors is an integer, and a written number in a
  call's first position takes an integer peer's kind, so `min(1, i)` with an `i32` `i` is an
  `i32` call instead of the `min(1.0, i)` WGSL refused.
- **A claim about a type emits nothing** (§14, roadmap 0.3 item T7,
  [#92](https://github.com/typeshade/typeshade/issues/92)): `x as T`, `<T>x`, `x as const`,
  `x satisfies T` and `x!` were each "TS8099 Unsupported expression" and are now the operand
  they wrap, which is what they are in TypeScript. The claimed type is the contextual type for
  what it wraps, so `satisfies P` names a struct the way an annotation does. A claim of a type
  the operand does not have is refused with the conversion to write instead, since `as` emits
  nothing and the value would otherwise travel under a name it does not have.
- **A destructuring declaration is the reads it stands for** (§14, roadmap 0.3 item T7,
  [#92](https://github.com/typeshade/typeshade/issues/92)): `const { x, y } = v` was "TS8099
  Destructuring is not supported" in every form, and is now one declaration per name, in the
  order written. A struct is read by field and a vector by component or swizzle, the renaming
  (`{ y: b }`) and nesting (`{ i: { a } }`) forms hold, and `let` keeps the names mutable. The
  value on the right is evaluated once: a bare name is read again for each field, anything else
  binds an internal local that takes no source name, so a program may declare `_d` and a block
  may hold two of these. A default, a rest, a computed name, an annotation on the pattern and an
  array pattern are refused with the read to write instead.
- **A module const takes the struct its annotation names** (§12): `const O: P = { x: 0., y: 1. }`
  was "Object literal { x, y } does not match a known struct" because the collector's scope
  carried no struct table at all. It does now, so the annotation decides, nested literals
  resolve, and two structs of one shape can be told apart at module scope.
- **`namespace`** (§26, roadmap 0.3 item T4,
  [#92](https://github.com/typeshade/typeshade/issues/92)): a namespace was TS8014 "Unsupported
  top-level "ModuleDeclaration"" and is now a group of functions and constants flattened to
  `Ns_member`, nesting in both spellings. A name inside the body is looked up as TypeScript
  looks it up: the body, then each namespace around it, then the file. A class, an enum, a type
  or a variable inside a namespace is refused and told where to declare it.
- **A cycle through a dotted call is caught** (§ recursion): the check walked identifier calls
  only, so `A.f()` calling itself, or two namespaces calling each other, compiled and left Tint
  to refuse it and the CPU oracle to overflow. Such a call is in the graph now, under the name
  the module emits.
- **`enum` and `const enum`** (§12, roadmap 0.3 item T1,
  [#92](https://github.com/typeshade/typeshade/issues/92)): a numeric enum was TS8014
  "Unsupported top-level "EnumDeclaration"" and is now a set of module constants named
  `Enum_Member`, with TypeScript's own values: auto-increment, explicit initializers, and
  arithmetic over members declared before. The enum's name is an `i32` wherever a type stands,
  a member bounds a loop and stands in a `switch` case, and `<<`, `>>`, `&`, `|` and `^` over
  two whole numbers fold, which is what makes the bit-flag form constant. A string member, a
  value that does not compute, a value outside an `i32` and a `declare enum` are refused with
  the reason.
- **A class whose members are all static is a namespace of functions, and a static field is a
  module constant** (§26, roadmap 0.3 item T3,
  [#92](https://github.com/typeshade/typeshade/issues/92)): `class Util { static half(x) { ... } }`
  was refused for having no fields, and `static PI = 3.14` was refused with "declare it as a
  module const". The utility class compiles now and carries no struct into the emit, and a
  static field is the constant `Util_PI` on both targets and both CPU paths, folded by the same
  rules a top-level const follows. An instance member on a fieldless class keeps the
  empty-struct refusal, since a method needs a receiver.
- **A type alias is another name for its target** (§2, roadmap 0.3 item T2,
  [#92](https://github.com/typeshade/typeshade/issues/92)): `type Meters = f32`,
  `type Color = vec3`, `type Grid = array<f32, 16>`, `type Point = Camera`. Before this the
  alias became a struct named after itself, so `m * 0.5` was "cannot \* struct:Meters and f32"
  and a lowercase alias was an unknown type. It resolves wherever a type may stand, a chain
  resolves through, a builtin name still wins, and a cycle is TS8002 naming the chain. An alias
  over an object type is a struct as before.
- **An optional class field is refused** (§2): `y?: f32` on a class emitted a required member
  with no diagnostic, while the same member on an interface was already refused. Both say now
  that a struct field is always present in the buffer the host fills.
- **Builtin breadth** (§10, roadmap 0.2 item 8): `reflect`, `refract`, `faceForward`,
  `transpose`, `determinant`, `ldexp`, `countOneBits`, `reverseBits`, `countLeadingZeros`,
  `countTrailingZeros`, `firstLeadingBit`, `firstTrailingBit`, `extractBits`, `insertBits` and
  the coarse and fine derivatives (`dpdxCoarse` ... `fwidthFine`), on both targets and the CPU.
  GLSL ES 3.00 has no `ldexp` and none of the eight bit builtins (they are ES 3.10's, and
  WebGL2 refuses them), so `ldexp` is `x * intBitsToFloat((e + 127) << 23)` there and each bit
  builtin is a small GLSL helper function the emitter defines once per argument type a module
  calls it with (`_popcnt`, `_brev`, `_msb`, `_lsb`, `_clz`, `_ctz`, `_xbits`, `_ibits`),
  checked on ANGLE against the CPU functions over 1632 values. GLSL's one derivative of each
  kind stands in for the coarse and fine ones, and `faceforward` is its spelling. The bit
  builtins whose value differs between `u32` and `i32` take the argument's static kind on every
  CPU path. A bare literal exponent of `ldexp` is an `i32`, a bare offset or count of
  `extractBits`/`insertBits` a `u32`. The `bit-bump` example lights a bump with the geometry
  three and bands it with the bit builtins, on both targets. `frexp` and `modf` follow with
  the result struct they need.
- **Boolean vectors** (§27, roadmap 0.2 item 7): a comparison of two vectors is componentwise
  and yields `vec2b`/`vec3b`/`vec4b` (WGSL `vec3<bool>`, GLSL `bvec3`), which `any(m)` and
  `all(m)` reduce, `select(f, t, m)` picks through per component, `!m` flips, and `vec3b(...)`
  constructs. GLSL ES 3.00 spells the comparison as `lessThan` and its siblings and the pick as
  `mix` for floats or a componentwise ternary otherwise. The three CPU paths share one
  comparison and one pick, so a bool vector is an array of booleans on all of them. An ordering
  on bool vectors, a `select` whose arms do not match the mask, and `any`/`all` on anything but
  a bool vector or an array with a predicate are TS8003 with the fix. The `bool-select` example
  renders on both targets.
- **Methods that change their object** (§26, design #86 step 2): a method that assigns to a
  field of `this` (or `++`/`--` on one, or calls such a method on `this`) takes and returns the
  struct, `fn Particle_step(self_in: Particle, dt: f32) -> Particle` working on the copy
  `self_`, and a call of it is a statement that writes the receiver back:
  `ps[gid.x].step(dt)` is `ps[gid.x] = Particle_step(ps[gid.x], dt)`. The receiver is a `let`
  local, a module variable, a storage element, or `this` in a constructor or another changing
  method; a `const`, a parameter, a dropped value, and a call in expression position are
  TS8035 with the fix. Such a method returns nothing; a write to `this` in one that returns a
  value is TS8035 with the rule. The effect table counts the write-back. The `particle-step`
  example steps a storage array of particles through `tick`, `step` and `bounce`. In the
  editor, hover on a method reads `(method) Ray.at(t: f32): vec3` at its declaration and at a
  call, and go to definition lands on it, which the TypeScript checker gives for free and a
  test now pins.
- **Classes with methods, a constructor and static functions** (§26, design #86 step 1): a
  method is a function whose first parameter is the struct, `Ray_at(self_: Ray, t: f32)`, with
  `this` read as `self_` (WGSL reserves `self`) and `r.at(1.)` called as `Ray_at(r, 1.0)`; a static function is
  `Ray_up()`, called as `Ray.up()`; the constructor is `Ray_new(...)`, which starts from the zero
  struct, assigns the field initializers, runs the body and returns it, and `new Ray(a, b)`
  calls it. A class with no constructor answers `new P()` with the zero struct, spelled out on
  both targets. Both targets carry all of it as written and the IR is unchanged, so the three
  CPU paths run it as functions. A method that assigns to `this` is refused with the reason
  until step 2. TS8035 `CLASS_MEMBER` names the member shapes and the calls the rules refuse.
  The `ray-class` example renders a sphere through `Ray` and `Sphere` methods on both targets.
- **A plain top-level `let` is a per-invocation variable** (§24, from the review of #82):
  `let seed: u32 = 7` emits `var<private> seed: u32 = 7u;`, a plain global on GLSL ES 3.00, and
  starts over at every host-facing call on the CPU, exactly as `perInvocation<u32>` does. That
  wrapper was the explicit spelling until it was removed (see Removed, above); `workgroup<T>`
  stays required, since workgroup memory has no TypeScript counterpart. Without an annotation
  the type is the initializer's by the `const` rule. For the plain `let` an array takes a list
  and a struct an object literal as a constant initializer, and a math builtin over constants
  counts as one (#73). A `let` with neither type nor initializer, a resource type without
  `declare`, and a list without an array type are TS8033 with the fix. Before this a plain
  top-level `let` was TS8014.
- **Barriers and `dispatch`** (roadmap 0.2 item 5, design #82, step 2): `workgroupBarrier()`
  and `storageBarrier()` as statements, in a compute entry or a helper and never inside an
  `if` or `switch` body (TS8034 with the reason), emitted bare on WGSL and treated as effects
  by the optimizer. `compileModule(m).dispatch(entry, workgroups)` and the codegen's twin run a
  `@compute` entry over the workgroups of its declared size with every invocation of a
  workgroup in lockstep at each barrier, the compute builtins filled in, workgroup memory zero
  per workgroup and per-invocation variables at their initializers; a workgroup whose
  invocations disagree about a barrier is an error naming the line and the counts. A direct
  `fns` call or a debug session on a kernel with a barrier names `dispatch`. The `workgroup-reduce` example sums
  64 values through workgroup memory, WGSL-only.
- **Module variables** (roadmap 0.2 item 5, design #82): `let tile: workgroup<array<f32, 64>>`
  is WGSL's `var<workgroup>`, memory one workgroup's invocations share, zero at the start of
  each workgroup; `let seed: perInvocation<u32> = 7` is WGSL's `var<private>`, a value each
  invocation owns for its run, at its constant initializer. The name is not `private<T>`
  because TypeScript reserves the word. A `workgroup` array may hold atomics and the §23
  builtins take the location. GLSL ES 3.00 spells a per-invocation variable as a plain global
  and has no form for workgroup memory. The IR gains `ModuleDecl.vars` (`ModuleVarDecl`), which
  `reflect()` does not report; the effect table counts a write to one; the oracle, codegen and
  debugger hold per-invocation storage that starts over at every host-facing call and one
  implicit workgroup's memory for the module's lifetime. A `const` with a wrapper, a
  `workgroup` initializer, a type the space cannot hold, a non-constant initializer or
  workgroup memory read from a vertex or fragment entry is TS8033 with the fix. Barriers and
  the lockstep dispatch are the entry above.
- **Atomics** (roadmap 0.2 item 4): `atomic<u32>` and `atomic<i32>` inside a `let` storage
  binding (an array element, a storage struct field, a bare binding), and the ten builtins
  `atomicLoad`, `atomicStore`, `atomicAdd`, `atomicSub`, `atomicMin`, `atomicMax`, `atomicAnd`,
  `atomicOr`, `atomicXor` and `atomicExchange`. The location is written as the plain expression
  and WGSL receives the pointer, `atomicAdd(&bins[i], 1u)`; a read-modify-write returns the
  value the location held before. A plain read or assignment of an atomic, a `const` binding,
  a wrong value type or an atomic declared outside storage is refused with the fix. The
  optimizer treats every atomic builtin as an effect and the effect table counts an atomic
  write as a write to its binding; the CPU oracle, codegen and debugger run atomics as
  in-order reads and writes. GLSL ES 3.00 has none, so such a module emits WGSL alone; the
  `atomic-histogram` example is WGSL-only. The IR gains the `atomic` type kind, `atomicU32T`,
  `atomicI32T`, `ATOMIC_INTRINSICS` and `isAtomicIntrinsic` on the public barrel.
- **`arrayLength`** (#46): `xs.length` on a runtime-sized storage array, and the explicit
  `arrayLength(xs)`, read the bound buffer's length at run time as WGSL `arrayLength(&xs)`, a
  `u32`. The operand is the binding or a trailing array field of a storage struct; an element,
  a sized array or an array outside storage is refused with the fix that applies. The CPU
  oracle reads the bound array's length. GLSL ES 3.00 has no form, and the `array-length`
  example is WGSL-only.
- **A call as a statement** in `"use typeshade"` (#47): `store(gid.x)` with its result dropped
  lowers to the IR's new `call` statement, which WGSL spells bare for a user function and
  behind `_ = ` for a value-returning builtin, GLSL ES 3.00 spells bare, and the CPU oracle,
  codegen and debugger run for its effect. The optimizer gains an effect table
  (`passes/effects.ts`): a call to a function that writes a binding is never deduplicated,
  hoisted or dropped, and a read of that binding is never shared across it. The EDSL gets
  `Call(node)` for the same statement.
- The **`"use typeshade"` compiler surface**: a TypeScript source file opts in with the
  file-level directive and is compiled by `compile()` into the shared IR, then emitted as WGSL
  and GLSL ES 3.00. `compile`, `compileTsSource`, `isTypeshadeSource` and the directive helpers
  are on the public barrel.
- The **language service** (`typeshade/language-service`): diagnostics, completions, hover,
  definition, references, document symbols, signature help, rename, semantic tokens and
  compiled output, over a document store, with the ambient declarations the TypeScript program
  is checked against derived from the compiler's own tables.
- Vector-against-scalar **broadcast** in `"use typeshade"` arithmetic, and the surface-B
  authoring ergonomics (compound assignment, scalar-cast methods, free arithmetic functions).
- The **`.shade.ts` example corpus**, wired into the registry, the tests and the compile gate,
  each paired with the `fn()` example it mirrors and pinned by a twin diff.
- **`src/__api__/surface.md`**, a committed snapshot of every public export and its shape, with
  `bun run bake:api-surface` to re-bake it. A public-surface change cannot land without
  appearing in a diff.
- The package ships **built output**. `tsc --build` emits `dist/src/…`, `dist/examples/…` and
  `dist/shade.d.ts`; the manifest inside the npm tarball is derived from the repository's own
  `exports` map by `scripts/publish-manifest.ts` and points every subpath at it. In this
  repository, and for a git-submodule consumer, `exports` still resolves to `./src/*.ts`.
- **`typeshade/shade`**, a types-only subpath resolving to `dist/shade.d.ts`. It is the ambient
  authoring declarations, written out of `SHADE_DTS` at build time, so a `tsc` user outside the
  language service can put `"types": ["typeshade/shade"]` in a `lib: []` project. README has
  what it covers and what it does not.
- **Releases are cut by creating a GitHub release.** `.github/workflows/publish.yml` re-runs
  CI, builds, checks the tag against `package.json`, proves the packed tarball installs and
  imports, and publishes with provenance. [`RELEASING.md`](RELEASING.md) is the checklist.

### Changed

- **The honest refusals: one mistake reads as one sentence** (§28, roadmap 0.3 item T10,
  [#92](https://github.com/typeshade/typeshade/issues/92)). `symbol`, a union of two types, a
  tuple of several, a capturing closure and `instanceof` each say the reason and what to write
  instead, in place of "Unsupported expression" or "Unsupported type syntax"; `instanceof` used
  to report "Unknown identifier B" about the base class, the one part of the line spelled right.
  And nothing follows them: a parameter whose annotation was refused no longer adds that it
  "requires a TypeShade type annotation", which it has; a return no longer adds "Unsupported
  return type"; a call to a function this file declares and could not lower no longer says
  "Unknown function", which was untrue. A call to a name nothing declares still says so.
  `number`, `boolean`, `string` and a string expression name the shader type that is meant.

- **The package is `typeshade`.** It was `@xgis/shader-dsl`, a workspace of the X-GIS monorepo,
  which was never published to npm. Every `Exported from …` JSDoc line, every documentation and
  example import, and the subpaths (`typeshade/dev`, `typeshade/debug`, `typeshade/compute`,
  `typeshade/emit-prod`, `typeshade/core/ir`, `typeshade/language-service`) move with it.
- **`XGIS_SHADER_DSL_TRACE` is now `TYPESHADE_TRACE`.** No alias — nothing is published yet.
- The copyright line of `LICENSE` and `package.json`'s `author` name the owner,
  `Seungup Noh <seungup.noh@gmail.com>`, rather than X-GIS.
- Every comment reference to an X-GIS issue or pull request reads `(X-GIS #1234)`, so it cannot
  be mistaken for an issue in this repository.
- The generated monorepo-era changelog moved to `docs/HISTORY.md`; this file replaces it.
- **`ShaderDslError` is now `TypeShadeError`.** `ShaderDslError` stays exported as a
  `@deprecated` alias of the same class, so `instanceof` keeps working; what it cannot preserve
  is `error.name`, which reads `TypeShadeError` on every instance.
- **Error messages are prefixed `typeshade`, not `shader-dsl`** — the coded head
  `typeshade [SD0002]: …` from `formatMessage`, and the uncoded `typeshade: …` /
  `typeshade/cpu: …` throws. The `SD####` codes themselves are unchanged: they are documented
  and tested everywhere, and a new letter pair would collide with TypeScript's `TS####`.
- The cross-instance registry keys are `Symbol.for('typeshade.*')` rather than
  `Symbol.for('xgis.shader-dsl.*')`, and the GLSL compute-emulation path injects a fragment
  position parameter named `typeshade_frag_pos`.

### Fixed

- **A vector comparison was a scalar bool.** `a < b` on two vectors compiled with no
  diagnostic, typed as one `bool`: GLSL ES 3.00 got `bool m = (a < b);`, which is not a program,
  and the oracle compared the two arrays as numbers. It is a vector of bools now (§27), on every
  target and on the CPU.
- **A multi-file program's module variables reached the WGSL.** `compileTsSources` took the
  bare-functions emit whenever the entry had no module constant, so an entry with a
  per-invocation or workgroup variable and no `const` emitted functions that read a variable
  the text never declared. It now emits the module form when either exists. A top-level `let`
  in a file that is not the entry is TS8014 with where the declaration goes, instead of
  vanishing (roadmap item 14 carries the other files' declarations).
- **A call that returns nothing cannot initialize a local**: `const x = store(1)` emitted
  `let x = store(1u);`, which Tint refuses, with no diagnostic; it is TS8003 now with "call it
  on its own line".
- **Block scope reaches the IR** (#38): two sequential `for (let i ...)` loops, a `p` in a loop
  body beside a `p` in an `if` arm, and an inner `p` that shadows an outer one or a parameter
  all lower now. The second and later declarations of a name in one function take the IR name
  `i_1`, `p_1`, and so on; the first keeps the source name, resolution is unchanged, and
  diagnostics and the symbol table keep the author's spelling. Before, both bindings took one
  name and the emit refused the module with `SD0112` at line 1.
- **A shift by 32 or more is refused** (#71): `x >> 33`, `x >> (16 + 16)` and `x <<= 32` are
  TS8003 with the amount they fold to. They compiled clean and emitted `33u` for Tint to refuse,
  while GLSL ES 3.00 left the result undefined.
- **Division by a constant zero is refused wherever it is lowered** (#68): in a function body, in
  a compound `/=` or `%=`, and in a module const, with the divisor named. The proof is
  componentwise and follows negation, vector arithmetic and a vector const's initializer, the
  three shapes the earlier check in the const collector missed. A parameter that repeats a module
  const's name is TS8023 on the parameter, where it threw out of `compileTsSource` before. A
  vector module const's placeholder `cpuValue` no longer reads as the value 0 in a function's
  scope.
- **A float `%=` reaches GLSL ES 3.00 as `floatMod`** (#20): `x %= 0.7` is written
  `x = (x - 0.7 * trunc(x / 0.7));`, the spelling the binary `%` already took. The compound
  assignment wrote `x %= 0.7;`, which GLSL refuses for floats; WGSL is unchanged.
- **`typescript` is a required peer dependency** (`>=5.0.0 <6`), not an optional one.
  `src/index.ts` re-exports `compile` from a module that imports `typescript` at module scope,
  so `import { emitModule } from 'typeshade'` failed with `ERR_MODULE_NOT_FOUND` on a clean
  install. The upper bound is measured: unbounded, npm resolved TypeScript 7.0.2, whose default
  export carries no `SyntaxKind`, and the package threw at module load. No source changed: the
  manifest was describing the package wrongly.
- f64 vector constructors compose and validate their element types, and the canonical
  `vecNf64` type names resolve.

### Removed

- `scripts/monorepo-context.ts` and the test arms that asked which tree the package was being
  built in. There is one tree now.
