// ═══ Literal spelling is fail-closed on both writers (#2276) ═══
//
// Three shapes used to reach the target text as bytes no driver accepts:
//   • `-(-1.0)` spelled `--1.0` — `--` is the DECREMENT token in WGSL and GLSL;
//   • an i32/u32 literal outside its range, printed verbatim (Tint rejects it);
//   • a non-finite value, printed as `NaN` / `Infinity` (no such literal exists).
// The first is a spelling rule in the neutral walk (emit.ts unop arm); the other two
// are the writers' `literal()` refusing what the target cannot spell. Both writers are
// asserted because the spelling helpers are shared and the failure mode is silent.

import { describe, it, expect } from 'vitest'
import { emitExpr } from '../emit.js'
import { wgslBackend } from './wgsl.js'
import { glslEs300Backend } from './glsl.js'
import { f32T, i32T, u32T, boolT, fn, module, vec4, f32 } from '../ir/index.js'
import { emitModule as emitWgslModule } from './wgsl.js'
import { emitGlslModule } from './glsl.js'
import type { Expr, ShaderType } from '../ir/index.js'
import { ShaderDslError } from '../diagnostics/error.js'

const lit = (value: number, type = f32T): Expr => ({ op: 'lit', type, value })
const neg = (a: Expr): Expr => ({ op: 'unop', type: a.type, uop: '-', a }) as Expr
const v = (name: string): Expr => ({ op: 'varref', type: f32T, name })
const sub = (a: Expr, b: Expr): Expr => ({ op: 'binop', type: f32T, bop: '-', a, b })

const backends = [
  ['wgsl', wgslBackend],
  ['glsl', glslEs300Backend],
] as const

describe.each(backends)('unary minus never spells `--` (%s)', (_id, be) => {
  it('negating a negative literal parenthesizes the operand, full and minimal', () => {
    expect(emitExpr(neg(lit(-1)), be)).toBe('(-(-1.0))')
    expect(emitExpr(neg(lit(-1)), be, 'minimal')).toBe('-(-1.0)')
  })
  it('a nested negation keeps its parens in both modes', () => {
    expect(emitExpr(neg(neg(v('a'))), be)).toBe('(-(-a))')
    expect(emitExpr(neg(neg(v('a'))), be, 'minimal')).toBe('-(-a)')
  })
  it('the shape inside a subtraction (the #2276 repro) contains no `--`', () => {
    for (const mode of ['full', 'minimal'] as const) {
      const s = emitExpr(sub(v('a'), neg(lit(-1))), be, mode)
      expect(s).not.toContain('--')
    }
  })
  it('a positive literal under minus is untouched', () => {
    expect(emitExpr(neg(lit(1)), be, 'minimal')).toBe('-1.0')
  })
})

describe.each(backends)('literal() is fail-closed (%s)', (_id, be) => {
  const throws = (value: number, type: ShaderType) => {
    let err: unknown
    try {
      be.literal(value, type)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ShaderDslError)
    expect((err as ShaderDslError).code).toBe('SD0017')
  }
  it('rejects i32 literals outside [-2^31, 2^31-1]', () => {
    throws(2147483648, i32T)
    throws(-2147483649, i32T)
    expect(be.literal(2147483647, i32T)).toBe('2147483647')
    expect(be.literal(-2147483648, i32T)).toBe('-2147483648')
  })
  it('rejects u32 literals outside [0, 2^32-1]', () => {
    throws(4294967296, u32T)
    throws(-1, u32T)
    expect(be.literal(4294967295, u32T)).toBe('4294967295u')
    expect(be.literal(0, u32T)).toBe('0u')
  })
  it('rejects a fractional integer literal', () => {
    throws(1.5, i32T)
    throws(1.5, u32T)
  })
  it('rejects non-finite floats and keeps finite spellings unchanged', () => {
    throws(NaN, f32T)
    throws(Infinity, f32T)
    throws(-Infinity, f32T)
    expect(be.literal(1e21, f32T)).toBe('1e+21')
    expect(be.literal(0.5, f32T)).toBe('0.5')
    expect(be.literal(2, f32T)).toBe('2.0')
  })
})

// ═══ A module-scope constant is spelled for its DECLARED type (#13) ═══
//
// `emitConst` formatted every scalar constant with the float spelling, ignoring
// `ConstDecl.type`, so `{ type: u32T, wgslValue: 8 }` emitted `const K: u32 = 8.0;` — which
// Tint rejects ("cannot convert value of type 'abstract-float' to type 'u32'") and WebGL2
// rejects ("cannot convert from 'const float' to 'const mediump uint'"). `emitOverride`,
// seven lines away in the same object, already used the type-aware helper; `emitConst` was
// the one declaration site that did not. Both writers are asserted because the helper is
// shared and the failure was silent on both.
//
// Nothing caught it because no example in either corpus declared an integer module constant.
// `examples/module-const.shade.ts` is now that example, so the compile gate hands one to
// Tint and to a real WebGL2 context on every run.
describe.each(backends)('emitConst spells the value for the declared type (%s)', (id, be) => {
  const decl = (type: ShaderType, wgslValue: number) =>
    be.emitConst({ name: 'K', type, wgslValue, cpuValue: wgslValue })

  it('an integer const gets an integer literal, not a float one', () => {
    expect(decl(u32T, 8)).toContain('8u')
    expect(decl(u32T, 8)).not.toContain('8.0')
    expect(decl(i32T, -3)).toContain('-3')
    expect(decl(i32T, -3)).not.toContain('-3.0')
  })

  it('an f32 const keeps the float spelling', () => {
    expect(decl(f32T, 2.5)).toContain('2.5')
    expect(decl(f32T, 2)).toContain('2.0')
  })

  it('a bool const spells true/false, not the number it is carried as', () => {
    // `ConstDecl.wgslValue` is typed `number`, so a `bool` const arrives here as 1 or 0.
    expect(decl(boolT, 1)).toContain('true')
    expect(decl(boolT, 0)).toContain('false')
    for (const v of [1, 0]) expect(decl(boolT, v)).not.toMatch(/\d\.\d/)
  })

  it('the whole declaration is the target spelling, not just the literal', () => {
    expect(decl(u32T, 8)).toBe(id === 'wgsl' ? 'const K: u32 = 8u;' : 'const uint K = 8u;')
    expect(decl(boolT, 1)).toBe(id === 'wgsl' ? 'const K: bool = true;' : 'const bool K = true;')
  })

  it('a fractional value for an integer const is refused, not rounded', () => {
    // intLit's SD0017 is what makes this fail loudly instead of emitting `0.5`.
    let err: unknown
    try {
      decl(u32T, 0.5)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ShaderDslError)
    expect((err as ShaderDslError).code).toBe('SD0017')
  })
})

describe('a module carrying integer constants emits them correctly on both backends', () => {
  const m = module({
    consts: [
      { name: 'KU', type: u32T, wgslValue: 8, cpuValue: 8 },
      { name: 'KI', type: i32T, wgslValue: -3, cpuValue: -3 },
      { name: 'KF', type: f32T, wgslValue: 2.5, cpuValue: 2.5 },
    ],
    funcs: [
      fn('fs', {}, () => vec4(f32(1), 0, 0, 1), { stage: 'fragment', retAttr: '@location(0)' }),
    ],
  })

  it('WGSL', () => {
    const out = emitWgslModule(m)
    expect(out).toContain('const KU: u32 = 8u;')
    expect(out).toContain('const KI: i32 = -3;')
    expect(out).toContain('const KF: f32 = 2.5;')
  })

  it('GLSL ES 3.00', () => {
    const out = emitGlslModule(m, 'fragment')
    expect(out).toContain('const uint KU = 8u;')
    expect(out).toContain('const int KI = -3;')
    expect(out).toContain('const float KF = 2.5;')
  })
})
