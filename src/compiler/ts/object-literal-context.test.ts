// An object literal takes the struct the position DECLARES (#8 A11).
//
// Matching the field names against the struct table is what this surface did, and it cannot
// answer when two structs have the same shape: a vertex `VsOut` and a fragment `FsIn` with the
// same fields made `return { pos, uv }` an error in a function that says which one it returns.
// A return type, a `let`/`const` annotation and a parameter type each name the struct outright;
// name matching stays as the fallback for a position that declares nothing.

import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { compile } from './compile.js'

/** Two structs with identical fields — the shape name matching cannot resolve. */
const TWINS = `
  class P {
    a: f32
    b: f32
  }
  class Q {
    a: f32
    b: f32
  }
`

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

describe('the three positions that declare a type', () => {
  it('1. a return type names the struct, even against a twin', () => {
    expect(wgslOf(`${TWINS}\nexport function f(): P {\n  return { a: 1., b: 2. };\n}`)).toContain(
      'return P(1.0, 2.0);',
    )
    // …and the OTHER twin, from the same literal, so it is the declaration deciding and not
    // a tie broken by declaration order.
    expect(wgslOf(`${TWINS}\nexport function f(): Q {\n  return { a: 1., b: 2. };\n}`)).toContain(
      'return Q(1.0, 2.0);',
    )
  })

  it('2. a let/const annotation names it', () => {
    const w = wgslOf(`
      ${TWINS}
      export function f(): Q {
        const o: Q = { a: 1., b: 2. };
        return o;
      }
    `)
    // A `const` lowers to a `let` binding, which takes its type from the value, so the
    // annotation shows in the CONSTRUCTOR rather than on the binding line.
    expect(w).toContain('let o = Q(1.0, 2.0);')
  })

  it('3. a parameter type names it', () => {
    const w = wgslOf(`
      ${TWINS}
      export function g(p: Q): f32 {
        return p.a;
      }
      export function f(): f32 {
        return g({ a: 1., b: 2. });
      }
    `)
    expect(w).toContain('return g(Q(1.0, 2.0));')
  })

  it('reaches through parentheses, and into a nested literal', () => {
    expect(wgslOf(`${TWINS}\nexport function f(): P {\n  return ({ a: 1., b: 2. });\n}`)).toContain(
      'return P(1.0, 2.0);',
    )
    const w = wgslOf(`
      class Inner {
        x: f32
      }
      class Outer {
        i: Inner
      }
      export function f(): Outer {
        const o: Outer = { i: { x: 1. } };
        return o;
      }
    `)
    expect(w).toContain('Outer(Inner(1.0))')
  })
})

describe('name matching is still the fallback', () => {
  it('resolves a literal in a position that declares nothing', () => {
    const w = wgslOf(`
      class P {
        a: f32
        b: f32
      }
      export function f(): P {
        const o = { a: 1., b: 2. };
        return o;
      }
    `)
    expect(w).toContain('let o = P(1.0, 2.0);')
  })

  it('still refuses what it cannot resolve without a context', () => {
    expect(
      diagnose(`
        ${TWINS}
        export function f(): P {
          const o = { a: 1., b: 2. };
          return o;
        }
      `),
    ).toBe('Object literal { a, b } does not match a known struct.')
    expect(
      diagnose(`
        class P {
          a: f32
          b: f32
        }
        export function f(): P {
          const o = { a: 1., b: 2., c: 3. };
          return o;
        }
      `),
    ).toBe('Object literal { a, b, c } does not match a known struct.')
  })
})

describe('with a declared struct, the field diagnostics name it', () => {
  it('reports a missing field against the struct the position declared', () => {
    // Without a context this was "{ a } does not match a known struct", which describes the
    // search rather than the mistake. The declaration says which struct, so the message can.
    expect(
      diagnose(
        'class P {\n  a: f32\n  b: f32\n}\nexport function f(): P {\n  return { a: 1. };\n}',
      ),
    ).toBe('Missing field "b" for struct P.')
  })

  it('reports a field the struct does not have', () => {
    expect(
      diagnose(
        'class P {\n  a: f32\n  b: f32\n}\nexport function f(): P {\n  return { a: 1., c: 2. };\n}',
      ),
    ).toBe('Struct P has no field "c".')
  })

  it('still reports a field whose type does not fit', () => {
    expect(
      diagnose(
        'class P {\n  a: f32\n  b: f32\n}\nexport function f(i: i32): P {\n  return { a: i, b: 2. };\n}',
      ),
    ).toContain('field P.a')
  })

  it('ignores a contextual type that is not a struct, leaving the position to report it', () => {
    // `const o: f32 = { a: 1. }` is a type error about the DECLARATION, not about which
    // struct the literal builds, and the declaration's own check is what says so.
    const r = compileTsSource(`
      "use typeshade";
      class P {
        a: f32
      }
      export function f(): f32 {
        const o: f32 = { a: 1. };
        return o;
      }
    `)
    expect(r.diagnostics.length).toBeGreaterThan(0)
    expect(r.diagnostics[0]!.message).toContain('let/const o')
  })
})

describe('the CPU oracle agrees', () => {
  it('builds and reads the struct the declaration named', () => {
    const c = compile(`
      "use typeshade";
      ${TWINS}
      export function mk(): Q {
        return { a: 3., b: 4. };
      }
      export function sum(): f32 {
        const o: P = { a: 1., b: 2. };
        return o.a + o.b;
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.eval('mk', [])).toEqual({ a: 3, b: 4 })
    expect(c.eval('sum', [])).toBe(3)
  })
})
