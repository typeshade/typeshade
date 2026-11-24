import ts from 'typescript';
import { finding, type Finding } from './finding.js';
import { freeComments } from './free-comments.js';
import { isRunnableTest } from './runnable-tests.js';
import type { Side } from './side-program.js';
import { isSuiteCallee } from './titles.js';
import type { Unit } from './units.js';

export const isTestCall = (statement: ts.Statement): boolean =>
  ts.isExpressionStatement(statement) &&
  ts.isCallExpression(statement.expression) &&
  isSuiteCallee(statement.expression.expression);

const startsWithPragma = (text: string): boolean =>
  text
    .split('\n')
    .some((line) => line.replace(/^\s*(?:\/\/|\/\*+|\*+)?\s*/, '').startsWith('@vitest-'));

const pragmasOf = (side: Side, path: string): string =>
  freeComments(side, path)
    .map((comment) => comment.text)
    .filter(startsWithPragma)
    .sort()
    .join('\0');

export function testMoveFindings(
  from: Unit,
  to: Unit,
  base: Side,
  head: Side,
  listed: ReadonlySet<string>,
): Finding[] {
  const findings: Finding[] = [];
  const name = to.names.join(', ') || '(unnamed)';
  const at = (kind: string): void => {
    findings.push(finding(kind, to.path, name, to.line));
  };
  if (pragmasOf(base, from.path) !== pragmasOf(head, to.path))
    at('test moved across a vitest pragma');
  if (listed.has(from.path) || listed.has(to.path)) at('test moved across a vitest project path');
  if (!isRunnableTest(to.path)) at('test moved to a file vitest does not run');
  return findings;
}
