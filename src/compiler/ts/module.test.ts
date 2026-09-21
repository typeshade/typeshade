// ═══ compileTsSources — the ONE multi-file entry point ═══
//
// There were two of these. `module.ts` took a list of { fileName, source } and is what
// `compiler/ts/index.ts` exports; `sources.ts` took a Record keyed by filename with an
// `{ entry }` option, ran the statement-level semantic check and collected module constants,
// and was reached by its own test and by the documentation gate. Design doc §11 listed the
// pair as an open question ("compileTsSources exists in two incompatible forms").
//
// They are one now, on the list signature, with the two things only `sources.ts` did folded
// in — so the merge adds capability rather than dropping it. The cases below marked PORTED
// came from `sources.test.ts` and are kept because they cover behaviour the surviving test
// file did not: a non-relative import, and the shape of the whole emitted module rather than
// one call site.

import { describe, expect, it } from 'vitest'
import { compileTsSources } from './module.js'
import { compile } from './compile.js'
import { TS_CODES } from './codes.js'

describe('compileTsSources import', () => {
  it('resolves relative named import onto declRef', () => {
    const r = compileTsSources([
      {
        fileName: 'math.ts',
        source: `
          "use typeshade";
          export function square(x: f32): f32 {
            return x * x;
          }
        `,
      },
      {
        fileName: 'app.ts',
        source: `
          "use typeshade";
          import { square } from "./math";
          export function foo(x: f32): f32 {
            return square(x) + 1;
          }
        `,
      },
    ])
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const foo = r.funcs.find((f) => f.name === 'foo')
    expect(foo).toBeTruthy()
    const ret = foo!.body[0]
    expect(ret!.s).toBe('return')
    if (ret!.s === 'return' && ret.expr && ret.expr.op === 'binop' && ret.expr.a.op === 'call') {
      expect(ret.expr.a.fn).toBe('square')
      expect(ret.expr.a.declRef?.name).toBe('square')
    }
    expect(r.wgsl).toMatch(/fn square/)
    expect(r.wgsl).toMatch(/fn foo/)
  })

  it('rejects a missing module', () => {
    const r = compileTsSources([
      {
        fileName: 'app.ts',
        source: `
          "use typeshade";
          import { square } from "./nope";
          export function foo(x: f32): f32 { return square(x); }
        `,
      },
    ])
    expect(r.diagnostics.some((d) => /Cannot resolve import/.test(d.message))).toBe(true)
  })
})

describe('compileTsSources syntax errors', () => {
  it('reports a parse error in any file as SYNTAX, naming the file, and lowers nothing', () => {
    const r = compileTsSources([
      {
        fileName: 'math.ts',
        source: `"use typeshade";\nexport function square(x: f32): f32 { return x * x; }`,
      },
      {
        fileName: 'app.ts',
        source: `"use typeshade";\nimport { square } from "./math";\nexport function foo(x: f32): f32 { return square(x; }`,
      },
    ])
    expect(r.diagnostics.length).toBeGreaterThan(0)
    expect(r.diagnostics.every((d) => d.code === TS_CODES.SYNTAX)).toBe(true)
    expect(r.diagnostics[0]!.fileName).toBe('app.ts')
    expect(r.diagnostics[0]!.line).toBe(3)
    expect(r.funcs).toEqual([])
    expect(r.wgsl).toBeUndefined()
  })
})

describe('compileTsSources — ported from sources.test.ts', () => {
  it('PORTED: resolves relative named imports into one WGSL module', () => {
    const r = compileTsSources(
      [
        {
          fileName: 'math.ts',
          source: `
          "use typeshade";
          export function square(x: f32): f32 { return x * x; }
        `,
        },
        {
          fileName: 'app.ts',
          source: `
          "use typeshade";
          import { square } from "./math";
          export function foo(x: f32): f32 { return square(x) + 1.; }
        `,
        },
      ],
      'app.ts',
    )
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.funcs.map((f) => f.name).sort()).toEqual(['foo', 'square'])
    expect(r.wgsl).toMatch(/fn square/)
    expect(r.wgsl).toMatch(/fn foo/)
    expect(r.wgsl).toMatch(/square\(/)
  })

  it('PORTED: rejects non-relative imports', () => {
    const r = compileTsSources(
      [
        {
          fileName: 'app.ts',
          source: `
          "use typeshade";
          import { sin } from "some-pkg";
          export function f(x: f32): f32 { return x; }
        `,
        },
      ],
      'app.ts',
    )
    expect(r.diagnostics.some((d) => /relative/.test(d.message))).toBe(true)
  })
})

// The two capabilities the merge carried over from sources.ts. Without these arms the merge
// looks green while having silently dropped them: every existing case above passes on a
// compileTsSources that does neither.
describe('compileTsSources — what the merge carried over', () => {
  it('collects module constants from the entry file and emits them', () => {
    const r = compileTsSources(
      [
        {
          fileName: 'app.ts',
          source: `
          "use typeshade";
          const K: f32 = 2.;
          export function f(x: f32): f32 { return x * K; }
        `,
        },
      ],
      'app.ts',
    )
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.consts.map((c) => c.name)).toEqual(['K'])
    expect(r.wgsl).toMatch(/const K/)
  })

  it('runs the statement-level semantic check on every file, not just the entry', () => {
    const r = compileTsSources([
      {
        fileName: 'lib.ts',
        // A top-level `var` is refused in every file (§24 made a top-level `let` a module
        // variable, so it is no longer the example).
        source: `"use typeshade";\nvar loose = 1;\nexport function g(x: f32): f32 { return x; }`,
      },
      {
        fileName: 'app.ts',
        source: `"use typeshade";\nimport { g } from "./lib";\nexport function f(x: f32): f32 { return g(x); }`,
      },
    ])
    const errors = r.diagnostics.filter((d) => d.category === 'error')
    expect(
      errors.map((d) => d.fileName),
      'a top-level statement in a NON-entry file must still be reported — it was not, before ' +
        'the merge, so the documentation gate accepted in a multi-file fence what it rejects ' +
        'in a single-file one',
    ).toContain('lib.ts')
  })

  it('a top-level let is a module variable in the entry file, and is refused with the reason elsewhere', () => {
    const lib = {
      fileName: 'lib.ts',
      source: `"use typeshade";\nlet loose = 1;\nexport function g(x: f32): f32 { return x + loose; }`,
    }
    const app = {
      fileName: 'app.ts',
      source: `"use typeshade";\nimport { g } from "./lib";\nexport function f(x: f32): f32 { return g(x); }`,
    }
    const asEntry = compileTsSources([lib, app], 'lib.ts')
    expect(asEntry.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(asEntry.wgsl).toContain('var<private> loose: f32 = 1.0;')
    // With app.ts the entry, lib.ts's variable is not collected (roadmap item 14); it says so
    // instead of vanishing, and the read of it is not left as a bare "Unknown identifier".
    const elsewhere = compileTsSources([lib, app], 'app.ts')
    const errors = elsewhere.diagnostics.filter((d) => d.category === 'error')
    expect(errors.map((d) => `${d.fileName} ${d.code} ${d.message}`)).toContain(
      'lib.ts TS8014 A module variable is declared in the entry file, and "lib.ts" is not the entry. Move this let there, or pass the value as a parameter.',
    )
  })

  it('reports an entry that is not in the source set', () => {
    const r = compileTsSources(
      [
        {
          fileName: 'app.ts',
          source: `"use typeshade";\nexport function f(x: f32): f32 { return x; }`,
        },
      ],
      'nope.ts',
    )
    expect(
      r.diagnostics.some((d) => /Entry "nope.ts" is not in the source set/.test(d.message)),
    ).toBe(true)
  })
})

describe('compileTsSources keeps the structs and bindings compileTsSource accepts (#74, roadmap 0.5 item 14)', () => {
  const STRUCT = `"use typeshade"

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}

@vertex
export function vs(@location(0) p: vec2): VsOut {
  const o: VsOut = { pos: vec4(p, 0., 1.), uv: p * 0.5 + 0.5 }
  return o
}
`
  const TEXTURE = `"use typeshade"
declare const atlas: texture_2d<f32>
declare const smp: sampler
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  return textureSample(atlas, smp, uv)
}
`
  const STORAGE = `"use typeshade"
declare let heights: storage<array<f32>>
@compute([64, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  heights[gid.x] = 1.
}
`
  const errors = (r: { diagnostics: readonly { category: string; message: string }[] }) =>
    r.diagnostics.filter((d) => d.category === 'error').map((d) => d.message)

  it('compiles the three programs the issue measured, to the WGSL compile() emits', () => {
    // Each compiled clean through compile() and was refused here: TS8022 "does not match a
    // known struct", then "Unknown identifier" for the struct local, the texture and the
    // storage array. The multi-file path lowered functions and constants and collected nothing
    // else.
    for (const source of [STRUCT, TEXTURE, STORAGE]) {
      const multi = compileTsSources([{ fileName: 'x.shade.ts', source }], 'x.shade.ts')
      expect(errors(multi)).toEqual([])
      const single = compile(source)
      expect(errors(single)).toEqual([])
      expect(multi.wgsl).toBe(single.wgsl)
    }
  })

  it('reports the structs, bindings and overrides it collected', () => {
    const r = compileTsSources([{ fileName: 'x.shade.ts', source: TEXTURE }])
    expect(r.bindings.map((b) => [b.name, b.group, b.binding])).toEqual([
      ['atlas', 0, 0],
      ['smp', 0, 1],
    ])
    const s = compileTsSources([{ fileName: 'x.shade.ts', source: STRUCT }])
    expect(s.structs.map((d) => d.name)).toEqual(['VsOut'])
  })

  it('a struct declared in one file is the type a function in another file receives', () => {
    // The struct is module scope, as it is in WGSL: the importing file reads `.uv` off the
    // value the other file's function returned, and the module emits ONE struct.
    const r = compileTsSources(
      [
        {
          fileName: 'types.ts',
          source: `"use typeshade"
class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}
export function make(p: vec2): VsOut {
  const o: VsOut = { pos: vec4(p, 0., 1.), uv: p }
  return o
}
`,
        },
        {
          fileName: 'main.ts',
          source: `"use typeshade"
import { make } from "./types"
@fragment
export function fs(@location(0) p: vec2): vec4 {
  const o = make(p)
  return vec4(o.uv, 0., 1.)
}
`,
        },
      ],
      'main.ts',
    )
    expect(errors(r)).toEqual([])
    expect(r.wgsl).toContain('struct VsOut')
    expect((r.wgsl!.match(/struct VsOut/g) ?? []).length).toBe(1)
    expect(r.wgsl).toContain('let o = make(p);')
  })

  it('numbers the declare bindings of every file in file order, so two firsts do not collide', () => {
    const r = compileTsSources([
      {
        fileName: 'a.ts',
        source: `"use typeshade"
declare const atlas: texture_2d<f32>
declare const smp: sampler
export function tap(uv: vec2): vec4 { return textureSample(atlas, smp, uv) }
`,
      },
      {
        fileName: 'b.ts',
        source: `"use typeshade"
declare const lut: texture_2d<f32>
declare const smp2: sampler
import { tap } from "./a"
@fragment
export function fs(@location(0) uv: vec2): vec4 { return tap(uv) + textureSample(lut, smp2, uv) }
`,
      },
    ])
    expect(errors(r)).toEqual([])
    expect(r.bindings.map((b) => [b.name, b.binding])).toEqual([
      ['atlas', 0],
      ['smp', 1],
      ['lut', 2],
      ['smp2', 3],
    ])
    expect(r.wgsl).toContain('@group(0) @binding(2) var lut: texture_2d<f32>;')
  })

  it('reports a struct two files both declare, once, naming both', () => {
    const cls = `class P {\n  x: f32\n}\n`
    const r = compileTsSources([
      {
        fileName: 'a.ts',
        source: `"use typeshade"\n${cls}export function fa(p: P): f32 { return p.x }\n`,
      },
      {
        fileName: 'b.ts',
        source: `"use typeshade"\n${cls}export function fb(p: P): f32 { return p.x }\n`,
      },
    ])
    const dup = r.diagnostics.filter((d) => d.code === TS_CODES.DUPLICATE_SYMBOL)
    expect(dup.map((d) => d.message)).toEqual([
      'Struct "P" is declared in both "a.ts" and "b.ts". A multi-file program is one module, so a name is declared once; rename one or move it.',
    ])
  })

  it('reports two files whose explicit slots collide, in either spelling', () => {
    const r = compileTsSources([
      {
        fileName: 'a.ts',
        source: `"use typeshade"\nconst gain = uniform<f32>(3)\nexport function ga(): f32 { return gain }\n`,
      },
      {
        fileName: 'b.ts',
        source: `"use typeshade"\nconst bias = uniform<f32>({ group: 0, binding: 3 })\nexport function gb(): f32 { return bias }\n`,
      },
    ])
    const dup = r.diagnostics.filter((d) => d.code === TS_CODES.DUPLICATE_SYMBOL)
    expect(dup.length).toBe(1)
    expect(dup[0]!.message).toContain('both occupy @group(0) @binding(3)')
  })
})

describe('compileTsSources symbols', () => {
  // `symbols` spans are UTF-16 offsets into ONE file, and the result names no source file, so
  // the only thing that makes them readable is the promise that the file is the entry. The
  // caller's spelling of `entry` must not change which file that is.
  const a = {
    fileName: './a.ts',
    source:
      '"use typeshade";\nexport function helper(ha: f32): f32 {\n  const inA = ha;\n  return inA;\n}\n',
  }
  const b = {
    fileName: './b.ts',
    source:
      '"use typeshade";\nimport { helper } from "./a";\nexport function main(mb: f32): f32 {\n  const inB = helper(mb);\n  return inB;\n}\n',
  }

  for (const entry of ['b.ts', './b.ts']) {
    it(`records the entry file's declarations for entry "${entry}"`, () => {
      const r = compileTsSources([a, b], entry)
      expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
      expect(r.symbols.map((s) => `${s.kind}:${s.name}`)).toEqual([
        'function:main',
        'param:mb',
        'local:inB',
      ])
      // Every span indexes the ENTRY file's text, not the other file's.
      for (const s of r.symbols) {
        expect(b.source.slice(s.start, s.start + s.length)).toBe(s.name)
      }
    })
  }

  it('records the first file given when no entry is named', () => {
    const r = compileTsSources([a, b])
    expect(r.symbols.map((s) => s.name)).toEqual(['helper', 'ha', 'inA'])
    for (const s of r.symbols) {
      expect(a.source.slice(s.start, s.start + s.length)).toBe(s.name)
    }
  })
})
