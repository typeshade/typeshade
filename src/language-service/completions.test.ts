import { describe, expect, it } from 'vitest'
import { createTypeshadeLanguageService } from './service.js'

describe('getCompletions: TypeShade context items', () => {
  it('offers the attribute list right after @', () => {
    const service = createTypeshadeLanguageService()
    const source = '"use typeshade";\n@ver'
    service.openDocument('a.ts', source)
    const items = service.getCompletions('a.ts', { line: 1, character: 4 })
    expect(items.map((i) => i.label)).toContain('@vertex')
    expect(items.every((i) => i.kind === 'attribute')).toBe(true)
  })

  it('offers WgslBuiltinName entries inside @builtin("', () => {
    const service = createTypeshadeLanguageService()
    const source = '"use typeshade";\nclass Clip {\n  @builtin("ver") pos: vec4\n}\n'
    service.openDocument('b.ts', source)
    const offset = source.indexOf('"ver') + 4
    const position = service.positionAt('b.ts', offset)
    const items = service.getCompletions('b.ts', position)
    expect(items.map((i) => i.label)).toContain('vertex_index')
    expect(items.every((i) => i.kind === 'builtin')).toBe(true)
  })

  it('filters @builtin(" completions to the enclosing function\'s stage', () => {
    const service = createTypeshadeLanguageService()
    const source =
      '"use typeshade";\n@fragment\nexport function fs(@builtin("") x: u32): f32 {\n  return x\n}\n'
    service.openDocument('c.ts', source)
    const offset = source.indexOf('@builtin("') + '@builtin("'.length
    const position = service.positionAt('c.ts', offset)
    const items = service.getCompletions('c.ts', position)
    const labels = items.map((i) => i.label)
    expect(labels).toContain('position')
    expect(labels).not.toContain('vertex_index')
  })

  it('offers vec2/vec3/vec4 as snippet completions', () => {
    const service = createTypeshadeLanguageService()
    const source = '"use typeshade";\nexport function f(): vec4 {\n  return vec\n}\n'
    service.openDocument('d.ts', source)
    const offset = source.lastIndexOf('vec') + 3
    const position = service.positionAt('d.ts', offset)
    const items = service.getCompletions('d.ts', position)
    const vec4Item = items.find((i) => i.label === 'vec4')
    expect(vec4Item?.kind).toBe('snippet')
    expect(vec4Item?.insertTextFormat).toBe('snippet')
    expect(vec4Item?.insertText).toContain('vec4(')
  })

  it('dedupes completion items by label', () => {
    const service = createTypeshadeLanguageService()
    const source =
      '"use typeshade";\nexport function f(): vec4 {\n  return vec4(0., 0., 0., 1.)\n}\n'
    service.openDocument('e.ts', source)
    const offset = source.indexOf('return vec4')
    const position = service.positionAt('e.ts', offset)
    const items = service.getCompletions('e.ts', position)
    const labels = items.map((i) => i.label)
    expect(new Set(labels).size).toBe(labels.length)
  })
})

type Service = ReturnType<typeof createTypeshadeLanguageService>

function completionsAt(service: Service, uri: string, source: string, cursor: string) {
  const offset = source.indexOf(cursor) + cursor.length
  expect(offset, `cursor text ${JSON.stringify(cursor)} not found`).toBeGreaterThan(
    cursor.length - 1,
  )
  return service.getCompletions(uri, service.positionAt(uri, offset))
}

const typeshadeSpecific = (items: readonly { kind: string }[]) =>
  items.filter((i) => i.kind === 'attribute' || i.kind === 'builtin' || i.kind === 'snippet')

// Regression: the attribute, builtin-id and vec-snippet triggers were regexes over the raw
// text before the cursor, so they fired inside comments and string literals alike, and the
// vec snippets were merged into every completion list, type positions included.
describe('getCompletions: context is decided by the syntax tree, not the raw text', () => {
  it('offers nothing TypeShade-specific inside a line comment ending in @', () => {
    const service = createTypeshadeLanguageService()
    const source = '"use typeshade";\n// see @ver\nexport function f(): f32 {\n  return 1\n}\n'
    service.openDocument('c1.ts', source)
    expect(typeshadeSpecific(completionsAt(service, 'c1.ts', source, '// see @ver'))).toEqual([])
  })

  it('offers nothing TypeShade-specific inside a trailing comment on a code line', () => {
    const service = createTypeshadeLanguageService()
    const source = '"use typeshade";\nconst a = 1 // vec\nconst b = 2\n'
    service.openDocument('c2.ts', source)
    expect(typeshadeSpecific(completionsAt(service, 'c2.ts', source, '// vec'))).toEqual([])
  })

  it('offers nothing TypeShade-specific inside a block comment, @builtin(" included', () => {
    const service = createTypeshadeLanguageService()
    const source = '"use typeshade";\n/* @builtin("ver */\nconst a = 1\n'
    service.openDocument('c3.ts', source)
    expect(typeshadeSpecific(completionsAt(service, 'c3.ts', source, '@builtin("ver'))).toEqual([])
  })

  it('offers nothing TypeShade-specific in a comment that closes the file', () => {
    const service = createTypeshadeLanguageService()
    const source = '"use typeshade";\nconst a = 1\n// @'
    service.openDocument('c4.ts', source)
    expect(typeshadeSpecific(completionsAt(service, 'c4.ts', source, '// @'))).toEqual([])
  })

  it('offers nothing at all inside an ordinary string literal', () => {
    const service = createTypeshadeLanguageService()
    const source = '"use typeshade";\nconst a = "vec"\nconst b = "@ver"\n'
    service.openDocument('s1.ts', source)
    expect(completionsAt(service, 's1.ts', source, '"vec')).toEqual([])
    expect(completionsAt(service, 's1.ts', source, '"@ver')).toEqual([])
  })

  it('offers nothing inside a regular expression literal either', () => {
    const service = createTypeshadeLanguageService()
    const source = '"use typeshade";\nconst r = /vec/\nconst b = builtin(/ver/)\n'
    service.openDocument('s4.ts', source)
    expect(completionsAt(service, 's4.ts', source, '/vec')).toEqual([])
    expect(completionsAt(service, 's4.ts', source, '/ver')).toEqual([])
  })

  it('offers nothing inside a template literal either', () => {
    const service = createTypeshadeLanguageService()
    const source = '"use typeshade";\nconst a = `vec`\n'
    service.openDocument('s2.ts', source)
    expect(completionsAt(service, 's2.ts', source, '`vec')).toEqual([])
  })

  it('still offers builtin ids inside an unterminated @builtin(" while it is being typed', () => {
    const service = createTypeshadeLanguageService()
    const source = '"use typeshade";\nclass Clip {\n  @builtin("ver\n  pos: vec4\n}\n'
    service.openDocument('s3.ts', source)
    const items = completionsAt(service, 's3.ts', source, '@builtin("ver')
    expect(items.map((i) => i.label)).toContain('vertex_index')
    expect(items.every((i) => i.kind === 'builtin')).toBe(true)
  })

  it('does not offer vec snippets in a type position', () => {
    const service = createTypeshadeLanguageService()
    const source =
      '"use typeshade";\n' +
      'class Clip {\n  pos: vec\n}\n' +
      'let x: vec\n' +
      'export function f(): vec {\n  return vec4(0., 0., 0., 1.)\n}\n'
    service.openDocument('t1.ts', source)
    for (const cursor of ['pos: vec', 'let x: vec', 'f(): vec']) {
      const items = completionsAt(service, 't1.ts', source, cursor)
      expect(
        items.filter((i) => i.kind === 'snippet'),
        cursor,
      ).toEqual([])
    }
  })

  it('does not offer vec snippets inside type arguments', () => {
    const service = createTypeshadeLanguageService()
    const source = '"use typeshade";\ndeclare const camera: uniform<vec>\n'
    service.openDocument('t2.ts', source)
    expect(
      completionsAt(service, 't2.ts', source, 'uniform<vec').filter((i) => i.kind === 'snippet'),
    ).toEqual([])
  })

  it('does not offer vec snippets right after @, only attributes', () => {
    const service = createTypeshadeLanguageService()
    const source = '"use typeshade";\n@\nexport function f(): f32 {\n  return 1\n}\n'
    service.openDocument('t3.ts', source)
    const items = completionsAt(service, 't3.ts', source, '"use typeshade";\n@')
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((i) => i.kind === 'attribute')).toBe(true)
  })

  it('does not offer vec snippets for a declaration name or a property access member', () => {
    const service = createTypeshadeLanguageService()
    const source =
      '"use typeshade";\nconst vec = 1.\nexport function f(a: vec4): f32 {\n  return a.vec\n}\n'
    service.openDocument('t4.ts', source)
    for (const cursor of ['const vec', 'a.vec']) {
      const items = completionsAt(service, 't4.ts', source, cursor)
      expect(
        items.filter((i) => i.kind === 'snippet'),
        cursor,
      ).toEqual([])
    }
  })

  it('offers vec snippets where a value expression starts: after return, in an initializer, in an argument', () => {
    const service = createTypeshadeLanguageService()
    const source =
      '"use typeshade";\n' +
      'export function f(): vec4 {\n' +
      '  const a = vec\n' +
      '  const b = dot(vec\n' +
      '  return \n' +
      '}\n'
    service.openDocument('e1.ts', source)
    for (const cursor of ['const a = vec', 'dot(vec', 'return ']) {
      const items = completionsAt(service, 'e1.ts', source, cursor)
      expect(items.find((i) => i.label === 'vec4')?.kind, cursor).toBe('snippet')
    }
  })
})

// Regression: the comment check only looked at the leading trivia of the slot the cursor
// resolved to, so a comment with no following sibling (after the last statement of a body, on
// the line of the last return, in an empty argument list or block, before a closing bracket or
// semicolon) resolved to the enclosing node, whose start is before the cursor, and was
// classified as code: the editor popped the vec list inside the comment.
describe('getCompletions: a comment anywhere in the trivia before the cursor', () => {
  const cases: readonly [name: string, source: string, cursor: string][] = [
    [
      'after the last statement of a body',
      '"use typeshade";\nexport function vs(): vec4 {\n  let x = -0.8\n  return vec4(x, 0., 0., 1.)\n  // TODO vec\n}\n',
      '// TODO vec',
    ],
    [
      'on the line of the last return',
      '"use typeshade";\nexport function f(): f32 {\n  return 1 // vec\n}\n',
      '// vec',
    ],
    [
      'in an empty if body',
      '"use typeshade";\nexport function f(i: i32): f32 {\n  if (i === 1) {\n    // @ver\n  }\n  return 1\n}\n',
      '// @ver',
    ],
    ['in an empty argument list', '"use typeshade";\nconst d = dot(/* vec */)\n', '/* vec'],
    ['between two arguments', '"use typeshade";\nconst d = dot(a /* vec */, b)\n', '/* vec'],
    ['in an empty object literal', '"use typeshade";\nconst o = { /* vec */ }\n', '/* vec'],
    ['in an empty array literal', '"use typeshade";\nconst a = [/* vec */]\n', '/* vec'],
    ['in an empty parameter list', '"use typeshade";\nfunction f(/* @ */) {}\n', '/* @'],
    [
      'as the whole body of a function',
      '"use typeshade";\nfunction f(): void {\n  /* vec */\n}\n',
      '/* vec',
    ],
    [
      'before a closing paren, @builtin(" included',
      '"use typeshade";\nconst a = abs(1, /* @builtin("ver */)\n',
      '/* @builtin("ver',
    ],
    ['before a semicolon', '"use typeshade";\nconst a = 1 /* vec */;\n', '/* vec'],
    [
      'in a JSDoc comment on a plain function',
      '"use typeshade";\n/**\n * @param vec\n */\nfunction f(): f32 {\n  return 1\n}\n',
      '@param vec',
    ],
  ]
  for (const [name, source, cursor] of cases) {
    it(`offers nothing TypeShade-specific in a comment ${name}`, () => {
      const service = createTypeshadeLanguageService()
      service.openDocument('cm.ts', source)
      expect(typeshadeSpecific(completionsAt(service, 'cm.ts', source, cursor))).toEqual([])
    })
  }

  it('still offers completions in the code right after a closed block comment', () => {
    const service = createTypeshadeLanguageService()
    const source = '"use typeshade";\nexport function f(): vec4 {\n  return /* c */ \n}\n'
    service.openDocument('cm2.ts', source)
    const items = completionsAt(service, 'cm2.ts', source, '/* c */ ')
    expect(items.find((i) => i.label === 'vec4')?.kind).toBe('snippet')
  })
})
