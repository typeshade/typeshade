import ts from 'typescript';
import {
  isAssignment,
  describeNode,
  resolvedDeclaration,
  type EvaluationContext,
  type State,
} from './evaluation-state.js';
import { ACCEPTED_STATEMENT_KINDS, isAccepted } from './accepted-kinds.js';
import { classReason, expressionReason } from './evaluation-free.js';

const PURE_PREFIX = [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.TildeToken];

function enumInitializerReason(expression: ts.Expression, st: State): string | undefined {
  const { checker } = st.ctx;
  if (
    ts.isNumericLiteral(expression) ||
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression) ||
    ts.isBigIntLiteral(expression)
  ) {
    return undefined;
  }
  if (ts.isParenthesizedExpression(expression))
    return enumInitializerReason(expression.expression, st);
  if (ts.isPrefixUnaryExpression(expression)) {
    return PURE_PREFIX.includes(expression.operator)
      ? enumInitializerReason(expression.operand, st)
      : describeNode(expression);
  }
  if (ts.isBinaryExpression(expression) && !isAssignment(expression.operatorToken.kind)) {
    return (
      enumInitializerReason(expression.left, st) ?? enumInitializerReason(expression.right, st)
    );
  }
  if (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression)) {
    const target = ts.isPropertyAccessExpression(expression) ? expression.name : expression;
    const symbol = checker.getSymbolAtLocation(target);
    const declaration = symbol && resolvedDeclaration(symbol, st);
    if (declaration && ts.isEnumMember(declaration)) return undefined;
  }
  return describeNode(expression);
}

const isAmbient = (statement: ts.Statement): boolean =>
  ts.canHaveModifiers(statement) &&
  (ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword) ?? false);

function statementReason(statement: ts.Statement, st: State): string | undefined {
  if (!isAccepted(ACCEPTED_STATEMENT_KINDS, statement)) return describeNode(statement);
  if (isAmbient(statement)) return undefined;
  if (
    ts.isFunctionDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isExportDeclaration(statement)
  ) {
    return undefined;
  }
  if (ts.isEnumDeclaration(statement)) {
    for (const member of statement.members) {
      const reason = member.initializer && enumInitializerReason(member.initializer, st);
      if (reason) return reason;
    }
    return undefined;
  }
  if (ts.isClassDeclaration(statement)) return classReason(statement, st);
  if (ts.isVariableStatement(statement)) {
    const list = statement.declarationList;
    if ((list.flags & ts.NodeFlags.BlockScoped) !== ts.NodeFlags.Const) {
      return describeNode(statement);
    }
    for (const declaration of list.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) {
        return describeNode(declaration);
      }
      const reason = expressionReason(declaration.initializer, st);
      if (reason !== undefined) return reason;
    }
    return undefined;
  }
  if (ts.isExportAssignment(statement)) return expressionReason(statement.expression, st);
  return describeNode(statement);
}

export function activeReason(statement: ts.Statement, ctx: EvaluationContext): string | undefined {
  return statementReason(statement, { ctx, visiting: new Set() });
}
