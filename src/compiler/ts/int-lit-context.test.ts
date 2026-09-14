// A bare integer literal takes the type its context declares (#8 A3). `int-lit-coerce.test.ts`
// covers the peer rule inside one expression (`i + 1`); this covers the ten positions where
// the type comes from a declaration instead — return, assignment, argument, field,
// constructor, ternary, for-init, index, builtin call, module const — and, as importantly,
// that a float context is left exactly as it was.

import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { compile } from './compile.js'
import { typeKey } from '../../core/ir/types.js'
import type { Expr } from '../../core/ir/nodes.js'

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

function returnExpr(source: string): Expr {
  const r = compileTsSource(`"use typeshade";\n${source}`)
  expect(r.diagnostics).toEqual([])
  const stmt = r.funcs[r.funcs.length - 1]!.body.find((s) => s.s === 'return')
  if (!stmt || stmt.s !== 'return' || !stmt.expr) throw new Error('expected a return')
  return stmt.expr
}

describe('the ten positions', () => {
  it('1. return takes the declared return type', () => {
    const e = returnExpr('export function f(): u32 {\n  return 0;\n}')
    expect(e).toEqual({ op: 'lit', type: expect.anything(), value: 0 })
    expect(typeKey(e.type)).toBe('u32')
    expect(wgslOf('export function f(): u32 {\n  return 0;\n}')).toContain('return 0u;')
    expect(wgslOf('export function f(): i32 {\n  return -3;\n}')).toContain('return -3;')
  })

  it('2. assignment takes the target’s type', () => {
    expect(
      wgslOf(`
        export function f(): u32 {
          let x: u32 = u32(1);
          x = 2;
          return x;
        }
      `),
    ).toContain('x = 2u;')
  })

  it('3. an argument takes the parameter’s type', () => {
    expect(
      wgslOf(`
        export function g(a: u32): u32 {
          return a;
        }
        export function f(): u32 {
          return g(1);
        }
      `),
    ).toContain('return g(1u);')
  })

  it('4. a struct field takes the field’s type', () => {
    expect(
      wgslOf(`
        class S {
          id: u32
        }
        export function f(): u32 {
          const s: S = { id: 0 };
          return s.id;
        }
      `),
    ).toContain('S(0u)')
  })

  it('5. a vector constructor takes its element kind', () => {
    expect(wgslOf('export function f(): vec3u {\n  return vec3u(1, 2, 3);\n}')).toContain(
      'vec3<u32>(1u, 2u, 3u)',
    )
    expect(wgslOf('export function f(): vec2i {\n  return vec2i(-1, 2);\n}')).toContain(
      'vec2<i32>(-1, 2)',
    )
    expect(
      wgslOf(`
        export function f(n: u32): vec3u {
          return vec3u(n, 1, 2);
        }
      `),
    ).toContain('vec3<u32>(n, 1u, 2u)')
  })

  it('6. a ternary takes the type of the position it is in', () => {
    const e = returnExpr('export function f(c: bool): u32 {\n  return c ? 1 : 2;\n}')
    expect(e.op).toBe('select')
    if (e.op !== 'select') return
    expect(typeKey(e.type)).toBe('u32')
    expect(typeKey(e.ifTrue.type)).toBe('u32')
    expect(typeKey(e.ifFalse.type)).toBe('u32')
  })

  it('7. a for-init with no annotation is the i32 the induction variable must be', () => {
    const w = wgslOf(`
      export function f(): f32 {
        let a = 0.;
        for (let i = 0; i < 4; i++) {
          a += 1.;
        }
        return a;
      }
    `)
    expect(w).toContain('for (var i: i32 = 0;')
    expect(w).toContain('(i < 4)')
  })

  it('8. an index is an i32, as it already was', () => {
    expect(
      wgslOf(`
        declare const xs: storage<array<f32>>
        export function f(): f32 {
          return xs[0];
        }
      `),
    ).toContain('xs[0]')
  })

  it('9. a builtin call takes the kind of its other arguments', () => {
    // Before this, min(i, 4) emitted min(i, 4.0), which is not valid WGSL.
    expect(wgslOf('export function f(i: i32): i32 {\n  return min(i, 4);\n}')).toContain(
      'min(i, 4)',
    )
    expect(wgslOf('export function f(i: u32): u32 {\n  return max(i, 1);\n}')).toContain(
      'max(i, 1u)',
    )
    expect(
      wgslOf(`
        export function g(a: u32): u32 {
          return a;
        }
        export function f(): u32 {
          return g(min(u32(1), 2));
        }
      `),
    ).toContain('min(1u, 2u)')
  })

  it('10. a module const keeps the declared type', () => {
    const r = compileTsSource(`
      "use typeshade";
      const N: u32 = 16
      export function f(): u32 {
        return N;
      }
    `)
    expect(r.diagnostics).toEqual([])
    expect(typeKey(r.consts[0]!.type)).toBe('u32')
    expect(r.consts[0]!.wgslValue).toBe(16)
    expect(r.consts[0]!.cpuValue).toBe(16)
    // The emitted `const N: u32 = 16.0;` is issue #13 (the backend's emitConst spells every
    // scalar with f32Lit), not the front end's: the ConstDecl above is already right.
  })
})

describe('folded integer arithmetic in an integer context', () => {
  it('takes the declared type', () => {
    expect(wgslOf('export function f(): u32 {\n  return 2 + 3;\n}')).toContain('return 5u;')
  })

  it('works through a const expression', () => {
    expect(
      wgslOf(`
        const W: i32 = 8
        export function f(i: i32): i32 {
          return min(i, W);
        }
      `),
    ).toContain('min(i, W)')
  })
})

describe('the CPU oracle agrees', () => {
  it('evaluates every retargeted position', () => {
    const c = compile(`
      "use typeshade";
      export function g(a: u32): u32 {
        return a;
      }
      export function ret(): u32 {
        return 0;
      }
      export function arg(): u32 {
        return g(7);
      }
      export function ctor(): vec3u {
        return vec3u(1, 2, 3);
      }
      export function tern(c: bool): u32 {
        return c ? 1 : 2;
      }
      export function clamped(i: i32): i32 {
        return min(i, 4);
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.eval('ret', [])).toBe(0)
    expect(c.eval('arg', [])).toBe(7)
    expect(c.eval('ctor', [])).toEqual([1, 2, 3])
    expect(c.eval('tern', [true])).toBe(1)
    expect(c.eval('tern', [false])).toBe(2)
    expect(c.eval('clamped', [9])).toBe(4)
  })
})

describe('a float context is untouched', () => {
  it('leaves an f32 return, assignment and argument exactly as they were', () => {
    const w = wgslOf(`
      export function g(a: f32): f32 {
        return a;
      }
      export function f(): f32 {
        let y: f32 = 1.5;
        y = 2.5;
        return g(2) + min(1., 2.) + y;
      }
    `)
    expect(w).toContain('var y: f32 = 1.5;')
    expect(w).toContain('y = 2.5;')
    expect(w).toContain('g(2.0)')
    expect(w).toContain('min(1.0, 2.0)')
  })

  it('leaves an f32 vector constructor and mix alone', () => {
    const w = wgslOf(`
      export function f(a: vec3, b: vec3): vec3 {
        return mix(a, b, 1) + vec3(1, 2, 3);
      }
    `)
    expect(w).toContain('mix(a, b, 1.0)')
    expect(w).toContain('vec3<f32>(1.0, 2.0, 3.0)')
  })

  it('leaves a call whose arguments are all written numbers alone', () => {
    expect(wgslOf('export function f(): f32 {\n  return min(1, 2);\n}')).toContain('min(1.0, 2.0)')
  })

  it('keeps the IR SHAPE, which is what the isIntScalar guard is for', () => {
    // Every other assertion in this block reads emitted TEXT, and the emit-level constant
    // folder collapses `(1.0 + 1.0)` to `2.0` either way — so deleting the guard leaves them
    // all green. What changes is the IR: retargetIntLit folds BEFORE it retargets, so without
    // the guard an f32 context would receive a single `lit 2` where a `binop` was built
    // before, and `fn()` — the IR-equality oracle — would stop matching.
    const e = returnExpr('export function f(): f32 {\n  return 1. + 1.;\n}')
    expect(e.op).toBe('binop')
    const u = returnExpr('export function f(): u32 {\n  return 1 + 1;\n}')
    expect(u).toEqual({ op: 'lit', type: expect.anything(), value: 2 })
    expect(typeKey(u.type)).toBe('u32')
  })
})

describe('what the rule deliberately does not reach', () => {
  it('leaves a literal that does not fit the declared integer type alone', () => {
    // retargetIntLit builds its literal by folding, so nothing downstream would have caught
    // an out-of-range one: before this check `return -1` in a u32 function was silently
    // retyped and only the backend refused it. The type mismatch it always reported is back.
    for (const [src, want] of [
      ['export function f(): u32 {\n  return -1;\n}', 'declared u32, got f32'],
      ['export function f(): u32 {\n  return 4294967296;\n}', 'declared u32, got f32'],
      ['export function f(): i32 {\n  return 2147483648;\n}', 'declared i32, got f32'],
      ['export function f(): i32 {\n  return -2147483649;\n}', 'declared i32, got f32'],
    ] as const) {
      expect(diagnose(src)).toContain(want)
    }
    // The edges themselves still retarget.
    expect(wgslOf('export function f(): i32 {\n  return -2147483648;\n}')).toContain(
      'return -2147483648;',
    )
    expect(wgslOf('export function f(): u32 {\n  return 4294967295;\n}')).toContain(
      'return 4294967295u;',
    )
  })

  it('does not retype float arithmetic that happens to fold to a whole number', () => {
    // §13 says a number written WITHOUT a decimal point takes the declared type. The fold
    // inside retargetIntLit does not know how the number was written, so `2.5 + 0.5` in a u32
    // position emitted `return 3u;` until every leaf of the operand tree had to be an integer
    // literal.
    expect(diagnose('export function f(): u32 {\n  return 2.5 + 0.5;\n}')).toContain(
      'declared u32, got f32',
    )
    expect(
      diagnose(`
        export function g(a: u32): u32 {
          return a;
        }
        export function f(): u32 {
          return g(0.5 + 0.5);
        }
      `),
    ).toBe('Argument 1 of "g" type mismatch.')
    expect(diagnose('export function f(): vec2i {\n  return vec2i(1.5 + 0.5, 2);\n}')).toContain(
      'expected i32',
    )
    // …while arithmetic whose leaves ARE integer literals still takes the declared type.
    expect(wgslOf('export function f(): u32 {\n  return 2 + 3;\n}')).toContain('return 5u;')
  })

  it('never lets a literal in the first argument retype a whole intrinsic call', () => {
    // mathResultType is args[0].type, so retargeting there retypes the call rather than the
    // argument. A sweep of 243 programs found 24 that compiled before and errored after when
    // it did; `max(1, i)` in an f32 position is one, and it is unchanged here.
    expect(wgslOf('export function f(i: i32): f32 {\n  return max(1, i);\n}')).toContain(
      'max(1.0, i)',
    )
    // The position this item is actually about — the literal is not the peer — still works.
    expect(wgslOf('export function f(i: i32): i32 {\n  return min(i, 4);\n}')).toContain(
      'min(i, 4)',
    )
  })
})

describe('what still does not compile', () => {
  it('rejects a non-integer literal in an integer position', () => {
    expect(diagnose('export function f(): u32 {\n  return 1.5;\n}')).toBe(
      'Function "f" return type mismatch: declared u32, got f32.',
    )
  })

  it('rejects an i32 value where a u32 is declared', () => {
    expect(
      diagnose(`
        export function g(a: u32): u32 {
          return a;
        }
        export function f(i: i32): u32 {
          return g(i);
        }
      `),
    ).toBe('Argument 1 of "g" type mismatch.')
  })

  it('rejects a for-init that is not an integer', () => {
    expect(
      diagnose(`
        export function f(): f32 {
          for (let i = 0.5; i < 4.; i++) {
          }
          return 0.;
        }
      `),
    ).toBe('for induction must be i32 or u32, got f32.')
  })

  it('rejects a ternary whose arms disagree', () => {
    expect(
      diagnose(`
        export function f(c: bool, x: f32): u32 {
          return c ? 1 : x;
        }
      `),
    ).toContain('mismatch')
  })
})

// A declaration with an annotation is one of the ten positions above, but it was reaching the
// retarget through a special case of its own — `init.op === 'lit'` — and a negative literal is
// not one node, it is a PrefixUnaryExpression wrapping one. So `let j: i32 = -1` fell through
// to the type check and was rejected for being an f32, and the same line inside a `for` init
// silently emitted `var j: i32 = -1.0`. That is issue #40; these are its four faces.
describe('a negative integer literal in a declaration (issue #40)', () => {
  it('takes the declared type in a let, a const, and a for-init', () => {
    expect(wgslOf('export function f(): i32 {\n  let j: i32 = -1;\n  return j;\n}')).toContain(
      'var j: i32 = -1;',
    )
    // A `const` is folded into its use, so what there is to look at is the type it carries.
    const folded = returnExpr('export function f(): i32 {\n  const j: i32 = -1;\n  return j;\n}')
    expect(typeKey(folded.type)).toBe('i32')
    expect(
      wgslOf(`
        export function f(): i32 {
          let a: i32 = 0;
          for (let j: i32 = -1; j <= 1; j++) {
            a = a + j;
          }
          return a;
        }
      `),
    ).toContain('for (var j: i32 = -1;')
  })

  it('takes it through a folded expression too', () => {
    expect(wgslOf('export function f(): i32 {\n  let j: i32 = -1 - 2;\n  return j;\n}')).toContain(
      'var j: i32 = -3;',
    )
  })

  it('leaves an annotated float declaration exactly as it was', () => {
    expect(wgslOf('export function f(): f32 {\n  let y: f32 = -1;\n  return y;\n}')).toContain(
      'var y: f32 = -1.0;',
    )
    expect(wgslOf('export function f(): bool {\n  let b: bool = true;\n  return b;\n}')).toContain(
      'var b: bool = true;',
    )
  })

  it('now rejects a fractional initializer an integer declaration used to swallow', () => {
    // Before, `init.op === 'lit'` retyped the literal without looking at its value, so this
    // compiled to `var j: i32 = 1.5` — a WGSL error the author never saw here.
    expect(diagnose('export function f(): i32 {\n  let j: i32 = 1.5;\n  return j;\n}')).toBe(
      'Type mismatch: cannot let/const j i32 and f32 — no implicit int/float conversion. ' +
        'Cast explicitly: f32(intVal) or i32(floatVal) / u32(floatVal).',
    )
  })

  it('now rejects a fractional for-init with a diagnostic instead of a backend crash', () => {
    // `for (let j: i32 = 1.5; …)` reached the WGSL writer as an i32 loop over an f32 literal
    // and died there with SD0017; the front end says what is wrong now.
    expect(
      diagnose(`
        export function f(): i32 {
          for (let j: i32 = 1.5; j <= 1; j++) {
          }
          return 0;
        }
      `),
    ).toBe(
      'Type mismatch: cannot for-init j i32 and f32 — no implicit int/float conversion. ' +
        'Cast explicitly: f32(intVal) or i32(floatVal) / u32(floatVal).',
    )
  })

  it('agrees on the CPU', () => {
    const c = compile(`
      "use typeshade";
      export function neg(): i32 {
        let j: i32 = -1;
        return j;
      }
      export function sum(): i32 {
        let a: i32 = 0;
        for (let j: i32 = -1; j <= 1; j++) {
          a = a + j;
        }
        return a;
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.eval('neg', [])).toBe(-1)
    expect(c.eval('sum', [])).toBe(0)
  })
})
