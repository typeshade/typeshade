import ts from 'typescript';
import { activeReason } from './evaluate-unit.js';
import { expressionReason } from './evaluation-free.js';
import { describeNode, type EvaluationContext, type State } from './evaluation-state.js';
import { isSuiteCallee } from './titles.js';

const HOOKS = new Set(['beforeEach', 'afterEach', 'beforeAll', 'afterAll']);

export const isTestCall = (statement: ts.Statement): boolean =>
  ts.isExpressionStatement(statement) &&
  ts.isCallExpression(statement.expression) &&
  isSuiteCallee(statement.expression.expression);

const isFunction = (node: ts.Expression): node is ts.ArrowFunction | ts.FunctionExpression =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node);

function rootName(callee: ts.Expression): string | undefined {
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isCallExpression(callee)) return rootName(callee.expression);
  return ts.isPropertyAccessExpression(callee) ? rootName(callee.expression) : undefined;
}

function tableReasons(callee: ts.Expression, st: State): string | undefined {
  if (ts.isCallExpression(callee)) {
    for (const argument of callee.arguments) {
      const reason = expressionReason(argument, st);
      if (reason !== undefined) return reason;
    }
    return tableReasons(callee.expression, st);
  }
  return ts.isPropertyAccessExpression(callee) ? tableReasons(callee.expression, st) : undefined;
}

const collectionTime = (node: ts.Node): string =>
  `collection-time code in describe: ${describeNode(node)}`;

function bodyReason(body: ts.ConciseBody, st: State): string | undefined {
  if (!ts.isBlock(body)) return collectionTime(body);
  for (const statement of body.statements) {
    const call = ts.isExpressionStatement(statement) ? statement.expression : undefined;
    if (call !== undefined && ts.isCallExpression(call)) {
      if (isSuiteCallee(call.expression)) {
        const reason = callReason(call, st);
        if (reason !== undefined) return reason;
        continue;
      }
      if (ts.isIdentifier(call.expression) && HOOKS.has(call.expression.text)) {
        if (call.arguments.every(isFunction)) continue;
        return collectionTime(statement);
      }
      return collectionTime(statement);
    }
    if (activeReason(statement, st.ctx) !== undefined) return collectionTime(statement);
  }
  return undefined;
}

function callReason(call: ts.CallExpression, st: State): string | undefined {
  const table = tableReasons(call.expression, st);
  if (table !== undefined) return table;
  const isDescribe = rootName(call.expression) === 'describe';
  for (const argument of call.arguments) {
    if (isFunction(argument)) {
      const reason = isDescribe ? bodyReason(argument.body, st) : undefined;
      if (reason !== undefined) return reason;
      continue;
    }
    const reason = expressionReason(argument, st);
    if (reason !== undefined) return reason;
  }
  return undefined;
}

export function testCallReason(
  statement: ts.Statement,
  ctx: EvaluationContext,
): string | undefined {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) {
    return describeNode(statement);
  }
  return callReason(statement.expression, { ctx, visiting: new Set() });
}
