import ts from 'typescript'
import type { Expr, FuncDecl } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { f32T, typeKey } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { LoweringScope } from '../context.js'
import { resolveMathExpand } from '../math-alias.js'
import { expandMath } from '../math-expand.js'
import { parseSwizzle } from '../swizzle.js'
import { lowerRandomHash } from '../random-hash.js'
import { lowerScalarCast } from '../numeric.js'
import { retargetIntLitCtx } from '../lit-coerce.js'
import { lowerExpression } from './expression.js'
import { makeDiagnostic } from '../diagnostic.js'
import { TS_CODES, type TsCode } from '../codes.js'

export function lowerScalarCastCall(
  name: string,
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
      `${name}() expects 1 argument.`,
      TS_CODES.ARITY_MISMATCH,
    )
    return undefined
  }
  const arg = lowerExpression(node.arguments[0]!, sourceFile, scope, diagnostics)
  if (!arg) return undefined
  const out = lowerScalarCast(name, arg)
  if (typeof out === 'string') {
    pushDiag(diagnostics, sourceFile, node, out, TS_CODES.TYPE_MISMATCH)
    return undefined
  }
  return out
}

export function lowerExpandCall(
  name: string,
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const id = resolveMathExpand(name)
  if (!id) return undefined
  const args: Expr[] = []
  for (const arg of node.arguments) {
    const lowered = lowerExpression(arg, sourceFile, scope, diagnostics)
    if (!lowered) return undefined
    args.push(lowered)
  }
  const out = expandMath(id, args)
  if (typeof out === 'string') {
    pushDiag(diagnostics, sourceFile, node, out, TS_CODES.TYPE_MISMATCH)
    return undefined
  }
  return out
}

export function lowerSwizzleCall(
  node: ts.CallExpression,
  receiver: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (node.arguments.length !== 1) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'swizzle takes one string argument, e.g. v.swizzle("yxz").',
      TS_CODES.ARITY_MISMATCH,
    )
    return undefined
  }
  const arg = node.arguments[0]!
  if (!ts.isStringLiteral(arg) && !ts.isNoSubstitutionTemplateLiteral(arg)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'swizzle components must be a string literal.',
      TS_CODES.UNSUPPORTED,
    )
    return undefined
  }
  const base = lowerExpression(receiver, sourceFile, scope, diagnostics)
  if (!base) return undefined
  const sw = parseSwizzle(base.type, arg.text)
  if (!sw.ok) {
    pushDiag(diagnostics, sourceFile, node, sw.message, TS_CODES.UNKNOWN_NAME)
    return undefined
  }
  return { op: 'member', type: sw.type, base, field: sw.field }
}

export function lowerRandomCall(
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
      'random(seed) needs one seed (f32 | vec2 | vec3).',
      TS_CODES.ARITY_MISMATCH,
    )
    return undefined
  }
  const seed = lowerExpression(node.arguments[0]!, sourceFile, scope, diagnostics)
  if (!seed) return undefined
  const hashed = lowerRandomHash(seed)
  if (!hashed) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `random(seed) seed must be f32, vec2, or vec3; got ${typeKey(seed.type)}.`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  return hashed
}

export function lowerUserCall(
  node: ts.CallExpression,
  decl: FuncDecl,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const args: Expr[] = []
  for (const [i, arg] of node.arguments.entries()) {
    // The parameter's type is the context for `g({ a: 1., b: 2. })` (#8 A11). Read by index
    // before the arity check below, so a call with too many arguments still lowers each one
    // and reports the arity rather than a cascade.
    const lowered = lowerExpression(arg, sourceFile, scope, diagnostics, decl.params[i]?.type)
    if (!lowered) return undefined
    args.push(lowered)
  }
  if (args.length !== decl.params.length) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${decl.name}" expects ${decl.params.length} argument(s), got ${args.length}.`,
      TS_CODES.ARITY_MISMATCH,
    )
    return undefined
  }
  for (let i = 0; i < args.length; i++) {
    // `g(1)` takes the parameter's type when it is i32 or u32 (#8 A3).
    args[i] = retargetIntLitCtx(args[i]!, node.arguments[i]!, decl.params[i]!.type)
    if (typeKey(args[i]!.type) !== typeKey(decl.params[i]!.type)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Argument ${i + 1} of "${decl.name}" type mismatch.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
  }
  return { op: 'call', type: decl.ret, fn: decl.name, args, declRef: decl }
}

export function mathResultType(fn: string, args: readonly Expr[]): ShaderType {
  if (fn === 'length' || fn === 'distance' || fn === 'dot') return f32T
  return args[0]!.type
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
