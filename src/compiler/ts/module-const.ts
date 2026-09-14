// Top-level `const` → ModuleDecl.consts (foldable scalars).

import ts from 'typescript'
import type { ConstDecl } from '../../core/ir/nodes.js'
import { typeKey } from '../../core/ir/types.js'
import type { TsCompilerDiagnostic } from './source-file.js'
import { LoweringScope } from './context.js'
import type { DeclaredSymbolSink } from './symbols.js'
import { mapTsTypeToShaderType } from './type-map.js'
import { foldConstValue } from './loop-bound.js'
import { lowerExpression } from './lower/expression.js'
import { isResourceCall } from './bindings.js'
import { isOverrideType } from './overrides.js'
import { TS_CODES } from './codes.js'
import { makeDiagnostic } from './diagnostic.js'

function isTopLevelConst(stmt: ts.Statement): stmt is ts.VariableStatement {
  return ts.isVariableStatement(stmt) && (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0
}

export function collectModuleConsts(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  symbols?: DeclaredSymbolSink,
): ConstDecl[] {
  const scope = new LoweringScope(undefined, symbols)
  const out: ConstDecl[] = []
  for (const stmt of sourceFile.statements) {
    if (!isTopLevelConst(stmt)) continue
    if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) continue
    for (const decl of stmt.declarationList.declarations) {
      // `const q: override<f32> = 1.` is a specialization constant, not a module constant:
      // its value is the DEFAULT a pipeline may replace, so overrides.ts owns it and folding
      // it here would bake in a value the pipeline is allowed to change (#8 A7).
      if (isOverrideType(decl.type)) continue
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
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl.name,
        'Module const must be a simple name.',
        TS_CODES.TOP_LEVEL,
      ),
    )
    return undefined
  }
  const name = decl.name.text
  if (scope.hasInCurrent(name)) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl.name,
        `Duplicate module const "${name}".`,
        TS_CODES.DUPLICATE_SYMBOL,
      ),
    )
    return undefined
  }
  if (decl.initializer && isResourceCall(decl.initializer)) return undefined
  if (!decl.initializer) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl,
        `Module const "${name}" needs an initializer.`,
        TS_CODES.TOP_LEVEL,
      ),
    )
    return undefined
  }
  const annotated = decl.type
    ? mapTsTypeToShaderType(decl.type, sourceFile, diagnostics)
    : undefined
  const init = lowerExpression(decl.initializer, sourceFile, scope, diagnostics)
  if (!init) return undefined
  const folded = foldConstValue(init, scope)
  if (typeof folded !== 'number' && typeof folded !== 'boolean') {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl,
        `Module const "${name}" must be a foldable scalar (literal or const expression).`,
        TS_CODES.TYPE_MISMATCH,
      ),
    )
    return undefined
  }
  const type = annotated ?? init.type
  const k = typeKey(type)
  if (k !== 'f32' && k !== 'i32' && k !== 'u32' && k !== 'bool') {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl,
        `Module const "${name}" must be f32, i32, u32, or bool for now.`,
        TS_CODES.TYPE_MISMATCH,
      ),
    )
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
  scope.recordDeclaration(sourceFile, decl.name, { name, kind: 'const', type })
  return { name, type, wgslValue: value, cpuValue: value }
}
