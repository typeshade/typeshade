import { describe, expect, it } from 'vitest'
import { TypeshadeLanguageService } from './language-service.js'

describe('TypeshadeLanguageService', () => {
  const service = new TypeshadeLanguageService({ fileName: 'hello.shade.ts' })

  it('returns compiler diagnostics with source spans', () => {
    const diagnostics = service.getDiagnostics('const x = 1;')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.message).toContain('use typeshade')
    // No node backs a missing-directive diagnostic, so its span falls back to the file's
    // first statement — here the whole `const x = 1;` (13 UTF-16 code units).
    expect(diagnostics[0]?.span.start).toBe(0)
    expect(diagnostics[0]?.span.length).toBe('const x = 1;'.length)
  })

  it('reports the missing-directive diagnostic as a zero-based, half-open range', () => {
    const diagnostics = service.getDiagnostics('const x = 1;')
    expect(diagnostics[0]?.range.start).toEqual({ line: 0, character: 0 })
    expect(diagnostics[0]?.range.end.character).toBe('const x = 1;'.length)
  })

  it('completes builtin names inside @builtin strings', () => {
    const source = '"use typeshade";\nclass Clip { @builtin("ver") pos: vec4 }'
    const items = service.getCompletions(source, { line: 1, character: 26 })
    expect(items.map((item) => item.label)).toContain('vertex_index')
  })

  it('completes TypeShade attributes after @', () => {
    const items = service.getCompletions('"use typeshade";\n@ver', { line: 1, character: 4 })
    expect(items.map((item) => item.label)).toContain('@vertex')
  })

  it('provides hover information for GPU types', () => {
    const source = '"use typeshade";\nconst value: vec4 = vec4(0., 0., 0., 1.)'
    const hover = service.getHover(source, { line: 1, character: 14 })
    expect(hover?.contents[0]).toContain('four-component')
    expect(hover?.span.length).toBe(4)
  })

  it('exposes the hover range mapping back to the same word as the span', () => {
    const source = '"use typeshade";\nconst value: vec4 = vec4(0., 0., 0., 1.)'
    const hover = service.getHover(source, { line: 1, character: 14 })
    expect(hover?.range).toEqual({
      start: { line: 1, character: 13 },
      end: { line: 1, character: 17 },
    })
    expect(source.split('\n')[1]?.slice(13, 17)).toBe('vec4')
  })

  it('provides hover information on a CRLF source at the same zero-based position as LF', () => {
    const source = '"use typeshade";\r\nconst value: vec4 = vec4(0., 0., 0., 1.)'
    const hover = service.getHover(source, { line: 1, character: 14 })
    expect(hover?.contents[0]).toContain('four-component')
    expect(source.slice(hover!.span.start, hover!.span.start + hover!.span.length)).toBe('vec4')
    expect(hover?.range).toEqual({
      start: { line: 1, character: 13 },
      end: { line: 1, character: 17 },
    })
  })

  it('converts offsets to zero-based editor positions', () => {
    const source = '"use typeshade";\nconst value = 1'
    expect(service.getPosition(source, source.length)).toEqual({ line: 1, character: 15 })
  })

  it('round-trips getOffset and getPosition', () => {
    const source = '"use typeshade";\nconst value: vec4 = vec4(0., 0., 0., 1.)'
    const position = { line: 1, character: 14 }
    const offset = service.getOffset(source, position)
    expect(service.getPosition(source, offset)).toEqual(position)
    expect(service.getOffset(source, service.getPosition(source, offset))).toBe(offset)
  })

  it('clamps a position past the end of the source instead of throwing', () => {
    const source = '"use typeshade";\nconst value = 1'
    expect(() => service.getOffset(source, { line: 99, character: 99 })).not.toThrow()
    expect(service.getOffset(source, { line: 99, character: 99 })).toBe(source.length)
  })
})
