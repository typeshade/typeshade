import type { Expr } from '../../ir/nodes.js';
import { eachExpr } from '../../ir/visit.js';

export function transparent(e: Expr): Expr {
  if (
    (e.op === 'call' || e.op === 'construct') &&
    e.args.length === 1 &&
    e.type.kind === 'scalar' &&
    (e.type.scalar === 'u32' || e.type.scalar === 'i32') &&
    (e.op === 'construct' || e.fn === 'u32' || e.fn === 'i32')
  )
    return e.args[0]!;
  return e;
}

type NameExpr = Expr & { op: 'varref' | 'param' };
export const isName = (e: Expr): e is NameExpr => e.op === 'varref' || e.op === 'param';

export function reads(e: Expr, name: string): boolean {
  let hit = false;
  eachExpr(e, (x) => {
    if (isName(x) && x.name === name) hit = true;
  });
  return hit;
}

export function readsAny(e: Expr, names: ReadonlySet<string>): boolean {
  let hit = false;
  eachExpr(e, (x) => {
    if (isName(x) && names.has(x.name)) hit = true;
  });
  return hit;
}

export function sameExpr(a: Expr, b: Expr, lets?: ReadonlyMap<string, Expr>, depth = 0): boolean {
  if (depth > 16) return false;
  const x = transparent(a);
  const y = transparent(b);
  const same = (p: Expr, q: Expr): boolean => sameExpr(p, q, lets, depth + 1);
  if (isName(x) && isName(y) && x.name === y.name) return true;
  if (lets !== undefined) {
    if (isName(x) && lets.has(x.name)) return same(lets.get(x.name)!, y);
    if (isName(y) && lets.has(y.name)) return same(x, lets.get(y.name)!);
  }
  if (x.op !== y.op) return false;
  switch (x.op) {
    case 'lit':
      return x.value === (y as typeof x).value;
    case 'constref':
    case 'overrideref':
    case 'externref':
      return x.name === (y as typeof x).name;
    case 'binop': {
      const o = y as typeof x;
      return x.bop === o.bop && same(x.a, o.a) && same(x.b, o.b);
    }
    case 'compare': {
      const o = y as typeof x;
      return x.cop === o.cop && same(x.a, o.a) && same(x.b, o.b);
    }
    case 'unop': {
      const o = y as typeof x;
      return same(x.a, o.a);
    }
    case 'member': {
      const o = y as typeof x;
      return x.field === o.field && same(x.base, o.base);
    }
    case 'index': {
      const o = y as typeof x;
      return same(x.base, o.base) && same(x.idx, o.idx);
    }
    case 'call':
    case 'construct': {
      const o = y as typeof x;
      if (x.op === 'call' && x.fn !== (o as typeof x).fn) return false;
      return x.args.length === o.args.length && x.args.every((p, k) => same(p, o.args[k]!));
    }
    default:
      return false;
  }
}

export const allSame = (xs: readonly Expr[]): boolean => xs.every((x) => sameExpr(x, xs[0]!));
