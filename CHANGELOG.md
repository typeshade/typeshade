# Changelog

All notable changes to `typeshade` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file starts where TypeShade was separated from the X-GIS monorepo. Everything before that
— the IR, the three backends, the pass pipeline, and the breaking changes that shaped them — is
in [`docs/HISTORY.md`](docs/HISTORY.md), kept as its generator produced it. Nothing in this
repository has been published to npm; **`0.1.0` will be the first release**.

## [Unreleased]

### Added

- **A uniform lays out the bytes `reflect()` reports** (§51,
  [#156](https://github.com/typeshade/typeshade/issues/156)). WGSL's uniform address space
  aligns every array element to 16 bytes, so `array<f32, 4>` in a `uniform` is sixty-four
  bytes and not sixteen. The compiler emitted it as written, with zero diagnostics, and Tint
  refused the module: `'uniform' storage requires that array elements are aligned to 16 bytes,
  but array element of type 'f32' has a stride of 4 bytes`. `reflect()` had always reported
  that array at stride 16 — so the emit and the reflection described different memory, and the
  GLSL ES 3.00 std140 block linked on WebGL2 with the layout reflection described. The WGSL
  writer now emits the padding itself: a wrapper struct carrying `@size(16)` for the element
  stride, `@align(16)` on the member for the array's offset, and every read rewritten one
  field deeper (`U.xs[i].v`). Both attributes are load-bearing — a struct's alignment comes
  from its members and `@size` does not raise it, so with the stride alone Tint puts a member
  that follows a scalar at offset 4 and says `the offset of a struct member … must be a
  multiple of 16 bytes`, which is the same disagreement one level down. Measured against the
  Tint the gate runs: `@align(16) @size(64)` on the member of a BARE array is refused with the
  stride text, because that rule is on the element and no member attribute reaches it; the two
  together are accepted, and Tint's own layout note then reports the offsets `reflect()` does,
  checked on four struct shapes. `array<vec2, N>` is padded
  too; `array<vec4, N>` and the matrices are not, their stride already being a multiple of 16.
  A storage array is untouched — std430 has no such rule — and the GLSL text does not move,
  because std140 gives `float[4]` the 16-byte stride natively. `examples/uniform-array.shade.ts`
  runs on both halves of the gate, and `examples/emit-reflection-conformance.test.ts` sweeps
  both corpora for a uniform-reachable array reaching WGSL with a scalar or `vec2` element
  stride under 16. The struct-element case, and the byte parity itself, are checked against
  real Tint's own layout note in `src/compiler/ts/uniform-layout.test.ts`.

  **What the padding cannot reach is refused, not emitted.** A list of lists in a uniform needs
  the rule at both levels and has one member to carry the attribute; a bare list as the whole
  binding has no member at all, and `reflect().uniforms` describes nothing for it; and one
  struct bound as both a uniform and a storage buffer would have its storage half's bytes moved
  by padding the uniform half, while reflection keeps reporting the unpadded offsets. Each is
  refused naming the shape and the fix. A list of `vec4` is exempt from all three, its stride
  already being 16. Where a padded array is read WHOLE rather than indexed — a local, a call
  argument, a return, a struct built by value — the authored array is rebuilt from its
  elements rather than letting the wrapper type leak into a local or an argument.

  **Four shapes a struct used to hide.** A field's type does not say which address space it
  lands in, so each of these reached a backend as text a driver refuses. `bool` in a `uniform`
  or `storage` struct is now `TS8051` (`type 'bool' cannot be used in address space 'uniform'
  as it is non-host-shareable` on Tint, silently emitted into the std140 block by the GLSL
  writer — a divergence between the targets, not a shared failure); so are a runtime-sized
  `array<T>` that is not its struct's last field, and a runtime-sized array in a uniform, whose
  type must be constructible. `array<T, 0>` is refused at the type. A `bool` local, parameter
  or return is untouched: the rule is about host-shared bytes. `@size` and `@align` stay
  refused as author attributes, because applying them would mean teaching the layout engine
  `reflect()` shares with the GLSL writer to read them, and a half-applied attribute is the
  disagreement this change closes.

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
  profile (`clip_distances`, `f16`, `primitive_index`, `subgroups`) and whose misspelling is
  `TS8050` naming the four and enabling nothing. The other WGSL axis is reported too:
  `reflect().requiredLanguageFeatures` lists the language extensions a module needs and the
  writer emits `requires <feature>;`, with one row today —
  `readonly_and_readwrite_storage_textures` for a storage texture bound `read` or `read_write`,
  since core WGSL gives one `write` only. Measured against the Tint the compile gate runs:
  `requires readonly_and_readwrite_storage_textures;` is accepted;
  `requires uniform_buffer_standard_layout;` is not (`feature '…' is not supported`);
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

### Changed

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
  wrapper stays as the explicit spelling and `workgroup<T>` stays required, since workgroup
  memory has no TypeScript counterpart. Without an annotation the type is the initializer's by
  the `const` rule. For both spellings an array takes a list and a struct an object literal as a
  constant initializer, and a math builtin over constants counts as one (#73). A `let` with
  neither type nor initializer, a resource type without `declare`, and a list without an array
  type are TS8033 with the fix. Before this a plain top-level `let` was TS8014.
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
