// Top-level resource declarations.
//   const scale = uniform<f32>()
//   declare const camera: uniform<Camera>

import ts from 'typescript'
import type { BindingDecl } from '../../core/ir/nodes.js'
import { structT } from '../../core/ir/types.js'
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
): BindingDecl[] {
  const out: BindingDecl[] = []
  let next = 0
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    const isConst = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0
    const isLet = (stmt.declarationList.flags & ts.NodeFlags.Let) !== 0
    if (!isConst && !isLet) continue
    const declared = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword) ?? false
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue
      if (decl.initializer && isResourceCall(decl.initializer)) {
        const b = fromCall(decl.name.text, decl.initializer, isConst, sourceFile, diagnostics, next)
        if (b) {
          out.push(b)
          next = Math.max(next, b.binding + 1)
        }
        continue
      }
      if (declared && decl.type) {
        const b = fromType(decl.name.text, decl.type, isConst, sourceFile, diagnostics, next)
        if (b) {
          out.push(b)
          next = Math.max(next, b.binding + 1)
        }
      }
    }
  }
  const seen = new Map<string, string>()
  for (const b of out) {
    const key = `${b.group}:${b.binding}`
    const prev = seen.get(key)
    if (prev) {
      diagnostics.push({
        message: `@binding(${b.binding}) in group ${b.group} is used by "${prev}" and "${b.name}".`,
        fileName: sourceFile.fileName,
        line: 1,
        character: 1,
        category: 'error',
        code: TS_CODES.UNSUPPORTED,
      })
    } else seen.set(key, b.name)
  }
  return out
}

function fromType(
  name: string,
  type: ts.TypeNode,
  isConst: boolean,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  autoBinding: number,
): BindingDecl | undefined {
  if (!ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName)) {
    diagnostics.push(diag(sourceFile, type, `declare "${name}" must be uniform<T> or storage<T>.`))
    return undefined
  }
  const kind = type.typeName.text
  if (kind !== 'uniform' && kind !== 'storage') {
    diagnostics.push(diag(sourceFile, type, `declare "${name}" must be uniform<T> or storage<T>.`))
    return undefined
  }
  const inner = type.typeArguments?.[0]
  if (!inner) {
    diagnostics.push(diag(sourceFile, type, `${kind}<T> needs a type argument.`))
    return undefined
  }
  const mapped =
    mapTsTypeToShaderType(inner, sourceFile, diagnostics) ??
    (ts.isTypeReferenceNode(inner) && ts.isIdentifier(inner.typeName)
      ? structT(inner.typeName.text)
      : undefined)
  if (!mapped) return undefined
  return {
    group: 0,
    binding: autoBinding,
    name,
    space: kind === 'storage' ? 'storage' : 'uniform',
    access: kind === 'storage' ? (isConst ? 'read' : 'read_write') : undefined,
    type: mapped,
  }
}

function fromCall(
  name: string,
  call: ts.CallExpression,
  isConst: boolean,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  autoBinding: number,
): BindingDecl | undefined {
  const kind = ts.isIdentifier(call.expression) ? call.expression.text : ''
  const typeArg = call.typeArguments?.[0]
  if (!typeArg) {
    diagnostics.push(diag(sourceFile, call, `${kind}<T>() needs a type argument.`))
    return undefined
  }
  const type =
    mapTsTypeToShaderType(typeArg, sourceFile, diagnostics) ??
    (ts.isTypeReferenceNode(typeArg) && ts.isIdentifier(typeArg.typeName)
      ? structT(typeArg.typeName.text)
      : undefined)
  if (!type) return undefined
  if (kind === 'uniform' && !isConst) {
    diagnostics.push(diag(sourceFile, call, `uniform "${name}" must be const. Use const ${name} = uniform<T>().`))
    return undefined
  }
  let group = 0
  let binding = autoBinding
  let access: 'read' | 'read_write' | undefined =
    kind === 'storage' ? (isConst ? 'read' : 'read_write') : undefined
  const arg0 = call.arguments[0]
  if (arg0 && ts.isNumericLiteral(arg0)) {
    binding = Number(arg0.text)
    if (call.arguments[1] && ts.isNumericLiteral(call.arguments[1])) {
      group = binding
      binding = Number(call.arguments[1].text)
    }
  } else if (arg0 && ts.isObjectLiteralExpression(arg0)) {
    const opt = parseOptions(arg0)
    if (opt.group !== undefined) group = opt.group
    if (opt.binding !== undefined) binding = opt.binding
    if (opt.access) access = kind === 'storage' ? opt.access : undefined
  }
  return { group, binding, name, space: kind === 'storage' ? 'storage' : 'uniform', access, type }
}

function parseOptions(obj: ts.ObjectLiteralExpression): {
  group?: number
  binding?: number
  access?: 'read' | 'read_write'
} {
  const out: { group?: number; binding?: number; access?: 'read' | 'read_write' } = {}
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue
    const key = prop.name.text
    if ((key === 'group' || key === 'binding') && ts.isNumericLiteral(prop.initializer)) {
      out[key] = Number(prop.initializer.text)
    }
    if (key === 'access' && ts.isStringLiteral(prop.initializer)) {
      if (prop.initializer.text === 'read' || prop.initializer.text === 'read_write') out.access = prop.initializer.text
    }
  }
  return out
}

function diag(sourceFile: ts.SourceFile, node: ts.Node, message: string): TsCompilerDiagnostic {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return { message, fileName: sourceFile.fileName, line: line + 1, character: character + 1, category: 'error', code: TS_CODES.UNSUPPORTED }
}
