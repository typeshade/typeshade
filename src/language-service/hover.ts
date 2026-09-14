// === Hover: TypeScript quick info for user symbols, TypeShade docs for the vocabulary (§5) ===

import ts from 'typescript'
import type { CompileTsSourceResult } from '../compiler/ts/source-file.js'
import type { DeclaredSymbol } from '../compiler/ts/symbols.js'
import type { ShaderType } from '../core/ir/types.js'
import { wgslType } from '../core/backends/wgsl.js'
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
  analysis: CompileTsSourceResult,
  sourceFile: ts.SourceFile,
  uri: string,
  defs: readonly ts.DefinitionInfo[],
  node: ts.Node,
): string | undefined {
  if (!ts.isIdentifier(node)) return undefined
  const binding = analysis.bindings.find((b) => b.name === node.text)
  if (binding === undefined) return undefined
  const decl = topLevelVariableNamed(sourceFile, node.text)
  if (decl === undefined) return undefined
  const declStart = decl.name.getStart(sourceFile)
  if (!defs.some((d) => d.fileName === uri && d.textSpan.start === declStart)) return undefined
  return `${binding.space} resource at @group(${binding.group}) @binding(${binding.binding})`
}

/**
 * How a `ShaderType` is spelled in a hover: the WGSL spelling for everything a backend can
 * write, and the source spelling for the emulated-double types it cannot.
 *
 * `wgslType` alone is not enough. `f64`, `vecN<f64>` and `matNxN<f64>` are PRE-LOWERING types,
 * rewritten into `f32` pairs before any backend spells a type, so `wgslType` deliberately
 * throws SD0040 on them rather than emitting an invalid WGSL type. A hover is not emit: it must
 * name the type the author wrote. Those three arms are spelled here, and the array arm recurses
 * through this function so `array<vec3<f64>, 4>` reaches them; everything else is `wgslType`,
 * so there is exactly one place a GPU type is spelled for the editor.
 */
export function spellShaderType(t: ShaderType): string {
  switch (t.kind) {
    case 'f64':
      return 'f64'
    case 'vec64':
      return `vec${t.n}<f64>`
    case 'mat':
      return t.elem === 'f64' ? `mat${t.n}x${t.n}<f64>` : wgslType(t)
    case 'array':
      return t.size !== undefined
        ? `array<${spellShaderType(t.elem)}, ${t.size}>`
        : `array<${spellShaderType(t.elem)}>`
    default:
      return wgslType(t)
  }
}

/**
 * The symbol the front end declared at the position `defs` resolves to, or `undefined` when
 * TypeScript resolves the identifier to another file (an imported document, the ambient lib) or
 * to something the front end never lowered.
 *
 * The join is the declaration's start offset: a `DeclaredSymbol` spans the declared NAME
 * identifier, which is exactly what `getDefinitionAtPosition` returns for a local, a parameter,
 * a module const, a function, a class or a property. Going through TypeScript's resolution,
 * rather than matching on the name, is what makes a hover at a USE show the same type as a
 * hover at the declaration, and what tells two shadowing declarations of one name apart.
 */
function declaredSymbolAt(
  analysis: CompileTsSourceResult,
  uri: string,
  defs: readonly ts.DefinitionInfo[],
): DeclaredSymbol | undefined {
  for (const def of defs) {
    if (def.fileName !== uri) continue
    const hit = analysis.symbols.find((s) => s.start === def.textSpan.start)
    if (hit !== undefined) return hit
  }
  return undefined
}

/**
 * The first line of the hover for a declaration the front end lowered, in TypeScript's own quick
 * info shapes so an editor renders it the way it renders everything else. `undefined` means keep
 * what TypeScript said: a data class is one, since `class Vertex` already names it and the
 * compiler's `struct:Vertex` would only be noise.
 */
function declarationLine(symbol: DeclaredSymbol): string | undefined {
  const type = spellShaderType(symbol.type)
  switch (symbol.kind) {
    case 'local':
      return `${symbol.mutable === false ? 'const' : 'let'} ${symbol.name}: ${type}`
    case 'param':
      return `(parameter) ${symbol.name}: ${type}`
    // A binding keeps `const name: T`, the shape TypeScript already uses for it: the address
    // space is on the resource line below, so spelling it `uniform<T>` here would say it twice.
    case 'const':
    case 'binding':
      return `const ${symbol.name}: ${type}`
    case 'function': {
      const params = (symbol.params ?? [])
        .map((p) => `${p.name}: ${spellShaderType(p.type)}`)
        .join(', ')
      return `function ${symbol.name}(${params}): ${type}`
    }
    case 'field':
      return `(property) ${symbol.struct}.${symbol.name}: ${type}`
    case 'struct':
      return undefined
  }
}

/**
 * Hover at `offset` in `uri`: a TypeShade documentation sentence for a GPU type name, an
 * attribute, or a builtin string, and otherwise the symbol's type.
 *
 * That type comes from the COMPILER for a name declared in this document, read off
 * `analysis.symbols` (the service's cached front-end run for this document version, §8) through
 * the declaration TypeScript resolves the identifier to. TypeScript's own inference cannot be
 * trusted for it: the ambient GPU scalars brand `number` optionally, so `let x = 1.` infers
 * plain `number` where the front end lowered an `f32`, and `const half = 0.5` infers the literal
 * type `0.5`. Everything else keeps TypeScript's quick info, including a symbol declared in
 * another document, a host-side declaration and the documentation section of every hover. A
 * resource binding also gains one line from `analysis`: its address space and `@group`/
 * `@binding` slot.
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
  // One definition query per hover, shared by the two answers that need it. Only an identifier
  // can resolve to a declaration, so nothing else pays for it.
  const defs = ts.isIdentifier(node)
    ? (languageService.getDefinitionAtPosition(uri, offset) ?? [])
    : []
  const declared = declaredSymbolAt(analysis, uri, defs)
  const display =
    (declared !== undefined ? declarationLine(declared) : undefined) ??
    ts.displayPartsToString(quickInfo.displayParts)
  const documentation = ts.displayPartsToString(quickInfo.documentation)
  const resource = resourceBindingLine(analysis, sourceFile, uri, defs, node)
  const sections = [`\`\`\`ts\n${display}\n\`\`\``]
  if (resource !== undefined) sections.push(resource)
  if (documentation) sections.push(documentation)
  return { contents: sections.join('\n\n'), range: rangeForSpan(sourceFile, quickInfo.textSpan) }
}
