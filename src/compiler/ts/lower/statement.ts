// === Statement lowering: TS AST -> TypeShade Stmt (Phase 4) ===
//
// Minimum set:
//   const x = ...        ->  { s: 'let', name, expr }
//   let x = ...          ->  { s: 'var', name, type, init }
//   return x             ->  { s: 'return', expr }
//   if (cond) { ... }    ->  { s: 'if', arms, elseBody? }
//
// Numeric literals without annotation default to f32 (recommended DX).
// Explicit types use annotations: `let a: i32 = 0`.
// C-style suffixes (0.0f / 0u / 0i) are NOT supported - not valid TypeScript.

import ts from 'typescript'
import type { Expr } from '../../../core/ir/nodes.js'
import type { Stmt } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { typeKey } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import { LoweringScope } from '../context.js'
import { mapTsTypeToShaderType } from '../type-map.js'
import { lowerExpression } from './expression.js'

/**
 * Lower a block of TypeScript statements into TypeShade Stmt[].
 * Mutates `scope` when const/let bindings are introduced.
 */
export function lowerStatements(
  statements: readonly ts.Statement[],
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt[] {
  const out: Stmt[] = []
  for (const stmt of statements) {
    const lowered = lowerStatement(stmt, sourceFile, scope, diagnostics)
    if (lowered === undefined) continue
    if (Array.isArray(lowered)) out.push(...lowered)
    else out.push(lowered)
  }
  return out
}

/**
 * Lower a single statement. Returns one Stmt, a list (for multi-decl), or undefined.
 */
export function lowerStatement(
  node: ts.Statement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | Stmt[] | undefined {
  if (ts.isBlock(node)) {
    return lowerStatements(node.statements, sourceFile, scope, diagnostics)
  }

  if (ts.isReturnStatement(node)) {
    if (!node.expression) {
      return { s: 'return' }
    }
    const expr = lowerExpression(node.expression, sourceFile, scope, diagnostics)
    if (!expr) return undefined
    return { s: 'return', expr }
  }

  if (ts.isIfStatement(node)) {
    return lowerIf(node, sourceFile, scope, diagnostics)
  }

  if (ts.isVariableStatement(node)) {
    return lowerVariableStatement(node, sourceFile, scope, diagnostics)
  }

  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `Unsupported statement "${truncate(node.getText(sourceFile))}". Phase 4 supports const/let, return, and if.`,
  )
  return undefined
}

function lowerVariableStatement(
  node: ts.VariableStatement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | Stmt[] | undefined {
  const flags = node.declarationList.flags
  const isConst = (flags & ts.NodeFlags.Const) !== 0
  const isLet = (flags & ts.NodeFlags.Let) !== 0
  if (!isConst && !isLet) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'Use "const" or "let" in "use typeshade" sources. The JS "var" keyword is not supported.',
    )
    return undefined
  }

  const results: Stmt[] = []
  for (const decl of node.declarationList.declarations) {
    const one = lowerVariableDeclaration(decl, isConst, sourceFile, scope, diagnostics)
    if (one) results.push(one)
  }
  if (results.length === 0) return undefined
  if (results.length === 1) return results[0]
  return results
}

function lowerVariableDeclaration(
  decl: ts.VariableDeclaration,
  isConst: boolean,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  if (!ts.isIdentifier(decl.name)) {
    pushDiag(
      diagnostics,
      sourceFile,
      decl.name,
      'Destructuring is not supported in Phase 4. Use a simple identifier.',
    )
    return undefined
  }
  const name = decl.name.text

  if (scope.resolve(name)) {
    pushDiag(
      diagnostics,
      sourceFile,
      decl.name,
      `Duplicate binding "${name}" in this scope.`,
    )
    return undefined
  }

  let annotated: ShaderType | undefined
  if (decl.type) {
    annotated = mapTsTypeToShaderType(decl.type, sourceFile, diagnostics)
    if (!annotated) return undefined
  }

  if (!decl.initializer) {
    pushDiag(
      diagnostics,
      sourceFile,
      decl,
      `"${isConst ? 'const' : 'let'} ${name}" requires an initializer in Phase 4.`,
    )
    return undefined
  }

  let init = lowerExpression(decl.initializer, sourceFile, scope, diagnostics)
  if (!init) return undefined

  // If annotated and init is a numeric lit, retarget lit type to the annotation
  // (so `let a: i32 = 0` yields i32 lit, not f32).
  if (annotated && init.op === 'lit' && typeof init.value === 'number') {
    if (isIntegerType(annotated) || typeKey(annotated) === 'f32') {
      init = { op: 'lit', type: annotated, value: init.value }
    }
  }

  if (annotated && typeKey(annotated) !== typeKey(init.type)) {
    pushDiag(
      diagnostics,
      sourceFile,
      decl,
      `Type mismatch for "${name}": annotation ${typeKey(annotated)} vs initializer ${typeKey(init.type)}.`,
    )
    return undefined
  }
  const bindingType = annotated ?? init.type

  scope.define({ kind: 'local', name, type: bindingType })

  if (isConst) {
    return { s: 'let', name, expr: init }
  }
  return { s: 'var', name, type: bindingType, init }
}

function lowerIf(
  node: ts.IfStatement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  const cond = lowerExpression(node.expression, sourceFile, scope, diagnostics)
  if (!cond) return undefined
  if (typeKey(cond.type) !== 'bool') {
    pushDiag(
      diagnostics,
      sourceFile,
      node.expression,
      `if condition must be bool, got ${typeKey(cond.type)}.`,
    )
    return undefined
  }

  const thenBody = lowerBranch(node.thenStatement, sourceFile, scope, diagnostics)
  const ifArms: { cond: Expr; body: readonly Stmt[] }[] = [{ cond, body: thenBody }]

  let elseBody: readonly Stmt[] | undefined

  if (node.elseStatement) {
    if (ts.isIfStatement(node.elseStatement)) {
      const nested = lowerIf(node.elseStatement, sourceFile, scope, diagnostics)
      if (nested && nested.s === 'if') {
        ifArms.push(...nested.arms)
        elseBody = nested.elseBody
      }
    } else {
      elseBody = lowerBranch(node.elseStatement, sourceFile, scope, diagnostics)
    }
  }

  return { s: 'if', arms: ifArms, elseBody }
}

function lowerBranch(
  node: ts.Statement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt[] {
  if (ts.isBlock(node)) {
    return lowerStatements(node.statements, sourceFile, scope, diagnostics)
  }
  const one = lowerStatement(node, sourceFile, scope, diagnostics)
  if (!one) return []
  return Array.isArray(one) ? one : [one]
}

function isIntegerType(t: ShaderType): boolean {
  const k = typeKey(t)
  return k === 'i32' || k === 'u32'
}

function pushDiag(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
): void {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  diagnostics.push({
    message,
    fileName: sourceFile.fileName,
    line: line + 1,
    character: character + 1,
    category: 'error',
  })
}

function truncate(s: string, n = 60): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : t.slice(0, n) + '\u2026'
}
