// === Hover: TypeScript quick info for user symbols, TypeShade docs for the vocabulary (§5) ===

import ts from 'typescript'
import type { CompileTsSourceResult } from '../compiler/ts/source-file.js'
import { ATTRIBUTE_NAMES, WGSL_BUILTIN_NAMES } from './ambient.js'
import { ATTRIBUTE_DOCS, BUILTIN_DOCS, TYPE_DOCS } from './docs.js'
import { nodeAtPosition, rangeForSpan, wordSpan } from './positions.js'
import type { TypeshadeHover } from './types.js'

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

/** The top-level variable declaration named `name` in `sourceFile`, if there is one. */
function topLevelVariableNamed(
  sourceFile: ts.SourceFile,
  name: string,
): ts.VariableDeclaration | undefined {
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === name) return decl
    }
  }
  return undefined
}

/**
 * For an identifier that refers to one of the front end's collected resource bindings
 * (`analysis.bindings`: `uniform<T>(...)`, `storage<T>(...)` and the rest), the TypeShade line
 * the hover adds under TypeScript's quick info: the address space and the `@group`/`@binding`
 * slot the emitted WGSL declares it at, which the TypeScript type (`Camera`) says nothing
 * about. The name alone is not enough, since a local could shadow the binding, so the
 * identifier must resolve, per TypeScript, to the top-level declaration of that name.
 */
function resourceBindingLine(
  languageService: ts.LanguageService,
  analysis: CompileTsSourceResult,
  sourceFile: ts.SourceFile,
  uri: string,
  offset: number,
  node: ts.Node,
): string | undefined {
  if (!ts.isIdentifier(node)) return undefined
  const binding = analysis.bindings.find((b) => b.name === node.text)
  if (binding === undefined) return undefined
  const decl = topLevelVariableNamed(sourceFile, node.text)
  if (decl === undefined) return undefined
  const defs = languageService.getDefinitionAtPosition(uri, offset) ?? []
  const declStart = decl.name.getStart(sourceFile)
  if (!defs.some((d) => d.fileName === uri && d.textSpan.start === declStart)) return undefined
  return `${binding.space} resource at @group(${binding.group}) @binding(${binding.binding})`
}

/**
 * Hover at `offset` in `uri`: a TypeShade documentation sentence for a GPU type name, an
 * attribute, or a builtin string, and otherwise TypeScript's own quick info for the symbol —
 * which, for a value typed as one of the ambient GPU types, already names the alias (`f32`,
 * `vec4`, ...) rather than expanding its branded structure, since `typeToString` prints a named
 * type alias by its name whenever one applies. A resource binding's quick info gains one line
 * from `analysis` (the service's cached front-end run for this document version, §8): its
 * address space and `@group`/`@binding` slot.
 */
export function getHover(
  languageService: ts.LanguageService,
  sourceFile: ts.SourceFile,
  uri: string,
  offset: number,
  analysis: CompileTsSourceResult,
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
  const resource = resourceBindingLine(languageService, analysis, sourceFile, uri, offset, node)
  const sections = [`\`\`\`ts\n${display}\n\`\`\``]
  if (resource !== undefined) sections.push(resource)
  if (documentation) sections.push(documentation)
  return { contents: sections.join('\n\n'), range: rangeForSpan(sourceFile, quickInfo.textSpan) }
}
