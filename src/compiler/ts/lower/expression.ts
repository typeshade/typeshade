// === Expression lowering: TS AST -> TypeShade Expr ===
//
// Arithmetic / compare / logical / unary / lit / ident
// Phase 7: Math.sin(x) === sin(x) === call('sin')
//          Math.PI === lit f32
//          mod(a,b) === call('mod')  floor-mod
//          a % b === binop '%'       truncated-mod

import ts from 'typescript'
import type { Expr, BinOp, CmpOp, LogOp } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { f32T, boolT, typeKey } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { LoweringScope } from '../context.js'
import {
  expectedArity,
  isCanonicalMathFn,
  resolveMathConst,
  resolveMathFn,
} from '../math-alias.js'

const ARITH: Readonly<Record<number, BinOp>> = {
  [ts.SyntaxKind.PlusToken]: '+',
  [ts.SyntaxKind.MinusToken]: '-',
  [ts.SyntaxKind.AsteriskToken]: '*',
  [ts.SyntaxKind.SlashToken]: '/',
  [ts.SyntaxKind.PercentToken]: '%',
}

const BITWISE: Readonly<Record<number, BinOp>> = {
  [ts.SyntaxKind.AmpersandToken]: '&',
  [ts.SyntaxKind.BarToken]: '|',
  [ts.SyntaxKind.CaretToken]: '^',
  [ts.SyntaxKind.LessThanLessThanToken]: '<<',
  [ts.SyntaxKind.GreaterThanGreaterThanToken]: '>>',
}

const LOGICAL: Readonly<Record<number, LogOp>> = {
  [ts.SyntaxKind.AmpersandAmpersandToken]: '&&',
  [ts.SyntaxKind.BarBarToken]: '||',
}

const COMPARE: Readonly<Record<number, CmpOp>> = {
  [ts.SyntaxKind.LessThanToken]: '<',
  [ts.SyntaxKind.GreaterThanToken]: '>',
  [ts.SyntaxKind.LessThanEqualsToken]: '<=',
  [ts.SyntaxKind.GreaterThanEqualsToken]: '>=',
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: '==',
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]: '!=',
}

export function lowerExpression(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (ts.isParenthesizedExpression(node)) {
    return lowerExpression(node.expression, sourceFile, scope, diagnostics)
  }
  if (ts.isIdentifier(node)) {
    return lowerIdentifier(node, sourceFile, scope, diagnostics)
  }
  if (ts.isNumericLiteral(node)) {
    return { op: 'lit', type: f32T, value: Number(node.text) }
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return { op: 'lit', type: boolT, value: true }
  }
  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return { op: 'lit', type: boolT, value: false }
  }
  if (ts.isPrefixUnaryExpression(node)) {
    return lowerPrefixUnary(node, sourceFile, scope, diagnostics)
  }
  if (ts.isBinaryExpression(node)) {
    return lowerBinary(node, sourceFile, scope, diagnostics)
  }
  if (ts.isCallExpression(node)) {
    return lowerCall(node, sourceFile, scope, diagnostics)
  }
  if (ts.isPropertyAccessExpression(node)) {
    return lowerPropertyAccess(node, sourceFile, diagnostics)
  }
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `Unsupported expression "${node.getText(sourceFile)}". Supported: literals, identifiers, arithmetic, bitwise, logical, unary, comparisons, Math.* aliases, and math intrinsics.`,
  )
  return undefined
}

function lowerIdentifier(
  node: ts.Identifier,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const binding = scope.resolve(node.text)
  if (!binding) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Unknown identifier "${node.text}". It is not a parameter or local in scope.`,
    )
    return undefined
  }
  if (binding.kind === 'param') {
    return { op: 'param', type: binding.type, name: binding.name }
  }
  return { op: 'varref', type: binding.type, name: binding.name }
}

function lowerPrefixUnary(
  node: ts.PrefixUnaryExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const operand = lowerExpression(node.operand, sourceFile, scope, diagnostics)
  if (!operand) return undefined
  if (node.operator === ts.SyntaxKind.MinusToken) {
    return { op: 'unop', type: operand.type, a: operand }
  }
  if (node.operator === ts.SyntaxKind.ExclamationToken) {
    if (typeKey(operand.type) !== 'bool') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Unary "!" requires a bool operand, got ${typeKey(operand.type)}.`,
      )
      return undefined
    }
    const falseLit: Expr = { op: 'lit', type: boolT, value: false }
    return { op: 'compare', type: boolT, cop: '==', a: operand, b: falseLit }
  }
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `Unsupported unary operator in "${node.getText(sourceFile)}". Phase 3 supports "-" and "!".`,
  )
  return undefined
}

function lowerBinary(
  node: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const left = lowerExpression(node.left, sourceFile, scope, diagnostics)
  const right = lowerExpression(node.right, sourceFile, scope, diagnostics)
  if (!left || !right) return undefined
  const arith = ARITH[node.operatorToken.kind]
  if (arith !== undefined) {
    if (typeKey(left.type) !== typeKey(right.type)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Arithmetic operand type mismatch: ${typeKey(left.type)} vs ${typeKey(right.type)}.`,
      )
      return undefined
    }
    return { op: 'binop', type: left.type, bop: arith, a: left, b: right }
  }
  const bit = BITWISE[node.operatorToken.kind]
  if (bit !== undefined) {
    if (typeKey(left.type) !== typeKey(right.type)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Bitwise operand type mismatch: ${typeKey(left.type)} vs ${typeKey(right.type)}.`,
      )
      return undefined
    }
    return { op: 'binop', type: left.type, bop: bit, a: left, b: right }
  }
  const log = LOGICAL[node.operatorToken.kind]
  if (log !== undefined) {
    if (typeKey(left.type) !== 'bool' || typeKey(right.type) !== 'bool') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Logical "${log}" requires bool operands, got ${typeKey(left.type)} and ${typeKey(right.type)}.`,
      )
      return undefined
    }
    return { op: 'logical', type: boolT, lop: log, a: left, b: right }
  }
  const cmp = COMPARE[node.operatorToken.kind]
  if (cmp !== undefined) {
    if (typeKey(left.type) !== typeKey(right.type)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Comparison operand type mismatch: ${typeKey(left.type)} vs ${typeKey(right.type)}.`,
      )
      return undefined
    }
    return { op: 'compare', type: boolT, cop: cmp, a: left, b: right }
  }
  if (
    node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ||
    node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken
  ) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Use strict equality "=== / !==" in "use typeshade" sources (got "${node.operatorToken.getText(sourceFile)}").`,
    )
    return undefined
  }
  if (node.operatorToken.kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'Unsigned right shift ">>>" is not supported. Use ">>" (WGSL/GLSL have no >>>).',
    )
    return undefined
  }
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `Unsupported binary operator "${node.operatorToken.getText(sourceFile)}". Phase 3 supports + - * / %, bitwise, logical, and comparisons.`,
  )
  return undefined
}

function lowerPropertyAccess(
  node: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const obj = node.expression
  const prop = node.name.text
  if (!ts.isIdentifier(obj) || obj.text !== 'Math') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Member access "${node.getText(sourceFile)}" is not lowered yet (Phase 8). Math.* constants are supported.`,
    )
    return undefined
  }
  const value = resolveMathConst(prop)
  if (value !== undefined) {
    return { op: 'lit', type: f32T, value }
  }
  if (resolveMathFn(prop)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"Math.${prop}" is a function alias. Call it: Math.${prop}(...) or ${resolveMathFn(prop)}(...).`,
    )
    return undefined
  }
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `"Math.${prop}" is not a TypeShade alias. Use a listed Math function/constant or the free intrinsic (sin, PI, …). Host APIs like Math.random are not available.`,
  )
  return undefined
}

function lowerCall(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const callee = node.expression
  let intrinsicId: string | undefined
  let viaMath = false

  if (ts.isPropertyAccessExpression(callee)) {
    const obj = callee.expression
    if (ts.isIdentifier(obj) && obj.text === 'Math') {
      viaMath = true
      const jsName = callee.name.text
      if (resolveMathConst(jsName) !== undefined) {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `"Math.${jsName}" is a constant, not a function. Write Math.${jsName} without ().`,
        )
        return undefined
      }
      intrinsicId = resolveMathFn(jsName)
      if (!intrinsicId) {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `"Math.${jsName}(...)" is not a TypeShade Math alias. Host APIs (random, imul, clz32, hypot, …) are rejected.`,
        )
        return undefined
      }
    }
  } else if (ts.isIdentifier(callee)) {
    const name = callee.text
    if (name === 'mod' || isCanonicalMathFn(name)) {
      intrinsicId = name
    }
  }

  if (!intrinsicId) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Function calls to user callees are not lowered yet (got "${node.getText(sourceFile)}"). See Phase 6. Math.* and math intrinsics (sin, mod, …) are supported.`,
    )
    return undefined
  }

  const arity = expectedArity(intrinsicId) ?? (intrinsicId === 'mod' ? 2 : undefined)
  const args: Expr[] = []
  for (const arg of node.arguments) {
    const lowered = lowerExpression(arg, sourceFile, scope, diagnostics)
    if (!lowered) return undefined
    args.push(lowered)
  }
  if (arity !== undefined && args.length !== arity) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${viaMath ? 'Math.' : ''}${intrinsicId} expects ${arity} argument(s), got ${args.length}.`,
    )
    return undefined
  }
  if (args.length === 0) {
    pushDiag(diagnostics, sourceFile, node, `Call "${intrinsicId}" needs at least one argument.`)
    return undefined
  }
  return { op: 'call', type: args[0]!.type, fn: intrinsicId, args }
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

export function exprType(expr: Expr): ShaderType {
  return expr.type
}
