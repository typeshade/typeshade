// `type X = { … }` and `interface X { … }` as structs in "use typeshade" (#8 A4). §2 of
// docs/use-typeshade-surface.md has always named the type alias as the plain-data spelling;
// only a `class` was collected. All three produce the same StructDecl — a class is the one
// that can also carry per-field metadata, because a TypeScript decorator cannot reach a
// type-literal or interface member.
//
// The scope rule is as much of the feature as the collection: an interface or alias is
// collected only when something USES it. A "use typeshade" file may hold host-shaped
// declarations that are not shader types at all, and collecting those would turn each into a
// type error and put an unreferenced shape into the emit.

import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import type { StructDecl } from '../../core/ir/nodes.js'

function analyze(source: string): ReturnType<typeof compileTsSource> {
  return compileTsSource(`"use typeshade";\n${source}`)
}

function structsOf(source: string): readonly StructDecl[] {
  const r = analyze(source)
  expect(r.diagnostics).toEqual([])
  return r.structs.map((s) => s.decl)
}

function names(source: string): readonly string[] {
  return structsOf(source).map((d) => d.name)
}

function diagnose(source: string): string {
  const r = analyze(source)
  expect(r.diagnostics.length).toBeGreaterThan(0)
  return r.diagnostics[0]!.message
}

function code(source: string): string | undefined {
  const r = analyze(source)
  expect(r.diagnostics.length).toBeGreaterThan(0)
  return r.diagnostics[0]!.code
}

const F = `
  export function f(): f32 {
    return 1.;
  }
`

const BODY = `
  declare const cam: uniform<Camera>
  export function f(): vec3 {
    return cam.pos;
  }
`

describe('a declaration nothing uses is not a struct', () => {
  // Every one of these compiles cleanly without this feature, because nothing collected an
  // interface or an alias at all. They have to keep compiling cleanly.
  it.each([
    ['a host-shaped alias', 'type P = { seed: number }'],
    ['a boolean field', 'type P = { on: boolean }'],
    ['a type the shader vocabulary has no name for', 'type Bad = { m: mat3 }'],
    ['a callback field', 'type Opts = { cb: () => f32 }'],
    ['an unreferenced interface', 'interface Unused { a: f32 }'],
    ['an interface of resources', 'interface Scene { time: uniform<f32> }'],
  ])('leaves %s alone', (_label, decl) => {
    const r = analyze(`${decl}\n${F}`)
    expect(r.diagnostics).toEqual([])
    expect(r.structs).toEqual([])
    expect(r.wgsl).not.toContain('struct')
  })

  it('collects a class even when nothing refers to it, as it always has', () => {
    expect(names(`class Unused {\n  a: f32\n}\n${F}`)).toEqual(['Unused'])
  })

  it('collects exactly the object alias, not an alias of some other type', () => {
    expect(
      names(`
        type Color = vec4
        type Camera = {
          view: mat4
          pos: vec3
        }
        ${BODY}
      `),
    ).toEqual(['Camera'])
  })
})

describe('a declaration something uses is a struct', () => {
  it.each([
    [
      'a declare binding',
      `declare const cam: uniform<P>\nexport function f(): f32 { return cam.a; }`,
    ],
    ['a parameter', `export function f(p: P): f32 { return p.a; }`],
    ['a return type', `export function f(x: f32): P { return { a: x }; }`],
    ['a local annotation', `export function f(x: f32): f32 { let p: P = { a: x }; return p.a; }`],
  ])('is reached through %s', (_label, use) => {
    expect(names(`type P = {\n  a: f32\n}\n${use}`)).toEqual(['P'])
  })

  it('is reached through a field of another struct that is used', () => {
    expect(
      names(`
        type Inner = {
          k: f32
        }
        type Outer = {
          inner: Inner
        }
        declare const o: uniform<Outer>
        export function f(): f32 {
          return o.inner.k;
        }
      `),
    ).toEqual(['Inner', 'Outer'])
  })

  it('is reached through a storage array element', () => {
    expect(
      names(`
        interface P {
          a: f32
        }
        declare const ps: storage<array<P>>
        export function f(i: i32): f32 {
          return ps[i].a;
        }
      `),
    ).toEqual(['P'])
  })
})

describe('the three spellings agree', () => {
  const FIELDS = `
    view: mat4
    pos: vec3
  `

  it('collect the same decl', () => {
    const fromType = structsOf(`type Camera = {${FIELDS}}\n${BODY}`)
    const fromInterface = structsOf(`interface Camera {${FIELDS}}\n${BODY}`)
    const fromClass = structsOf(`class Camera {${FIELDS}}\n${BODY}`)
    expect(fromType).toEqual(fromClass)
    expect(fromInterface).toEqual(fromClass)
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

  it('record which spelling declared each one', () => {
    const r = analyze(`type Camera = {${FIELDS}}\n${BODY}`)
    expect(r.structs[0]!.spelling).toBe('type')
    expect(analyze(`interface Camera {${FIELDS}}\n${BODY}`).structs[0]!.spelling).toBe('interface')
    expect(analyze(`class Camera {${FIELDS}}\n${BODY}`).structs[0]!.spelling).toBe('class')
  })

  it('emit the same WGSL struct', () => {
    for (const decl of [
      `type Camera = {${FIELDS}}`,
      `interface Camera {${FIELDS}}`,
      `class Camera {${FIELDS}}`,
    ]) {
      const r = analyze(`${decl}\n${BODY}`)
      expect(r.diagnostics).toEqual([])
      expect(r.wgsl).toContain('struct Camera {\n  view: mat4x4<f32>,\n  pos: vec3<f32>,\n}')
      expect(r.wgsl).toContain('return cam.pos;')
    }
  })

  it('match an object literal, so a helper can return one', () => {
    const r = analyze(`
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

  it('take a nested struct field and an array field', () => {
    expect(
      structsOf(`
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
      `)[1],
    ).toEqual({
      name: 'Outer',
      fields: [
        { name: 'inner', type: { kind: 'struct', name: 'Inner' } },
        { name: 'xs', type: { kind: 'array', elem: { kind: 'scalar', scalar: 'f32' }, size: 4 } },
      ],
    })
  })
})

describe('entry I/O still needs a decorator, which only a class can carry', () => {
  const VS = (decl: string) => `
    ${decl}
    @vertex
    export function vs(@location(0) p: vec2): VsOut {
      return { pos: vec4(p, 0., 1.), uv: p };
    }
  `
  const FIELDS = `
    pos: vec4
    uv: vec2
  `

  it('tells a type-alias author to declare it as a class', () => {
    expect(diagnose(VS(`type VsOut = {${FIELDS}}`))).toBe(
      'Struct "VsOut" field "pos" is used as a vertex output but has neither @builtin(...) nor ' +
        '@location(...): WGSL requires every entry output struct member to declare one, and a ' +
        'type alias member cannot carry a decorator — declare "VsOut" as a class.',
    )
  })

  it('tells an interface author the same, with the right article', () => {
    expect(diagnose(VS(`interface VsOut {${FIELDS}}`))).toContain(
      'an interface member cannot carry a decorator — declare "VsOut" as a class.',
    )
  })

  it('asks a class author only for the decorator itself', () => {
    const message = diagnose(VS(`class VsOut {${FIELDS}}`))
    expect(message).toContain('WGSL requires every entry output struct member to declare one.')
    expect(message).not.toContain('declare "VsOut" as a class')
  })
})

describe('shapes a WGSL struct has no form for', () => {
  const USED = 'declare const u: uniform<Bad>\nexport function f(): f32 { return 1.; }'

  it('rejects a generic declaration that something uses', () => {
    expect(
      diagnose(`
        type Bad<T> = {
          a: T
        }
        ${USED}
      `),
    ).toBe(
      '"Bad" takes type parameters. A TypeShade struct is one concrete layout, so a generic ' +
        'declaration has no single set of field types to emit.',
    )
  })

  it('leaves a generic declaration nothing uses alone', () => {
    const r = analyze(`type Pair<T> = {\n  a: T\n}\n${F}`)
    expect(r.diagnostics).toEqual([])
    expect(r.structs).toEqual([])
  })

  it.each([
    ['a type alias', 'type Bad = {}'],
    ['an interface', 'interface Bad {}'],
  ])('rejects an empty %s', (_label, decl) => {
    expect(diagnose(`${decl}\n${USED}`)).toBe(
      'Struct "Bad" has no fields. WGSL requires a struct to declare at least one member, so ' +
        'an empty one cannot be emitted.',
    )
  })

  it('rejects an empty class too, which was a hole before', () => {
    expect(diagnose(`class Bad {}\n${F}`)).toBe(
      'Struct "Bad" has no fields. WGSL requires a struct to declare at least one member, so ' +
        'an empty one cannot be emitted.',
    )
  })

  it('rejects a method signature', () => {
    expect(
      diagnose(`
        interface Bad {
          a: f32
          m(): f32
        }
        ${USED}
      `),
    ).toBe('Data type "Bad" cannot have methods.')
  })

  it('rejects a call signature with its own message', () => {
    expect(
      diagnose(`
        interface Bad {
          (): f32
        }
        ${USED}
      `),
    ).toBe(
      'Data type "Bad" cannot be callable or constructable — a struct is data, and a signature ' +
        'has no layout.',
    )
  })

  it('rejects an index signature', () => {
    expect(
      diagnose(`
        interface Bad {
          [k: string]: f32
        }
        ${USED}
      `),
    ).toBe('Data type "Bad" cannot have an index signature. Use array<T, N> for a field of many.')
  })

  it('rejects an optional field', () => {
    expect(
      diagnose(`
        type Bad = {
          a?: f32
        }
        ${USED}
      `),
    ).toBe(
      'Optional field "a?" on "Bad" is not supported: a struct field is always present in the ' +
        'buffer the host fills.',
    )
  })

  it('rejects a field name that is not a plain identifier', () => {
    expect(
      diagnose(`
        type Bad = {
          "a b": f32
        }
        ${USED}
      `),
    ).toBe(
      'Field names on "Bad" must be plain identifiers: a WGSL struct member has no other ' +
        'spelling, and a quoted or computed name would not reach the emitted layout.',
    )
  })
})

describe('only a CONSUMPTION site makes a candidate reachable', () => {
  // The gate exists so a host-shaped `type Config = { seed: number }` stays as invisible as it
  // was before aliases were collected at all. Its first version rooted on every type reference
  // outside a candidate, which made a DEAD ALIAS enough: `type Params = Config` mentions
  // `Config`, consumes nothing, and pulled it in. Each of these compiles on main.
  const HOST = 'type Config = { seed: number }\n'
  const TAIL = '\nexport function f(): f32 {\n  return 1.;\n}'

  it('a declaration that only NAMES a candidate does not reach it', () => {
    for (const dead of [
      'type Params = Config',
      'type List = Config[]',
      'type Maybe = Config | undefined',
      'type RO = Readonly<Config>',
      'interface Holder {\n  c: Config\n}',
    ]) {
      const r = compileTsSource(`"use typeshade";\n${HOST}${dead}${TAIL}`)
      expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
      expect(r.structs.map((x) => x.decl.name)).toEqual([])
    }
  })

  it('every place a type is actually consumed still reaches it', () => {
    const P = 'type P = {\n  a: f32\n}\n'
    for (const live of [
      'export function f(p: P): f32 {\n  return p.a;\n}',
      'export function f(): P {\n  return { a: 1. };\n}',
      'declare const u: uniform<P>\nexport function f(): f32 {\n  return u.a;\n}',
      'export function f(): f32 {\n  const p: P = { a: 1. };\n  return p.a;\n}',
    ]) {
      const r = compileTsSource(`"use typeshade";\n${P}${live}`)
      expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
      expect(r.structs.map((x) => x.decl.name)).toEqual(['P'])
    }
  })

  it('reaches through a field of something consumed, from a class as well as an alias', () => {
    const viaAlias = compileTsSource(`"use typeshade";
      type Inner = {
        x: f32
      }
      type Outer = {
        i: Inner
      }
      declare const u: uniform<Outer>
      export function f(): f32 {
        return u.i.x;
      }
    `)
    expect(viaAlias.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(viaAlias.structs.map((x) => x.decl.name).sort()).toEqual(['Inner', 'Outer'])

    const viaClass = compileTsSource(`"use typeshade";
      type Inner = {
        x: f32
      }
      class C {
        i: Inner
      }
      declare const u: uniform<C>
      export function f(): f32 {
        return u.i.x;
      }
    `)
    expect(viaClass.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(viaClass.structs.map((x) => x.decl.name).sort()).toEqual(['C', 'Inner'])
  })

  it('still reports a host-shaped alias that IS consumed', () => {
    const r = compileTsSource(
      `"use typeshade";\n${HOST}export function f(p: Config): f32 {\n  return 1.;\n}`,
    )
    expect(r.diagnostics.some((d) => d.code === 'TS8002')).toBe(true)
  })
})

describe('inheritance drops fields, so it is refused', () => {
  const EXTENDS = `
    declare const u: uniform<B>
    export function f(): f32 {
      return u.b;
    }
  `

  it('rejects an interface that extends, and collects nothing for it', () => {
    const src = `
      interface A {
        a: f32
      }
      interface B extends A {
        b: f32
      }
      ${EXTENDS}
    `
    expect(diagnose(src)).toBe(
      '"B" extends another type. A TypeShade struct is exactly the members written here, so ' +
        'the inherited ones would be dropped; write them out.',
    )
    // The half-built struct must not reach the emit either.
    expect(analyze(src).structs.map((s) => s.decl.name)).not.toContain('B')
  })

  it('rejects a class that extends, which used to drop the base silently', () => {
    const src = `
      class A {
        a: f32
      }
      class B extends A {
        b: f32
      }
      ${EXTENDS}
    `
    expect(diagnose(src)).toContain('"B" extends another type.')
    expect(analyze(src).structs.map((s) => s.decl.name)).toEqual(['A'])
  })
})

describe('one name, one declaration', () => {
  const USE = 'declare const u: uniform<C>\nexport function f(): f32 { return 1.; }'
  const DUPLICATE =
    'Struct "C" is declared more than once. A class, an interface and a type alias are three ' +
    'spellings of one struct, not declarations that merge — TypeScript would merge two ' +
    'interfaces, and the merged layout would disagree with this one at every use site.'

  it.each([
    [
      'two interfaces, which TypeScript would merge',
      'interface C {\n  a: f32\n}\ninterface C {\n  b: f32\n}',
    ],
    ['an interface and a type alias', 'interface C {\n  a: f32\n}\ntype C = {\n  b: f32\n}'],
    ['a class and an interface', 'class C {\n  a: f32\n}\ninterface C {\n  b: f32\n}'],
  ])('rejects %s', (_label, decls) => {
    expect(diagnose(`${decls}\n${USE}`)).toBe(DUPLICATE)
  })

  it('reports it as a duplicate symbol, not a struct-field problem', () => {
    expect(code(`class C {\n  a: f32\n}\ninterface C {\n  b: f32\n}\n${USE}`)).toBe('TS8023')
  })
})
