// === One Markdown sentence per GPU type, attribute, builtin function, and constant (design doc §5) ===
//
// Shared by `hover.ts` (a documentation lookup) and `completions.ts` (an item's
// `documentation` field), so the two never describe the same name two different ways.

import { SUPPORTED_TYPE_NAMES } from '../compiler/ts/type-map.js'
import { ATTRIBUTE_NAMES as COMPILER_ATTRIBUTE_NAMES } from '../compiler/ts/builtin-check.js'
import { WGSL_BUILTIN_NAMES as SOT_WGSL_BUILTIN_NAMES } from '../core/sot.js'

// Re-export these tables so `ambient.ts` can import from `docs.ts` without an import cycle.
export const ATTRIBUTE_NAMES = COMPILER_ATTRIBUTE_NAMES
export const WGSL_BUILTIN_NAMES = SOT_WGSL_BUILTIN_NAMES

/** One Markdown sentence per GPU type name in `SUPPORTED_TYPE_NAMES`. */
export const TYPE_DOCS: Readonly<Record<string, string>> = {
  f32: '32-bit floating-point value.',
  f64: '64-bit floating-point value, emulated in software on both GPU targets.',
  i32: '32-bit signed integer value.',
  u32: '32-bit unsigned integer value.',
  bool: 'Boolean value.',
  workgroup:
    "A module variable one workgroup shares, `let tile: workgroup<array<f32, 64>>`: zero at the start of each workgroup, read and written by every invocation of the workgroup, and a compute entry's alone. WGSL `var<workgroup>`; GLSL ES 3.00 has no form for it.",
  perInvocation:
    'A module variable each invocation owns for its lifetime, `let seed: perInvocation<u32> = 7`: at its constant initializer, or zero, when the invocation starts. WGSL `var<private>`, a name TypeScript reserves; GLSL ES 3.00 spells it as a plain global.',
  atomic:
    'An `atomic<u32>` or `atomic<i32>`: an integer location in a read-write storage binding that many invocations update at once through `atomicAdd`, `atomicLoad` and the other atomic builtins. It is never read or assigned directly, and it is declared only inside a storage binding, as `declare let bins: storage<array<atomic<u32>>>`.',
  vec2: 'A two-component vector of `f32`.',
  vec3: 'A three-component vector of `f32`.',
  vec4: 'A four-component vector of `f32`.',
  vec2f: 'A two-component vector of `f32`, same type as `vec2`.',
  vec3f: 'A three-component vector of `f32`, same type as `vec3`.',
  vec4f: 'A four-component vector of `f32`, same type as `vec4`.',
  vec2i: 'A two-component vector of `i32`.',
  vec3i: 'A three-component vector of `i32`.',
  vec4i: 'A four-component vector of `i32`.',
  vec2u: 'A two-component vector of `u32`.',
  vec3u: 'A three-component vector of `u32`.',
  vec4u: 'A four-component vector of `u32`.',
  vec2b:
    'A two-component vector of `bool`: what comparing two `vec2` values yields, componentwise.',
  vec3b:
    'A three-component vector of `bool`: what comparing two `vec3` values yields, componentwise.',
  vec4b:
    'A four-component vector of `bool`: what comparing two `vec4` values yields, componentwise.',
  vec2d: 'A two-component vector of `f64`, same type as `vec2f64`.',
  vec3d: 'A three-component vector of `f64`, same type as `vec3f64`.',
  vec4d: 'A four-component vector of `f64`, same type as `vec4f64`.',
  vec2f64: 'A two-component vector of `f64`.',
  vec3f64: 'A three-component vector of `f64`.',
  vec4f64: 'A four-component vector of `f64`.',
  mat4: '4x4 matrix of `f32`, column-major, same type as `mat4x4`.',
  mat4x4: '4x4 matrix of `f32` (or `f64` as `mat4x4<f64>`), column-major.',
}

/** One Markdown sentence per attribute name in `ATTRIBUTE_NAMES`. */
export const ATTRIBUTE_DOCS: Readonly<Record<string, string>> = {
  vertex: "Marks a top-level exported function as the pipeline's vertex-stage entry point.",
  fragment: "Marks a top-level exported function as the pipeline's fragment-stage entry point.",
  compute:
    'Marks a top-level exported function as a compute-stage entry point, with an optional workgroup size: `@compute([64])`.',
  builtin:
    'Binds a field or parameter to a WebGPU builtin value, such as `@builtin("vertex_index")`.',
  location: 'Binds a field to a numeric shader IO location, such as `@location(0)`.',
}

/** One Markdown sentence per `@builtin(...)` id in `WGSL_BUILTIN_NAMES`. */
export const BUILTIN_DOCS: Readonly<Record<string, string>> = {
  vertex_index: 'The index of the current vertex within its draw call.',
  instance_index: 'The index of the current instance within its draw call.',
  position:
    "The vertex's clip-space position (vertex output) or the fragment's window-space position (fragment input).",
  front_facing: 'Whether the current fragment belongs to a front-facing primitive.',
  frag_depth: "Overrides the fragment's depth value.",
  sample_index: 'The index of the sample currently being processed, under multisampling.',
  sample_mask: 'The set of samples covered by the current fragment invocation.',
  local_invocation_id: "The current invocation's id within its workgroup, as a 3-component vector.",
  local_invocation_index: "The current invocation's flattened index within its workgroup.",
  global_invocation_id: "The current invocation's id across the entire compute dispatch.",
  workgroup_id: "The id of the current invocation's workgroup within the dispatch.",
  num_workgroups: 'The number of workgroups dispatched, as given to the dispatch call.',
  subgroup_invocation_id: "The current invocation's index within its subgroup.",
  subgroup_size: 'The number of invocations in the current subgroup.',
  clip_distances: "Per-vertex clip distances against the pipeline's enabled user clip planes.",
}

/** One Markdown sentence per builtin function: free math functions, expansions, casts, vector
 * constructors, array, fill, uniform, storage, and random. Shared by `hover.ts` and `completions.ts`. */
export const FUNCTION_DOCS: Readonly<Record<string, string>> = {
  exp2: 'Returns `2` raised to the power of `x`, componentwise over vectors.',
  saturate:
    'Clamps `x` to the range [0, 1], componentwise over vectors. GLSL ES 3.00 has no `saturate`, so it compiles to `clamp(x, 0.0, 1.0)` there.',
  fwidth:
    'Returns the sum of the absolute screen-space derivatives of `x` in both directions, `abs(dpdx(x)) + abs(dpdy(x))`, componentwise over vectors. Fragment stage only; the CPU oracle returns zero.',
  reflect:
    'Reflects the incident vector `i` about the normal `n`: `i - 2 * dot(n, i) * n`. `n` should be normalized. Same shape in, same shape out.',
  refract:
    'Refracts the incident vector `i` through a surface with normal `n` and ratio of indices `eta`; returns the zero vector on total internal reflection. Both vectors should be normalized.',
  faceForward:
    'Returns `n` if `dot(nref, i)` is negative, else `-n`: the normal that faces the incident vector. `faceforward` on GLSL.',
  transpose: 'Returns the transpose of a `mat4`.',
  determinant: 'Returns the determinant of a `mat4` as an `f32`.',
  ldexp:
    'Returns `x * 2^e`: an `f32` or float vector `x` with an `i32` or integer vector exponent `e` of the same shape. A bare literal exponent is an `i32`. Spelled through `intBitsToFloat` on GLSL ES 3.00, which has no `ldexp`.',
  quantizeToF16:
    'Rounds `e` to what an IEEE-754 binary16 can hold and returns it as an `f32`, so a shader can see the precision an f16 pipeline would give it without the `shader-f16` extension. Takes an `f32` or a float vector. GLSL ES 3.00 has no such builtin, so it is spelled as a `packHalf2x16`/`unpackHalf2x16` round trip, whose rounding of an exact half that spec does not pin.',
  pack4x8unorm:
    'Packs a `vec4` of values in [0, 1] into the four bytes of a `u32`, component 0 in the low byte. Hand-inlined on GLSL ES 3.00, which has no `packUnorm4x8` (that is ES 3.10).',
  atomicCompareExchangeWeak:
    'Stores the third argument into the atomic location only when it holds the second, as one indivisible step. Answers a struct: `old_value` is what the location held before the call and `exchanged` says whether the store happened. WGSL gives that struct no writable name, so bind the result with `const` and read its fields.',
  textureBarrier:
    'Holds every invocation of the workgroup until all have arrived, ordering their writes to the TEXTURE address space. A statement, in a compute entry or a function it calls, in uniform control flow. WebGPU-only, and part of the `readonly_and_readwrite_storage_textures` WGSL language feature that `reflect().requiredLanguageFeatures` reports.',
  workgroupUniformLoad:
    "Reads one value out of workgroup memory with a barrier on each side, so every invocation of the workgroup gets the same one. Takes a place in `workgroup<T>` memory, not storage, and returns its type. WebGPU-only, and it carries a barrier's placement rules: a compute entry or a function it calls, in uniform control flow.",
  dot4U8Packed:
    'Reads both `u32` arguments as four UNSIGNED bytes and sums the four products into a `u32`. WebGPU-only: GLSL ES 3.00 has no form of it, so a module using it emits WGSL alone. The host should check `navigator.gpu.wgslLanguageFeatures` for `packed_4x8_integer_dot_product`, which `reflect().requiredLanguageFeatures` reports.',
  dot4I8Packed:
    'Reads both `u32` arguments as four SIGNED bytes and sums the four products into an `i32`, wrapping at 32 bits. WebGPU-only, like `dot4U8Packed`.',
  pack4xU8:
    'Packs the low byte of each component of a `vec4u` into a `u32`, component 0 in the low byte. A component that does not fit is TRUNCATED, not clamped; `pack4xU8Clamp` saturates instead. WebGPU-only.',
  pack4xI8:
    'Packs the low byte of each component of a `vec4i` into an `i32`, component 0 in the low byte. A component that does not fit is TRUNCATED; `pack4xI8Clamp` saturates instead. WebGPU-only.',
  pack4xU8Clamp:
    'Packs a `vec4u` into a `u32` as four bytes, clamping each component into [0, 255] first. WebGPU-only.',
  pack4xI8Clamp:
    'Packs a `vec4i` into an `i32` as four bytes, clamping each component into [-128, 127] first. WebGPU-only.',
  unpack4xU8:
    'Unpacks the four bytes of a `u32` into a `vec4u`, the low byte into component 0. The inverse of `pack4xU8`. WebGPU-only.',
  unpack4xI8:
    'Unpacks the four bytes of a `u32` into a `vec4i`, sign-extending each byte, the low byte into component 0. The inverse of `pack4xI8`. WebGPU-only.',
  pack4x8snorm:
    'Packs a `vec4` of values in [-1, 1] into the four bytes of a `u32` as signed bytes, component 0 in the low byte. Hand-inlined on GLSL ES 3.00, which has no `packSnorm4x8` (that is ES 3.10).',
  unpack4x8unorm:
    'Unpacks the four bytes of a `u32` into a `vec4` of values in [0, 1], the low byte into component 0. The inverse of `pack4x8unorm`.',
  unpack4x8snorm:
    'Unpacks the four bytes of a `u32` into a `vec4` of values in [-1, 1], reading each as a signed byte, the low byte into component 0. The inverse of `pack4x8snorm`.',
  pack2x16float:
    'Packs a `vec2` into two IEEE-754 binary16 halves of a `u32`, component 0 in the low 16 bits. `packHalf2x16` on GLSL ES 3.00.',
  pack2x16unorm:
    'Packs a `vec2` of values in [0, 1] into two 16-bit halves of a `u32`, component 0 in the low 16 bits. `packUnorm2x16` on GLSL ES 3.00.',
  pack2x16snorm:
    'Packs a `vec2` of values in [-1, 1] into two signed 16-bit halves of a `u32`, component 0 in the low 16 bits. `packSnorm2x16` on GLSL ES 3.00.',
  unpack2x16float:
    'Unpacks the two binary16 halves of a `u32` into a `vec2`, the low 16 bits into component 0. `unpackHalf2x16` on GLSL ES 3.00.',
  unpack2x16unorm:
    'Unpacks the two 16-bit halves of a `u32` into a `vec2` of values in [0, 1], the low 16 bits into component 0. `unpackUnorm2x16` on GLSL ES 3.00.',
  unpack2x16snorm:
    'Unpacks the two signed 16-bit halves of a `u32` into a `vec2` of values in [-1, 1], the low 16 bits into component 0. `unpackSnorm2x16` on GLSL ES 3.00.',
  bitcast:
    'Reads the same 32 bits as another type: `bitcast<u32>(x)` on an `f32` and `bitcast<f32>(x)` on a `u32`. It reinterprets, it does not convert; `u32(x)` is the conversion. `floatBitsToUint` / `uintBitsToFloat` on GLSL ES 3.00.',
  countOneBits:
    'The number of 1 bits in each component of a `u32` or `i32` (or vector of them). A `_popcnt` helper on GLSL ES 3.00, which has no bit builtins.',
  reverseBits:
    'Reverses the 32 bits of each component of a `u32` or `i32` (or vector of them). A `_brev` helper on GLSL ES 3.00.',
  countLeadingZeros:
    'The number of leading 0 bits in each component of a `u32` or `i32` (32 for zero). A `_clz` helper on GLSL ES 3.00.',
  countTrailingZeros:
    'The number of trailing 0 bits in each component of a `u32` or `i32` (32 for zero). A `_ctz` helper on GLSL ES 3.00.',
  firstLeadingBit:
    'The position of the most significant 1 bit of a `u32` (0xffffffff for zero), or of the most significant bit that differs from the sign bit of an `i32` (-1 for 0 and -1). A `_msb` helper on GLSL ES 3.00.',
  firstTrailingBit:
    'The position of the least significant 1 bit of a `u32` or `i32`, or all ones (0xffffffff / -1) for zero. A `_lsb` helper on GLSL ES 3.00.',
  extractBits:
    'Extracts `count` bits of `e` starting at bit `offset`, sign-extended for an `i32`; the offset and count are clamped to the 32 bits as WGSL specifies. A `_xbits` helper on GLSL ES 3.00.',
  insertBits:
    'Inserts the low `count` bits of `newbits` into `e` at bit `offset`; the offset and count are clamped to the 32 bits as WGSL specifies. A `_ibits` helper on GLSL ES 3.00.',
  dpdxCoarse:
    'The partial derivative of `x` with respect to the window x coordinate, computed at the coarser granularity. Fragment stage only; `dFdx` on GLSL, which picks its own granularity; the CPU oracle returns zero.',
  dpdxFine:
    'The partial derivative of `x` with respect to the window x coordinate, computed at the finer granularity. Fragment stage only; `dFdx` on GLSL, which picks its own granularity; the CPU oracle returns zero.',
  dpdyCoarse:
    'The partial derivative of `x` with respect to the window y coordinate, computed at the coarser granularity. Fragment stage only; `dFdy` on GLSL; the CPU oracle returns zero.',
  dpdyFine:
    'The partial derivative of `x` with respect to the window y coordinate, computed at the finer granularity. Fragment stage only; `dFdy` on GLSL; the CPU oracle returns zero.',
  fwidthCoarse:
    '`abs(dpdxCoarse(x)) + abs(dpdyCoarse(x))`. Fragment stage only; `fwidth` on GLSL; the CPU oracle returns zero.',
  fwidthFine:
    '`abs(dpdxFine(x)) + abs(dpdyFine(x))`. Fragment stage only; `fwidth` on GLSL; the CPU oracle returns zero.',
  dpdx: 'Returns the partial derivative of `x` with respect to the window x coordinate, componentwise over vectors. Fragment stage only (`dFdx` on GLSL); the CPU oracle returns zero.',
  dpdy: 'Returns the partial derivative of `x` with respect to the window y coordinate, componentwise over vectors. Fragment stage only (`dFdy` on GLSL); the CPU oracle returns zero.',
  fma: 'Returns `a * b + c`, componentwise over vectors. GLSL ES 3.00 has no `fma`, so the product and sum are inlined there.',
  any: 'Whether any component of a vector of bools is true: `any(a < b)`. A scalar bool passes through. Over an array, `any(xs, (x) => ...)` is the fold.',
  all: 'Whether every component of a vector of bools is true: `all(a === b)`. A scalar bool passes through. Over an array, `all(xs, (x) => ...)` is the fold.',
  select:
    "Returns `trueValue` where `cond` is true and `falseValue` where it is false, in WGSL's argument order: the condition comes last. Compiles to the same code as a ternary over `cond`.",
  bool: 'Converts a numeric scalar to `bool`: true where `x` is not zero, spelled as the compare `x != 0`. A `bool` argument is returned as it is.',
  f64: 'Widens an `f32` to the emulated double `f64`. A value that is already `f64` is returned as it is; cast an integer to `f32` first.',
  textureSample:
    'Samples a float texture through the sampler `smp` with the implicit level of detail, in the fragment stage only: at `uv` on a `texture_2d`, by a `vec3` direction on a `texture_cube`, by a `vec3` coordinate on a `texture_3d`, by one `f32` on a `texture_1d`, and on an array texture the argument after the coordinate picks the layer. Compiles to `textureSample` on WGSL and `texture` on GLSL, where the layer is folded into a `vec3` coordinate; a `texture_1d` or a `texture_cube_array` has no GLSL ES 3.00 form, so a module using one emits WGSL alone.',
  textureGather:
    'Reads one channel from the four texels a linear filter would blend at the coordinate on mip level 0, through the sampler `smp`, and returns them as a `vec4` in the order (umin,vmax), (umax,vmax), (umax,vmin), (umin,vmin), in any stage. On a colour texture the first argument is the channel, a whole number from 0 to 3 written in the call; a depth texture has one channel and takes none; an array texture takes the layer after the coordinate. Compiles to `textureGather` on WGSL; GLSL ES 3.00 has no gather, so a module using it emits WGSL alone.',
  textureGatherCompare:
    'Compares the reference depth `ref` against the four texels a linear filter would blend at the coordinate on mip level 0, through the comparison sampler `smp`, and returns the four results (0 or 1 each) as a `vec4` in the order (umin,vmax), (umax,vmax), (umax,vmin), (umin,vmin), in any stage. On a `texture_depth_2d_array` or a `texture_depth_cube_array` the layer comes before the reference. Compiles to `textureGatherCompare` on WGSL; GLSL ES 3.00 has no gather, so a module using it emits WGSL alone.',
  textureSampleLevel:
    'Samples a float texture through the sampler `smp` at an explicit mip `level`, in any stage; the coordinate is a `vec2` on a `texture_2d` and a `vec3` on a `texture_cube` or a `texture_3d`. On a `texture_2d_array` the layer comes before the level. Compiles to `textureSampleLevel` on WGSL and `textureLod` on GLSL.',
  textureSampleBias:
    'Samples a float texture through the sampler `smp` with the implicit level of detail shifted by `bias`, in the fragment stage only; the coordinate is a `vec2` on a `texture_2d` and a `vec3` on a `texture_cube` or a `texture_3d`. On a `texture_2d_array` the layer comes before the bias. Compiles to `textureSampleBias` on WGSL and to `texture` with a bias argument on GLSL.',
  textureSampleGrad:
    'Samples a float texture through the sampler `smp` with the explicit gradients `ddx` and `ddy`, which have the width of the coordinate, in any stage. On a `texture_2d_array` the layer comes before the gradients. Compiles to `textureSampleGrad` on WGSL and `textureGrad` on GLSL.',
  textureLoad:
    'Reads one texel at the integer `coord` and mip `level` without filtering, by a `vec2i` on a `texture_2d`, a `vec3i` on a `texture_3d` and one integer on a `texture_1d`; a cube texture has no texel fetch on either target. On a `texture_2d_array` the layer comes before the level, and on a `texture_multisampled_2d` or `texture_depth_multisampled_2d` the third argument is the sample index instead of a level. Compiles to `textureLoad` on WGSL and `texelFetch` on GLSL, which has no multisampled form, so a module loading one emits WGSL alone.',
  textureNumSamples:
    'Returns the number of samples per texel of a `texture_multisampled_2d` or a `texture_depth_multisampled_2d` as a `u32`. A single-sample texture is refused. Compiles to `textureNumSamples` on WGSL; GLSL ES 3.00 has no multisampled textures, so a module using it emits WGSL alone.',
  textureSampleCompare:
    'Compares the reference depth `ref` against the shadow map at `uv` through the comparison sampler `smp`, with the implicit level of detail, in the fragment stage only; returns an `f32`, how much of the filter footprint passed. On a `texture_depth_2d_array` the layer comes before the reference, and on a `texture_depth_cube` the coordinate is a `vec3` direction. Compiles to `textureSampleCompare` on WGSL and `texture(sampler2DShadow, vec3(uv, ref))` on GLSL, where the reference folds into the coordinate.',
  textureSampleCompareLevel:
    'Compares the reference depth `ref` against the shadow map at `uv` through the comparison sampler `smp` at mip level 0, in any stage; returns an `f32`, how much of the filter footprint passed. On a `texture_depth_2d_array` the layer comes before the reference, and on a `texture_depth_cube` the coordinate is a `vec3` direction. Compiles to `textureSampleCompareLevel` on WGSL and to `textureLod` at level zero on a `sampler2DShadow` on GLSL, where the reference folds into the coordinate.',
  textureStore:
    'Writes one texel to a storage texture at the integer `coord`, on a binding declared `"write"` or `"read_write"`; returns nothing. The value is the texel the format decides: a `"…uint"` format stores a `vec4u`, a `"…sint"` one a `vec4i`, and every other one a `vec4`. Compiles to `textureStore` on WGSL; GLSL ES 3.00 has no image load/store, so a module using it emits WGSL alone and the CPU oracle, which has no texture memory, drops the write.',
  textureDimensions:
    "Returns the size of the texture's base mip level: width and height as a `vec2u`, width, height and depth as a `vec3u` on a `texture_3d`, or the width alone as a `u32` on a `texture_1d`. On a cube texture it is the size of one face.",
  textureNumLayers:
    'Returns the number of layers of a `texture_2d_array` or a `texture_cube_array` as a `u32`. A texture with no layers is refused.',
  arrayLength:
    'Returns the number of elements of a runtime-sized storage array as a `u32`, read from the buffer the host bound; `xs.length` on such an array reads the same thing. The argument must be the storage binding itself or a trailing array field of one. Compiles to `arrayLength(&xs)` on WGSL; GLSL ES 3.00 has no storage buffers, so a module using it emits WGSL alone.',
  atomicLoad:
    'Reads the value of an `atomic<u32>` or `atomic<i32>` location in a read-write storage binding (`atomicLoad(bins[i])`). Compiles to `atomicLoad(&bins[i])` on WGSL; GLSL ES 3.00 has no atomics, so a module using it emits WGSL alone. The CPU oracle runs invocations in order and reads the location.',
  atomicStore:
    'Writes `value` to an atomic location in a read-write storage binding (`atomicStore(bins[i], 0)`); returns nothing. Compiles to `atomicStore(&bins[i], v)` on WGSL only.',
  atomicAdd:
    'Adds `value` to the atomic location as one indivisible step and returns the value it held before (`atomicAdd(bins[i], 1)`). Wraps at 32 bits. Compiles to `atomicAdd(&bins[i], v)` on WGSL only.',
  atomicSub:
    'Subtracts `value` from the atomic location as one indivisible step and returns the value it held before. Wraps at 32 bits. Compiles to `atomicSub(&bins[i], v)` on WGSL only.',
  atomicMin:
    'Stores the smaller of the atomic location and `value` as one indivisible step and returns the value it held before. Compiles to `atomicMin(&bins[i], v)` on WGSL only.',
  atomicMax:
    'Stores the larger of the atomic location and `value` as one indivisible step and returns the value it held before. Compiles to `atomicMax(&bins[i], v)` on WGSL only.',
  atomicAnd:
    'Stores the bitwise AND of the atomic location and `value` as one indivisible step and returns the value it held before. Compiles to `atomicAnd(&bins[i], v)` on WGSL only.',
  atomicOr:
    'Stores the bitwise OR of the atomic location and `value` as one indivisible step and returns the value it held before. Compiles to `atomicOr(&bins[i], v)` on WGSL only.',
  atomicXor:
    'Stores the bitwise XOR of the atomic location and `value` as one indivisible step and returns the value it held before. Compiles to `atomicXor(&bins[i], v)` on WGSL only.',
  atomicExchange:
    'Stores `value` in the atomic location as one indivisible step and returns the value it held before. Compiles to `atomicExchange(&bins[i], v)` on WGSL only.',
  workgroupBarrier:
    'Waits until every invocation of the workgroup has reached this line, and makes every write to workgroup memory before it visible to every invocation after it. A statement, in a compute entry or a helper and never inside an `if` or `switch`. WGSL only; the CPU oracle runs the workgroup in lockstep through `dispatch`.',
  storageBarrier:
    'Waits until every invocation of the workgroup has reached this line, and makes every write to storage before it visible to every invocation after it. A statement, in a compute entry or a helper and never inside an `if` or `switch`. WGSL only; the CPU oracle runs the workgroup in lockstep through `dispatch`.',
  sin: 'Returns the sine of `x` (in radians), componentwise over vectors. Also accepts `f64` operands.',
  cos: 'Returns the cosine of `x` (in radians), componentwise over vectors. Also accepts `f64` operands.',
  tan: 'Returns the tangent of `x` (in radians), componentwise over vectors. Accepts `f32` and integer scalar/vector operands only.',
  asin: 'Returns the arcsine of `x` (in radians), componentwise over vectors. Returns `NaN` for values outside the domain `[-1, 1]`.',
  acos: 'Returns the arccosine of `x` (in radians), componentwise over vectors. Returns `NaN` for values outside the domain `[-1, 1]`.',
  atan: 'Returns the arctangent of `x` (in radians), componentwise over vectors.',
  atan2:
    'Returns the arctangent of `y/x` (in radians), using the signs of both arguments to determine the quadrant, taking arguments in the order `(y, x)`. Compiles to `atan2(y, x)` on WGSL and `atan(y, x)` on GLSL.',
  sinh: 'Returns the hyperbolic sine of `x`, componentwise over vectors.',
  cosh: 'Returns the hyperbolic cosine of `x`, componentwise over vectors.',
  tanh: 'Returns the hyperbolic tangent of `x`, componentwise over vectors.',
  asinh: 'Returns the inverse hyperbolic sine of `x`, componentwise over vectors.',
  acosh:
    'Returns the inverse hyperbolic cosine of `x`, componentwise over vectors. Returns `NaN` for values below 1 (the domain is `[1, ∞)`).',
  atanh:
    'Returns the inverse hyperbolic tangent of `x`, componentwise over vectors. The domain is `(-1, 1)`; returns `±Infinity` at `±1` and `NaN` at or beyond magnitude 1.',
  exp: 'Returns the exponential function (e raised to the power of `x`), componentwise over vectors.',
  log: 'Returns the natural logarithm of `x`, componentwise over vectors.',
  log2: 'Returns the base-2 logarithm of `x`, componentwise over vectors.',
  pow: 'Returns `x` raised to the power of `y`, componentwise over vectors. A negative base with a non-integer exponent produces NaN.',
  sqrt: 'Returns the square root of `x`, componentwise over vectors. Also accepts `f64` operands.',
  inverseSqrt:
    'Returns the reciprocal of the square root of `x` (1/sqrt(x)), componentwise over vectors. WGSL spells this `inverseSqrt`, GLSL spells it `inversesqrt`.',
  log10: 'Returns the base-10 logarithm of `x` (log(x) times `LOG10E`), for `f32` scalars only.',
  log1p:
    'Returns the natural logarithm of (1 plus `x`), computed as `log(x + 1)`, for `f32` scalars only.',
  expm1:
    'Returns e raised to the power of `x` minus 1, computed as `exp(x) - 1`, for `f32` scalars only.',
  cbrt: 'Returns the cube root of `x`, computed as `pow(x, 1/3)`, for `f32` scalars only. A negative `x` produces NaN.',
  hypot:
    'Returns the Euclidean length of the vector formed from 2 or 3 `f32` scalar arguments, computed via `length`, for `f32` scalars only.',
  abs: 'Returns the absolute value of `x`, componentwise over vectors. Also accepts `f64` operands.',
  sign: 'Returns -1 if `x` is negative, 1 if positive, and 0 if zero, componentwise over vectors.',
  floor:
    'Returns the largest integer not greater than `x`, componentwise over vectors. Also accepts `f64` operands.',
  ceil: 'Returns the smallest integer not less than `x`, componentwise over vectors.',
  round:
    'Rounds `x` to the nearest integer, with halfway cases rounding to the nearest even integer, componentwise over vectors.',
  trunc: 'Returns `x` truncated toward zero, componentwise over vectors.',
  fract:
    'Returns the fractional part of `x` as `x` minus `floor(x)`, in the range [0, 1), componentwise over vectors. Also accepts `f64` operands.',
  mod: 'Returns the floor-modulo remainder of `x` divided by `y`, with the sign of `y`, componentwise over vectors. `mod(-7, 3)` returns 2, not -1 like the `%` operator, which uses truncating modulo.',
  min: 'Returns the lesser of `a` and `b`, componentwise over vectors. If one argument is NaN, the other is returned. Also accepts `f64` operands.',
  max: 'Returns the greater of `a` and `b`, componentwise over vectors. If one argument is NaN, the other is returned. Also accepts `f64` operands.',
  clamp:
    'Clamps `x` to the range [low, high], computed as `min(max(x, low), high)`, componentwise over vectors.',
  mix: 'Returns `a * (1 - t) + b * t`. `t` is a scalar or the same shape as `a` and `b`. `f64` vectors accept an `f32` blend factor.',
  step: 'Returns 0 when `x` is less than `edge`, and 1 otherwise. `edge` comes first, followed by `x`. Componentwise over vectors.',
  smoothstep:
    'Applies Hermite interpolation between `edge0` and `edge1`, clamped to `[0, 1]`. Returns 0 when `x` is less than or equal to `edge0`, 1 when greater than or equal to `edge1`, and interpolates smoothly between. Componentwise over vectors.',
  length:
    'Returns the length (magnitude) of a vector, computed as the square root of the sum of squared components.',
  distance: 'Returns the Euclidean distance between `a` and `b`, computed as `length(a - b)`.',
  dot: 'Returns the dot product of two vectors: the sum of products of corresponding components. Reduces a vector to a scalar.',
  cross:
    'Computes the cross product of two `vec3` values, returning a `vec3`. Undefined for other vector shapes.',
  normalize:
    "Returns a unit vector in the same direction as the input, computed by dividing each component by the vector's length. The zero vector produces NaN when normalized. Also accepts `f64` operands.",
  degrees: 'Converts `x` from radians to degrees, multiplying by 180/π.',
  radians: 'Converts `x` from degrees to radians, multiplying by π/180.',
  f32: 'Casts a number to `f32` single-precision floating-point by inlining a literal value rounded to 32-bit precision. This is equivalent to `Math.fround(x)`.',
  i32: "Casts a number to `i32` signed 32-bit integer by truncating toward zero. Literal values outside [-2^31, 2^31-1] are a compile error; at runtime, out-of-range values wrap via two's-complement.",
  u32: "Casts a number to `u32` unsigned 32-bit integer by truncating toward zero. Literal values outside [0, 2^32-1] are a compile error; at runtime, out-of-range values wrap via two's-complement.",
  vec2: 'Builds a `vec2` from two scalars or broadcasts a single scalar to both components.',
  vec3: 'Builds a `vec3` from three scalars, a `vec2` and a scalar, or broadcasts a single scalar to all three components.',
  vec4: 'Builds a `vec4` from four scalars, a `vec3` and a scalar, a `vec2` and two scalars, or broadcasts a single scalar to all four components.',
  vec2f: 'A two-component vector of `f32`, same type as `vec2`.',
  vec3f: 'A three-component vector of `f32`, same type as `vec3`.',
  vec4f: 'A four-component vector of `f32`, same type as `vec4`.',
  vec2i:
    'Builds a `vec2i` from two `i32` scalars, broadcasts a single `i32` scalar, or converts from a `vec2` of a different element kind.',
  vec3i:
    'Builds a `vec3i` from three `i32` scalars, a `vec2i` and a scalar, broadcasts a single `i32` scalar, or converts from a `vec3` of a different element kind.',
  vec4i:
    'Builds a `vec4i` from four `i32` scalars, a `vec3i` and a scalar, a `vec2i` and two scalars, broadcasts a single `i32` scalar, or converts from a `vec4` of a different element kind.',
  vec2u:
    'Builds a `vec2u` from two `u32` scalars, broadcasts a single `u32` scalar, or converts from a `vec2` of a different element kind.',
  vec3u:
    'Builds a `vec3u` from three `u32` scalars, a `vec2u` and a scalar, broadcasts a single `u32` scalar, or converts from a `vec3` of a different element kind.',
  vec4u:
    'Builds a `vec4u` from four `u32` scalars, a `vec3u` and a scalar, a `vec2u` and two scalars, broadcasts a single `u32` scalar, or converts from a `vec4` of a different element kind.',
  vec2b:
    'Builds a `vec2b` from two `bool` scalars, broadcasts a single `bool`, or converts from a `vec2` of a different element kind (nonzero is true). A comparison of two `vec2` values yields one.',
  vec3b:
    'Builds a `vec3b` from three `bool` scalars, a `vec2b` and a scalar, broadcasts a single `bool`, or converts from a `vec3` of a different element kind. A comparison of two `vec3` values yields one.',
  vec4b:
    'Builds a `vec4b` from four `bool` scalars, a `vec3b` and a scalar, a `vec2b` and two scalars, broadcasts a single `bool`, or converts from a `vec4` of a different element kind. A comparison of two `vec4` values yields one.',
  vec2f64:
    'Builds a `vec2f64` from two `f64` scalars or broadcasts a single `f64` scalar to both components; emulated in software on both GPU targets.',
  vec3f64:
    'Builds a `vec3f64` from three `f64` scalars, a `vec2f64` and a scalar, or broadcasts a single `f64` scalar; emulated in software on both GPU targets.',
  vec4f64:
    'Builds a `vec4f64` from four `f64` scalars, a `vec3f64` and a scalar, a `vec2f64` and two scalars, or broadcasts a single `f64` scalar; emulated in software on both GPU targets.',
  array:
    'Builds an `array<T, N>` from exactly N values of type T; requires type arguments `array<T, N>(v1, v2, ..., vN)`.',
  fill: 'Creates an `array<T, N>` where every element is the given value; requires type arguments `fill<T, N>(value)`.',
  uniform:
    'Declares a uniform binding of type T; use `declare const name: uniform<T>` or `const name = uniform<T>()`.',
  storage:
    'Declares a storage binding of type T; use `declare const name: storage<T>` for read-only or `declare let name: storage<T>` for read-write access.',
  random:
    'Returns a deterministic pseudo-random `f32` in the range [0, 1) from an `f32`, `vec2` or `vec3` seed, computed as a hash of the seed on the GPU (`fract(sin(dot(seed, k)) * s)`), so the same seed always gives the same value. There is no unseeded form: `Math.random()` without a seed does not compile.',
}

/** One Markdown sentence per language constant: the mathematical constants PI, TAU, E, LN2, LN10,
 * LOG2E, and LOG10E. Shared by `hover.ts` and `completions.ts`. */
export const CONSTANT_DOCS: Readonly<Record<string, string>> = {
  discard:
    'Discards the current fragment, so nothing is written for it. Allowed in a fragment entry and in a helper that only fragment entries reach; compiles to `discard;` on both targets.',
  PI: "The mathematical constant π, inlined as a compile-time `f32` literal (approximately 3.14159). The value matches JavaScript's `Math.PI`.",
  TAU: 'The mathematical constant 2π (tau), inlined as a compile-time `f32` literal (approximately 6.28318). Defined as 2 times `PI`.',
  E: "The mathematical constant e, inlined as a compile-time `f32` literal (approximately 2.71828). The value matches JavaScript's `Math.E`.",
  LN2: "The natural logarithm of 2, inlined as a compile-time `f32` literal (approximately 0.69315). The value matches JavaScript's `Math.LN2`.",
  LN10: "The natural logarithm of 10, inlined as a compile-time `f32` literal (approximately 2.30259). The value matches JavaScript's `Math.LN10`.",
  LOG2E:
    "The base-2 logarithm of e, inlined as a compile-time `f32` literal (approximately 1.44270). The value matches JavaScript's `Math.LOG2E`.",
  LOG10E:
    "The base-10 logarithm of e, inlined as a compile-time `f32` literal (approximately 0.43429). The value matches JavaScript's `Math.LOG10E`.",
}

/** Documentation for `Math` object members: functions aliasing free functions (fround, random)
 * and readonly constants (E, LN10, LN2, LOG10E, LOG2E, PI, SQRT1_2, SQRT2). */
export const MATH_MEMBER_DOCS: Readonly<Record<string, string>> = {
  fround: FUNCTION_DOCS.f32,
  random:
    'Not a GPU builtin: a call with no seed does not compile, because a shader has no random source. Write `random(seed)` with an `f32`, `vec2` or `vec3` seed for a deterministic hash in the range [0, 1).',
  abs: FUNCTION_DOCS.abs,
  acos: FUNCTION_DOCS.acos,
  acosh: FUNCTION_DOCS.acosh,
  asin: FUNCTION_DOCS.asin,
  asinh: FUNCTION_DOCS.asinh,
  atan: FUNCTION_DOCS.atan,
  atanh: FUNCTION_DOCS.atanh,
  atan2: FUNCTION_DOCS.atan2,
  ceil: FUNCTION_DOCS.ceil,
  cos: FUNCTION_DOCS.cos,
  cosh: FUNCTION_DOCS.cosh,
  exp: FUNCTION_DOCS.exp,
  floor: FUNCTION_DOCS.floor,
  log: FUNCTION_DOCS.log,
  log2: FUNCTION_DOCS.log2,
  max: FUNCTION_DOCS.max,
  min: FUNCTION_DOCS.min,
  pow: FUNCTION_DOCS.pow,
  round: FUNCTION_DOCS.round,
  sign: FUNCTION_DOCS.sign,
  sin: FUNCTION_DOCS.sin,
  sinh: FUNCTION_DOCS.sinh,
  sqrt: FUNCTION_DOCS.sqrt,
  tan: FUNCTION_DOCS.tan,
  tanh: FUNCTION_DOCS.tanh,
  trunc: FUNCTION_DOCS.trunc,
  E: CONSTANT_DOCS.E,
  LN10: CONSTANT_DOCS.LN10,
  LN2: CONSTANT_DOCS.LN2,
  LOG10E: CONSTANT_DOCS.LOG10E,
  LOG2E: CONSTANT_DOCS.LOG2E,
  PI: CONSTANT_DOCS.PI,
  SQRT1_2:
    "The square root of 1/2, inlined as a compile-time `f32` literal (approximately 0.70711). The value matches JavaScript's `Math.SQRT1_2`.",
  SQRT2:
    "The square root of 2, inlined as a compile-time `f32` literal (approximately 1.41421). The value matches JavaScript's `Math.SQRT2`.",
}

/** Every documented type name, asserted in `docs.test.ts` to equal `SUPPORTED_TYPE_NAMES`. */
export const DOCUMENTED_TYPE_NAMES: readonly string[] = SUPPORTED_TYPE_NAMES
/** Every documented attribute name, asserted in `docs.test.ts` to equal `ATTRIBUTE_NAMES`. */
export const DOCUMENTED_ATTRIBUTE_NAMES: readonly string[] = ATTRIBUTE_NAMES
/** Every documented builtin name, asserted in `docs.test.ts` to equal `WGSL_BUILTIN_NAMES`. */
export const DOCUMENTED_BUILTIN_NAMES: readonly string[] = WGSL_BUILTIN_NAMES
/** Every documented function name, asserted in `docs.test.ts` to equal the declared function names in `SHADE_DTS`. */
export const DOCUMENTED_FUNCTION_NAMES = Object.keys(FUNCTION_DOCS)
/** Every documented constant name, asserted in `docs.test.ts` to equal the language constant names. */
export const DOCUMENTED_CONSTANT_NAMES = Object.keys(CONSTANT_DOCS)
/** Every documented Math member name, asserted in `docs.test.ts` to match the MathObject members in `SHADE_DTS`. */
export const DOCUMENTED_MATH_MEMBER_NAMES = Object.keys(MATH_MEMBER_DOCS)
