import ts from 'typescript'
import type { Expr } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { f64T, i32T, typeKey } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { LoweringScope } from '../context.js'
import { TS_CODES, type TsCode } from '../codes.js'
import { makeDiagnostic } from '../diagnostic.js'
import { retargetIntLit } from '../lit-coerce.js'
import { lowerExpression } from './expression.js'
import { refuseBareAtomic } from './atomics.js'

export function lowerIndex(
  node: ts.ElementAccessExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const base = lowerExpression(node.expression, sourceFile, scope, diagnostics)
  if (!base || !node.argumentExpression) return undefined
  let idx = lowerExpression(node.argumentExpression, sourceFile, scope, diagnostics)
  if (!idx) return undefined
  idx = retargetIntLit(idx, node.argumentExpression, i32T)
  const ik = typeKey(idx.type)
  if (ik !== 'i32' && ik !== 'u32') {
    pushDiag(diagnostics, sourceFile, node, 'Index must be i32 or u32.', TS_CODES.TYPE_MISMATCH)
    return undefined
  }
  // An emulated-double vector has no runtime component addressing: it is a pair of hi/lo
  // PLANES after the fp64 pass, so lane i is a swizzle of both planes (`laneSwizzle`) and a
  // dynamic index would have to swizzle by a value, which neither target spells. A constant
  // index is exactly a swizzle, so it lowers to the `member` the pass already handles; a
  // dynamic one is refused with the spelling that works (#151 F64-04).
  if (base.type.kind === 'vec64') {
    if (idx.op !== 'lit' || typeof idx.value !== 'number' || !Number.isInteger(idx.value)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `A ${typeKey(base.type)} is indexed by a constant lane, since an emulated double is a ` +
          `pair of hi/lo planes and a lane of it is a swizzle of both; write v.x, v.y or a ` +
          `whole-number index.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    const i = idx.value
    if (i < 0 || i >= base.type.n) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Index ${i} is out of range for length ${base.type.n}.`,
        TS_CODES.INDEX_OOB,
      )
      return undefined
    }
    return { op: 'member', type: f64T, base, field: 'xyzw'[i]! }
  }
  const elem = indexElem(base.type)
  if (!elem) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Cannot index ${typeKey(base.type)}.`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  if (refuseBareAtomic(elem, node, sourceFile, scope, diagnostics)) return undefined
  const bound = indexBound(base.type)
  if (bound !== undefined && idx.op === 'lit' && typeof idx.value === 'number') {
    const i = idx.value
    if (!Number.isInteger(i) || i < 0 || i >= bound) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Index ${i} is out of range for length ${bound}.`,
        TS_CODES.INDEX_OOB,
      )
      return undefined
    }
  }
  return { op: 'index', type: elem, base, idx }
}

export function lowerSelect(
  node: ts.ConditionalExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  contextual?: ShaderType,
): Expr | undefined {
  const cond = lowerExpression(node.condition, sourceFile, scope, diagnostics)
  // Both arms sit in the ternary's own position, so both take its context (#8 A11). A
  // `return c ? { … } : { … }` in a function declared `A` is two object literals in a
  // declared position, not two literals in none; without this each fell through to the
  // unique-struct fallback and was refused twice over.
  let ifTrue = lowerExpression(node.whenTrue, sourceFile, scope, diagnostics, contextual)
  let ifFalse = lowerExpression(node.whenFalse, sourceFile, scope, diagnostics, contextual)
  if (!cond || !ifTrue || !ifFalse) return undefined
  if (typeKey(cond.type) !== 'bool') {
    pushDiag(
      diagnostics,
      sourceFile,
      node.condition,
      'Ternary condition must be bool.',
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  ifTrue = retargetIntLit(ifTrue, node.whenTrue, ifFalse.type)
  ifFalse = retargetIntLit(ifFalse, node.whenFalse, ifTrue.type)
  if (typeKey(ifTrue.type) !== typeKey(ifFalse.type)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Ternary arm type mismatch: ${typeKey(ifTrue.type)} vs ${typeKey(ifFalse.type)}.`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  return { op: 'select', type: ifTrue.type, cond, ifTrue, ifFalse }
}

export function matVecMul(left: Expr, right: Expr): Expr | undefined {
  const lt = left.type
  const rt = right.type
  if (lt.kind === 'mat' && rt.kind === 'vec' && lt.n === rt.n && lt.elem === rt.elem) {
    return { op: 'binop', type: right.type, bop: '*', a: left, b: right }
  }
  if (lt.kind === 'mat' && rt.kind === 'vec64' && lt.n === rt.n && lt.elem === 'f64') {
    return { op: 'binop', type: right.type, bop: '*', a: left, b: right }
  }
  if (lt.kind === 'mat' && rt.kind === 'mat' && lt.n === rt.n && lt.elem === rt.elem) {
    return { op: 'binop', type: left.type, bop: '*', a: left, b: right }
  }
  return undefined
}

function indexElem(t: ShaderType): ShaderType | undefined {
  if (t.kind === 'array') return t.elem
  if (t.kind === 'vec') return { kind: 'scalar', scalar: t.elem }
  if (t.kind === 'mat' && t.elem === 'f32') return { kind: 'vec', n: t.n, elem: 'f32' }
  return undefined
}

function indexBound(t: ShaderType): number | undefined {
  if (t.kind === 'array') return t.size
  if (t.kind === 'vec') return t.n
  if (t.kind === 'mat') return t.n
  return undefined
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
