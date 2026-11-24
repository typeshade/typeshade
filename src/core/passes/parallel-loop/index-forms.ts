import type { Expr } from '../../ir/nodes.js';
import { eachExpr } from '../../ir/visit.js';
import { transparent, isName, reads, readsAny, sameExpr, allSame } from './expression-equality.js';
import type { IndexForm } from './types.js';

export function indicesOf(e: Expr): Expr[] {
  const out: Expr[] = [];
  let b: Expr = e;
  while (b.op === 'index' || b.op === 'member') {
    if (b.op === 'index') out.push(b.idx);
    b = b.base;
  }
  return out;
}

export function elementIndex(e: Expr): Expr | undefined {
  let b: Expr = e;
  let last: Expr | undefined;
  while (b.op === 'index' || b.op === 'member') {
    if (b.op === 'index') last = b.idx;
    b = b.base;
  }
  return last;
}

export function affine(
  e: Expr,
  i: string,
  lets: ReadonlyMap<string, Expr>,
  depth = 0,
): { a: number; c: number } | undefined {
  if (depth > 16) return undefined;
  const r = (x: Expr): { a: number; c: number } | undefined => affine(x, i, lets, depth + 1);
  const inner = transparent(e);
  if (inner !== e) return r(inner);
  switch (e.op) {
    case 'lit':
      return typeof e.value === 'number' ? { a: 0, c: e.value } : undefined;
    case 'varref':
    case 'param': {
      if (e.name === i) return { a: 1, c: 0 };
      const bound = lets.get(e.name);
      return bound === undefined ? undefined : r(bound);
    }
    case 'unop': {
      const x = r(e.a);
      return x === undefined ? undefined : { a: -x.a, c: -x.c };
    }
    case 'binop': {
      const x = r(e.a);
      const y = r(e.b);
      if (x === undefined || y === undefined) return undefined;
      if (e.bop === '+') return { a: x.a + y.a, c: x.c + y.c };
      if (e.bop === '-') return { a: x.a - y.a, c: x.c - y.c };
      if (e.bop === '*') {
        if (x.a === 0) return { a: x.c * y.a, c: x.c * y.c };
        if (y.a === 0) return { a: y.c * x.a, c: y.c * x.c };
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

export function distinctForm(
  idx: readonly Expr[],
  i: string,
  lets: ReadonlyMap<string, Expr>,
  inner: ReadonlyMap<string, Expr | undefined>,
  local: ReadonlySet<string>,
): IndexForm | undefined {
  const forms = idx.map((e) => affine(e, i, lets));
  if (forms.every((f) => f !== undefined)) {
    const fs = forms as { a: number; c: number }[];
    const a = fs[0]!.a;
    if (a !== 0 && fs.every((f) => f.a === a)) {
      const cs = fs.map((f) => f.c);
      const oneC = cs.every((x) => x === cs[0]);
      const inStride = cs.every((x) => x >= 0 && x < Math.abs(a));
      if (oneC || inStride) return { kind: 'affine', a, c: [...new Set(cs)] };
    }
    return undefined;
  }
  const rows = idx.map((e) => rowMajor(e, i, lets, inner, local));
  if (rows.every((w) => w !== undefined) && allSame(rows as Expr[]))
    return { kind: 'row-major', width: rows[0]! };
  if (allSame(idx)) {
    const k = scaledCoefficient(idx[0]!, i, local);
    if (k !== undefined) return { kind: 'scaled', index: idx[0]!, coefficient: k };
  }
  return undefined;
}

function through(e: Expr, lets: ReadonlyMap<string, Expr>, depth = 0): Expr {
  const x = transparent(e);
  if (depth < 16 && isName(x) && lets.has(x.name))
    return through(lets.get(x.name)!, lets, depth + 1);
  return x;
}

function rowMajor(
  e: Expr,
  i: string,
  lets: ReadonlyMap<string, Expr>,
  inner: ReadonlyMap<string, Expr | undefined>,
  local: ReadonlySet<string>,
): Expr | undefined {
  const x = through(e, lets);
  if (x.op !== 'binop' || x.bop !== '+') return undefined;
  const isI = (y: Expr): boolean => {
    const z = through(y, lets);
    return isName(z) && z.name === i;
  };
  const invariant = (y: Expr): boolean => loopInvariant(y, i, lets, local);
  for (const [mul, add] of [
    [x.a, x.b],
    [x.b, x.a],
  ] as const) {
    const m = through(mul, lets);
    const counter = through(add, lets);
    if (m.op !== 'binop' || m.bop !== '*' || !isName(counter) || !inner.has(counter.name)) continue;
    const w = isI(m.a) ? m.b : isI(m.b) ? m.a : undefined;
    const bound = inner.get(counter.name);
    if (
      w !== undefined &&
      bound !== undefined &&
      invariant(w) &&
      invariant(bound) &&
      sameExpr(w, bound, lets)
    )
      return w;
  }
  return undefined;
}

function loopInvariant(
  e: Expr,
  i: string,
  lets: ReadonlyMap<string, Expr>,
  local: ReadonlySet<string>,
  depth = 0,
): boolean {
  if (depth > 16) return false;
  let ok = true;
  eachExpr(e, (x) => {
    if (!ok || !isName(x)) return;
    if (x.name === i) ok = false;
    else if (lets.has(x.name)) ok = loopInvariant(lets.get(x.name)!, i, lets, local, depth + 1);
    else if (local.has(x.name)) ok = false;
  });
  return ok;
}

function scaledCoefficient(e: Expr, i: string, local: ReadonlySet<string>): Expr | undefined {
  const invariant = (x: Expr): boolean => !reads(x, i) && !readsAny(x, local);
  let x = transparent(e);
  if (x.op === 'binop' && x.bop === '+') {
    if (invariant(x.b)) x = transparent(x.a);
    else if (invariant(x.a)) x = transparent(x.b);
    else return undefined;
  }
  if (isName(x) && x.name === i) return { op: 'lit', type: x.type, value: 1 };
  if (x.op !== 'binop' || x.bop !== '*') return undefined;
  const a = transparent(x.a);
  const b = transparent(x.b);
  if (isName(a) && a.name === i && invariant(b)) return b;
  if (isName(b) && b.name === i && invariant(a)) return a;
  return undefined;
}

export function texelWidth(
  coord: Expr,
  i: string,
  lets: ReadonlyMap<string, Expr>,
  local: ReadonlySet<string>,
): Expr | undefined {
  if (coord.op !== 'construct' || coord.args.length !== 2) return undefined;
  const [x, y] = coord.args.map(transparent) as [Expr, Expr];
  if (x.op !== 'binop' || x.bop !== '%' || y.op !== 'binop' || y.bop !== '/') return undefined;
  const isI = (e: Expr): boolean => {
    const t = transparent(e);
    return isName(t) && t.name === i;
  };
  if (!isI(x.a) || !isI(y.a) || !sameExpr(x.b, y.b, lets)) return undefined;
  if (!loopInvariant(x.b, i, lets, local)) return undefined;
  return x.b;
}
