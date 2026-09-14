import ts from 'typescript'
import type { Expr } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { f32T, i32T, u32T } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { LoweringScope } from '../context.js'
import {
  expectedArity,
  isCanonicalMathFn,
  resolveMathConst,
  resolveMathExpand,
  resolveMathFn,
} from '../math-alias.js'
import { SCALAR_CAST, literalPeerType } from '../numeric.js'
import { retargetIntLitCtx } from '../lit-coerce.js'
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
    // `vec3u(1, 2, 3)` types each bare integer literal as the constructor's element kind
    // (#8 A3); an f32 constructor changes nothing, since retargetIntLitCtx only acts on an
    // integer target.
    const elem = ctorElemType(ctor.elem)
    if (elem) {
      for (let i = 0; i < args.length; i++) {
        args[i] = retargetIntLitCtx(args[i]!, node.arguments[i]!, elem)
      }
    }
    if (args.length === 1 && isVectorCtorScalar(args[0]!.type, ctor.elem)) {
      const splat = args[0]!
      return {
        op: 'construct',
        type: vectorCtorType(ctor.n, ctor.elem),
        args: Array.from({ length: ctor.n }, () => splat),
      }
    }
    // vecN<T>(v: vecN<S>) — WGSL's element-converting constructor (`vec3f(v)`, `vec3u(v)`,
    // `vec2(gid.xy)`), which GLSL ES 3.00 spells the same way (`vec3(uv)`) and which the
    // EDSL's `vec3(v)` already builds as this very node: one argument, a vector of the same
    // size, a different element kind, every component converted. It is checked before the
    // component-count and element rules below, which are about composing a vector out of
    // parts and would reject it as an element-type mismatch.
    if (args.length === 1 && isConvertibleVector(args[0]!.type, ctor)) {
      return { op: 'construct', type: vectorCtorType(ctor.n, ctor.elem), args }
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
  // `min(i, 4)` with `i` an i32 types the 4 as i32 (#8 A3). Before this the literal stayed
  // f32 and the call emitted `min(i, 4.0)`, which is not valid WGSL — the one place this
  // item changes the emitted text of source the front end already accepted.
  retargetIntrinsicLiterals(args, node, intrinsicId)
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

/** The scalar type a vector constructor's components must have, or undefined for the
 *  emulated-double constructor, whose components the fp64 pass assembles. */
function ctorElemType(elem: 'f32' | 'i32' | 'u32' | 'f64'): ShaderType | undefined {
  if (elem === 'f32') return f32T
  if (elem === 'i32') return i32T
  if (elem === 'u32') return u32T
  return undefined
}

/** A number written out, with no type of its own: `4`, `-2`, `0.5`. The peer of a builtin
 *  call's literal arguments is the first argument that is not one of these, since a written
 *  number is exactly what has no type to lend. `u32(1)` is a call, not one of these, even
 *  though it lowers to a literal. */
function isBareNumericLiteral(node: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(node)) return isBareNumericLiteral(node.expression)
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    return isBareNumericLiteral(node.operand)
  }
  return ts.isNumericLiteral(node)
}

/** A bare integer literal argument of a builtin call takes the kind of the call's other
 *  arguments (#8 A3): `min(i, 4)` with `i` an i32 makes the 4 an i32, and `clamp(x, 0, 1)`
 *  with `x` an f32 leaves both literals f32, since retargetIntLitCtx only acts on an integer
 *  target. The peer is the element scalar of the first argument that is not itself a written
 *  number, so `min(u32(1), 2)` types the 2 as u32. A call with nothing but written numbers has
 *  no peer and is left alone.
 *
 *  The FIRST argument is never retargeted, whatever the peer says: `mathResultType` is
 *  `args[0].type`, so a literal there types the whole call rather than itself. See the loop.
 *  Mutates `args` in place. */
function retargetIntrinsicLiterals(
  args: Expr[],
  node: ts.CallExpression,
  intrinsicId: string,
): void {
  if (intrinsicId === 'length' || intrinsicId === 'distance' || intrinsicId === 'dot') return
  const peerIndex = node.arguments.findIndex((a) => !isBareNumericLiteral(a))
  const peer = peerIndex >= 0 ? args[peerIndex]?.type : undefined
  if (!peer) return
  const target = literalPeerType(peer)
  for (let i = 1; i < args.length; i++) {
    // From 1, never 0: `mathResultType` is `args[0].type`, so retargeting a literal in the
    // FIRST position does not just retype that argument, it retypes the whole call. A sweep
    // over the intrinsics found 42 programs changed by that — 24 that compiled before and
    // errored after (`max(1, i)` became an i32 call and no longer fit an f32 position) and 18
    // whose emit moved. Retargeting only the later arguments keeps the case this item is
    // about, `min(i, 4)`, because there the peer is the first argument and the literal is not.
    //
    // What it leaves alone is `min(1, i)`, a literal in the type-deciding position, which
    // still types the call f32 and emits `min(1.0, i)` — invalid WGSL, exactly as on main.
    // Fixing that means changing how an intrinsic call's result type is decided, which is a
    // change to every intrinsic rather than to this rule, and is not additive.
    const argNode = node.arguments[i]
    if (!argNode) continue
    args[i] = retargetIntLitCtx(args[i]!, argNode, target)
  }
}

function vectorCtorType(n: 2 | 3 | 4, elem: 'f32' | 'i32' | 'u32' | 'f64'): ShaderType {
  if (elem === 'f64') return { kind: 'vec64', n }
  return { kind: 'vec', n, elem }
}

/** True for the one argument shape {@link lowerCall} converts rather than composes: a native
 *  vector of the constructor's own size whose element kind differs. Both sides must be native
 *  (f32 / i32 / u32) — an emulated-double vector is not converted here, since a vec64 is a
 *  pair of f32 lanes the fp64 pass assembles, not a component list to reinterpret. */
function isConvertibleVector(
  t: ShaderType,
  ctor: { n: 2 | 3 | 4; elem: 'f32' | 'i32' | 'u32' | 'f64' },
): boolean {
  if (ctor.elem === 'f64') return false
  return t.kind === 'vec' && t.n === ctor.n && t.elem !== ctor.elem
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
