import ts from 'typescript'
import type { Expr } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { typeKey } from '../../../core/ir/types.js'
import { retargetIntLit } from '../lit-coerce.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { LoweringScope } from '../context.js'
import {
  expectedArity,
  isCanonicalMathFn,
  resolveMathConst,
  resolveMathExpand,
  resolveMathFn,
} from '../math-alias.js'
import { SCALAR_CAST } from '../numeric.js'
import { lowerExpression } from './expression.js'
import { JS_ARRAY_METHODS } from './expression-prop.js'
import { lowerArrayCtor, lowerArrayFold, lowerFill } from './expression-array.js'
import {
  lowerExpandCall,
  lowerRandomCall,
  lowerScalarCastCall,
  lowerSwizzleCall,
  lowerUserCall,
  mathResultType,
} from './expression-misc.js'
import { makeDiagnostic } from '../diagnostic.js'
import { TS_CODES, type TsCode } from '../codes.js'

const VEC_CTOR: Readonly<Record<string, { n: 2 | 3 | 4; elem: 'f32' | 'i32' | 'u32' | 'f64' }>> = {
  vec2: { n: 2, elem: 'f32' },
  vec2f: { n: 2, elem: 'f32' },
  vec2i: { n: 2, elem: 'i32' },
  vec2u: { n: 2, elem: 'u32' },
  vec2f64: { n: 2, elem: 'f64' },
  vec3: { n: 3, elem: 'f32' },
  vec3f: { n: 3, elem: 'f32' },
  vec3i: { n: 3, elem: 'i32' },
  vec3u: { n: 3, elem: 'u32' },
  vec3f64: { n: 3, elem: 'f64' },
  vec4: { n: 4, elem: 'f32' },
  vec4f: { n: 4, elem: 'f32' },
  vec4i: { n: 4, elem: 'i32' },
  vec4u: { n: 4, elem: 'u32' },
  vec4f64: { n: 4, elem: 'f64' },
}

export function lowerCall(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const callee = node.expression
  let intrinsicId: string | undefined
  let viaMath = false
  let ctor: { n: 2 | 3 | 4; elem: 'f32' | 'i32' | 'u32' | 'f64' } | undefined

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
          `"Math.${jsName}" is a constant, not a function.`,
          TS_CODES.UNSUPPORTED,
        )
        return undefined
      }
      if (jsName === 'random') return lowerRandomCall(node, sourceFile, scope, diagnostics)
      if (resolveMathExpand(jsName))
        return lowerExpandCall(jsName, node, sourceFile, scope, diagnostics)
      intrinsicId = resolveMathFn(jsName)
      if (!intrinsicId) {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `"Math.${jsName}(...)" is not a TypeShade Math alias.`,
          TS_CODES.UNKNOWN_NAME,
        )
        return undefined
      }
    } else if (callee.name.text === 'swizzle') {
      return lowerSwizzleCall(node, callee.expression, sourceFile, scope, diagnostics)
    } else if (JS_ARRAY_METHODS.has(callee.name.text)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `JS Array method ".${callee.name.text}" is not a shader op. Use sum/min/any/all/zip/fill.`,
        TS_CODES.UNSUPPORTED,
      )
      return undefined
    } else {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        'Method calls are not supported. Use free functions.',
        TS_CODES.UNSUPPORTED,
      )
      return undefined
    }
  } else if (ts.isIdentifier(callee)) {
    const name = callee.text
    if (name === 'array') return lowerArrayCtor(node, sourceFile, scope, diagnostics)
    if (name === 'fill') return lowerFill(node, sourceFile, scope, diagnostics)
    if (
      name === 'sum' ||
      name === 'min' ||
      name === 'max' ||
      name === 'any' ||
      name === 'all' ||
      name === 'none' ||
      name === 'zip'
    ) {
      const folded = lowerArrayFold(name, node, sourceFile, scope, diagnostics)
      if (folded !== 'fallback') return folded
    }
    if (name === 'select' && !scope.resolveCallee(name)) {
      return lowerSelectCall(node, sourceFile, scope, diagnostics)
    }
    if (SCALAR_CAST[name]) return lowerScalarCastCall(name, node, sourceFile, scope, diagnostics)
    ctor = VEC_CTOR[name]
    if (!ctor) {
      if (name === 'random') return lowerRandomCall(node, sourceFile, scope, diagnostics)
      if (resolveMathExpand(name))
        return lowerExpandCall(name, node, sourceFile, scope, diagnostics)
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
    if (args.length === 1 && isVectorCtorScalar(args[0]!.type, ctor.elem)) {
      const splat = args[0]!
      return {
        op: 'construct',
        type: vectorCtorType(ctor.n, ctor.elem),
        args: Array.from({ length: ctor.n }, () => splat),
      }
    }
    // fp64 lowering represents vecN<f64> as DF64VecN, while the constructor
    // contract is component-based. Flatten vec64 arguments here so the fp64 pass
    // only has to lower scalar f64 constructor components; it can then reassemble
    // the target DF64VecN from those scalar pairs without treating a whole vec64 as
    // an f64 operand.
    const ctorArgs = ctor.elem === 'f64' ? flattenF64VectorArgs(args) : args
    if (vectorComponentCount(ctorArgs) !== ctor.n) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        'Vector constructor component count mismatch.',
        TS_CODES.ARITY_MISMATCH,
      )
      return undefined
    }
    const badArg = ctorArgs.find((arg) => !isVectorCtorArg(arg.type, ctor.elem))
    if (badArg) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Vector constructor element type mismatch: expected ${ctor.elem}.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    return { op: 'construct', type: vectorCtorType(ctor.n, ctor.elem), args: ctorArgs }
  }

  if (!intrinsicId) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Unknown function "${node.getText(sourceFile)}". Function calls (Phase 6) need a visible callee.`,
      TS_CODES.UNKNOWN_FN,
    )
    return undefined
  }
  // atan(y, x) is WGSL's and GLSL's two-argument arctangent, which the IR carries under the
  // neutral id atan2 (`atan2(y, x)` in WGSL, `atan(y, x)` in GLSL). One argument stays atan.
  if (intrinsicId === 'atan' && args.length === 2) intrinsicId = 'atan2'
  else if (intrinsicId === 'atan' && args.length !== 1) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${viaMath ? 'Math.' : ''}atan expects 1 argument, or 2 for atan(y, x), got ${args.length}.`,
      TS_CODES.ARITY_MISMATCH,
    )
    return undefined
  }
  const arity = expectedArity(intrinsicId) ?? (intrinsicId === 'mod' ? 2 : undefined)
  if (arity !== undefined && args.length !== arity) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${viaMath ? 'Math.' : ''}${intrinsicId} expects ${arity} argument(s), got ${args.length}.`,
      TS_CODES.ARITY_MISMATCH,
    )
    return undefined
  }
  if (args.length === 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Call "${intrinsicId}" needs at least one argument.`,
      TS_CODES.ARITY_MISMATCH,
    )
    return undefined
  }
  return { op: 'call', type: mathResultType(intrinsicId, args), fn: intrinsicId, args }
}

/** `select(falseValue, trueValue, cond)` — WGSL's argument order, which is what this surface
 *  follows (the EDSL's free `select(cond, a, b)` puts the condition first; #8 S-seam notes the
 *  difference and keeps each surface's own order). It lowers to the `select` Expr op, the very
 *  node `cond ? trueValue : falseValue` already lowers to, so the two spellings are one IR and
 *  the backends spell it as `select(f, t, c)` in WGSL and `(c ? t : f)` in GLSL. It is not a
 *  call: the oracle and both writers handle `select` as an Expr, never as an intrinsic call. */
function lowerSelectCall(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (node.arguments.length !== 3) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `select expects 3 argument(s), got ${node.arguments.length}. ` +
        "The order is WGSL's: select(falseValue, trueValue, cond).",
      TS_CODES.ARITY_MISMATCH,
    )
    return undefined
  }
  const lowered: Expr[] = []
  for (const arg of node.arguments) {
    const one = lowerExpression(arg, sourceFile, scope, diagnostics)
    if (!one) return undefined
    lowered.push(one)
  }
  let [ifFalse, ifTrue] = lowered as [Expr, Expr]
  const cond = lowered[2]!
  if (typeKey(cond.type) !== 'bool') {
    pushDiag(
      diagnostics,
      sourceFile,
      node.arguments[2]!,
      `select condition must be bool, got ${typeKey(cond.type)}. ` +
        "The order is WGSL's: select(falseValue, trueValue, cond).",
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  ifFalse = retargetIntLit(ifFalse, node.arguments[0]!, ifTrue.type)
  ifTrue = retargetIntLit(ifTrue, node.arguments[1]!, ifFalse.type)
  if (typeKey(ifTrue.type) !== typeKey(ifFalse.type)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `select arm type mismatch: ${typeKey(ifFalse.type)} vs ${typeKey(ifTrue.type)}.`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  return { op: 'select', type: ifTrue.type, cond, ifTrue, ifFalse }
}

function vectorCtorType(n: 2 | 3 | 4, elem: 'f32' | 'i32' | 'u32' | 'f64'): ShaderType {
  if (elem === 'f64') return { kind: 'vec64', n }
  return { kind: 'vec', n, elem }
}

function isVectorCtorScalar(t: ShaderType, elem: 'f32' | 'i32' | 'u32' | 'f64'): boolean {
  if (elem === 'f64') return t.kind === 'f64'
  return t.kind === 'scalar' && t.scalar === elem
}

function isVectorCtorArg(t: ShaderType, elem: 'f32' | 'i32' | 'u32' | 'f64'): boolean {
  if (elem === 'f64') return t.kind === 'f64' || t.kind === 'vec64'
  return isVectorCtorScalar(t, elem) || (t.kind === 'vec' && t.elem === elem)
}

function flattenF64VectorArgs(args: readonly Expr[]): Expr[] {
  const flattened: Expr[] = []
  for (const arg of args) {
    if (arg.type.kind !== 'vec64') {
      flattened.push(arg)
      continue
    }
    for (const field of 'xyzw'.slice(0, arg.type.n)) {
      flattened.push({ op: 'member', type: { kind: 'f64' }, base: arg, field })
    }
  }
  return flattened
}

function vectorComponentCount(args: readonly Expr[]): number {
  return args.reduce((count, arg) => {
    if (arg.type.kind === 'vec' || arg.type.kind === 'vec64') return count + arg.type.n
    return count + 1
  }, 0)
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
