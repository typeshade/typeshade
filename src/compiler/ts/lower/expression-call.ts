import ts from 'typescript'
import type { Expr } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { i32T, typeKey, u32T, vec2uT } from '../../../core/ir/types.js'
import { retargetIntLit } from '../lit-coerce.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { LoweringScope } from '../context.js'
import {
  USER_FIRST_BUILTINS,
  expectedArity,
  isCanonicalMathFn,
  resolveMathConst,
  resolveMathExpand,
  resolveMathFn,
} from '../math-alias.js'
import { SCALAR_CAST } from '../numeric.js'
import { foldNumericLit } from '../lit-coerce.js'
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
    // A name #8 A6 added does not shadow a function the file declares: before it, the call
    // resolved to that function, and an addition may not change what a program means.
    const shadowed = USER_FIRST_BUILTINS.has(name) ? scope.resolveCallee(name) : undefined
    if (shadowed) return lowerUserCall(node, shadowed, sourceFile, scope, diagnostics)
    if (name === 'select') return lowerSelectCall(node, sourceFile, scope, diagnostics)
    if (SCALAR_CAST[name]) return lowerScalarCastCall(name, node, sourceFile, scope, diagnostics)
    ctor = VEC_CTOR[name]
    if (!ctor) {
      if (name === 'random') return lowerRandomCall(node, sourceFile, scope, diagnostics)
      if (resolveMathExpand(name))
        return lowerExpandCall(name, node, sourceFile, scope, diagnostics)
      // A texture read is a canonical intrinsic name too, but its arity and result type both
      // depend on the texture argument, so it is routed to lowerTextureCall below rather than
      // through MATH_FN_ARITY, which records neither (#8 A7).
      if (name === 'mod' || TEXTURE_CALLS.has(name) || isCanonicalMathFn(name)) intrinsicId = name
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

  if (intrinsicId !== undefined && TEXTURE_CALLS.has(intrinsicId)) {
    return lowerTextureCall(intrinsicId, args, node, sourceFile, diagnostics)
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

/** The texture reads this surface spells (#8 A7). They are kept out of the generic intrinsic
 *  path for two reasons: `mathResultType` is `args[0].type`, which for a texture call is the
 *  TEXTURE, and each one picks a different neutral id depending on whether the texture is an
 *  array — the same choice the EDSL's overloads make. */
const TEXTURE_CALLS = new Set([
  'textureSample',
  'textureSampleLevel',
  'textureLoad',
  'textureDimensions',
  'textureNumLayers',
])

/**
 * Lower `textureSample(tex, smp, uv)` and its siblings.
 *
 * The id a call becomes is decided by the texture's own `dim`, not by an argument count:
 * `textureSample` on a `texture_2d_array<f32>` is the neutral id `textureSampleArray`, which
 * WGSL spells `textureSample(t, s, uv, layer)` and GLSL ES 3.00 folds into a `vec3`
 * coordinate. That is exactly what `textureSample(tex, smp, uv, layer)` in the EDSL does, so
 * the two surfaces build the same node.
 *
 * @returns the `call` expression, or `undefined` after pushing a diagnostic.
 */
function lowerTextureCall(
  id: string,
  args: readonly Expr[],
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const tex = args[0]
  if (!tex || tex.type.kind !== 'texture') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${id} takes a texture as its first argument.`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  const isArray = tex.type.dim === '2d-array'
  const texel: ShaderType = { kind: 'vec', n: 4, elem: tex.type.elem }
  switch (id) {
    case 'textureDimensions':
      return arity(id, args, 1, node, sourceFile, diagnostics)
        ? { op: 'call', type: vec2uT, fn: id, args: [...args] }
        : undefined
    case 'textureNumLayers':
      if (!isArray) {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `textureNumLayers needs a texture_2d_array; a plain 2D texture has no layers.`,
          TS_CODES.TYPE_MISMATCH,
        )
        return undefined
      }
      return arity(id, args, 1, node, sourceFile, diagnostics)
        ? { op: 'call', type: u32T, fn: id, args: [...args] }
        : undefined
    case 'textureSample':
    case 'textureSampleLevel': {
      // Sampling is float-only on both targets: an integer texture has no filtering, so WGSL
      // gives it no `textureSample` overload at all. textureLoad is the read it does have.
      if (tex.type.elem !== 'f32') {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `${id} needs a float texture; ${typeKey(tex.type)} is read with textureLoad.`,
          TS_CODES.TYPE_MISMATCH,
        )
        return undefined
      }
      const base = id === 'textureSample' ? 3 : 4
      const want = isArray ? base + 1 : base
      if (!arity(id, args, want, node, sourceFile, diagnostics)) return undefined
      const fn = isArray ? `${id}Array` : id
      // The LAYER is an integer; the mip LEVEL of a sampled read is an f32 and is left as
      // written. (`textureSampleLevel`'s level argument sits where the layer does on the
      // non-array form, which is why the index is computed rather than fixed.)
      const out = [...args]
      if (isArray) {
        const layer = intArg(out[3]!, node.arguments[3]!, i32T, 'layer', sourceFile, diagnostics)
        if (!layer) return undefined
        out[3] = layer
      }
      return { op: 'call', type: texel, fn, args: out }
    }
    case 'textureLoad': {
      const want = isArray ? 4 : 3
      if (!arity(id, args, want, node, sourceFile, diagnostics)) return undefined
      // Both the layer and the mip level are integers here. A bare number lowers to f32, and
      // `textureLoad(t, c, 0.0)` is not valid WGSL — the same bug the EDSL fixed in its own
      // layerArg/levelArg (#1703), fixed the same way and with the same types.
      const out = [...args]
      if (isArray) {
        const layer = intArg(out[2]!, node.arguments[2]!, i32T, 'layer', sourceFile, diagnostics)
        if (!layer) return undefined
        out[2] = layer
      }
      const levelIndex = isArray ? 3 : 2
      const level = intArg(
        out[levelIndex]!,
        node.arguments[levelIndex]!,
        u32T,
        'mip level',
        sourceFile,
        diagnostics,
      )
      if (!level) return undefined
      out[levelIndex] = level
      return { op: 'call', type: texel, fn: isArray ? 'textureLoadArray' : id, args: out }
    }
    default:
      return undefined
  }
}

/** A layer or mip-level argument, retyped when it is a bare whole number and REPORTED when it
 *  is a number that cannot be one.
 *
 *  A number written without a decimal point lowers to an f32 on this surface, and WGSL's
 *  `textureLoad` and array sampling take INTEGERS — `textureLoad(t, c, 0.0)` is rejected. An
 *  argument that is not a literal at all is returned as it is, and one that is already an
 *  integer likewise.
 *
 *  A fractional or negative literal is the case this used to wave through, on the claim that a
 *  check downstream would report it. There is none: `textureLoad(t, c, 2.5)`,
 *  `textureLoad(t, c, -1)` and `textureSample(atlas, smp, uv, 1.5)` emitted with zero
 *  diagnostics, Tint refused the WGSL, and GLSL silently rounded — the exact divergence the
 *  EDSL's own layerArg/levelArg raise SD0015 for. Reported here, at the argument, with the
 *  divergence named. */
function intArg(
  arg: Expr,
  node: ts.Expression,
  want: ShaderType,
  what: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  // A NEGATED literal is a unop, not a lit, and reached the backend as `-(1.0)`. Folded first
  // so the range check below sees the number the author wrote.
  const lit = foldNumericLit(arg)
  if (lit.op !== 'lit' || typeof lit.value !== 'number') return arg
  const v = lit.value
  // Negative is refused whatever the target type. A layer is typed i32 because that is the
  // overload WGSL's array sampling takes, not because -1 means anything: both it and a mip
  // level are indices into memory that starts at 0.
  if (!Number.isInteger(v) || v < 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `A texture ${what} must be a whole number of 0 or more, got ${String(v)}. ` +
        `WGSL rejects a fractional or negative one and GLSL ES 3.00 silently rounds it, ` +
        `so the two targets would disagree.`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  if (typeKey(lit.type) === 'i32' || typeKey(lit.type) === 'u32') return lit
  return { op: 'lit', type: want, value: v }
}

/** One arity check, with the message naming what the texture's own shape requires — an array
 *  texture takes the extra layer argument, so the expected count is not a property of the
 *  function name alone. */
function arity(
  id: string,
  args: readonly Expr[],
  want: number,
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  if (args.length === want) return true
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `${id} on a ${typeKey(args[0]!.type)} expects ${want} argument(s), got ${args.length}.`,
    TS_CODES.ARITY_MISMATCH,
  )
  return false
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
