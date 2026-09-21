import { describe, expect, it } from 'vitest'
import { module, fn, abs, dot, vec3uT, vec3iT, vec3fT, u32T, i32T } from './index.js'
import { emitModule } from '../backends/wgsl.js'
import { emitGlslModule } from '../backends/glsl.js'
import { compileModule } from '../oracle.js'
import { compile } from '../../compiler/ts/compile.js'
import { divergentIntegerId } from './divergent-int.js'

// #154. `abs` and `dot` are PORTABLE ids — the set whose members are claimed to spell the same
// on both targets — and for an unsigned `abs` or an integer `dot` that claim is false: GLSL ES
// 3.00 has neither overload, and a WebGL2 driver answers "no matching overloaded function
// found". The front end learned to pick `absU` / `dotI` / `dotU`; the fn() node graph, the
// OTHER authoring surface, kept building the portable id and emitting GLSL no driver accepts.
// The rule now lives in one module that both surfaces call, so these tests check the two
// surfaces agree rather than checking each in isolation.
describe('the divergent integer builtins pick the same id on both authoring surfaces', () => {
  it('routes an unsigned abs and an integer dot off the portable id', () => {
    expect(divergentIntegerId('abs', vec3uT, vec3uT)).toBe('absU')
    expect(divergentIntegerId('abs', vec3iT, vec3iT)).toBe('abs')
    expect(divergentIntegerId('abs', vec3fT, vec3fT)).toBe('abs')
    expect(divergentIntegerId('dot', vec3iT, i32T)).toBe('dotI')
    expect(divergentIntegerId('dot', vec3uT, u32T)).toBe('dotU')
    // Everything else passes through, which is what keeps the rest of the registry still.
    expect(divergentIntegerId('min', vec3uT, vec3uT)).toBe('min')
    expect(divergentIntegerId('length', vec3fT, vec3fT)).toBe('length')
  })

  it('emits GLSL a driver accepts from the fn() graph, not abs(uvec3) / dot(ivec3)', () => {
    const absU = fn('abs_u', { x: vec3uT }, ({ x }) => abs(x).x)
    const absI = fn('abs_i', { x: vec3iT }, ({ x }) => abs(x).x)
    const dotI = fn('dot_i', { a: vec3iT, b: vec3iT }, ({ a, b }) => dot(a, b))
    const dotU = fn('dot_u', { a: vec3uT, b: vec3uT }, ({ a, b }) => dot(a, b))
    const dotF = fn('dot_f', { a: vec3fT, b: vec3fT }, ({ a, b }) => dot(a, b))
    const m = module({ funcs: [absU.decl, absI.decl, dotI.decl, dotU.decl, dotF.decl] })

    // WGSL spells all five natively; the ids exist for the GLSL column, so nothing moves here.
    const wgsl = emitModule(m)
    expect(wgsl).toContain('fn abs_u(x: vec3<u32>) -> u32')
    expect(wgsl).toContain('fn dot_i(a: vec3<i32>, b: vec3<i32>) -> i32')
    expect(wgsl).toContain('fn dot_u(a: vec3<u32>, b: vec3<u32>) -> u32')
    expect(wgsl).toContain('return dot(a, b);')

    const glsl = emitGlslModule(m)
    // `abs(uint)` does not exist: an unsigned magnitude IS the value, so the call disappears.
    expect(glsl).toContain('uint abs_u(uvec3 x) {\n  return x.x;\n}')
    // The SIGNED one keeps the builtin, so this is not a blanket rewrite of `abs`.
    expect(glsl).toContain('int abs_i(ivec3 x) {\n  return abs(x).x;\n}')
    // `dot(ivec3, ivec3)` does not exist either; the helper is the multiply-add it stands for,
    // emitted once per element type that is used.
    expect(glsl).toContain('int _idot(ivec3 a, ivec3 b)')
    expect(glsl).toContain('uint _idot(uvec3 a, uvec3 b)')
    expect(glsl).toContain('int dot_i(ivec3 a, ivec3 b) {\n  return _idot(a, b);\n}')
    expect(glsl).toContain('uint dot_u(uvec3 a, uvec3 b) {\n  return _idot(a, b);\n}')
    // The float dot keeps the builtin, so the helper is not a blanket replacement.
    expect(glsl).toContain('float dot_f(vec3 a, vec3 b) {\n  return dot(a, b);\n}')
  })

  it('gives the node graph the integer RESULT type, and the oracle the integer value', () => {
    const dotI = fn('dot_i', { a: vec3iT, b: vec3iT }, ({ a, b }) => dot(a, b))
    const dotU = fn('dot_u', { a: vec3uT, b: vec3uT }, ({ a, b }) => dot(a, b))
    const absU = fn('abs_u', { x: vec3uT }, ({ x }) => abs(x).x)
    const cpu = compileModule(module({ funcs: [dotI.decl, dotU.decl, absU.decl] }))
    expect(cpu.fns.dot_i!([1, -2, 3], [4, 5, 6])).toBe(12)
    expect(cpu.fns.dot_u!([1, 2, 3], [4, 5, 6])).toBe(32)
    expect(cpu.fns.abs_u!([7, 0, 0])).toBe(7)
    // Wrapping is the integer answer both targets give, and the reason the CPU dot multiplies
    // step by step in 32 bits rather than summing in doubles.
    expect(cpu.fns.dot_i!([2147483647, 1, 0], [1, 1, 0])).toBe(-2147483648)
  })

  it('parenthesises the unsigned abs under minimal parens, where its column is its argument', () => {
    // `absU`'s GLSL spelling is the argument with no call around it, which is the most extreme
    // re-embedding in the registry: the emit walk renders an argument at the LOOSEST precedence
    // because an argument slot reparses anything. Under the default `parens: 'full'` every
    // operand is bracketed anyway and nothing shows; under `parens: 'minimal'`, which is what
    // `emit-prod` ships, the template was handed a bare `n - 1u` and spliced it into a
    // multiply: `abs(n - 1) * n` became `n - 1u * n` — different arithmetic, no diagnostic,
    // measured as different pixels on a real driver. `atomArgs: true` is what makes the walk
    // wrap it, and THIS mode is the one that would catch its removal.
    const shade = fn('shade', { n: u32T }, ({ n }) => abs(n.sub(1)).mul(n))
    const m = module({ funcs: [shade.decl] })
    const minimal = emitGlslModule(m, undefined, { parens: 'minimal' })
    expect(minimal).toContain('(n - 1u) * n')
    expect(minimal).not.toMatch(/[^(]n - 1u \* n/)
    // `atomArgs` is a property of the ID, not of one target's column, so the WGSL call gets
    // the same bracket it does not need. One redundant pair on the target whose spelling is a
    // real call is the price of the rule being one rule.
    expect(emitModule(m, { parens: 'minimal' })).toContain('abs((n - 1u)) * n')
  })

  it('agrees with the "use typeshade" front end, id for id', () => {
    const r = compile(`"use typeshade"
@fragment
export function fs(): vec4 {
  const u = vec3u(1, 2, 3)
  const i = vec3i(1, -2, 3)
  const m = abs(u).x + u32(dot(u, u))
  const n = abs(i).x + dot(i, i)
  return vec4(f32(m) * 0., f32(n) * 0., 0., 1.)
}
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const glsl = r.glsl?.fragment ?? ''
    expect(glsl).toContain('_idot(')
    // The signed `abs` keeps the portable spelling on both surfaces; the unsigned one is gone.
    expect(glsl).toContain('abs(')
    expect(glsl).not.toMatch(/abs\(\s*u\b/)
  })
})
