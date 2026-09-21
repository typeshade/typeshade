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
      'array() has no elements to infer from; write array<f32, 4>() for a zero-filled array, ' +
        'or give it elements.',
    )
  })
})
