import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTypeshadeLanguageService } from './service.js'
import { compileTsSource } from '../compiler/ts/source-file.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const HELLO = readFileSync(join(HERE, '..', '..', 'examples', 'hello.shade.ts'), 'utf8')

describe('document lifecycle', () => {
  it('returns no diagnostics for a document that was never opened', () => {
    const service = createTypeshadeLanguageService()
    expect(service.getDiagnostics('never-opened.ts')).toEqual([])
  })

  it('opens, updates and closes a document, tracking versions so a stale request never hits new text', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', '"use typeshade";\nconst x = 1', 1)
    const firstDiagnostics = service.getDiagnostics('a.ts')
    service.updateDocument('a.ts', '"use typeshade";\nconst x = 1', 2)
    const secondDiagnostics = service.getDiagnostics('a.ts')
    expect(firstDiagnostics).toEqual(secondDiagnostics)
    service.closeDocument('a.ts')
    expect(service.getDiagnostics('a.ts')).toEqual([])
  })

  it('reflects an update when the adapter does not track versions itself', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('b.ts', '"use typeshade";\nexport function f(): f32 {\n  return 1\n}')
    expect(
      service
        .getDiagnostics('b.ts')
        .some((d) => d.source === 'typeshade' && d.severity === 'error'),
    ).toBe(false)
    service.updateDocument('b.ts', '"use typeshade";\nexport function f(): f32 {\n  return true\n}')
    expect(
      service
        .getDiagnostics('b.ts')
        .some((d) => d.source === 'typeshade' && d.severity === 'error'),
    ).toBe(true)
  })
})

describe('getDiagnostics: a broken program', () => {
  it('reports a real TypeScript diagnostic and a real TypeShade diagnostic, both with correct ranges', () => {
    const service = createTypeshadeLanguageService()
    // Line 2 (0-based): a genuine TS type error (assigning a string where f32 is annotated).
    // Line 3 (0-based): a genuine TypeShade error (vec4(...) given only 2 of its 4 components).
    const text =
      '"use typeshade";\n' +
      'export function f(): vec4 {\n' +
      '  let bad: f32 = "nope"\n' +
      '  return vec4(1., 2.)\n' +
      '}\n'
    service.openDocument('broken.ts', text)
    const diagnostics = service.getDiagnostics('broken.ts')

    const tsDiag = diagnostics.find(
      (d) => d.source === 'typescript' && d.message.includes('not assignable'),
    )
    expect(tsDiag, 'expected a "not assignable" TypeScript diagnostic').toBeDefined()
    expect(tsDiag!.severity).toBe('error')
    expect(tsDiag!.range.start.line).toBe(2)
    expect(tsDiag!.span.length).toBeGreaterThan(0)

    const shadeDiag = diagnostics.find((d) => d.source === 'typeshade' && d.code === 'TS8019')
    expect(shadeDiag, 'expected the vector-arity TypeShade diagnostic').toBeDefined()
    expect(shadeDiag!.severity).toBe('error')
    expect(shadeDiag!.message).toContain('component count mismatch')
    expect(shadeDiag!.range.start.line).toBe(3)
  })

  it('never reports TS1206 for @vertex/@fragment/@builtin/@location on the entry grammar', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('hello.ts', HELLO)
    const ts1206 = service
      .getDiagnostics('hello.ts')
      .filter((d) => d.source === 'typescript' && d.code === 1206)
    expect(ts1206).toEqual([])
  })
})

describe('getCompiledOutput', () => {
  it('returns the same WGSL as compileTsSource for a clean program', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('hello.ts', HELLO)
    const output = service.getCompiledOutput('hello.ts', 'wgsl')
    const direct = compileTsSource(HELLO, { fileName: 'hello.ts' })
    expect(output).toBeDefined()
    expect(output!.diagnostics).toEqual([])
    expect(output!.text).toBe(direct.wgsl)
    expect(output!.text.length).toBeGreaterThan(0)
  })

  it('returns undefined for a document that was never opened', () => {
    const service = createTypeshadeLanguageService()
    expect(service.getCompiledOutput('nope.ts', 'wgsl')).toBeUndefined()
  })

  it('produces GLSL fragment output distinct from the WGSL text', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('hello.ts', HELLO)
    const glsl = service.getCompiledOutput('hello.ts', 'glsl-fragment')
    expect(glsl).toBeDefined()
    expect(glsl!.diagnostics).toEqual([])
    expect(glsl!.text).toContain('void main')
  })
})

describe('positionAt / offsetAt', () => {
  it('round-trips on an open document', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('rt.ts', HELLO)
    const offset = 40
    const position = service.positionAt('rt.ts', offset)
    expect(service.offsetAt('rt.ts', position)).toBe(offset)
  })

  it('handles a CRLF document at the same zero-based position as LF', () => {
    const service = createTypeshadeLanguageService()
    const crlf = '"use typeshade";\r\nexport function f(): f32 {\r\n  return 1\r\n}\r\n'
    service.openDocument('crlf.ts', crlf)
    const position = service.positionAt('crlf.ts', crlf.indexOf('f32'))
    expect(position.line).toBe(1)
    const back = service.offsetAt('crlf.ts', position)
    expect(crlf.slice(back, back + 3)).toBe('f32')
  })

  it('produces clean diagnostics on a CRLF document', () => {
    const service = createTypeshadeLanguageService()
    const crlf = HELLO.replace(/\n/g, '\r\n')
    service.openDocument('crlf-hello.ts', crlf)
    expect(service.getDiagnostics('crlf-hello.ts')).toEqual([])
  })
})
