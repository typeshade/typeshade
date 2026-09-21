import { describe, it, expect } from 'vitest'
import { fn, module, f32, vec4, u32T, f32T, vec4fT, vec2fT } from './ir/index.js'
import type { FuncDecl, ShaderType, Stmt } from './ir/index.js'
import { compileModule, ORACLE_BUILTIN_NAMES, ORACLE_GPU_STUB_NAMES } from './oracle.js'
import {
  ATOMIC_INTRINSICS,
  BARRIER_INTRINSICS,
  INTRINSICS,
  PORTABLE_INTRINSICS,
} from './intrinsics.js'
import { pow, fract, round, unpack4x8unorm, pack4x8unorm, bitcastU32 } from './ir/index.js'

// ═══ X-GIS #763 Phase O — the CPU oracle is a backend too ═══
//
// The parity-gate methodology (GPU vs f64 mirror) rests on the oracle being
// boring: same intrinsic set, fail-loud on what it cannot compute, never a
// plausible-wrong value. compileModule is PRODUCTION-used (map cpu-projections).

const mat3T: ShaderType = { kind: 'mat', n: 3 } as unknown as ShaderType
const vec3T: ShaderType = { kind: 'vec', n: 3, elem: 'f32' } as ShaderType

/** Hand-built decl: `fn f(m: mat3, v: vec3) -> vec3 { return m <bop> v }` —
 *  the IR-literal shape (no mat3 authoring surface exists; the oracle must
 *  still be correct or loud on it). */
const matBinFn = (name: string, aT: ShaderType, bT: ShaderType, retT: ShaderType): FuncDecl => ({
  name,
  params: [
    { name: 'a', type: aT },
    { name: 'b', type: bT },
  ],
  ret: retT,
  body: [
    {
      s: 'return',
      expr: {
        op: 'binop',
        bop: '*',
        type: retT,
        a: { op: 'param', type: aT, name: 'a' },
        b: { op: 'param', type: bT, name: 'b' },
      },
    } as unknown as Stmt,
  ],
})

describe('X-GIS #763 O — oracle backend parity', () => {
  it('O1: pow / fract / unpack4x8unorm / bitcastU32 evaluate on the CPU', () => {
    const f = fn('o1', { x: f32T }, ({ x }) => {
      const p = pow(x, f32(10)) // 2^10 = 1024
      const fr = fract(f32(1.25)) // 0.25
      const rt = unpack4x8unorm(pack4x8unorm(vec4(1, 0, 0.5, 1)))
      const bc = bitcastU32(f32(1)) // 0x3f800000
      return vec4(
        p,
        fr,
        rt.z.mul(255),
        bitcastU32(f32(0)).add(bc).bitAnd(bc).eq(bc).select(f32(1), f32(0)),
      )
    })
    const m = compileModule(module({ funcs: [f] }))
    const out = m.fns['o1']!(2) as number[]
    expect(out[0]).toBe(1024)
    expect(out[1]).toBeCloseTo(0.25, 12)
    expect(out[2]).toBeCloseTo(128, 6) // 0.5 → byte 128 → *255/255
    expect(out[3]).toBe(1) // bitcastU32(1.0) === 0x3f800000 path exercised
  })

  it('O2: mat3 × vec3 is dimension-correct (the mat4-hardcoded form returned NaN)', () => {
    // Column-major identity with a translation-free 3x3: scale by [1,2,3] on the diagonal.
    const decl = matBinFn('o2', mat3T, vec3T, vec3T)
    const m = compileModule(module({ funcs: [decl] }))
    const diag = [1, 0, 0, 0, 2, 0, 0, 0, 3] // columns of diag(1,2,3)
    const out = m.fns['o2']!(diag, [10, 20, 30]) as number[]
    expect(out).toEqual([10, 40, 90]) // fail-before: [NaN, NaN, NaN]
  })

  it('O2: mat × mat computes the real column-major product; vec × mat fails LOUD', () => {
    // mat*mat is now a real column-major product (the mat64 matmul path needs it;
    // it matches both GPU backends' native mat*mat). diag(1,2,3)² = diag(1,4,9).
    const mm = compileModule(module({ funcs: [matBinFn('o2mm', mat3T, mat3T, mat3T)] }))
    const diag = [1, 0, 0, 0, 2, 0, 0, 0, 3]
    expect(mm.fns['o2mm']!(diag, diag)).toEqual([1, 0, 0, 0, 4, 0, 0, 0, 9])
    // vec × mat (row-vector form) is still unimplemented — fail loud, not wrong.
    const vm = compileModule(module({ funcs: [matBinFn('o2vm', vec3T, mat3T, vec3T)] }))
    expect(() => vm.fns['o2vm']!([1, 2, 3], [1, 0, 0, 0, 1, 0, 0, 0, 1])).toThrow(/vec\*mat/)
  })

  it('O3: GPU-only stubs throw by default, return placeholders only under opt-in', () => {
    const tex = { op: 'param', type: { kind: 'texture', dim: '2d' }, name: 't' }
    const smp = { op: 'param', type: { kind: 'sampler' }, name: 's' }
    const decl: FuncDecl = {
      name: 'o3',
      params: [
        { name: 't', type: tex.type as ShaderType },
        { name: 's', type: smp.type as ShaderType },
        { name: 'uv', type: vec2fT },
      ],
      ret: vec4fT,
      body: [
        {
          s: 'return',
          expr: {
            op: 'call',
            fn: 'textureSample',
            type: vec4fT,
            args: [tex, smp, { op: 'param', type: vec2fT, name: 'uv' }],
          },
        } as unknown as Stmt,
      ],
    }
    const strict = compileModule(module({ funcs: [decl] }))
    expect(() => strict.fns['o3']!(0, 0, [0.5, 0.5])).toThrow(/GPU-only/)
    const loose = compileModule(module({ funcs: [decl] }), { gpuStubs: true })
    expect(loose.fns['o3']!(0, 0, [0.5, 0.5])).toEqual([0, 0, 0, 1])
  })

  it('O3: the 2d-array reads (X-GIS #1651) carry the SAME stub contract as their 2d twins', () => {
    const arrTex = { op: 'param', type: { kind: 'texture', dim: '2d-array' }, name: 't' }
    const smp = { op: 'param', type: { kind: 'sampler' }, name: 's' }
    const uv = { op: 'param', type: vec2fT, name: 'uv' }
    const layer = { op: 'lit', type: u32T, value: 1 }
    const arrayCall = (fnId: string, args: readonly unknown[]): FuncDecl => ({
      name: 'o3a',
      params: [
        { name: 't', type: arrTex.type as ShaderType },
        { name: 's', type: smp.type as ShaderType },
        { name: 'uv', type: vec2fT },
      ],
      ret: vec4fT,
      body: [
        { s: 'return', expr: { op: 'call', fn: fnId, type: vec4fT, args } },
      ] as unknown as Stmt[],
    })
    const cases: readonly (readonly [string, readonly unknown[]])[] = [
      ['textureSampleArray', [arrTex, smp, uv, layer]],
      ['textureSampleLevelArray', [arrTex, smp, uv, layer, { op: 'lit', type: f32T, value: 0 }]],
      ['textureLoadArray', [arrTex, uv, layer, layer]],
    ]
    for (const [fnId, args] of cases) {
      const decl = arrayCall(fnId, args)
      const strict = compileModule(module({ funcs: [decl] }))
      expect(() => strict.fns['o3a']!(0, 0, [0.5, 0.5]), fnId).toThrow(/GPU-only/)
      const loose = compileModule(module({ funcs: [decl] }), { gpuStubs: true })
      expect(loose.fns['o3a']!(0, 0, [0.5, 0.5]), fnId).toEqual([0, 0, 0, 1])
    }
  })

  it('O3: the layer-count query (X-GIS #1658) carries the SAME stub contract as the array reads', () => {
    const arrTex = { op: 'param', type: { kind: 'texture', dim: '2d-array' }, name: 't' }
    const decl: FuncDecl = {
      name: 'o3n',
      params: [{ name: 't', type: arrTex.type as ShaderType }],
      ret: u32T,
      body: [
        { s: 'return', expr: { op: 'call', fn: 'textureNumLayers', type: u32T, args: [arrTex] } },
      ] as unknown as Stmt[],
    }
    const strict = compileModule(module({ funcs: [decl] }))
    expect(() => strict.fns['o3n']!(0)).toThrow(/GPU-only/)
    const loose = compileModule(module({ funcs: [decl] }), { gpuStubs: true })
    // 1 layer, not 0 — the same finite-placeholder rule as textureDimensions' 1×1.
    expect(loose.fns['o3n']!(0)).toBe(1)
  })

  it('O4: round is roundTiesToEven, not Math.round', () => {
    const f = fn('o4', { x: f32T }, ({ x }) => round(x))
    const m = compileModule(module({ funcs: [f] }))
    expect(m.fns['o4']!(2.5)).toBe(2)
    expect(m.fns['o4']!(3.5)).toBe(4)
    expect(m.fns['o4']!(-2.5)).toBe(-2)
  })

  it('O5: every catalogued intrinsic has a CPU twin or is a declared GPU stub', () => {
    // Covered by a dedicated Expr op in the oracle, not a call dispatch:
    // `select` is the 'select' Expr case (evalExpr) — it can never arrive as a call. The
    // atomic builtins (roadmap 0.2 item 4) arrive as calls but take their first argument as a
    // LOCATION, so the oracle's 'call' case resolves them itself (`evalAtomic`) before the
    // BUILTINS lookup; `atomics.test.ts` runs every one of them on both CPU backends. The
    // barriers are a statement `dispatch` synchronizes at and a no-op in the walk itself.
    const EXPR_COVERED = new Set([
      'select',
      ...Object.keys(ATOMIC_INTRINSICS),
      ...BARRIER_INTRINSICS,
    ])
    // GLSL-only synthetic: created by lowerStorageToDataTexture INSIDE the GLSL
    // emit path — compileModule never sees it (and `unknown fn` would fail loud).
    const GLSL_SYNTHETIC = new Set(['storageFetchF32', 'storageFetchU32', 'storageFetchI32'])
    const catalogued = Object.keys(INTRINSICS)
    const missing = catalogued.filter(
      (name) =>
        !ORACLE_BUILTIN_NAMES.has(name) &&
        !ORACLE_GPU_STUB_NAMES.has(name) &&
        !EXPR_COVERED.has(name) &&
        !GLSL_SYNTHETIC.has(name),
    )
    // A name landing here means: it emits on WGSL/GLSL but throws `unknown fn`
    // at first CPU use. Add it to BUILTINS (pure math) or GPU_STUBS (documented).
    expect(missing).toEqual([])
  })

  it('O6: assignOp threads the i32 arithmetic-shift flag', () => {
    const i32T: ShaderType = { kind: 'scalar', scalar: 'i32' } as ShaderType
    const decl: FuncDecl = {
      name: 'o6',
      params: [{ name: 'x', type: i32T }],
      ret: i32T,
      body: [
        { s: 'var', name: 'v', type: i32T, init: { op: 'param', type: i32T, name: 'x' } },
        {
          s: 'assignOp',
          target: { op: 'varref', type: i32T, name: 'v' },
          bop: '>>',
          expr: { op: 'lit', type: u32T, value: 1 },
        },
        { s: 'return', expr: { op: 'varref', type: i32T, name: 'v' } },
      ] as unknown as Stmt[],
    }
    const m = compileModule(module({ funcs: [decl] }))
    expect(m.fns['o6']!(-8)).toBe(-4) // fail-before: logical shift → 2147483644
  })
})

// ═══ O3b and O5b — every stub, by value, and every portable id, by twin (P1-25, P1-26) ═══
//
// O3 above pins the stub contract for six ids by hand. The contract is a PROMISE about all 46:
// evaluating one without `{ gpuStubs: true }` throws, and with it yields a documented
// placeholder that keeps the rest of the shader finite. Neither half was checked for the other
// forty, and O5 cannot catch a break: it compares NAMES, so a stub whose key is misspelled or
// whose body starts returning `undefined` passes it while every shader that calls it silently
// computes `NaN`.
//
// The table below is the placeholder VALUES, written out, with the rule each one follows —
// a texel has no identity so it is opaque black; a factor does, so a comparison is 1; a count
// or a size is 1 so a divide by it stays finite. A new stub has to join the table, which is
// where its author states which rule it follows.
describe('O3b/O5b — the GPU stub contract, for every stub', () => {
  /** A texel: the oracle has no texture memory, and opaque black is not a colour a shader
   *  would mistake for a measurement. */
  const BLACK = [0, 0, 0, 1]
  /** How much of the filter footprint passed. 1 is the identity for the multiply it feeds, so
   *  the absence of a shadow map leaves the rest of the shader alone. */
  const PASSED = 1
  /** Four of the above, one per gathered texel. */
  const PASSED4 = [1, 1, 1, 1]

  const EXPECTED: Readonly<Record<string, unknown>> = {
    // Reads: a texel.
    textureSample: BLACK,
    textureSampleLevel: BLACK,
    textureLoad: BLACK,
    textureSampleArray: BLACK,
    textureSampleLevelArray: BLACK,
    textureLoadArray: BLACK,
    textureSampleBias: BLACK,
    textureSampleBiasArray: BLACK,
    textureSampleGrad: BLACK,
    textureSampleGradArray: BLACK,
    textureSampleCubeArray: BLACK,
    textureSampleLevelCubeArray: BLACK,
    textureSampleBiasCubeArray: BLACK,
    textureSampleGradCubeArray: BLACK,
    textureGather: BLACK,
    textureGatherArray: BLACK,
    textureLoadMs: BLACK,
    // Depth reads and comparisons: a pass factor, or the far plane, which is the same number
    // for the same reason — nothing occludes.
    textureGatherDepth: PASSED4,
    textureGatherDepthArray: PASSED4,
    textureGatherCompare: PASSED4,
    textureGatherCompareArray: PASSED4,
    textureSampleCompare: PASSED,
    textureSampleCompareArray: PASSED,
    textureSampleCompareLevel: PASSED,
    textureSampleCompareLevelArray: PASSED,
    textureSampleCompareCube: PASSED,
    textureSampleCompareLevelCube: PASSED,
    textureSampleCompareCubeArray: PASSED,
    textureSampleCompareLevelCubeArray: PASSED,
    textureLoadDepthMs: PASSED,
    // Queries: a finite 1, so a divide or a modulo by the answer stays finite.
    textureDimensions: [1, 1],
    textureDimensions3d: [1, 1, 1],
    textureDimensions1d: 1,
    textureDimensionsMs: [1, 1],
    textureNumSamples: 1,
    textureNumLayers: 1,
    // A write goes nowhere; `textureStore` is `void`, so nothing reads the value.
    textureStore: 0,
    // The derivatives keep the ARGUMENT's shape: `dpdx(v)` on a vec2 is a vec2 of zeros, not
    // the scalar 0, or `dpdx(v).x` is `undefined` and `length(fwidth(v))` throws.
    fwidth: [0, 0],
    fwidthCoarse: [0, 0],
    fwidthFine: [0, 0],
    dpdx: [0, 0],
    dpdxCoarse: [0, 0],
    dpdxFine: [0, 0],
    dpdy: [0, 0],
    dpdyCoarse: [0, 0],
    dpdyFine: [0, 0],
  }

  /** `fn probe(x: vec2) -> f32 { return <id>(x) }`. One vec2 argument serves every stub: the
   *  texture ones ignore their arguments, and the derivatives need exactly one whose shape
   *  they mirror — which is what makes the vec2 rows above a real assertion. */
  const probeDecl = (id: string): FuncDecl =>
    ({
      name: 'probe',
      params: [{ name: 'x', type: vec2fT }],
      ret: f32T,
      body: [
        {
          s: 'return',
          expr: {
            op: 'call',
            fn: id,
            type: f32T,
            args: [{ op: 'param', type: vec2fT, name: 'x' }],
          },
        },
      ],
    }) as unknown as FuncDecl

  it('O3b: every GPU stub is in the value table, and the table names no stub that is gone', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...ORACLE_GPU_STUB_NAMES].sort())
  })

  it('O3b: every GPU stub THROWS in strict mode — a plausible-wrong value is the worst failure', () => {
    for (const id of ORACLE_GPU_STUB_NAMES) {
      const strict = compileModule(module({ funcs: [probeDecl(id)] }))
      expect(() => strict.fns['probe']!([1, 2]), id).toThrow(/GPU-only/)
    }
  })

  it('O3b: every GPU stub returns its documented placeholder under gpuStubs', () => {
    for (const [id, value] of Object.entries(EXPECTED)) {
      const loose = compileModule(module({ funcs: [probeDecl(id)] }), { gpuStubs: true })
      expect(loose.fns['probe']!([1, 2]), id).toEqual(value)
    }
  })

  it('O5b: every PORTABLE id has a CPU twin too, not only the divergent ones', () => {
    // O5 iterates `INTRINSICS` — the DIVERGENT map — so a portable id with no CPU body throws
    // `unknown fn` at the first `compile().eval`. The two sets can cross: `fwidth` is portable
    // AND a stub, which is the proof that "portable" says nothing about the oracle.
    const EXPR_COVERED = new Set([
      'select',
      ...Object.keys(ATOMIC_INTRINSICS),
      ...BARRIER_INTRINSICS,
    ])
    const missing = [...PORTABLE_INTRINSICS].filter(
      (id) =>
        !ORACLE_BUILTIN_NAMES.has(id) && !ORACLE_GPU_STUB_NAMES.has(id) && !EXPR_COVERED.has(id),
    )
    expect(missing).toEqual([])
  })
})
