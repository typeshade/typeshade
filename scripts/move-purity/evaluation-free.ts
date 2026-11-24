import ts from 'typescript';
import {
  OPERATORS_WITH_EFFECTS,
  calleeName,
  describeNode,
  isAssignment,
  isGlobalName,
  resolvedDeclaration,
  unwrap,
  type EvaluationContext,
  type State,
} from './evaluation-state.js';
import {
  ACCEPTED_CLASS_MEMBER_KINDS,
  ACCEPTED_EXPRESSION_KINDS,
  ACCEPTED_OBJECT_MEMBER_KINDS,
  isAccepted,
} from './accepted-kinds.js';
import { isPrimitiveLiteral } from './primitive-values.js';

export { describeNode, type EvaluationContext };

export const EVALUATION_FREE_CALLS: readonly string[] = [
  'Object.freeze',
  'new Map',
  'new Set',
  'new WeakMap',
  'new WeakSet',
  'Symbol',
  'Symbol.for',
];

const NAMES_WITHOUT_DECLARATION = new Set(['undefined', 'NaN', 'Infinity']);

function isFreeConst(declaration: ts.VariableDeclaration, st: State): boolean {
  const list = declaration.parent;
  if (!ts.isVariableDeclarationList(list) || !(list.flags & ts.NodeFlags.Const)) return false;
  if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) return false;
  if (st.visiting.has(declaration)) return false;
  st.visiting.add(declaration);
  const reason = expressionReason(declaration.initializer, st);
  st.visiting.delete(declaration);
  return reason === undefined;
}

function declarationReason(
  declaration: ts.Declaration,
  node: ts.Node,
  st: State,
): string | undefined {
  if (ts.isFunctionDeclaration(declaration)) return undefined;
  if (ts.isClassDeclaration(declaration) || ts.isEnumDeclaration(declaration)) return undefined;
  if (ts.isEnumMember(declaration)) return undefined;
  if (ts.isVariableDeclaration(declaration) && isFreeConst(declaration, st)) return undefined;
  return `reference to ${ts.SyntaxKind[declaration.kind]} ${describeNode(node)}`;
}

function chainRoot(node: ts.PropertyAccessExpression): ts.Identifier | undefined {
  let current: ts.Expression = node;
  while (ts.isPropertyAccessExpression(current)) {
    if (current.questionDotToken !== undefined || !ts.isIdentifier(current.name)) return undefined;
    current = current.expression;
  }
  return ts.isIdentifier(current) ? current : undefined;
}

const PRIMITIVE_OPERATORS = [
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.ExclamationToken,
  ts.SyntaxKind.TildeToken,
];

function propertyReason(node: ts.PropertyAccessExpression, st: State): string | undefined {
  const { checker } = st.ctx;
  const root = chainRoot(node);
  if (!root) return `not a plain property chain ${describeNode(node)}`;
  const rootSymbol = checker.getSymbolAtLocation(root);
  const rootDeclaration = rootSymbol && resolvedDeclaration(rootSymbol, st);
  if (!rootDeclaration) return `unresolved ${describeNode(node)}`;
  const finalSymbol = checker.getSymbolAtLocation(node.name);
  const finalDeclaration = finalSymbol && resolvedDeclaration(finalSymbol, st);
  if (ts.isEnumDeclaration(rootDeclaration)) return undefined;
  if (ts.isSourceFile(rootDeclaration) && finalDeclaration) {
    return declarationReason(finalDeclaration, node, st);
  }
  return `reference to ${ts.SyntaxKind[rootDeclaration.kind]} ${describeNode(node)}`;
}

function referenceReason(
  node: ts.Identifier | ts.PropertyAccessExpression,
  st: State,
): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return propertyReason(node, st);
  const { checker } = st.ctx;
  const parent = node.parent;
  const symbol =
    ts.isShorthandPropertyAssignment(parent) && parent.name === node
      ? checker.getShorthandAssignmentValueSymbol(parent)
      : checker.getSymbolAtLocation(node);
  const declaration = symbol && resolvedDeclaration(symbol, st);
  if (!declaration) {
    return NAMES_WITHOUT_DECLARATION.has(node.text)
      ? undefined
      : `unresolved ${describeNode(node)}`;
  }
  return declarationReason(declaration, node, st);
}

export function primitiveReason(expression: ts.Expression, st: State): string | undefined {
  if (!isAccepted(ACCEPTED_EXPRESSION_KINDS, expression)) return describeNode(expression);
  if (isPrimitiveLiteral(expression)) return undefined;
  if (ts.isBigIntLiteral(expression)) return undefined;
  if (ts.isTemplateExpression(expression)) {
    for (const span of expression.templateSpans) {
      const reason = primitiveReason(span.expression, st);
      if (reason !== undefined) return reason;
    }
    return undefined;
  }
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isTypeOfExpression(expression) ||
    ts.isVoidExpression(expression)
  ) {
    return primitiveReason(expression.expression, st);
  }
  if (ts.isPrefixUnaryExpression(expression)) {
    return PRIMITIVE_OPERATORS.includes(expression.operator)
      ? primitiveReason(expression.operand, st)
      : describeNode(expression);
  }
  if (ts.isBinaryExpression(expression)) {
    const kind = expression.operatorToken.kind;
    if (isAssignment(kind) || OPERATORS_WITH_EFFECTS.has(kind)) return describeNode(expression);
    return primitiveReason(expression.left, st) ?? primitiveReason(expression.right, st);
  }
  if (ts.isConditionalExpression(expression)) {
    return (
      primitiveReason(expression.condition, st) ??
      primitiveReason(expression.whenTrue, st) ??
      primitiveReason(expression.whenFalse, st)
    );
  }
  if (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression)) {
    return primitiveReferenceReason(expression, st);
  }
  return describeNode(expression);
}

function primitiveReferenceReason(
  node: ts.Identifier | ts.PropertyAccessExpression,
  st: State,
): string | undefined {
  const reason = referenceReason(node, st);
  if (reason !== undefined) return reason;
  const { checker } = st.ctx;
  const target = ts.isIdentifier(node) ? node : node.name;
  const symbol = checker.getSymbolAtLocation(target);
  const declaration = symbol && resolvedDeclaration(symbol, st);
  if (!declaration) return undefined;
  if (ts.isEnumMember(declaration)) return undefined;
  if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
    if (st.visiting.has(declaration)) return describeNode(node);
    st.visiting.add(declaration);
    const inner = primitiveReason(declaration.initializer, st);
    st.visiting.delete(declaration);
    return inner;
  }
  return `not a primitive ${describeNode(node)}`;
}

const isLiteralArgument = (node: ts.Expression): boolean =>
  ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);

function callReason(call: ts.CallExpression | ts.NewExpression, st: State): string | undefined {
  const name = calleeName(call.expression);
  const isNew = ts.isNewExpression(call);
  const key = name === undefined ? undefined : `${isNew ? 'new ' : ''}${name}`;
  const args = call.arguments ?? [];
  const refuse = (): string => describeNode(call);
  if (key === undefined || !EVALUATION_FREE_CALLS.includes(key) || !isGlobalName(call, st)) {
    return refuse();
  }
  if (key === 'Symbol' || key === 'Symbol.for') {
    const needed = key === 'Symbol.for' ? 1 : args.length;
    const ok = args.length === needed && args.length <= 1 && args.every(isLiteralArgument);
    return ok ? undefined : refuse();
  }
  if (key === 'Object.freeze') {
    const literal = args.length === 1 ? unwrap(args[0]!) : undefined;
    const isLiteral =
      literal !== undefined &&
      (ts.isObjectLiteralExpression(literal) || ts.isArrayLiteralExpression(literal));
    return isLiteral ? expressionReason(literal, st) : refuse();
  }
  if (args.length === 0) return undefined;
  const literal = args.length === 1 ? unwrap(args[0]!) : undefined;
  if (literal === undefined || !ts.isArrayLiteralExpression(literal)) return refuse();
  const keyed = key === 'new Map' || key === 'new WeakMap';
  return literal.elements.every((entry) => isCollectionEntry(entry, keyed, st))
    ? undefined
    : refuse();
}

function isEntryAtom(node: ts.Expression, st: State): boolean {
  const atom = unwrap(node);
  if (isPrimitiveLiteral(atom) || ts.isBigIntLiteral(atom)) return true;
  if (ts.isArrowFunction(atom) || ts.isFunctionExpression(atom)) return true;
  if (!ts.isIdentifier(atom)) return false;
  const symbol = st.ctx.checker.getSymbolAtLocation(atom);
  const declaration = symbol && resolvedDeclaration(symbol, st);
  return (
    declaration !== undefined &&
    (ts.isFunctionDeclaration(declaration) ||
      ts.isClassDeclaration(declaration) ||
      ts.isEnumDeclaration(declaration))
  );
}

function isCollectionEntry(entry: ts.Expression, keyed: boolean, st: State): boolean {
  if (!keyed) return isEntryAtom(entry, st);
  const pair = unwrap(entry);
  return (
    ts.isArrayLiteralExpression(pair) &&
    pair.elements.length === 2 &&
    pair.elements.every((element) => isEntryAtom(element, st))
  );
}

function nameReason(name: ts.PropertyName | undefined, st: State): string | undefined {
  return name !== undefined && ts.isComputedPropertyName(name)
    ? primitiveReason(name.expression, st)
    : undefined;
}

const hasDecorators = (node: ts.Node): boolean =>
  ts.canHaveDecorators(node) && (ts.getDecorators(node)?.length ?? 0) > 0;

const isStatic = (member: ts.ClassElement): boolean =>
  ts.canHaveModifiers(member) &&
  (ts.getModifiers(member)?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) ?? false);

function memberReason(member: ts.ClassElement, st: State): string | undefined {
  if (!isAccepted(ACCEPTED_CLASS_MEMBER_KINDS, member) || hasDecorators(member)) {
    return describeNode(member);
  }
  if (ts.isFunctionLike(member) && member.parameters.some(hasDecorators)) {
    return describeNode(member);
  }
  const named = nameReason(member.name as ts.PropertyName | undefined, st);
  if (named !== undefined) return named;
  if (ts.isPropertyDeclaration(member) && isStatic(member) && member.initializer) {
    return expressionReason(member.initializer, st);
  }
  return undefined;
}

export function classReason(node: ts.ClassLikeDeclaration, st: State): string | undefined {
  if (hasDecorators(node)) return describeNode(node);
  for (const clause of node.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    for (const type of clause.types) {
      const base = type.expression;
      const reason =
        ts.isIdentifier(base) || ts.isPropertyAccessExpression(base)
          ? referenceReason(base, st)
          : describeNode(base);
      if (reason !== undefined) return reason;
    }
  }
  for (const member of node.members) {
    const reason = memberReason(member, st);
    if (reason !== undefined) return reason;
  }
  return undefined;
}

function objectReason(literal: ts.ObjectLiteralExpression, st: State): string | undefined {
  for (const property of literal.properties) {
    let reason: string | undefined;
    if (!isAccepted(ACCEPTED_OBJECT_MEMBER_KINDS, property)) reason = describeNode(property);
    else if (ts.isShorthandPropertyAssignment(property))
      reason = referenceReason(property.name, st);
    else if (ts.isPropertyAssignment(property)) {
      reason = nameReason(property.name, st) ?? expressionReason(property.initializer, st);
    } else reason = nameReason(property.name, st);
    if (reason !== undefined) return reason;
  }
  return undefined;
}

export function expressionReason(expression: ts.Expression, st: State): string | undefined {
  if (!isAccepted(ACCEPTED_EXPRESSION_KINDS, expression)) return describeNode(expression);
  if (
    ts.isNumericLiteral(expression) ||
    ts.isBigIntLiteral(expression) ||
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression) ||
    ts.isRegularExpressionLiteral(expression) ||
    ts.isArrowFunction(expression) ||
    ts.isFunctionExpression(expression)
  ) {
    return undefined;
  }
  switch (expression.kind) {
    case ts.SyntaxKind.TrueKeyword:
    case ts.SyntaxKind.FalseKeyword:
    case ts.SyntaxKind.NullKeyword:
      return undefined;
    default:
  }
  if (ts.isTemplateExpression(expression)) {
    for (const span of expression.templateSpans) {
      const reason = primitiveReason(span.expression, st);
      if (reason !== undefined) return reason;
    }
    return undefined;
  }
  if (ts.isClassExpression(expression)) return classReason(expression, st);
  if (ts.isObjectLiteralExpression(expression)) return objectReason(expression, st);
  if (ts.isArrayLiteralExpression(expression)) {
    for (const element of expression.elements) {
      if (ts.isOmittedExpression(element)) continue;
      const reason = ts.isSpreadElement(element)
        ? describeNode(element)
        : expressionReason(element, st);
      if (reason !== undefined) return reason;
    }
    return undefined;
  }
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isTypeAssertionExpression(expression)
  ) {
    return expressionReason(expression.expression, st);
  }
  if (ts.isTypeOfExpression(expression) || ts.isVoidExpression(expression)) {
    return primitiveReason(expression.expression, st);
  }
  if (ts.isPrefixUnaryExpression(expression)) {
    const pure = [
      ts.SyntaxKind.PlusToken,
      ts.SyntaxKind.MinusToken,
      ts.SyntaxKind.ExclamationToken,
      ts.SyntaxKind.TildeToken,
    ].includes(expression.operator);
    return pure ? primitiveReason(expression.operand, st) : describeNode(expression);
  }
  if (ts.isBinaryExpression(expression)) {
    const kind = expression.operatorToken.kind;
    if (isAssignment(kind) || OPERATORS_WITH_EFFECTS.has(kind)) return describeNode(expression);
    return primitiveReason(expression.left, st) ?? primitiveReason(expression.right, st);
  }
  if (ts.isConditionalExpression(expression)) {
    return (
      primitiveReason(expression.condition, st) ??
      expressionReason(expression.whenTrue, st) ??
      expressionReason(expression.whenFalse, st)
    );
  }
  if (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression)) {
    return referenceReason(expression, st);
  }
  if (ts.isCallExpression(expression) || ts.isNewExpression(expression)) {
    return callReason(expression, st);
  }
  return describeNode(expression);
}
