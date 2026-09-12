import ts from 'typescript'
import type { Expr } from '../../../core/ir/nodes.js'
import { f32T, i32T, structT, typeKey } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { LoweringScope } from '../context.js'
import { resolveMathConst, resolveMathExpand, resolveMathFn } from '../math-alias.js'
import { parseSwizzle } from '../swizzle.js'
import { numericMismatch } from '../numeric.js'
import { lowerExpression } from './expression.js'

const JS_ARRAY_METHODS = new Set([
  'map',
  'filter',
  'reduce',
  'forEach',
  'find',
  'some',
  'every',
  'flat',
  'flatMap',
  'slice',
  'concat',
  'includes',
  'indexOf',
  'join',
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
])

export { JS_ARRAY_METHODS }

export function lowerPropertyAccess(
  node: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const obj = node.expression
  const prop = node.name.text
  if (ts.isIdentifier(obj) && obj.text === 'Math') {
    const value = resolveMathConst(prop)
    if (value !== undefined) return { op: 'lit', type: f32T, value }
    if (resolveMathFn(prop) || resolveMathExpand(prop)) {
      pushDiag(diagnostics, sourceFile, node, `"Math.${prop}" is a function alias. Call it.`)
      return undefined
    }
    pushDiag(diagnostics, sourceFile, node, `"Math.${prop}" is not a TypeShade alias.`)
    return undefined
  }
  const base = lowerExpression(obj, sourceFile, scope, diagnostics)
  if (!base) return undefined
  if (prop === 'length' && base.type.kind === 'array') {
    return { op: 'lit', type: i32T, value: base.type.size ?? 0 }
  }
  if (JS_ARRAY_METHODS.has(prop)) {
    pushDiag(diagnostics, sourceFile, node, `JS Array method ".${prop}" is not a shader op. Use sum/min/any/all/zip/fill.`)
    return undefined
  }
  if (base.type.kind === 'struct') {
    const ft = scope.fieldType(base.type.name, prop)
    if (!ft) {
      pushDiag(diagnostics, sourceFile, node, `Unknown field "${prop}" on ${typeKey(base.type)}.`)
      return undefined
    }
    return { op: 'member', type: ft, base, field: prop }
  }
  const sw = parseSwizzle(base.type, prop)
  if (!sw.ok) {
    pushDiag(diagnostics, sourceFile, node, sw.message)
    return undefined
  }
  return { op: 'member', type: sw.type, base, field: sw.field }
}

export function lowerObjectLiteral(
  node: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const given: { name: string; expr: Expr }[] = []
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
      pushDiag(diagnostics, sourceFile, prop, 'Object literals must use identifier fields, e.g. { pos: vec4(...) }.')
      return undefined
    }
    const expr = lowerExpression(prop.initializer, sourceFile, scope, diagnostics)
    if (!expr) return undefined
    given.push({ name: prop.name.text, expr })
  }
  const names = given.map((g) => g.name)
  const match = scope.matchStruct(names)
  if (!match) {
    pushDiag(diagnostics, sourceFile, node, `Object literal { ${names.join(', ')} } does not match a known struct.`)
    return undefined
  }
  const byName = new Map(given.map((g) => [g.name, g.expr]))
  const args: Expr[] = []
  for (const field of match.fields) {
    const expr = byName.get(field.name)
    if (!expr) {
      pushDiag(diagnostics, sourceFile, node, `Missing field "${field.name}" for struct ${match.name}.`)
      return undefined
    }
    if (typeKey(expr.type) !== typeKey(field.type)) {
      pushDiag(diagnostics, sourceFile, node, numericMismatch(`field ${match.name}.${field.name}`, field.type, expr.type))
      return undefined
    }
    args.push(expr)
  }
  return { op: 'construct', type: structT(match.name), args }
}

function pushDiag(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
): void {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  diagnostics.push({ message, fileName: sourceFile.fileName, line: line + 1, character: character + 1, category: 'error' })
}
