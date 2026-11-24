import ts from 'typescript';

export const EVALUATION_FREE_CALLS: readonly string[] = [
  'Object.freeze',
  'new Map',
  'new Set',
  'new WeakMap',
  'new WeakSet',
  'Symbol',
  'Symbol.for',
];

export interface EvaluationContext {
  readonly checker: ts.TypeChecker;
  isTracked(fileName: string): boolean;
}

export interface Evaluation {
  readonly reason: string | undefined;
  readonly reads: ts.Declaration[];
}

interface State {
  readonly ctx: EvaluationContext;
  readonly reads: ts.Declaration[];
  readonly visiting: Set<ts.Node>;
}

const REASON_LIMIT = 60;

export function describeNode(node: ts.Node): string {
  const text = node.getText().replace(/\s+/g, ' ');
  return `${ts.SyntaxKind[node.kind]} ${text.slice(0, REASON_LIMIT)}`;
}

const NAMES_WITHOUT_DECLARATION = new Set(['undefined', 'NaN', 'Infinity']);

const unwrap = (expression: ts.Expression): ts.Expression => {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
};

function calleeName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name)) {
    const owner = calleeName(expression.expression);
    return owner === undefined ? undefined : `${owner}.${expression.name.text}`;
  }
  return undefined;
}

function rootIdentifier(expression: ts.Expression): ts.Identifier | undefined {
  if (ts.isIdentifier(expression)) return expression;
  return ts.isPropertyAccessExpression(expression)
    ? rootIdentifier(expression.expression)
    : undefined;
}

function resolvedDeclaration(symbol: ts.Symbol, st: State): ts.Declaration | undefined {
  let current = symbol;
  for (let step = 0; step < 32 && current.flags & ts.SymbolFlags.Alias; step += 1) {
    current = st.ctx.checker.getAliasedSymbol(current);
  }
  return current.declarations?.[0];
}

function isFreeConst(declaration: ts.VariableDeclaration, st: State): boolean {
  const list = declaration.parent;
  if (!ts.isVariableDeclarationList(list) || !(list.flags & ts.NodeFlags.Const)) return false;
  if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) return false;
  if (st.visiting.has(declaration)) return false;
  st.visiting.add(declaration);
  const reason = expressionReason(declaration.initializer, { ...st, reads: [] });
  st.visiting.delete(declaration);
  return reason === undefined;
}

function referenceReason(
  node: ts.Identifier | ts.PropertyAccessExpression,
  st: State,
): string | undefined {
  const { checker } = st.ctx;
  const target = ts.isIdentifier(node) ? node : node.name;
  const parent = target.parent;
  const symbol =
    ts.isShorthandPropertyAssignment(parent) && parent.name === target
      ? checker.getShorthandAssignmentValueSymbol(parent)
      : checker.getSymbolAtLocation(target);
  const declaration = symbol && resolvedDeclaration(symbol, st);
  if (!declaration) {
    const free = ts.isIdentifier(node) && NAMES_WITHOUT_DECLARATION.has(node.text);
    return free ? undefined : `unresolved ${describeNode(node)}`;
  }
  if (ts.isFunctionDeclaration(declaration)) return undefined;
  if (ts.isClassDeclaration(declaration) || ts.isEnumDeclaration(declaration)) {
    st.reads.push(declaration);
    return undefined;
  }
  if (ts.isEnumMember(declaration)) {
    st.reads.push(declaration.parent);
    return undefined;
  }
  if (ts.isVariableDeclaration(declaration) && isFreeConst(declaration, st)) {
    st.reads.push(declaration);
    return undefined;
  }
  return `reference to ${ts.SyntaxKind[declaration.kind]} ${describeNode(node)}`;
}

const isLiteralArgument = (node: ts.Expression): boolean =>
  ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);

function isGlobalName(call: ts.CallExpression | ts.NewExpression, st: State): boolean {
  const root = rootIdentifier(call.expression);
  const symbol = root && st.ctx.checker.getSymbolAtLocation(root);
  return (symbol?.declarations ?? []).every((d) => !st.ctx.isTracked(d.getSourceFile().fileName));
}

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
  return expressionReason(literal, st);
}

function nameReason(name: ts.PropertyName | undefined, st: State): string | undefined {
  return name !== undefined && ts.isComputedPropertyName(name)
    ? expressionReason(name.expression, st)
    : undefined;
}

const hasDecorators = (node: ts.Node): boolean =>
  ts.canHaveDecorators(node) && (ts.getDecorators(node)?.length ?? 0) > 0;

const isStatic = (member: ts.ClassElement): boolean =>
  ts.canHaveModifiers(member) &&
  (ts.getModifiers(member)?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) ?? false);

function memberReason(member: ts.ClassElement, st: State): string | undefined {
  if (ts.isClassStaticBlockDeclaration(member) || hasDecorators(member))
    return describeNode(member);
  if (ts.isConstructorDeclaration(member) && member.parameters.some(hasDecorators)) {
    return describeNode(member);
  }
  const named = nameReason(member.name as ts.PropertyName | undefined, st);
  if (named !== undefined) return named;
  if (ts.isPropertyDeclaration(member) && isStatic(member) && member.initializer) {
    return expressionReason(member.initializer, st);
  }
  return undefined;
}

function classReason(node: ts.ClassLikeDeclaration, st: State): string | undefined {
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
    if (ts.isShorthandPropertyAssignment(property)) reason = referenceReason(property.name, st);
    else if (ts.isPropertyAssignment(property)) {
      reason = nameReason(property.name, st) ?? expressionReason(property.initializer, st);
    } else if (ts.isSpreadAssignment(property)) reason = describeNode(property);
    else reason = nameReason(property.name, st);
    if (reason !== undefined) return reason;
  }
  return undefined;
}

const OPERATORS_WITH_EFFECTS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.InKeyword,
  ts.SyntaxKind.InstanceOfKeyword,
]);

const isAssignment = (kind: ts.SyntaxKind): boolean =>
  kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;

export function expressionReason(expression: ts.Expression, st: State): string | undefined {
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
      const reason = expressionReason(span.expression, st);
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
    ts.isTypeAssertionExpression(expression) ||
    ts.isTypeOfExpression(expression) ||
    ts.isVoidExpression(expression)
  ) {
    return expressionReason(expression.expression, st);
  }
  if (ts.isPrefixUnaryExpression(expression)) {
    const pure = [
      ts.SyntaxKind.PlusToken,
      ts.SyntaxKind.MinusToken,
      ts.SyntaxKind.ExclamationToken,
      ts.SyntaxKind.TildeToken,
    ].includes(expression.operator);
    return pure ? expressionReason(expression.operand, st) : describeNode(expression);
  }
  if (ts.isBinaryExpression(expression)) {
    const kind = expression.operatorToken.kind;
    if (isAssignment(kind) || OPERATORS_WITH_EFFECTS.has(kind)) return describeNode(expression);
    return expressionReason(expression.left, st) ?? expressionReason(expression.right, st);
  }
  if (ts.isConditionalExpression(expression)) {
    return (
      expressionReason(expression.condition, st) ??
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
    return enumInitializerReason(expression.operand, st);
  }
  if (ts.isBinaryExpression(expression) && !isAssignment(expression.operatorToken.kind)) {
    return (
      enumInitializerReason(expression.left, st) ?? enumInitializerReason(expression.right, st)
    );
  }
  if (
    ts.isIdentifier(expression) ||
    ts.isPropertyAccessExpression(expression) ||
    ts.isElementAccessExpression(expression)
  ) {
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
  if (ts.isModuleDeclaration(statement)) return describeNode(statement);
  if (isAmbient(statement)) return undefined;
  if (
    ts.isFunctionDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isExportDeclaration(statement) ||
    ts.isImportEqualsDeclaration(statement)
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
    if (!(list.flags & ts.NodeFlags.Const)) return describeNode(statement);
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

export function evaluateUnit(statement: ts.Statement, ctx: EvaluationContext): Evaluation {
  const st: State = { ctx, reads: [], visiting: new Set() };
  const reason = statementReason(statement, st);
  return { reason, reads: st.reads };
}
