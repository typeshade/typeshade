import ts from 'typescript'
import type { Expr } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import {
  boolT,
  f32T,
  f64T,
  i32T,
  isF64,
  storageTexel,
  typeKey,
  u32T,
  vec2fT,
  vec2uT,
  vec3uT,
  vec4fT,
  voidT,
} from '../../../core/ir/types.js'
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
import { SCALAR_CAST, literalPeerType } from '../numeric.js'
import { foldNumericLit, retargetIntLit, retargetIntLitCtx } from '../lit-coerce.js'
import { spanOf } from '../span.js'
import { lowerExpression } from './expression.js'
import { JS_ARRAY_METHODS, arrayLengthOf } from './expression-prop.js'
import { lowerAtomicCall } from './atomics.js'
import { lowerClassCall } from './class-methods.js'
import { isAtomicIntrinsic, isBarrierIntrinsic } from '../../../core/intrinsics.js'
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
import { HOST_GLOBALS } from '../semantic.js'
import { TS_CODES, type TsCode } from '../codes.js'
import { checkMathArgs, mathTakesElem } from './math-args.js'
import { isConsoleMethod } from '../../../core/console.js'

const VEC_CTOR: Readonly<Record<string, { n: 2 | 3 | 4; elem: VecCtorElem }>> = {
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
  // Vectors of bools (§27): what a vector comparison yields, and a constructor for one.
  vec2b: { n: 2, elem: 'bool' },
  vec3b: { n: 3, elem: 'bool' },
  vec4b: { n: 4, elem: 'bool' },
}

/** The element kinds a vector constructor spells: the three native scalars, the emulated
 *  double the fp64 pass assembles, and bool (§27). */
type VecCtorElem = 'f32' | 'i32' | 'u32' | 'f64' | 'bool'

/** Matrix constructor name -> its shape. Every `matCxR` of wgsl.txt:4621 plus the `matN`
 *  shorthand for a square one, matching the type names `type-map.ts` accepts, so a type an
 *  author can declare is a value an author can build. */
const MAT_CTOR: Readonly<Record<string, { cols: 2 | 3 | 4; rows: 2 | 3 | 4 }>> = Object.fromEntries(
  ([2, 3, 4] as const).flatMap((cols) =>
    ([2, 3, 4] as const).flatMap((rows) =>
      cols === rows
        ? [[`mat${cols}x${rows}`, { cols, rows }] as const, [`mat${cols}`, { cols, rows }] as const]
        : [[`mat${cols}x${rows}`, { cols, rows }] as const],
    ),
  ),
)

export function lowerCall(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const callee = node.expression
  let intrinsicId: string | undefined
  let viaMath = false
  let ctor: { n: 2 | 3 | 4; elem: VecCtorElem } | undefined

  if (ts.isPropertyAccessExpression(callee)) {
    const obj = callee.expression
    // Keep the authoring surface on the JavaScript Console API spelling. The call remains a
    // normal IR call, so it is not a TypeShade-specific debug DSL.
    if (ts.isIdentifier(obj) && obj.text === 'console') {
      const method = callee.name.text
      if (!isConsoleMethod(method)) {
        pushDiag(
          diagnostics,
          sourceFile,
          callee.name,
          `console.${method}() is not supported in TypeShade yet. Use log, info, debug, warn, or error.`,
          TS_CODES.UNSUPPORTED,
        )
        return undefined
      }
      const args: Expr[] = []
      for (const arg of node.arguments) {
        const lowered = lowerExpression(arg, sourceFile, scope, diagnostics)
        if (!lowered) return undefined
        args.push(lowered)
      }
      return {
        op: 'call',
        type: voidT,
        fn: `console.${method}`,
        args,
        // The one span constructor every lowering uses: a `SourceSpan` carries line and character
        // as well as the offset, and a hand-built `{ file, start, length }` is not one.
        span: spanOf(sourceFile, node),
      }
    }
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
    } else {
      // A method of a class the file declares, or a static function on the class (#86); a
      // receiver that is not a struct falls through to the refusals below.
      const viaClass = lowerClassCall(node, callee, sourceFile, scope, diagnostics)
      if (viaClass !== 'not-a-class-call') return viaClass
      if (JS_ARRAY_METHODS.has(callee.name.text)) {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `JS Array method ".${callee.name.text}" is not a shader op. Use sum/min/any/all/zip/fill.`,
          TS_CODES.UNSUPPORTED,
        )
        return undefined
      }
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        'Method calls are not supported here: a method belongs to a class the file declares ' +
          '(#86); anything else is a free function.',
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
      // `any(m)` / `all(m)` over a vector of bools is the builtin (§27); over an array with a
      // predicate it is the fold below.
      if ((name === 'any' || name === 'all') && node.arguments.length === 1) {
        const reduced = lowerBoolReduce(name, node, sourceFile, scope, diagnostics)
        if (reduced !== 'not-a-bool-vector') return reduced
      }
      const folded = lowerArrayFold(name, node, sourceFile, scope, diagnostics)
      if (folded !== 'fallback') return folded
    }
    // A name #8 A6 added does not shadow a function the file declares: before it, the call
    // resolved to that function, and an addition may not change what a program means.
    const shadowed = USER_FIRST_BUILTINS.has(name) ? scope.resolveCallee(name) : undefined
    if (shadowed) return lowerUserCall(node, shadowed, sourceFile, scope, diagnostics)
    if (name === 'select') return lowerSelectCall(node, sourceFile, scope, diagnostics)
    if (name === 'arrayLength') return lowerArrayLengthCall(node, sourceFile, scope, diagnostics)
    if (isAtomicIntrinsic(name)) return lowerAtomicCall(name, node, sourceFile, scope, diagnostics)
    // In expression position only: a barrier standing alone is lowered by the statement path.
    if (isBarrierIntrinsic(name)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `${name}() is a statement with no value; write it on its own line.`,
        TS_CODES.BARRIER_PLACEMENT,
      )
      return undefined
    }
    if (name === 'f64FromParts' || name === 'f64Parts')
      return lowerF64BridgeCall(name, node, sourceFile, scope, diagnostics)
    if (SCALAR_CAST[name]) return lowerScalarCastCall(name, node, sourceFile, scope, diagnostics)
    // A matrix constructor is its own function, deliberately NOT an arm of the vector one:
    // the two share only a name shape. A vector composes a flat component list; a matrix
    // composes COLUMNS, truncates another matrix, and has a zero form.
    const matCtor = MAT_CTOR[name]
    if (matCtor !== undefined) {
      return lowerMatrixCtor(matCtor, node, sourceFile, scope, diagnostics)
    }
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
        // A generic function is compiled once per set of argument types the file calls it
        // with (roadmap 0.3 item T9, #92). The instance does not exist until a call asks for
        // it, so the arguments are lowered here, the type arguments read off them, and the
        // instance made before `lowerUserCall` checks the call against it.
        if (scope.isGenericFunction(name)) {
          return lowerGenericCall(node, name, sourceFile, scope, diagnostics)
        }
      }
    }
  }

  // `Symbol('k')`, `fetch(url)`: the semantic pass already said the callee is a host API, and
  // lowering the arguments adds a second complaint about the same line — one about a string
  // that is only there because the call is (roadmap 0.3 item T10, #92).
  if (ts.isIdentifier(callee) && HOST_GLOBALS.has(callee.text)) return undefined

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
    // vecN(v: vecN<f64>) — the per-lane NARROW, the one conversion an emulated-double vector
    // has. There is nothing to reinterpret componentwise: each lane is a (hi, lo) pair, and
    // `f32(lane)` is the df64_narrow the fp64 pass emits for it. Written out as the explicit
    // component list, so all three backends and the CPU oracle see one ordinary vector
    // constructor and the pass has no new shape to learn (#151 F64-05). The integer and bool
    // constructors are not offered: the pass has no f64 → i32 body (SD0041) and saturating a
    // double through f32 first is not a conversion an author should get by accident.
    const from = args[0]
    if (args.length === 1 && from !== undefined && from.type.kind === 'vec64') {
      if (ctor.elem === 'f32' && from.type.n === ctor.n) {
        return {
          op: 'construct',
          type: vectorCtorType(ctor.n, 'f32'),
          args: Array.from({ length: ctor.n }, (_, i): Expr => ({
            op: 'call',
            type: f32T,
            fn: 'f32',
            args: [{ op: 'member', type: f64T, base: from, field: 'xyzw'[i]! }],
          })),
        }
      }
      if (ctor.elem !== 'f64') {
        // `written` and not a captured `name`: the constructor's identifier is bound in the
        // callee branch above, which has already closed here — and `lib.dom` declares a
        // global `name: string`, so reading it type-checked and threw a ReferenceError at
        // run time instead, taking the language service down with it.
        const written = node.expression.getText(sourceFile)
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `${written}(${typeKey(from.type)}) — an emulated-double vector narrows to f32 lane ` +
            `by lane and to nothing else; write vec${from.type.n}(v)` +
            (ctor.elem === 'f32'
              ? ' of its own width.'
              : ` and cast that, e.g. ${written}(vec${from.type.n}(v)).`),
          TS_CODES.TYPE_MISMATCH,
        )
        return undefined
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

  if (intrinsicId !== undefined && TEXTURE_CALLS.has(intrinsicId)) {
    return lowerTextureCall(intrinsicId, args, node, sourceFile, diagnostics)
  }
  if (!intrinsicId) {
    // A call to a function this file declares and could not lower says nothing here: the
    // declaration already said why it names no callee, and "Unknown function" on top of that
    // is both a second complaint about one mistake and untrue (roadmap 0.3 item T10, #92).
    if (ts.isIdentifier(callee) && scope.declarationRefused(callee.text)) return undefined
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
  // The shapes the signature takes (roadmap 0.2 item 9, #57): one diagnostic on the argument
  // that does not fit, with the fix.
  const display = `${viaMath ? 'Math.' : ''}${intrinsicId === 'atan2' ? 'atan' : intrinsicId}`
  if (!checkMathArgs(intrinsicId, display, args, node, sourceFile, diagnostics)) return undefined
  return { op: 'call', type: mathResultType(intrinsicId, args), fn: intrinsicId, args }
}

/** The scalar type a vector constructor's components must have, or undefined for the
 *  emulated-double constructor, whose components the fp64 pass assembles. */
/** `mat3(a, b, c)`, `mat4x3(...)`, `mat2()`, `mat3(m4)` — the matrix constructors of
 *  wgsl.txt:20248ff, which GLSL ES 3.00 spells the same way.
 *
 *  Four forms, and the order they are tried in is the order WGSL gives them:
 *
 *    `matCxR()`            the zero matrix
 *    `matCxR(m)`           from another matrix: the overlapping block, the rest from the
 *                          identity — WGSL gives only the exact-shape conversion, so this
 *                          surface offers the TRUNCATION a renderer actually asks for
 *                          (`mat3(m4)`, the normal matrix) and refuses a widening one
 *    `matCxR(c0, …, cC-1)` from C columns, each a `vecR`
 *    `matCxR(e0, …, e*)`   from C*R scalars, column-major
 *
 *  Its own function rather than an arm of the vector constructor: a vector composes one flat
 *  component list and a matrix composes columns, so sharing the code would mean a flattening
 *  rule that is wrong for one of them. */
function lowerMatrixCtor(
  shape: { cols: 2 | 3 | 4; rows: 2 | 3 | 4 },
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const { cols, rows } = shape
  const type: ShaderType = { kind: 'mat', cols, rows, elem: 'f32' }
  const shown = typeKey(type)
  const colT: ShaderType = { kind: 'vec', n: rows, elem: 'f32' }
  const args: Expr[] = []
  for (const arg of node.arguments) {
    const lowered = lowerExpression(arg, sourceFile, scope, diagnostics)
    if (!lowered) return undefined
    args.push(lowered)
  }

  // `matCxR()` — the zero matrix (wgsl.txt:20015-20030, "T ()"). Written out as C zero
  // columns so every backend and the oracle see an ordinary constructor.
  if (args.length === 0) {
    const zero: Expr = { op: 'lit', type: f32T, value: 0 }
    return {
      op: 'construct',
      type,
      args: Array.from({ length: cols }, () => ({
        op: 'construct' as const,
        type: colT,
        args: Array.from({ length: rows }, () => zero),
      })),
    }
  }

  // `matCxR(m)` — from another matrix.
  if (args.length === 1 && args[0]!.type.kind === 'mat') {
    const from = args[0]!
    const src = from.type as Extract<ShaderType, { kind: 'mat' }>
    if (src.elem !== 'f32') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `${shown} cannot be built from ${typeKey(src)}: the emulated-double matrices are ` +
          `their own square shapes and do not convert.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    if (src.cols < cols || src.rows < rows) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `${shown} cannot be built from the smaller ${typeKey(src)}: this surface truncates a ` +
          `matrix and does not grow one, since the components it would have to invent are a ` +
          `choice the author should make. Write the columns out.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    // The upper-left block, column by column: `mat3(m4)` is the rotation a normal matrix
    // wants out of a model matrix, which is why the truncation is worth having at all.
    return {
      op: 'construct',
      type,
      args: Array.from({ length: cols }, (_, c): Expr => {
        const column: Expr = {
          op: 'index',
          type: { kind: 'vec', n: src.rows, elem: 'f32' },
          base: from,
          idx: { op: 'lit', type: i32T, value: c },
        }
        return src.rows === rows
          ? column
          : { op: 'member', type: colT, base: column, field: 'xyzw'.slice(0, rows) }
      }),
    }
  }

  // `matCxR(c0, …)` — one `vecR` per column.
  if (
    args.length === cols &&
    args.every((a) => a.type.kind === 'vec' && a.type.n === rows && a.type.elem === 'f32')
  ) {
    return { op: 'construct', type, args }
  }

  // `matCxR(e0, …)` — C*R scalars, column-major, gathered into columns here so the IR always
  // carries a matrix as a list of columns whichever way it was written.
  if (args.length === cols * rows) {
    const bad = args.findIndex((a) => typeKey(a.type) !== 'f32')
    if (bad >= 0) {
      pushDiag(
        diagnostics,
        sourceFile,
        node.arguments[bad] ?? node,
        `${shown} takes f32 components; argument ${bad + 1} is ${typeKey(args[bad]!.type)}.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    return {
      op: 'construct',
      type,
      args: Array.from({ length: cols }, (_, c) => ({
        op: 'construct' as const,
        type: colT,
        args: args.slice(c * rows, c * rows + rows),
      })),
    }
  }

  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `${shown} takes ${cols} vec${rows} columns, ${cols * rows} f32 components, a larger ` +
      `matrix to truncate, or nothing for the zero matrix; got ${args.length} argument(s)` +
      `${args.length > 0 ? ` (${args.map((a) => typeKey(a.type)).join(', ')})` : ''}.`,
    TS_CODES.ARITY_MISMATCH,
  )
  return undefined
}

/** `f64FromParts(hi, lo)` and `f64Parts(x)`: the lane bridge between an emulated double and
 *  the two `f32` words that carry it.
 *
 *  An `f64` cannot cross an entry boundary — a (hi, lo) pair interpolated as a varying is
 *  numerically meaningless, and the fp64 pass refuses one — so a stage that must hand a double
 *  to the next one carries the two words as ordinary `f32` IO and rebuilds the value on the
 *  other side. Both halves were in the intrinsic registry and in the fn() EDSL from the start
 *  and had no source spelling at all, which left the refusal naming a bridge no
 *  `"use typeshade"` program could write (#151 F64-09, F64-13). */
function lowerF64BridgeCall(
  name: 'f64FromParts' | 'f64Parts',
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const want = name === 'f64FromParts' ? 2 : 1
  if (node.arguments.length !== want) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${name} expects ${want} argument(s), got ${node.arguments.length}.`,
      TS_CODES.ARITY_MISMATCH,
    )
    return undefined
  }
  const args: Expr[] = []
  for (const arg of node.arguments) {
    const lowered = lowerExpression(arg, sourceFile, scope, diagnostics)
    if (!lowered) return undefined
    args.push(lowered)
  }
  if (name === 'f64Parts') {
    if (!isF64(args[0]!.type)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node.arguments[0]!,
        `f64Parts splits an f64 into its high and low f32 words; got ${typeKey(args[0]!.type)}.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    return { op: 'call', type: vec2fT, fn: 'f64Parts', args }
  }
  for (let i = 0; i < args.length; i++) {
    if (typeKey(args[i]!.type) === 'f32') continue
    pushDiag(
      diagnostics,
      sourceFile,
      node.arguments[i]!,
      `f64FromParts takes the two f32 words of a double, high then low; argument ${i + 1} is ` +
        `${typeKey(args[i]!.type)}. Write f32(x).`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  return { op: 'call', type: f64T, fn: 'f64FromParts', args }
}

/** `arrayLength(src)`: the explicit spelling of what `src.length` reads on a runtime-sized
 *  storage array (#46). One argument, and `arrayLengthOf` decides whether it is what the
 *  builtin takes, so the call and the property agree. */
function lowerArrayLengthCall(
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
      `arrayLength expects 1 argument, got ${node.arguments.length}.`,
      TS_CODES.ARITY_MISMATCH,
    )
    return undefined
  }
  const arg = lowerExpression(node.arguments[0]!, sourceFile, scope, diagnostics)
  if (!arg) return undefined
  return arrayLengthOf(arg, node, sourceFile, scope, diagnostics, 'arrayLength')
}

function ctorElemType(elem: VecCtorElem): ShaderType | undefined {
  if (elem === 'f32') return f32T
  if (elem === 'i32') return i32T
  if (elem === 'u32') return u32T
  if (elem === 'bool') return boolT
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
/** The argument positions of a builtin that are integers by the builtin's own signature, with
 *  the scalar kind each takes. */
const FIXED_LITERAL_KINDS: Readonly<Record<string, Readonly<Record<number, ShaderType>>>> = {
  ldexp: { 1: i32T },
  extractBits: { 1: u32T, 2: u32T },
  insertBits: { 2: u32T, 3: u32T },
}

function retargetIntrinsicLiterals(
  args: Expr[],
  node: ts.CallExpression,
  intrinsicId: string,
): void {
  if (intrinsicId === 'length' || intrinsicId === 'distance' || intrinsicId === 'dot') return
  // A builtin whose later arguments are integers whatever the first one is (§10): the exponent
  // of `ldexp` is an i32, the offset and count of `extractBits` and `insertBits` are u32. A
  // bare literal there takes that kind, not the first argument's.
  const fixed = FIXED_LITERAL_KINDS[intrinsicId] ?? {}
  for (const [index, kind] of Object.entries(fixed)) {
    const i = Number(index)
    const argNode = node.arguments[i]
    if (argNode && args[i]) args[i] = retargetIntLitCtx(args[i]!, argNode, kind)
  }
  const peerIndex = node.arguments.findIndex((a) => !isBareNumericLiteral(a))
  const peer = peerIndex >= 0 ? args[peerIndex]?.type : undefined
  if (!peer) return
  const target = literalPeerType(peer)
  // The first position too, for an integer peer of a builtin that takes integers (roadmap 0.2
  // item 9, #57): `min(1, i)` with an i32 `i` is an i32 call, as `min(i, 1)` already was. The
  // result type follows the operand deciding the shape rather than a written number. A float
  // peer changes nothing, and a builtin with no integer form (`pow(2, i)`) keeps its f32 first
  // argument so the argument check names `i` as the odd one out.
  if (peerIndex > 0 && target.kind === 'scalar' && mathTakesElem(intrinsicId, target.scalar)) {
    const argNode = node.arguments[0]
    if (argNode && args[0] && fixed[0] === undefined) {
      args[0] = retargetIntLitCtx(args[0], argNode, target)
    }
  }
  for (let i = 1; i < args.length; i++) {
    if (fixed[i] !== undefined) continue
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
    // `mix`'s interpolant stays a plain f32 beside a SCALAR emulated double: the df64 body
    // blends by a float, and the pass refuses an f64 `t` outright. Without this the literal
    // in `mix(a64, b64, 0.25)` would take the f64 peer like any other later argument and then
    // be refused at the argument check — a written 0.25 with no way to spell it (#151). A
    // `vec64` peer needs no arm: `literalPeerType` leaves a literal beside one f32 already.
    if (intrinsicId === 'mix' && i === 2 && isF64(target)) {
      args[i] = retargetIntLitCtx(args[i]!, argNode, f32T)
      continue
    }
    args[i] = retargetIntLitCtx(args[i]!, argNode, target)
  }
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
  const perComponent = cond.type.kind === 'vec' && cond.type.elem === 'bool'
  if (typeKey(cond.type) !== 'bool' && !perComponent) {
    pushDiag(
      diagnostics,
      sourceFile,
      node.arguments[2]!,
      `select condition must be bool or a vector of bools, got ${typeKey(cond.type)}. ` +
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
  // A vector of bools picks per component (§27), so the arms are vectors of its size.
  if (perComponent && cond.type.kind === 'vec') {
    if (ifTrue.type.kind !== 'vec' || ifTrue.type.n !== cond.type.n) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `select with a ${typeKey(cond.type)} condition picks per component and needs ` +
          `${cond.type.n}-component arms; got ${typeKey(ifTrue.type)}.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
  }
  return { op: 'select', type: ifTrue.type, cond, ifTrue, ifFalse }
}

/** `any(m)` / `all(m)` over a vector of bools (§27): the builtin of both targets, reducing the
 *  components. Returns the marker when the one argument is not such a vector, so the array
 *  fold of the same name (`any(xs, pred)`) keeps its turn and its diagnostics. */
function lowerBoolReduce(
  name: 'any' | 'all',
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined | 'not-a-bool-vector' {
  const peek = lowerExpression(node.arguments[0]!, sourceFile, scope, [])
  if (!peek) return 'not-a-bool-vector'
  if (peek.type.kind !== 'vec' || peek.type.elem !== 'bool') {
    // An array takes the fold's turn and its own message; anything else is neither shape.
    if (peek.type.kind === 'array') return 'not-a-bool-vector'
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${name}(v) takes a vector of bools, which a comparison of two vectors gives (§27), or ` +
        `an array with a predicate, ${name}(xs, (x) => ...); got ${typeKey(peek.type)}.`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  const arg = lowerExpression(node.arguments[0]!, sourceFile, scope, diagnostics)
  if (!arg) return undefined
  return { op: 'call', type: boolT, fn: name, args: [arg] }
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
  'textureStore',
  'textureSampleCompare',
  'textureSampleCompareLevel',
  'textureSampleBias',
  'textureSampleGrad',
  'textureGather',
  'textureGatherCompare',
  'textureNumSamples',
])

/** `textureStore(dst, coord, value)`, `textureLoad(src, coord)` and `textureDimensions(t)` on a
 *  storage texture (roadmap 0.4 item 10).
 *
 *  Three things are checked here that Tint also checks, so the author reads this compiler's
 *  words and a span in their own file rather than a driver's message about generated code: the
 *  access mode has to admit the call (`textureLoad` on a `write` texture and `textureStore` on
 *  a `read` one are both "no matching call" on Tint), and the value stored has to be the
 *  texel type the FORMAT decides — `rgba8uint` stores a `vec4u`, `rgba8unorm` a `vec4`.
 *
 *  The coordinate is left to the ordinary argument check: Tint takes a signed or an unsigned
 *  vector, so both `vec2i` and `vec2u` are written here as they are. */
function lowerStorageTextureCall(
  id: string,
  tex: Extract<ShaderType, { kind: 'storage-texture' }>,
  args: readonly Expr[],
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const isArray = tex.dim === '2d-array'
  const texel: ShaderType = { kind: 'vec', n: 4, elem: storageTexel(tex.format) }
  const shown = typeKey(tex)
  if (id === 'textureDimensions') {
    return arity(id, args, 1, node, sourceFile, diagnostics)
      ? { op: 'call', type: vec2uT, fn: id, args: [...args] }
      : undefined
  }
  if (id === 'textureLoad') {
    if (tex.access === 'write') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"${shown}" is write-only, so textureLoad cannot read it. Declare it "read" to read ` +
          `it, or "read_write" to do both — which only "r32uint", "r32sint" and "r32float" ` +
          `allow, so a format outside those takes a second binding over the same texture.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    if (!arity(id, args, isArray ? 3 : 2, node, sourceFile, diagnostics)) return undefined
    const out = [...args]
    // The layer of an array texture is an integer: a bare `0` would lower to `0.0`, which
    // Tint refuses ("no matching call"), so it is retyped like every other layer.
    if (isArray) {
      const layer = intArg(out[2]!, node.arguments[2]!, i32T, 'layer', sourceFile, diagnostics)
      if (!layer) return undefined
      out[2] = layer
    }
    return { op: 'call', type: texel, fn: id, args: out }
  }
  if (id === 'textureStore') {
    if (tex.access === 'read') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"${shown}" is read-only, so textureStore cannot write it. Declare it "write" to ` +
          `write it, or "read_write" to do both — which only "r32uint", "r32sint" and ` +
          `"r32float" allow.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    if (!arity(id, args, isArray ? 4 : 3, node, sourceFile, diagnostics)) return undefined
    const out = [...args]
    if (isArray) {
      const layer = intArg(out[2]!, node.arguments[2]!, i32T, 'layer', sourceFile, diagnostics)
      if (!layer) return undefined
      out[2] = layer
    }
    const value = out[isArray ? 3 : 2]!
    if (typeKey(value.type) !== typeKey(texel)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"${shown}" stores a ${typeKey(texel)}; got ${typeKey(value.type)}. The texel type is ` +
          `the format's own: a "…uint" format stores a vec4u, a "…sint" one a vec4i, and ` +
          `every other one — unorm, snorm and float — a vec4.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    return { op: 'call', type: voidT, fn: id, args: out }
  }
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `${id} takes a sampled texture; "${shown}" is a storage texture, which is read and ` +
      `written by texel coordinate with textureLoad and textureStore and has no sampler.`,
    TS_CODES.TYPE_MISMATCH,
  )
  return undefined
}

/** `textureSampleCompare(tex, smp, uv, ref)` and `textureSampleCompareLevel(…)` on a depth
 *  texture, with the layer between the coordinate and the reference on the array form
 *  (roadmap 0.4 item 11). Both yield an `f32`: how much of the filter footprint passed the
 *  comparison, not a texel. The sampler has to be a `sampler_comparison`; an ordinary one has
 *  no reference to compare against, and Tint refuses the pairing as "no matching call".
 *
 *  `textureSampleCompare` uses the implicit level of detail, so it is fragment-only, which
 *  `FRAGMENT_ONLY_CALLS` in function.ts reports by stage; `…Level` samples level 0 anywhere.
 *
 *  A PLAIN read of a depth texture — `textureSample` with an ordinary sampler, `textureLoad` —
 *  is refused here for now, with the reason: GLSL ES 3.00 fuses a texture and its sampler into
 *  one object whose type is decided by the read (`sampler2D` for a plain one, `sampler2DShadow`
 *  for a comparison), so a depth texture read both ways needs WebGPU's separate samplers, a
 *  capability a later item adds. Until then every depth read is a comparison and the GLSL
 *  combined type is one spelling per dim. */
function lowerDepthTextureCall(
  id: string,
  tex: Extract<ShaderType, { kind: 'depth-texture' }>,
  args: readonly Expr[],
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  // A multisampled depth texture is loaded, never compared (roadmap 0.4 item 13); WGSL-only by
  // the msaaTextureLoad capability, so the fused-sampler reason that defers a plain read of the
  // other depth textures does not arise for it.
  if (tex.dim === '2d-ms')
    return lowerMultisampledCall(id, tex, args, node, sourceFile, diagnostics)
  const suffix = arraySuffix(tex.dim)
  const isArray = suffix !== ''
  const shown = typeKey(tex)
  if (id === 'textureDimensions') {
    // A cube's size is the size of one face, two wide on both targets, so it keeps the 2d id.
    return arity(id, args, 1, node, sourceFile, diagnostics)
      ? { op: 'call', type: vec2uT, fn: id, args: [...args] }
      : undefined
  }
  if (id === 'textureNumLayers') {
    if (!isArray) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        tex.dim === 'cube'
          ? `textureNumLayers needs a texture_depth_2d_array or a texture_depth_cube_array; a ` +
              `texture_depth_cube has six faces, not layers.`
          : `textureNumLayers needs a texture_depth_2d_array; a plain depth texture has no layers.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    return arity(id, args, 1, node, sourceFile, diagnostics)
      ? { op: 'call', type: u32T, fn: id, args: [...args] }
      : undefined
  }
  if (id === 'textureSampleCompare' || id === 'textureSampleCompareLevel') {
    const smp = args[1]
    if (smp === undefined || smp.type.kind !== 'sampler-comparison') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `${id} compares through a sampler_comparison; got ` +
          `${smp === undefined ? 'nothing' : typeKey(smp.type)}. An ordinary sampler filters a ` +
          `texel and has no reference to compare against. Declare the sampler ` +
          `"declare const smp: sampler_comparison".`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    if (!arity(id, args, isArray ? 5 : 4, node, sourceFile, diagnostics)) return undefined
    if (!vecArg(id, tex, args[2]!, node.arguments[2]!, 'coordinate', sourceFile, diagnostics))
      return undefined
    const out = [...args]
    if (isArray) {
      // The layer is an integer, as on a sampled array texture; the reference depth that
      // follows it is an f32.
      const layer = intArg(out[3]!, node.arguments[3]!, i32T, 'layer', sourceFile, diagnostics)
      if (!layer) return undefined
      out[3] = layer
    }
    const ref = isArray ? 4 : 3
    if (
      !floatArg(`${id}'s reference depth`, out[ref]!, node.arguments[ref]!, sourceFile, diagnostics)
    )
      return undefined
    // The cube form is its own id (roadmap 0.4 item 12): on GLSL the reference folds into a
    // vec4 after the vec3 direction, where the 2d form folds it into a vec3.
    const fn = isArray ? `${id}${suffix}` : tex.dim === 'cube' ? `${id}Cube` : id
    return { op: 'call', type: f32T, fn, args: out }
  }
  if (id === 'textureSample' || id === 'textureSampleLevel' || id === 'textureLoad') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${shown}" is read by comparison: textureSampleCompare(tex, smp, uv, ref) with a ` +
        `sampler_comparison yields how much of the footprint passed. A plain read of a depth ` +
        `texture — ${id} — is not here yet: on GLSL ES 3.00 the texture and its sampler are one ` +
        `object whose type the read decides, so a depth texture read both ways needs separate ` +
        `samplers, which a later item adds.`,
      TS_CODES.UNSUPPORTED,
    )
    return undefined
  }
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `${id} does not take a depth texture; "${shown}" is read with textureSampleCompare.`,
    TS_CODES.TYPE_MISMATCH,
  )
  return undefined
}

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
  // A gather takes its texture SECOND on a colour texture, after the component (roadmap 0.4
  // item 12), so it is routed before anything below reads args[0] as the texture.
  if (id === 'textureGather' || id === 'textureGatherCompare') {
    return lowerGatherCall(id, args, node, sourceFile, diagnostics)
  }
  const tex = args[0]
  // A storage texture is read and written by texel coordinate (roadmap 0.4 item 10), so the
  // three calls that take one go down their own path: its access mode decides which of them
  // apply, and its FORMAT decides the texel type where a sampled texture's element would.
  if (tex && tex.type.kind === 'storage-texture') {
    return lowerStorageTextureCall(id, tex.type, args, node, sourceFile, diagnostics)
  }
  // A depth texture is read by COMPARISON (roadmap 0.4 item 11): its own path, since the reads
  // that apply, the sampler they take and the type they yield all differ from a sampled one.
  if (tex && tex.type.kind === 'depth-texture') {
    return lowerDepthTextureCall(id, tex.type, args, node, sourceFile, diagnostics)
  }
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
  if (id === 'textureStore') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `textureStore writes a storage texture; "${typeKey(tex.type)}" is a sampled texture, ` +
        `which is read through a sampler and never written. Declare the binding as ` +
        `texture_storage_2d<"rgba8unorm", "write"> (or whichever format) to write to it.`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  // The array forms are their own ids: `Array` for a 2d array, `CubeArray` for a cube array
  // (roadmap 0.4 item 12), since the two restructure their GLSL arguments differently.
  // A multisampled texture is read one sample at a time and never sampled (roadmap 0.4 item
  // 13): its own path, since the third argument of its load is a sample index, not a level.
  if (tex.type.dim === '2d-ms') {
    return lowerMultisampledCall(id, tex.type, args, node, sourceFile, diagnostics)
  }
  const suffix = arraySuffix(tex.type.dim)
  const isArray = suffix !== ''
  const shown = typeKey(tex.type)
  const texel: ShaderType = { kind: 'vec', n: 4, elem: tex.type.elem }
  // The two sampler kinds are not interchangeable in either direction, and Tint says so ("no
  // matching call"); this says it first, in the author's own file (roadmap 0.4 item 11).
  if (id === 'textureSampleCompare' || id === 'textureSampleCompareLevel') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${id} compares against a depth texture; "${typeKey(tex.type)}" is a sampled colour ` +
        `texture with no depth to compare. Declare the shadow map "texture_depth_2d" and read ` +
        `it with a "sampler_comparison".`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  if (
    (id === 'textureSample' || id === 'textureSampleLevel') &&
    args[1]?.type.kind === 'sampler-comparison'
  ) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${id} filters a texel through an ordinary sampler; a sampler_comparison compares a ` +
        `reference depth against the texel instead, and reads a texture_depth_2d with ` +
        `textureSampleCompare. Declare this sampler "sampler" to sample with it.`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  switch (id) {
    case 'textureDimensions':
      if (!arity(id, args, 1, node, sourceFile, diagnostics)) return undefined
      // A 3d texture's size is three wide, and its own id on GLSL (`uvec3` where the 2d wrapper
      // is `uvec2`); a cube's is the size of one face, two wide on both targets (item 12).
      // A 1d texture's size is ONE wide, a u32, and its own id for the same reason (item 12).
      if (tex.type.dim === '1d')
        return { op: 'call', type: u32T, fn: 'textureDimensions1d', args: [...args] }
      return tex.type.dim === '3d'
        ? { op: 'call', type: vec3uT, fn: 'textureDimensions3d', args: [...args] }
        : { op: 'call', type: vec2uT, fn: id, args: [...args] }
    case 'textureNumSamples':
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `textureNumSamples takes a texture_multisampled_2d; a ${shown} has one sample per texel.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    case 'textureNumLayers':
      if (!isArray) {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          tex.type.dim === '1d'
            ? `textureNumLayers needs a texture_2d_array; a texture_1d has no layers.`
            : tex.type.dim === 'cube'
              ? `textureNumLayers needs a texture_2d_array or a texture_cube_array; a texture_cube has six faces, not layers.`
              : tex.type.dim === '3d'
                ? `textureNumLayers needs a texture_2d_array; a texture_3d has depth, not layers: ` +
                  `textureDimensions(t).z is its slice count.`
                : `textureNumLayers needs a texture_2d_array; a plain 2D texture has no layers.`,
          TS_CODES.TYPE_MISMATCH,
        )
        return undefined
      }
      return arity(id, args, 1, node, sourceFile, diagnostics)
        ? { op: 'call', type: u32T, fn: id, args: [...args] }
        : undefined
    case 'textureSample':
    case 'textureSampleLevel':
    case 'textureSampleBias':
    case 'textureSampleGrad': {
      // Sampling is float-only on both targets: an integer texture has no filtering, so WGSL
      // gives it no `textureSample` overload at all. textureLoad is the read it does have.
      if (tex.type.elem !== 'f32') {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `${id} needs a float texture; ${shown} is read with ` +
            `${tex.type.dim === 'cube' || tex.type.dim === 'cube-array' ? 'textureGather' : 'textureLoad'}.`,
          TS_CODES.TYPE_MISMATCH,
        )
        return undefined
      }
      // WGSL gives a 1d texture textureSample and textureSampleLevel only (roadmap 0.4 item 12).
      if (tex.type.dim === '1d' && (id === 'textureSampleBias' || id === 'textureSampleGrad')) {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `${id} has no texture_1d form on WGSL; a ${shown} is read with textureSample, ` +
            `textureSampleLevel or textureLoad.`,
          TS_CODES.UNSUPPORTED,
        )
        return undefined
      }
      // (tex, smp, coord) plus a level or a bias, or two gradients (roadmap 0.4 item 12); the
      // array form adds its layer after the coordinate on every one of them.
      const base = id === 'textureSample' ? 3 : id === 'textureSampleGrad' ? 5 : 4
      const want = isArray ? base + 1 : base
      if (!arity(id, args, want, node, sourceFile, diagnostics)) return undefined
      if (
        !vecArg(id, tex.type, args[2]!, node.arguments[2]!, 'coordinate', sourceFile, diagnostics)
      )
        return undefined
      const fn = `${id}${suffix}`
      // The LAYER is an integer; the mip LEVEL or BIAS of a sampled read is an f32.
      // (`textureSampleLevel`'s level argument sits where the layer does on the non-array
      // form, which is why the index is computed rather than fixed.)
      const out = [...args]
      if (isArray) {
        const layer = intArg(out[3]!, node.arguments[3]!, i32T, 'layer', sourceFile, diagnostics)
        if (!layer) return undefined
        out[3] = layer
      }
      if (id === 'textureSampleLevel' || id === 'textureSampleBias') {
        const k = isArray ? 4 : 3
        const what = id === 'textureSampleLevel' ? `${id}'s level` : `${id}'s bias`
        if (!floatArg(what, out[k]!, node.arguments[k]!, sourceFile, diagnostics)) return undefined
      }
      // The gradients have the coordinate's width, on both targets.
      if (id === 'textureSampleGrad') {
        const first = isArray ? 4 : 3
        for (const k of [first, first + 1]) {
          if (
            !vecArg(id, tex.type, out[k]!, node.arguments[k]!, 'gradient', sourceFile, diagnostics)
          )
            return undefined
        }
      }
      return { op: 'call', type: texel, fn, args: out }
    }
    case 'textureLoad': {
      // Neither target has a texel fetch for a cube: WGSL's `textureLoad` and GLSL's
      // `texelFetch` both stop at 2d, 2d-array and 3d (roadmap 0.4 item 12).
      if (tex.type.dim === 'cube' || tex.type.dim === 'cube-array') {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `textureLoad has no cube form on either target: a ${shown} is looked up by ` +
            `direction, so read it with textureSample or textureSampleLevel.`,
          TS_CODES.UNSUPPORTED,
        )
        return undefined
      }
      const want = isArray ? 4 : 3
      if (!arity(id, args, want, node, sourceFile, diagnostics)) return undefined
      if (
        !vecArg(id, tex.type, args[1]!, node.arguments[1]!, 'coordinate', sourceFile, diagnostics)
      )
        return undefined
      // A 1d texture's coordinate is ONE integer (roadmap 0.4 item 12): a bare `3` lowers to an
      // f32 on this surface, so it is retargeted like a layer, and an f32 expression is refused,
      // where Tint would refuse the generated `textureLoad(t, 3.0, 0u)`.
      if (tex.type.dim === '1d') {
        const c = intArg(args[1]!, node.arguments[1]!, i32T, 'coordinate', sourceFile, diagnostics)
        if (!c) return undefined
        if (typeKey(c.type) !== 'i32' && typeKey(c.type) !== 'u32') {
          pushDiag(
            diagnostics,
            sourceFile,
            node.arguments[1]!,
            `textureLoad on a ${shown} takes an integer coordinate, an i32 or a u32; got ` +
              `${typeKey(c.type)}.`,
            TS_CODES.TYPE_MISMATCH,
          )
          return undefined
        }
        args = [args[0]!, c, ...args.slice(2)]
      }
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

/** The reads of a multisampled texture, colour or depth (roadmap 0.4 item 13): `textureLoad(t,
 *  coords, sampleIndex)` yields one sample (`vec4<T>`, or `f32` on the depth twin),
 *  `textureNumSamples(t)` the count and `textureDimensions(t)` the size. Nothing else applies —
 *  WGSL §6.6.3: a multisampled texture cannot be used with a sampler — so every sampling,
 *  comparison and gather form is refused with the read that does apply. WGSL-only under the
 *  `msaaTextureLoad` capability the binding derives; GLSL ES 3.00 has no `sampler2DMS`. */
function lowerMultisampledCall(
  id: string,
  tex: Extract<ShaderType, { kind: 'texture' | 'depth-texture' }>,
  args: readonly Expr[],
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const shown = typeKey(tex)
  const depth = tex.kind === 'depth-texture'
  switch (id) {
    case 'textureDimensions':
      return arity(id, args, 1, node, sourceFile, diagnostics)
        ? { op: 'call', type: vec2uT, fn: 'textureDimensionsMs', args: [...args] }
        : undefined
    case 'textureNumSamples':
      return arity(id, args, 1, node, sourceFile, diagnostics)
        ? { op: 'call', type: u32T, fn: id, args: [...args] }
        : undefined
    case 'textureLoad': {
      if (!arity(id, args, 3, node, sourceFile, diagnostics)) return undefined
      if (!vecArg(id, tex, args[1]!, node.arguments[1]!, 'coordinate', sourceFile, diagnostics))
        return undefined
      // The third argument is a SAMPLE INDEX, an integer like a level, retyped the same way.
      const sample = intArg(
        args[2]!,
        node.arguments[2]!,
        u32T,
        'sample index',
        sourceFile,
        diagnostics,
      )
      if (!sample) return undefined
      const type: ShaderType = depth ? f32T : { kind: 'vec', n: 4, elem: tex.elem }
      return {
        op: 'call',
        type,
        fn: depth ? 'textureLoadDepthMs' : 'textureLoadMs',
        args: [args[0]!, args[1]!, sample],
      }
    }
    case 'textureNumLayers':
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `textureNumLayers needs an array texture; a ${shown} has samples, not layers, and ` +
          `textureNumSamples(t) is their count.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    default:
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `${id} cannot read a ${shown}: a multisampled texture cannot be used with a sampler. ` +
          `Read one sample with textureLoad(t, coords, sampleIndex); textureNumSamples(t) is ` +
          `how many there are.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
  }
}

/** The id suffix the array forms take: `Array` for a 2d array, `CubeArray` for a cube array
 *  (roadmap 0.4 item 12), '' for a texture with no layers. Two suffixes rather than one because
 *  the GLSL spellings fold the layer differently (a `vec3(uv, layer)` on a 2d array; nothing at
 *  all on a cube array, which GLSL ES 3.00 has no sampler for), and an id's text must never
 *  depend on the texture it is called on. */
function arraySuffix(dim: string): '' | 'Array' | 'CubeArray' {
  return dim === '2d-array' ? 'Array' : dim === 'cube-array' ? 'CubeArray' : ''
}

/** `textureGather(component, tex, smp, coords[, layer])` on a colour texture,
 *  `textureGather(tex, smp, coords[, layer])` on a depth texture, and
 *  `textureGatherCompare(tex, smp, coords[, layer], ref)` on a depth texture through a comparison
 *  sampler (roadmap 0.4 item 12): the four texels a linear filter would blend at mip level 0, one
 *  channel each, as a `vec4`, in any stage.
 *
 *  WGSL puts the COMPONENT first on a colour texture, because a depth texture has one channel
 *  and takes none; this surface keeps that order, so the texture is found by its kind rather
 *  than its position. The component must be a whole number from 0 to 3 written in the call: WGSL
 *  requires a const-expression there and makes any other value a shader-creation error, so it is
 *  said here, at the argument. Cube textures gather by direction like they sample; a 1d, 3d or
 *  multisampled texture has no gather form. WGSL-only: GLSL ES 3.00 has no gather (ES 3.10), and
 *  the `textureGather` capability fails the module closed on that target. */
function lowerGatherCall(
  id: string,
  args: readonly Expr[],
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const at = args.findIndex((a) => a.type.kind === 'texture' || a.type.kind === 'depth-texture')
  const tex = at === 0 || at === 1 ? args[at]! : undefined
  if (tex === undefined || (tex.type.kind !== 'texture' && tex.type.kind !== 'depth-texture')) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${id} takes a texture as its first argument, or as its second after the component on a ` +
        `colour texture: textureGather(0, tex, smp, uv).`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  const shown = typeKey(tex.type)
  const compare = id === 'textureGatherCompare'
  if (tex.type.dim === '1d' || tex.type.dim === '3d' || tex.type.dim === '2d-ms') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${id} gathers a 2d, 2d-array, cube or cube-array texture; a ${shown} has no gather form ` +
        `on WGSL.`,
      TS_CODES.UNSUPPORTED,
    )
    return undefined
  }
  if (compare && tex.type.kind !== 'depth-texture') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `textureGatherCompare compares against a depth texture; "${shown}" is a sampled colour ` +
        `texture with no depth to compare. textureGather reads its channels.`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  const out = [...args]
  if (tex.type.kind === 'texture') {
    if (at !== 1) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `textureGather on a ${shown} takes the component first: textureGather(0, tex, smp, ` +
          `coords) reads the red channel of the four texels.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    const lit = foldNumericLit(args[0]!)
    if (
      lit.op !== 'lit' ||
      typeof lit.value !== 'number' ||
      !Number.isInteger(lit.value) ||
      lit.value < 0 ||
      lit.value > 3
    ) {
      pushDiag(
        diagnostics,
        sourceFile,
        node.arguments[0]!,
        `textureGather's component must be a whole number from 0 to 3 written in the call ` +
          `(0 is red, 3 is alpha); WGSL requires a constant there and refuses any other value.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    out[0] =
      typeKey(lit.type) === 'i32' || typeKey(lit.type) === 'u32'
        ? lit
        : { op: 'lit', type: i32T, value: lit.value }
  } else if (at !== 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${id} on a ${shown} takes no component: a depth texture has one channel. Write ` +
        `${id}(tex, smp, coords${compare ? ', ref' : ''}).`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  const smp = args[at + 1]
  const wantSmp = compare ? 'sampler-comparison' : 'sampler'
  if (smp === undefined || smp.type.kind !== wantSmp) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      compare
        ? `textureGatherCompare compares through a sampler_comparison; got ` +
            `${smp === undefined ? 'nothing' : typeKey(smp.type)}.`
        : `textureGather reads through an ordinary sampler; got ` +
            `${smp === undefined ? 'nothing' : typeKey(smp.type)}. A sampler_comparison ` +
            `compares instead, with textureGatherCompare.`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  const suffix = arraySuffix(tex.type.dim)
  const isArray = suffix !== ''
  const want = at + 3 + (isArray ? 1 : 0) + (compare ? 1 : 0)
  if (!arity(id, args, want, node, sourceFile, diagnostics)) return undefined
  if (
    !vecArg(
      id,
      tex.type,
      args[at + 2]!,
      node.arguments[at + 2]!,
      'coordinate',
      sourceFile,
      diagnostics,
    )
  )
    return undefined
  if (isArray) {
    const k = at + 3
    const layer = intArg(out[k]!, node.arguments[k]!, i32T, 'layer', sourceFile, diagnostics)
    if (!layer) return undefined
    out[k] = layer
  }
  // One id per WGSL argument structure; a cube gathers by direction with the 2d id, since the
  // coordinate's width rides on the type, and the depth forms differ only in taking no component.
  const fn =
    tex.type.kind === 'texture'
      ? isArray
        ? 'textureGatherArray'
        : 'textureGather'
      : compare
        ? isArray
          ? 'textureGatherCompareArray'
          : 'textureGatherCompare'
        : isArray
          ? 'textureGatherDepthArray'
          : 'textureGatherDepth'
  const type: ShaderType =
    tex.type.kind === 'texture' ? { kind: 'vec', n: 4, elem: tex.type.elem } : vec4fT
  return { op: 'call', type, fn, args: out }
}

/** The coordinate a texture is addressed by has the width its `dim` decides — a `vec2` on a 2d
 *  texture (and on the array, whose layer is a separate argument), a `vec3` DIRECTION on a cube
 *  and a `vec3` on a 3d texture — and the gradients of `textureSampleGrad` have the same width
 *  (roadmap 0.4 item 12). Both targets refuse the wrong width ("no matching call" on Tint, "no
 *  matching overloaded function" on a WebGL2 driver), so this says it first, at the argument.
 *
 *  Only the WIDTH is checked here. The element is `tsc`'s to check through the ambient lib, and
 *  an integer literal in a float coordinate is retargeted by the ordinary numeric path. */
function vecArg(
  id: string,
  tex: Extract<ShaderType, { kind: 'texture' | 'depth-texture' }>,
  arg: Expr,
  node: ts.Expression,
  what: 'coordinate' | 'gradient',
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  const want =
    tex.dim === '1d' ? 1 : tex.dim === '2d' || tex.dim === '2d-array' || tex.dim === '2d-ms' ? 2 : 3
  // A 1d texture (roadmap 0.4 item 12) is addressed by ONE number: an f32 to sample, an integer
  // to fetch. Only the width is checked, as for the vectors.
  if (want === 1 ? arg.type.kind === 'scalar' : arg.type.kind === 'vec' && arg.type.n === want)
    return true
  const shape =
    want === 1
      ? `single ${id === 'textureLoad' ? 'integer' : 'f32'} ${what}`
      : (tex.dim === 'cube' || tex.dim === 'cube-array') && what === 'coordinate'
        ? 'vec3 direction'
        : `vec${want} ${what}`
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `${id} on a ${typeKey(tex)} takes a ${shape}; got ${typeKey(arg.type)}.`,
    TS_CODES.TYPE_MISMATCH,
  )
  return false
}

/** A texture argument both targets take as a plain `f32` — a mip level, a sampling bias, the
 *  reference depth of a comparison — checked for the one type that reaches it looking like a
 *  float and is not one: an emulated double.
 *
 *  An `f64` is a PAIR of f32 words after the fp64 pass, so there is no `textureSampleLevel`
 *  overload for it on either target. It used to be accepted here and refused by that pass as
 *  SD0041 at emit — a diagnostic with no source span, after the call the author wrote was
 *  gone. Said here, at the argument, with the narrow that makes it legal (#151 F64-06). The
 *  native scalars are `tsc`'s to check through the ambient lib, as everywhere else. */
function floatArg(
  what: string,
  arg: Expr,
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  if (arg.type.kind !== 'f64' && arg.type.kind !== 'vec64') return true
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `${what} must be an f32; got ${typeKey(arg.type)}. Write f32(x).`,
    TS_CODES.TYPE_MISMATCH,
  )
  return false
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
  // An emulated double is not a literal, so it used to sail through every check below and
  // reach emit as a span-less SD0041. It needs its own message: this slot wants an INTEGER,
  // so `f32(x)` alone is not the fix — the pass has no f64 → i32 body either, which makes
  // the narrow a two-step one (#151).
  if (arg.type.kind === 'f64' || arg.type.kind === 'vec64') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `A texture ${what} must be an i32 or u32; got ${typeKey(arg.type)}. An emulated double ` +
        `narrows to f32 first, so write i32(f32(x)).`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
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

function vectorCtorType(n: 2 | 3 | 4, elem: VecCtorElem): ShaderType {
  if (elem === 'f64') return { kind: 'vec64', n }
  return { kind: 'vec', n, elem }
}

/** True for the one argument shape {@link lowerCall} converts rather than composes: a native
 *  vector of the constructor's own size whose element kind differs. Both sides must be native
 *  (f32 / i32 / u32) — an emulated-double vector is not converted here, since a vec64 is a
 *  pair of f32 lanes the fp64 pass assembles, not a component list to reinterpret. */
function isConvertibleVector(t: ShaderType, ctor: { n: 2 | 3 | 4; elem: VecCtorElem }): boolean {
  if (ctor.elem === 'f64') return false
  return t.kind === 'vec' && t.n === ctor.n && t.elem !== ctor.elem
}

function isVectorCtorScalar(t: ShaderType, elem: VecCtorElem): boolean {
  if (elem === 'f64') return t.kind === 'f64'
  return t.kind === 'scalar' && t.scalar === elem
}

function isVectorCtorArg(t: ShaderType, elem: VecCtorElem): boolean {
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

/** Lower a call to a generic function: lower its arguments, ask the file's lowering for the
 *  instance those types name, then check the call against it the way any other call is checked
 *  (roadmap 0.3 item T9, #92). The arguments are lowered ONCE and handed on, since lowering
 *  them again inside `lowerUserCall` would report every diagnostic in them twice. */
function lowerGenericCall(
  node: ts.CallExpression,
  name: string,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const lowered: Expr[] = []
  for (const arg of node.arguments) {
    // No contextual type: the parameter's is what the instantiation is about to decide. A bare
    // integer literal therefore lowers as f32 and reads T as f32; `pick<i32>(…)` is how a call
    // says otherwise.
    const one = lowerExpression(arg, sourceFile, scope, diagnostics)
    if (!one) return undefined
    lowered.push(one)
  }
  const decl = scope.instantiateGeneric(
    name,
    node,
    lowered.map((e) => e.type),
    sourceFile,
    diagnostics,
  )
  if (!decl) return undefined
  return lowerUserCall(node, decl, sourceFile, scope, diagnostics, { lowered, shown: name })
}
