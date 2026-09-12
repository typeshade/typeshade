// === Function lowering: TS FunctionDeclaration -> FuncDecl (Phase 5) ===
//
// Lowers:
//   export function name(a: f32, b: f32): f32 { ... }
// into the same FuncDecl shape produced by fn().

import ts from 'typescript'
import type { FuncDecl, Stmt, Expr } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { voidT, typeKey } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import { LoweringScope } from '../context.js'
import { mapTsTypeToShaderType } from '../type-map.js'
import { lowerStatements } from './statement.js'

/**
 * Lower every eligible top-level function in a SourceFile.
 * Skips the "use typeshade" directive and non-function statements.
 */
export function lowerSourceFunctions(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): FuncDecl[] {
  const funcs: FuncDecl[] = []
  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt)) {
      const fn = lowerFunctionDeclaration(stmt, sourceFile, diagnostics)
      if (fn) funcs.push(fn)
    }
  }
  return funcs
}

export function lowerFunctionDeclaration(
  node: ts.FunctionDeclaration,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): FuncDecl | undefined {
  if (!node.name || !ts.isIdentifier(node.name)) {
    pushDiag(diagnostics, sourceFile, node, 'Function declaration must have a name.')
    return undefined
  }
  if (!node.body) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Function "${node.name.text}" needs a body (no ambient declarations).`,
    )
    return undefined
  }

  const name = node.name.text
  const scope = new LoweringScope()

  const params: FuncDecl['params'] = []
  for (const p of node.parameters) {
    if (!ts.isIdentifier(p.name)) {
      pushDiag(diagnostics, sourceFile, p, 'Parameter must be a simple identifier.')
      return undefined
    }
    if (p.questionToken) {
      pushDiag(diagnostics, sourceFile, p, `Optional parameter "${p.name.text}" is not supported.`)
      return undefined
    }
    if (p.dotDotDotToken) {
      pushDiag(diagnostics, sourceFile, p, `Rest parameter "${p.name.text}" is not supported.`)
      return undefined
    }
    const pType = mapTsTypeToShaderType(p.type, sourceFile, diagnostics)
    if (!pType) {
      pushDiag(
        diagnostics,
        sourceFile,
        p,
        `Parameter "${p.name.text}" requires a TypeShade type annotation (f32, i32, u32, bool, vec2, vec3, vec4).`,
      )
      return undefined
    }
    const pname = p.name.text
    params.push({ name: pname, type: pType })
    scope.define({ kind: 'param', name: pname, type: pType })
  }

  // Return type — void is a keyword TypeNode, not a TypeShade short name.
  let ret: ShaderType = voidT
  if (node.type) {
    if (node.type.kind === ts.SyntaxKind.VoidKeyword) {
      ret = voidT
    } else {
      const mapped = mapTsTypeToShaderType(node.type, sourceFile, diagnostics)
      if (!mapped) {
        pushDiag(diagnostics, sourceFile, node.type, `Unsupported return type for "${name}".`)
        return undefined
      }
      ret = mapped
    }
  } else {
    diagnostics.push({
      message: `Function "${name}" has no return type annotation; defaulting to void.`,
      fileName: sourceFile.fileName,
      line: 1,
      character: 1,
      category: 'warning',
    })
  }

  const body = lowerStatements(node.body.statements, sourceFile, scope, diagnostics)

  if (typeKey(ret) !== 'void') {
    const returns = collectReturns(body)
    for (const r of returns) {
      if (!r.expr) {
        pushDiag(
          diagnostics,
          sourceFile,
          node.name,
          `Function "${name}" returns ${typeKey(ret)} but has a bare "return".`,
        )
        continue
      }
      if (typeKey(r.expr.type) !== typeKey(ret)) {
        pushDiag(
          diagnostics,
          sourceFile,
          node.name,
          `Function "${name}" return type mismatch: declared ${typeKey(ret)}, got ${typeKey(r.expr.type)}.`,
        )
      }
    }
  }

  return {
    name,
    params,
    ret,
    body,
  }
}

function collectReturns(stmts: readonly Stmt[]): { expr?: Expr }[] {
  const out: { expr?: Expr }[] = []
  const walk = (list: readonly Stmt[]) => {
    for (const s of list) {
      if (s.s === 'return') out.push(s)
      else if (s.s === 'if') {
        for (const arm of s.arms) walk(arm.body)
        if (s.elseBody) walk(s.elseBody)
      }
    }
  }
  walk(stmts)
  return out
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
