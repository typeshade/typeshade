// === Hover: TypeScript quick info for user symbols, TypeShade docs for the vocabulary (§5) ===

import ts from 'typescript'
import { ATTRIBUTE_NAMES, WGSL_BUILTIN_NAMES } from './ambient.js'
import { ATTRIBUTE_DOCS, BUILTIN_DOCS, TYPE_DOCS } from './docs.js'
import { rangeForSpan, wordSpan } from './positions.js'
import type { TypeshadeHover } from './types.js'

function nodeAtPosition(root: ts.Node, pos: number): ts.Node {
  let found: ts.Node = root
  const visit = (node: ts.Node): void => {
    if (pos >= node.getStart() && pos < node.getEnd()) {
      found = node
      node.forEachChild(visit)
    }
  }
  visit(root)
  return found
}

function isBuiltinStringLiteral(node: ts.Node): node is ts.StringLiteralLike {
  if (!ts.isStringLiteralLike(node)) return false
  const call = node.parent
  return (
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === 'builtin' &&
    call.arguments[0] === node
  )
}

function isAttributeName(node: ts.Node): node is ts.Identifier {
  if (!ts.isIdentifier(node)) return false
  const parent = node.parent
  // `@vertex` (a bare decorator) or `@builtin(...)`/`@location(...)` (a decorator factory call).
  if (ts.isDecorator(parent) && parent.expression === node) return true
  return ts.isCallExpression(parent) && parent.expression === node && ts.isDecorator(parent.parent)
}

function isTypeName(node: ts.Node): node is ts.Identifier {
  return (
    ts.isIdentifier(node) && ts.isTypeReferenceNode(node.parent) && node.parent.typeName === node
  )
}

/**
 * Hover at `offset` in `uri`: a TypeShade documentation sentence for a GPU type name, an
 * attribute, or a builtin string, and otherwise TypeScript's own quick info for the symbol —
 * which, for a value typed as one of the ambient GPU types, already names the alias (`f32`,
 * `vec4`, ...) rather than expanding its branded structure, since `typeToString` prints a named
 * type alias by its name whenever one applies.
 */
export function getHover(
  languageService: ts.LanguageService,
  sourceFile: ts.SourceFile,
  uri: string,
  offset: number,
): TypeshadeHover | undefined {
  const node = nodeAtPosition(sourceFile, offset)

  if (isBuiltinStringLiteral(node) && WGSL_BUILTIN_NAMES.includes(node.text)) {
    const doc = BUILTIN_DOCS[node.text]
    if (doc) {
      const span = { start: node.getStart() + 1, length: node.text.length }
      return { contents: `\`${node.text}\` — ${doc}`, range: rangeForSpan(sourceFile, span) }
    }
  }

  if (isAttributeName(node) && ATTRIBUTE_NAMES.includes(node.text)) {
    const doc = ATTRIBUTE_DOCS[node.text]
    if (doc) {
      const span = { start: node.getStart(), length: node.getWidth() }
      return { contents: `\`@${node.text}\` — ${doc}`, range: rangeForSpan(sourceFile, span) }
    }
  }

  if (isTypeName(node) && TYPE_DOCS[node.text]) {
    const span = { start: node.getStart(), length: node.getWidth() }
    return {
      contents: `\`${node.text}\` — ${TYPE_DOCS[node.text]}`,
      range: rangeForSpan(sourceFile, span),
    }
  }

  const wSpan = wordSpan(sourceFile.text, offset)
  const word = sourceFile.text.slice(wSpan.start, wSpan.start + wSpan.length)
  if (TYPE_DOCS[word] !== undefined && !ts.isIdentifier(node)) {
    return { contents: `\`${word}\` — ${TYPE_DOCS[word]}`, range: rangeForSpan(sourceFile, wSpan) }
  }

  const quickInfo = languageService.getQuickInfoAtPosition(uri, offset)
  if (!quickInfo) return undefined
  const display = ts.displayPartsToString(quickInfo.displayParts)
  const documentation = ts.displayPartsToString(quickInfo.documentation)
  const contents = documentation
    ? `\`\`\`ts\n${display}\n\`\`\`\n\n${documentation}`
    : `\`\`\`ts\n${display}\n\`\`\``
  return { contents, range: rangeForSpan(sourceFile, quickInfo.textSpan) }
}
