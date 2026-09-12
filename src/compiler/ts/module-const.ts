// Top-level `const` → ModuleDecl.consts (foldable scalars).

import ts from 'typescript'
import type { ConstDecl } from '../../core/ir/nodes.js'
import { typeKey } from '../../core/ir/types.js'
import type { TsCompilerDiagnostic } from './source-file.js'
import { LoweringScope } from './context.js'
import { mapTsTypeToShaderType } from './type-map.js'
import { foldConstValue } from './loop-bound.js'
import { lowerExpression } from './lower/expression.js'
import { isResourceCall } from './bindings.js'
import { TS_CODES } from './codes.js'

function isTopLevelConst(stmt: ts.Statement): stmt is ts.VariableStatement {
  return ts.isVariableStatement(stmt) && (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0
}

export function collectModuleConsts(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): ConstDecl[] {
  const scope = new LoweringScope()
  const out: ConstDecl[] = []
  for (const stmt of sourceFile.statements) {
    if (!isTopLevelConst(stmt)) continue
    if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) continue
    for (const decl of stmt.declarationList.declarations) {
      const c = lowerOne(decl, sourceFile, scope, diagnostics)
      if (c) out.push(c)
    }
  }
  return out
}

function lowerOne(
  decl: ts.VariableDeclaration,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): ConstDecl | undefined {
  if (!ts.isIdentifier(decl.name)) {
    diagnostics.push({
      message: 'Module const must be a simple name.',
      fileName: sourceFile.fileName,
      line: 1,
      character: 1,
      category: 'error',
      code: TS_CODES.TOP_LEVEL,
    })
    return undefined
  }
  const name = decl.name.text
  if (scope.hasInCurrent(name)) {
    diagnostics.push({
      message: `Duplicate module const "${name}".`,
      fileName: sourceFile.fileName,
      line: 1,
      character: 1,
      category: 'error',
      code: TS_CODES.TOP_LEVEL,
    })
    return undefined
  }
  if (decl.initializer && isResourceCall(decl.initializer)) return undefined
  if (!decl.initializer) {
    diagnostics.push({
      message: `Module const "${name}" needs an initializer.`,
      fileName: sourceFile.fileName,
      line: 1,
      character: 1,
      category: 'error',
      code: TS_CODES.TOP_LEVEL,
    })
    return undefined
  }
  const annotated = decl.type ? mapTsTypeToShaderType(decl.type, sourceFile, diagnostics) : undefined
  const init = lowerExpression(decl.initializer, sourceFile, scope, diagnostics)
  if (!init) return undefined
  const folded = foldConstValue(init, scope)
  if (typeof folded !== 'number' && typeof folded !== 'boolean') {
    diagnostics.push({
      message: `Module const "${name}" must be a foldable scalar (literal or const expression).`,
      fileName: sourceFile.fileName,
      line: 1,
      character: 1,
      category: 'error',
      code: TS_CODES.TOP_LEVEL,
    })
    return undefined
  }
  const type = annotated ?? init.type
  const k = typeKey(type)
  if (k !== 'f32' && k !== 'i32' && k !== 'u32' && k !== 'bool') {
    diagnostics.push({
      message: `Module const "${name}" must be f32, i32, u32, or bool for now.`,
      fileName: sourceFile.fileName,
      line: 1,
      character: 1,
      category: 'error',
      code: TS_CODES.TOP_LEVEL,
    })
    return undefined
  }
  const numeric = typeof folded === 'boolean' ? (folded ? 1 : 0) : folded
  const value = k === 'f32' ? numeric : k === 'bool' ? numeric : Math.trunc(numeric)
  scope.define({
    kind: 'module',
    name,
    type,
    mutable: false,
    constValue: typeof folded === 'boolean' ? folded : value,
  })
  return { name, type, wgslValue: value, cpuValue: value }
}
