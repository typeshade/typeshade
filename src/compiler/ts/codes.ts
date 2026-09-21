// Stable diagnostic codes (Phase 10 / 12). Messages stay readable.
//
// Numbering: `TS8` + a zero-padded sequential number, assigned in the order a code was added.
// A gap (8011 is retired) is never reused. `UNSUPPORTED` (TS8099) is the one deliberate
// exception to "sequential": it is the catch-all for a diagnostic whose site does not yet
// deserve its own code, so it stays parked past the sequential range instead of at its head.
//
// TS8038, TS8039 and TS8040 are RESERVED, not retired: the 1.0 list (#162) hands each parallel
// session a block of codes to claim from so two of them cannot take one number, and this file
// is edited from several branches at once. A block that goes unused is compacted when the
// branches merge; until then the gap is deliberate and this note is what says so.

export const TS_CODES = {
  MISSING_DIRECTIVE: 'TS8001',
  UNKNOWN_TYPE: 'TS8002',
  TYPE_MISMATCH: 'TS8003',
  UNKNOWN_FN: 'TS8004',
  CONST_ASSIGN: 'TS8005',
  LOOP_BOUND: 'TS8006',
  LOOP_INFINITE: 'TS8007',
  LOOP_INDUCTION: 'TS8008',
  BREAK_OUTSIDE: 'TS8009',
  STRUCT_FIELD: 'TS8010',
  HOST_API: 'TS8012',
  HOST_STMT: 'TS8013',
  TOP_LEVEL: 'TS8014',
  BACKEND: 'TS8015',
  INDEX_OOB: 'TS8016',
  /** Invalid `switch` case: a label that is not an integer constant, does not fit the selector, or repeats another; a fall-through case body; or `continue` in a switch no loop encloses. */
  SWITCH_CASE: 'TS8017',
  /** An assignment or `++`/`--` target that is not a writable name (not an identifier, unknown, or a non-writable parameter). Assigning to a known immutable binding is `CONST_ASSIGN` instead. */
  ASSIGN_TARGET: 'TS8018',
  /** Wrong number of arguments, elements, or fields at a call or constructor site. */
  ARITY_MISMATCH: 'TS8019',
  /** A function declaration or parameter shape TypeShade does not support (missing name or body, optional/rest/destructured parameter). */
  FUNCTION_SHAPE: 'TS8020',
  /** A `return` shape problem: bare `return` where a value is required, or a function with no return type annotation. */
  RETURN_SHAPE: 'TS8021',
  /** Reference to a name TypeShade cannot resolve (identifier, struct field, or struct shape) that is not a function call (`UNKNOWN_FN`) or a type name (`UNKNOWN_TYPE`). */
  UNKNOWN_NAME: 'TS8022',
  /** The same function, binding, module constant or struct name declared twice in one scope. A struct counts whichever of the three spellings each declaration used: a class, an interface and a type alias of one name are one struct, not declarations that merge. */
  DUPLICATE_SYMBOL: 'TS8023',
  /** `@builtin("...")` names an id outside WGSL's builtin vocabulary (`WgslBuiltinName` in `core/sot.ts`). */
  BUILTIN_NAME: 'TS8024',
  /** A `@builtin(...)` id used as the wrong stage's input or output, e.g. `frag_depth` on a vertex return, or `front_facing` on a vertex parameter. */
  BUILTIN_STAGE: 'TS8025',
  /** `@compute([x, y, z])` with `y` or `z` other than `1`: the backend only carries the first workgroup axis today, so a shape it would silently drop is rejected instead. */
  WORKGROUP_SHAPE: 'TS8026',
  /** `mat2`/`mat3`: not implemented (only `mat4`/`mat4x4` maps to a real WGSL type), so authoring one is rejected instead of silently widening to `mat4x4`. */
  MAT_UNSUPPORTED: 'TS8027',
  /** A decorator identifier outside the attribute vocabulary `"use typeshade"` defines (`@vertex`, `@fragment`, `@compute`, `@builtin`, `@location`), e.g. a misspelled `@vertx`: without this, the decorated function or field just silently stops being an entry point or an I/O field. */
  ATTRIBUTE_NAME: 'TS8028',
  /** A field of a struct used as an entry function's parameter or return type carries neither `@builtin(...)` nor `@location(...)`: WGSL rejects an entry-IO struct member with no attribute, so this is caught at the front end instead of reaching the backend as invalid emitted WGSL. */
  STRUCT_FIELD_MISSING_ATTR: 'TS8029',
  /** A TypeScript parse error (an unclosed parenthesis, a missing brace, an unexpected token) in a `"use typeshade"` file, carried through as a TypeShade diagnostic so a `compile()` caller sees it without running `tsc`. A file with one is not lowered or emitted: before this, `vec4(3.14` compiled to WGSL. The language service drops these in favour of TypeScript's own syntactic diagnostics, which carry the real `TS1005`-style code. */
  SYNTAX: 'TS8030',
  /** A call cycle: a function that reaches itself, directly or through other functions.
   *  WGSL has no call stack, so Tint rejects the emitted module
   *  (`cyclic dependency found: 'a' -> 'b' -> 'a'`); before this the front end accepted it
   *  and emitted it with zero diagnostics. */
  RECURSION: 'TS8031',
  /** `.length`, or `arrayLength(x)`, on an `array<T>` with no `N` that is not in storage: a
   *  `uniform<array<T>>`, a local, or a parameter. `.length` once folded to the literal `0`,
   *  which made `gid.x >= xs.length` true for every invocation and the kernel a silent no-op
   *  in valid WGSL. A runtime-sized storage array now reads its length from the buffer as
   *  `arrayLength(&x)` (#46); the shapes that have no runtime length need an explicit size,
   *  which is what this says. */
  UNSIZED_ARRAY_LENGTH: 'TS8032',
  /** A module variable (`let x: workgroup<T>`, `let y: perInvocation<T> = init`, §24)
   *  declared or used where its address space forbids: a `const` with an address-space
   *  wrapper, a `workgroup` variable with an initializer, a type the space cannot hold (a
   *  texture, a runtime-sized array, an atomic in a per-invocation variable), an initializer
   *  that is not a constant, or a `workgroup` variable reached from a vertex or fragment
   *  entry (roadmap 0.2 item 5, #82). */
  MODULE_VAR: 'TS8033',
  /** `workgroupBarrier()` / `storageBarrier()` somewhere a barrier cannot stand (§25): in a
   *  vertex or fragment entry, which has no workgroup; inside an `if` or `switch` body, where
   *  a branch on a value the invocations do not share is how a workgroup waits forever; or as
   *  a value, since a barrier is a statement (roadmap 0.2 item 5, #82). */
  BARRIER_PLACEMENT: 'TS8034',
  /** A class member shape the surface does not take, or a method call the class rules refuse
   *  (#86): a getter or setter, an overload, an arrow-function field, a static field, a
   *  decorator on a method, `this` outside a method or inside a static one, a method that
   *  assigns to `this` (the next step), a parameter named `self`, a call of an instance
   *  method on the class or of a static one on a value, or a name the class does not have. */
  CLASS_MEMBER: 'TS8035',
  /** A math builtin called with arguments its signature does not take (#57, §10): two shapes
   *  that had to agree (`dot(vec3, vec2)`, `clamp(v, 0., 1.)` with a vector `v`), an element
   *  kind the builtin has no form for (`sin` on an integer vector, `mix` on one), a scalar
   *  where a vector is due (`normalize(s)`, `cross` on a `vec2`), `mix`'s factor or
   *  `refract`'s eta of the wrong shape, `ldexp`'s exponent not an i32 of `x`'s shape, a bit
   *  offset or count that is not a `u32`, or `transpose`/`determinant` on a non-matrix. Named
   *  on the offending argument with the fix where one is short: splat the scalar, cast one
   *  side, give the vectors one size. */
  MATH_ARGUMENT: 'TS8036',
  /** `@compute(...)` with an argument that is not an array literal of one to three whole
   *  numbers (#118): an object, a bare number, an identifier, an empty or four-wide array. It
   *  used to fall through to the default of 64 with no diagnostic, so the author dispatched
   *  against a size they never asked for. The y/z rule stays `WORKGROUP_SHAPE`. */
  WORKGROUP_ARG: 'TS8037',
  /** A plain argument of a texture read that the target has no overload for (#145): a
   *  coordinate or gradient of the wrong WIDTH for the texture's dim or of an element kind the
   *  read does not take (a sampled read is by normalised `f32`, a texel fetch by whole
   *  `i32`/`u32` texel), a layer, mip level or sample index that is not an integer or is not a
   *  whole number of 0 or more, and a `level`, `bias` or `depth_ref` that is not an `f32`. Only
   *  a bare numeric LITERAL is retargeted instead; anything else used to reach the backend
   *  unchanged, where Tint answers "no matching call" about generated code the author never
   *  wrote and GLSL ES 3.00 silently rounds.
   *
   *  ONE code for the whole family, on purpose. The width check and the fractional-literal
   *  check were `TYPE_MISMATCH` before this; splitting the family by which property of the
   *  argument is wrong gave two codes to one sentence shape and no caller a reason to care,
   *  and the 1d coordinate check moved between the two by being rewritten. The TEXTURE itself
   *  being wrong — a sampled texture handed to `textureStore`, a depth texture read plainly,
   *  an access mode that forbids the call — stays `TYPE_MISMATCH`: that is the binding's
   *  declaration, not the call's argument. */
  TEXTURE_ARGUMENT: 'TS8041',
  UNSUPPORTED: 'TS8099',
} as const

export type TsCode = (typeof TS_CODES)[keyof typeof TS_CODES]
