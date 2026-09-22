// Element-converting vector constructors in "use typeshade" (#8 A8): `vec3f(v)`, `vec3u(v)`,
// `vec2(gid.xy)`. WGSL's `vecN<T>(v: vecN<S>)` and GLSL ES 3.00's `vec3(uv)` convert every
// component; the EDSL's `vec3(v)` already builds this node. Composing a vector out of parts
// of mixed kinds is still rejected, as WGSL rejects it.

import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { compile } from './compile.js'
import { typeKey } from '../../core/ir/types.js'
import type { Expr } from '../../core/ir/nodes.js'

function lowerReturn(body: string, params: string, ret: string): Expr {
  const r = compileTsSource(`
    "use typeshade";
    export function f(${params}): ${ret} {
      return ${body};
    }
  `)
  expect(r.diagnostics).toEqual([])
  const stmt = r.funcs[0]!.body[0]!
  if (stmt.s !== 'return' || !stmt.expr) throw new Error(`expected a return, got ${stmt.s}`)
  return stmt.expr
}

function diagnose(body: string, params: string, ret: string): string {
  const r = compileTsSource(`
    "use typeshade";
    export function f(${params}): ${ret} {
      return ${body};
    }
  `)
  expect(r.diagnostics.length).toBeGreaterThan(0)
  return r.diagnostics[0]!.message
}

describe('a vector converts to another element kind', () => {
  it.each([
    ['vec3f(v)', 'v: vec3u', 'vec3', 'vec3<f32>'],
    ['vec3(v)', 'v: vec3u', 'vec3', 'vec3<f32>'],
    ['vec3u(v)', 'v: vec3', 'vec3u', 'vec3<u32>'],
    ['vec3i(v)', 'v: vec3', 'vec3i', 'vec3<i32>'],
    ['vec2i(v)', 'v: vec2', 'vec2i', 'vec2<i32>'],
    ['vec4u(v)', 'v: vec4i', 'vec4u', 'vec4<u32>'],
  ])('lowers %s to a one-argument construct', (body, params, ret, type) => {
    const e = lowerReturn(body, params, ret)
    expect(e.op).toBe('construct')
    if (e.op !== 'construct') return
    expect(typeKey(e.type)).toBe(type)
    expect(e.args).toHaveLength(1)
    expect(e.args[0]!.op).toBe('param')
  })

  it('converts a swizzle: vec2(gid.xy)', () => {
    const r = compileTsSource(`
      "use typeshade";
      @compute([64, 1, 1])
      export function k(@builtin("global_invocation_id") gid: vec3u) {
        let uv = vec2(gid.xy);
        uv = uv;
      }
    `)
    expect(r.diagnostics).toEqual([])
    const stmt = r.funcs[0]!.body[0]!
    if (stmt.s !== 'var') throw new Error(`expected a var, got ${stmt.s}`)
    expect(typeKey(stmt.type)).toBe('vec2<f32>')
    expect(stmt.init?.op).toBe('construct')
    if (stmt.init?.op !== 'construct') return
    expect(stmt.init.args).toHaveLength(1)
    expect(typeKey(stmt.init.args[0]!.type)).toBe('vec2<u32>')
  })

  it('leaves a same-kind single vector argument exactly as it was', () => {
    const e = lowerReturn('vec3(v)', 'v: vec3', 'vec3')
    expect(e.op).toBe('construct')
    if (e.op !== 'construct') return
    expect(e.args).toHaveLength(1)
  })

  it('emits the constructor each target spells', () => {
    const c = compile(`
      "use typeshade";
      export function up(v: vec3u): vec3 {
        return vec3f(v);
      }
      export function down(v: vec3): vec3u {
        return vec3u(v);
      }
      export function toI(v: vec3): vec3i {
        return vec3i(v);
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.wgsl).toContain('return vec3<f32>(v);')
    expect(c.wgsl).toContain('return vec3<u32>(v);')
    expect(c.wgsl).toContain('return vec3<i32>(v);')
    expect(c.glsl?.fragment).toContain('return vec3(v);')
    expect(c.glsl?.fragment).toContain('return uvec3(v);')
    expect(c.glsl?.fragment).toContain('return ivec3(v);')
  })
})

describe('the CPU oracle converts the way WGSL does', () => {
  const MOD = `
    "use typeshade";
    export function up(v: vec3u): vec3 {
      return vec3f(v);
    }
    export function down(v: vec3): vec3u {
      return vec3u(v);
    }
    export function toI(v: vec3): vec3i {
      return vec3i(v);
    }
    export function reint(v: vec3i): vec3u {
      return vec3u(v);
    }
  `

  it('widens an integer vector to floats unchanged', () => {
    const c = compile(MOD)
    expect(c.eval('up', [[1, 2, 3]])).toEqual([1, 2, 3])
  })

  it('saturates a float source into u32 and truncates into i32, as WGSL does', () => {
    const c = compile(MOD)
    // WGSL's float→integer conversion saturates: -3.2 into u32 is 0, not -3.
    expect(c.eval('down', [[1.7, 2.9, -3.2]])).toEqual([1, 2, 0])
    expect(c.eval('toI', [[1.7, 2.9, -3.2]])).toEqual([1, 2, -3])
  })

  it('reinterprets between i32 and u32 two’s-complement', () => {
    const c = compile(MOD)
    expect(c.eval('reint', [[-1, 2, 3]])).toEqual([4294967295, 2, 3])
  })

  it('leaves an ordinary composing constructor alone', () => {
    const c = compile(`
      "use typeshade";
      export function plain(a: f32, b: f32, c: f32): vec3 {
        return vec3(a, b, c);
      }
      export function splat(a: f32): vec3 {
        return vec3(a);
      }
    `)
    expect(c.eval('plain', [1.5, 2.5, 3.5])).toEqual([1.5, 2.5, 3.5])
    expect(c.eval('splat', [0.5])).toEqual([0.5, 0.5, 0.5])
  })
})

describe('what stays rejected', () => {
  it('rejects a vector of another size', () => {
    expect(diagnose('vec2(v)', 'v: vec3', 'vec2')).toBe(
      'Vector constructor component count mismatch.',
    )
    expect(diagnose('vec4(v)', 'v: vec3', 'vec4')).toBe(
      'Vector constructor component count mismatch.',
    )
  })

  it('rejects composing out of parts of mixed kinds, as WGSL does', () => {
    expect(diagnose('vec3(a, 1.)', 'a: vec2u', 'vec3')).toBe(
      'Vector constructor element type mismatch: expected f32.',
    )
  })

  it('rejects a scalar of another kind, which is a cast and not a conversion', () => {
    // A single scalar of the element kind splats; one of another kind is neither a splat
    // nor a same-size vector, so it is counted as one component of three.
    expect(diagnose('vec3f(n)', 'n: u32', 'vec3')).toBe(
      'Vector constructor component count mismatch.',
    )
  })

  it('does not convert into an emulated-double vector', () => {
    expect(diagnose('vec3f64(v)', 'v: vec3', 'vec3f64')).toBe(
      'Vector constructor element type mismatch: expected f64.',
    )
  })
})

// WGSL's own two constructor spellings this surface lacked (#150): the TYPE ARGUMENT
// (wgsl.txt:20889) and the ZERO value (wgsl.txt:20015-20030).
describe('vecN<T>(...) names the element, and vecN() is the zero', () => {
  it('vec3<u32>(1, 2, 3) builds an unsigned vector and vec3() the zero', () => {
    // The type argument was read by NOBODY: `vec3<u32>(1, 2, 3)` compiled clean and emitted
    // `vec3<f32>(1.0, 2.0, 3.0)`, so a program that asked for an unsigned vector silently got
    // a float one and a following `f32(v.x)` cast nothing.
    expect(typeKey(lowerReturn('vec3<u32>(1, 2, 3)', '', 'vec3u').type)).toBe('vec3<u32>')
    expect(typeKey(lowerReturn('vec2<i32>(1, 2)', '', 'vec2i').type)).toBe('vec2<i32>')
    expect(typeKey(lowerReturn('vec4<f32>(1., 2., 3., 4.)', '', 'vec4').type)).toBe('vec4<f32>')
    expect(typeKey(lowerReturn('vec3<bool>(true, false, true)', '', 'vec3b').type)).toBe(
      'vec3<bool>',
    )
    expect(typeKey(lowerReturn('vec3()', '', 'vec3').type)).toBe('vec3<f32>')
    expect(typeKey(lowerReturn('vec4u()', '', 'vec4u').type)).toBe('vec4<u32>')
  })

  it('emits the element the type argument named, on both targets', () => {
    const r = compile(`"use typeshade"
@fragment
export function fs(): vec4 {
  const u = vec3<u32>(1, 2, 3)
  const z = vec3()
  return vec4(f32(u.x) + z.x, 0., 0., 1.)
}
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toContain('vec3<u32>(1u, 2u, 3u)')
    expect(r.wgsl).toContain('vec3<f32>(0.0, 0.0, 0.0)')
    expect(r.glsl?.fragment).toContain('uvec3(1u, 2u, 3u)')
    expect(r.glsl?.fragment).toContain('vec3(0.0, 0.0, 0.0)')
  })

  it('refuses a second element name, and one that is not an element at all', () => {
    expect(diagnose('vec3u<f32>(1, 2, 3)', '', 'vec3u')).toBe(
      'vec3u<f32> names two element types; vec3u is already u32. Write vec3<f32> or vec3u.',
    )
    expect(diagnose('vec3<mat4>(1, 2, 3)', '', 'vec3')).toBe(
      'vec3<mat4> is not a vector element type; write vec3<f32>, <i32>, <u32> or <bool>, or the short form vec3f.',
    )
    // The short name AGREEING with its own element is not a contradiction, so it is taken.
    expect(typeKey(lowerReturn('vec3u<u32>(1, 2, 3)', '', 'vec3u').type)).toBe('vec3<u32>')
  })

  it('has no zero form for the emulated double, whose zero is a pair', () => {
    expect(diagnose('vec3f64()', '', 'vec3f64')).toBe(
      'vec3f64() has no zero-value form; write vec3f64(f64(0.)).',
    )
    // The type-argument spelling reaches the same refusal, and the refusal says what is on the
    // line: it used to answer about `vec4f64()`, a call the author did not write. The FIX stays
    // the short name, which is the one form that takes the f64 zero.
    expect(diagnose('vec4<f64>()', '', 'vec4')).toBe(
      'vec4<f64>() has no zero-value form; write vec4f64(f64(0.)).',
    )
  })
})

// The scalar conversions (#154). WGSL's `u32(e)`/`i32(e)`/`f32(e)` take a SCALAR and refuse a
// value the target cannot hold; this surface emitted both anyway.
describe('a scalar conversion takes a scalar, and a literal it can hold', () => {
  it('refuses u32(-1) naming the range, where it used to emit u32(-1.0)', () => {
    // Measured: Tint REFUSES `u32(-1)` ("value -1 cannot be represented as 'u32'") and a
    // WebGL2 driver COMPILES `uint(-1.0)` and answers whatever it likes. The surface follows
    // WGSL and says so in the author's file, rather than emitting a program the two targets
    // disagree about. A negated literal is a unop, not a lit, which is why it used to slip
    // past the fold here.
    // A BARE `-1` is an f32 in this surface, so what it would have emitted is `u32(-1.0)`:
    // the float conversion, which is defined on both targets and defined DIFFERENTLY. The
    // message says which two numbers were measured rather than calling the result undefined.
    expect(diagnose('u32(-1)', '', 'u32')).toBe(
      'u32(-1) is out of range: a u32 holds 0 to 4294967295, and the two targets compute ' +
        'different values for a float that does not. Measured: u32(-1.) is 0 on WGSL and ' +
        '4294967295 on GLSL ES 3.00, and u32(4.3e9) is 4294967295 there and 5032960 here. ' +
        'Clamp it first if you want one answer, e.g. u32(clamp(x, 0., 4294967295.)).',
    )
    // The clamp names the TARGET's own bounds, so the advice fits the cast that was written.
    expect(diagnose('i32(4294967295)', '', 'i32')).toBe(
      'i32(4294967295) is out of range: an i32 holds -2147483648 to 2147483647, and the two ' +
        'targets compute different values for a float that does not. Measured: u32(-1.) is 0 ' +
        'on WGSL and 4294967295 on GLSL ES 3.00, and u32(4.3e9) is 4294967295 there and ' +
        '5032960 here. Clamp it first if you want one answer, e.g. ' +
        'i32(clamp(x, -2147483648., 2147483647.)).',
    )
    // The values that DO fit are unchanged, negative ones included.
    expect(typeKey(lowerReturn('i32(-1)', '', 'i32').type)).toBe('i32')
    expect(typeKey(lowerReturn('u32(4294967295)', '', 'u32').type)).toBe('u32')
  })

  it("folds an INT to INT conversion rather than refusing it, with the target's wrap", () => {
    // An int -> int conversion is a bit reinterpretation, and both targets perform it and
    // agree: measured, `u32(-1i)` compiles on Tint and is 4294967295, and a WebGL2 driver
    // compiles `uint(-1)` and answers 4294967295 too. What Tint refuses is the UNSUFFIXED
    // `u32(-1)`, because an unsuffixed integer literal is an AbstractInt and an AbstractInt
    // must fit its target — a fact about the spelling, not about the program. So the surface
    // spells the conversion as the literal it yields, and no spelling Tint refuses is emitted.
    const r = compile(`"use typeshade"
@fragment
export function fs(): vec4 {
  const k: i32 = -1
  const m: u32 = u32(4294967295)
  return vec4(f32(u32(k)) * 0., f32(i32(m)) * 0., 0., 1.)
}
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toContain('4294967295u')
    expect(r.wgsl).not.toContain('u32(-1)')
    expect(r.glsl?.fragment).toContain('4294967295u')
    expect(r.glsl?.fragment).not.toContain('uint(-1)')
  })

  it('wraps the fold the way the hardware does, so the check cannot contradict the emit', () => {
    // The front end and the const-fold pass have to compute the same number. Folding in
    // doubles gave two answers: `i32 100000 * 100000` is 1410065408 on both targets and
    // 10000000000 in an f64 fold, `i32 1 / 2` is 0 there and 0.5 here. A range rule built on
    // the second set refused programs that ran and admitted programs that did not.
    const r = compile(`"use typeshade"
@fragment
export function fs(): vec4 {
  const a: i32 = 100000
  const b: i32 = 100000
  const p: i32 = 1
  const q: i32 = 2
  return vec4(f32(u32(a * b)) * 0., f32(u32(p / q - 1)) * 0., 0., 1.)
}
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    // 100000 * 100000 wraps to 1410065408, and 1 / 2 - 1 truncates to -1, which is 4294967295
    // as a u32. Neither is the f64 answer, and both are what the two targets compute.
    expect(r.wgsl).toContain('1410065408u')
    expect(r.wgsl).toContain('4294967295u')
  })

  it('refuses a FLOAT conversion out of range, through a const reference too', () => {
    // The case that genuinely diverges, and the shape that actually reached a driver: const
    // propagation writes the value into the call before either backend sees it, so `u32(k)`
    // emitted `u32(-1.0)` — 0 on WGSL, 4294967295 on GLSL ES 3.00 — with no diagnostic. The
    // binding now carries what the compile-time folder can compute, so a negated literal, an
    // alias and a call initializer are all values the rule sees.
    const one = (body: string): readonly string[] =>
      compile(`"use typeshade"
@fragment
export function fs(): vec4 {
${body}
  return vec4(f32(u32(k)) * 0., 0., 0., 1.)
}
`)
        .diagnostics.filter((d) => d.category === 'error')
        .map((d) => d.message)
    const range =
      'is out of range: a u32 holds 0 to 4294967295, and the two targets compute different ' +
      'values for a float that does not.'
    expect(one('  const k = -1.')[0]).toContain(range)
    expect(one('  const j = -1.\n  const k = j')[0]).toContain(range)
    expect(one('  const k = Math.floor(-1.5)')[0]).toContain(range)
    // A float that DOES fit is left alone: both targets truncate toward zero and agree on 0.
    expect(one('  const k = -0.5')).toEqual([])
  })

  it('leaves a RUNTIME conversion alone, where the two targets agree', () => {
    // A mutable `let` has no compile-time value, so `u32(k)` stays a conversion: bit-preserving
    // on WGSL and bit-preserving on GLSL ES 3.00, one answer. This is the escape hatch, and the
    // reason nothing here refuses `u32` of a signed value on principle.
    const r = compile(`"use typeshade"
@fragment
export function fs(): vec4 {
  let k: i32 = -1
  return vec4(f32(u32(k)) * 0., 0., 0., 1.)
}
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toContain('u32(k)')
    expect(r.glsl?.fragment).toContain('uint(k)')
  })

  it('refuses f32(vec3) naming the scalar rule', () => {
    // Tint refuses it ("no matching constructor for 'f32(vec3<f32>)'"); a WebGL2 driver
    // compiles `float(vec3)` and silently takes `.x`. The two targets do not merely differ on
    // a corner — they disagree about whether the program exists.
    expect(diagnose('f32(v)', 'v: vec3', 'f32')).toBe(
      'f32() takes a scalar; got vec3<f32>. A vector is converted component-wise by its own ' +
        'constructor, e.g. vec3(v).',
    )
    expect(diagnose('u32(v)', 'v: vec2i', 'u32')).toBe(
      'u32() takes a scalar; got vec2<i32>. A vector is converted component-wise by its own ' +
        'constructor, e.g. vec2u(v).',
    )
    // The emulated double is a scalar here: `f32(f64(x))` is the narrowing the surface spells.
    expect(typeKey(lowerReturn('f32(f64(x))', 'x: f32', 'f32').type)).toBe('f32')
  })
})

// `array(e1, e2, ...)` with no type arguments (#150, wgsl.txt:20133).
describe('array(...) infers its element type and its count', () => {
  it('array(1., 2., 3.) infers array<f32, 3>', () => {
    expect(typeKey(lowerReturn('array(1., 2., 3.)[0]', '', 'f32').type)).toBe('f32')
    const r = compile(`"use typeshade"
@fragment
export function fs(): vec4 {
  const a = array(1., 2., 3.)
  return vec4(a[0], a[1], a[2], 1.)
}
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toContain('array<f32, 3>(1.0, 2.0, 3.0)')
    expect(r.glsl?.fragment).toContain('float[3](1.0, 2.0, 3.0)')
  })

  it('infers a vector element too, and keeps the explicit form working', () => {
    const r = compile(`"use typeshade"
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  const a = array(uv, uv)
  const b = array<f32, 2>(1., 2.)
  return vec4(a[0], b[0], b[1])
}
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toContain('array<vec2<f32>, 2>(uv, uv)')
    expect(r.wgsl).toContain('array<f32, 2>(1.0, 2.0)')
  })

  it('refuses elements that disagree, and an empty list with nothing to infer from', () => {
    expect(diagnose('array(1., i32(2))[0]', '', 'f32')).toBe(
      'array(...) infers one element type from its elements; element 0 is f32 and element 1 ' +
        'is i32. Cast the odd one, or write the type out: array<f32, 2>(...).',
    )
    expect(diagnose('array()[0]', '', 'f32')).toBe(
      'array() has no elements to infer from: the element type and the count come from them. ' +
        'Give it elements, or write both out with the values: array<f32, 4>(0., 0., 0., 0.).',
    )
  })
})
