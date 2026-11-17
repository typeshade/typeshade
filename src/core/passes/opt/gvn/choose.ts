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

export interface ChoiceInput {
  readonly body: readonly Stmt[];
  readonly tally: Tally;
  readonly writtenByStmt: readonly ReadonlySet<string>[];
  readonly enclosing: ReadonlyMap<string, EnclosingTemp>;
  readonly deniedKeys: ReadonlySet<string> | undefined;
  readonly reads: FnReads;
}

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

function enclosingTempStillHolds(k: string, o: Occur, input: ChoiceInput): boolean {
  const temp = input.enclosing.get(k);
  if (temp === undefined) return false;
  const first = firstStmtOf(o);
  for (let m = 0; m < first; m++)
    if (writesAnyRoot(input.writtenByStmt[m]!, temp.roots)) return false;
  return true;
}

function noRootWrittenBetweenOccurrences(o: Occur, input: ChoiceInput): boolean {
  const stmts = [...o.unguardedStmts].sort((a, b) => a - b);
  const last = stmts[stmts.length - 1]!;
  const roots = rootsOf(o.exemplar, input.reads);
  for (let m = stmts[0]!; m < last; m++)
    if (writesAnyRoot(input.writtenByStmt[m]!, roots)) return false;
  return true;
}

function readByANestedBlockBeforeARootMoves(k: string, o: Occur, input: ChoiceInput): boolean {
  const roots = rootsOf(o.exemplar, input.reads);
  for (let j = firstStmtOf(o); j < input.body.length; j++) {
    if (tempIsReadInside(input.body[j]!, k, roots)) return true;
    if (writesAnyRoot(input.writtenByStmt[j]!, roots)) return false;
  }
  return false;
}

function keysDominatingANestedRead(
  eligible: readonly Candidate[],
  repeats: readonly Candidate[],
  keptRepeats: ReadonlySet<string>,
  input: ChoiceInput,
): Candidate[] {
  const mentionedInside = keysMentionedInside(input.body);
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
        readByANestedBlockBeforeARootMoves(k, o, input),
    ),
  );
}

export function keysToBindInTallyOrder(input: ChoiceInput): Candidate[] {
  const eligible = [...input.tally.unguarded.entries()].filter(
    ([k, o]) =>
      !input.tally.guardedKeys.has(k) &&
      input.deniedKeys?.has(k) !== true &&
      !enclosingTempStillHolds(k, o, input),
  );
  const repeats = notInsideAnotherCandidate(eligible.filter(([, o]) => o.unguardedStmts.size >= 2));
  const keptRepeats = new Set(
    repeats.filter(([, o]) => noRootWrittenBetweenOccurrences(o, input)).map(([k]) => k),
  );
  const chosen = new Set(keptRepeats);
  if (input.body.some(isNestingStmt))
    for (const [k] of keysDominatingANestedRead(eligible, repeats, keptRepeats, input))
      chosen.add(k);
  return eligible.filter(([k]) => chosen.has(k));
}
