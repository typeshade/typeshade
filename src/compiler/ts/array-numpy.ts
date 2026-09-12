// Broadcast + clip/where/dot/scan over array<T, N>.

import ts from 'typescript'
import type { BinOp, CmpOp, Expr } from '../../core/ir/nodes.js'
import type { ShaderType } from '../../core/ir/types.js'
import { arrayT, boolT, i32T, typeKey } from '../../core/ir/types.js'
import type { TsCompilerDiagnostic } from './source-file.js'

const MAX_UNROLL = 64

export function isArrayNumpy(name: string): boolean {
  return name === 'clip' || name === 'where' || name === 'scan' || name === 'prefixSum' || name === 'dot'
}

function at(xs: Expr, i: number, elem: ShaderType): Expr {
  return { op: 'index', type: elem, base: xs, idx: { op: 'lit', type: i32T, value: i } }
}

type SizedArray = { readonly kind: 'array'; readonly elem: ShaderType; readonly size: number }

function asSized(t: ShaderType): SizedArray | undefined {
  return t.kind === 'array' && typeof t.size === 'number' ? { kind: 'array', elem: t.elem, size: t.size } : undefined
}

function tooBig(n: number, node: ts.Node, sourceFile: ts.SourceFile, diagnostics: TsCompilerDiagnostic[]): boolean {
  if (n <= MAX_UNROLL) return false
  diagnostics.push(err(sourceFile, node, `Array op unrolls N=${n}; max is ${MAX_UNROLL}.`))
  return true
}

export function broadcastBinop(
  bop: BinOp,
  left: Expr,
  right: Expr,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const pair = pairArrays(left, right, node, sourceFile, diagnostics)
  if (!pair) return undefined
  const { n, aAt, bAt, elem } = pair
  const args: Expr[] = []
  for (let i = 0; i < n; i++) args.push({ op: 'binop', type: elem, bop, a: aAt(i), b: bAt(i) })
  return { op: 'construct', type: arrayT(elem, n), args }
}

export function broadcastCompare(
  cop: CmpOp,
  left: Expr,
  right: Expr,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const pair = pairArrays(left, right, node, sourceFile, diagnostics)
  if (!pair) return undefined
  const { n, aAt, bAt } = pair
  const args: Expr[] = []
  for (let i = 0; i < n; i++) args.push({ op: 'compare', type: boolT, cop, a: aAt(i), b: bAt(i) })
  return { op: 'construct', type: arrayT(boolT, n), args }
}

function pairArrays(
  left: Expr,
  right: Expr,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): { n: number; elem: ShaderType; aAt: (i: number) => Expr; bAt: (i: number) => Expr } | undefined {
  const la = asSized(left.type)
  const ra = asSized(right.type)
  if (!la && !ra) return undefined
  if (la && ra) {
    if (la.size !== ra.size) {
      diagnostics.push(err(sourceFile, node, `Broadcast length mismatch: ${la.size} vs ${ra.size}.`))
      return undefined
    }
    if (typeKey(la.elem) !== typeKey(ra.elem)) {
      diagnostics.push(err(sourceFile, node, `Broadcast element mismatch.`))
      return undefined
    }
    if (tooBig(la.size, node, sourceFile, diagnostics)) return undefined
    const n = la.size
    const elem = la.elem
    return { n, elem, aAt: (i) => at(left, i, elem), bAt: (i) => at(right, i, elem) }
  }
  if (la) {
    if (typeKey(la.elem) !== typeKey(right.type)) {
      diagnostics.push(err(sourceFile, node, `Broadcast scalar must be ${typeKey(la.elem)}.`))
      return undefined
    }
    if (tooBig(la.size, node, sourceFile, diagnostics)) return undefined
    const n = la.size
    const elem = la.elem
    return { n, elem, aAt: (i) => at(left, i, elem), bAt: () => right }
  }
  if (!ra) return undefined
  if (typeKey(ra.elem) !== typeKey(left.type)) {
    diagnostics.push(err(sourceFile, node, `Broadcast scalar must be ${typeKey(ra.elem)}.`))
    return undefined
  }
  if (tooBig(ra.size, node, sourceFile, diagnostics)) return undefined
  const n = ra.size
  const elem = ra.elem
  return { n, elem, aAt: () => left, bAt: (i) => at(right, i, elem) }
}

export function lowerArrayNumpy(
  name: string,
  args: readonly Expr[],
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | 'fallback' | undefined {
  if (name === 'dot') {
    if (args.length !== 2 || !asSized(args[0]!.type) || !asSized(args[1]!.type)) return 'fallback'
    return lowerDot(args[0]!, args[1]!, node, sourceFile, diagnostics)
  }
  if (name === 'clip') return lowerClip(args, node, sourceFile, diagnostics)
  if (name === 'where') return lowerWhere(args, node, sourceFile, diagnostics)
  if (name === 'scan' || name === 'prefixSum') return lowerScan(args, node, sourceFile, diagnostics)
  return 'fallback'
}

function lowerDot(
  xs: Expr, ys: Expr, node: ts.Node, sourceFile: ts.SourceFile, diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const xa = asSized(xs.type)!
  const ya = asSized(ys.type)!
  if (xa.size !== ya.size) {
    diagnostics.push(err(sourceFile, node, `dot length mismatch: ${xa.size} vs ${ya.size}.`))
    return undefined
  }
  if (typeKey(xa.elem) !== typeKey(ya.elem)) {
    diagnostics.push(err(sourceFile, node, 'dot element types must match.'))
    return undefined
  }
  const n = xa.size
  const elem = xa.elem
  if (n < 1 || tooBig(n, node, sourceFile, diagnostics)) return undefined
  let acc: Expr = { op: 'binop', type: elem, bop: '*', a: at(xs, 0, elem), b: at(ys, 0, elem) }
  for (let i = 1; i < n; i++) {
    const p: Expr = { op: 'binop', type: elem, bop: '*', a: at(xs, i, elem), b: at(ys, i, elem) }
    acc = { op: 'binop', type: elem, bop: '+', a: acc, b: p }
  }
  return acc
}

function lowerClip(
  args: readonly Expr[], node: ts.Node, sourceFile: ts.SourceFile, diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (args.length !== 3) {
    diagnostics.push(err(sourceFile, node, 'clip(xs, lo, hi)'))
    return undefined
  }
  const xs = args[0]!, lo = args[1]!, hi = args[2]!
  if (!asSized(xs.type)) {
    diagnostics.push(err(sourceFile, node, 'clip(xs, lo, hi) needs array<T, N> as xs.'))
    return undefined
  }
  const xa = asSized(xs.type)!
  const n = xa.size
  const elem = xa.elem
  if (tooBig(n, node, sourceFile, diagnostics)) return undefined
  const loAt = lane(lo, n, elem, 'lo', node, sourceFile, diagnostics)
  const hiAt = lane(hi, n, elem, 'hi', node, sourceFile, diagnostics)
  if (!loAt || !hiAt) return undefined
  const out: Expr[] = []
  for (let i = 0; i < n; i++) {
    const x = at(xs, i, elem)
    out.push({ op: 'call', type: elem, fn: 'min', args: [{ op: 'call', type: elem, fn: 'max', args: [x, loAt(i)] }, hiAt(i)] })
  }
  return { op: 'construct', type: arrayT(elem, n), args: out }
}

function lowerWhere(
  args: readonly Expr[], node: ts.Node, sourceFile: ts.SourceFile, diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (args.length !== 3) {
    diagnostics.push(err(sourceFile, node, 'where(mask, a, b)'))
    return undefined
  }
  const mask = args[0]!, a = args[1]!, b = args[2]!
  const ma = asSized(mask.type)
  if (!ma || typeKey(ma.elem) !== 'bool') {
    diagnostics.push(err(sourceFile, node, 'where mask must be array<bool, N>.'))
    return undefined
  }
  const n = ma.size
  if (tooBig(n, node, sourceFile, diagnostics)) return undefined
  const ae = asSized(a.type)
  const elem = ae ? ae.elem : a.type
  const aAt = lane(a, n, elem, 'a', node, sourceFile, diagnostics)
  const bAt = lane(b, n, elem, 'b', node, sourceFile, diagnostics)
  if (!aAt || !bAt) return undefined
  const out: Expr[] = []
  for (let i = 0; i < n; i++) {
    out.push({ op: 'select', type: elem, cond: at(mask, i, boolT), ifTrue: aAt(i), ifFalse: bAt(i) })
  }
  return { op: 'construct', type: arrayT(elem, n), args: out }
}

function lowerScan(
  args: readonly Expr[], node: ts.Node, sourceFile: ts.SourceFile, diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (args.length !== 1 || !asSized(args[0]!.type)) {
    diagnostics.push(err(sourceFile, node, 'scan(xs) needs array<T, N>.'))
    return undefined
  }
  const xs = args[0]!
  const xa = asSized(xs.type)!
  const n = xa.size
  const elem = xa.elem
  const k = typeKey(elem)
  if (k !== 'f32' && k !== 'i32' && k !== 'u32') {
    diagnostics.push(err(sourceFile, node, 'scan needs a numeric array.'))
    return undefined
  }
  if (tooBig(n, node, sourceFile, diagnostics)) return undefined
  const out: Expr[] = [at(xs, 0, elem)]
  let acc: Expr = out[0]!
  for (let i = 1; i < n; i++) {
    acc = { op: 'binop', type: elem, bop: '+', a: acc, b: at(xs, i, elem) }
    out.push(acc)
  }
  return { op: 'construct', type: arrayT(elem, n), args: out }
}

function lane(
  expr: Expr, n: number, elem: ShaderType, label: string,
  node: ts.Node, sourceFile: ts.SourceFile, diagnostics: TsCompilerDiagnostic[],
): ((i: number) => Expr) | undefined {
  const ea = asSized(expr.type)
  if (ea) {
    if (ea.size !== n) {
      diagnostics.push(err(sourceFile, node, `${label} length mismatch: ${ea.size} vs ${n}.`))
      return undefined
    }
    if (typeKey(ea.elem) !== typeKey(elem)) {
      diagnostics.push(err(sourceFile, node, `${label} element type mismatch.`))
      return undefined
    }
    return (i) => at(expr, i, elem)
  }
  if (typeKey(expr.type) !== typeKey(elem)) {
    diagnostics.push(err(sourceFile, node, `${label} must be ${typeKey(elem)} or array.`))
    return undefined
  }
  return () => expr
}

function err(sourceFile: ts.SourceFile, node: ts.Node, message: string): TsCompilerDiagnostic {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return { message, fileName: sourceFile.fileName, line: line + 1, character: character + 1, category: 'error' }
}
