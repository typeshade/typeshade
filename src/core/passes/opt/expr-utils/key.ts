import type { Expr } from '../../../ir/index.js';
import { typeKey } from '../../../ir/index.js';

// Why: the IR is immutable, so one node's key never changes. A pass that edited a node in
// place would make this memo return a stale key.
const keyMemo = new WeakMap<Expr, string>();

export function keyOf(e: Expr): string {
  const memo = keyMemo.get(e);
  if (memo !== undefined) return memo;
  const k = keyOfUncached(e);
  keyMemo.set(e, k);
  return k;
}

function keyOfUncached(e: Expr): string {
  switch (e.op) {
    case 'lit':
      return `L:${typeKey(e.type)}:${Object.is(e.value, -0) ? '-0' : String(e.value)}`;
    case 'constref':
      return `C:${e.name}`;
    case 'externref':
    case 'overrideref':
      return `O:${e.name}`;
    case 'param':
      return `P:${e.name}`;
    case 'varref':
      return `V:${e.name}`;
    case 'binop':
      return `(${keyOf(e.a)}${e.bop}${keyOf(e.b)})`;
    case 'compare':
      return `(${keyOf(e.a)}${e.cop}${keyOf(e.b)})`;
    case 'logical':
      return `(${keyOf(e.a)}${e.lop}${keyOf(e.b)})`;
    case 'unop':
      return `(-${keyOf(e.a)})`;
    case 'call':
      return `${e.fn}(${e.args.map(keyOf).join(',')})`;
    case 'construct':
      return `${typeKey(e.type)}{${e.args.map(keyOf).join(',')}}`;
    case 'member':
      return `${keyOf(e.base)}.${e.field}`;
    case 'index':
      return `${keyOf(e.base)}[${keyOf(e.idx)}]`;
    case 'select':
      return `S(${keyOf(e.cond)},${keyOf(e.ifTrue)},${keyOf(e.ifFalse)})`;
    case 'matchExpr':
      return `M(${keyOf(e.scrutinee)};${e.cases.map(([n, v]) => `${n}:${keyOf(v)}`).join(',')};${keyOf(e.default)})`;
  }
}

const isGuardFetch = (e: Expr): boolean =>
  e.op === 'call' && e.fn === 'f64Guard' && e.args.length === 0;

export const isCompound = (e: Expr): boolean =>
  e.op !== 'lit' &&
  e.op !== 'constref' &&
  e.op !== 'overrideref' &&
  e.op !== 'externref' &&
  e.op !== 'param' &&
  e.op !== 'varref' &&
  !isGuardFetch(e);
