import ts from 'typescript'
import type { Expr } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { f32T, i32T, structT, typeKey } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { LoweringScope } from '../context.js'
import { resolveMathConst, resolveMathExpand, resolveMathFn } from '../math-alias.js'
import { parseSwizzle } from '../swizzle.js'
import { numericMismatch } from '../numeric.js'
import { lowerExpression } from './expression.js'
import { makeDiagnostic } from '../diagnostic.js'
import { TS_CODES, type TsCode } from '../codes.js'

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
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"Math.${prop}" is a function alias. Call it.`,
        TS_CODES.UNSUPPORTED,
      )
      return undefined
    }
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"Math.${prop}" is not a TypeShade alias.`,
      TS_CODES.UNKNOWN_NAME,
    )
    return undefined
  }
  const base = lowerExpression(obj, sourceFile, scope, diagnostics)
  if (!base) return undefined
  if (prop === 'length' && base.type.kind === 'array') {
    return { op: 'lit', type: i32T, value: base.type.size ?? 0 }
  }
  if (JS_ARRAY_METHODS.has(prop)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `JS Array method ".${prop}" is not a shader op. Use sum/min/any/all/zip/fill.`,
      TS_CODES.UNSUPPORTED,
    )
    return undefined
  }
  if (base.type.kind === 'struct') {
    const ft = scope.fieldType(base.type.name, prop)
    if (!ft) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Unknown field "${prop}" on ${typeKey(base.type)}.`,
        TS_CODES.UNKNOWN_NAME,
      )
      return undefined
    }
    return { op: 'member', type: ft, base, field: prop }
  }
  const sw = parseSwizzle(base.type, prop)
  if (!sw.ok) {
    pushDiag(diagnostics, sourceFile, node, sw.message, TS_CODES.UNKNOWN_NAME)
    return undefined
  }
  return { op: 'member', type: sw.type, base, field: sw.field }
}

/**
 * Lower `{ pos: …, uv: … }` into the `construct` of the struct it builds.
 *
 * WHICH struct comes from `contextual` when the position declares one — a function's return
 * type, a `let`/`const` annotation, a parameter type (#8 A11). Matching the field NAMES
 * against the struct table is the fallback for a position that declares nothing, and it is
 * only a fallback because it cannot answer at all when two structs have the same shape: a
 * vertex `VsOut` and a fragment `FsIn` with the same fields made `return { pos, uv }` an
 * error in a function that says exactly which one it returns.
 *
 * A contextual type that is not a struct is ignored rather than reported here: the mismatch
 * belongs to the position's own type check, which says what was declared and what it got.
 *
 * @param contextual - the type the position declares, if it declares one.
 * @returns the `construct`, or `undefined` after pushing a diagnostic.
 */
export function lowerObjectLiteral(
  node: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  contextual?: ShaderType,
): Expr | undefined {
  const given: { name: string; expr: Expr }[] = []
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
      pushDiag(
        diagnostics,
        sourceFile,
        prop,
        'Object literals must use identifier fields, e.g. { pos: vec4(...) }.',
        TS_CODES.UNSUPPORTED,
      )
      return undefined
    }
    const expr = lowerExpression(prop.initializer, sourceFile, scope, diagnostics)
    if (!expr) return undefined
    given.push({ name: prop.name.text, expr })
  }
  const names = given.map((g) => g.name)
  const declared = contextual?.kind === 'struct' ? scope.structByName(contextual.name) : undefined
  const match = declared ?? scope.matchStruct(names)
  if (!match) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Object literal { ${names.join(', ')} } does not match a known struct.`,
      TS_CODES.UNKNOWN_NAME,
    )
    return undefined
  }
  // With a declared struct, a field the literal does not name is a MISSING FIELD, reported
  // below against that struct. Without one the name set is the only evidence there is, so an
  // extra name means the fallback picked the wrong struct and says so here rather than
  // reporting a missing field of a struct the author never mentioned.
  if (!declared && names.length !== match.fields.length) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Object literal { ${names.join(', ')} } does not match a known struct.`,
      TS_CODES.UNKNOWN_NAME,
    )
    return undefined
  }
  for (const g of given) {
    if (match.fields.some((f) => f.name === g.name)) continue
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Struct ${match.name} has no field "${g.name}".`,
      TS_CODES.STRUCT_FIELD,
    )
    return undefined
  }
  const byName = new Map(given.map((g) => [g.name, g.expr]))
  const args: Expr[] = []
  for (const field of match.fields) {
    const expr = byName.get(field.name)
    if (!expr) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Missing field "${field.name}" for struct ${match.name}.`,
        TS_CODES.STRUCT_FIELD,
      )
      return undefined
    }
    if (typeKey(expr.type) !== typeKey(field.type)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        numericMismatch(`field ${match.name}.${field.name}`, field.type, expr.type),
        TS_CODES.TYPE_MISMATCH,
      )
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
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code))
}
