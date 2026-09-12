// Top-level `const name = uniform<T>(...)` / `storage<T>(...)` → BindingDecl.

import ts from 'typescript'
import type { BindingDecl, StructDecl } from '../../core/ir/nodes.js'
import type { TsCompilerDiagnostic } from './source-file.js'
import { mapTsTypeToShaderType } from './type-map.js'
import { TS_CODES } from './codes.js'

export function isResourceCall(expr: ts.Expression): expr is ts.CallExpression {
  return (
    ts.isCallExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    (expr.expression.text === 'uniform' || expr.expression.text === 'storage')
  )
}

export function collectBindings(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  structs: Map<string, StructDecl>,
): BindingDecl[] {
  const out: BindingDecl[] = []
  let next = 0
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    if ((stmt.declarationList.flags & ts.NodeFlags.Const) === 0) continue
    for (const decl of stmt.declarationList.declarations) {
      if (!decl.initializer || !isResourceCall(decl.initializer)) continue
      if (!ts.isIdentifier(decl.name)) continue
      const b = fromCall(decl.name.text, decl.initializer, sourceFile, diagnostics, structs, next)
      if (b) {
        out.push(b)
        next = Math.max(next, b.binding + 1)
      }
    }
  }
  return out
}

function fromCall(
  name: string,
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  structs: Map<string, StructDecl>,
  autoBinding: number,
): BindingDecl | undefined {
  const kind = ts.isIdentifier(call.expression) ? call.expression.text : ''
  const typeArg = call.typeArguments?.[0]
  if (!typeArg) {
    diagnostics.push({
      message: `${kind}<T>() needs a type argument (e.g. ${kind}<Params>()).`,
      fileName: sourceFile.fileName,
      line: 1,
      character: 1,
      category: 'error',
      code: TS_CODES.UNKNOWN_TYPE,
    })
    return undefined
  }
  const type = mapTsTypeToShaderType(typeArg, sourceFile, diagnostics, structs)
  if (!type) return undefined
  let group = 0
  let binding = autoBinding
  let access: 'read' | 'read_write' | undefined = kind === 'storage' ? 'read' : undefined
  const args = call.arguments
  if (args[0] && ts.isNumericLiteral(args[0])) group = Number(args[0].text)
  if (args[1] && ts.isNumericLiteral(args[1])) binding = Number(args[1].text)
  if (args[0] && !args[1] && ts.isNumericLiteral(args[0]) && kind === 'uniform') {
    binding = Number(args[0].text)
    group = 0
  }
  const accessArg =
    args[2] ?? (kind === 'storage' && args.length === 1 && ts.isStringLiteral(args[0]!) ? args[0] : undefined)
  if (accessArg && ts.isStringLiteral(accessArg)) {
    if (accessArg.text === 'read' || accessArg.text === 'read_write') access = accessArg.text
    else {
      diagnostics.push({
        message: `storage access must be "read" or "read_write", got "${accessArg.text}".`,
        fileName: sourceFile.fileName,
        line: 1,
        character: 1,
        category: 'error',
        code: TS_CODES.UNSUPPORTED,
      })
      return undefined
    }
  }
  return { group, binding, name, space: kind === 'storage' ? 'storage' : 'uniform', access, type }
}
