// === Whether a switch clause runs on into the clause below it (Rule 7.3, #202) ===
//
// TypeScript runs a clause whose end is reachable straight into the clause below it. WGSL's
// `switch` has no fall-through, so the lowering ends every clause where its statements end, and
// the two programs parted with no diagnostic: `case 0: x = 1.` above `case 1: x += 2.; break`
// gives `k = 0` the value 3 in TypeScript and 1 on the GPU. Rule 7.3 refuses that clause.
//
// Reachability is TypeScript's own, as its binder computes it for `noFallthroughCasesInSwitch`
// (TS7029), over the statements this surface can hold:
//   - `break`, `continue`, `return` and `throw` leave;
//   - a block leaves when one of its statements does;
//   - an `if` leaves when both arms do, and under a literal `true` or `false` condition only
//     the arm that runs counts;
//   - a loop completes unless its condition is absent or the literal `true` and no `break`
//     leaves it;
//   - a nested `switch` completes unless it has a `default:`, its last clause leaves and no
//     `break` leaves it.
// The answer is read off the syntax alone. A statement the front end refuses is judged the same
// way, so whether a clause falls through never depends on another diagnostic.

import ts from 'typescript';

/** Whether control can run off the end of `statements`: none of them always leaves. */
export function endIsReachable(statements: readonly ts.Statement[]): boolean {
  return statements.every(completes);
}

/** Whether `s` can complete normally, so that whatever follows it runs. */
function completes(s: ts.Statement): boolean {
  if (
    ts.isBreakStatement(s) ||
    ts.isContinueStatement(s) ||
    ts.isReturnStatement(s) ||
    ts.isThrowStatement(s)
  ) {
    return false;
  }
  if (ts.isBlock(s)) return endIsReachable(s.statements);
  if (ts.isIfStatement(s)) {
    const thenCompletes = completes(s.thenStatement);
    const elseCompletes = s.elseStatement === undefined || completes(s.elseStatement);
    if (s.expression.kind === ts.SyntaxKind.TrueKeyword) return thenCompletes;
    if (s.expression.kind === ts.SyntaxKind.FalseKeyword) return elseCompletes;
    return thenCompletes || elseCompletes;
  }
  if (ts.isWhileStatement(s) || ts.isForStatement(s)) {
    const cond = ts.isWhileStatement(s) ? s.expression : s.condition;
    return !alwaysTrue(cond) || breaksOut(s.statement, labelOf(s));
  }
  if (ts.isDoStatement(s)) {
    const reachesCondition = completes(s.statement) || continuesIn(s.statement, labelOf(s));
    return (reachesCondition && !alwaysTrue(s.expression)) || breaksOut(s.statement, labelOf(s));
  }
  if (ts.isSwitchStatement(s)) {
    const clauses = s.caseBlock.clauses;
    const last = clauses[clauses.length - 1];
    return (
      !clauses.some(ts.isDefaultClause) ||
      last === undefined ||
      endIsReachable(last.statements) ||
      clauses.some((c) => c.statements.some((t) => breaksOut(t, labelOf(s))))
    );
  }
  if (ts.isLabeledStatement(s)) {
    return completes(s.statement) || breaksOut(s.statement, s.label.text);
  }
  if (ts.isTryStatement(s)) {
    const bodyCompletes =
      completes(s.tryBlock) || (s.catchClause !== undefined && completes(s.catchClause.block));
    return bodyCompletes && (s.finallyBlock === undefined || completes(s.finallyBlock));
  }
  // An expression, a declaration, `for…of` and `for…in` (which run out when their operand
  // does), and anything else: control goes on to the next statement.
  return true;
}

/** A missing `for` condition, or the literal `true`: the loop only ends through a `break`. */
const alwaysTrue = (cond: ts.Expression | undefined): boolean =>
  cond === undefined || cond.kind === ts.SyntaxKind.TrueKeyword;

/** The label written on `s`, when it is the statement of a labelled statement. */
const labelOf = (s: ts.Statement): string | undefined =>
  ts.isLabeledStatement(s.parent) ? s.parent.label.text : undefined;

const isLoop = (n: ts.Node): boolean =>
  ts.isIterationStatement(n, /* lookInLabeledStatements */ false);

/** Whether a `break` inside `body` leaves the statement `body` belongs to: an unlabelled one no
 *  nearer loop or switch takes, or one naming `label`. */
function breaksOut(body: ts.Node, label: string | undefined): boolean {
  const visit = (n: ts.Node): boolean => {
    if (ts.isBreakStatement(n)) {
      return n.label === undefined ? true : n.label.text === label;
    }
    if (ts.isFunctionLike(n) || ts.isClassLike(n)) return false;
    // A nearer loop or switch takes an unlabelled `break`; a labelled one can still name ours.
    if (isLoop(n) || ts.isSwitchStatement(n)) return label !== undefined && labelledBreakIn(n);
    return ts.forEachChild(n, visit) ?? false;
  };
  const labelledBreakIn = (n: ts.Node): boolean => {
    if (ts.isBreakStatement(n)) return n.label !== undefined && n.label.text === label;
    if (ts.isFunctionLike(n) || ts.isClassLike(n)) return false;
    return ts.forEachChild(n, labelledBreakIn) ?? false;
  };
  return visit(body);
}

/** Whether a `continue` inside `body` goes on to the next iteration of the loop `body` belongs
 *  to. A `switch` does not take a `continue`, so only a nearer loop hides an unlabelled one. */
function continuesIn(body: ts.Node, label: string | undefined): boolean {
  const visit = (n: ts.Node): boolean => {
    if (ts.isContinueStatement(n)) {
      return n.label === undefined ? true : n.label.text === label;
    }
    if (ts.isFunctionLike(n) || ts.isClassLike(n)) return false;
    if (isLoop(n)) return label !== undefined && labelledContinueIn(n);
    return ts.forEachChild(n, visit) ?? false;
  };
  const labelledContinueIn = (n: ts.Node): boolean => {
    if (ts.isContinueStatement(n)) return n.label !== undefined && n.label.text === label;
    if (ts.isFunctionLike(n) || ts.isClassLike(n)) return false;
    return ts.forEachChild(n, labelledContinueIn) ?? false;
  };
  return visit(body);
}

/** Whether the clause at `index` would run on into a clause with a body. Falling only into
 *  empty clauses at the end of the switch runs nothing more in TypeScript either, so that is
 *  not a divergence (an empty trailing `case` is refused for its own reason). */
export function fallsIntoABody(clauses: readonly ts.CaseOrDefaultClause[], index: number): boolean {
  const clause = clauses[index];
  if (clause === undefined || clause.statements.length === 0) return false;
  if (!clauses.slice(index + 1).some((c) => c.statements.length > 0)) return false;
  return endIsReachable(clause.statements);
}
