import ts from 'typescript'
import type { Expr, FuncDecl } from '../../../core/ir/nodes.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { LoweringScope } from '../context.js'
import { fillArray, noneOf, unrollMinMax, unrollPred, unrollSum, unrollZip } from '../array-ops.js'
import { mapTsTypeToShaderType } from '../type-map.js'
import { lowerExpression } from './expression.js'

export function lowerArrayCtor(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const typeArgs = node.typeArguments
  if (!typeArgs || typeArgs.length < 1) {
    pushDiag(diagnostics, sourceFile, node, 'array<T, N>(...) needs type arguments.')
    return undefined
  }
  const fakeRef = ts.factory.createTypeReferenceNode('array', [...typeArgs])
  const mapped = mapTsTypeToShaderType(fakeRef, sourceFile, diagnostics)
  if (!mapped || mapped.kind !== 'array') return undefined
  const n = mapped.size
  const args: Expr[] = []
  for (const arg of node.arguments) {
    const lowered = lowerExpression(arg, sourceFile, scope, diagnostics)
    if (!lowered) return undefined
    args.push(lowered)
  }
  if (n !== undefined && args.length !== n) {
    pushDiag(diagnostics, sourceFile, node, `array constructor expects ${n} element(s), got ${args.length}.`)
    return undefined
  }
  return { op: 'construct', type: mapped, args }
}

export function lowerFill(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const typeArgs = node.typeArguments
  if (!typeArgs || typeArgs.length < 2) {
    pushDiag(diagnostics, sourceFile, node, 'fill<T, N>(v) needs type arguments.')
    return undefined
  }
  const fakeRef = ts.factory.createTypeReferenceNode('array', [...typeArgs])
  const mapped = mapTsTypeToShaderType(fakeRef, sourceFile, diagnostics)
  if (!mapped || mapped.kind !== 'array' || mapped.size === undefined) {
    pushDiag(diagnostics, sourceFile, node, 'fill<T, N>(v) needs a fixed N.')
    return undefined
  }
  if (node.arguments.length !== 1) {
    pushDiag(diagnostics, sourceFile, node, 'fill<T, N>(v) expects 1 value.')
    return undefined
  }
  const v = lowerExpression(node.arguments[0]!, sourceFile, scope, diagnostics)
  if (!v) return undefined
  return fillArray(mapped.elem, mapped.size, v)
}

export function lowerArrayFold(
  name: string,
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined | 'fallback' {
  if (name === 'min' || name === 'max') {
    if (node.arguments.length !== 1) return 'fallback'
  }
  const args: Expr[] = []
  const predDecls: FuncDecl[] = []
  for (const arg of node.arguments) {
    if (ts.isIdentifier(arg)) {
      const decl = scope.resolveCallee(arg.text)
      if (decl) {
        predDecls.push(decl)
        continue
      }
    }
    const lowered = lowerExpression(arg, sourceFile, scope, diagnostics)
    if (!lowered) return undefined
    args.push(lowered)
  }
  const first = args[0]
  const asArray = first && first.type.kind === 'array'
  if (name === 'sum') {
    if (!first) {
      pushDiag(diagnostics, sourceFile, node, 'sum(xs) needs an array.')
      return undefined
    }
    const out = unrollSum(first)
    if (typeof out === 'string') {
      pushDiag(diagnostics, sourceFile, node, out)
      return undefined
    }
    return out
  }
  if ((name === 'min' || name === 'max') && asArray && args.length === 1) {
    const out = unrollMinMax(name, first!)
    if (typeof out === 'string') {
      pushDiag(diagnostics, sourceFile, node, out)
      return undefined
    }
    return out
  }
  if (name === 'any' || name === 'all' || name === 'none') {
    if (!first || predDecls.length !== 1) {
      pushDiag(diagnostics, sourceFile, node, `${name}(xs, pred) needs an array and a predicate function.`)
      return undefined
    }
    const out = unrollPred(first, predDecls[0]!, name === 'all' ? '&&' : '||')
    if (typeof out === 'string') {
      pushDiag(diagnostics, sourceFile, node, out)
      return undefined
    }
    return name === 'none' ? noneOf(out) : out
  }
  if (name === 'zip') {
    if (args.length !== 2 || predDecls.length !== 1) {
      pushDiag(diagnostics, sourceFile, node, 'zip(xs, ys, fn) needs two arrays and a function.')
      return undefined
    }
    const out = unrollZip(args[0]!, args[1]!, predDecls[0]!)
    if (typeof out === 'string') {
      pushDiag(diagnostics, sourceFile, node, out)
      return undefined
    }
    return out
  }
  return 'fallback'
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
