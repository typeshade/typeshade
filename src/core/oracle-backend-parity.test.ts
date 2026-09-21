import { describe, it, expect } from 'vitest'
import { fn, module, f32, vec4, u32T, f32T, vec4fT, vec2fT, matT } from './ir/index.js'
import type { FuncDecl, ShaderType, Stmt } from './ir/index.js'
import { compileModule, ORACLE_BUILTIN_NAMES, ORACLE_GPU_STUB_NAMES } from './oracle.js'
import { ATOMIC_INTRINSICS, BARRIER_INTRINSICS, INTRINSICS } from './intrinsics.js'
import { pow, fract, round, unpack4x8unorm, pack4x8unorm, bitcastU32 } from './ir/index.js'

// ═══ X-GIS #763 Phase O — the CPU oracle is a backend too ═══
//
// The parity-gate methodology (GPU vs f64 mirror) rests on the oracle being
// boring: same intrinsic set, fail-loud on what it cannot compute, never a
// plausible-wrong value. compileModule is PRODUCTION-used (map cpu-projections).

const mat3T: ShaderType = matT(3, 3)
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

  it('O2: mat × mat computes the real column-major product', () => {
    // mat*mat is a real column-major product (the mat64 matmul path needs it; it matches both
    // GPU backends' native mat*mat). diag(1,2,3)² = diag(1,4,9).
    const mm = compileModule(module({ funcs: [matBinFn('o2mm', mat3T, mat3T, mat3T)] }))
    const diag = [1, 0, 0, 0, 2, 0, 0, 0, 3]
    expect(mm.fns['o2mm']!(diag, diag)).toEqual([1, 0, 0, 0, 4, 0, 0, 0, 9])
  })

  // `vec × mat` used to throw here ("fail loud, not wrong") because no front end could build
  // one. wgsl.txt:9960-9995 gives it the ROW-vector product and #149 types it, so the oracle
  // now has to compute it — an evaluator that throws on a form the compiler emits is the
  // divergence this suite exists to catch.
  it('O2: vec × mat is the row-vector product, which is transpose(m) * v', () => {
    const vm = compileModule(module({ funcs: [matBinFn('o2vm', vec3T, mat3T, vec3T)] }))
    // Deliberately NOT symmetric: with a symmetric matrix the row and column products agree
    // and the comparison below proves nothing.
    const m = [1, 2, 3, 4, 5, 6, 7, 8, 9] // columns (1,2,3) (4,5,6) (7,8,9)
    const v = [1, 0, 0]
    // v · each column.
    expect(vm.fns['o2vm']!(v, m)).toEqual([1, 4, 7])
    // The column form takes the first column whole, so the two really do differ.
    const mv = compileModule(module({ funcs: [matBinFn('o2mv', mat3T, vec3T, vec3T)] }))
    expect(mv.fns['o2mv']!(m, v)).toEqual([1, 2, 3])
  })

  it('O2: a NON-SQUARE product is shaped by the static type, not by the value length', () => {
    // Six numbers are a mat2x3 or a mat3x2 and the two multiply to different shapes, which a
    // flat column-major list cannot say. mat2x3 (2 columns of 3) times a vec2 gives a vec3.
    const mat2x3T = matT(2, 3)
    const vec2T: ShaderType = { kind: 'vec', n: 2, elem: 'f32' }
    const mv = compileModule(module({ funcs: [matBinFn('o2ns', mat2x3T, vec2T, vec3T)] }))
    const m = [1, 2, 3, 4, 5, 6] // columns (1,2,3) and (4,5,6)
    expect(mv.fns['o2ns']!(m, [1, 0])).toEqual([1, 2, 3])
    expect(mv.fns['o2ns']!(m, [0, 1])).toEqual([4, 5, 6])
    // The SAME six numbers as a mat3x2 — 3 columns of 2 — take a vec3 and give a vec2, which
    // is the whole point: the value is identical and only the static shape decides.
    const t = compileModule(module({ funcs: [matBinFn('o2nsT', matT(3, 2), vec3T, vec2T)] }))
    expect(t.fns['o2nsT']!(m, [1, 0, 0])).toEqual([1, 2])
    expect(t.fns['o2nsT']!(m, [0, 0, 1])).toEqual([5, 6])
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
