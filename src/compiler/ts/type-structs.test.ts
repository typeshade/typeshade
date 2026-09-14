// `type X = { … }` and `interface X { … }` as structs in "use typeshade" (#8 A4). §2 of
// docs/use-typeshade-surface.md has always named the type alias as the plain-data spelling;
// only a `class` was collected. All three produce the same StructDecl — a class is the one
// that can also carry per-field metadata, because a TypeScript decorator cannot reach a
// type-literal or interface member.

import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import type { StructDecl } from '../../core/ir/nodes.js'

function structsOf(source: string): readonly StructDecl[] {
  const r = compileTsSource(`"use typeshade";\n${source}`)
  expect(r.diagnostics).toEqual([])
  return r.structs.map((s) => s.decl)
}

function diagnose(source: string): string {
  const r = compileTsSource(`"use typeshade";\n${source}`)
  expect(r.diagnostics.length).toBeGreaterThan(0)
  return r.diagnostics[0]!.message
}

const BODY = `
  declare const cam: uniform<Camera>
  export function f(): vec3 {
    return cam.pos;
  }
`

describe('a type alias is a struct', () => {
  it('collects the same decl a class does', () => {
    const fromType = structsOf(`
      type Camera = {
        view: mat4
        pos: vec3
      }
      ${BODY}
    `)
    const fromClass = structsOf(`
      class Camera {
        view: mat4
        pos: vec3
      }
      ${BODY}
    `)
    expect(fromType).toEqual(fromClass)
    expect(fromType).toEqual([
      {
        name: 'Camera',
        fields: [
          { name: 'view', type: { kind: 'mat', n: 4, elem: 'f32' } },
          { name: 'pos', type: { kind: 'vec', n: 3, elem: 'f32' } },
        ],
      },
    ])
  })

  it('emits the same WGSL struct and lets a field read through', () => {
    const r = compileTsSource(`"use typeshade";
      type Camera = {
        view: mat4
        pos: vec3
      }
      ${BODY}
    `)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('struct Camera {\n  view: mat4x4<f32>,\n  pos: vec3<f32>,\n}')
    expect(r.wgsl).toContain('return cam.pos;')
  })

  it('matches an object literal, so a helper can return one', () => {
    const r = compileTsSource(`"use typeshade";
      type P = {
        a: f32
        b: f32
      }
      export function f(x: f32): P {
        return { a: x, b: 0. };
      }
    `)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('return P(x, 0.0);')
  })

  it('leaves a type alias that is not an object alone', () => {
    // `type Color = vec4` is not a struct spelling; it is still resolved as a struct name by
    // the type map (A12's business), and this collector must not invent a fieldless struct.
    const r = compileTsSource(`"use typeshade";
      type Color = vec4
      export function f(): Color {
        return vec4(0.);
      }
    `)
    expect(r.structs).toEqual([])
  })
})

describe('an interface is a struct', () => {
  it('collects the same decl a class does', () => {
    const fromInterface = structsOf(`
      interface Camera {
        view: mat4
        pos: vec3
      }
      ${BODY}
    `)
    const fromClass = structsOf(`
      class Camera {
        view: mat4
        pos: vec3
      }
      ${BODY}
    `)
    expect(fromInterface).toEqual(fromClass)
  })

  it('emits the same WGSL struct', () => {
    const r = compileTsSource(`"use typeshade";
      interface Camera {
        view: mat4
        pos: vec3
      }
      ${BODY}
    `)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('struct Camera {\n  view: mat4x4<f32>,\n  pos: vec3<f32>,\n}')
  })
})

describe('nested and array fields', () => {
  it('takes a struct field and an array field', () => {
    const decls = structsOf(`
      type Inner = {
        k: f32
      }
      type Outer = {
        inner: Inner
        xs: array<f32, 4>
      }
      declare const o: uniform<Outer>
      export function f(): f32 {
        return o.inner.k + o.xs[0];
      }
    `)
    expect(decls[1]).toEqual({
      name: 'Outer',
      fields: [
        { name: 'inner', type: { kind: 'struct', name: 'Inner' } },
        { name: 'xs', type: { kind: 'array', elem: { kind: 'scalar', scalar: 'f32' }, size: 4 } },
      ],
    })
  })
})

describe('what the plain-data spellings cannot carry', () => {
  it('says an entry-IO field still needs @builtin or @location, which needs a class', () => {
    expect(
      diagnose(`
        type VsOut = {
          pos: vec4
          uv: vec2
        }
        @vertex
        export function vs(@location(0) p: vec2): VsOut {
          return { pos: vec4(p, 0., 1.), uv: p };
        }
      `),
    ).toContain('has neither @builtin(...) nor @location(...)')
  })

  it('rejects a method signature', () => {
    expect(
      diagnose(`
        interface Bad {
          a: f32
          m(): f32
        }
        declare const u: uniform<Bad>
        export function f(): f32 {
          return u.a;
        }
      `),
    ).toBe('Data type "Bad" cannot have methods.')
  })

  it('rejects an index signature', () => {
    expect(
      diagnose(`
        interface Bad {
          [k: string]: f32
        }
        declare const u: uniform<Bad>
        export function f(): f32 {
          return 1.;
        }
      `),
    ).toBe('Data type "Bad" cannot have an index signature. Use array<T, N> for a field of many.')
  })

  it('rejects an optional field', () => {
    expect(
      diagnose(`
        type Bad = {
          a?: f32
        }
        declare const u: uniform<Bad>
        export function f(): f32 {
          return 1.;
        }
      `),
    ).toBe(
      'Optional field "a?" on "Bad" is not supported: a struct field is always present in the ' +
        'buffer the host fills.',
    )
  })

  it('rejects an interface that extends another, whose fields would be dropped', () => {
    expect(
      diagnose(`
        interface A {
          a: f32
        }
        interface B extends A {
          b: f32
        }
        declare const u: uniform<B>
        export function f(): f32 {
          return u.b;
        }
      `),
    ).toBe(
      'interface "B" extends another type. A TypeShade struct is exactly the members written ' +
        'here, so the inherited ones would be dropped; write them out.',
    )
  })

  it('rejects one name declared twice across two spellings', () => {
    expect(
      diagnose(`
        class C {
          a: f32
        }
        interface C {
          b: f32
        }
        declare const u: uniform<C>
        export function f(): f32 {
          return u.a;
        }
      `),
    ).toBe(
      'Struct "C" is declared more than once. A class, a type alias and an interface are three ' +
        'spellings of one struct, not declarations that merge.',
    )
  })

  it('still names an unknown field type', () => {
    expect(
      diagnose(`
        type Bad = {
          m: mat3
        }
        declare const u: uniform<Bad>
        export function f(): f32 {
          return 1.;
        }
      `),
    ).toContain('Unknown type "mat3"')
  })
})
