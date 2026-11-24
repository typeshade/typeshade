import type { Expr, Stmt } from '../../ir/nodes.js';
import type { ShaderType } from '../../ir/types.js';
import { u32T } from '../../ir/types.js';
import { mapStmtExpr } from '../../ir/visit.js';
import { combineOf as writeCombine, type LoopReduction } from '../parallel-loop.js';
import { boolT, liveRef } from './refs.js';
import { mapBlock } from './walk.js';

export interface DeferredScatter {
  readonly i: number;
  readonly op: LoopReduction['op'];
  readonly array: Expr;
  readonly elem: ShaderType;
}

export const scatterRef = (d: DeferredScatter, what: 'w' | 'k' | 'v' | 'p'): Expr => ({
  op: 'varref',
  type: what === 'w' || what === 'p' ? boolT : what === 'k' ? u32T : d.elem,
  name: `_sg${what}${d.i}`,
});

export function deferScatters(
  sts: readonly Stmt[],
  scatter: ReadonlySet<string>,
  deferred: DeferredScatter[],
): Stmt[] {
  return mapBlock(sts, (st): Stmt[] | undefined => {
    if (st.s !== 'assign' && st.s !== 'assignOp') return undefined;
    const t = st.target;
    if (t.op !== 'index' || t.base.op !== 'param' || !scatter.has(t.base.name)) return undefined;
    const combine = writeCombine(st).combine;
    if (combine === undefined) return undefined;
    const at = atomicArray(t.base.type);
    const d: DeferredScatter = {
      i: deferred.length,
      op: combine.op,
      array: { ...t.base, type: at },
      elem: { kind: 'scalar', scalar: (at as { elem: { elem: 'u32' | 'i32' } }).elem.elem },
    };
    deferred.push(d);
    const key: Expr =
      t.idx.type.kind === 'scalar' && t.idx.type.scalar === 'u32'
        ? t.idx
        : { op: 'call', type: u32T, fn: 'u32', args: [t.idx] };
    return [
      { s: 'assign', target: scatterRef(d, 'w'), expr: liveRef },
      { s: 'assign', target: scatterRef(d, 'k'), expr: key },
      { s: 'assign', target: scatterRef(d, 'v'), expr: combine.with },
    ];
  });
}

export const ATOMIC_OF: Readonly<Record<string, string>> = {
  '+': 'atomicAdd',
  '&': 'atomicAnd',
  '|': 'atomicOr',
  '^': 'atomicXor',
  min: 'atomicMin',
  max: 'atomicMax',
};

export function atomicArray(t: ShaderType): ShaderType {
  const elem = (t as { elem: ShaderType }).elem as { scalar: 'u32' | 'i32' };
  return { kind: 'array', elem: { kind: 'atomic', elem: elem.scalar } };
}

export function toAtomics(st: Stmt, scatter: ReadonlySet<string>): Stmt {
  if (scatter.size === 0) return st;
  const inner = mapStmtExpr(
    st,
    (e) => e,
    (b) => toAtomics(b, scatter),
  );
  if (inner.s !== 'assign' && inner.s !== 'assignOp') return inner;
  const t = inner.target;
  if (t.op !== 'index' || t.base.op !== 'param' || !scatter.has(t.base.name)) return inner;
  const combine = writeCombine(inner).combine;
  if (combine === undefined) return inner;
  const at = atomicArray(t.base.type);
  const atomicT = (at as { elem: ShaderType }).elem;
  const place: Expr = { ...t, type: atomicT, base: { ...t.base, type: at } };
  return {
    s: 'call',
    expr: {
      op: 'call',
      type: t.type,
      fn: ATOMIC_OF[combine.op]!,
      args: [place, combine.with],
    },
    ...(inner.span !== undefined ? { span: inner.span } : {}),
  };
}
