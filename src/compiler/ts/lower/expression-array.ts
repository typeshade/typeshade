import ts from 'typescript'
import type { Expr, FuncDecl } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { typeKey } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { LoweringScope } from '../context.js'
import { fillArray, noneOf, unrollMinMax, unrollPred, unrollSum, unrollZip } from '../array-ops.js'
import { mapTsTypeToShaderType } from '../type-map.js'
import { foldNumericLit } from '../lit-coerce.js'
import { lowerExpression } from './expression.js'
import { makeDiagnostic } from '../diagnostic.js'
import { TS_CODES, type TsCode } from '../codes.js'

export function lowerArrayCtor(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const typeArgs = node.typeArguments
  if (!typeArgs || typeArgs.length < 1) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'array<T, N>(...) needs type arguments.',
      TS_CODES.UNKNOWN_TYPE,
    )
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
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `array constructor expects ${n} element(s), got ${args.length}.`,
      TS_CODES.ARITY_MISMATCH,
    )
    return undefined
  }
  return { op: 'construct', type: mapped, args }
}

/** `[a, b, c]` written where an `array<T, N>` is declared, e.g.
 *  `const xs: array<f32, 3> = [1., 2., 3.]` (#8 A16). It builds the SAME `construct` node the
 *  `array<f32, 3>(1., 2., 3.)` call builds, so the two spellings are one program — pinned by a
 *  test that compares the two bodies. The list form carries no type of its own, which is why it
 *  is only accepted where one is declared and why `target` is passed in rather than inferred.
 *
 *  Unlike the call form it checks its elements, because it can: `target` says what each element
 *  must be. A bare numeric literal is retyped to the element type first — the same retarget the
 *  scalar declaration does for `const x: i32 = 1` — so `array<i32, 3> = [1, 2, 3]` emits
 *  `array<i32, 3>(1, 2, 3)` rather than the float literals an i32 array cannot take. */
export function lowerArrayLiteral(
  node: ts.ArrayLiteralExpression,
  target: ShaderType,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (target.kind !== 'array') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `An array literal needs a declared array type, got ${typeKey(target)}.`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  if (target.size === undefined) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `A list needs a fixed size to fill: write the size, e.g. array<${typeKey(target.elem)}, ${node.elements.length}>.`,
      TS_CODES.UNKNOWN_TYPE,
    )
    return undefined
  }
  for (const element of node.elements) {
    // Checked before the count: `[...xs]` is one element syntactically, so counting it first
    // would report an arity the author never wrote.
    if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) {
      pushDiag(
        diagnostics,
        sourceFile,
        element,
        'An array literal element must be a value; a spread or a hole is not supported.',
        TS_CODES.UNSUPPORTED,
      )
      return undefined
    }
  }
  if (node.elements.length !== target.size) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `array<${typeKey(target.elem)}, ${target.size}> takes ${target.size} element(s), got ${node.elements.length}.`,
      TS_CODES.ARITY_MISMATCH,
    )
    return undefined
  }
  const args: Expr[] = []
  for (const [i, element] of node.elements.entries()) {
    let lowered = lowerExpression(element, sourceFile, scope, diagnostics)
    if (!lowered) return undefined
    // Only a number the author WROTE is retyped. `i32(2)` is a written type, not a literal
    // waiting for one, so it stays i32 and is reported against an f32 element below — the same
    // line the scalar declaration draws for `const x: f32 = i32(2)`.
    if (isBareNumericLiteral(element) && isNumericScalar(target.elem)) {
      // Folded first, so a leading minus is part of the number: `-1` reaches here as a unop
      // over a literal, and an i32 array would otherwise be told its element is an f32.
      const folded = foldNumericLit(lowered)
      if (folded.op === 'lit' && typeof folded.value === 'number') {
        lowered = { op: 'lit', type: target.elem, value: folded.value }
      }
    }
    if (typeKey(lowered.type) !== typeKey(target.elem)) {
      pushDiag(
        diagnostics,
        sourceFile,
        element,
        `array<${typeKey(target.elem)}, ${target.size}> element ${i} must be ${typeKey(target.elem)}, got ${typeKey(lowered.type)}. There is no implicit conversion; cast it.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    args.push(lowered)
  }
  return { op: 'construct', type: target, args }
}

/** A number as written in the source — `1.`, `2`, `-3` — through parentheses and a leading
 *  minus. Not `i32(2)`, which states its own type. */
function isBareNumericLiteral(node: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(node)) return isBareNumericLiteral(node.expression)
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    return isBareNumericLiteral(node.operand)
  }
  return ts.isNumericLiteral(node)
}

function isNumericScalar(t: ShaderType): boolean {
  const k = typeKey(t)
  return k === 'f32' || k === 'i32' || k === 'u32'
}

export function lowerFill(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const typeArgs = node.typeArguments
  if (!typeArgs || typeArgs.length < 2) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'fill<T, N>(v) needs type arguments.',
      TS_CODES.UNKNOWN_TYPE,
    )
    return undefined
  }
  const fakeRef = ts.factory.createTypeReferenceNode('array', [...typeArgs])
  const mapped = mapTsTypeToShaderType(fakeRef, sourceFile, diagnostics)
  if (!mapped || mapped.kind !== 'array' || mapped.size === undefined) {
    pushDiag(diagnostics, sourceFile, node, 'fill<T, N>(v) needs a fixed N.', TS_CODES.UNKNOWN_TYPE)
    return undefined
  }
  if (node.arguments.length !== 1) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'fill<T, N>(v) expects 1 value.',
      TS_CODES.ARITY_MISMATCH,
    )
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
      pushDiag(diagnostics, sourceFile, node, 'sum(xs) needs an array.', TS_CODES.ARITY_MISMATCH)
      return undefined
    }
    const out = unrollSum(first)
    if (typeof out === 'string') {
      pushDiag(diagnostics, sourceFile, node, out, TS_CODES.TYPE_MISMATCH)
      return undefined
    }
    return out
  }
  if ((name === 'min' || name === 'max') && asArray && args.length === 1) {
    const out = unrollMinMax(name, first!)
    if (typeof out === 'string') {
      pushDiag(diagnostics, sourceFile, node, out, TS_CODES.TYPE_MISMATCH)
      return undefined
    }
    return out
  }
  if (name === 'any' || name === 'all' || name === 'none') {
    if (!first || predDecls.length !== 1) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `${name}(xs, pred) needs an array and a predicate function.`,
        TS_CODES.ARITY_MISMATCH,
      )
      return undefined
    }
    const out = unrollPred(first, predDecls[0]!, name === 'all' ? '&&' : '||')
    if (typeof out === 'string') {
      pushDiag(diagnostics, sourceFile, node, out, TS_CODES.TYPE_MISMATCH)
      return undefined
    }
    return name === 'none' ? noneOf(out) : out
  }
  if (name === 'zip') {
    if (args.length !== 2 || predDecls.length !== 1) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        'zip(xs, ys, fn) needs two arrays and a function.',
        TS_CODES.ARITY_MISMATCH,
      )
      return undefined
    }
    const out = unrollZip(args[0]!, args[1]!, predDecls[0]!)
    if (typeof out === 'string') {
      pushDiag(diagnostics, sourceFile, node, out, TS_CODES.TYPE_MISMATCH)
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
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code))
}
