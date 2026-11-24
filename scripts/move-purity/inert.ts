import ts from 'typescript';

export const INERT_CALLS: readonly string[] = [
  'Object.freeze',
  'new Map',
  'new Set',
  'new WeakMap',
  'new WeakSet',
  'Symbol',
  'Symbol.for',
];

function calleeName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name)) {
    const owner = calleeName(expression.expression);
    return owner === undefined ? undefined : `${owner}.${expression.name.text}`;
  }
  return undefined;
}

function isReadChain(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) return true;
  return ts.isPropertyAccessExpression(expression) && isReadChain(expression.expression);
}

const isInertName = (name: ts.PropertyName | ts.BindingName | undefined): boolean =>
  name === undefined || !ts.isComputedPropertyName(name) || isInertExpression(name.expression);

function isInertBinding(name: ts.BindingName): boolean {
  if (ts.isIdentifier(name)) return true;
  return name.elements.every(
    (element) =>
      ts.isOmittedExpression(element) ||
      ((element.initializer === undefined || isInertExpression(element.initializer)) &&
        isInertName(element.propertyName) &&
        isInertBinding(element.name)),
  );
}

const hasDecorators = (node: ts.Node): boolean =>
  ts.canHaveDecorators(node) && (ts.getDecorators(node)?.length ?? 0) > 0;

const isStatic = (member: ts.ClassElement): boolean =>
  ts.canHaveModifiers(member) &&
  (ts.getModifiers(member)?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) ?? false);

function isInertMember(member: ts.ClassElement): boolean {
  if (ts.isClassStaticBlockDeclaration(member) || hasDecorators(member)) return false;
  if (!isInertName(member.name)) return false;
  if (ts.isConstructorDeclaration(member) && member.parameters.some(hasDecorators)) return false;
  if (ts.isPropertyDeclaration(member) && isStatic(member) && member.initializer) {
    return isInertExpression(member.initializer);
  }
  return true;
}

function isInertClass(node: ts.ClassLikeDeclaration): boolean {
  if (hasDecorators(node)) return false;
  const extended = node.heritageClauses?.filter((c) => c.token === ts.SyntaxKind.ExtendsKeyword);
  const heritageInert = (extended ?? []).every((clause) =>
    clause.types.every((type) => isInertExpression(type.expression)),
  );
  return heritageInert && node.members.every(isInertMember);
}

function isInertProperty(property: ts.ObjectLiteralElementLike): boolean {
  if (ts.isShorthandPropertyAssignment(property)) return true;
  if (ts.isSpreadAssignment(property)) return isInertExpression(property.expression);
  if (ts.isPropertyAssignment(property)) {
    return isInertName(property.name) && isInertExpression(property.initializer);
  }
  return isInertName(property.name);
}

export function isInertExpression(expression: ts.Expression): boolean {
  if (
    ts.isNumericLiteral(expression) ||
    ts.isBigIntLiteral(expression) ||
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression) ||
    ts.isRegularExpressionLiteral(expression) ||
    ts.isIdentifier(expression)
  ) {
    return true;
  }
  switch (expression.kind) {
    case ts.SyntaxKind.TrueKeyword:
    case ts.SyntaxKind.FalseKeyword:
    case ts.SyntaxKind.NullKeyword:
    case ts.SyntaxKind.ArrowFunction:
    case ts.SyntaxKind.FunctionExpression:
      return true;
    default:
  }
  if (ts.isClassExpression(expression)) return isInertClass(expression);
  if (ts.isObjectLiteralExpression(expression)) return expression.properties.every(isInertProperty);
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.every((element) =>
      ts.isOmittedExpression(element)
        ? true
        : isInertExpression(ts.isSpreadElement(element) ? element.expression : element),
    );
  }
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isTypeAssertionExpression(expression)
  ) {
    return isInertExpression(expression.expression);
  }
  if (ts.isPropertyAccessExpression(expression)) return isReadChain(expression);
  if (ts.isPrefixUnaryExpression(expression)) {
    return (
      expression.operator === ts.SyntaxKind.MinusToken &&
      (ts.isNumericLiteral(expression.operand) || ts.isBigIntLiteral(expression.operand))
    );
  }
  if (ts.isCallExpression(expression) || ts.isNewExpression(expression)) {
    const name = calleeName(expression.expression);
    const key = ts.isNewExpression(expression) ? `new ${name}` : name;
    const args = expression.arguments ?? [];
    return (
      key !== undefined &&
      INERT_CALLS.includes(key) &&
      args.every((arg) => isInertExpression(ts.isSpreadElement(arg) ? arg.expression : arg))
    );
  }
  return false;
}

const isAmbient = (statement: ts.Statement): boolean =>
  ts.canHaveModifiers(statement) &&
  (ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword) ?? false);

export function isInertUnit(statement: ts.Statement): boolean {
  if (isAmbient(statement)) return true;
  if (
    ts.isFunctionDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isExportDeclaration(statement) ||
    ts.isImportEqualsDeclaration(statement)
  ) {
    return true;
  }
  if (ts.isClassDeclaration(statement)) return isInertClass(statement);
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.every(
      (d) =>
        isInertBinding(d.name) && (d.initializer === undefined || isInertExpression(d.initializer)),
    );
  }
  if (ts.isExportAssignment(statement)) return isInertExpression(statement.expression);
  return false;
}
