import type { Stmt } from '../../../ir/index.js';
import type { FnReads } from '../../effects.js';
import { eachExpr, keyOf } from '../expr-utils.js';
import { isNestingStmt } from './positions.js';
import { keysMentionedInside, tempIsReadInside } from './reach.js';
import { rootsOf, writesAnyRoot } from './roots.js';
import { firstStmtOf, type Occur, type Tally } from './tally.js';

export interface EnclosingTemp {
  readonly name: string;
  readonly roots: ReadonlySet<string>;
}

type Candidate = [key: string, occur: Occur];

type WrittenByStmt = readonly ReadonlySet<string>[];

function strictPartKeys(o: Occur): string[] {
  const keys: string[] = [];
  eachExpr(o.exemplar, (sub) => {
    if (sub !== o.exemplar) keys.push(keyOf(sub));
  });
  return keys;
}

function notInsideAnotherCandidate(cands: readonly Candidate[]): Candidate[] {
  const candKeys = new Set(cands.map(([k]) => k));
  const nested = new Set<string>();
  for (const [, o] of cands) for (const k of strictPartKeys(o)) if (candKeys.has(k)) nested.add(k);
  return cands.filter(([k]) => !nested.has(k));
}

function enclosingTempStillHolds(
  k: string,
  o: Occur,
  enclosing: ReadonlyMap<string, EnclosingTemp>,
  writtenByStmt: WrittenByStmt,
): boolean {
  const temp = enclosing.get(k);
  if (temp === undefined) return false;
  const first = firstStmtOf(o);
  for (let m = 0; m < first; m++) if (writesAnyRoot(writtenByStmt[m]!, temp.roots)) return false;
  return true;
}

function noRootWrittenBetweenOccurrences(
  o: Occur,
  writtenByStmt: WrittenByStmt,
  reads: FnReads,
): boolean {
  const stmts = [...o.stmts].sort((a, b) => a - b);
  const last = stmts[stmts.length - 1]!;
  const roots = rootsOf(o.exemplar, reads);
  for (let m = stmts[0]!; m < last; m++) if (writesAnyRoot(writtenByStmt[m]!, roots)) return false;
  return true;
}

function readByANestedBlockBeforeARootMoves(
  k: string,
  o: Occur,
  body: readonly Stmt[],
  writtenByStmt: WrittenByStmt,
  reads: FnReads,
): boolean {
  const roots = rootsOf(o.exemplar, reads);
  for (let j = firstStmtOf(o); j < body.length; j++) {
    if (tempIsReadInside(body[j]!, k, roots)) return true;
    if (writesAnyRoot(writtenByStmt[j]!, roots)) return false;
  }
  return false;
}

function keysDominatingANestedRead(
  eligible: readonly Candidate[],
  repeats: readonly Candidate[],
  keptRepeats: ReadonlySet<string>,
  body: readonly Stmt[],
  writtenByStmt: WrittenByStmt,
  reads: FnReads,
): Candidate[] {
  const mentionedInside = keysMentionedInside(body);
  const partsOfKeptRepeats = new Set<string>();
  for (const [k, o] of repeats)
    if (keptRepeats.has(k)) for (const part of strictPartKeys(o)) partsOfKeptRepeats.add(part);
  const holdsAKeptRepeat = (o: Occur): boolean =>
    strictPartKeys(o).some((part) => keptRepeats.has(part));
  return notInsideAnotherCandidate(
    eligible.filter(
      ([k, o]) =>
        mentionedInside.has(k) &&
        !keptRepeats.has(k) &&
        !partsOfKeptRepeats.has(k) &&
        !holdsAKeptRepeat(o) &&
        readByANestedBlockBeforeARootMoves(k, o, body, writtenByStmt, reads),
    ),
  );
}

export function keysToBindInTallyOrder(
  body: readonly Stmt[],
  [unguarded, guardedKeys]: Tally,
  writtenByStmt: WrittenByStmt,
  enclosing: ReadonlyMap<string, EnclosingTemp>,
  deniedKeys: ReadonlySet<string> | undefined,
  reads: FnReads,
): Candidate[] {
  const eligible = [...unguarded.entries()].filter(
    ([k, o]) =>
      !guardedKeys.has(k) &&
      deniedKeys?.has(k) !== true &&
      !enclosingTempStillHolds(k, o, enclosing, writtenByStmt),
  );
  const repeats = notInsideAnotherCandidate(eligible.filter(([, o]) => o.stmts.size >= 2));
  const keptRepeats = new Set(
    repeats
      .filter(([, o]) => noRootWrittenBetweenOccurrences(o, writtenByStmt, reads))
      .map(([k]) => k),
  );
  const chosen = new Set(keptRepeats);
  if (body.some(isNestingStmt))
    for (const [k] of keysDominatingANestedRead(
      eligible,
      repeats,
      keptRepeats,
      body,
      writtenByStmt,
      reads,
    ))
      chosen.add(k);
  return eligible.filter(([k]) => chosen.has(k));
}
