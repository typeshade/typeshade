// Builtin breadth (roadmap 0.2 item 8, §10): reflect, refract, faceForward, transpose,
// determinant, ldexp, the eight bit builtins and the coarse and fine derivatives. Measured on
// `main` before this: every one was TS8004 "Unknown function". What is pinned here: the WGSL
// and GLSL spelling of each (the bit builtins as GLSL ES 3.00 helper functions), the oracle and
// the codegen agreeing on hand-computed values, the kind-dependent bit results for u32 and
// i32, the literal typing of ldexp and extractBits, and the fragment-only rule.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { compileTsSource } from './source-file.js'
import { compileModule } from '../../core/oracle.js'
import { compileModuleJs } from '../../core/cpu-codegen.js'
import type { CpuValue } from '../../core/cpu-runtime.js'

const U = `class U { k: u32; s: i32; v: vec2i; m: mat4; w: vec4 }
declare const u: uniform<U>`
const FS = (body: string) => `"use typeshade"
${U}
@fragment
export function fs(@location(0) uv: vec2): vec4 {
${body}
}
`
// k = 0xF0, s = -8 (0xFFFFFFF8), v = (-8, 0), m = the column-major matrix with columns
// (2, 0, 0, 0), (1, 3, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1); w = (1, 2, 3, 4).
const BINDINGS = {
  u: {
    k: 240,
    s: -8,
    v: [-8, 0],
    m: [2, 0, 0, 0, 1, 3, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    w: [1, 2, 3, 4],
  },
}
const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`)

/** Both CPU paths on `src` with the bindings above, asserted equal to `expected`. */
function agree(src: string, expected: number[]): ReturnType<typeof compile> {
  const r = compile(src)
  expect(r.diagnostics).toEqual([])
  for (const make of [compileModule, compileModuleJs]) {
    const cm = make(r.module)
    cm.setBinding('u', BINDINGS.u as unknown as CpuValue)
    expect(cm.fns['fs']!([0, 0]), make.name).toEqual(expected)
  }
  return r
}
const lines = (text: string | undefined, re: RegExp) =>
  (text ?? '')
    .split('\n')
    .filter((l) => re.test(l))
    .join('\n')

describe('builtin breadth: geometry, matrices and exponents', () => {
  it('reflect, refract and faceForward', () => {
    const r = agree(
      FS(`  const n = vec3(0., 1., 0.)
  const i = normalize(vec3(1., -1., 0.))
  const rf = reflect(i, n)
  const t = refract(i, n, 0.5)
  const f = faceForward(n, i, n)
  return vec4(rf.x + rf.y, t.y, f.y, 1.)`),
      [1.414213562373095, -0.9354143466934853, 1, 1],
    )
    expect(r.wgsl).toContain('let f = faceForward(n, i, n);')
    expect(r.glsl?.fragment).toContain('vec3 f = faceforward(n, i, n);')
    expect(r.glsl?.fragment).toContain('vec3 t = refract(i, n, 0.5);')
  })

  it('transpose and determinant on a mat4', () => {
    // m * w = (2 + 2, 6, 3, 4); transpose(m) * w = (2, 1 + 6, 3, 4).
    const r = agree(
      FS(`  const a = u.m * u.w
  const b = transpose(u.m) * u.w
  return vec4(determinant(u.m), a.x, b.x, b.y)`),
      [6, 4, 2, 7],
    )
    expect(r.wgsl).toContain('transpose(u.m)')
    expect(r.wgsl).toContain('determinant(u.m)')
    expect(r.glsl?.fragment).toContain('determinant(u.m)')
  })

  it('ldexp with a scalar and a vector exponent; a bare literal exponent is an i32', () => {
    const r = agree(
      FS(`  const e = ldexp(1.5, 3)
  const v = ldexp(vec2(1., 2.), vec2i(1, -1))
  return vec4(e, v, 1.)`),
      [12, 2, 1, 1],
    )
    expect(r.wgsl).toContain('let e = ldexp(1.5, 3);')
    // GLSL ES 3.00 has no ldexp: the power of two is built from its bits, in TWO HALVES (#141).
    // One biased exponent cannot hold the range WGSL admits — `(e + 127) << 23` is the pattern
    // of 2^e only while `e + 127` lands in [1, 254], and outside it the pattern means something
    // else entirely (+Inf at e = 128, a large NEGATIVE float below e = -127). Measured over
    // every legal exponent, -149 to 128: the single-scale form disagreed with WGSL on 22 of
    // 278, the two-half form on none.
    expect(r.glsl?.fragment).toContain(
      'vec2 v = (vec2(1.0, 2.0) * intBitsToFloat(((ivec2(1, -1) >> 1) + 127) << 23) * ' +
        'intBitsToFloat(((ivec2(1, -1) - (ivec2(1, -1) >> 1)) + 127) << 23));',
    )
  })
})

describe('builtin breadth: the bit builtins', () => {
  it('counts and reversal on a u32, with the GLSL spellings', () => {
    const r = agree(
      FS(`  const a = countOneBits(u.k)
  const b = reverseBits(u.k)
  const c = countLeadingZeros(u.k)
  const d = countTrailingZeros(u.k)
  return vec4(f32(a), f32(b >> 24), f32(c), f32(d))`),
      [4, 15, 24, 4],
    )
    // GLSL ES 3.00 has no bit builtins (ES 3.10 added them; ANGLE refuses `bitCount`), so
    // each is a helper the module defines once per argument type, ahead of its functions.
    expect(lines(r.glsl?.fragment, /^  uint [abcd] = /)).toBe(
      '  uint a = _popcnt(u.k);\n  uint b = _brev(u.k);\n  uint c = _clz(u.k);\n  uint d = _ctz(u.k);',
    )
    const defs = (r.glsl?.fragment ?? '').match(/^\w+ _\w+\(/gm)
    expect(defs).toEqual(['uint _popcnt(', 'uint _brev(', 'uint _msb(', 'uint _clz(', 'uint _ctz('])
    expect(r.glsl?.fragment).toContain('uint _msb(uint x) {')
    expect(r.glsl?.fragment).toContain('  return 31u - _msb(x);')
    expect(r.glsl?.fragment).toContain('  return _popcnt(~x & (x - 1u));')
    // A module that calls none carries none.
    expect(compile(FS('  return vec4(f32(u.k), 0., 0., 1.)')).glsl?.fragment).not.toContain(
      '_popcnt',
    )
  })

  it('firstLeadingBit and firstTrailingBit keep the argument type: u32 casts back, i32 does not', () => {
    const r = agree(
      FS(`  const a = firstLeadingBit(u.k)
  const b = firstTrailingBit(u.k)
  const c = firstLeadingBit(u.s)
  const d = firstTrailingBit(u.s)
  return vec4(f32(a), f32(b), f32(c), f32(d))`),
      // 0xF0: bits 7 and 4. -8 = 0xFFFFFFF8: the highest bit that differs from the sign is 2,
      // the lowest 1 bit is 3.
      [7, 4, 2, 3],
    )
    expect(r.glsl?.fragment).toContain('uint a = _msb(u.k);')
    expect(r.glsl?.fragment).toContain('int c = _msb(u.s);')
    expect(r.glsl?.fragment).toContain('int d = _lsb(u.s);')
    // The signed overload flips a negative value first and casts to the unsigned helper,
    // which the emitter defines ahead of it.
    expect((r.glsl?.fragment ?? '').match(/^\w+ _\w+\(/gm)).toEqual([
      'uint _msb(',
      'int _msb(',
      'uint _lsb(',
      'int _lsb(',
    ])
    expect(r.glsl?.fragment).toContain(
      'int _msb(int x) {\n  return int(_msb(uint(x ^ (x >> 31))));\n}',
    )
    expect(r.glsl?.fragment).toContain('int _lsb(int x) {\n  return int(_lsb(uint(x)));\n}')
  })

  it('the zero cases: 32 leading and trailing zeros, all ones for no bit', () => {
    agree(
      FS(`  const z = u.k - 240
  const zi = u.s + 8
  return vec4(f32(countLeadingZeros(z)), f32(countTrailingZeros(z)), f32(firstTrailingBit(zi)), select(0., 1., firstLeadingBit(z) === 4294967295))`),
      [32, 32, -1, 1],
    )
  })

  it('extractBits and insertBits, sign-extended on an i32; bare offsets are u32', () => {
    const r = agree(
      FS(`  const a = extractBits(u.k, 4, 8)
  const b = insertBits(u.k, 15, 4, 4)
  const c = extractBits(u.s, 1, 4)
  return vec4(f32(a), f32(b), f32(c), f32(reverseBits(u.s)))`),
      // (0xF0 >> 4) & 0xFF = 15; the field is already 0xF; bits 1..4 of ...F8 are 1100, which
      // sign-extends to -4; the reversal of 0xFFFFFFF8 is 0x1FFFFFFF.
      [15, 240, -4, 536870911],
    )
    expect(r.wgsl).toContain('let a = extractBits(u.k, 4u, 8u);')
    expect(r.wgsl).toContain('let b = insertBits(u.k, 15u, 4u, 4u);')
    expect(r.glsl?.fragment).toContain('uint a = _xbits(u.k, 4u, 8u);')
    expect(r.glsl?.fragment).toContain('uint b = _ibits(u.k, 15u, 4u, 4u);')
    expect(r.glsl?.fragment).toContain('int c = _xbits(u.s, 1u, 4u);')
    // One text for both signednesses: a right shift of an int is arithmetic in GLSL.
    expect(r.glsl?.fragment).toContain('uint _xbits(uint e, uint o, uint c) {')
    expect(r.glsl?.fragment).toContain('int _xbits(int e, uint o, uint c) {')
    expect(r.glsl?.fragment).toContain('uint _ibits(uint e, uint n, uint o, uint c) {')
  })

  it('componentwise over an integer vector, with the vector GLSL spellings', () => {
    const r = agree(
      FS(`  const a = countLeadingZeros(u.v)
  const b = firstLeadingBit(u.v)
  const c = countTrailingZeros(u.v)
  const d = countOneBits(u.v)
  return vec4(f32(a.x), f32(b.x), f32(c.y), f32(d.x))`),
      [0, 2, 32, 29],
    )
    expect(r.glsl?.fragment).toContain('ivec2 a = _clz(u.v);')
    expect(r.glsl?.fragment).toContain('ivec2 b = _msb(u.v);')
    expect(r.glsl?.fragment).toContain('ivec2 c = _ctz(u.v);')
    expect(r.glsl?.fragment).toContain('ivec2 d = _popcnt(u.v);')
    // The vector overloads compare through greaterThanEqual and equal.
    expect(r.glsl?.fragment).toContain('uvec2 _msb(uvec2 x) {')
    expect(r.glsl?.fragment).toContain(
      '  uvec2 s = uvec2(greaterThanEqual(x, uvec2(0x10000u))) << 4u;',
    )
    expect(r.glsl?.fragment).toContain('  return r - uvec2(equal(x, uvec2(0u)));')
    expect(r.glsl?.fragment).toContain('ivec2 _clz(ivec2 x) {\n  return ivec2(_clz(uvec2(x)));\n}')
  })
})

describe('builtin breadth: the coarse and fine derivatives', () => {
  it('spell as the granularity-free derivative on GLSL and stay fragment-only', () => {
    const r = compile(
      FS(
        `  return vec4(dpdxCoarse(uv.x) + dpdyFine(uv.y) + fwidthCoarse(uv.x), fwidthFine(uv).x, 0., 1.)`,
      ),
    )
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain(
      'dpdxCoarse(uv.x) + dpdyFine(uv.y)) + fwidthCoarse(uv.x)), fwidthFine(uv).x',
    )
    expect(r.glsl?.fragment).toContain('dFdx(uv.x) + dFdy(uv.y)) + fwidth(uv.x)), fwidth(uv).x')
    // GPU-only on the CPU, as the plain three are; a stub under gpuStubs, which `eval` turns on.
    expect(() => compileModule(r.module).fns['fs']!([0, 0])).toThrow(
      "'dpdxCoarse' is GPU-only and not computable here",
    )
    expect(r.eval('fs', [[0.5, 0.5]])).toEqual([0, 0, 0, 1])
    expect(
      errorsOf(`"use typeshade"
@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 {
  return vec4(dpdyCoarse(f32(vi)))
}
`),
    ).toEqual(['TS8099 "dpdyCoarse" is only valid in a fragment shader; "vs" is a vertex entry.'])
  })

  it('a function the file declares under one of the names keeps the call', () => {
    const r = compile(`"use typeshade"
function reflect(a: vec3, b: vec3): vec3 {
  return a + b
}
@fragment
export function fs(): vec4 {
  return vec4(reflect(vec3(1.), vec3(2.)), 1.)
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('fn reflect(a: vec3<f32>, b: vec3<f32>) -> vec3<f32> {')
    expect(r.eval('fs', [])).toEqual([3, 3, 3, 1])
  })
})

// The bit-level builtins #150 made authorable. The IR and both backends have spelled the eight
// pack/unpack ids and the two bitcast ids since the registry was written; nothing on this
// surface could NAME them, so every one was TS8004 "Unknown function". `quantizeToF16` and the
// 4x8 snorm pair are new rows. What is pinned here: the WGSL and GLSL spelling of each, and the
// CPU value against the number the spec fixes.
describe('the bit-level builtins: pack, unpack, bitcast and quantizeToF16', () => {
  /** `fs` over no bindings, on both CPU paths. */
  const value = (body: string): number[] => {
    const r = compile(`"use typeshade"
@fragment
export function fs(@location(0) uv: vec2): vec4 {
${body}
}
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const out: number[][] = []
    for (const make of [compileModule, compileModuleJs]) {
      const cm = make(r.module)
      out.push(cm.fns['fs']!([0, 0]) as number[])
    }
    expect(out[0], 'the two CPU paths must agree').toEqual(out[1])
    return out[0]!
  }

  it('quantizeToF16 keeps a value binary16 holds and rounds one it does not', () => {
    // 1 + 2^-10 is the next binary16 after 1, so it survives the round trip exactly. 1 + 2^-11
    // is exactly halfway to it and rounds to even, which is 1.
    expect(value('  return vec4(quantizeToF16(1.0009765625), 0., 0., 1.)')[0]).toBe(1.0009765625)
    expect(value('  return vec4(quantizeToF16(1.00048828125), 0., 0., 1.)')[0]).toBe(1)
    // 65504 is the largest finite binary16; one step past the halfway point to it overflows.
    expect(value('  return vec4(quantizeToF16(65504.), 0., 0., 1.)')[0]).toBe(65504)
    expect(value('  return vec4(quantizeToF16(1e-8), 0., 0., 1.)')[0]).toBe(0)
  })

  it('quantizeToF16 takes a vector, one id per width', () => {
    const r = compile(`"use typeshade"
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  return quantizeToF16(vec4(uv, 1.0009765625, 1.))
}
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toContain('quantizeToF16(vec4<f32>(uv, 1.0009765625, 1.0))')
    // GLSL has no such builtin: the half round trip, two components at a time.
    expect(r.glsl?.fragment).toContain('unpackHalf2x16(packHalf2x16(')
    expect(
      value(
        '  const q = quantizeToF16(vec2(1.0009765625, 1.00048828125))\n  return vec4(q, 0., 1.)',
      ),
    ).toEqual([1.0009765625, 1, 0, 1])
  })

  /** A packed `u32` asserted by COMPARING it in the shader, not by casting it to an f32 and
   *  reading the number out. Every bit pattern worth pinning here is over 24 bits, and `f32()`
   *  of one rounds on a GPU while the f64 oracle would hand back the exact integer — so a test
   *  written that way would pass here and mean nothing about the target. */
  const packs = (expr: string, expected: number): void => {
    expect(
      value(`  return vec4(select(0., 1., ${expr} === u32(${expected})), 0., 0., 1.)`)[0],
    ).toBe(1)
  }

  it('pack2x16float packs component 0 into the low half, as both specs say', () => {
    // 1.0 is 0x3C00 as a binary16, 0.0 is 0x0000, and component 0 is the LOW 16 bits.
    packs('pack2x16float(vec2(1., 0.))', 0x00003c00)
    packs('pack2x16float(vec2(0., 1.))', 0x3c000000)
  })

  it('the 4x8 snorm pair round-trips through the sign-extended bytes', () => {
    // 1 -> 127 (0x7F), -1 -> -127 (0x81), 0 -> 0x00; component 0 is the LOW byte, so
    // (1, -1, 0, 1) packs to 0x7F00817F.
    packs('pack4x8snorm(vec4(1., -1., 0., 1.))', 0x7f00817f)
    expect(value('  return unpack4x8snorm(pack4x8snorm(vec4(1., -1., 0., 1.)))')).toEqual([
      1, -1, 0, 1,
    ])
    // The unorm twin for contrast: 1 -> 255, -1 clamps to 0.
    packs('pack4x8unorm(vec4(1., -1., 0., 1.))', 0xff0000ff)
  })

  it('bitcast reads the same 32 bits the other way, and round-trips', () => {
    // 1.0f is 0x3F800000.
    packs('bitcast<u32>(1.)', 0x3f800000)
    expect(value('  return vec4(bitcast<f32>(u32(1065353216)), 0., 0., 1.)')[0]).toBe(1)
    expect(value('  return vec4(bitcast<f32>(bitcast<u32>(0.15625)), 0., 0., 1.)')[0]).toBe(0.15625)
  })

  it('agrees with the spec value on the six the round trips do not pin', () => {
    // The tests above cover quantizeToF16, pack2x16float, the 4x8 pair and both bitcasts. The
    // remaining six get their own value here, so every one of the twelve names has a number
    // behind it rather than only a spelling.
    // 2x16 unorm: 1.0 -> 0xFFFF, 0.0 -> 0x0000, component 0 in the low half.
    packs('pack2x16unorm(vec2(1., 0.))', 0x0000ffff)
    expect(value('  return vec4(unpack2x16unorm(u32(4294901760)), 0., 1.)')).toEqual([0, 1, 0, 1])
    // 2x16 snorm: 1.0 -> 0x7FFF, -1.0 -> 0x8001 (and -1 is the clamp of -32768/32767).
    packs('pack2x16snorm(vec2(1., -1.))', 0x80017fff)
    expect(value('  return vec4(unpack2x16snorm(pack2x16snorm(vec2(1., -1.))), 0., 1.)')).toEqual([
      1, -1, 0, 1,
    ])
    // 2x16 float: the binary16 of 1.0 is 0x3C00, already pinned; the UNPACK direction is not.
    expect(value('  return vec4(unpack2x16float(u32(15360)), 0., 1.)')).toEqual([1, 0, 0, 1])
    // 4x8 unorm unpack: 0xFF in the low byte is 1.0 in component 0.
    expect(value('  return unpack4x8unorm(u32(255))')).toEqual([1, 0, 0, 0])
  })

  it('spells each one on both targets', () => {
    const r = compile(`"use typeshade"
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  const a = pack4x8unorm(vec4(uv, 0., 1.))
  const b = pack4x8snorm(vec4(uv, 0., 1.))
  const c = pack2x16float(uv)
  const d = pack2x16unorm(uv)
  const e = pack2x16snorm(uv)
  const f = unpack4x8unorm(a) + unpack4x8snorm(b)
  const g = unpack2x16float(c) + unpack2x16unorm(d) + unpack2x16snorm(e)
  return f + vec4(g, 0., 0.) + vec4(f32(bitcast<u32>(uv.x)), quantizeToF16(uv.y), 0., 1.)
}
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const wgsl = r.wgsl ?? ''
    for (const spelling of [
      'pack4x8unorm(',
      'pack4x8snorm(',
      'pack2x16float(',
      'pack2x16unorm(',
      'pack2x16snorm(',
      'unpack4x8unorm(',
      'unpack4x8snorm(',
      'unpack2x16float(',
      'unpack2x16unorm(',
      'unpack2x16snorm(',
      'bitcast<u32>(',
      'quantizeToF16(',
    ])
      expect(wgsl, spelling).toContain(spelling)
    const glsl = r.glsl?.fragment ?? ''
    // The three GLSL ES 3.00 natives, and the hand-inlined pair that spec lacks.
    expect(glsl).toContain('packHalf2x16(')
    expect(glsl).toContain('packUnorm2x16(')
    expect(glsl).toContain('packSnorm2x16(')
    expect(glsl).toContain('floatBitsToUint(')
    expect(glsl).not.toContain('packSnorm4x8(')
    expect(glsl).not.toContain('quantizeToF16(')
  })

  it('refuses the wrong shape, naming the one overload each has', () => {
    expect(errorsOf(FS('  return vec4(f32(pack4x8unorm(uv)), 0., 0., 1.)'))).toEqual([
      'TS8003 pack4x8unorm takes a vec4<f32>; got vec2<f32>. WGSL gives it one overload, and GLSL ES 3.00 the same.',
    ])
    expect(errorsOf(FS('  return unpack2x16float(uv)'))).toEqual([
      'TS8003 unpack2x16float takes a u32; got vec2<f32>. WGSL gives it one overload, and GLSL ES 3.00 the same.',
    ])
    expect(errorsOf(FS('  return vec4(f32(quantizeToF16(u.k)), 0., 0., 1.)'))).toEqual([
      'TS8003 quantizeToF16 takes an f32 or a vector of them; got u32.',
    ])
    expect(errorsOf(FS('  return vec4(f32(bitcast(uv.x)), 0., 0., 1.)'))).toEqual([
      'TS8003 bitcast needs the type to read the bits as, bitcast<u32>(x) or bitcast<f32>(x). Those are the two the IR carries today; the signed pair is not here yet.',
    ])
    expect(errorsOf(FS('  return vec4(f32(bitcast<i32>(uv.x)), 0., 0., 1.)'))).toEqual([
      'TS8003 bitcast needs the type to read the bits as, bitcast<u32>(x) or bitcast<f32>(x); got bitcast<i32>. Those are the two the IR carries today; the signed pair is not here yet.',
    ])
    expect(errorsOf(FS('  return vec4(f32(bitcast<u32>(u.k)), 0., 0., 1.)'))).toEqual([
      'TS8003 bitcast<u32> reads the bits of an f32; got u32. A bitcast reinterprets 32 bits, it does not convert: u32(x) is the conversion.',
    ])
  })

  it('a bare number in an unpack is retargeted, as every integer position is', () => {
    // The bit pattern is written as a number; nobody should have to spell `u32(65536)`.
    const r = compile(`"use typeshade"
@fragment
export function fs(): vec4 {
  return vec4(unpack2x16unorm(65536), 0., 1.)
}
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toContain('unpack2x16unorm(65536u)')
  })
})

// The two PORTABLE lies the spec audit found (#154). `abs` and `dot` were in
// `PORTABLE_INTRINSICS`, which claims a name spells the same on every target. Measured on a
// real WebGL2 driver, with the compile gate's own instrument check passing first:
//
//   abs(uvec3)          REJECTED  'abs' : no matching overloaded function found
//   abs(uint)           REJECTED  'abs' : no matching overloaded function found
//   dot(ivec3, ivec3)   REJECTED  'dot' : no matching overloaded function found
//   dot(uvec3, uvec3)   REJECTED  'dot' : no matching overloaded function found
//   abs(ivec3)          COMPILES      <- the control: the SIGNED abs is real GLSL
//   dot(vec3, vec3)     COMPILES      <- the control: the float dot is real GLSL
describe('the integer abs and dot spell GLSL forms that exist', () => {
  const bothOf = (body: string): { wgsl: string; glsl: string } => {
    const r = compile(`"use typeshade"
${U}
@fragment
export function fs(@location(0) uv: vec2): vec4 {
${body}
}
`)
    expect(r.diagnostics.filter((d) => d.category === 'error').map((d) => d.message)).toEqual([])
    return { wgsl: r.wgsl ?? '', glsl: r.glsl?.fragment ?? '' }
  }

  it('abs on an unsigned value is the identity on GLSL, and still abs on WGSL', () => {
    const { wgsl, glsl } = bothOf(
      '  const uv3 = vec3u(u.k, u.k, u.k)\n  const a = abs(uv3)\n  const b = abs(u.k)\n' +
        '  return vec4(f32(a.x) + f32(b), 0., 0., 1.)',
    )
    expect(wgsl).toContain('abs(uv3)')
    expect(wgsl).toContain('abs(u.k)')
    // No `abs(` on a uvec3 or a uint anywhere in the GLSL: the value is written as it is.
    expect(glsl).toContain('uvec3 a = uv3;')
    expect(glsl).toContain('uint b = u.k;')
  })

  it('abs on a SIGNED integer keeps the portable spelling on both', () => {
    const { wgsl, glsl } = bothOf('  const a = abs(u.v)\n  return vec4(f32(a.x), 0., 0., 1.)')
    expect(wgsl).toContain('abs(u.v)')
    expect(glsl).toContain('abs(u.v)')
  })

  it('an integer dot becomes a _idot helper on GLSL, one overload per type used', () => {
    const { wgsl, glsl } = bothOf(
      '  const uv3 = vec3u(u.k, u.k, u.k)\n  const a = dot(u.v, u.v)\n  const b = dot(uv3, uv3)\n' +
        '  return vec4(f32(a) + f32(b), 0., 0., 1.)',
    )
    expect(wgsl).toContain('dot(u.v, u.v)')
    expect(wgsl).toContain('dot(uv3, uv3)')
    expect(glsl).toContain('_idot(u.v, u.v)')
    expect(glsl).toContain('_idot(uv3, uv3)')
    // The helper, not an inline sum: an inline would splice BOTH arguments once per component.
    expect(glsl).toContain('int _idot(ivec2 a, ivec2 b) {')
    expect(glsl).toContain('uint _idot(uvec3 a, uvec3 b) {')
    expect(glsl).toContain('return a.x * b.x + a.y * b.y + a.z * b.z;')
  })

  it('a float dot keeps the portable spelling, and no helper is emitted for it', () => {
    const { wgsl, glsl } = bothOf('  const a = dot(uv, uv)\n  return vec4(a, 0., 0., 1.)')
    expect(wgsl).toContain('dot(uv, uv)')
    expect(glsl).toContain('dot(uv, uv)')
    expect(glsl).not.toContain('_idot')
  })

  it('an integer literal first in an integer-only builtin is typed i32', () => {
    // `countOneBits(5)` was typed f32 and refused as "takes an i32 or u32, or a vector of
    // them; got f32" — about a program WGSL accepts, where 5 is an AbstractInt that
    // materialises to i32 (measured accepted on Tint).
    const { wgsl, glsl } = bothOf(
      '  const a = countOneBits(5)\n  const b = reverseBits(5)\n  return vec4(f32(a) + f32(b), 0., 0., 1.)',
    )
    expect(wgsl).toContain('countOneBits(5)')
    expect(wgsl).toContain('reverseBits(5)')
    expect(glsl).toContain('_popcnt(5)')
    // A float-written literal has no integer meaning and keeps its refusal.
    expect(errorsOf(FS('  return vec4(f32(countOneBits(5.)), 0., 0., 1.)'))[0]).toBe(
      'TS8036 countOneBits takes an i32 or u32, or a vector of them; got f32.',
    )
  })
})

// The CPU oracle rows the same audit found (#154).
describe('the oracle answers the scalar and wrapping forms the GPU does', () => {
  const value = (body: string): number[] => {
    const r = compile(`"use typeshade"
@fragment
export function fs(): vec4 {
${body}
}
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const out: number[][] = []
    for (const make of [compileModule, compileModuleJs]) {
      out.push(make(r.module).fns['fs']!([]) as number[])
    }
    expect(out[0], 'the two CPU paths must agree').toEqual(out[1])
    return out[0]!
  }

  it('length and distance on a scalar are abs, where the oracle used to throw', () => {
    // WGSL gives both a scalar overload defined as `abs(e)` / `abs(e1 - e2)`, and both targets
    // compile it (measured on Tint and a WebGL2 driver). The oracle threw
    // "v.reduce is not a function" on a program the GPU ran.
    expect(value('  return vec4(length(-3.), distance(1., 4.), 0., 1.)')).toEqual([3, 3, 0, 1])
  })

  // 2^31 has no i32, so `abs(-2147483648)` is that value itself on both targets
  // (wgsl.txt:21451-21453) and the oracle answers 2147483648. NOT fixable at the builtin: it
  // is handed plain numbers, and the f32 `-2147483648.` is the same number with a genuine
  // `+2147483648` answer. It needs the oracle and the codegen to wrap a call's result by its
  // IR type, which is a change to every integer builtin rather than to this row; an id of its
  // own is not open either, since a portable id spells as its own name and the registry's map
  // is for genuinely divergent spellings. Pinned as it stands rather than left unstated.
  it.fails('abs of the smallest i32 is itself, as it is on both targets (#154, oracle)', () => {
    expect(value('  const m: i32 = -2147483648\n  return vec4(f32(abs(m)), 0., 0., 1.)')).toEqual([
      -2147483648, 0, 0, 1,
    ])
  })

  it('and the float of that magnitude keeps its real answer', () => {
    expect(value('  const m: f32 = -2147483648.\n  return vec4(abs(m), 0., 0., 1.)')).toEqual([
      2147483648, 0, 0, 1,
    ])
  })

  it('an integer dot is an integer on the CPU too', () => {
    expect(value('  const a = vec3i(1, 2, 3)\n  return vec4(f32(dot(a, a)), 0., 0., 1.)')).toEqual([
      14, 0, 0, 1,
    ])
  })
})
