import ts from 'typescript';
import { activeReason } from './evaluate-unit.js';
import { expressionReason, primitiveReason } from './evaluation-free.js';
import { isPrimitiveLiteral } from './primitive-values.js';
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
    const condition =
      ts.isPropertyAccessExpression(callee.expression) &&
      ['runIf', 'skipIf'].includes(callee.expression.name.text);
    for (const argument of callee.arguments) {
      const reason = condition ? primitiveReason(argument, st) : expressionReason(argument, st);
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

const isOptions = (node: ts.Expression): boolean =>
  ts.isNumericLiteral(node) ||
  (ts.isObjectLiteralExpression(node) &&
    node.properties.every(
      (property) =>
        ts.isPropertyAssignment(property) &&
        !ts.isComputedPropertyName(property.name) &&
        isPrimitiveLiteral(property.initializer),
    ));

const isTodo = (callee: ts.Expression): boolean =>
  ts.isPropertyAccessExpression(callee) &&
  (callee.name.text === 'todo' || isTodo(callee.expression));

function callReason(call: ts.CallExpression, st: State): string | undefined {
  const table = tableReasons(call.expression, st);
  if (table !== undefined) return table;
  const isDescribe = rootName(call.expression) === 'describe';
  const [title, ...rest] = call.arguments;
  if (title !== undefined) {
    const reason = expressionReason(title, st);
    if (reason !== undefined) return reason;
  }
  let callbacks = 0;
  for (const argument of rest) {
    if (isFunction(argument)) {
      callbacks += 1;
      const reason = isDescribe ? bodyReason(argument.body, st) : undefined;
      if (reason !== undefined) return reason;
    } else if (!isOptions(argument)) {
      return `suite callback is not inline: ${describeNode(argument)}`;
    }
  }
  if (callbacks !== 1 && !isTodo(call.expression)) {
    return `suite callback is not inline: ${describeNode(call)}`;
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
