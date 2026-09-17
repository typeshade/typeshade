// An object literal takes the struct the position DECLARES (#8 A11).
//
// Matching the field names against the struct table is what this surface did, and it cannot
// answer when two structs have the same shape: a vertex `VsOut` and a fragment `FsIn` with the
// same fields made `return { pos, uv }` an error in a function that says which one it returns.
// A return type, a `let`/`const` annotation and a parameter type each name the struct outright;
// name matching stays as the fallback for a position that declares nothing.
//
// SIX positions take a declared type: the three annotations above, plus three that carry one
// without an annotation of their own (an assignment target, both arms of a ternary, and an
// array constructor's element type). A few of the cases below pass on the merge base as well,
// and are here on purpose, to guard behaviour this item must PRESERVE: the fallback still
// resolves a position that declares nothing, a non-struct context is still left to the
// declaration, and the scope's return type does not leak between functions. The rest fail on
// the merge base for the reason each states.

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

  it('carries the context INTO a nested literal, where twins make it the only answer', () => {
    // The nested half of the test above resolves by name matching on both trees, so it could
    // not tell whether the context reached inward. With a twin at the INNER level nothing but
    // the context can answer: the struct is resolved before the initializers are lowered, and
    // each one is lowered against the type of the field it fills.
    const w = wgslOf(`
      class Inner {
        x: f32
      }
      class InnerTwin {
        x: f32
      }
      class Outer {
        i: Inner
      }
      export function f(): Outer {
        return { i: { x: 1. } };
      }
    `)
    expect(w).toContain('return Outer(Inner(1.0));')
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

  it('but the declaration only gets to report it when the fallback resolves first', () => {
    // The literal is lowered before the declaration's type check runs, so with TWINS in scope
    // the fallback fails first and its own generic message is what leads, followed by the
    // knock-on for a name that never got defined. The declaration is still the position that
    // OWNS the mistake; it just does not always get to be the one that names it.
    const r = compileTsSource(
      `"use typeshade";${TWINS}export function f(): f32 {\n  const o: f32 = { a: 1., b: 2. };\n  return o;\n}`,
    )
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      'Object literal { a, b } does not match a known struct.',
      'Unknown identifier "o".',
    ])
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

describe('what this item does NOT change', () => {
  it('still takes the last of a repeated field, in every position', () => {
    // The count guard that stood here could fire on one input alone — a REPEATED field, since
    // `matchStruct` already equates the struct's field count with the literal's unique-name
    // count. So `const o = { a: 1., a: 2., b: 3. }` emitted `P(2.0, 3.0)` before this item and
    // would have been refused after it, while the same literal in a return position stayed
    // accepted. A repeated field is TypeScript's own TS1117 and the editor says so; the
    // compiler keeps taking the last, the way it always did, in both positions.
    const P = 'class P {\n  a: f32\n  b: f32\n}\n'
    expect(
      wgslOf(
        `${P}export function f(): f32 {\n  const o = { a: 1., a: 2., b: 3. };\n  return o.a;\n}`,
      ),
    ).toContain('let o = P(2.0, 3.0);')
    expect(wgslOf(`${P}export function f(): P {\n  return { a: 1., a: 2., b: 3. };\n}`)).toContain(
      'return P(2.0, 3.0);',
    )
  })

  it('names the struct when a declared position gets a field it does not have', () => {
    // A return-position literal is no longer coerced by field POSITION. On the merge base
    // `fillFunctionBody`'s construct coercion retyped `{ c, d }` to `P(1.0, 2.0)`; by the time
    // this item landed, `main` already refused it, with the fallback's generic sentence. The
    // message is the specific one now, which is the whole change here.
    const r = compileTsSource(`
      "use typeshade";
      class P {
        a: f32
        b: f32
      }
      export function f(): P {
        return { c: 1., d: 2. };
      }
    `)
    expect(r.diagnostics.length).toBeGreaterThan(0)
    expect(r.diagnostics[0]!.message).toBe('Struct P has no field "c".')
  })

  it('leaves the positions that declare nothing to name matching', () => {
    // An element access, a binary operand, an index: nothing there declares a struct, so the
    // fallback is still what answers, exactly as on the merge base. Pinned so the boundary
    // moves deliberately rather than by accident.
    const r = compileTsSource(
      `"use typeshade";${TWINS}export function f(): f32 {\n  return ({ a: 1., b: 2. }).a;\n}`,
    )
    expect(r.diagnostics.map((d) => d.message)).toContain(
      'Object literal { a, b } does not match a known struct.',
    )
  })
})

describe('a position that declares a type through something else', () => {
  it('an assignment target carries the type its declaration gave it', () => {
    // The annotation is on the DECLARATION, but the lvalue carries that type to the
    // assignment, so `o = { … }` is a declared position too. Refused against a twin before.
    const w = wgslOf(
      `${TWINS}export function f(): P {\n  let o: P = { a: 1., b: 2. };\n  o = { a: 3., b: 4. };\n  return o;\n}`,
    )
    expect(w).toContain('o = P(3.0, 4.0);')
    // The other twin from the same literal, so it is the target deciding and not an order.
    const wq = wgslOf(
      `${TWINS}export function f(): Q {\n  let o: Q = { a: 1., b: 2. };\n  o = { a: 3., b: 4. };\n  return o;\n}`,
    )
    expect(wq).toContain('o = Q(3.0, 4.0);')
  })

  it("both arms of a ternary sit in the ternary's own position", () => {
    const w = wgslOf(
      `${TWINS}export function f(c: bool): Q {\n  return c ? { a: 1., b: 2. } : { a: 3., b: 4. };\n}`,
    )
    expect(w).toContain('select(Q(3.0, 4.0), Q(1.0, 2.0), c)')
  })

  it('an array constructor names its element type in its own type argument', () => {
    const w = wgslOf(
      `${TWINS}export function f(): f32 {\n  const xs = array<Q, 2>({ a: 1., b: 2. }, { a: 3., b: 4. });\n  return xs[0].a;\n}`,
    )
    expect(w).toContain('array<Q, 2>(Q(1.0, 2.0), Q(3.0, 4.0))')
  })
})
