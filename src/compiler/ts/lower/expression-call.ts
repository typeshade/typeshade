import ts from 'typescript'
import type { Expr } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { LoweringScope } from '../context.js'
import { expectedArity, isCanonicalMathFn, resolveMathConst, resolveMathExpand, resolveMathFn } from '../math-alias.js'
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

const VEC_CTOR: Readonly<Record<string, { n: 2 | 3 | 4; elem: 'f32' | 'i32' | 'u32' | 'f64' }>> = {
  vec2: { n: 2, elem: 'f32' }, vec2f: { n: 2, elem: 'f32' }, vec2i: { n: 2, elem: 'i32' }, vec2u: { n: 2, elem: 'u32' }, vec2f64: { n: 2, elem: 'f64' },
  vec3: { n: 3, elem: 'f32' }, vec3f: { n: 3, elem: 'f32' }, vec3i: { n: 3, elem: 'i32' }, vec3u: { n: 3, elem: 'u32' }, vec3f64: { n: 3, elem: 'f64' },
  vec4: { n: 4, elem: 'f32' }, vec4f: { n: 4, elem: 'f32' }, vec4i: { n: 4, elem: 'i32' }, vec4u: { n: 4, elem: 'u32' }, vec4f64: { n: 4, elem: 'f64' },
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
        pushDiag(diagnostics, sourceFile, node, `"Math.${jsName}" is a constant, not a function.`)
        return undefined
      }
      if (jsName === 'random') return lowerRandomCall(node, sourceFile, scope, diagnostics)
      if (resolveMathExpand(jsName)) return lowerExpandCall(jsName, node, sourceFile, scope, diagnostics)
      intrinsicId = resolveMathFn(jsName)
      if (!intrinsicId) {
        pushDiag(diagnostics, sourceFile, node, `"Math.${jsName}(...)" is not a TypeShade Math alias.`)
        return undefined
      }
    } else if (callee.name.text === 'swizzle') {
      return lowerSwizzleCall(node, callee.expression, sourceFile, scope, diagnostics)
    } else if (JS_ARRAY_METHODS.has(callee.name.text)) {
      pushDiag(diagnostics, sourceFile, node, `JS Array method ".${callee.name.text}" is not a shader op. Use sum/min/any/all/zip/fill.`)
      return undefined
    } else {
      pushDiag(diagnostics, sourceFile, node, 'Method calls are not supported. Use free functions.')
      return undefined
    }
  } else if (ts.isIdentifier(callee)) {
    const name = callee.text
    if (name === 'array') return lowerArrayCtor(node, sourceFile, scope, diagnostics)
    if (name === 'fill') return lowerFill(node, sourceFile, scope, diagnostics)
    if (name === 'sum' || name === 'min' || name === 'max' || name === 'any' || name === 'all' || name === 'none' || name === 'zip') {
      const folded = lowerArrayFold(name, node, sourceFile, scope, diagnostics)
      if (folded !== 'fallback') return folded
    }
    if (SCALAR_CAST[name]) return lowerScalarCastCall(name, node, sourceFile, scope, diagnostics)
    ctor = VEC_CTOR[name]
    if (!ctor) {
      if (name === 'random') return lowerRandomCall(node, sourceFile, scope, diagnostics)
      if (resolveMathExpand(name)) return lowerExpandCall(name, node, sourceFile, scope, diagnostics)
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
      return { op: 'construct', type: vectorCtorType(ctor.n, ctor.elem), args: Array.from({ length: ctor.n }, () => splat) }
    }
    if (vectorComponentCount(args) !== ctor.n) {
      pushDiag(diagnostics, sourceFile, node, 'Vector constructor component count mismatch.')
      return undefined
    }
    const badArg = args.find((arg) => !isVectorCtorArg(arg.type, ctor.elem))
    if (badArg) {
      pushDiag(diagnostics, sourceFile, node, `Vector constructor element type mismatch: expected ${ctor.elem}.`)
      return undefined
    }
    return { op: 'construct', type: vectorCtorType(ctor.n, ctor.elem), args }
  }

  if (!intrinsicId) {
    pushDiag(diagnostics, sourceFile, node, `Unknown function "${node.getText(sourceFile)}". Function calls (Phase 6) need a visible callee.`)
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
  return { op: 'call', type: mathResultType(intrinsicId, args), fn: intrinsicId, args }
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
): void {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  diagnostics.push({ message, fileName: sourceFile.fileName, line: line + 1, character: character + 1, category: 'error' })
}
