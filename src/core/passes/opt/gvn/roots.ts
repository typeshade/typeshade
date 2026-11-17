import type { Expr, Stmt } from '../../../ir/index.js';
import type { FnReads } from '../../effects.js';
import { collectMutatedRoots, eachExpr } from '../expr-utils.js';

export function rootsOf(e: Expr, reads: FnReads): Set<string> {
  const out = new Set<string>();
  eachExpr(e, (x) => {
    if (x.op === 'varref' || x.op === 'param' || x.op === 'constref' || x.op === 'externref')
      out.add(x.name);
    else if (x.op === 'call') for (const n of reads.get(x.fn) ?? []) out.add(n);
  });
  return out;
}

export function writesAnyRoot(written: ReadonlySet<string>, roots: ReadonlySet<string>): boolean {
  if (written.size === 0) return false;
  for (const r of roots) if (written.has(r)) return true;
  return false;
}

export function namesWrittenOrShadowedBy(s: Stmt): Set<string> {
  const out = new Set<string>();
  collectMutatedRoots([s], out);
  if (s.s === 'let' || s.s === 'var') out.add(s.name);
  else if (s.s === 'for' && (s.init.s === 'let' || s.init.s === 'var')) out.add(s.init.name);
  return out;
}
