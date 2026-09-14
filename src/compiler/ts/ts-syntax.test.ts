// The four TypeScript shapes the source language parsed but refused (#8 A10): a `let` that
// declares before it assigns, the five bitwise compound assignments, the `{ pos, uv }`
// shorthand, and a `switch` whose cases end in the `break` TypeScript requires. None of them
// needed a new IR node — `Stmt.var.init` has always been optional, `assignOp` has always
// taken a `BinOp`, `construct` does not care how a field was spelled, and `Stmt.switch` was
// already lowered — so each is checked on the IR, on both emitted texts, and on the CPU
// oracle, together with what each one still refuses.

import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { compile } from './compile.js'
import { typeKey } from '../../core/ir/types.js'
import type { Stmt } from '../../core/ir/nodes.js'
import { stripSpans } from '../../core/testing/strip-spans.js'

function wgslOf(source: string): string {
  const r = compileTsSource(`"use typeshade";\n${source}`)
  expect(r.diagnostics).toEqual([])
  return r.wgsl!
}

function diagnose(source: string): string {
  const r = compileTsSource(`"use typeshade";\n${source}`)
  expect(r.diagnostics.length).toBeGreaterThan(0)
  return r.diagnostics[0]!.message
}

function bodyOf(source: string): readonly Stmt[] {
  const r = compileTsSource(`"use typeshade";\n${source}`)
  expect(r.diagnostics).toEqual([])
  return r.funcs[r.funcs.length - 1]!.body
}

describe('a let that declares before it assigns', () => {
  it('lowers to a var with no init, and emits one in both targets', () => {
    const first = bodyOf('export function f(): f32 {\n  let x: f32;\n  x = 1.;\n  return x;\n}')[0]!
    expect(first.s).toBe('var')
    if (first.s !== 'var') return
    expect(first.name).toBe('x')
    expect(typeKey(first.type)).toBe('f32')
    expect(first.init).toBeUndefined()
    expect(
      wgslOf('export function f(): f32 {\n  let x: f32;\n  x = 1.;\n  return x;\n}'),
    ).toContain('var x: f32;')
  })

  it('takes an aggregate type as readily as a scalar', () => {
    expect(
      wgslOf(
        'export function f(): vec3 {\n  let v: vec3;\n  v = vec3(1., 2., 3.);\n  return v;\n}',
      ),
    ).toContain('var v: vec3<f32>;')
  })

  it('evaluates on the CPU once assigned', () => {
    const c = compile(`
      "use typeshade";
      export function f(a: f32): f32 {
        let x: f32;
        if (a > 0.) {
          x = a;
        } else {
          x = 0. - a;
        }
        return x;
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.eval('f', [3])).toBe(3)
    expect(c.eval('f', [-3])).toBe(3)
  })

  it('is recorded for the editor, like any other local', () => {
    // #51 records every local so hover and go-to-definition can answer for it. The record sits
    // in the shared defineLocal, so the shape with NO initializer gets one too — a name the
    // language now accepts should not be invisible to the editor.
    const r = compileTsSource(
      '"use typeshade";\nexport function f(): f32 {\n  let x: f32;\n  x = 1.;\n  return x;\n}',
    )
    expect(r.diagnostics).toEqual([])
    const x = r.symbols.filter((sym) => sym.name === 'x')
    expect(x).toHaveLength(1)
    expect(x[0]!.kind).toBe('local')
    expect(typeKey(x[0]!.type)).toBe('f32')
    expect(x[0]!.mutable).toBe(true)
  })

  it('still refuses the two forms that have nothing to declare', () => {
    // A `const` has no later assignment to carry the value, and an unannotated `let` has no
    // type to declare — two different refusals where there used to be one sentence.
    expect(diagnose('export function f(): f32 {\n  const x: f32;\n  return 1.;\n}')).toBe(
      '"const x" requires an initializer.',
    )
    expect(diagnose('export function f(): f32 {\n  let x;\n  return 1.;\n}')).toBe(
      '"let x" without an initializer needs a type annotation, e.g. let x: f32;',
    )
  })
})

describe('the bitwise compound assignments', () => {
  it('emit the operator the author wrote, in both targets', () => {
    const w = wgslOf(`
      export function f(i: i32): i32 {
        let y: i32 = i;
        y <<= 2;
        y |= 1;
        y &= 255;
        y ^= 3;
        y >>= 1;
        return y;
      }
    `)
    for (const line of ['y <<= 2;', 'y |= 1;', 'y &= 255;', 'y ^= 3;', 'y >>= 1;']) {
      expect(w).toContain(line)
    }
  })

  it('type the right-hand literal from the target, like the arithmetic five', () => {
    expect(
      wgslOf('export function f(i: u32): u32 {\n  let y: u32 = i;\n  y &= 3;\n  return y;\n}'),
    ).toContain('y &= 3u;')
  })

  it('agree with the same expression written out long', () => {
    const c = compile(`
      "use typeshade";
      export function compound(i: i32): i32 {
        let y: i32 = i;
        y <<= 2;
        y |= 1;
        y &= 255;
        y ^= 3;
        y >>= 1;
        return y;
      }
      export function longhand(i: i32): i32 {
        let y: i32 = i;
        y = y << 2;
        y = y | 1;
        y = y & 255;
        y = y ^ 3;
        y = y >> 1;
        return y;
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    for (const i of [0, 7, 13, -5]) {
      expect(c.eval('compound', [i])).toBe(c.eval('longhand', [i]))
      expect(c.eval('compound', [i])).toBe(((((i << 2) | 1) & 255) ^ 3) >> 1)
    }
  })

  it('refuse a float target, a float operand and the unsigned shift', () => {
    // The bitwise operators are defined on integers, and this whole form is new, so refusing
    // here rejects no source that compiles today.
    expect(
      diagnose('export function f(a: f32): f32 {\n  let y: f32 = a;\n  y <<= 1;\n  return y;\n}'),
    ).toBe('Bitwise "<<=" needs an i32 or u32 target, got f32.')
    expect(
      diagnose('export function f(i: i32): i32 {\n  let y: i32 = i;\n  y &= 1.5;\n  return y;\n}'),
    ).toContain('&=')
    expect(
      diagnose('export function f(i: i32): i32 {\n  let y: i32 = i;\n  y >>>= 1;\n  return y;\n}'),
    ).toBe('Unsigned right shift >>>= is not supported.')
  })
})

describe('the object-literal shorthand', () => {
  const SHORT = `
    class P {
      a: f32
      b: f32
    }
    export function f(a: f32, b: f32): P {
      return { a, b };
    }
  `
  const LONG = `
    class P {
      a: f32
      b: f32
    }
    export function f(a: f32, b: f32): P {
      return { a: a, b: b };
    }
  `

  it('builds exactly what the long form builds', () => {
    // Spans stripped: the two spellings ARE two spellings, so `return { a, b }` and
    // `return { a: a, b: b }` carry different source extents (#32). The claim is that the IR
    // is the same, which is what stripSpans lets the comparison say.
    expect(stripSpans(bodyOf(SHORT))).toEqual(stripSpans(bodyOf(LONG)))
    expect(wgslOf(SHORT)).toBe(wgslOf(LONG))
    expect(wgslOf(SHORT)).toContain('return P(a, b);')
  })

  it('mixes with named properties in one literal', () => {
    expect(
      wgslOf(`
        class P {
          a: f32
          b: f32
        }
        export function f(a: f32): P {
          return { a, b: 2. };
        }
      `),
    ).toContain('return P(a, 2.0);')
  })

  it('still reports an unknown name, from the shorthand position', () => {
    expect(
      diagnose(`
        class P {
          a: f32
          b: f32
        }
        export function f(a: f32): P {
          return { a, b };
        }
      `),
    ).toContain('b')
  })
})

describe('switch, with the break TypeScript requires', () => {
  const SWITCHED = `
    export function f(x: i32): f32 {
      let r: f32 = 0.;
      switch (x) {
        case 0: r = 1.; break;
        case 1: r = 2.; break;
        default: r = 3.;
      }
      return r;
    }
  `

  it('accepts the trailing break and leaves it out of the IR', () => {
    // The IR switch does not fall through and each backend writes its own case terminator,
    // so a trailing break carries nothing; keeping it would emit `break; break;` in GLSL.
    const body = bodyOf(SWITCHED)
    const sw = body.find((s) => s.s === 'switch')!
    expect(sw.s).toBe('switch')
    if (sw.s !== 'switch') return
    expect(sw.cases.map((c) => c.value)).toEqual([0, 1])
    for (const c of sw.cases) expect(c.body.some((s) => s.s === 'break')).toBe(false)
  })

  it('keeps a break that leaves the case early', () => {
    const body = bodyOf(`
      export function f(x: i32): f32 {
        let r: f32 = 0.;
        switch (x) {
          case 0: {
            if (x === 0) { r = 9.; break; }
            r = 1.;
          }
          default: r = 3.;
        }
        return r;
      }
    `)
    const sw = body.find((s) => s.s === 'switch')!
    if (sw.s !== 'switch') throw new Error('expected a switch')
    const inner = sw.cases[0]!.body[0]!
    expect(inner.s).toBe('if')
    if (inner.s !== 'if') return
    expect(inner.arms[0]!.body.some((s) => s.s === 'break')).toBe(true)
  })

  it('emits one break per case in GLSL and none in WGSL', () => {
    const w = wgslOf(SWITCHED)
    expect(w).not.toMatch(/break;\s*\n\s*break;/)
    const r = compileTsSource(`"use typeshade";\n${SWITCHED}`)
    expect(r.wgsl).toContain('switch x {')
  })

  it('takes a negative literal and a module constant as a case label', () => {
    const body = bodyOf(`
      const MODE: i32 = 2
      export function f(x: i32): f32 {
        let r: f32 = 0.;
        switch (x) {
          case -1: r = 1.; break;
          case MODE: r = 2.; break;
          default: r = 3.;
        }
        return r;
      }
    `)
    const sw = body.find((s) => s.s === 'switch')!
    if (sw.s !== 'switch') throw new Error('expected a switch')
    expect(sw.cases.map((c) => c.value)).toEqual([-1, 2])
    // The `const MODE: i32 = 2` line itself still emits as `2.0`; that is #13, in the
    // backend's emitConst, not this front end — the folded case value above is already 2.
  })

  it('evaluates on the CPU, early break included', () => {
    const c = compile(`
      "use typeshade";
      export function pick(x: i32): f32 {
        let r: f32;
        r = 0.;
        switch (x) {
          case 0: r = 1.; break;
          case 1: {
            if (x === 1) { r = 5.; break; }
            r = 2.;
          }
          default: r = 3.;
        }
        return r;
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.eval('pick', [0])).toBe(1)
    expect(c.eval('pick', [1])).toBe(5)
    expect(c.eval('pick', [7])).toBe(3)
  })

  it('lets a loop inside a case keep its own break', () => {
    const c = compile(`
      "use typeshade";
      export function f(x: i32): f32 {
        let n: f32 = 0.;
        switch (x) {
          case 0: {
            for (let i: i32 = 0; i < 4; i++) {
              if (i === 2) { break; }
              n += 1.;
            }
            break;
          }
          default: n = 9.;
        }
        return n;
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.eval('f', [0])).toBe(2)
    expect(c.eval('f', [1])).toBe(9)
  })

  it('still refuses break outside both, continue in a switch, and a non-constant case', () => {
    expect(diagnose('export function f(): f32 {\n  break;\n  return 1.;\n}')).toBe(
      'break is only valid inside a loop or switch.',
    )
    expect(
      diagnose(`
        export function f(x: i32): f32 {
          switch (x) {
            case 0: continue;
            default: return 0.;
          }
        }
      `),
    ).toBe('continue is only valid inside a loop.')
    expect(
      diagnose(`
        export function f(x: i32): f32 {
          switch (x) {
            case 1.5: return 1.;
            default: return 0.;
          }
        }
      `),
    ).toBe('switch case must be an integer constant: a literal or a module const.')
    expect(
      diagnose(`
        export function f(x: i32, y: i32): f32 {
          switch (x) {
            case y: return 1.;
            default: return 0.;
          }
        }
      `),
    ).toBe('switch case must be an integer constant: a literal or a module const.')
    expect(
      diagnose(`
        export function f(x: i32): f32 {
          switch (x) {
            case 0:
            case 1: return 1.;
            default: return 0.;
          }
        }
      `),
    ).toBe('switch case fall-through is not allowed.')
  })
})
