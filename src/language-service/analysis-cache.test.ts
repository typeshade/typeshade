// === One front-end analysis per document version, shared by every reader (design doc §8) ===
//
// Before this cache, getDiagnostics, getDocumentSymbols and getSemanticTokens each ran
// compileTsSource themselves, so one editor refresh lowered the same unchanged document three
// times. The count here goes through `createTypeshadeLanguageServiceWith`, which takes the
// analysis function as a parameter, so no module namespace is mocked.

import { describe, expect, it } from 'vitest'
import type ts from 'typescript'
import {
  analyzeSourceFile,
  createTypeshadeLanguageService,
  createTypeshadeLanguageServiceWith,
} from './service.js'

const WITH_RESOURCE =
  '"use typeshade";\n' +
  'class Camera {\n' +
  '  position: vec4\n' +
  '}\n' +
  'declare const camera: uniform<Camera>\n' +
  '@fragment\n' +
  'export function fs(): vec4 {\n' +
  '  return camera.position\n' +
  '}\n'

// The same document with the resource binding turned into a plain module constant (a module
// const must be a foldable scalar, so a vec4 initializer would be a TypeShade error).
const WITHOUT_RESOURCE = WITH_RESOURCE.replace(
  'declare const camera: uniform<Camera>',
  'const camera = 2.',
).replace('return camera.position', 'return vec4(camera, 0., 0., 1.)')

function counting(): {
  analyze: (sf: ts.SourceFile) => ReturnType<typeof analyzeSourceFile>
  runs: () => number
} {
  let n = 0
  return {
    analyze: (sf) => {
      n++
      return analyzeSourceFile(sf)
    },
    runs: () => n,
  }
}

describe('the cached front-end analysis', () => {
  it('runs the front end once per document version across diagnostics, symbols, tokens, hover and output', () => {
    const counter = counting()
    const service = createTypeshadeLanguageServiceWith({}, counter.analyze)
    service.openDocument('a.ts', WITH_RESOURCE, 1)
    expect(counter.runs()).toBe(0)

    service.getDiagnostics('a.ts')
    service.getDocumentSymbols('a.ts')
    service.getSemanticTokens('a.ts')
    service.getHover('a.ts', service.positionAt('a.ts', WITH_RESOURCE.lastIndexOf('camera')))
    service.getCompiledOutput('a.ts', 'wgsl')
    service.getDiagnostics('a.ts')
    service.getDocumentSymbols('a.ts')
    expect(counter.runs()).toBe(1)

    service.updateDocument('a.ts', WITHOUT_RESOURCE, 2)
    service.getSemanticTokens('a.ts')
    service.getDiagnostics('a.ts')
    service.getDocumentSymbols('a.ts')
    expect(counter.runs()).toBe(2)
  })

  it('does not run the front end again for a same-version request', () => {
    const counter = counting()
    const service = createTypeshadeLanguageServiceWith({}, counter.analyze)
    service.openDocument('a.ts', WITH_RESOURCE)
    for (let i = 0; i < 3; i++) {
      service.getDiagnostics('a.ts')
      service.getSemanticTokens('a.ts')
      service.getDocumentSymbols('a.ts')
    }
    expect(counter.runs()).toBe(1)
  })

  it('keeps diagnostics, symbols and semantic tokens in agreement, and refreshes all three on a version bump', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', WITH_RESOURCE, 1)
    const tokenAtUse = (text: string) => {
      const pos = service.positionAt('a.ts', text.lastIndexOf('camera'))
      return service
        .getSemanticTokens('a.ts')
        .find((t) => t.line === pos.line && t.character === pos.character)
    }

    expect(service.getDiagnostics('a.ts')).toEqual([])
    expect(service.getDocumentSymbols('a.ts').find((s) => s.name === 'camera')?.kind).toBe(
      'resource',
    )
    expect(tokenAtUse(WITH_RESOURCE)?.type).toBe('resource')

    service.updateDocument('a.ts', WITHOUT_RESOURCE, 2)
    expect(service.getDiagnostics('a.ts')).toEqual([])
    expect(service.getDocumentSymbols('a.ts').find((s) => s.name === 'camera')?.kind).toBe(
      'constant',
    )
    expect(tokenAtUse(WITHOUT_RESOURCE)?.type).not.toBe('resource')
  })

  it('shares the import-aware key with diagnostics: a changed import refreshes the analysis too', () => {
    const counter = counting()
    const service = createTypeshadeLanguageServiceWith({}, counter.analyze)
    service.openDocument(
      '/b.ts',
      '"use typeshade";\nexport function k(): f32 {\n  return 1.\n}\n',
      1,
    )
    service.openDocument(
      '/a.ts',
      '"use typeshade";\nimport { k } from "./b.js"\nexport function f(): f32 {\n  return k()\n}\n',
      1,
    )
    service.getDocumentSymbols('/a.ts')
    service.getDocumentSymbols('/b.ts')
    expect(counter.runs()).toBe(2)
    service.updateDocument(
      '/b.ts',
      '"use typeshade";\nexport function k(): f32 {\n  return 2.\n}\n',
      2,
    )
    service.getDocumentSymbols('/a.ts')
    expect(counter.runs()).toBe(3)
  })
})

// Regression: getDocumentSymbols, getSemanticTokens and getHover answer for any file the
// program holds, so a request for a file pulled in only through readDocument created a cache
// entry under its uri, and closeDocument, which is never called for such a uri, never dropped
// it: the entry lived for the service's lifetime.
describe('cache entries of files that are not open documents', () => {
  it('are dropped when a document closes', () => {
    const B = '"use typeshade";\nexport function k(): f32 {\n  return 1.\n}\n'
    const A =
      '"use typeshade";\nimport { k } from "./b.js"\nexport function f(): f32 {\n  return k()\n}\n'
    const counter = counting()
    const service = createTypeshadeLanguageServiceWith(
      { readDocument: (uri) => (uri === '/b.ts' ? B : undefined) },
      counter.analyze,
    )
    service.openDocument('/a.ts', A, 1)
    service.getDiagnostics('/a.ts')
    expect(service.getDocumentSymbols('/b.ts').map((s) => s.name)).toEqual(['k'])
    expect(counter.runs()).toBe(2)
    service.getDocumentSymbols('/b.ts')
    expect(counter.runs()).toBe(2)

    // Closing A and reopening it leaves B's text and revision as they were, so a surviving
    // entry for B would still match its key: a third run proves the entry was dropped.
    service.closeDocument('/a.ts')
    service.openDocument('/a.ts', A, 2)
    service.getDocumentSymbols('/b.ts')
    expect(counter.runs()).toBe(3)
  })
})
