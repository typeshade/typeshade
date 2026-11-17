import type { Expr, Stmt } from '../../../ir/index.js';
import { keyOf, mapChildren } from '../expr-utils.js';
import { type EnclosingTemp, keysToBindInTallyOrder } from './choose.js';
import { rewriteTempReads } from './positions.js';
import { namesWrittenOrShadowedBy, rootsOf, writesAnyRoot } from './roots.js';
import { firstStmtOf, tallyBlock, type TallyScope } from './tally.js';

export interface MintedTemp {
  readonly block: readonly Stmt[];
  readonly key: string;
}

export interface FnScope extends TallyScope {
  readonly next: { n: number };
  readonly deny: ReadonlyMap<readonly Stmt[], ReadonlySet<string>>;
  readonly minted: Map<string, MintedTemp>;
}

interface TempLet {
  readonly name: string;
  readonly expr: Expr;
}

type TempsInScope = ReadonlyMap<string, EnclosingTemp>;

function tempsALoopBodyMayTrust(loop: Stmt, live: TempsInScope): Map<string, EnclosingTemp> {
  if (live.size === 0) return new Map();
  const written = namesWrittenOrShadowedBy(loop);
  const out = new Map<string, EnclosingTemp>();
  for (const [k, temp] of live) if (!writesAnyRoot(written, temp.roots)) out.set(k, temp);
  return out;
}

function numberNestedBlocks(s: Stmt, scope: FnScope, live: TempsInScope): Stmt {
  switch (s.s) {
    case 'if':
      return {
        ...s,
        arms: s.arms.map((a) => ({ cond: a.cond, body: numberBlock(a.body, scope, live) })),
        elseBody: s.elseBody ? numberBlock(s.elseBody, scope, live) : undefined,
      };
    case 'for':
      return { ...s, body: numberBlock(s.body, scope, tempsALoopBodyMayTrust(s, live)) };
    case 'switch':
      return {
        ...s,
        cases: s.cases.map((c) => ({ values: c.values, body: numberBlock(c.body, scope, live) })),
        defaultBody: s.defaultBody ? numberBlock(s.defaultBody, scope, live) : undefined,
      };
    default:
      return s;
  }
}

function mintTempsBeforeFirstOccurrence(
  body: readonly Stmt[],
  scope: FnScope,
  enclosing: TempsInScope,
  writtenByStmt: readonly ReadonlySet<string>[],
): Map<number, TempLet[]> {
  const letsBeforeStmt = new Map<number, TempLet[]>();
  const keys = keysToBindInTallyOrder(
    body,
    tallyBlock(body, scope),
    writtenByStmt,
    enclosing,
    scope.deny.get(body),
    scope.reads,
  );
  for (const [key, occur] of keys) {
    const at = firstStmtOf(occur);
    const lets = letsBeforeStmt.get(at) ?? [];
    const name = `_gv${scope.next.n++}`;
    lets.push({ name, expr: occur.exemplar });
    scope.minted.set(name, { block: body, key });
    letsBeforeStmt.set(at, lets);
  }
  return letsBeforeStmt;
}

export function numberBlock(
  body: readonly Stmt[],
  scope: FnScope,
  enclosing: TempsInScope = new Map(),
): Stmt[] {
  const writtenByStmt = body.map(namesWrittenOrShadowedBy);
  const letsBeforeStmt = mintTempsBeforeFirstOccurrence(body, scope, enclosing, writtenByStmt);
  const live = new Map<string, EnclosingTemp>(enclosing);
  const out: Stmt[] = [];
  const readLiveTemps = (e: Expr): Expr => {
    const temp = live.get(keyOf(e));
    if (temp !== undefined) return { op: 'varref', type: e.type, name: temp.name };
    return mapChildren(e, readLiveTemps);
  };
  body.forEach((s, stmt) => {
    for (const l of letsBeforeStmt.get(stmt) ?? []) {
      out.push({ s: 'let', name: l.name, expr: mapChildren(l.expr, readLiveTemps) });
      live.set(keyOf(l.expr), { name: l.name, roots: rootsOf(l.expr, scope.reads) });
    }
    out.push(rewriteTempReads(numberNestedBlocks(s, scope, live), readLiveTemps));
    const written = writtenByStmt[stmt]!;
    if (written.size > 0)
      for (const [k, temp] of [...live]) if (writesAnyRoot(written, temp.roots)) live.delete(k);
  });
  return out;
}
