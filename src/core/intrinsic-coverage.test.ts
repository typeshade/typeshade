import { describe, it, expect } from 'vitest'
import {
  INTRINSICS,
  PORTABLE_INTRINSICS,
  PRE_EMIT_INTRINSICS,
  isKnownIntrinsic,
} from './intrinsics.js'
import {
  f32,
  u32,
  bool,
  vec2,
  vec3,
  vec4,
  sin,
  cos,
  tan,
  asin,
  acos,
  atan,
  sinh,
  cosh,
  tanh,
  asinh,
  acosh,
  atanh,
  exp,
  log,
  log2,
  exp2,
  floor,
  ceil,
  abs,
  sqrt,
  fract,
  trunc,
  round,
  sign,
  radians,
  degrees,
  inverseSqrt,
  normalize,
  atan2,
  min,
  max,
  pow,
  mod,
  dpdx,
  dpdy,
  clamp,
  saturate,
  mix,
  smoothstep,
  step,
  length,
  dot,
  distance,
  cross,
  pack4x8unorm,
  unpack4x8unorm,
  pack2x16float,
  unpack2x16float,
  pack2x16unorm,
  unpack2x16unorm,
  pack2x16snorm,
  unpack2x16snorm,
  bitcastU32,
  bitcastF32,
  toF32,
  toI32,
  toU32,
  toF64,
  f64FromParts,
  f64Parts,
  textureSample,
  textureSampleLevel,
  textureLoad,
  textureNumLayers,
  bindingRef,
  texture2dfT,
  texture2dArrayfT,
  samplerT,
  vec2i,
  module,
  f32T,
  type FuncDecl,
  type ModuleDecl,
  type Node,
} from './ir/index.js'
import { emitModule } from './backends/wgsl.js'
import { emitGlslModule } from './backends/glsl.js'
import { MATH_FN_ARITY } from '../compiler/ts/math-alias.js'

describe('intrinsic registry coverage (the spelling agreement surface)', () => {
  it('no id is BOTH divergent and portable (single classification)', () => {
    const overlap = Object.keys(INTRINSICS).filter((k) => PORTABLE_INTRINSICS.has(k))
    expect(overlap).toEqual([])
  })

  it('pre-emit ids overlap NEITHER emit classification (they must never be spellable)', () => {
    const overlap = [...PRE_EMIT_INTRINSICS].filter(
      (k) => Object.prototype.hasOwnProperty.call(INTRINSICS, k) || PORTABLE_INTRINSICS.has(k),
    )
    expect(overlap).toEqual([])
  })

  it('every INTRINSICS entry is GENUINELY divergent (wgsl ≠ glsl) — a portable one belongs in the set, not the map', () => {
    const args = ['a', 'b', 'c'] // enough positional args for every entry's spelling
    // A column that THROWS (a builtin one target has no form for, such as `arrayLength` on
    // GLSL ES 3.00, which has no storage buffers) is the most divergent spelling there is.
    const spell = (f: (a: readonly string[]) => string): string | undefined => {
      try {
        return f(args)
      } catch {
        return undefined
      }
    }
    // An entry earns its place unless BOTH columns agree AND the spelling they agree on is
    // exactly the one the portable fall-through already writes. `spellIntrinsic` spells an id
    // with no entry as `name(args)`, so that is the test for redundancy — not mere agreement.
    // The OPERATOR ids are why: `~` is `~a` on both targets, identical and still not movable,
    // because a portable `~` would be spelled `~(a, b, c)`, which is neither language.
    const fallThrough = (k: string): string => `${k}(${args.join(', ')})`
    const redundant = Object.entries(INTRINSICS)
      .filter(([, s]) => spell(s.wgsl) === spell(s.glsl))
      .filter(([k, s]) => spell(s.wgsl) === fallThrough(k))
      .map(([k]) => k)
    expect(redundant).toEqual([])
  })

  // Deliberate-diff catalogue: adding/removing a classified builtin must touch this snapshot,
  // which forces the author to classify a new builtin as divergent (INTRINSICS) or portable.
  it('the full known-intrinsic catalogue is stable', () => {
    const catalogue = [
      ...Object.keys(INTRINSICS),
      ...PORTABLE_INTRINSICS,
      ...PRE_EMIT_INTRINSICS,
    ].sort()
    expect(catalogue).toMatchInlineSnapshot(`
      [
        "abs",
        "absU",
        "acos",
        "acosh",
        "all",
        "any",
        "arrayLength",
        "asin",
        "asinh",
        "atan",
        "atan2",
        "atanh",
        "atomicAdd",
        "atomicAnd",
        "atomicCompareExchangeWeak",
        "atomicExchange",
        "atomicLoad",
        "atomicMax",
        "atomicMin",
        "atomicOr",
        "atomicStore",
        "atomicSub",
        "atomicXor",
        "bitcastF32",
        "bitcastU32",
        "ceil",
        "clamp",
        "cos",
        "cosh",
        "countLeadingZeros",
        "countOneBits",
        "countTrailingZeros",
        "cross",
        "degrees",
        "determinant",
        "distance",
        "dot",
        "dot4I8Packed",
        "dot4U8Packed",
        "dotI",
        "dotU",
        "dpdx",
        "dpdxCoarse",
        "dpdxFine",
        "dpdy",
        "dpdyCoarse",
        "dpdyFine",
        "exp",
        "exp2",
        "extractBits",
        "f32",
        "f64",
        "f64FromParts",
        "f64Guard",
        "f64Parts",
        "faceForward",
        "firstLeadingBit",
        "firstTrailingBit",
        "floor",
        "fma",
        "fract",
        "fwidth",
        "fwidthCoarse",
        "fwidthFine",
        "i32",
        "insertBits",
        "inverseSqrt",
        "ldexp",
        "length",
        "log",
        "log2",
        "max",
        "min",
        "mix",
        "mod",
        "normalize",
        "pack2x16float",
        "pack2x16snorm",
        "pack2x16unorm",
        "pack4x8snorm",
        "pack4x8unorm",
        "pack4xI8",
        "pack4xI8Clamp",
        "pack4xU8",
        "pack4xU8Clamp",
        "pow",
        "quantizeToF16",
        "quantizeToF16Vec2",
        "quantizeToF16Vec3",
        "quantizeToF16Vec4",
        "radians",
        "reflect",
        "refract",
        "reverseBits",
        "round",
        "saturate",
        "select",
        "sign",
        "sin",
        "sinh",
        "smoothstep",
        "sqrt",
        "step",
        "storageBarrier",
        "storageFetchF32",
        "storageFetchI32",
        "storageFetchU32",
        "tan",
        "tanh",
        "textureBarrier",
        "textureDimensions",
        "textureDimensions1d",
        "textureDimensions3d",
        "textureDimensionsMs",
        "textureGather",
        "textureGatherArray",
        "textureGatherCompare",
        "textureGatherCompareArray",
        "textureGatherDepth",
        "textureGatherDepthArray",
        "textureLoad",
        "textureLoad3dU",
        "textureLoadArray",
        "textureLoadArrayU",
        "textureLoadDepthMs",
        "textureLoadMs",
        "textureLoadU",
        "textureNumLayers",
        "textureNumLayersStorage",
        "textureNumSamples",
        "textureSample",
        "textureSampleArray",
        "textureSampleBias",
        "textureSampleBiasArray",
        "textureSampleBiasCubeArray",
        "textureSampleCompare",
        "textureSampleCompareArray",
        "textureSampleCompareCube",
        "textureSampleCompareCubeArray",
        "textureSampleCompareLevel",
        "textureSampleCompareLevelArray",
        "textureSampleCompareLevelCube",
        "textureSampleCompareLevelCubeArray",
        "textureSampleCubeArray",
        "textureSampleGrad",
        "textureSampleGradArray",
        "textureSampleGradCubeArray",
        "textureSampleLevel",
        "textureSampleLevelArray",
        "textureSampleLevelCubeArray",
        "textureStore",
        "transpose",
        "trunc",
        "u32",
        "unpack2x16float",
        "unpack2x16snorm",
        "unpack2x16unorm",
        "unpack4x8snorm",
        "unpack4x8unorm",
        "unpack4xI8",
        "unpack4xU8",
        "workgroupBarrier",
        "workgroupUniformLoad",
        "~",
      ]
    `)
  })

  it('every call id the builtin surface emits is classified (no silent identity fall-through)', () => {
    const f = f32(0),
      v3 = vec3(1, 2, 3),
      v4 = vec4(1, 2, 3, 4),
      u = u32(0)
    void bool(true)
    const samples: Node[] = [
      sin(f),
      cos(f),
      tan(f),
      asin(f),
      acos(f),
      atan(f),
      exp(f),
      log(f),
      log2(f),
      exp2(f),
      floor(f),
      ceil(f),
      abs(f),
      sqrt(f),
      fract(f),
      trunc(f),
      round(f),
      sign(f),
      radians(f),
      degrees(f),
      inverseSqrt(f),
      sinh(f),
      cosh(f),
      tanh(f),
      asinh(f),
      acosh(f),
      atanh(f),
      saturate(f),
      normalize(v3),
      atan2(f, f),
      min(f, f),
      max(f, f),
      pow(f, f),
      mod(f, f),
      dpdx(f),
      dpdy(f),
      clamp(f, 0, 1),
      mix(f, f, f),
      smoothstep(0, 1, f),
      step(f, f),
      length(v3),
      dot(v3, v3),
      distance(v3, v3),
      cross(v3, v3),
      pack4x8unorm(v4),
      unpack4x8unorm(u),
      pack2x16float(vec2(0.5, 0.5)),
      unpack2x16float(u),
      pack2x16unorm(vec2(0.5, 0.5)),
      unpack2x16unorm(u),
      pack2x16snorm(vec2(0.5, 0.5)),
      unpack2x16snorm(u),
      bitcastU32(f),
      bitcastF32(u),
      toF32(u),
      toI32(f),
      toU32(f),
      toF64(f),
      f64FromParts(f, f),
      f64Parts(toF64(f)),
      textureSampleLevel(bindingRef('t', texture2dfT), bindingRef('s', samplerT), vec2(0, 0), 1),
      // X-GIS #1651 — the 2d-array forms carry their OWN ids, so the classification sweep
      // must drive them too (an unclassified id would fall through as identity).
      textureSample(bindingRef('ta', texture2dArrayfT), bindingRef('s', samplerT), vec2(0, 0), 1),
      textureSampleLevel(
        bindingRef('ta', texture2dArrayfT),
        bindingRef('s', samplerT),
        vec2(0, 0),
        1,
        0,
      ),
      textureLoad(bindingRef('ta', texture2dArrayfT), vec2i(0, 0), 1, u),
      // X-GIS #1658 — the layer-count query is a FOURTH array id (WGSL has a dedicated
      // function, GLSL reads textureSize's .z), so it must be swept too.
      textureNumLayers(bindingRef('ta', texture2dArrayfT)),
    ]
    const unclassified = samples
      .map((n) => n.expr)
      .filter((e): e is Extract<typeof e, { op: 'call' }> => e.op === 'call')
      .map((e) => e.fn)
      .filter((id) => !isKnownIntrinsic(id) && !PRE_EMIT_INTRINSICS.has(id))
    expect(unclassified).toEqual([])
  })
})

// ═══ P1-34 of #155 — a portable id is spelled identically by the REAL writers ═══
//
// "Portable" is asserted only negatively above: an id is in `INTRINSICS` or in
// `PORTABLE_INTRINSICS`, never both, and every `INTRINSICS` row genuinely diverges. Nothing
// checked the positive claim the set's own comment makes — that a portable id reaches both
// targets as `name(args)`.
//
// WHY THROUGH `emitModule` / `emitGlslModule` AND NOT `spellIntrinsic`. `spellIntrinsic` falls
// through to `${name}(${args})` for anything without an `INTRINSICS` row, so asserting it on a
// portable id would be true BY CONSTRUCTION — a test that cannot fail. The thing that can
// rewrite a portable call is downstream of the registry: the GLSL legalizer, the emit-alias
// pass, a backend's own special case. So the assertion runs the whole writer and reads the
// call out of the emitted text.
describe('every PORTABLE id survives both writers under its own name', () => {
  const ARG_NAMES = ['a', 'b', 'c', 'd'] as const

  /** `fn probe(a: f32, …) -> f32 { return <id>(a, …) }`, with the arity the front end's own
   *  table gives the id. The parameters are `f32` because what is measured is the call TEXT,
   *  not the type: a writer that rewrites `mod` or `round` does it by name. */
  const probeModule = (id: string, arity: number): ModuleDecl => {
    const params = ARG_NAMES.slice(0, arity).map((name) => ({ name, type: f32T }))
    return module({
      funcs: [
        {
          name: 'probe',
          params,
          ret: f32T,
          body: [
            {
              s: 'return',
              expr: {
                op: 'call',
                fn: id,
                type: f32T,
                args: params.map((p) => ({ op: 'param', type: f32T, name: p.name })),
              },
            },
          ],
        } as unknown as FuncDecl,
      ],
    })
  }

  const returnedCall = (text: string): string => /return ([^;]*);/.exec(text)?.[1] ?? '<no return>'

  it('spells every portable id the same way on WGSL and on GLSL ES 3.00, and that way is the id', () => {
    const wrong: string[] = []
    for (const id of [...PORTABLE_INTRINSICS].sort()) {
      const arity = MATH_FN_ARITY[id] ?? 1
      const m = probeModule(id, arity)
      const expected = `${id}(${ARG_NAMES.slice(0, arity).join(', ')})`
      const wgsl = returnedCall(emitModule(m))
      const glsl = returnedCall(emitGlslModule(m, 'fragment'))
      if (wgsl !== expected || glsl !== expected) {
        wrong.push(`${id}: wgsl ${wgsl}, glsl ${glsl}, expected ${expected}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('sees a DIVERGENT id through the same probe, so the arm above is not measuring nothing', () => {
    // `round` is in `INTRINSICS` precisely because GLSL ES 3.00's `round()` is
    // implementation-chosen at exact halves; it must come out as `roundEven` on the GLSL side.
    const m = probeModule('round', 1)
    expect(returnedCall(emitModule(m))).toBe('round(a)')
    expect(returnedCall(emitGlslModule(m, 'fragment'))).toBe('roundEven(a)')
  })
})
