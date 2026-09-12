// === Function lowering: two-pass signatures then bodies ===

import ts from 'typescript'
import type { FuncDecl, Stmt, Expr } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { voidT, typeKey } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import { LoweringScope } from '../context.js'
import { mapTsTypeToShaderType } from '../type-map.js'
import { lowerStatements } from './statement.js'

export function lowerSourceFunctions(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  consts: readonly { name: string; type: ShaderType }[] = [],
): FuncDecl[] {
  const decls = sourceFile.statements.filter(ts.isFunctionDeclaration)
  const callees = new Map<string, FuncDecl>()
  const ready: ts.FunctionDeclaration[] = []
  for (const stmt of decls) {
    const stub = parseSignature(stmt, sourceFile, diagnostics)
    if (!stub) continue
    if (callees.has(stub.name)) {
      pushDiag(diagnostics, sourceFile, stmt, `Duplicate function "${stub.name}".`)
      continue
    }
    callees.set(stub.name, stub)
    ready.push(stmt)
  }
  const funcs: FuncDecl[] = []
  for (const stmt of ready) {
    const stub = callees.get(stmt.name!.text)!
    fillFunctionBody(stmt, stub, sourceFile, diagnostics, callees, consts)
    funcs.push(stub)
  }
  return funcs
}

export function lowerFunctionDeclaration(
  node: ts.FunctionDeclaration,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  callees?: Map<string, FuncDecl>,
): FuncDecl | undefined {
  const stub = parseSignature(node, sourceFile, diagnostics)
  if (!stub) return undefined
  const table = callees ?? new Map<string, FuncDecl>()
  if (!table.has(stub.name)) table.set(stub.name, stub)
  fillFunctionBody(node, stub, sourceFile, diagnostics, table)
  return stub
}

export function parseSignature(
  node: ts.FunctionDeclaration,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): FuncDecl | undefined {
  if (!node.name || !ts.isIdentifier(node.name)) {
    pushDiag(diagnostics, sourceFile, node, 'Function declaration must have a name.')
    return undefined
  }
  if (!node.body) {
    pushDiag(diagnostics, sourceFile, node, `Function "${node.name.text}" needs a body (no ambient declarations).`)
    return undefined
  }
  const name = node.name.text
  const params: { name: string; type: ShaderType }[] = []
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
      pushDiag(diagnostics, sourceFile, p, `Parameter "${p.name.text}" requires a TypeShade type annotation.`)
      return undefined
    }
    params.push({ name: p.name.text, type: pType })
  }
  let ret: ShaderType = voidT
  if (node.type) {
    if (node.type.kind === ts.SyntaxKind.VoidKeyword) ret = voidT
    else {
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
  return { name, params, ret, body: [] }
}

export function fillFunctionBody(
  node: ts.FunctionDeclaration,
  stub: FuncDecl,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  callees: Map<string, FuncDecl>,
  consts: readonly { name: string; type: ShaderType }[] = [],
): void {
  const scope = new LoweringScope(callees)
  for (const c of consts) {
    scope.define({ kind: 'module', name: c.name, type: c.type, mutable: false })
  }
  for (const p of stub.params) {
    scope.define({ kind: 'param', name: p.name, type: p.type, mutable: true })
  }
  const body = lowerStatements(node.body!.statements, sourceFile, scope, diagnostics)
  ;(stub as { body: readonly Stmt[] }).body = body
  if (typeKey(stub.ret) === 'void') return
  for (const r of collectReturns(body)) {
    if (!r.expr) {
      pushDiag(diagnostics, sourceFile, node.name!, `Function "${stub.name}" returns ${typeKey(stub.ret)} but has a bare "return".`)
      continue
    }
    if (typeKey(r.expr.type) !== typeKey(stub.ret)) {
      pushDiag(diagnostics, sourceFile, node.name!, `Function "${stub.name}" return type mismatch: declared ${typeKey(stub.ret)}, got ${typeKey(r.expr.type)}.`)
    }
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
      } else if (s.s === 'for') walk(s.body)
      else if (s.s === 'switch') {
        for (const c of s.cases) walk(c.body)
        if (s.defaultBody) walk(s.defaultBody)
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
  diagnostics.push({ message, fileName: sourceFile.fileName, line: line + 1, character: character + 1, category: 'error' })
}
