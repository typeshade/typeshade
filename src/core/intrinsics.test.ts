import { describe, it, expect } from 'vitest'
import { INTRINSICS, spellIntrinsic } from './intrinsics.js'

// #3a — the neutral registry is the spelling SoT; each backend maps the same
// neutral id to its own spelling (the WGSL string is no longer the canonical id).
describe('intrinsics — neutral registry (#3a)', () => {
  it('atan2: atan2 on wgsl, atan on glsl', () => {
    expect(spellIntrinsic('wgsl', 'atan2', ['y', 'x'])).toBe('atan2(y, x)')
    expect(spellIntrinsic('glsl', 'atan2', ['y', 'x'])).toBe('atan(y, x)')
  })

  // X-GIS #839 — float `%` is trunc-mod on WGSL and integer-only in GLSL ES 3.00;
  // mod is the portable FLOOR-mod: inline x − y·⌊x/y⌋ on WGSL, native mod() on GLSL.
  it('mod: inline floor-mod on wgsl, mod() on glsl', () => {
    expect(spellIntrinsic('wgsl', 'mod', ['x', 'y'])).toBe('(x - y * floor(x / y))')
    expect(spellIntrinsic('glsl', 'mod', ['x', 'y'])).toBe('mod(x, y)')
  })

  // X-GIS #846 — screen-space partial derivatives; WGSL and GLSL name them differently.
  it('dpdx/dpdy: dpdx/dpdy on wgsl, dFdx/dFdy on glsl', () => {
    expect(spellIntrinsic('wgsl', 'dpdx', ['v'])).toBe('dpdx(v)')
    expect(spellIntrinsic('glsl', 'dpdx', ['v'])).toBe('dFdx(v)')
    expect(spellIntrinsic('wgsl', 'dpdy', ['v'])).toBe('dpdy(v)')
    expect(spellIntrinsic('glsl', 'dpdy', ['v'])).toBe('dFdy(v)')
  })

  it('bitcastU32: bitcast<u32> on wgsl, floatBitsToUint on glsl (no WGSL syntax in the id)', () => {
    expect(spellIntrinsic('wgsl', 'bitcastU32', ['f'])).toBe('bitcast<u32>(f)')
    expect(spellIntrinsic('glsl', 'bitcastU32', ['f'])).toBe('floatBitsToUint(f)')
  })

  it('scalar conversions: f32/i32/u32 cast on wgsl, float/int/uint on glsl', () => {
    expect(spellIntrinsic('wgsl', 'f32', ['x'])).toBe('f32(x)')
    expect(spellIntrinsic('glsl', 'f32', ['x'])).toBe('float(x)')
    expect(spellIntrinsic('wgsl', 'i32', ['x'])).toBe('i32(x)')
    expect(spellIntrinsic('glsl', 'i32', ['x'])).toBe('int(x)')
    expect(spellIntrinsic('wgsl', 'u32', ['x'])).toBe('u32(x)')
    expect(spellIntrinsic('glsl', 'u32', ['x'])).toBe('uint(x)')
  })

  it('select: WGSL select(f,t,c) vs GLSL ternary', () => {
    expect(spellIntrinsic('wgsl', 'select', ['F', 'T', 'C'])).toBe('select(F, T, C)')
    expect(spellIntrinsic('glsl', 'select', ['F', 'T', 'C'])).toBe('(C ? T : F)')
  })

  it('textureSample drops the sampler arg on glsl', () => {
    expect(spellIntrinsic('wgsl', 'textureSample', ['t', 's', 'uv'])).toBe(
      'textureSample(t, s, uv)',
    )
    expect(spellIntrinsic('glsl', 'textureSample', ['t', 's', 'uv'])).toBe('texture(t, uv)')
  })

  it('a non-registry name passes through identically (portable builtin / user fn)', () => {
    expect(spellIntrinsic('wgsl', 'sin', ['x'])).toBe('sin(x)')
    expect(spellIntrinsic('glsl', 'proj_mercator', ['a', 'b'])).toBe('proj_mercator(a, b)')
  })

  // GLSL texelFetch/textureSize REQUIRE an `int` lod; WGSL textureLoad passes a u32
  // level and textureDimensions(t) omits it. The glsl spelling supplies/casts to int;
  // the wgsl spelling stays untouched (WGSL byte-identity).
  it('textureLoad: WGSL unchanged; GLSL texelFetch wraps the lod in int()', () => {
    expect(spellIntrinsic('wgsl', 'textureLoad', ['t', 'c', 'lvl'])).toBe('textureLoad(t, c, lvl)')
    expect(spellIntrinsic('glsl', 'textureLoad', ['t', 'c', 'lvl'])).toBe(
      'texelFetch(t, c, int(lvl))',
    )
  })

  it('textureDimensions: WGSL unchanged; GLSL textureSize (int lod) wrapped in uvec2', () => {
    expect(spellIntrinsic('wgsl', 'textureDimensions', ['t'])).toBe('textureDimensions(t)')
    // GLSL textureSize returns a SIGNED ivec2; wrap in uvec2 so the type matches the
    // IR's vec2<u32> (else the optimizer's CSE hoist `uvec2 _cse = textureSize(…)` is a
    // GLSL int/uint compile error). 0 lod when absent.
    expect(spellIntrinsic('glsl', 'textureDimensions', ['t'])).toBe('uvec2(textureSize(t, 0))')
    // explicit level form casts the given level to int.
    expect(spellIntrinsic('glsl', 'textureDimensions', ['t', 'lvl'])).toBe(
      'uvec2(textureSize(t, int(lvl)))',
    )
  })
})

// ═══ P1-31 of #155 — every divergent spelling, as TEXT, from one literal table ═══
//
// `intrinsic-coverage.test.ts` proves two things about this registry: that every row genuinely
// diverges (`wgsl ≠ glsl`) and that the KEY SET is stable under an inline snapshot. Neither
// looks at the spelling itself, so `unpack2x16snorm` could start emitting `unpackSnorm4x8`, or
// `textureLoadMs` lose its `int()` wrap, and only a golden re-bake would show it — as a diff
// that says "this moved", not "this is now wrong".
//
// The table below is the text. Every `INTRINSICS` key is in it, and a key that is not fails
// the first arm, so a new divergent builtin arrives with its spelling written down where a
// reviewer reads it rather than only inside a template.
//
// WHAT A ROW IS, AND IS NOT. It is the registry TEMPLATE, which is what `spellIntrinsic`
// returns — not a promise about the bytes a backend finally emits. A writer may still special-
// case a shape downstream: `select` is spelled `(c ? b : a)` here and the GLSL writer emits
// `mix(vec3(0.0), vec3(1.0), m)` for a VECTOR condition, because a ternary on a `bvec` is not
// legal GLSL. The end-to-end question — does the call survive both writers under its own name —
// belongs to `intrinsic-coverage.test.ts`, which emits real modules for exactly that reason.
//
// SEVEN PLACEHOLDER ARGUMENTS, more than any overload takes, on purpose: the row describes the
// TEMPLATE, not one call. An entry that joins its arguments shows all seven; one that
// re-embeds particular ones shows exactly which, and in which order — which is the property
// that breaks silently. `glsl: null` is an id with no GLSL ES 3.00 form at all, the most
// divergent spelling there is: the template throws rather than emit something a driver would
// take for a program.
describe('every divergent spelling is asserted as text, not only as divergent', () => {
  const ARGS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const

  const EXPECTED: Readonly<
    Record<string, { readonly wgsl: string; readonly glsl: string | null }>
  > = {
    // GLSL ES 3.00 has no `abs(uint)`, and an unsigned value IS its own magnitude, so the
    // portable spelling is the argument itself (#164, §45).
    absU: { wgsl: 'abs(a, b, c, d, e, f, g)', glsl: 'a' },
    arrayLength: { wgsl: 'arrayLength(&a)', glsl: null },
    atan2: { wgsl: 'atan2(a, b, c, d, e, f, g)', glsl: 'atan(a, b, c, d, e, f, g)' },
    atomicAdd: { wgsl: 'atomicAdd(&a, b)', glsl: null },
    atomicAnd: { wgsl: 'atomicAnd(&a, b)', glsl: null },
    atomicCompareExchangeWeak: { wgsl: 'atomicCompareExchangeWeak(&a, b, c)', glsl: null },
    atomicExchange: { wgsl: 'atomicExchange(&a, b)', glsl: null },
    atomicLoad: { wgsl: 'atomicLoad(&a)', glsl: null },
    atomicMax: { wgsl: 'atomicMax(&a, b)', glsl: null },
    atomicMin: { wgsl: 'atomicMin(&a, b)', glsl: null },
    atomicOr: { wgsl: 'atomicOr(&a, b)', glsl: null },
    atomicStore: { wgsl: 'atomicStore(&a, b)', glsl: null },
    atomicSub: { wgsl: 'atomicSub(&a, b)', glsl: null },
    atomicXor: { wgsl: 'atomicXor(&a, b)', glsl: null },
    bitcastF32: {
      wgsl: 'bitcast<f32>(a, b, c, d, e, f, g)',
      glsl: 'uintBitsToFloat(a, b, c, d, e, f, g)',
    },
    bitcastU32: {
      wgsl: 'bitcast<u32>(a, b, c, d, e, f, g)',
      glsl: 'floatBitsToUint(a, b, c, d, e, f, g)',
    },
    countLeadingZeros: {
      wgsl: 'countLeadingZeros(a, b, c, d, e, f, g)',
      glsl: '_clz(a, b, c, d, e, f, g)',
    },
    countOneBits: {
      wgsl: 'countOneBits(a, b, c, d, e, f, g)',
      glsl: '_popcnt(a, b, c, d, e, f, g)',
    },
    countTrailingZeros: {
      wgsl: 'countTrailingZeros(a, b, c, d, e, f, g)',
      glsl: '_ctz(a, b, c, d, e, f, g)',
    },
    dot4I8Packed: { wgsl: 'dot4I8Packed(a, b, c, d, e, f, g)', glsl: null },
    dot4U8Packed: { wgsl: 'dot4U8Packed(a, b, c, d, e, f, g)', glsl: null },
    // GLSL ES 3.00's `dot` is float-only, so an integer dot becomes an emitted helper.
    dotI: { wgsl: 'dot(a, b, c, d, e, f, g)', glsl: '_idot(a, b, c, d, e, f, g)' },
    dotU: { wgsl: 'dot(a, b, c, d, e, f, g)', glsl: '_idot(a, b, c, d, e, f, g)' },
    dpdx: { wgsl: 'dpdx(a, b, c, d, e, f, g)', glsl: 'dFdx(a, b, c, d, e, f, g)' },
    dpdxCoarse: { wgsl: 'dpdxCoarse(a, b, c, d, e, f, g)', glsl: 'dFdx(a, b, c, d, e, f, g)' },
    dpdxFine: { wgsl: 'dpdxFine(a, b, c, d, e, f, g)', glsl: 'dFdx(a, b, c, d, e, f, g)' },
    dpdy: { wgsl: 'dpdy(a, b, c, d, e, f, g)', glsl: 'dFdy(a, b, c, d, e, f, g)' },
    dpdyCoarse: { wgsl: 'dpdyCoarse(a, b, c, d, e, f, g)', glsl: 'dFdy(a, b, c, d, e, f, g)' },
    dpdyFine: { wgsl: 'dpdyFine(a, b, c, d, e, f, g)', glsl: 'dFdy(a, b, c, d, e, f, g)' },
    extractBits: { wgsl: 'extractBits(a, b, c, d, e, f, g)', glsl: '_xbits(a, b, c, d, e, f, g)' },
    f32: { wgsl: 'f32(a, b, c, d, e, f, g)', glsl: 'float(a, b, c, d, e, f, g)' },
    f64Guard: {
      wgsl: 'textureLoad(_fp64, vec2<i32>(0, 0), 0).x',
      glsl: 'texelFetch(_fp64, ivec2(0, 0), 0).x',
    },
    faceForward: {
      wgsl: 'faceForward(a, b, c, d, e, f, g)',
      glsl: 'faceforward(a, b, c, d, e, f, g)',
    },
    firstLeadingBit: {
      wgsl: 'firstLeadingBit(a, b, c, d, e, f, g)',
      glsl: '_msb(a, b, c, d, e, f, g)',
    },
    firstTrailingBit: {
      wgsl: 'firstTrailingBit(a, b, c, d, e, f, g)',
      glsl: '_lsb(a, b, c, d, e, f, g)',
    },
    fma: { wgsl: 'fma(a, b, c, d, e, f, g)', glsl: '((a) * (b) + (c))' },
    fwidthCoarse: {
      wgsl: 'fwidthCoarse(a, b, c, d, e, f, g)',
      glsl: 'fwidth(a, b, c, d, e, f, g)',
    },
    fwidthFine: { wgsl: 'fwidthFine(a, b, c, d, e, f, g)', glsl: 'fwidth(a, b, c, d, e, f, g)' },
    i32: { wgsl: 'i32(a, b, c, d, e, f, g)', glsl: 'int(a, b, c, d, e, f, g)' },
    insertBits: { wgsl: 'insertBits(a, b, c, d, e, f, g)', glsl: '_ibits(a, b, c, d, e, f, g)' },
    inverseSqrt: {
      wgsl: 'inverseSqrt(a, b, c, d, e, f, g)',
      glsl: 'inversesqrt(a, b, c, d, e, f, g)',
    },
    ldexp: {
      wgsl: 'ldexp(a, b, c, d, e, f, g)',
      // The exponent is applied in TWO halves since #164. Built in one step as
      // `intBitsToFloat((b + 127) << 23)`, a large `b` pushes the biased exponent past the
      // eight bits it has and the shift runs into the sign bit; splitting it means each factor
      // carries half the exponent, and their product is the same 2^b over a far wider range.
      glsl: '(a * intBitsToFloat(((b >> 1) + 127) << 23) * intBitsToFloat(((b - (b >> 1)) + 127) << 23))',
    },
    mod: { wgsl: '(a - b * floor(a / b))', glsl: 'mod(a, b, c, d, e, f, g)' },
    pack2x16float: {
      wgsl: 'pack2x16float(a, b, c, d, e, f, g)',
      glsl: 'packHalf2x16(a, b, c, d, e, f, g)',
    },
    pack2x16snorm: {
      wgsl: 'pack2x16snorm(a, b, c, d, e, f, g)',
      glsl: 'packSnorm2x16(a, b, c, d, e, f, g)',
    },
    pack2x16unorm: {
      wgsl: 'pack2x16unorm(a, b, c, d, e, f, g)',
      glsl: 'packUnorm2x16(a, b, c, d, e, f, g)',
    },
    pack4x8snorm: {
      wgsl: 'pack4x8snorm(a, b, c, d, e, f, g)',
      // No native form: each lane is clamped to [-1, 1], scaled by 127, rounded half-up through
      // `floor(0.5 + x)`, masked to a byte and shifted into place.
      glsl: '(uint(int(floor(0.5 + clamp(a.x, -1.0, 1.0) * 127.0)) & 0xFF) | (uint(int(floor(0.5 + clamp(a.y, -1.0, 1.0) * 127.0)) & 0xFF) << 8) | (uint(int(floor(0.5 + clamp(a.z, -1.0, 1.0) * 127.0)) & 0xFF) << 16) | (uint(int(floor(0.5 + clamp(a.w, -1.0, 1.0) * 127.0)) & 0xFF) << 24))',
    },
    pack4x8unorm: {
      wgsl: 'pack4x8unorm(a, b, c, d, e, f, g)',
      // `floor(0.5 + x)` rather than `round(x)` since #164: GLSL ES 3.00 leaves `round`'s
      // half-way behaviour to the implementation, while unorm packing wants half-up every
      // time — and this is now the same rounding `pack4x8snorm` below uses.
      glsl: '(uint(floor(0.5 + clamp(a.x, 0.0, 1.0) * 255.0)) | (uint(floor(0.5 + clamp(a.y, 0.0, 1.0) * 255.0)) << 8) | (uint(floor(0.5 + clamp(a.z, 0.0, 1.0) * 255.0)) << 16) | (uint(floor(0.5 + clamp(a.w, 0.0, 1.0) * 255.0)) << 24))',
    },
    pack4xI8: { wgsl: 'pack4xI8(a, b, c, d, e, f, g)', glsl: null },
    pack4xI8Clamp: { wgsl: 'pack4xI8Clamp(a, b, c, d, e, f, g)', glsl: null },
    pack4xU8: { wgsl: 'pack4xU8(a, b, c, d, e, f, g)', glsl: null },
    pack4xU8Clamp: { wgsl: 'pack4xU8Clamp(a, b, c, d, e, f, g)', glsl: null },
    // One WGSL name over four ids, one per width: the id carries the shape the GLSL expansion
    // needs, since there the quantization is a half round-trip done lane by lane.
    quantizeToF16: {
      wgsl: 'quantizeToF16(a, b, c, d, e, f, g)',
      glsl: 'unpackHalf2x16(packHalf2x16(vec2(a, 0.0))).x',
    },
    quantizeToF16Vec2: {
      wgsl: 'quantizeToF16(a, b, c, d, e, f, g)',
      glsl: 'vec2(unpackHalf2x16(packHalf2x16(vec2(a.x, 0.0))).x, unpackHalf2x16(packHalf2x16(vec2(a.y, 0.0))).x)',
    },
    quantizeToF16Vec3: {
      wgsl: 'quantizeToF16(a, b, c, d, e, f, g)',
      glsl: 'vec3(unpackHalf2x16(packHalf2x16(vec2(a.x, 0.0))).x, unpackHalf2x16(packHalf2x16(vec2(a.y, 0.0))).x, unpackHalf2x16(packHalf2x16(vec2(a.z, 0.0))).x)',
    },
    quantizeToF16Vec4: {
      wgsl: 'quantizeToF16(a, b, c, d, e, f, g)',
      glsl: 'vec4(unpackHalf2x16(packHalf2x16(vec2(a.x, 0.0))).x, unpackHalf2x16(packHalf2x16(vec2(a.y, 0.0))).x, unpackHalf2x16(packHalf2x16(vec2(a.z, 0.0))).x, unpackHalf2x16(packHalf2x16(vec2(a.w, 0.0))).x)',
    },
    reverseBits: { wgsl: 'reverseBits(a, b, c, d, e, f, g)', glsl: '_brev(a, b, c, d, e, f, g)' },
    round: { wgsl: 'round(a, b, c, d, e, f, g)', glsl: 'roundEven(a, b, c, d, e, f, g)' },
    saturate: { wgsl: 'saturate(a, b, c, d, e, f, g)', glsl: 'clamp(a, 0.0, 1.0)' },
    select: { wgsl: 'select(a, b, c, d, e, f, g)', glsl: '(c ? b : a)' },
    storageBarrier: { wgsl: 'storageBarrier()', glsl: null },
    storageFetchF32: { wgsl: 'storageFetchF32(a, b, c, d, e, f, g)', glsl: '_sfetch(a, int(b))' },
    storageFetchI32: { wgsl: 'storageFetchI32(a, b, c, d, e, f, g)', glsl: '_sfetchI(a, int(b))' },
    storageFetchU32: { wgsl: 'storageFetchU32(a, b, c, d, e, f, g)', glsl: '_sfetchU(a, int(b))' },
    textureBarrier: { wgsl: 'textureBarrier()', glsl: null },
    textureDimensions: {
      wgsl: 'textureDimensions(a, b, c, d, e, f, g)',
      glsl: 'uvec2(textureSize(a, int(b)))',
    },
    textureDimensions1d: { wgsl: 'textureDimensions(a, b, c, d, e, f, g)', glsl: null },
    textureDimensions3d: {
      wgsl: 'textureDimensions(a, b, c, d, e, f, g)',
      glsl: 'uvec3(textureSize(a, int(b)))',
    },
    textureDimensionsMs: { wgsl: 'textureDimensions(a, b, c, d, e, f, g)', glsl: null },
    textureGather: { wgsl: 'textureGather(a, b, c, d, e, f, g)', glsl: null },
    textureGatherArray: { wgsl: 'textureGather(a, b, c, d, e, f, g)', glsl: null },
    textureGatherCompare: { wgsl: 'textureGatherCompare(a, b, c, d, e, f, g)', glsl: null },
    textureGatherCompareArray: { wgsl: 'textureGatherCompare(a, b, c, d, e, f, g)', glsl: null },
    textureGatherDepth: { wgsl: 'textureGather(a, b, c, d, e, f, g)', glsl: null },
    textureGatherDepthArray: { wgsl: 'textureGather(a, b, c, d, e, f, g)', glsl: null },
    textureLoad: { wgsl: 'textureLoad(a, b, c, d, e, f, g)', glsl: 'texelFetch(a, b, int(c))' },
    textureLoad3dU: {
      wgsl: 'textureLoad(a, b, c, d, e, f, g)',
      glsl: 'texelFetch(a, ivec3(b), int(c))',
    },
    textureLoadArray: {
      wgsl: 'textureLoad(a, b, c, d, e, f, g)',
      glsl: 'texelFetch(a, ivec3(b, int(c)), int(d))',
    },
    textureLoadArrayU: {
      wgsl: 'textureLoad(a, b, c, d, e, f, g)',
      glsl: 'texelFetch(a, ivec3(ivec2(b), int(c)), int(d))',
    },
    textureLoadDepthMs: { wgsl: 'textureLoad(a, b, c, d, e, f, g)', glsl: null },
    textureLoadMs: { wgsl: 'textureLoad(a, b, c, d, e, f, g)', glsl: null },
    // The `*U` ids are the UNSIGNED-coordinate twins (#164): WGSL's texel coordinate is
    // "i32, or u32" while GLSL's `texelFetch` takes the signed one, so the coordinate is
    // wrapped in the signed constructor of the texture's width.
    textureLoadU: {
      wgsl: 'textureLoad(a, b, c, d, e, f, g)',
      glsl: 'texelFetch(a, ivec2(b), int(c))',
    },
    textureNumLayers: {
      wgsl: 'textureNumLayers(a, b, c, d, e, f, g)',
      glsl: 'uint(textureSize(a, 0).z)',
    },
    // Refused rather than absent: a storage texture has no GLSL ES 3.00 spelling at all, and
    // `null` here covers both ways of having none (see `spell` above).
    textureNumLayersStorage: { wgsl: 'textureNumLayers(a, b, c, d, e, f, g)', glsl: null },
    textureNumSamples: { wgsl: 'textureNumSamples(a, b, c, d, e, f, g)', glsl: null },
    textureSample: { wgsl: 'textureSample(a, b, c, d, e, f, g)', glsl: 'texture(a, c)' },
    textureSampleArray: {
      wgsl: 'textureSample(a, b, c, d, e, f, g)',
      glsl: 'texture(a, vec3(c, float(d)))',
    },
    textureSampleBias: { wgsl: 'textureSampleBias(a, b, c, d, e, f, g)', glsl: 'texture(a, c, d)' },
    textureSampleBiasArray: {
      wgsl: 'textureSampleBias(a, b, c, d, e, f, g)',
      glsl: 'texture(a, vec3(c, float(d)), e)',
    },
    textureSampleBiasCubeArray: { wgsl: 'textureSampleBias(a, b, c, d, e, f, g)', glsl: null },
    textureSampleCompare: {
      wgsl: 'textureSampleCompare(a, b, c, d, e, f, g)',
      glsl: 'texture(a, vec3(c, d))',
    },
    textureSampleCompareArray: {
      wgsl: 'textureSampleCompare(a, b, c, d, e, f, g)',
      glsl: 'texture(a, vec4(c, float(d), e))',
    },
    textureSampleCompareCube: {
      wgsl: 'textureSampleCompare(a, b, c, d, e, f, g)',
      glsl: 'texture(a, vec4(c, d))',
    },
    textureSampleCompareCubeArray: {
      wgsl: 'textureSampleCompare(a, b, c, d, e, f, g)',
      glsl: null,
    },
    textureSampleCompareLevel: {
      wgsl: 'textureSampleCompareLevel(a, b, c, d, e, f, g)',
      glsl: 'textureLod(a, vec3(c, d), 0.0)',
    },
    textureSampleCompareLevelArray: {
      wgsl: 'textureSampleCompareLevel(a, b, c, d, e, f, g)',
      glsl: 'textureGrad(a, vec4(c, float(d), e), vec2(0.0), vec2(0.0))',
    },
    textureSampleCompareLevelCube: {
      wgsl: 'textureSampleCompareLevel(a, b, c, d, e, f, g)',
      glsl: 'textureGrad(a, vec4(c, d), vec3(0.0), vec3(0.0))',
    },
    textureSampleCompareLevelCubeArray: {
      wgsl: 'textureSampleCompareLevel(a, b, c, d, e, f, g)',
      glsl: null,
    },
    textureSampleCubeArray: { wgsl: 'textureSample(a, b, c, d, e, f, g)', glsl: null },
    textureSampleGrad: {
      wgsl: 'textureSampleGrad(a, b, c, d, e, f, g)',
      glsl: 'textureGrad(a, c, d, e)',
    },
    textureSampleGradArray: {
      wgsl: 'textureSampleGrad(a, b, c, d, e, f, g)',
      glsl: 'textureGrad(a, vec3(c, float(d)), e, f)',
    },
    textureSampleGradCubeArray: { wgsl: 'textureSampleGrad(a, b, c, d, e, f, g)', glsl: null },
    textureSampleLevel: {
      wgsl: 'textureSampleLevel(a, b, c, d, e, f, g)',
      glsl: 'textureLod(a, c, d)',
    },
    textureSampleLevelArray: {
      wgsl: 'textureSampleLevel(a, b, c, d, e, f, g)',
      glsl: 'textureLod(a, vec3(c, float(d)), e)',
    },
    textureSampleLevelCubeArray: { wgsl: 'textureSampleLevel(a, b, c, d, e, f, g)', glsl: null },
    textureStore: { wgsl: 'textureStore(a, b, c, d, e, f, g)', glsl: null },
    u32: { wgsl: 'u32(a, b, c, d, e, f, g)', glsl: 'uint(a, b, c, d, e, f, g)' },
    unpack2x16float: {
      wgsl: 'unpack2x16float(a, b, c, d, e, f, g)',
      glsl: 'unpackHalf2x16(a, b, c, d, e, f, g)',
    },
    unpack2x16snorm: {
      wgsl: 'unpack2x16snorm(a, b, c, d, e, f, g)',
      glsl: 'unpackSnorm2x16(a, b, c, d, e, f, g)',
    },
    unpack2x16unorm: {
      wgsl: 'unpack2x16unorm(a, b, c, d, e, f, g)',
      glsl: 'unpackUnorm2x16(a, b, c, d, e, f, g)',
    },
    unpack4x8snorm: {
      wgsl: 'unpack4x8snorm(a, b, c, d, e, f, g)',
      // Each byte is sign-extended by shifting it up to the top of an i32 and back down, then
      // scaled by 1/127 and floored at -1, which is what the snorm rule asks for.
      glsl: 'max(vec4(ivec4(uvec4(a, a >> 8, a >> 16, a >> 24) << 24) >> 24) / 127.0, vec4(-1.0))',
    },
    unpack4x8unorm: {
      wgsl: 'unpack4x8unorm(a, b, c, d, e, f, g)',
      glsl: '(vec4(uvec4(a, a >> 8, a >> 16, a >> 24) & 0xFFu) / 255.0)',
    },
    unpack4xI8: { wgsl: 'unpack4xI8(a, b, c, d, e, f, g)', glsl: null },
    unpack4xU8: { wgsl: 'unpack4xU8(a, b, c, d, e, f, g)', glsl: null },
    workgroupBarrier: { wgsl: 'workgroupBarrier()', glsl: null },
    workgroupUniformLoad: { wgsl: 'workgroupUniformLoad(&a)', glsl: null },
  }

  const spell = (target: 'wgsl' | 'glsl', id: string): string | null => {
    try {
      return spellIntrinsic(target, id, ARGS)
    } catch {
      return null
    }
  }

  it('describes every registry row, and no row that is gone', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.keys(INTRINSICS).sort())
  })

  it('spells each row exactly as the table says, on both targets', () => {
    const wrong: string[] = []
    for (const [id, want] of Object.entries(EXPECTED)) {
      const wgsl = spell('wgsl', id)
      const glsl = spell('glsl', id)
      if (wgsl !== want.wgsl) wrong.push(`${id} wgsl: ${String(wgsl)}`)
      if (glsl !== want.glsl) wrong.push(`${id} glsl: ${String(glsl)}`)
    }
    expect(wrong).toEqual([])
  })

  it('reads a table that actually holds the divergences it claims to', () => {
    // Non-vacuity: if `spell` swallowed everything into `null`, both arms above would pass on
    // a table of nulls. These three are the shapes the table exists for — a rename, an inline
    // expansion, and an id with no GLSL form.
    expect(EXPECTED['dpdx']?.glsl).toBe('dFdx(a, b, c, d, e, f, g)')
    expect(EXPECTED['saturate']?.glsl).toBe('clamp(a, 0.0, 1.0)')
    expect(EXPECTED['textureStore']?.glsl).toBe(null)
  })
})
