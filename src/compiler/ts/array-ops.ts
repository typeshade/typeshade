import type { Expr, FuncDecl } from '../../core/ir/nodes.js'
import type { ShaderType } from '../../core/ir/types.js'
import { boolT, i32T } from '../../core/ir/types.js'

export function arraySize(t: ShaderType): number | undefined {
  return t.kind === 'array' ? t.size : undefined
}

export function unrollSum(xs: Expr): Expr | string {
  const n = arraySize(xs.type)
  if (n === undefined) return 'sum(xs) needs a fixed-size array.'
  const elem = xs.type.kind === 'array' ? xs.type.elem : undefined
  if (!elem) return 'sum(xs) needs an array.'
  let acc: Expr = { op: 'index', type: elem, base: xs, idx: { op: 'lit', type: i32T, value: 0 } }
  for (let i = 1; i < n; i++) {
    acc = {
      op: 'binop',
      type: elem,
      bop: '+',
      a: acc,
      b: { op: 'index', type: elem, base: xs, idx: { op: 'lit', type: i32T, value: i } },
    }
  }
  return acc
}

export function unrollMinMax(fn: 'min' | 'max', xs: Expr): Expr | string {
  const n = arraySize(xs.type)
  if (n === undefined) return `${fn}(xs) needs a fixed-size array.`
  const elem = xs.type.kind === 'array' ? xs.type.elem : undefined
  if (!elem) return `${fn}(xs) needs an array.`
  let acc: Expr = { op: 'index', type: elem, base: xs, idx: { op: 'lit', type: i32T, value: 0 } }
  for (let i = 1; i < n; i++) {
    acc = {
      op: 'call',
      type: elem,
      fn,
      args: [acc, { op: 'index', type: elem, base: xs, idx: { op: 'lit', type: i32T, value: i } }],
    }
  }
  return acc
}

export function unrollPred(xs: Expr, pred: FuncDecl, join: '&&' | '||'): Expr | string {
  const n = arraySize(xs.type)
  if (n === undefined) return 'predicate fold needs a fixed-size array.'
  const elem = xs.type.kind === 'array' ? xs.type.elem : undefined
  if (!elem) return 'predicate fold needs an array.'
  const calls: Expr[] = []
  for (let i = 0; i < n; i++) {
    calls.push({
      op: 'call',
      type: pred.ret,
      fn: pred.name,
      args: [{ op: 'index', type: elem, base: xs, idx: { op: 'lit', type: i32T, value: i } }],
      declRef: pred,
    })
  }
  let acc = calls[0]!
  for (let i = 1; i < calls.length; i++) {
    acc = { op: 'logical', type: boolT, lop: join, a: acc, b: calls[i]! }
  }
  return acc
}

export function unrollZip(xs: Expr, ys: Expr, fn: FuncDecl): Expr | string {
  const nx = arraySize(xs.type)
  const ny = arraySize(ys.type)
  if (nx === undefined || ny === undefined) return 'zip needs fixed-size arrays.'
  if (nx !== ny) return `zip length mismatch: ${nx} vs ${ny}.`
  const xe = xs.type.kind === 'array' ? xs.type.elem : undefined
  const ye = ys.type.kind === 'array' ? ys.type.elem : undefined
  if (!xe || !ye) return 'zip needs arrays.'
  const args: Expr[] = []
  for (let i = 0; i < nx; i++) {
    args.push({
      op: 'call',
      type: fn.ret,
      fn: fn.name,
      args: [
        { op: 'index', type: xe, base: xs, idx: { op: 'lit', type: i32T, value: i } },
        { op: 'index', type: ye, base: ys, idx: { op: 'lit', type: i32T, value: i } },
      ],
      declRef: fn,
    })
  }
  return { op: 'construct', type: { kind: 'array', elem: fn.ret, size: nx }, args }
}

export function fillArray(elem: ShaderType, n: number, v: Expr): Expr {
  return { op: 'construct', type: { kind: 'array', elem, size: n }, args: Array.from({ length: n }, () => v) }
}

export function noneOf(anyExpr: Expr): Expr {
  return { op: 'compare', type: boolT, cop: '==', a: anyExpr, b: { op: 'lit', type: boolT, value: false } }
}
