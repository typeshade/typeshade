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
