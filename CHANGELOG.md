# Changelog

All notable changes to `typeshade` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file starts where TypeShade was separated from the X-GIS monorepo. Everything before that
— the IR, the three backends, the pass pipeline, and the breaking changes that shaped them — is
in [`docs/HISTORY.md`](docs/HISTORY.md), kept as its generator produced it. Nothing in this
repository has been published to npm; **`0.1.0` will be the first release**.

## [Unreleased]

### Changed

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

### Added

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
  and a helper starting at the join of the control flow at its call sites. Both are what make
  those thresholds true rather than merely stated: order decides, so `let g = v.uv.x; g = 0.25;
if (g > 0.5)` is accepted as Tint accepts it, and a copy chain of any length is followed, so
  a barrier under one is refused as Tint refuses it. A call into a user function is `unknown`
  and never the join of its arguments, since its body can read a module `var` or a built-in
  value the walk never sees. A `return` under a non-uniform condition makes everything after it
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
  profile (`clip_distances`, `f16`, `primitive_index`, `subgroups`) and whose misspelling is
  `TS8050` naming the four and enabling nothing. The other WGSL axis is reported too:
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

### Changed

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
