import ts from 'typescript'
import { stageOf } from '../../../core/ir/nodes.js'
import type { Expr, FuncDecl } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { f32T, f64T, typeKey } from '../../../core/ir/types.js'
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
import {
  declaresParamDefault,
  noteFilledCall,
  paramDefault,
  requiredParamCount,
} from './param-defaults.js'
import { eachExpr } from '../../../core/ir/visit.js'

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
  opts: {
    readonly leading?: readonly Expr[]
    readonly shown?: string
    /** The written arguments, already lowered. A generic call lowers them before the callee
     *  exists, to read the type arguments off them (T9, #92); lowering them again here would
     *  report every diagnostic in them twice. */
    readonly lowered?: readonly Expr[]
  } = {},
): Expr | undefined {
  const leading = opts.leading ?? []
  const shown = opts.shown ?? decl.name
  // An entry point may not be called (§52). WGSL says so outright, and the emitted call was
  // accepted here with zero diagnostics — the pipeline invokes an entry, nothing else may.
  // Named on the call, since that is the line to change: the body goes in a helper both the
  // entry and this caller use.
  const stage = stageOf(decl)
  if (stage !== undefined) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${shown}" is a ${stage} entry point and cannot be called; the pipeline invokes it. ` +
        `Move the body into a plain function and call that from both.`,
      TS_CODES.UNSUPPORTED,
    )
    return undefined
  }
  const written = node.arguments ?? []
  const args: Expr[] = [...leading]
  if (opts.lowered !== undefined) args.push(...opts.lowered)
  else {
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
  }
  // A parameter with a default fills itself in here (roadmap 0.3 item T7, #92): WGSL has no
  // default arguments, so the emitted call passes every one. The fill stops at the first
  // parameter without a default, so a call missing a required argument still reports the
  // arity rather than a type mismatch on the wrong argument. A filled argument was lowered
  // and type-checked against its parameter where the default was written, so the loop below
  // stops at `supplied`: there is no written node to retarget an integer literal against.
  const supplied = args.length
  let broken = false
  const owner = scope.owner()
  for (let i = args.length; i < decl.params.length; i++) {
    const filled = paramDefault(decl, i)
    if (!filled) {
      broken = declaresParamDefault(decl, i)
      break
    }
    args.push(filled)
    // The default is spliced into the body that wrote this call, so the calls inside it are
    // that body's as far as the call graph is concerned.
    if (owner) {
      eachExpr(filled, (e) => {
        if (e.op === 'call' && e.declRef !== undefined) noteFilledCall(owner, e.fn, node)
      })
    }
  }
  // A default that did not lower has already been reported at the declaration; the call is
  // not what is wrong with the program, so it adds nothing.
  if (broken) return undefined
  if (args.length !== decl.params.length) {
    const total = decl.params.length - leading.length
    const required = requiredParamCount(decl, leading.length)
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      required === total
        ? `"${shown}" expects ${total} argument(s), got ${written.length}.`
        : `"${shown}" takes ${required} to ${total} argument(s), got ${written.length}.`,
      TS_CODES.ARITY_MISMATCH,
    )
    return undefined
  }
  for (let i = leading.length; i < supplied; i++) {
    // `g(1)` takes the parameter's type when it is i32 or u32 (#8 A3).
    args[i] = retargetIntLitCtx(args[i]!, written[i - leading.length]!, decl.params[i]!.type)
    if (typeKey(args[i]!.type) !== typeKey(decl.params[i]!.type)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Argument ${i + 1 - leading.length} of "${shown}" type mismatch.` +
          scope.inheritanceNote(decl.params[i]!.type, args[i]!.type),
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
  // The same rule one kind over: a reduction of an emulated-double vector is an f64. The fp64
  // pass composes it from the SCALAR df64 error-free transforms and hands back the (hi, lo)
  // pair (passes/fp64-lower.ts, the dot/length/distance arm), and the fn() EDSL types it f64
  // (ir/node.ts); typing it f32 here was a lie the pass then contradicted, so `const l =
  // length(v64)` could not be returned from a function declared `f64` (#151 F64-01).
  if ((fn === 'length' || fn === 'distance' || fn === 'dot') && first.kind === 'vec64') return f64T
  if (fn === 'length' || fn === 'distance' || fn === 'dot' || fn === 'determinant') return f32T
  // transpose(matCxR) -> matRxC (wgsl.txt:23397, "transpose any shape"). Identity on a square
  // matrix, which is why it read as `first` while mat4x4 was the only float matrix.
  if (fn === 'transpose' && first.kind === 'mat') {
    return { kind: 'mat', cols: first.rows, rows: first.cols, elem: first.elem }
  }
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
