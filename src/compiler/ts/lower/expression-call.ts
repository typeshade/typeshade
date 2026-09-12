import ts from 'typescript'
import type { Expr } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { vec2fT, vec3fT, vec4fT, typeKey } from '../../../core/ir/types.js'
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

const VEC_CTOR: Readonly<Record<string, { n: number; type: ShaderType }>> = {
  vec2: { n: 2, type: vec2fT },
  vec2f: { n: 2, type: vec2fT },
  vec3: { n: 3, type: vec3fT },
  vec3f: { n: 3, type: vec3fT },
  vec4: { n: 4, type: vec4fT },
  vec4f: { n: 4, type: vec4fT },
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
  let ctor: { n: number; type: ShaderType } | undefined

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
    if (args.length === 1 && isNumericScalar(args[0]!.type)) {
      const splat = args[0]!
      return { op: 'construct', type: ctor.type, args: Array.from({ length: ctor.n }, () => splat) }
    }
    if (args.length !== ctor.n) {
      pushDiag(diagnostics, sourceFile, node, 'Vector constructor arity mismatch.')
      return undefined
    }
    return { op: 'construct', type: ctor.type, args }
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

function isNumericScalar(t: ShaderType): boolean {
  const k = typeKey(t)
  return k === 'f32' || k === 'i32' || k === 'u32'
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
