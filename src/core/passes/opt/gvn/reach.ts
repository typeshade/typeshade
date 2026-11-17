import type { Expr, Stmt } from '../../../ir/index.js';
import { eachExpr, keyOf } from '../expr-utils.js';
import { exprsThatMayReadATemp, mentionsKey } from './positions.js';
import { namesWrittenOrShadowedBy, writesAnyRoot } from './roots.js';

export function tempIsReadInside(s: Stmt, k: string, roots: ReadonlySet<string>): boolean {
  switch (s.s) {
    case 'if':
      return (
        s.arms.some(
          (a, i) => (i > 0 && mentionsKey(a.cond, k)) || tempIsReadInBlock(a.body, k, roots),
        ) ||
        (s.elseBody !== undefined && tempIsReadInBlock(s.elseBody, k, roots))
      );
    case 'switch':
      return (
        s.cases.some((c) => tempIsReadInBlock(c.body, k, roots)) ||
        (s.defaultBody !== undefined && tempIsReadInBlock(s.defaultBody, k, roots))
      );
    case 'for':
      return (
        !writesAnyRoot(namesWrittenOrShadowedBy(s), roots) && tempIsReadInBlock(s.body, k, roots)
      );
    default:
      return false;
  }
}

function tempIsReadInBlock(body: readonly Stmt[], k: string, roots: ReadonlySet<string>): boolean {
  for (const s of body) {
    if (exprsThatMayReadATemp(s).some((e) => mentionsKey(e, k)) || tempIsReadInside(s, k, roots))
      return true;
    if (writesAnyRoot(namesWrittenOrShadowedBy(s), roots)) return false;
  }
  return false;
}

export function keysMentionedInside(body: readonly Stmt[]): Set<string> {
  const out = new Set<string>();
  const add = (e: Expr): void => eachExpr(e, (x) => void out.add(keyOf(x)));
  const inBody = (b: readonly Stmt[]): void => {
    for (const s of b) {
      for (const e of exprsThatMayReadATemp(s)) add(e);
      inside(s);
    }
  };
  const inside = (s: Stmt): void => {
    if (s.s === 'if') {
      s.arms.forEach((a, i) => {
        if (i > 0) add(a.cond);
        inBody(a.body);
      });
      if (s.elseBody) inBody(s.elseBody);
    } else if (s.s === 'for') inBody(s.body);
    else if (s.s === 'switch') {
      for (const c of s.cases) inBody(c.body);
      if (s.defaultBody) inBody(s.defaultBody);
    }
  };
  for (const s of body) inside(s);
  return out;
}
