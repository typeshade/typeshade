// === Expression lowering ===
import ts from 'typescript'
import type { Expr, BinOp, CmpOp, LogOp, FuncDecl } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { f32T, boolT, vec2fT, vec3fT, vec4fT, typeKey } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { LoweringScope } from '../context.js'
import {
  expectedArity,
  isCanonicalMathFn,
  resolveLangConst,
  resolveMathConst,
  resolveMathFn,
} from '../math-alias.js'
import { parseSwizzle } from '../swizzle.js'
import { lowerRandomHash } from '../random-hash.js'

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
const VEC_CTOR: Readonly<Record<string, { n: number; type: ShaderType }>> = {
  vec2: { n: 2, type: vec2fT },
  vec2f: { n: 2, type: vec2fT },
  vec3: { n: 3, type: vec3fT },
  vec3f: { n: 3, type: vec3fT },
  vec4: { n: 4, type: vec4fT },
  vec4f: { n: 4, type: vec4fT },
}

export function lowerExpression(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (ts.isParenthesizedExpression(node)) return lowerExpression(node.expression, sourceFile, scope, diagnostics)
  if (ts.isIdentifier(node)) return lowerIdentifier(node, sourceFile, scope, diagnostics)
  if (ts.isNumericLiteral(node)) return { op: 'lit', type: f32T, value: Number(node.text) }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { op: 'lit', type: boolT, value: true }
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { op: 'lit', type: boolT, value: false }
  if (ts.isPrefixUnaryExpression(node)) return lowerPrefixUnary(node, sourceFile, scope, diagnostics)
  if (ts.isBinaryExpression(node)) return lowerBinary(node, sourceFile, scope, diagnostics)
  if (ts.isCallExpression(node)) return lowerCall(node, sourceFile, scope, diagnostics)
  if (ts.isPropertyAccessExpression(node)) return lowerPropertyAccess(node, sourceFile, scope, diagnostics)
  pushDiag(diagnostics, sourceFile, node, `Unsupported expression "${node.getText(sourceFile)}".`)
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
    const c = resolveLangConst(node.text)
    if (c !== undefined) return { op: 'lit', type: f32T, value: c }
    pushDiag(diagnostics, sourceFile, node, `Unknown identifier "${node.text}".`)
    return undefined
  }
  if (binding.kind === 'param') return { op: 'param', type: binding.type, name: binding.name }
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
  if (node.operator === ts.SyntaxKind.MinusToken) return { op: 'unop', type: operand.type, a: operand }
  if (node.operator === ts.SyntaxKind.ExclamationToken) {
    if (typeKey(operand.type) !== 'bool') {
      pushDiag(diagnostics, sourceFile, node, `Unary "!" requires a bool operand, got ${typeKey(operand.type)}.`)
      return undefined
    }
    return { op: 'compare', type: boolT, cop: '==', a: operand, b: { op: 'lit', type: boolT, value: false } }
  }
  pushDiag(diagnostics, sourceFile, node, 'Unsupported unary operator.')
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
      pushDiag(diagnostics, sourceFile, node, `Arithmetic operand type mismatch.`)
      return undefined
    }
    return { op: 'binop', type: left.type, bop: arith, a: left, b: right }
  }
  const bit = BITWISE[node.operatorToken.kind]
  if (bit !== undefined) {
    if (typeKey(left.type) !== typeKey(right.type)) {
      pushDiag(diagnostics, sourceFile, node, 'Bitwise operand type mismatch.')
      return undefined
    }
    return { op: 'binop', type: left.type, bop: bit, a: left, b: right }
  }
  const log = LOGICAL[node.operatorToken.kind]
  if (log !== undefined) {
    if (typeKey(left.type) !== 'bool' || typeKey(right.type) !== 'bool') {
      pushDiag(diagnostics, sourceFile, node, `Logical "${log}" requires bool operands.`)
      return undefined
    }
    return { op: 'logical', type: boolT, lop: log, a: left, b: right }
  }
  const cmp = COMPARE[node.operatorToken.kind]
  if (cmp !== undefined) {
    if (typeKey(left.type) !== typeKey(right.type)) {
      pushDiag(diagnostics, sourceFile, node, 'Comparison operand type mismatch.')
      return undefined
    }
    return { op: 'compare', type: boolT, cop: cmp, a: left, b: right }
  }
  if (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken || node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken) {
    pushDiag(diagnostics, sourceFile, node, 'Use strict equality === / !==.')
    return undefined
  }
  if (node.operatorToken.kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken) {
    pushDiag(diagnostics, sourceFile, node, 'Unsigned right shift >>> is not supported.')
    return undefined
  }
  pushDiag(diagnostics, sourceFile, node, 'Unsupported binary operator.')
  return undefined
}

function lowerPropertyAccess(
  node: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const obj = node.expression
  const prop = node.name.text
  if (ts.isIdentifier(obj) && obj.text === 'Math') {
    const value = resolveMathConst(prop)
    if (value !== undefined) return { op: 'lit', type: f32T, value }
    if (resolveMathFn(prop)) {
      pushDiag(diagnostics, sourceFile, node, `"Math.${prop}" is a function alias. Call it.`)
      return undefined
    }
    pushDiag(diagnostics, sourceFile, node, `"Math.${prop}" is not a TypeShade alias.`)
    return undefined
  }
  const base = lowerExpression(obj, sourceFile, scope, diagnostics)
  if (!base) return undefined
  const sw = parseSwizzle(base.type, prop)
  if (!sw.ok) {
    pushDiag(diagnostics, sourceFile, node, sw.message)
    return undefined
  }
  return { op: 'member', type: sw.type, base, field: sw.field }
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
  let ctor: { n: number; type: ShaderType } | undefined

  if (ts.isPropertyAccessExpression(callee)) {
    const obj = callee.expression
    if (ts.isIdentifier(obj) && obj.text === 'Math') {
      viaMath = true
      const jsName = callee.name.text
      if (resolveMathConst(jsName) !== undefined) {
        pushDiag(diagnostics, sourceFile, node, `"Math.${jsName}" is a constant, not a function.`)
        return undefined
      }
      if (jsName === 'random') return lowerRandomCall(node, sourceFile, scope, diagnostics)
      intrinsicId = resolveMathFn(jsName)
      if (!intrinsicId) {
        pushDiag(diagnostics, sourceFile, node, `"Math.${jsName}(...)" is not a TypeShade Math alias.`)
        return undefined
      }
    } else if (callee.name.text === 'swizzle') {
      return lowerSwizzleCall(node, callee.expression, sourceFile, scope, diagnostics)
    } else {
      pushDiag(diagnostics, sourceFile, node, 'Method calls are not supported. Use free functions.')
      return undefined
    }
  } else if (ts.isIdentifier(callee)) {
    const name = callee.text
    ctor = VEC_CTOR[name]
    if (!ctor) {
      if (name === 'random') return lowerRandomCall(node, sourceFile, scope, diagnostics)
      if (name === 'mod' || isCanonicalMathFn(name)) intrinsicId = name
      else {
        const decl = scope.resolveCallee(name)
        if (decl) return lowerUserCall(node, decl, sourceFile, scope, diagnostics)
      }
    }
  }

  const args: Expr[] = []
  for (const arg of node.arguments) {
    const lowered = lowerExpression(arg, sourceFile, scope, diagnostics)
    if (!lowered) return undefined
    args.push(lowered)
  }

  if (ctor) {
    if (args.length === 1 && isNumericScalar(args[0]!.type)) {
      const splat = args[0]!
      return { op: 'construct', type: ctor.type, args: Array.from({ length: ctor.n }, () => splat) }
    }
    if (args.length !== ctor.n) {
      pushDiag(diagnostics, sourceFile, node, 'Vector constructor arity mismatch.')
      return undefined
    }
    return { op: 'construct', type: ctor.type, args }
  }

  if (!intrinsicId) {
    pushDiag(diagnostics, sourceFile, node, `Unknown function "${node.getText(sourceFile)}".`)
    return undefined
  }
  const arity = expectedArity(intrinsicId) ?? (intrinsicId === 'mod' ? 2 : undefined)
  if (arity !== undefined && args.length !== arity) {
    pushDiag(diagnostics, sourceFile, node, `${viaMath ? 'Math.' : ''}${intrinsicId} expects ${arity} argument(s), got ${args.length}.`)
    return undefined
  }
  if (args.length === 0) {
    pushDiag(diagnostics, sourceFile, node, `Call "${intrinsicId}" needs at least one argument.`)
    return undefined
  }
  return { op: 'call', type: args[0]!.type, fn: intrinsicId, args }
}

function lowerSwizzleCall(
  node: ts.CallExpression,
  receiver: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (node.arguments.length !== 1) {
    pushDiag(diagnostics, sourceFile, node, 'swizzle takes one string argument, e.g. v.swizzle("yxz").')
    return undefined
  }
  const arg = node.arguments[0]!
  if (!ts.isStringLiteral(arg) && !ts.isNoSubstitutionTemplateLiteral(arg)) {
    pushDiag(diagnostics, sourceFile, node, 'swizzle components must be a string literal.')
    return undefined
  }
  const base = lowerExpression(receiver, sourceFile, scope, diagnostics)
  if (!base) return undefined
  const sw = parseSwizzle(base.type, arg.text)
  if (!sw.ok) {
    pushDiag(diagnostics, sourceFile, node, sw.message)
    return undefined
  }
  return { op: 'member', type: sw.type, base, field: sw.field }
}

function lowerRandomCall(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (node.arguments.length !== 1) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'random(seed) needs one seed (f32 | vec2 | vec3). No argument-less GPU Math.random.',
    )
    return undefined
  }
  const seed = lowerExpression(node.arguments[0]!, sourceFile, scope, diagnostics)
  if (!seed) return undefined
  const hashed = lowerRandomHash(seed)
  if (!hashed) {
    pushDiag(diagnostics, sourceFile, node, `random(seed) seed must be f32, vec2, or vec3; got ${typeKey(seed.type)}.`)
    return undefined
  }
  return hashed
}

function lowerUserCall(
  node: ts.CallExpression,
  decl: FuncDecl,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const args: Expr[] = []
  for (const arg of node.arguments) {
    const lowered = lowerExpression(arg, sourceFile, scope, diagnostics)
    if (!lowered) return undefined
    args.push(lowered)
  }
  if (args.length !== decl.params.length) {
    pushDiag(diagnostics, sourceFile, node, `"${decl.name}" expects ${decl.params.length} argument(s), got ${args.length}.`)
    return undefined
  }
  for (let i = 0; i < args.length; i++) {
    if (typeKey(args[i]!.type) !== typeKey(decl.params[i]!.type)) {
      pushDiag(diagnostics, sourceFile, node, `Argument ${i + 1} of "${decl.name}" type mismatch.`)
      return undefined
    }
  }
  return { op: 'call', type: decl.ret, fn: decl.name, args, declRef: decl }
}

function isNumericScalar(t: ShaderType): boolean {
  const k = typeKey(t)
  return k === 'f32' || k === 'i32' || k === 'u32'
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

export function exprType(expr: Expr): ShaderType {
  return expr.type
}
