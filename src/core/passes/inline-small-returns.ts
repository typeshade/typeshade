import type { Expr, Stmt } from '../ir/index.js';

type ReturnTo = (value: Expr | undefined) => Stmt[];

interface Tail {
  readonly body: Stmt[];
  readonly ends: boolean;
}

function holdsReturn(s: Stmt): boolean {
  switch (s.s) {
    case 'return':
      return true;
    case 'if':
      return (
        s.arms.some((a) => a.body.some(holdsReturn)) || (s.elseBody?.some(holdsReturn) ?? false)
      );
    case 'switch':
      return (
        s.cases.some((c) => c.body.some(holdsReturn)) || (s.defaultBody?.some(holdsReturn) ?? false)
      );
    case 'for':
      return s.body.some(holdsReturn);
    default:
      return false;
  }
}

function tailIf(
  s: Stmt & { s: 'if' },
  rest: readonly Stmt[],
  returnTo: ReturnTo,
): Tail | undefined {
  const arms = s.arms.map((a) => tailify(a.body, returnTo));
  const other = tailify(s.elseBody ?? [], returnTo);
  if (other === undefined || arms.some((a) => a === undefined)) return undefined;
  const branches = [...(arms as Tail[]), other];
  const falling = branches.filter((b) => !b.ends);
  let ends = falling.length === 0;
  if (rest.length > 0 && falling.length > 0) {
    if (falling.length > 1) return undefined;
    const t = tailify(rest, returnTo);
    if (t === undefined) return undefined;
    falling[0]!.body.push(...t.body);
    ends = t.ends;
  }
  return {
    body: [
      {
        ...s,
        arms: s.arms.map((a, k) => ({ cond: a.cond, body: branches[k]!.body })),
        ...(s.elseBody !== undefined || other.body.length > 0 ? { elseBody: other.body } : {}),
      },
    ],
    ends,
  };
}

export function tailify(body: readonly Stmt[], returnTo: ReturnTo): Tail | undefined {
  const out: Stmt[] = [];
  for (let i = 0; i < body.length; i++) {
    const s = body[i]!;
    if (s.s === 'return') return { body: [...out, ...returnTo(s.expr)], ends: true };
    if (!holdsReturn(s)) {
      out.push(s);
      continue;
    }
    if (s.s !== 'if') return undefined;
    const t = tailIf(s, body.slice(i + 1), returnTo);
    return t === undefined ? undefined : { body: [...out, ...t.body], ends: t.ends };
  }
  return { body: out, ends: false };
}
