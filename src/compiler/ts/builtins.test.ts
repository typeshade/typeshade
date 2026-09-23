// `discard`, the missing WGSL builtins, and `**` in "use typeshade" (#8 A6). Every name here
// is one the IR already carries and both backends already spell; the surface had no word for
// it, so a shader needing one had to drop to the fn() EDSL. `select` and `bool` are the two
// exceptions and are explained where they are lowered.

import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { compile } from './compile.js'
import { TS_CODES } from './codes.js'
import { typeKey } from '../../core/ir/types.js'
import type { Expr } from '../../core/ir/nodes.js'

function lowerReturn(body: string, params = 'x: f32, y: f32'): Expr {
  const r = compileTsSource(`
    "use typeshade";
    export function f(${params}): f32 {
      return ${body};
    }
  `)
  expect(r.diagnostics).toEqual([])
  const stmt = r.funcs[0]!.body[0]!
  if (stmt.s !== 'return' || !stmt.expr) throw new Error(`expected a return, got ${stmt.s}`)
  return stmt.expr
}

function diagnose(source: string): string {
  const r = compileTsSource(`"use typeshade";\n${source}`)
  expect(r.diagnostics.length).toBeGreaterThan(0)
  return r.diagnostics[0]!.message
}

function expectCall(e: Expr, fn: string, type: string): void {
  expect(e.op).toBe('call')
  if (e.op !== 'call') return
  expect(e.fn).toBe(fn)
  expect(typeKey(e.type)).toBe(type)
}

/** The same IR with every source span stripped.
 *
 *  #32 gives an authored node the span of the text it came from, so two spellings of one
 *  operation — `select(a, b, c)` and `c ? b : a` — build equal IR that is not deeply equal as
 *  objects: their spans differ because the sources differ. These tests are about the SHAPE,
 *  which is what `irEqual` compares and what makes `fn()` an oracle, so the provenance comes
 *  off first. */
function withoutSpans<T>(node: T): T {
  if (Array.isArray(node)) return node.map(withoutSpans) as T
  if (node === null || typeof node !== 'object') return node
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === 'span') continue
    out[k] = withoutSpans(v)
  }
  return out as T
}

describe('the builtins the surface had no name for', () => {
  it.each([
    ['exp2(x)', 'exp2'],
    ['saturate(x)', 'saturate'],
    ['fwidth(x)', 'fwidth'],
    ['dpdx(x)', 'dpdx'],
    ['dpdy(x)', 'dpdy'],
  ])('lowers %s to a call of the same id', (source, fn) => {
    expectCall(lowerReturn(source), fn, 'f32')
  })

  it('lowers fma(a, b, c) to a three-argument call', () => {
    const e = lowerReturn('fma(x, y, x)')
    expectCall(e, 'fma', 'f32')
    if (e.op === 'call') expect(e.args).toHaveLength(3)
  })

  it('keeps a vector result type', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(v: vec3): vec3 {
        return saturate(v);
      }
    `)
    expect(r.diagnostics).toEqual([])
    const stmt = r.funcs[0]!.body[0]!
    if (stmt.s !== 'return' || !stmt.expr) throw new Error('expected a return')
    expect(typeKey(stmt.expr.type)).toBe('vec3<f32>')
  })

  it('spells them for each target', () => {
    const c = compile(`
      "use typeshade";
      export function f(x: f32, y: f32): f32 {
        return exp2(x) + saturate(y) + fwidth(x) + dpdx(x) + dpdy(y) + fma(x, y, x);
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.wgsl).toContain('exp2(x)')
    expect(c.wgsl).toContain('saturate(y)')
    expect(c.wgsl).toContain('dpdx(x)')
    expect(c.wgsl).toContain('fma(x, y, x)')
    // GLSL ES 3.00 has no saturate and no fma; the registry inlines both.
    expect(c.glsl?.fragment).toContain('clamp(y, 0.0, 1.0)')
    expect(c.glsl?.fragment).toContain('dFdx(x)')
    expect(c.glsl?.fragment).toContain('((x) * (y) + (x))')
  })

  it('evaluates on the CPU oracle', () => {
    const c = compile(`
      "use typeshade";
      export function f(x: f32, y: f32): f32 {
        return exp2(x) + saturate(y) + fma(x, y, x);
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    // exp2(3) = 8, saturate(2) = 1, fma(3, 2, 3) = 9
    expect(c.eval('f', [3, 2])).toBe(18)
  })
})

describe('atan with two arguments', () => {
  it('lowers atan(y, x) to the atan2 id and atan(x) to atan', () => {
    expectCall(lowerReturn('atan(y, x)'), 'atan2', 'f32')
    expectCall(lowerReturn('atan(x)'), 'atan', 'f32')
  })

  it('spells atan2 in WGSL and atan in GLSL', () => {
    const c = compile(`
      "use typeshade";
      export function f(x: f32, y: f32): f32 {
        return atan(y, x);
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.wgsl).toContain('atan2(y, x)')
    expect(c.glsl?.fragment).toContain('atan(y, x)')
    expect(c.eval('f', [1, 1])).toBeCloseTo(Math.atan2(1, 1), 12)
  })

  it('still rejects three arguments', () => {
    expect(
      diagnose(`
        export function f(x: f32): f32 {
          return atan(x, x, x);
        }
      `),
    ).toBe('atan expects 1 argument, or 2 for atan(y, x), got 3.')
  })
})

describe('select', () => {
  it('lowers select(f, t, c) to the select Expr, WGSL argument order', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(a: f32, b: f32, c: bool): f32 {
        return select(a, b, c);
      }
    `)
    expect(r.diagnostics).toEqual([])
    const stmt = r.funcs[0]!.body[0]!
    if (stmt.s !== 'return' || !stmt.expr) throw new Error('expected a return')
    const e = stmt.expr
    expect(e.op).toBe('select')
    if (e.op !== 'select') return
    expect(e.ifFalse.op === 'param' && e.ifFalse.name).toBe('a')
    expect(e.ifTrue.op === 'param' && e.ifTrue.name).toBe('b')
    expect(e.cond.op === 'param' && e.cond.name).toBe('c')
  })

  it('is the same IR the ternary already built', () => {
    const viaCall = compileTsSource(`
      "use typeshade";
      export function f(a: f32, b: f32, c: bool): f32 {
        return select(a, b, c);
      }
    `)
    const viaTernary = compileTsSource(`
      "use typeshade";
      export function f(a: f32, b: f32, c: bool): f32 {
        return c ? b : a;
      }
    `)
    expect(viaCall.diagnostics).toEqual([])
    expect(viaTernary.diagnostics).toEqual([])
    expect(withoutSpans(viaCall.funcs[0]!.body)).toEqual(withoutSpans(viaTernary.funcs[0]!.body))
  })

  it('emits select in WGSL and the ternary in GLSL, and evaluates both arms', () => {
    const c = compile(`
      "use typeshade";
      export function f(a: f32, b: f32, c: bool): f32 {
        return select(a, b, c);
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.wgsl).toContain('select(a, b, c)')
    expect(c.glsl?.fragment).toContain('(c ? b : a)')
    expect(c.eval('f', [1, 2, true])).toBe(2)
    expect(c.eval('f', [1, 2, false])).toBe(1)
  })

  it('takes the arms’ kind for a bare integer literal', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(n: u32, c: bool): u32 {
        return select(0, n, c);
      }
    `)
    expect(r.diagnostics).toEqual([])
    const stmt = r.funcs[0]!.body[0]!
    if (stmt.s !== 'return' || stmt.expr?.op !== 'select') throw new Error('expected a select')
    expect(typeKey(stmt.expr.ifFalse.type)).toBe('u32')
    expect(typeKey(stmt.expr.type)).toBe('u32')
  })

  it('lets a user-declared select win, as a name in the file', () => {
    const c = compile(`
      "use typeshade";
      export function select(a: f32, b: f32, c: f32): f32 {
        return a + b + c;
      }
      export function f(x: f32): f32 {
        return select(x, x, x);
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.eval('f', [2])).toBe(6)
  })

  it('names the argument order when the condition is not last', () => {
    expect(
      diagnose(`
        export function f(c: bool, a: f32, b: f32): f32 {
          return select(c, a, b);
        }
      `),
    ).toBe(
      "select condition must be bool or a vector of bools, got f32. The order is WGSL's: " +
        'select(falseValue, trueValue, cond).',
    )
  })

  it('rejects the wrong argument count', () => {
    expect(
      diagnose(`
        export function f(a: f32, c: bool): f32 {
          return select(a, c);
        }
      `),
    ).toBe(
      "select expects 3 argument(s), got 2. The order is WGSL's: select(falseValue, trueValue, cond).",
    )
  })

  it('rejects arms of different types', () => {
    expect(
      diagnose(`
        export function f(a: f32, b: u32, c: bool): f32 {
          return select(a, b, c);
        }
      `),
    ).toBe('select arm type mismatch: f32 vs u32.')
  })
})

describe('the bool and f64 casts', () => {
  it('lowers bool(i) to the compare WGSL’s conversion means', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(i: i32): f32 {
        return bool(i) ? 1. : 0.;
      }
    `)
    expect(r.diagnostics).toEqual([])
    const stmt = r.funcs[0]!.body[0]!
    if (stmt.s !== 'return' || stmt.expr?.op !== 'select') throw new Error('expected a select')
    const cond = stmt.expr.cond
    expect(cond.op).toBe('compare')
    if (cond.op !== 'compare') return
    expect(cond.cop).toBe('!=')
    expect(typeKey(cond.b.type)).toBe('i32')
  })

  it('folds bool() of a literal, and is the identity on a bool', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(c: bool): bool {
        return bool(c);
      }
      export function g(): bool {
        return bool(0);
      }
    `)
    expect(r.diagnostics).toEqual([])
    expect(withoutSpans(r.funcs[0]!.body[0])).toEqual({
      s: 'return',
      expr: { op: 'param', type: expect.anything(), name: 'c' },
    })
    expect(withoutSpans(r.funcs[1]!.body[0])).toEqual({
      s: 'return',
      expr: { op: 'lit', type: expect.anything(), value: false },
    })
  })

  it('evaluates bool(i) both ways', () => {
    const c = compile(`
      "use typeshade";
      export function f(i: i32): f32 {
        return bool(i) ? 1. : 2.;
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.wgsl).toContain('(i != 0)')
    expect(c.eval('f', [0])).toBe(2)
    expect(c.eval('f', [5])).toBe(1)
  })

  it('widens an f32 to f64 with the same call toF64 makes', () => {
    const e = lowerReturn('f32(f64(x))')
    expect(e.op).toBe('call')
    if (e.op !== 'call') return
    expectCall(e.args[0]!, 'f64', 'f64')
  })

  it('keeps the whole double in f64(0.1)', () => {
    const c = compile(`
      "use typeshade";
      export function g(x: f32): f64 {
        return f64(x) + f64(0.1);
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    // The fp64 pass splits the literal into its (hi, lo) halves; a truncated f32 would
    // have carried a zero low half.
    expect(c.wgsl).toContain('vec2<f32>(0.10000000149011612, -1.4901161415892261e-9)')
    expect(c.eval('g', [3])).toBeCloseTo(3.1, 15)
  })

  it('is the identity on a value that is already f64', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function g(x: f32): f64 {
        return f64(f64(x));
      }
    `)
    expect(r.diagnostics).toEqual([])
    const stmt = r.funcs[0]!.body[0]!
    if (stmt.s !== 'return' || stmt.expr?.op !== 'call') throw new Error('expected a call')
    expect(stmt.expr.fn).toBe('f64')
    expect(stmt.expr.args[0]!.op).toBe('param')
  })

  it('rejects bool() of a vector and f64() of an integer', () => {
    expect(
      diagnose(`
        export function f(v: vec3): f32 {
          return bool(v) ? 1. : 0.;
        }
      `),
    ).toBe('bool() takes a numeric scalar, got vec3<f32>.')
    expect(
      diagnose(`
        export function f(i: i32): f64 {
          return f64(i);
        }
      `),
    ).toBe('f64() widens an f32, got i32. Cast to f32 first, e.g. f64(f32(x)).')
  })
})

describe('the ** operator', () => {
  it('lowers a ** b to pow(a, b)', () => {
    const e = lowerReturn('x ** y')
    expectCall(e, 'pow', 'f32')
    if (e.op === 'call') {
      expect(e.args[0]!.op).toBe('param')
      expect(e.args[1]!.op).toBe('param')
    }
  })

  it('emits pow on both targets and evaluates it', () => {
    const c = compile(`
      "use typeshade";
      export function f(x: f32): f32 {
        return x ** 2. + 2. ** x;
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.wgsl).toContain('(pow(x, 2.0) + pow(2.0, x))')
    expect(c.glsl?.fragment).toContain('(pow(x, 2.0) + pow(2.0, x))')
    expect(c.eval('f', [3])).toBe(17)
  })

  it('works component-wise on two vectors', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(a: vec3, b: vec3): vec3 {
        return a ** b;
      }
    `)
    expect(r.diagnostics).toEqual([])
    const stmt = r.funcs[0]!.body[0]!
    if (stmt.s !== 'return' || stmt.expr?.op !== 'call') throw new Error('expected a call')
    expect(typeKey(stmt.expr.type)).toBe('vec3<f32>')
  })

  it('rejects a vector base with a scalar exponent, naming the splat', () => {
    expect(
      diagnose(`
        export function f(v: vec3): vec3 {
          return v ** 2.;
        }
      `),
    ).toBe(
      'Type mismatch: cannot ** vec3<f32> and f32. ** is pow(a, b), which takes two values of ' +
        'one type; splat the exponent, e.g. v ** vec3(2.).',
    )
  })
})

describe('discard', () => {
  const FRAGMENT = `
    "use typeshade";
    class Color {
      @location(0) color: vec4;
    }
    @fragment
    export function fs(@builtin("position") p: vec4): Color {
      if (p.x > 0.5) {
        discard;
      }
      return { color: vec4(1., 0., 0., 1.) };
    }
  `

  it('lowers to the discard statement', () => {
    const r = compileTsSource(FRAGMENT)
    expect(r.diagnostics).toEqual([])
    const stmt = r.funcs[0]!.body[0]!
    if (stmt.s !== 'if') throw new Error(`expected an if, got ${stmt.s}`)
    expect(withoutSpans(stmt.arms[0]!.body)).toEqual([{ s: 'discard' }])
  })

  it('emits discard on both targets', () => {
    const c = compile(FRAGMENT)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.wgsl).toContain('discard;')
    expect(c.glsl?.fragment).toContain('discard;')
  })

  it('kills the fragment on the CPU oracle', () => {
    const c = compile(FRAGMENT)
    expect(c.eval('fs', [[0.2, 0, 0, 1]])).toEqual({ color: [1, 0, 0, 1] })
    expect(c.eval('fs', [[0.9, 0, 0, 1]])).toBeUndefined()
  })

  it('is allowed in a helper, whose callers are not known here', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function cut(a: f32): f32 {
        if (a < 0.) {
          discard;
        }
        return a;
      }
    `)
    expect(r.diagnostics).toEqual([])
  })

  it('is rejected in a vertex or compute entry', () => {
    expect(
      diagnose(`
        @vertex
        export function vs(@builtin("vertex_index") i: u32): vec4 {
          discard;
          return vec4(0.);
        }
      `),
    ).toBe('"discard" is only valid in a fragment shader; "vs" is a vertex entry.')
    expect(
      diagnose(`
        declare let xs: storage<array<f32>>
        @compute([64, 1, 1])
        export function k(@builtin("global_invocation_id") gid: vec3u) {
          discard;
          xs[gid.x] = 1.;
        }
      `),
    ).toBe('"discard" is only valid in a fragment shader; "k" is a compute entry.')
  })

  // The name is still a NAME and never becomes the statement — that is what this pins. It is
  // also a name WGSL cannot emit: measured on Tint, `var discard: f32 = 1.0;` is "expected
  // identifier for variable declaration", so the local is reported where it is written now
  // (#103) instead of reaching the driver as text nobody wrote.
  it('leaves a local named discard alone, and refuses the name WGSL reserves', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(x: f32): f32 {
        let discard = x;
        discard = x + 1.;
        return discard;
      }
    `)
    expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
      `${TS_CODES.RESERVED_NAME} "discard" is reserved in WGSL, so a local of that name cannot be emitted for the WebGPU target. Rename it.`,
    ])
    expect(r.funcs[0]!.body.some((s) => s.s === 'discard')).toBe(false)
  })
})

// ── The four majors, each pinned against its own mutation ──
//
// The verification report found that reverting any of these in a scratch copy left the whole
// suite green: the features were exercised, the RULES were not. Each case below fails if the
// guard it names is removed.

describe('the fragment-only rule follows calls, not just the entry body', () => {
  it('reports discard in a helper the entry calls, naming the chain', () => {
    // The check walks the call graph from each entry. Reverting it to "does the entry body
    // contain a discard" leaves every other discard test green, because they all discard in
    // the entry itself.
    const r = compileTsSource(`
      "use typeshade";
      export function cut(x: f32): f32 {
        if (x > 0.5) {
          discard;
        }
        return x;
      }
      class VsOut {
        @builtin("position") pos: vec4;
      }
      @vertex
      export function vs(): VsOut {
        const k = cut(1.);
        return { pos: vec4(k, 0., 0., 1.) };
      }
    `)
    // The exact front-end sentence, with the chain in it. A loose match would pass without
    // the walk: the core's own `fragment-only-builtin` lint (SD0109) catches this at EMIT and
    // surfaces as a TS8015 whose text also mentions the op, so what the walk is worth is the
    // message and its position, not catching it at all.
    expect(r.diagnostics[0]!.code).toBe('TS8099')
    expect(r.diagnostics[0]!.message).toBe(
      '"discard" is only valid in a fragment shader; "cut" is reachable from the vertex entry "vs".',
    )
  })

  it('reports a derivative two levels deep from a compute entry', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function inner(x: f32): f32 {
        return fwidth(x);
      }
      export function outer(x: f32): f32 {
        return inner(x) * 2.;
      }
      declare let out: storage<array<f32>>;
      @compute([1, 1, 1])
      export function k(@builtin("global_invocation_id") gid: vec3u) {
        out[gid.x] = outer(1.);
      }
    `)
    expect(r.diagnostics[0]!.code).toBe('TS8099')
    expect(r.diagnostics[0]!.message).toBe(
      '"fwidth" is only valid in a fragment shader; "inner" is reachable from the compute entry "k".',
    )
  })

  it('says nothing about a helper NOTHING calls — the negative that makes it a walk', () => {
    // If the check scanned every function instead of walking from the entries, this would
    // report, and the rule would be "no discard anywhere" rather than "not in this stage".
    const r = compileTsSource(`
      "use typeshade";
      export function unused(x: f32): f32 {
        if (x > 0.5) {
          discard;
        }
        return x;
      }
      class VsOut {
        @builtin("position") pos: vec4;
      }
      @vertex
      export function vs(): VsOut {
        return { pos: vec4(0., 0., 0., 1.) };
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  })
})

describe('** refuses each operand kind that pow has no form for', () => {
  const cases: readonly [string, string, string][] = [
    ['an integer base', 'export function f(i: i32): i32 {\n  return i ** 2;\n}', 'i32'],
    ['an integer exponent', 'export function f(x: f32, i: i32): f32 {\n  return x ** i;\n}', 'i32'],
    ['a bool', 'export function f(b: bool): bool {\n  return b ** b;\n}', 'bool'],
  ]
  it('accepts a written number as the exponent, which is an f32 here', () => {
    // `x ** 2` is `pow(x, 2.0)`: a bare number lowers to an f32, so this is the float case
    // and not an integer one. Stated because it is the shape a reader reaches for first.
    const r = compileTsSource(
      '"use typeshade";\nexport function f(x: f32): f32 {\n  return x ** 2;\n}',
    )
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('pow(x, 2.0)')
  })

  it.each(cases)('rejects %s', (_label, src, mentioned) => {
    // The guard is what keeps `**` from lowering to a pow() call no backend has an overload
    // for. Removing it leaves the float cases — the only ones tested before — green.
    const message = diagnose(src)
    expect(message).toContain('**')
    expect(message).toContain(mentioned)
  })
})

describe('the derivative stubs keep the shape their argument has', () => {
  it('evaluates a component of a vector derivative, and a length over one', () => {
    // The oracle has no neighbouring invocations, so a derivative is a ZERO of the argument's
    // shape. A stub returning a scalar 0 makes `dpdx(v).x` throw and `length(fwidth(v))` a
    // NaN, which no other test in this file would notice.
    const c = compile(`
      "use typeshade";
      class Color {
        @location(0) color: vec4;
      }
      @fragment
      export function fs(@builtin("position") p: vec4): Color {
        const d = dpdx(p.xyz);
        const w = length(fwidth(p.xy));
        return { color: vec4(d.x, w, 0., 1.) };
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.eval('fs', [[0.5, 0.5, 0.5, 1]])).toEqual({ color: [0, 0, 0, 1] })
  })
})

describe('a name this item adds does not shadow a function the file declares', () => {
  // Every one of these was an ordinary unknown name before #8 A6, so `export function
  // saturate(…)` followed by `saturate(x)` called the author's function. An addition may not
  // change what a program means, so it still does — on the GPU and in the CPU oracle alike.
  const ARITY: Readonly<Record<string, number>> = {
    exp2: 1,
    saturate: 1,
    fwidth: 1,
    dpdx: 1,
    dpdy: 1,
    bool: 1,
    f64: 1,
    fma: 3,
    select: 3,
  }

  it.each(Object.keys(ARITY))('calls the declared %s, not the builtin', (name) => {
    const arity = ARITY[name]!
    const params = Array.from({ length: arity }, (_, i) => `a${i}: f32`).join(', ')
    const args = Array.from({ length: arity }, () => '2.').join(', ')
    const c = compile(`
      "use typeshade";
      export function ${name}(${params}): f32 {
        return 99.;
      }
      export function g(): f32 {
        return ${name}(${args});
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    // The emitted shader declares the function and calls it; WGSL lets a declared name
    // shadow a builtin of the same name, and Tint accepts it.
    expect(c.wgsl).toContain(`fn ${name}(`)
    expect(c.wgsl).toContain(`return ${name}(`)
    // …and the oracle evaluates the same function, through the call's declRef.
    expect(c.eval('g', [])).toBe(99)
  })

  it.each(['saturate', 'fma', 'dpdx', 'dpdy'])(
    'calls the declared %s on GLSL too, where the backend has a rewrite for that name',
    (name) => {
      // The one the front end and the CPU backends agreeing could not settle. GLSL ES 3.00 has
      // no `saturate`, so this backend renders the INTRINSIC of that name as
      // `clamp(x, 0.0, 1.0)` — and that rewrite keyed on the name, so a module declaring its
      // own `saturate` emitted the function into the GLSL and then never called it. WGSL said
      // 99, GLSL said something else, from one module, with no diagnostic.
      const arity = name === 'fma' ? 3 : 1
      const params = Array.from({ length: arity }, (_, i) => `a${i}: f32`).join(', ')
      const args = Array.from({ length: arity }, () => '2.').join(', ')
      const c = compile(`
        "use typeshade";
        export function ${name}(${params}): f32 {
          return 99.;
        }
        class Color {
          @location(0) color: vec4
        }
        @fragment
        export function fs(): Color {
          const v = ${name}(${args});
          return { color: vec4(v, v, v, 1.) };
        }
      `)
      expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
      expect(c.glsl?.fragment).toContain(`float ${name}(`)
      expect(c.glsl?.fragment).toContain(`${name}(2.0`)
      expect(c.glsl?.fragment).not.toContain('clamp(2.0, 0.0, 1.0)')
      expect(c.eval('fs', [])).toEqual({ color: [99, 99, 99, 1] })
    },
  )

  it('leaves a name that was already a builtin exactly as it was', () => {
    // `pow` predates this item: the intrinsic wins, on both targets and on the CPU. Changing
    // THAT would move the meaning of a program that compiles today — the same additivity
    // argument pointing the other way.
    const c = compile(`
      "use typeshade";
      export function pow(a: f32, b: f32): f32 {
        return 99.;
      }
      export function g(): f32 {
        return pow(2., 2.);
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.wgsl).toContain('return pow(2.0, 2.0);')
    expect(c.eval('g', [])).toBe(4)
  })

  it('leaves a name that was already a builtin as it was WHERE THE WRITERS RESPELL IT', () => {
    // The `pow` case above could not catch this: neither writer respells `pow`, so an emit
    // keyed on the wrong thing still reads `pow(...)`. `inverseSqrt` and `atan` are the two
    // that do move — GLSL ES 3.00 spells them `inversesqrt` and `atan(y, x)` — and both are
    // names a declaration does NOT win, so the call carries no declRef and must stay the
    // intrinsic. Keyed on the declared NAME alone, emit called the user's function instead:
    // the GLSL went from `inversesqrt(p.x)` to `inverseSqrt(p.x)` while the CPU oracle went on
    // computing the intrinsic — one module, three answers.
    for (const [decl, call, wgsl, glsl] of [
      [
        'inverseSqrt(x: f32): f32 { return 99.; }',
        'inverseSqrt(p.x)',
        'inverseSqrt(p.x)',
        'inversesqrt(p.x)',
      ],
      [
        'atan(y: f32, x: f32): f32 { return 99.; }',
        'atan(p.x, p.y)',
        'atan2(p.x, p.y)',
        'atan(p.x, p.y)',
      ],
    ] as const) {
      const c = compile(`
        "use typeshade";
        class Color {
          @location(0) color: vec4
        }
        export function ${decl}
        @fragment
        export function fs(@builtin("position") p: vec4): Color {
          const v = ${call};
          return { color: vec4(v, v, v, 1.) };
        }
      `)
      expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
      expect(c.wgsl).toContain(wgsl)
      expect(c.glsl?.fragment).toContain(glsl)
    }
  })
})

// `all(e: bool)` and `any(e: bool)` are overloads of both builtins and both "Return e"
// (wgsl.txt:21294-21314). The ambient lib always admitted the scalar; the front end refused it,
// so the editor and the compiler disagreed about a program WGSL defines (#150).
describe('all(bool) and any(bool) return the bool on both targets', () => {
  const both = (src: string): { wgsl: string; glsl: string } => {
    const r = compile(src)
    expect(r.diagnostics.filter((d) => d.category === 'error').map((d) => d.message)).toEqual([])
    return { wgsl: r.wgsl ?? '', glsl: r.glsl?.fragment ?? '' }
  }
  const FS = (body: string): string => `"use typeshade"
@fragment
export function fs(@location(0) uv: vec2): vec4 {
${body}
}
`

  it('lowers to the argument itself, so neither target spells a one-component reduction', () => {
    // NOT a call: a one-component reduction is the value, and GLSL ES 3.00 has no `all(bool)`
    // overload at all, so emitting the call would fail there.
    const { wgsl, glsl } = both(
      FS(`  const c = uv.x > 0.5
  return vec4(select(0., 1., all(c)), select(0., 1., any(c)), 0., 1.)`),
    )
    expect(wgsl).toContain('select(0.0, 1.0, c)')
    expect(wgsl).not.toMatch(/\ball\(/)
    expect(wgsl).not.toMatch(/\bany\(/)
    expect(glsl).not.toMatch(/\ball\(/)
    expect(glsl).not.toMatch(/\bany\(/)
  })

  it('agrees with the vector form on the CPU, for both answers', () => {
    const r = compile(
      FS(`  const c = uv.x > 0.5
  return vec4(select(0., 1., all(c)), select(0., 1., any(c)), 0., 1.)`),
    )
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.eval('fs', [[1, 0]])).toEqual([1, 1, 0, 1])
    expect(r.eval('fs', [[0, 0]])).toEqual([0, 0, 0, 1])
  })

  it('still reduces a vector of bools, which is the form that needs the builtin', () => {
    const { wgsl, glsl } = both(
      FS(`  const m = uv > vec2(0.5, 0.5)
  return vec4(select(0., 1., all(m)), select(0., 1., any(m)), 0., 1.)`),
    )
    expect(wgsl).toContain('all(m)')
    expect(wgsl).toContain('any(m)')
    expect(glsl).toContain('all(m)')
    expect(glsl).toContain('any(m)')
  })
})
