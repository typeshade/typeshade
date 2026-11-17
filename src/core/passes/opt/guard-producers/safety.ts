import type { Expr, ModuleDecl, Stmt } from '../../../ir/index.js';
import { eachExpr, eachStmtExpr } from '../../../ir/visit.js';
import {
  BARRIER_INTRINSICS,
  DERIVATIVE_INTRINSICS,
  isKnownIntrinsic,
} from '../../../intrinsics.js';
import { EFFECTFUL_INTRINSICS, type FnWrites } from '../../effects.js';
import { bodyHasRaw } from '../dce.js';

const needsUniformFlowOrHasEffect = (name: string): boolean =>
  DERIVATIVE_INTRINSICS.has(name) ||
  BARRIER_INTRINSICS.has(name) ||
  EFFECTFUL_INTRINSICS.has(name) ||
  name === 'workgroupUniformLoad' ||
  name.startsWith('subgroup') ||
  name.startsWith('quad');

export function everyCallIsSafe(e: Expr, safeModuleFn: (name: string) => boolean): boolean {
  let ok = true;
  eachExpr(e, (x) => {
    if (!ok || x.op !== 'call') return;
    if (x.fn.startsWith('console.')) ok = false;
    else if (safeModuleFn(x.fn)) return;
    else if (
      x.declRef !== undefined ||
      !isKnownIntrinsic(x.fn) ||
      needsUniformFlowOrHasEffect(x.fn)
    )
      ok = false;
  });
  return ok;
}

export function functionsSafeToSkip(m: ModuleDecl, writes: FnWrites): ReadonlySet<string> {
  const byName = new Map(m.funcs.map((f) => [f.name, f]));
  const memo = new Map<string, boolean>();
  const safe = (name: string, calling: Set<string>): boolean => {
    const known = memo.get(name);
    if (known !== undefined) return known;
    const f = byName.get(name);
    const undefinedOrRecursive = f === undefined || calling.has(name);
    if (undefinedOrRecursive) return false;
    const writesOutside =
      (writes.get(name)?.size ?? 0) > 0 || f.params.some((p) => p.mode === 'inout');
    if (writesOutside || bodyHasRaw(f.body)) {
      memo.set(name, false);
      return false;
    }
    calling.add(name);
    let ok = true;
    const visit = (s: Stmt): void => {
      if (s.s === 'discard') ok = false;
      eachStmtExpr(
        s,
        (e) => {
          if (ok && !everyCallIsSafe(e, (n) => safe(n, calling))) ok = false;
        },
        visit,
      );
    };
    for (const s of f.body) visit(s);
    calling.delete(name);
    memo.set(name, ok);
    return ok;
  };
  const out = new Set<string>();
  for (const f of m.funcs) if (safe(f.name, new Set())) out.add(f.name);
  return out;
}
