import ts from 'typescript'
import type { Expr, FuncDecl } from '../../../core/ir/nodes.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { LoweringScope } from '../context.js'
import { fillArray, noneOf, unrollMinMax, unrollPred, unrollSum, unrollZip } from '../array-ops.js'
import { mapTsTypeToShaderType } from '../type-map.js'
import { USER_FIRST_BUILTINS, isCanonicalMathFn } from '../math-alias.js'
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
      if (decl && intrinsicFirst(arg.text)) {
        // The precedence `lowerCall` applies, applied here too: a name that was a builtin
        // before #8 A6 stays the intrinsic even when the file declares a function of that
        // name, so a fold cannot hand the declaration to `unrollZip` and stamp a `declRef` on
        // the calls it builds. One stamped call would put the name in the emitter's per-module
        // set and redirect every plain `atan(y, x)` in the file to the declaration on GLSL
        // while the CPU oracle kept the intrinsic. There is no intrinsic-valued callback in a
        // fold today, so the honest answer is a diagnostic that names the rule.
        pushDiag(
          diagnostics,
          sourceFile,
          arg,
          `"${arg.text}" is a builtin, and a declared function of that name does not shadow it; ${name} takes a function declared in this file under another name.`,
          TS_CODES.TYPE_MISMATCH,
        )
        return undefined
      }
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

/** A builtin name a declaration does NOT win: every canonical math id and `mod`, except the
 *  names #8 A6 added, which resolve to the file's own function first (`USER_FIRST_BUILTINS`).
 *  Mirrors the order `lowerCall` checks in, so a fold and a plain call agree on what a name
 *  means. */
function intrinsicFirst(name: string): boolean {
  return !USER_FIRST_BUILTINS.has(name) && (name === 'mod' || isCanonicalMathFn(name))
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
