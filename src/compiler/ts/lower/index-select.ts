import ts from 'typescript'
import type { Expr } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { typeKey } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { LoweringScope } from '../context.js'
import { lowerExpression } from './expression.js'

export function lowerIndex(
  node: ts.ElementAccessExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const base = lowerExpression(node.expression, sourceFile, scope, diagnostics)
  if (!base || !node.argumentExpression) return undefined
  const idx = lowerExpression(node.argumentExpression, sourceFile, scope, diagnostics)
  if (!idx) return undefined
  const ik = typeKey(idx.type)
  if (ik !== 'i32' && ik !== 'u32') {
    pushDiag(diagnostics, sourceFile, node, 'Index must be i32 or u32.')
    return undefined
  }
  const elem = indexElem(base.type)
  if (!elem) {
    pushDiag(diagnostics, sourceFile, node, `Cannot index ${typeKey(base.type)}.`)
    return undefined
  }
  return { op: 'index', type: elem, base, idx }
}

export function lowerSelect(
  node: ts.ConditionalExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const cond = lowerExpression(node.condition, sourceFile, scope, diagnostics)
  const ifTrue = lowerExpression(node.whenTrue, sourceFile, scope, diagnostics)
  const ifFalse = lowerExpression(node.whenFalse, sourceFile, scope, diagnostics)
  if (!cond || !ifTrue || !ifFalse) return undefined
  if (typeKey(cond.type) !== 'bool') {
    pushDiag(diagnostics, sourceFile, node.condition, 'Ternary condition must be bool.')
    return undefined
  }
  if (typeKey(ifTrue.type) !== typeKey(ifFalse.type)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Ternary arm type mismatch: ${typeKey(ifTrue.type)} vs ${typeKey(ifFalse.type)}.`,
    )
    return undefined
  }
  return { op: 'select', type: ifTrue.type, cond, ifTrue, ifFalse }
}

export function matVecMul(left: Expr, right: Expr): Expr | undefined {
  const lt = left.type
  const rt = right.type
  if (lt.kind === 'mat' && rt.kind === 'vec' && lt.n === rt.n && lt.elem === 'f32' && rt.elem === 'f32') {
    return { op: 'binop', type: right.type, bop: '*', a: left, b: right }
  }
  if (lt.kind === 'mat' && rt.kind === 'mat' && lt.n === rt.n && lt.elem === rt.elem) {
    return { op: 'binop', type: left.type, bop: '*', a: left, b: right }
  }
  return undefined
}

function indexElem(t: ShaderType): ShaderType | undefined {
  if (t.kind === 'array') return t.elem
  if (t.kind === 'vec') return { kind: 'scalar', scalar: t.elem }
  if (t.kind === 'mat' && t.elem === 'f32') return { kind: 'vec', n: t.n, elem: 'f32' }
  return undefined
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
