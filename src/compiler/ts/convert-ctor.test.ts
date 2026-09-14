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
