import type { Expr, Stmt } from '../../../ir/index.js';
import { eachExpr } from '../../../ir/visit.js';
import { keyOf } from '../expr-utils.js';
import {
  boolT,
  GUARD_PREFIX,
  guardSkipping,
  isGuardName,
  MAX_GUARD_TERMS,
  termCount,
} from './guard-expr.js';
import { addNamesOf, namesDeclaredOrWritten, namesIn } from './names.js';
import { producersBefore } from './producers.js';

export interface ChainScope {
  readonly safe: (e: Expr) => boolean;
  readonly safeFns: ReadonlySet<string>;
  readonly counter: { n: number };
}

const noCall = (e: Expr): boolean => {
  let ok = true;
  eachExpr(e, (x) => {
    if (x.op === 'call' || x.op === 'matchExpr') ok = false;
  });
  return ok;
};

function alreadyGuardedBy(body: readonly Stmt[], members: readonly number[], guard: Expr): boolean {
  const guardKey = keyOf(guard);
  return members.every((i) => {
    const st = body[i]!;
    if (st.s === 'var') return st.init === undefined;
    if (st.s !== 'if' || st.elseBody !== undefined || st.arms.length !== 1) return false;
    const cond = st.arms[0]!.cond;
    return isGuardName(cond) || keyOf(cond) === guardKey;
  });
}

function withProducersGuarded(
  body: readonly Stmt[],
  members: readonly number[],
  guard: Expr,
  guardName: string,
): Stmt[] {
  const memberSet = new Set(members);
  const guardRef: Expr = { op: 'varref', type: boolT, name: guardName };
  const out: Stmt[] = [];
  let run: Stmt[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    out.push({ s: 'if', arms: [{ cond: guardRef, body: run }] });
    run = [];
  };
  for (let i = 0; i < body.length; i++) {
    const s = body[i]!;
    if (i === members[0]) out.push({ s: 'let', name: guardName, expr: guard });
    if (!memberSet.has(i)) {
      flush();
      out.push(s);
      continue;
    }
    if (s.s === 'let') {
      flush();
      out.push({ s: 'var', name: s.name, type: s.expr.type });
      run.push({
        s: 'assign',
        target: { op: 'varref', type: s.expr.type, name: s.name },
        expr: s.expr,
      });
    } else if (s.s === 'var') {
      flush();
      out.push({ s: 'var', name: s.name, type: s.type });
      if (s.init !== undefined)
        run.push({
          s: 'assign',
          target: { op: 'varref', type: s.type, name: s.name },
          expr: s.init,
        });
    } else run.push(s);
  }
  flush();
  return out;
}

export function guardOneChain(
  body: readonly Stmt[],
  scope: ChainScope,
): readonly Stmt[] | undefined {
  for (let c = body.length - 1; c > 0; c--) {
    const chain = body[c]!;
    if (chain.s !== 'if' || !chain.arms.every((a) => noCall(a.cond))) continue;
    const readByConditions = new Set<string>();
    for (const a of chain.arms) addNamesOf(a.cond, readByConditions);
    const readAfterChain = new Set<string>();
    for (const s of body.slice(c + 1)) for (const n of namesIn(s)) readAfterChain.add(n);

    const found = producersBefore(
      body,
      c,
      readByConditions,
      readAfterChain,
      scope.safe,
      scope.safeFns,
    );
    if (found === undefined) continue;
    const [members, produced] = found;

    const branches = [...chain.arms.map((a) => a.body), chain.elseBody ?? []];
    const readsProduced = branches.map((b) =>
      b.some((s) => [...namesIn(s)].some((n) => produced.has(n))),
    );
    const skipped = readsProduced.map((r, k) => (r ? -1 : k)).filter((k) => k >= 0);
    if (skipped.length === 0 || skipped.length === branches.length) continue;

    const guard = guardSkipping(chain, skipped);
    if (termCount(guard) > MAX_GUARD_TERMS) continue;
    if (alreadyGuardedBy(body, members, guard)) continue;
    const writtenSinceGuard = namesDeclaredOrWritten(body, members[0]!, c);
    if ([...readByConditions].some((n) => writtenSinceGuard.has(n))) continue;

    return withProducersGuarded(
      body,
      members,
      guard,
      `${GUARD_PREFIX}${String(scope.counter.n++)}`,
    );
  }
  return undefined;
}
