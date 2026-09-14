// === Regression coverage for TypeshadeHost's default resolveImport/multi-file resolution ===
//
// Bug: `joinPath` used to split the whole concatenated `${dir}${specifier}` string on `/` and
// drop every empty segment, which ate a uri authority — `file:///main.ts` + `./lib.ts` produced
// `file:/lib.ts` (two slashes lost) and `/main.ts` + `./lib.ts` produced `lib.ts` (the leading
// slash lost) — so a multi-file import never actually resolved to the uri the adapter opened
// the imported document under, for either shape. A `.js` specifier (the extension this
// repository's own source uses) was also never rewritten to `.ts`.

import { describe, expect, it } from 'vitest'
import { createTypeshadeLanguageService } from './service.js'

describe('default resolveImport / multi-file resolution', () => {
  it('resolves a relative import across two file:///-shaped uris', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument(
      'file:///lib.ts',
      '"use typeshade"\nexport function k(): f32 {\n  return 1.\n}\n',
    )
    service.openDocument(
      'file:///main.ts',
      '"use typeshade"\nimport { k } from "./lib.ts"\nexport function f(): f32 {\n  return k()\n}\n',
    )
    const diagnostics = service.getDiagnostics('file:///main.ts')
    expect(
      diagnostics.filter((d) => d.code === 2307),
      `unexpected "Cannot find module" diagnostics: ${JSON.stringify(diagnostics)}`,
    ).toEqual([])
  })

  it('resolves a relative import across two absolute /-shaped uris', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('/lib.ts', '"use typeshade"\nexport function k(): f32 {\n  return 1.\n}\n')
    service.openDocument(
      '/main.ts',
      '"use typeshade"\nimport { k } from "./lib.ts"\nexport function f(): f32 {\n  return k()\n}\n',
    )
    const diagnostics = service.getDiagnostics('/main.ts')
    expect(diagnostics.filter((d) => d.code === 2307)).toEqual([])
  })

  it("rewrites a .js specifier to .ts, matching how this repository's own source imports", () => {
    const service = createTypeshadeLanguageService()
    service.openDocument(
      'file:///lib.ts',
      '"use typeshade"\nexport function k(): f32 {\n  return 1.\n}\n',
    )
    service.openDocument(
      'file:///main.ts',
      '"use typeshade"\nimport { k } from "./lib.js"\nexport function f(): f32 {\n  return k()\n}\n',
    )
    const diagnostics = service.getDiagnostics('file:///main.ts')
    expect(diagnostics.filter((d) => d.code === 2307)).toEqual([])
  })

  it('resolves a parent-directory import (..) against a nested uri', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument(
      'file:///lib.ts',
      '"use typeshade"\nexport function k(): f32 {\n  return 1.\n}\n',
    )
    service.openDocument(
      'file:///src/main.ts',
      '"use typeshade"\nimport { k } from "../lib.ts"\nexport function f(): f32 {\n  return k()\n}\n',
    )
    const diagnostics = service.getDiagnostics('file:///src/main.ts')
    expect(diagnostics.filter((d) => d.code === 2307)).toEqual([])
  })
})
