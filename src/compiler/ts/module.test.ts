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
        source: `"use typeshade";\nlet loose = 1;\nexport function g(x: f32): f32 { return x; }`,
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
