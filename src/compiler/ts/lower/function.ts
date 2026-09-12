// === Function lowering: two-pass signatures then bodies ===

import ts from 'typescript'
import type { BindingDecl, FuncDecl, Stmt, Expr, StructDecl } from '../../../core/ir/nodes.js'
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
  bindings: readonly BindingDecl[] = [],
  structs: readonly StructDecl[] = [],
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
    fillFunctionBody(stmt, stub, sourceFile, diagnostics, callees, consts, bindings, structs)
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
  const params: FuncDecl['params'][number][] = []
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
    const builtin = stringDecorator(p, sourceFile, 'builtin')
    const location = numberDecorator(p, sourceFile, 'location')
    params.push({
      name: p.name.text,
      type: pType,
      ...(builtin ? { builtin } : {}),
      ...(location !== undefined ? { location } : {}),
    })
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
  const stageInfo = parseStage(node, sourceFile)
  const decl: FuncDecl = { name, params, ret, body: [] }
  if (stageInfo.stage) (decl as { stage?: FuncDecl['stage'] }).stage = stageInfo.stage
  if (stageInfo.workgroupSize !== undefined) {
    ;(decl as { workgroupSize?: number }).workgroupSize = stageInfo.workgroupSize
  }
  const attrs: string[] = []
  if (stageInfo.stage === 'vertex') attrs.push('@vertex')
  if (stageInfo.stage === 'fragment') attrs.push('@fragment')
  if (stageInfo.stage === 'compute') attrs.push(`@compute @workgroup_size(${stageInfo.workgroupSize ?? 64})`)
  if (attrs.length) (decl as { attrs?: string[] }).attrs = attrs
  if (stageInfo.stage === 'vertex' && typeKey(ret).startsWith('vec4')) {
    ;(decl as { retAttr?: string }).retAttr = '@builtin(position)'
    ;(decl as { retBuiltin?: string }).retBuiltin = 'position'
  }
  if (stageInfo.stage === 'fragment' && typeKey(ret).startsWith('vec4')) {
    ;(decl as { retAttr?: string }).retAttr = '@location(0)'
  }
  return decl
}

export function fillFunctionBody(
  node: ts.FunctionDeclaration,
  stub: FuncDecl,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  callees: Map<string, FuncDecl>,
  consts: readonly { name: string; type: ShaderType }[] = [],
  bindings: readonly BindingDecl[] = [],
  structs: readonly StructDecl[] = [],
): void {
  const scope = new LoweringScope(callees)
  scope.setStructs(structs)
  for (const c of consts) {
    scope.define({
      kind: 'module',
      name: c.name,
      type: c.type,
      mutable: false,
      constValue: 'cpuValue' in c ? (c as { cpuValue?: number | boolean }).cpuValue : undefined,
    })
  }
  for (const b of bindings) {
    scope.define({ kind: 'module', name: b.name, type: b.type, mutable: b.access === 'read_write' })
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
      if (r.expr.op === 'construct' && stub.ret.kind === 'struct' && r.expr.type.kind === 'struct') {
        ;(r.expr as { type: ShaderType }).type = stub.ret
        continue
      }
      pushDiag(diagnostics, sourceFile, node.name!, `Function "${stub.name}" return type mismatch: declared ${typeKey(stub.ret)}, got ${typeKey(r.expr.type)}.`)
    }
  }
}

function parseStage(
  node: ts.FunctionDeclaration,
  sourceFile: ts.SourceFile,
): { stage?: FuncDecl['stage']; workgroupSize?: number } {
  const decos = decoratorsOf(node)
  let stage: FuncDecl['stage'] | undefined
  let workgroupSize: number | undefined
  for (const d of decos) {
    const text = d.getText(sourceFile)
    if (/^@vertex\b/.test(text)) stage = 'vertex'
    else if (/^@fragment\b/.test(text)) stage = 'fragment'
    else if (/^@compute\b/.test(text)) {
      stage = 'compute'
      const m = text.match(/@compute\(\s*\[\s*(\d+)/)
      workgroupSize = m ? Number(m[1]) : 64
    }
  }
  return { stage, workgroupSize }
}

function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  if (ts.canHaveDecorators(node)) return ts.getDecorators(node) ?? []
  const mods = (node as { modifiers?: readonly ts.ModifierLike[] }).modifiers ?? []
  return mods.filter(ts.isDecorator)
}

function numberDecorator(node: ts.Node, _sf: ts.SourceFile, name: string): number | undefined {
  for (const d of decoratorsOf(node)) {
    if (!ts.isCallExpression(d.expression)) continue
    if (!ts.isIdentifier(d.expression.expression) || d.expression.expression.text !== name) continue
    const a = d.expression.arguments[0]
    if (a && ts.isNumericLiteral(a)) return Number(a.text)
  }
  return undefined
}

function stringDecorator(node: ts.Node, _sf: ts.SourceFile, name: string): string | undefined {
  for (const d of decoratorsOf(node)) {
    if (!ts.isCallExpression(d.expression)) continue
    if (!ts.isIdentifier(d.expression.expression) || d.expression.expression.text !== name) continue
    const a = d.expression.arguments[0]
    if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) return a.text
  }
  return undefined
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
