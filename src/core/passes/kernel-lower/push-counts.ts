import type { Expr, Stmt } from '../../ir/nodes.js';
import { eachExpr, eachStmtExpr } from '../../ir/visit.js';
import type { ForStmt } from '../kernel-lower-ir.js';
import { lastLoopOf } from '../kernel-stores.js';
import type { KernelProof } from '../parallel-loop.js';

export function pushGap(
  v: Extract<KernelProof['loops'][number], { ok: true }>,
  j: number,
): string | undefined {
  const appends = v.writes.filter((w) => w.kind === 'append');
  if (appends.length === 0) return undefined;
  const loop = `loop ${j + 1}`;
  if (appends.length > 1)
    return `${loop} pushes onto ${appends.map((w) => `"${w.name}"`).join(' and ')}, and the call counts the pushes of one array a loop`;
  if (v.reductions.length > 0)
    return `${loop} pushes and reduces "${v.reductions[0]!.name}", which its counting step would combine twice`;
  for (const w of v.writes) {
    if (w.kind === 'append') continue;
    if (w.kind === 'scatter' || w.kind === 'texel')
      return `${loop} pushes and ${w.kind === 'scatter' ? 'scatters into' : 'stores into'} "${w.name}", which its counting step would write twice`;
    if (v.stores.find((s) => s.name === w.name)?.readBack === true)
      return `${loop} pushes and reads back what it writes to "${w.name}", which its counting step does not write`;
  }
  return undefined;
}

export function earlyPushCount(
  body: readonly Stmt[],
  pushers: ReadonlyMap<string, readonly number[]>,
): boolean {
  const last = lastLoopOf(body);
  const later = (names: ReadonlySet<string>, j: number): boolean =>
    [...names].some((a) => (pushers.get(a) ?? []).some((k) => k >= j));
  let j = 0;
  for (const [i, st] of body.entries()) {
    if (i > last) break;
    if (st.s !== 'for') {
      if (later(pushCountsIn([st]), j)) return true;
      continue;
    }
    if (later(pushCountsIn(headerStmts(st)), j)) return true;
    if (pushCountsIn([st.update, ...st.body]).size > 0) return true;
    j++;
  }
  return false;
}

function headerStmts(loop: ForStmt): Stmt[] {
  return [loop.init, { s: 'call', expr: loop.cond } as Stmt];
}

export function pushCountsBetween(body: readonly Stmt[]): Set<string> {
  const last = lastLoopOf(body);
  return pushCountsIn(
    body.flatMap((st, i) =>
      i > last || st.s === 'return' ? [] : st.s === 'for' ? headerStmts(st) : [st],
    ),
  );
}

export function pushCountsIn(sts: readonly Stmt[]): Set<string> {
  const found = new Set<string>();
  const visit = (e: Expr): void =>
    eachExpr(e, (x) => {
      if (x.op === 'call' && x.fn === 'pushCount' && x.args[0]?.op === 'param')
        found.add(x.args[0].name);
    });
  const walk = (st: Stmt): void => eachStmtExpr(st, visit, walk);
  sts.forEach(walk);
  return found;
}

export function addsPerRun(sts: readonly Stmt[], name: string): number | undefined {
  const adds = (e: Expr): number => {
    let n = 0;
    eachExpr(e, (x) => {
      if (
        x.op === 'call' &&
        (x.fn === 'collectionAdd' || x.fn === 'collectionSet') &&
        x.args[0]?.op === 'param' &&
        x.args[0].name === name
      )
        n++;
    });
    return n;
  };
  let total = 0;
  let nested = false;
  const walk = (body: readonly Stmt[], inLoop: boolean): void => {
    for (const st of body) {
      let here = 0;
      eachStmtExpr(
        st,
        (e) => (here += adds(e)),
        () => {},
      );
      if (here > 0 && inLoop) nested = true;
      total += here;
      if (st.s === 'if') {
        for (const a of st.arms) walk(a.body, inLoop);
        if (st.elseBody !== undefined) walk(st.elseBody, inLoop);
      } else if (st.s === 'for') {
        walk(st.body, true);
      } else if (st.s === 'switch') {
        for (const c of st.cases) walk(c.body, inLoop);
        if (st.defaultBody !== undefined) walk(st.defaultBody, inLoop);
      }
    }
  };
  walk(sts, false);
  return nested ? undefined : total;
}
