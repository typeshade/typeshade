import { describe, expect, it } from 'vitest'
import { TypeshadeLanguageService } from './language-service.js'

describe('TypeshadeLanguageService', () => {
  const service = new TypeshadeLanguageService({ fileName: 'hello.shade.ts' })

  it('returns compiler diagnostics with source spans', () => {
    const diagnostics = service.getDiagnostics('const x = 1;')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.message).toContain('use typeshade')
    expect(diagnostics[0]?.start).toBe(0)
    expect(diagnostics[0]?.length).toBe(1)
  })

  it('completes builtin names inside @builtin strings', () => {
    const source = '"use typeshade";\nclass Clip { @builtin("ver") pos: vec4 }'
    const items = service.getCompletions(source, { line: 2, character: 29 })
    expect(items.map((item) => item.label)).toContain('vertex_index')
  })

  it('completes TypeShade attributes after @', () => {
    const items = service.getCompletions('"use typeshade";\n@ver', { line: 2, character: 5 })
    expect(items.map((item) => item.label)).toContain('@vertex')
  })

  it('provides hover information for GPU types', () => {
    const source = '"use typeshade";\nconst value: vec4 = vec4(0., 0., 0., 1.)'
    const hover = service.getHover(source, { line: 2, character: 15 })
    expect(hover?.contents[0]).toContain('four-component')
    expect(hover?.span.length).toBe(4)
  })

  it('converts offsets to one-based editor positions', () => {
    const source = '"use typeshade";\nconst value = 1'
    expect(service.getPosition(source, source.length)).toEqual({ line: 2, character: 16 })
  })
})
