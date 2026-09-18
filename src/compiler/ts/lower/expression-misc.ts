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

/** A call of a function the file declares. `opts.leading` are arguments already lowered
 *  ahead of the written ones (a method's object, #86), and `opts.shown` is how messages name
 *  the callee when the emitted name is not what the writer wrote (`Ray.at`, `new Ray`). */
export function lowerUserCall(
  node: ts.CallExpression | ts.NewExpression,
  decl: FuncDecl,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  opts: { readonly leading?: readonly Expr[]; readonly shown?: string } = {},
): Expr | undefined {
  const leading = opts.leading ?? []
  const shown = opts.shown ?? decl.name
  const written = node.arguments ?? []
  const args: Expr[] = [...leading]
  for (const [i, arg] of written.entries()) {
    // The parameter's type is the context for `g({ a: 1., b: 2. })` (#8 A11). Read by index
    // before the arity check below, so a call with too many arguments still lowers each one
    // and reports the arity rather than a cascade.
    const lowered = lowerExpression(
      arg,
      sourceFile,
      scope,
      diagnostics,
      decl.params[leading.length + i]?.type,
    )
    if (!lowered) return undefined
    args.push(lowered)
  }
  if (args.length !== decl.params.length) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${shown}" expects ${decl.params.length - leading.length} argument(s), got ${written.length}.`,
      TS_CODES.ARITY_MISMATCH,
    )
    return undefined
  }
  for (let i = leading.length; i < args.length; i++) {
    // `g(1)` takes the parameter's type when it is i32 or u32 (#8 A3).
    args[i] = retargetIntLitCtx(args[i]!, written[i - leading.length]!, decl.params[i]!.type)
    if (typeKey(args[i]!.type) !== typeKey(decl.params[i]!.type)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Argument ${i + 1 - leading.length} of "${shown}" type mismatch.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
  }
  return { op: 'call', type: decl.ret, fn: decl.name, args, declRef: decl }
}

export function mathResultType(fn: string, args: readonly Expr[]): ShaderType {
  const first = args[0]!.type
  // `dot` keeps the vectors' element kind (WGSL: dot(vecN<T>, vecN<T>) -> T), so an integer
  // dot product is an integer (#57); the float reductions are f32.
  if (fn === 'dot' && first.kind === 'vec' && first.elem !== 'f32' && first.elem !== 'bool') {
    return { kind: 'scalar', scalar: first.elem }
  }
  if (fn === 'length' || fn === 'distance' || fn === 'dot' || fn === 'determinant') return f32T
  return first
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
