// A float `%=` on GLSL ES 3.00 (#20). GLSL's `%` takes integers only, and the binop writer has
// always routed a float `%` through the backend's `floatMod` spelling, `(a - b * trunc(a / b))`,
// which is what WGSL's `%` computes on floats. The two compound-assignment sites, the statement
// and the `for` header, bypassed it and wrote `x %= 0.7;`, which the driver rejects while the
// WGSL beside it is fine. Measured on `main` before this: the GLSL fragment below carried
// `x %= 0.7;`.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { emitStmt } from '../../core/emit.js'
import { wgslBackend } from '../../core/backends/wgsl.js'
import { glslEs300Backend } from '../../core/backends/glsl.js'
import { f32T } from '../../core/ir/types.js'
import type { Expr, Stmt } from '../../core/ir/nodes.js'

const SRC = `"use typeshade"
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  let x: f32 = uv.x
  x %= 0.7
  return vec4(x, 0., 0., 1.)
}
`

describe('a float %= on GLSL ES 3.00 (#20)', () => {
  it('spells x %= 0.7 through floatMod on GLSL and leaves the WGSL alone', () => {
    const r = compile(SRC)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('x %= 0.7;')
    expect(r.glsl?.fragment).toContain('x = (x - 0.7 * trunc(x / 0.7));')
    expect(r.glsl?.fragment).not.toContain('%=')
  })

  it('a vector target too', () => {
    const r = compile(
      SRC.replace('let x: f32 = uv.x', 'let x: vec2 = uv').replace(
        'vec4(x, 0., 0., 1.)',
        'vec4(x, 0., 1.)',
      ),
    )
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('x %= 0.7;')
    expect(r.glsl?.fragment).toContain('x = (x - 0.7 * trunc(x / 0.7));')
  })

  it('an integer %= stays the native operator on both', () => {
    const r = compile(`"use typeshade"
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  let i: i32 = i32(uv.x)
  i %= 3
  return vec4(f32(i), 0., 0., 1.)
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('i %= 3;')
    expect(r.glsl?.fragment).toContain('i %= 3;')
  })

  it('parenthesizes an operand the spelling repeats', () => {
    const x: Expr = { op: 'varref', type: f32T, name: 'x' }
    const y: Expr = { op: 'varref', type: f32T, name: 'y' }
    const two: Expr = { op: 'lit', type: f32T, value: 2 }
    const s: Stmt = {
      s: 'assignOp',
      target: x,
      bop: '%',
      expr: { op: 'binop', type: f32T, bop: '*', a: y, b: two },
    }
    expect(emitStmt(s, 1, glslEs300Backend)).toBe('  x = (x - (y * 2.0) * trunc(x / (y * 2.0)));')
    expect(emitStmt(s, 1, wgslBackend)).toBe('  x %= (y * 2.0);')
  })

  it('agrees with the CPU oracle, which computes the truncated remainder', () => {
    const r = compile(SRC)
    const out = r.eval('fs', [[1.5, 0]]) as number[]
    expect(out[0]).toBeCloseTo(0.1, 6)
  })
})
