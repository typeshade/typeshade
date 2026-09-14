import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { nodeAtPosition } from './positions.js'

const SOURCE = '"use typeshade";\n// a comment\nexport function f(x: f32): f32 {\n  return x\n}\n'

function parse(text: string): ts.SourceFile {
  return ts.createSourceFile('a.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

describe('nodeAtPosition (the one shared stand-in for ts.getTokenAtPosition)', () => {
  it('finds the innermost node whose own span contains the offset', () => {
    const sourceFile = parse(SOURCE)
    const node = nodeAtPosition(sourceFile, SOURCE.indexOf('return x') + 'return '.length)
    expect(ts.isIdentifier(node)).toBe(true)
    expect((node as ts.Identifier).text).toBe('x')
    expect(ts.isReturnStatement(node.parent)).toBe(true)
  })

  it('anchors a type annotation to its type reference, not the parameter', () => {
    const sourceFile = parse(SOURCE)
    const node = nodeAtPosition(sourceFile, SOURCE.indexOf('f32'))
    expect(ts.isIdentifier(node)).toBe(true)
    expect(ts.isTypeReferenceNode(node.parent)).toBe(true)
  })

  it('returns the enclosing node, never a token, for an offset inside leading trivia', () => {
    const sourceFile = parse(SOURCE)
    const inComment = SOURCE.indexOf('comment')
    const node = nodeAtPosition(sourceFile, inComment)
    // The comment is the function declaration's leading trivia, which `getStart()` excludes, so
    // the innermost node whose own span covers the offset is the file itself.
    expect(node).toBe(sourceFile)
  })

  it('treats the span as half-open: the offset right after a token is outside it', () => {
    const sourceFile = parse(SOURCE)
    const end = SOURCE.indexOf('return x') + 'return x'.length
    const inside = nodeAtPosition(sourceFile, end - 1)
    const after = nodeAtPosition(sourceFile, end)
    expect(ts.isIdentifier(inside)).toBe(true)
    expect(ts.isIdentifier(after)).toBe(false)
  })
})
