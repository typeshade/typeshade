import ts from 'typescript';
import type { CompileTsSourceResult, TsCompilerDiagnostic } from '../compiler/ts/source-file.js';
import { TS_CODES } from '../compiler/ts/codes.js';
import { cycleMembersOf, relatedSitesOf } from '../compiler/ts/diagnostic.js';
import { STAGE_CALLEES } from '../compiler/ts/stage-call.js';
import { fileDeclaresType } from '../compiler/ts/type-map.js';
import { isRemovedCall } from '../compiler/ts/removed-names.js';
import { QUALIFIER_DECORATORS, usesDecoratedForm } from '../compiler/ts/decorated-form.js';
import { refusedVars, refusedWhole, STRICT_MODE_NAMES } from '../compiler/ts/semantic.js';
import { GPU_BRAND_TAGS } from './ambient.js';
import { clampSpan, nodeAtPosition, rangeForSpan, spanForDiagnostic } from './positions.js';
import { ERASING_OPERATORS, ERASING_UNARY_OPERATORS } from './projection.js';
import type { TypeshadeDiagnostic, TypeshadeTextSpan } from './types.js';
import { foreignNameInRefusal } from './diagnostics/foreign-name.js';
import { spanEnd, spanOfNode, within } from './diagnostics/spans.js';
import { repeatsReadonlyWrite } from './diagnostics/readonly-write.js';
import { repeatsRefusedListUses } from './diagnostics/refused-list.js';
import { severityOfTs, severityOfTypeshade } from './diagnostics/severity.js';

interface DiagnosticFilterRule {
  readonly code: number;
  readonly reason: string;
  readonly when: (context: DiagnosticFilterContext, diagnostic: ts.Diagnostic) => boolean;
}

type DiagnosticSpan = Pick<ts.Diagnostic, 'start' | 'length'>;

interface DiagnosticFilterContext {
  readonly sourceFile: ts.SourceFile;
  readonly checker: ts.TypeChecker | undefined;
}

function isTopLevelFunctionDeclaration(node: ts.Node): node is ts.FunctionDeclaration {
  return (
    ts.isFunctionDeclaration(node) &&
    node.parent !== undefined &&
    (ts.isSourceFile(node.parent) || ts.isModuleBlock(node.parent))
  );
}

function decoratorAt(
  context: DiagnosticFilterContext,
  diagnostic: ts.Diagnostic,
): ts.Decorator | undefined {
  let node: ts.Node | undefined = nodeAtPosition(context.sourceFile, diagnostic.start ?? 0);
  while (node !== undefined && !ts.isDecorator(node)) node = node.parent;
  return node;
}

const FUNCTION_ATTRIBUTES: ReadonlySet<string> = new Set([
  'vertex',
  'fragment',
  'compute',
  'workgroup_size',
]);

function isAttributeOnTopLevelFunction(
  context: DiagnosticFilterContext,
  diagnostic: ts.Diagnostic,
): boolean {
  const node = decoratorAt(context, diagnostic);
  if (node === undefined || !isTopLevelFunctionDeclaration(node.parent)) return false;
  let e: ts.Expression = node.expression;
  if (ts.isCallExpression(e)) e = e.expression;
  return ts.isIdentifier(e) && FUNCTION_ATTRIBUTES.has(e.text);
}

function isDecoratorOnTopLevelFunctionParameter(
  context: DiagnosticFilterContext,
  diagnostic: ts.Diagnostic,
): boolean {
  const decorated = decoratorAt(context, diagnostic)?.parent;
  return (
    decorated !== undefined &&
    ts.isParameter(decorated) &&
    decorated.parent !== undefined &&
    isTopLevelFunctionDeclaration(decorated.parent)
  );
}

function isQualifierOnModuleFunction(
  context: DiagnosticFilterContext,
  diagnostic: ts.Diagnostic,
): boolean {
  let node: ts.Node | undefined = nodeAtPosition(context.sourceFile, diagnostic.start ?? 0);
  while (node !== undefined && !ts.isDecorator(node)) node = node.parent;
  if (node === undefined || !ts.isIdentifier(node.expression)) return false;
  if (!QUALIFIER_DECORATORS.has(node.expression.text)) return false;
  const parameter = node.parent;
  return (
    parameter !== undefined &&
    ts.isParameter(parameter) &&
    parameter.parent !== undefined &&
    isTopLevelFunctionDeclaration(parameter.parent)
  );
}

function isArraySizeValueTypeArgument(
  context: DiagnosticFilterContext,
  diagnostic: ts.Diagnostic,
): boolean {
  let node: ts.Node | undefined = nodeAtPosition(context.sourceFile, diagnostic.start ?? 0);
  while (node !== undefined && !ts.isIdentifier(node)) node = node.parent;
  if (node === undefined || !ts.isTypeReferenceNode(node.parent) || node.parent.typeName !== node) {
    return false;
  }
  const arrayType = node.parent.parent;
  return (
    ts.isTypeReferenceNode(arrayType) &&
    ts.isIdentifier(arrayType.typeName) &&
    arrayType.typeName.text === 'array' &&
    arrayType.typeArguments?.[1] === node.parent
  );
}

// Why: TypeScript escapes a unique-symbol key as `__@tag@id`, and the id moves with its version.
const UNIQUE_SYMBOL_PROPERTY = /^__@(.+)@\d+$/;

const GPU_BRAND_TAG_NAMES: ReadonlySet<string> = new Set(GPU_BRAND_TAGS);

export function isGpuBrandedType(type: ts.Type): boolean {
  if (type.isUnionOrIntersection()) return type.types.some(isGpuBrandedType);
  return type.getProperties().some((property) => {
    const tag = UNIQUE_SYMBOL_PROPERTY.exec(property.getName())?.[1];
    return tag !== undefined && GPU_BRAND_TAG_NAMES.has(tag);
  });
}

function isGpuExpression(context: DiagnosticFilterContext, expression: ts.Expression): boolean {
  if (context.checker === undefined) return false;
  return isGpuBrandedType(context.checker.getTypeAtLocation(expression));
}

function binaryExpressionAt(
  context: DiagnosticFilterContext,
  diagnostic: DiagnosticSpan,
): ts.BinaryExpression | undefined {
  let node: ts.Node | undefined = nodeAtPosition(context.sourceFile, diagnostic.start ?? 0);
  while (node !== undefined) {
    if (ts.isBinaryExpression(node)) return node;
    node = node.parent;
  }
  return undefined;
}

function binaryExpressionSpanning(
  context: DiagnosticFilterContext,
  diagnostic: DiagnosticSpan,
): ts.BinaryExpression | undefined {
  const pos = diagnostic.start ?? 0;
  const end = pos + (diagnostic.length ?? 0);
  let node: ts.Node | undefined = nodeAtPosition(context.sourceFile, pos);
  while (node !== undefined) {
    if (ts.isBinaryExpression(node) && node.getStart() === pos && node.getEnd() === end)
      return node;
    node = node.parent;
  }
  return undefined;
}

function isGpuValue(context: DiagnosticFilterContext, expression: ts.Expression): boolean {
  return (
    isGpuExpression(context, expression) || gpuArithmeticShape(context, expression) !== undefined
  );
}

function isGpuLeftOperand(context: DiagnosticFilterContext, diagnostic: ts.Diagnostic): boolean {
  const binary = binaryExpressionAt(context, diagnostic);
  if (binary === undefined) return false;
  const pos = diagnostic.start ?? 0;
  if (pos < binary.left.getStart() || pos >= binary.operatorToken.getStart()) return false;
  return isGpuValue(context, binary.left);
}

function isGpuRightOperand(context: DiagnosticFilterContext, diagnostic: ts.Diagnostic): boolean {
  const binary = binaryExpressionAt(context, diagnostic);
  if (binary === undefined) return false;
  const pos = diagnostic.start ?? 0;
  if (pos < binary.right.getStart() || pos >= binary.right.getEnd()) return false;
  return isGpuValue(context, binary.right);
}

function isGpuBinaryOperand(context: DiagnosticFilterContext, diagnostic: ts.Diagnostic): boolean {
  const binary = binaryExpressionSpanning(context, diagnostic);
  if (binary === undefined) return false;
  if (ERASING_OPERATORS.get(binary.operatorToken.kind) !== 'shape') return false;
  return isGpuValue(context, binary.left) || isGpuValue(context, binary.right);
}

const BOOLEAN_BITWISE_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.AmpersandToken,
  ts.SyntaxKind.BarToken,
  ts.SyntaxKind.CaretToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
]);

function isGpuMaskOperation(context: DiagnosticFilterContext, diagnostic: ts.Diagnostic): boolean {
  const binary = binaryExpressionSpanning(context, diagnostic);
  if (binary === undefined || !BOOLEAN_BITWISE_OPERATORS.has(binary.operatorToken.kind)) {
    return false;
  }
  const kind = binary.operatorToken.kind;
  if (kind === ts.SyntaxKind.AmpersandToken || kind === ts.SyntaxKind.BarToken) return true;
  return isGpuValue(context, binary.left) || isGpuValue(context, binary.right);
}

interface ErasedName {
  readonly operation: ts.Expression;
  readonly expanding: ReadonlySet<ts.Node>;
}

function erasedNameOf(
  context: DiagnosticFilterContext,
  name: ts.Identifier,
  expanding: ReadonlySet<ts.Node>,
): ErasedName | undefined {
  const declaration = context.checker?.getSymbolAtLocation(name)?.valueDeclaration;
  if (
    declaration === undefined ||
    !ts.isVariableDeclaration(declaration) ||
    declaration.type !== undefined ||
    declaration.initializer === undefined ||
    declaration.getSourceFile() !== context.sourceFile ||
    expanding.has(declaration)
  ) {
    return undefined;
  }
  const operation = unparenthesized(declaration.initializer);
  const erasing =
    (ts.isBinaryExpression(operation) && ERASING_OPERATORS.has(operation.operatorToken.kind)) ||
    ((ts.isPrefixUnaryExpression(operation) || ts.isPostfixUnaryExpression(operation)) &&
      ERASING_UNARY_OPERATORS.has(operation.operator));
  return erasing ? { operation, expanding: new Set([...expanding, declaration]) } : undefined;
}

function hasGpuArithmetic(
  context: DiagnosticFilterContext,
  node: ts.Node,
  expanding: ReadonlySet<ts.Node> = new Set(),
): boolean {
  if (ts.isIdentifier(node)) {
    const erased = erasedNameOf(context, node, expanding);
    return erased !== undefined && hasGpuArithmetic(context, erased.operation, erased.expanding);
  }
  if (
    ts.isBinaryExpression(node) &&
    ERASING_OPERATORS.has(node.operatorToken.kind) &&
    (isGpuExpression(context, node.left) || isGpuExpression(context, node.right))
  ) {
    return true;
  }
  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    ERASING_UNARY_OPERATORS.has(node.operator) &&
    isGpuExpression(context, node.operand)
  ) {
    return true;
  }
  return (
    ts.forEachChild(node, (child) =>
      hasGpuArithmetic(context, child, expanding) ? true : undefined,
    ) ?? false
  );
}

function assignedExpressionAt(
  context: DiagnosticFilterContext,
  diagnostic: DiagnosticSpan,
): ts.Expression | undefined {
  const pos = diagnostic.start ?? 0;
  let node: ts.Node | undefined = nodeAtPosition(context.sourceFile, pos);
  while (node !== undefined) {
    if (ts.isReturnStatement(node)) return node.expression;
    if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
      const body = node.body;
      const start = body.getStart(context.sourceFile);
      return pos === start && diagnostic.length === body.getEnd() - start ? body : undefined;
    }
    if (ts.isVariableDeclaration(node)) {
      const initializer = node.initializer;
      return initializer !== undefined && pos < initializer.getStart() ? initializer : undefined;
    }
    if (ts.isPropertyAssignment(node)) {
      return pos < node.initializer.getStart() ? node.initializer : undefined;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      return pos < node.operatorToken.getStart() ? node.right : undefined;
    }
    node = node.parent;
  }
  return undefined;
}

const MISSING_MEMBERS_CODES: ReadonlySet<number> = new Set([2739, 2740, 2741]);

const ruleCodeOf = (code: number | string): number | string =>
  typeof code === 'number' && MISSING_MEMBERS_CODES.has(code) ? 2322 : code;

function isFieldLiteralOfClass(
  context: DiagnosticFilterContext,
  diagnostic: ts.Diagnostic,
): boolean {
  const checker = context.checker;
  if (checker === undefined || !MISSING_MEMBERS_CODES.has(diagnostic.code)) return false;
  const value = assignedExpressionAt(context, diagnostic);
  if (value === undefined) return false;
  const literal = unparenthesized(value);
  if (!ts.isObjectLiteralExpression(literal)) return false;
  const target = checker.getContextualType(literal);
  if (target === undefined) return false;
  const given = new Set(
    checker.getPropertiesOfType(checker.getTypeAtLocation(literal)).map((p) => p.getName()),
  );
  const missing = checker
    .getPropertiesOfType(target)
    .filter((p) => !given.has(p.getName()) && (p.flags & ts.SymbolFlags.Optional) === 0);
  return (
    missing.length > 0 &&
    missing.every((p) => (p.flags & (ts.SymbolFlags.Method | ts.SymbolFlags.Accessor)) !== 0)
  );
}

function isGpuArithmeticAssignment(
  context: DiagnosticFilterContext,
  diagnostic: ts.Diagnostic,
): boolean {
  const checker = context.checker;
  if (checker === undefined) return false;
  const value = assignedExpressionAt(context, diagnostic);
  if (value === undefined) return false;
  const target = checker.getContextualType(value);
  if (target === undefined || !isGpuBrandedType(target)) return false;
  return isGpuExpression(context, value) || hasGpuArithmetic(context, value);
}

interface ArgumentPosition {
  readonly call: ts.CallExpression;
  readonly index: number;
  readonly argument: ts.Expression;
}

function argumentAt(
  context: DiagnosticFilterContext,
  diagnostic: DiagnosticSpan,
): ArgumentPosition | undefined {
  const pos = diagnostic.start ?? 0;
  const end = pos + (diagnostic.length ?? 0);
  let node: ts.Node | undefined = nodeAtPosition(context.sourceFile, pos);
  while (node !== undefined) {
    const parent: ts.Node | undefined = node.parent;
    if (parent !== undefined && ts.isCallExpression(parent) && node.getStart() === pos) {
      const index = parent.arguments.indexOf(node as ts.Expression);
      if (index >= 0 && node.getEnd() === end) {
        return { call: parent, index, argument: node as ts.Expression };
      }
    }
    node = parent;
  }
  return undefined;
}

function isRestParameter(symbol: ts.Symbol): boolean {
  const declaration = symbol.valueDeclaration;
  return (
    declaration !== undefined &&
    ts.isParameter(declaration) &&
    declaration.dotDotDotToken !== undefined
  );
}

function parameterTypeOfSignature(
  checker: ts.TypeChecker,
  signature: ts.Signature,
  index: number,
  location: ts.Node,
): ts.Type | undefined {
  const parameters = signature.getParameters();
  const last = parameters[parameters.length - 1];
  const symbol =
    parameters[index] ?? (last !== undefined && isRestParameter(last) ? last : undefined);
  if (symbol === undefined) return undefined;
  const type = checker.getTypeOfSymbolAtLocation(symbol, location);
  if (!isRestParameter(symbol)) return type;
  return checker.getIndexTypeOfType(type, ts.IndexKind.Number) ?? type;
}

function parameterTypesAt(
  checker: ts.TypeChecker,
  position: ArgumentPosition,
  resolved: ts.Signature | undefined,
): ts.Type[] {
  const { call, index } = position;
  const types: ts.Type[] = [];
  if (resolved !== undefined) {
    const type = parameterTypeOfSignature(checker, resolved, index, call);
    if (type !== undefined) types.push(type);
  }
  const overloads = checker.getTypeAtLocation(call.expression).getCallSignatures();
  if (overloads.length > 1 && (resolved === undefined || !overloads.includes(resolved))) {
    for (const overload of overloads) {
      const type = parameterTypeOfSignature(checker, overload, index, call);
      if (type !== undefined) types.push(type);
    }
  }
  return types;
}

function inferredParameterOf(
  checker: ts.TypeChecker,
  position: ArgumentPosition,
  signature: ts.Signature,
): ts.Type | undefined {
  const declaration = signature.getDeclaration() as ts.SignatureDeclaration | undefined;
  if (declaration === undefined) return undefined;
  const parameters = declaration.parameters;
  const last = parameters[parameters.length - 1];
  const parameter =
    parameters[position.index] ??
    (last !== undefined && last.dotDotDotToken !== undefined ? last : undefined);
  const declared = parameter?.type;
  if (declared === undefined) return undefined;
  const node =
    parameter.dotDotDotToken !== undefined && ts.isArrayTypeNode(declared)
      ? declared.elementType
      : declared;
  const type = checker.getTypeAtLocation(node);
  return (type.flags & ts.TypeFlags.TypeParameter) !== 0 ? type : undefined;
}

function isInferredParameter(
  checker: ts.TypeChecker,
  position: ArgumentPosition,
  signature: ts.Signature,
): boolean {
  return inferredParameterOf(checker, position, signature) !== undefined;
}

function gpuShapeKeysOfType(
  checker: ts.TypeChecker,
  type: ts.Type,
  location: ts.Node,
): ReadonlySet<string> {
  const keys = new Set<string>();
  const collect = (candidate: ts.Type): void => {
    if (candidate.isUnion()) {
      for (const constituent of candidate.types) collect(constituent);
      return;
    }
    for (const property of candidate.getProperties()) {
      const tag = UNIQUE_SYMBOL_PROPERTY.exec(property.getName())?.[1];
      if (tag === undefined || !GPU_BRAND_TAG_NAMES.has(tag)) continue;
      const brand = checker.getTypeOfSymbolAtLocation(property, location);
      keys.add(`${tag}:${checker.typeToString(brand)}`);
    }
  };
  collect(type);
  return keys;
}

function gpuShapeOfExpression(
  context: DiagnosticFilterContext,
  expression: ts.Expression,
): string | undefined {
  const checker = context.checker;
  if (checker === undefined) return undefined;
  const keys = gpuShapeKeysOfType(checker, checker.getTypeAtLocation(expression), expression);
  return keys.size === 1 ? [...keys][0] : undefined;
}

function unparenthesized(expression: ts.Expression): ts.Expression {
  let inner = expression;
  while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
  return inner;
}

const MATRIX_SHAPE_PREFIX = 'matTag:';

function gpuOperationShape(
  left: string | undefined,
  right: string | undefined,
): string | undefined {
  if (left === undefined || right === undefined) return left ?? right;
  if (left.startsWith(MATRIX_SHAPE_PREFIX) && !right.startsWith(MATRIX_SHAPE_PREFIX)) return right;
  return left;
}

const VECTOR_SHAPE = /^(?:vecTag:readonly \["\w+", (\d)\]|vec64Tag:(\d))$/;

function comparisonShape(shape: string): string | undefined {
  const match = VECTOR_SHAPE.exec(shape);
  const n = match?.[1] ?? match?.[2];
  return n === undefined ? undefined : `vecTag:readonly ["bool", ${n}]`;
}

function gpuArithmeticShape(
  context: DiagnosticFilterContext,
  node: ts.Node,
  expanding: ReadonlySet<ts.Node> = new Set(),
): string | undefined {
  if (ts.isIdentifier(node)) {
    const erased = erasedNameOf(context, node, expanding);
    return erased === undefined
      ? undefined
      : gpuValueShape(context, erased.operation, erased.expanding);
  }
  if (ts.isBinaryExpression(node)) {
    const result = ERASING_OPERATORS.get(node.operatorToken.kind);
    if (result !== undefined) {
      const shape = gpuOperationShape(
        gpuValueShape(context, node.left, expanding),
        gpuValueShape(context, node.right, expanding),
      );
      return shape !== undefined && result === 'bool' ? comparisonShape(shape) : shape;
    }
  }
  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    ERASING_UNARY_OPERATORS.has(node.operator)
  ) {
    return gpuValueShape(context, node.operand, expanding);
  }
  return ts.forEachChild(node, (child) => gpuArithmeticShape(context, child, expanding));
}

function gpuValueShape(
  context: DiagnosticFilterContext,
  expression: ts.Expression,
  expanding: ReadonlySet<ts.Node> = new Set(),
): string | undefined {
  return (
    gpuShapeOfExpression(context, expression) ?? gpuArithmeticShape(context, expression, expanding)
  );
}

function parameterShapesAt(
  checker: ts.TypeChecker,
  position: ArgumentPosition,
  resolved: ts.Signature | undefined,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const type of parameterTypesAt(checker, position, resolved)) {
    for (const key of gpuShapeKeysOfType(checker, type, position.call)) keys.add(key);
  }
  return keys;
}

function otherArgumentsFit(
  context: DiagnosticFilterContext,
  checker: ts.TypeChecker,
  position: ArgumentPosition,
  resolved: ts.Signature | undefined,
  shape: string,
): boolean {
  const settled = new Map<ts.Type, string>();
  const own = resolved === undefined ? undefined : inferredParameterOf(checker, position, resolved);
  if (own !== undefined) settled.set(own, shape);
  return position.call.arguments.every((argument, index) => {
    if (index === position.index) return true;
    const other = gpuValueShape(context, argument);
    if (other === undefined) return true;
    const at: ArgumentPosition = { call: position.call, index, argument };
    const parameter =
      resolved === undefined ? undefined : inferredParameterOf(checker, at, resolved);
    if (parameter !== undefined) {
      const expected = settled.get(parameter) ?? other;
      settled.set(parameter, expected);
      return other === expected;
    }
    const declared = parameterShapesAt(checker, at, resolved);
    return declared.size === 0 || declared.has(other);
  });
}

function isGpuArithmeticArgument(
  context: DiagnosticFilterContext,
  diagnostic: ts.Diagnostic,
): boolean {
  const checker = context.checker;
  if (checker === undefined) return false;
  const position = argumentAt(context, diagnostic);
  if (position === undefined) return false;
  const shape = gpuValueShape(context, position.argument);
  if (shape === undefined) return false;
  const resolved = checker.getResolvedSignature(position.call);
  if (
    hasGpuArithmetic(context, position.argument) &&
    parameterShapesAt(checker, position, resolved).has(shape)
  ) {
    return otherArgumentsFit(context, checker, position, resolved, shape);
  }
  if (!isGpuExpression(context, position.argument)) return false;
  if (resolved === undefined || !isInferredParameter(checker, position, resolved)) return false;
  const poisoned = position.call.arguments.some(
    (argument, index) =>
      index !== position.index &&
      hasGpuArithmetic(context, argument) &&
      gpuArithmeticShape(context, argument) === shape,
  );
  return poisoned && otherArgumentsFit(context, checker, position, resolved, shape);
}

const SCALAR_SHAPE = 'scalar';

function overloadFitsRestoredShapes(
  context: DiagnosticFilterContext,
  checker: ts.TypeChecker,
  call: ts.CallExpression,
  overload: ts.Signature,
): boolean {
  const parameters = overload.getParameters();
  const last = parameters[parameters.length - 1];
  const rest = last !== undefined && isRestParameter(last);
  if (
    rest
      ? call.arguments.length < parameters.length - 1
      : parameters.length !== call.arguments.length
  ) {
    return false;
  }
  const settled = new Map<ts.Type, string>();
  for (let index = 0; index < call.arguments.length; index++) {
    const argument = call.arguments[index]!;
    const parameter = parameterTypeOfSignature(checker, overload, index, call);
    if (parameter === undefined) return false;
    const shape = gpuValueShape(context, argument) ?? SCALAR_SHAPE;
    const position: ArgumentPosition = { call, index, argument };
    const inferred = inferredParameterOf(checker, position, overload);
    if (inferred !== undefined) {
      if ((settled.get(inferred) ?? shape) !== shape) return false;
      settled.set(inferred, shape);
      continue;
    }
    const declared = gpuShapeKeysOfType(checker, parameter, call);
    if (shape === SCALAR_SHAPE ? declared.size !== 0 : !declared.has(shape)) return false;
  }
  return true;
}

function calleeCallAt(
  context: DiagnosticFilterContext,
  diagnostic: DiagnosticSpan,
): ts.CallExpression | undefined {
  const pos = diagnostic.start ?? 0;
  const end = pos + (diagnostic.length ?? 0);
  let node: ts.Node | undefined = nodeAtPosition(context.sourceFile, pos);
  while (node !== undefined) {
    if (node.getStart() === pos && node.getEnd() === end) {
      if (ts.isCallExpression(node)) return node;
      const parent: ts.Node | undefined = node.parent;
      if (parent !== undefined && ts.isCallExpression(parent) && parent.expression === node) {
        return parent;
      }
    }
    node = node.parent;
  }
  return undefined;
}

function isGpuArithmeticOverloadCall(
  context: DiagnosticFilterContext,
  diagnostic: ts.Diagnostic,
): boolean {
  const checker = context.checker;
  if (checker === undefined) return false;
  const position = argumentAt(context, diagnostic);
  const call = position?.call ?? calleeCallAt(context, diagnostic);
  if (call === undefined) return false;
  if (!call.arguments.some((argument) => hasGpuArithmetic(context, argument))) return false;
  return checker
    .getTypeAtLocation(call.expression)
    .getCallSignatures()
    .some((overload) => overloadFitsRestoredShapes(context, checker, call, overload));
}

function isRemovedCallCallbackParameter(
  context: DiagnosticFilterContext,
  diagnostic: ts.Diagnostic,
): boolean {
  const name = nodeAtPosition(context.sourceFile, diagnostic.start ?? 0);
  const parameter = name.parent;
  if (parameter === undefined || !ts.isParameter(parameter) || parameter.name !== name)
    return false;
  const callback = parameter.parent;
  const call = callback.parent;
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return false;
  if (!ts.isCallExpression(call) || !call.arguments.includes(callback)) return false;
  return (
    ts.isIdentifier(call.expression) &&
    (isRemovedCall(call.expression.text) ||
      ((call.expression.text === 'any' || call.expression.text === 'all') &&
        call.arguments.length > 1))
  );
}

function isPhonyAssignmentTarget(
  context: DiagnosticFilterContext,
  diagnostic: ts.Diagnostic,
): boolean {
  const target = nodeAtPosition(context.sourceFile, diagnostic.start ?? 0);
  if (!ts.isIdentifier(target) || target.text !== '_') return false;
  const assignment = target.parent;
  if (
    assignment === undefined ||
    !ts.isBinaryExpression(assignment) ||
    assignment.left !== target ||
    assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken
  ) {
    return false;
  }
  if (ts.isExpressionStatement(assignment.parent)) return true;
  let body: ts.Node = assignment;
  while (ts.isParenthesizedExpression(body.parent)) body = body.parent;
  const arrow = body.parent;
  return (
    ts.isArrowFunction(arrow) &&
    arrow.body === body &&
    (arrow.type === undefined || arrow.type.kind === ts.SyntaxKind.VoidKeyword)
  );
}

function isLostBrandMember(context: DiagnosticFilterContext, diagnostic: ts.Diagnostic): boolean {
  const pos = diagnostic.start ?? 0;
  let node: ts.Node | undefined = nodeAtPosition(context.sourceFile, pos);
  while (node !== undefined && !ts.isPropertyAccessExpression(node)) node = node.parent;
  if (node === undefined || node.name.getStart(context.sourceFile) !== pos) return false;
  const object = node.expression;
  const checker = context.checker;
  if (checker === undefined) return false;
  const flags = checker.getTypeAtLocation(object).flags;
  if ((flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.Any)) === 0) {
    return false;
  }
  const shape = gpuValueShape(context, object);
  return shape !== undefined && !shape.startsWith(MATRIX_SHAPE_PREFIX);
}

function isNullableImplicitReturn(
  context: DiagnosticFilterContext,
  diagnostic: ts.Diagnostic,
): boolean {
  let node: ts.Node | undefined = nodeAtPosition(context.sourceFile, diagnostic.start ?? 0);
  if (diagnostic.code === 2322) {
    while (node !== undefined && !ts.isReturnStatement(node) && !ts.isFunctionLike(node))
      node = node.parent;
    if (node === undefined || !ts.isReturnStatement(node) || node.expression !== undefined)
      return false;
  }
  while (node !== undefined && !ts.isFunctionLike(node)) node = node.parent;
  if (
    node === undefined ||
    context.checker === undefined ||
    !ts.isFunctionLike(node) ||
    !('body' in node)
  )
    return false;
  const signature = context.checker.getSignatureFromDeclaration(node);
  if (signature === undefined) return false;
  const result = context.checker.getReturnTypeOfSignature(signature);
  return (
    result.isUnion() &&
    result.types.some((t) => (t.flags & ts.TypeFlags.Null) !== 0) &&
    result.types.some((t) => (t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) === 0)
  );
}

const TS_DIAGNOSTIC_FILTERS: readonly DiagnosticFilterRule[] = [
  {
    code: 2322,
    reason: 'A bare return in a nullable result yields its absent value (0099 D3).',
    when: isNullableImplicitReturn,
  },
  {
    code: 2366,
    reason: 'Fall-through in a nullable result yields its absent value (0099 D3).',
    when: isNullableImplicitReturn,
  },
  {
    code: 1206,
    reason:
      "A stage attribute, @vertex, @fragment or @compute([…]), or @workgroup_size([n]), on a top-level or a namespace's " +
      "function declaration is the language's form of an entry (Rules 1.8 and 8.1, change 0130), in every file: " +
      'TypeScript parses it and keeps references, rename and completion inside it, and the compiler checks its name and ' +
      'extents (TS8028, TS8037). Legacy decorators forbid a function declaration as a target, and no compiler option relaxes that.',
    when: isAttributeOnTopLevelFunction,
  },
  {
    code: 1206,
    reason:
      "A parameter qualifier, @inout or @out, on a parameter of a top-level or a namespace's " +
      'function is removed (change 0142), and the compiler refuses it with TS8073 at the ' +
      "decorator, so TypeScript's grammar report is the same mistake. Legacy decorators forbid " +
      "a function's parameter as a target, and no compiler option relaxes that.",
    when: isQualifierOnModuleFunction,
  },
  {
    code: 1206,
    reason:
      "In a file that still writes the decorated form of change 0111, @builtin/@location on a top-level or a namespace's " +
      "function's parameters are the grammar the migration release still reads, and the compiler warns on each (TS8028); " +
      'the editor hides TS1206 there only while compile() warns (Rule 6.6, change 0130).',
    when: (context, diagnostic) =>
      usesDecoratedForm(context.sourceFile) &&
      isDecoratorOnTopLevelFunctionParameter(context, diagnostic),
  },
  {
    code: 2749,
    reason:
      'TypeShade permits an integer module constant or override identifier as the second ' +
      'argument of `array<T, N>`; the compiler validates and lowers that value position.',
    when: isArraySizeValueTypeArgument,
  },
  {
    code: 2362,
    reason:
      'Arithmetic on a vector or matrix is the language: `v * s`, `c.rgb * 0.5`, `m * v`, ' +
      '`v *= 2.`. The ambient lib brands those types so a `vec3` and a `vec2` stay distinct, ' +
      'and a branded object type is not a `number` to this check, which no compiler option ' +
      'relaxes. Dropped only when the operand this code points at is one of those branded ' +
      'types, or an operation on one whose type TypeScript erased (`(a < b)` in `(a < b) * m`), ' +
      'so `1 * "x"` and the string in `v * "x"` stay red. Issue #21, design doc §6.',
    when: isGpuLeftOperand,
  },
  {
    code: 2363,
    reason: 'TS2362 for the right-hand operand (`m * v`, `2. * v`), filtered the same way.',
    when: isGpuRightOperand,
  },
  {
    code: 2365,
    reason:
      'The same arithmetic seen from the operator instead of from one operand (`a + b` on two ' +
      'vectors reports this, not TS2362). Dropped when the operator is arithmetic or bitwise ' +
      "and either operand is a branded vector or matrix; the compiler's own TYPE_MISMATCH " +
      'stays the authority on which shapes combine, so a real `vec3(1.) + vec2(1.)` is ' +
      'reported once, by `TS8003`, instead of twice. A comparison draws this code only when its ' +
      'operands really do not compare, which the compiler reports too, so that one is a ' +
      "mistake, not a false positive, and the merge keeps the compiler's report of it.",
    when: isGpuBinaryOperand,
  },
  {
    code: 2447,
    reason:
      "`&` and `|` on two `bool`s are WGSL's logical and and or, which do not short-circuit, " +
      'and on two masks, `(a < b) & (c < d)` (a comparison of vectors is a `bool` vector to the ' +
      'compiler and a `boolean` to TypeScript), its componentwise and and or; the `&&` and `||` ' +
      'suggested instead take a scalar `bool` only. Both are dropped whatever their operands, ' +
      'and the projection types the `bool` result. WGSL has no `^` on a bool or a vector of ' +
      'bools, nor a compound form of the three: those are dropped when an operand is a vector ' +
      "and the compiler's refusal stands, and on two scalar booleans the merge keeps that " +
      'refusal in place of this code.',
    when: isGpuMaskOperation,
  },
  {
    code: 2322,
    reason:
      'The knock-on of the three above: an operation on a vector is typed `number`, and a ' +
      'comparison `boolean`, so the `vec3` or `vec3b` return, local, field or assignment ' +
      'target it flows into looks unassignable. Dropped only when the target is a branded ' +
      'vector or matrix AND the value is one too or applies such an operation to one ' +
      '(`ERASING_OPERATORS`), so `let n: f32 = v` (a scalar target) still reports.',
    when: isGpuArithmeticAssignment,
  },
  {
    code: 2322,
    reason:
      'An object literal of a class that declares methods, as TS2741, TS2739 or TS2740: the ' +
      "class's value is its fields (Rule 6.9), and its methods are functions of the module, so " +
      'a literal that names every field is the value. Dropped only when each member TypeScript ' +
      'finds missing is a method or an accessor.',
    when: isFieldLiteralOfClass,
  },
  {
    code: 2345,
    reason:
      'The TS2322 case at a call: an argument position that wants a vector or matrix, handed ' +
      'the `number` vector arithmetic produces. Dropped when the argument does that arithmetic ' +
      'and the SHAPE it would have produced is one the parameter there accepts (resolved ' +
      'through the checker; when an overloaded ambient constructor matched no overload, when ' +
      'SOME overload accepts that shape), or when the parameter type is inferred from the ' +
      "arguments and another argument's arithmetic, of exactly this argument's shape, " +
      'poisoned that inference (`dot(a * 2., b)` on two vec3 reports the good `b`). Every ' +
      'other argument has to fit its own position too, since TypeScript reports only the first ' +
      'argument that fails: `dot(a * 2., b)` and `cross(a * 2., b)` with a vec2 `b` keep ' +
      'reporting, as the ambient math functions have no argument check in the front end. ' +
      'Arithmetic is required either way, so `vec4(1., a)`, `f(1.)` and `f(x)` with `x: f32` ' +
      'still report. Still hidden, because TypeScript stopped at the argument this rule ' +
      'dropped: a later argument wrong in a way that is not a vector shape. Issue #43.',
    when: isGpuArithmeticArgument,
  },
  {
    code: 2769,
    reason:
      'The TS2345 case at an OVERLOADED callee ("No overload matches this call"). TypeScript ' +
      'reports the specific argument error only when a single candidate has the arity of the ' +
      'call, which is why the ambient vector constructors report TS2345 while the math ' +
      'functions, whose overloads all share one arity, report this instead. Dropped when the ' +
      'call does vector or matrix arithmetic somewhere and SOME overload accepts every ' +
      "argument once that arithmetic's shape is put back, which is the whole-signature form " +
      'of the TS2345 rule above: `mix(a, b * 0.5, t)` fits `mix(vec3, vec3, number)` and goes, ' +
      'while `mix(a * 0.5, b, c)` with a vec2 `c` fits no overload and keeps reporting. The ' +
      'rule reads both spans this code arrives on, the argument one when the FIRST argument ' +
      'failed and the callee one when a later argument did (`max(a, b * 2.)` reports on ' +
      '`max`). Issue #43, and the twins corpus measurement in design doc §6.',
    when: isGpuArithmeticOverloadCall,
  },
  {
    code: 2304,
    reason:
      "`_ = f(x)` is WGSL's phony assignment, which the compiler lowers as the call with its " +
      'result dropped (surface §19, §52), and `_` names no value for the ambient library to ' +
      'declare: it is not a WGSL, ECMAScript or §9.3 name (`surface-names.test.ts`), and ' +
      'Rule 3.2 refuses it as an author name. Dropped only on the `_` of the statement form ' +
      "the compiler reads as phony, so `_ = a + 1.` keeps the compiler's one refusal and a `_` " +
      'read as a value keeps this code.',
    when: isPhonyAssignmentTarget,
  },
  {
    code: 7006,
    reason:
      'A callback handed to a removed name (`none(xs, p)`, `sum`) or to the array fold of `any` ' +
      'or `all` (change 0112) has no contextual type, because the ambient library no longer ' +
      "declares those shapes. The compiler's refusal names the spelling that replaces the call " +
      "(`xs.some(p)`), so TypeScript's \"implicitly has an 'any' type\" on the callback is a " +
      'second report of the same mistake and is dropped.',
    when: isRemovedCallCallbackParameter,
  },
  {
    code: 2339,
    reason:
      'A swizzle of a vector whose type an operation erased, in place (`(n * 2.).xy`, ' +
      '`(a < b).x`) or through a name declared from one that the projection could not type, ' +
      'because the compiler refused the declaration. The front end checks every swizzle and ' +
      'names a bad one (`TS8022 .w out of range on vec3`), so it is the authority and a ' +
      'real mistake is reported once. A value TypeScript still types as a vector keeps this ' +
      'code, and so does a matrix.',
    when: isLostBrandMember,
  },
  {
    code: 2454,
    reason:
      "The compiler reads a local before its assignment itself, by TypeScript's rule, and " +
      'reports TS8075 where it does (Rule 7.6, proposal 0043). A module variable may be declared with ' +
      'no initializer, and it then starts at zero on every target (surface §24), where ' +
      "TypeScript 5.7 and later report every read. So TypeScript's TS2454 is dropped, and the " +
      "compiler's TS8075 is the one report.",
    when: () => true,
  },
];

function isFiltered(context: DiagnosticFilterContext, diagnostic: ts.Diagnostic): boolean {
  return TS_DIAGNOSTIC_FILTERS.some(
    (rule) => rule.code === ruleCodeOf(diagnostic.code) && rule.when(context, diagnostic),
  );
}

interface SameMistake {
  readonly typescript: number;
  readonly typeshade: ReadonlySet<string>;
  readonly reason: string;
}

const SAME_MISTAKE: readonly SameMistake[] = [
  {
    typescript: 2304,
    typeshade: new Set(['TS8022', 'TS8004', 'TS8002', 'TS8033']),
    reason:
      'An unknown name: a value, a function or a type, `Date` among them; the retired ' +
      '`perInvocation` wrapper has its own module-variable remedy.',
  },
  {
    typescript: 1155,
    typeshade: new Set(['TS8033']),
    reason: 'A workgroup variable declared const without an initializer must instead use let.',
  },
  {
    typescript: 2314,
    typeshade: new Set(['TS8033']),
    reason: 'A bare workgroup type is missing the type argument the compiler names.',
  },
  {
    typescript: 2583,
    typeshade: new Set(['TS8022', 'TS8004', 'TS8002']),
    reason:
      'The same for a name of a later ECMAScript library (`Map`, `Promise`), which TypeScript ' +
      'offers to find there, and which a shader does not have either.',
  },
  {
    typescript: 2585,
    typeshade: new Set(['TS8022', 'TS8004', 'TS8035']),
    reason:
      'A `Map` or a `Set` read as a value (`const m = Map`, `new Map()`): the library declares each as the type ' +
      "of a kernel function's parameter (change 0080), and TypeScript offers its constructor in a " +
      'later ECMAScript library, which a shader does not have.',
  },
  {
    typescript: 2584,
    typeshade: new Set(['TS8022', 'TS8004', 'TS8002']),
    reason: 'The same for a name of the DOM (`document`).',
  },
  {
    typescript: 2591,
    typeshade: new Set(['TS8022', 'TS8004', 'TS8002', 'TS8072']),
    reason:
      'The same for a name of Node (`process`, `require`, `Buffer`), and `require("./x")`, which ' +
      'the compiler refuses as an import (Rule 3.9).',
  },
  {
    typescript: 2580,
    typeshade: new Set(['TS8022', 'TS8004', 'TS8002', 'TS8072']),
    reason: 'The same for a name of Node, where TypeScript offers its types to install.',
  },
  {
    typescript: 2867,
    typeshade: new Set(['TS8022', 'TS8004', 'TS8002']),
    reason: 'An unknown Bun name, where TypeScript offers host types a shader cannot use.',
  },
  {
    typescript: 2868,
    typeshade: new Set(['TS8022', 'TS8004', 'TS8002']),
    reason: 'The same Bun name when TypeScript also suggests changing tsconfig types.',
  },
  {
    typescript: 2552,
    typeshade: new Set(['TS8022', 'TS8004', 'TS8002']),
    reason:
      "The same, where TypeScript has a spelling to suggest (`clmap`: Did you mean 'clamp'?), " +
      'which the compiler names as well.',
  },
  {
    typescript: 2448,
    typeshade: new Set(['TS8022']),
    reason: 'A `let` or `const` read above its declaration.',
  },
  {
    typescript: 2454,
    typeshade: new Set(['TS8022']),
    reason: 'The same read, which TypeScript also reports as used before it is assigned.',
  },
  {
    typescript: 2339,
    typeshade: new Set(['TS8022', 'TS8035']),
    reason:
      'A member the value does not have: a swizzle out of range, a field, a method or a static ' +
      'not declared.',
  },
  {
    typescript: 2551,
    typeshade: new Set(['TS8022', 'TS8035']),
    reason:
      "The same, with a suggestion (`.xyzw` on a `vec3`: 'xyz'), where the compiler names the " +
      'member it is spelled like, or what is out of range.',
  },
  {
    typescript: 1245,
    typeshade: new Set(['TS8035']),
    reason: 'An `abstract` method written with a body.',
  },
  {
    typescript: 1318,
    typeshade: new Set(['TS8035']),
    reason: 'An `abstract` accessor written with a body.',
  },
  {
    typescript: 1267,
    typeshade: new Set(['TS8035']),
    reason: 'An `abstract` field written with an initializer, a function or a value.',
  },
  {
    typescript: 1244,
    typeshade: new Set(['TS8035']),
    reason: 'An `abstract` method or accessor in a class that is not abstract, or in a mixin.',
  },
  {
    typescript: 1253,
    typeshade: new Set(['TS8035']),
    reason: 'The same for an `abstract` field, which the compiler refuses when it has a body.',
  },
  {
    typescript: 2676,
    typeshade: new Set(['TS8035']),
    reason: 'A getter and a setter of which one is `abstract`, and has a body.',
  },
  {
    typescript: 2512,
    typeshade: new Set(['TS8035']),
    reason: 'An `abstract` overload signature of a method whose body is not.',
  },
  {
    typescript: 2393,
    typeshade: new Set(['TS8035']),
    reason: 'A method with two bodies, which TypeScript reports on each and the compiler once.',
  },
  {
    typescript: 2392,
    typeshade: new Set(['TS8035']),
    reason: 'The same for a constructor.',
  },
  {
    typescript: 2300,
    typeshade: new Set(['TS8035']),
    reason: 'The same for two getters, or a field and a member of one name.',
  },
  {
    typescript: 2515,
    typeshade: new Set(['TS8035']),
    reason:
      'A class that is not abstract and leaves an abstract member unimplemented, where the ' +
      'compiler says so of the class, or of a member of a base that is abstract and has a body.',
  },
  {
    typescript: 2654,
    typeshade: new Set(['TS8035']),
    reason: 'The same for several members.',
  },
  {
    typescript: 1108,
    typeshade: new Set(['TS8014']),
    reason: 'A `return` at the top level of the file.',
  },
  {
    typescript: 1113,
    typeshade: new Set(['TS8017']),
    reason: 'A second default clause in one switch, reported at that clause.',
  },
  {
    typescript: 1105,
    typeshade: new Set(['TS8014', 'TS8009']),
    reason: 'A `break` at the top level or outside a loop or switch.',
  },
  {
    typescript: 1104,
    typeshade: new Set(['TS8014', 'TS8009']),
    reason: 'A `continue` at the top level or outside a loop.',
  },
  {
    typescript: 1107,
    typeshade: new Set(['TS8009']),
    reason: 'A `break` or `continue` with no target inside its function.',
  },
  {
    typescript: 1101,
    typeshade: new Set(['TS8014']),
    reason: 'A `with` statement at the top level.',
  },
  {
    typescript: 2410,
    typeshade: new Set(['TS8014']),
    reason: 'The same `with` statement, which TypeScript reports twice.',
  },
  {
    typescript: 1202,
    typeshade: new Set(['TS8014', 'TS8072']),
    reason:
      'An `import x = require("./m")` at the top level, which the compiler refuses as an import ' +
      'it does not follow (Rule 3.9).',
  },
  {
    typescript: 1315,
    typeshade: new Set(['TS8014']),
    reason: 'An `export as namespace` at the top level.',
  },
  {
    typescript: 1015,
    typeshade: new Set(['TS8020']),
    reason: 'A parameter written `x?: T = d`, optional and with a default (change 0093).',
  },
  {
    typescript: 1016,
    typeshade: new Set(['TS8020']),
    reason: 'A required parameter after an optional one (change 0093).',
  },
  {
    typescript: 2353,
    typeshade: new Set(['TS8010']),
    reason: 'An object literal that names a field its struct does not have.',
  },
  {
    typescript: 2561,
    typeshade: new Set(['TS8010']),
    reason: 'The same, with a suggestion.',
  },
  {
    typescript: 2694,
    typeshade: new Set(['TS8002']),
    reason: 'A dotted type that names no class of the namespace.',
  },
  {
    typescript: 2749,
    typeshade: new Set(['TS8002']),
    reason:
      "A value's name written as a type (`uniform<frame>` for `Frame`), where TypeScript offers " +
      '`typeof frame`, which is no TypeShade type, and the compiler the type it is spelled like.',
  },
  {
    typescript: 2349,
    typeshade: new Set(['TS8004']),
    reason: 'A call of a name that is not a function (`discard()`).',
  },
  {
    typescript: 7009,
    typeshade: new Set(['TS8035', 'TS8022']),
    reason:
      'A `new` on a function or a WGSL constructor, which is called without it, or on a name a ' +
      'file compiled on its own imports and cannot see.',
  },
  {
    typescript: 2351,
    typeshade: new Set(['TS8035']),
    reason:
      'A `new` on a value, an enum, `Math`, `console` or `Symbol`, none of which has a ' +
      'constructor.',
  },
  {
    typescript: 2693,
    typeshade: new Set(['TS8035', 'TS8022', 'TS8004']),
    reason:
      'A type read as a value: a `new` on an interface, a type alias or a WGSL type with no ' +
      'constructor, and a type the library declares read or called (`Number(x)`).',
  },
  {
    typescript: 2708,
    typeshade: new Set(['TS8035', 'TS8022']),
    reason:
      'A `new` through a namespace that holds types alone (`new N.I()`), and such a namespace ' +
      'read as a value.',
  },
  {
    typescript: 7017,
    typeshade: new Set(['TS8022']),
    reason: 'A `new` on a member of `globalThis`, a name nothing declares.',
  },
  {
    typescript: 2511,
    typeshade: new Set(['TS8035']),
    reason: 'A `new` on an `abstract` class.',
  },
  {
    typescript: 2684,
    typeshade: new Set(['TS8035']),
    reason:
      'A static that builds its value with `new this()` (change 0020), called through an ' +
      '`abstract` class, whose constructor type is not the one its `this` parameter takes.',
  },
  {
    typescript: 2588,
    typeshade: new Set(['TS8005']),
    reason: 'A write to a `const` local or a read-only resource.',
  },
  {
    typescript: 2540,
    typeshade: new Set(['TS8005']),
    reason: 'A write to a `readonly` field outside its constructor.',
  },
  {
    typescript: 2554,
    typeshade: new Set(['TS8019', 'TS8003']),
    reason:
      'The wrong number of arguments. For a `Math` member the compiler expands it says so as ' +
      'TS8003 (`Math.hypot(x)`: `hypot expects 2 or 3 arguments.`).',
  },
  {
    typescript: 2558,
    typeshade: new Set(['TS8019']),
    reason: 'The wrong number of type arguments on the same call or construction.',
  },
  {
    typescript: 2322,
    typeshade: new Set(['TS8003']),
    reason: 'A value of the wrong type, assigned or declared.',
  },
  {
    typescript: 18047,
    typeshade: new Set(['TS8003']),
    reason: 'A nullable value read before its absence has been excluded (Rule 7.10, change 0098).',
  },
  {
    typescript: 18049,
    typeshade: new Set(['TS8003']),
    reason: 'A nullable value read before its absence has been excluded (Rule 7.10, change 0098).',
  },
  {
    typescript: 2531,
    typeshade: new Set(['TS8003']),
    reason: 'A nullable value read before its absence has been excluded (Rule 7.10, change 0098).',
  },
  {
    typescript: 2533,
    typeshade: new Set(['TS8003']),
    reason: 'A nullable value read before its absence has been excluded (Rule 7.10, change 0098).',
  },
  {
    typescript: 18048,
    typeshade: new Set(['TS8003']),
    reason:
      "An optional value read where its `T` is needed (`'v' is possibly 'undefined'`): the " +
      'compiler follows the same narrowing and names the test to write (Rule 7.10, change 0088).',
  },
  {
    typescript: 2538,
    typeshade: new Set(['TS8003']),
    reason:
      "An optional used as an index (`Type 'undefined' cannot be used as an index type`), which " +
      'the compiler reports as the same un-narrowed read (Rule 7.10, change 0088).',
  },
  {
    typescript: 2532,
    typeshade: new Set(['TS8003']),
    reason:
      "The same read through a member or an index (`Object is possibly 'undefined'`), which " +
      'the compiler reports on the object (Rule 7.10, change 0088).',
  },
  {
    typescript: 2365,
    typeshade: new Set(['TS8003']),
    reason:
      'Operands that do not combine: a comparison of two vectors of different sizes, or of a ' +
      'vector and a scalar, which TypeScript reports as an operator it cannot apply.',
  },
  {
    typescript: 2367,
    typeshade: new Set(['TS8003']),
    reason:
      'The same at `===` and `!==`, which TypeScript reports as a comparison of two types that ' +
      'have no overlap.',
  },
  {
    typescript: 7053,
    typeshade: new Set(['TS8003']),
    reason:
      'A `Record` indexed by a value that is none of its keys, a number or another key type ' +
      '(change 0081), which TypeScript reports as an index it cannot type.',
  },
  {
    typescript: 2678,
    typeshade: new Set(['TS8003', 'TS8017']),
    reason:
      'A `case` label that is no value of the switch: a number over a key type, a string that ' +
      'is none of its members, or a member over a number (change 0081).',
  },
  {
    typescript: 2345,
    typeshade: new Set(['TS8003', 'TS8019', 'TS8036']),
    reason: 'An argument of the wrong type, or too few components for a vector constructor.',
  },
  {
    typescript: 2769,
    typeshade: new Set(['TS8003', 'TS8019', 'TS8036']),
    reason: 'The same at an overloaded callee, the math builtins and the vector constructors.',
  },
  {
    typescript: 1215,
    typeshade: new Set(['TS8068', 'TS8022']),
    reason:
      'A declaration that binds `eval` or `arguments`, which strict mode forbids, and a write of ' +
      'such a name nothing declares (`eval = 1.`).',
  },
  {
    typescript: 1210,
    typeshade: new Set(['TS8068', 'TS8022']),
    reason: 'The same in a class, which TypeScript says is strict code of its own.',
  },
  {
    typescript: 1100,
    typeshade: new Set(['TS8068', 'TS8022']),
    reason: 'The same in a file TypeScript does not take for a module.',
  },
  {
    typescript: 2307,
    typeshade: new Set(['TS8072']),
    reason:
      'An import of a file that is not there, or that the host does not serve as a shader ' +
      'module (Rule 3.9): both on the module specifier.',
  },
  {
    typescript: 2305,
    typeshade: new Set(['TS8072']),
    reason: 'An import of a name the module does not export, on the name.',
  },
  {
    typescript: 2724,
    typeshade: new Set(['TS8072']),
    reason: 'The same, where TypeScript has a spelling to suggest, which the compiler names too.',
  },
  {
    typescript: 2614,
    typeshade: new Set(['TS8072']),
    reason: 'The same, where TypeScript suggests a default import, which no shader module has.',
  },
  {
    typescript: 2459,
    typeshade: new Set(['TS8072']),
    reason: 'An import of a name the module declares and does not export.',
  },
  {
    typescript: 1192,
    typeshade: new Set(['TS8072']),
    reason: 'A default import, which no shader module has, on the name it binds.',
  },
  {
    typescript: 2613,
    typeshade: new Set(['TS8072']),
    reason: 'The same, where TypeScript suggests the named import the module does have.',
  },
  {
    typescript: 2711,
    typeshade: new Set(['TS8072']),
    reason:
      'An `import(...)` call, which TypeScript reports as a call that needs a `Promise` and the ' +
      'compiler refuses as an import on its specifier (Rule 3.9).',
  },
];

const STRICT_MODE_CODES: ReadonlySet<number> = new Set([1100, 1210, 1215]);

const CALL_CODES: ReadonlySet<number> = new Set([2345, 2554, 2769, 2711]);

const MEMBER_CODES: ReadonlySet<number> = new Set([1244, 1245, 1253, 1267, 1318, 2512, 2676]);

const DUPLICATE_CODES: ReadonlySet<number> = new Set([2300, 2392, 2393]);

const UNIMPLEMENTED_CODES: ReadonlySet<number> = new Set([2515, 2654]);

const modifiersOf = (member: ts.ClassElement): readonly ts.ModifierLike[] =>
  (ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined) ?? [];

function memberAt(
  context: DiagnosticFilterContext,
  span: TypeshadeTextSpan,
): ts.ClassElement | undefined {
  let node: ts.Node | undefined = nodeAtPosition(context.sourceFile, span.start);
  while (node !== undefined && !(ts.isClassElement(node) && ts.isClassLike(node.parent))) {
    node = node.parent;
  }
  if (node === undefined) return undefined;
  const member = node;
  const parts: readonly (ts.Node | undefined)[] = [member, member.name, ...modifiersOf(member)];
  return parts.some((p) => p?.getStart(context.sourceFile) === span.start) ? member : undefined;
}

function memberKey(member: ts.ClassElement): string | undefined {
  const isStatic = modifiersOf(member).some((m) => m.kind === ts.SyntaxKind.StaticKeyword);
  if (ts.isConstructorDeclaration(member)) return 'constructor';
  const name = member.name;
  if (name === undefined || !(ts.isIdentifier(name) || ts.isPrivateIdentifier(name))) {
    return undefined;
  }
  return `${isStatic ? 'static ' : ''}${name.text}`;
}

function extendsClass(
  context: DiagnosticFilterContext,
  derived: ts.ClassLikeDeclaration,
  base: ts.ClassLikeDeclaration,
): boolean {
  const checker = context.checker;
  if (checker === undefined) return false;
  const seen = new Set<ts.Type>();
  const reaches = (type: ts.Type): boolean => {
    if (seen.has(type)) return false;
    seen.add(type);
    if (type.isIntersection()) return type.types.some(reaches);
    if (type.symbol?.declarations?.includes(base) === true) return true;
    const target = (type as ts.TypeReference).target ?? type;
    return target.isClassOrInterface() && checker.getBaseTypes(target).some(reaches);
  };
  const type = checker.getTypeAtLocation(derived);
  return type.isClassOrInterface() && checker.getBaseTypes(type).some(reaches);
}

function sameClassDeclaration(
  context: DiagnosticFilterContext,
  diagnostic: TypeshadeDiagnostic,
  error: TypeshadeDiagnostic,
): boolean | undefined {
  const code = diagnostic.code;
  if (typeof code !== 'number') return undefined;
  if (MEMBER_CODES.has(code) || DUPLICATE_CODES.has(code)) {
    const member = memberAt(context, diagnostic.span);
    const other = memberAt(context, error.span);
    if (member === undefined || other === undefined) return false;
    const key = memberKey(member);
    return (
      member === other ||
      (member.parent === other.parent && key !== undefined && key === memberKey(other))
    );
  }
  if (UNIMPLEMENTED_CODES.has(code)) {
    if (
      diagnostic.span.start === error.span.start &&
      diagnostic.span.length === error.span.length
    ) {
      return true;
    }
    const member = memberAt(context, error.span);
    if (member === undefined) return false;
    if (!modifiersOf(member).some((m) => m.kind === ts.SyntaxKind.AbstractKeyword)) return false;
    const named = nodeAtPosition(context.sourceFile, diagnostic.span.start).parent;
    return (
      named !== undefined &&
      ts.isClassLike(named) &&
      ts.isClassLike(member.parent) &&
      extendsClass(context, named, member.parent)
    );
  }
  return undefined;
}

function callOf(
  context: DiagnosticFilterContext,
  span: TypeshadeTextSpan,
): ts.CallExpression | undefined {
  return argumentAt(context, span)?.call ?? calleeCallAt(context, span);
}

function newCovering(
  context: DiagnosticFilterContext,
  span: TypeshadeTextSpan,
): ts.NewExpression | undefined {
  for (
    let node: ts.Node | undefined = nodeAtPosition(context.sourceFile, span.start);
    node !== undefined && node.getStart(context.sourceFile) === span.start;
    node = node.parent
  ) {
    if (ts.isNewExpression(node) && node.getEnd() === spanEnd(span)) return node;
  }
  return undefined;
}

function sameMistakeSpans(
  context: DiagnosticFilterContext,
  diagnostic: TypeshadeDiagnostic,
  error: TypeshadeDiagnostic,
): boolean {
  const code = ruleCodeOf(diagnostic.code);
  if (code === 2867 || code === 2868) {
    if (diagnostic.uri !== error.uri) return false;
    if (diagnostic.span.start === error.span.start && diagnostic.span.length === error.span.length)
      return true;
    const built = error.code === 'TS8022' ? newCovering(context, error.span) : undefined;
    if (built === undefined) return false;
    let target = unparenthesized(built.expression);
    while (ts.isPropertyAccessExpression(target)) {
      target = unparenthesized(target.expression);
    }
    const name = spanOfNode(target, context.sourceFile);
    return (
      ts.isIdentifier(target) &&
      name.start === diagnostic.span.start &&
      name.length === diagnostic.span.length
    );
  }
  if (code === 2558) {
    return sameTypeArgumentMistake(context, diagnostic, error);
  }
  if (error.code === TS_CODES.MODULE_VAR) {
    return sameModuleVariableMistake(context, diagnostic, error);
  }
  const built = newCovering(context, error.span);
  if (
    built !== undefined &&
    within(diagnostic.span, spanOfNode(built.expression, context.sourceFile))
  ) {
    return true;
  }
  if (typeof diagnostic.code === 'number' && CALL_CODES.has(diagnostic.code)) {
    const call = callOf(context, diagnostic.span);
    const region = call === undefined ? diagnostic.span : spanOfNode(call, context.sourceFile);
    return within(error.span, region) || within(diagnostic.span, error.span);
  }
  const declared = sameClassDeclaration(context, diagnostic, error);
  if (declared !== undefined) return declared;
  return (
    within(diagnostic.span, error.span) &&
    (diagnostic.span.start === error.span.start || spanEnd(diagnostic.span) === spanEnd(error.span))
  );
}

function sameTypeArgumentMistake(
  context: DiagnosticFilterContext,
  diagnostic: TypeshadeDiagnostic,
  error: TypeshadeDiagnostic,
): boolean {
  if (
    diagnostic.uri !== error.uri ||
    !/ takes \d+(?: to \d+)? type argument\(s\), got \d+\.$/.test(error.message)
  )
    return false;
  const { sourceFile } = context;
  for (
    let node: ts.Node | undefined = nodeAtPosition(sourceFile, diagnostic.span.start);
    node !== undefined;
    node = node.parent
  ) {
    if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) continue;
    const types = node.typeArguments;
    if (types === undefined || types.length === 0) continue;
    if (
      types[0]!.getStart(sourceFile) === diagnostic.span.start &&
      types[types.length - 1]!.getEnd() === spanEnd(diagnostic.span)
    ) {
      const call = spanOfNode(node, sourceFile);
      return call.start === error.span.start && call.length === error.span.length;
    }
  }
  return false;
}

function sameModuleVariableMistake(
  context: DiagnosticFilterContext,
  diagnostic: TypeshadeDiagnostic,
  error: TypeshadeDiagnostic,
): boolean {
  if (diagnostic.uri !== error.uri) return false;
  const { sourceFile } = context;
  const matches = (node: ts.Node, span: TypeshadeTextSpan): boolean => {
    const actual = spanOfNode(node, sourceFile);
    return actual.start === span.start && actual.length === span.length;
  };
  const name = nodeAtPosition(sourceFile, diagnostic.span.start);
  if (!ts.isIdentifier(name) || !matches(name, diagnostic.span)) return false;
  const code = ruleCodeOf(diagnostic.code);
  const parent = name.parent;
  if (ts.isTypeReferenceNode(parent) && parent.typeName === name) {
    const wrapper =
      (code === 2304 && name.text === 'perInvocation') ||
      (code === 2314 && name.text === 'workgroup' && !parent.typeArguments?.length);
    return wrapper && matches(parent, error.span);
  }
  if (code !== 1155 || !ts.isVariableDeclaration(parent) || parent.name !== name) return false;
  const type = parent.type;
  return (
    ts.isVariableDeclarationList(parent.parent) &&
    (parent.parent.flags & ts.NodeFlags.Const) !== 0 &&
    parent.initializer === undefined &&
    type !== undefined &&
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    type.typeName.text === 'workgroup' &&
    matches(parent, error.span)
  );
}

function subjectOf(
  context: DiagnosticFilterContext,
  diagnostic: TypeshadeDiagnostic,
): ts.Expression | undefined {
  switch (ruleCodeOf(diagnostic.code)) {
    case 2322:
      return assignedExpressionAt(context, diagnostic.span);
    case 2345:
    case 2769:
      return (
        argumentAt(context, diagnostic.span)?.argument ?? calleeCallAt(context, diagnostic.span)
      );
    case 2365:
    case 2367:
      return binaryExpressionSpanning(context, diagnostic.span);
    case 2339:
    case 2551: {
      let node: ts.Node | undefined = nodeAtPosition(context.sourceFile, diagnostic.span.start);
      while (node !== undefined && !ts.isPropertyAccessExpression(node)) node = node.parent;
      return node !== undefined && node.name.getStart(context.sourceFile) === diagnostic.span.start
        ? node.expression
        : undefined;
    }
    case 7053: {
      let node: ts.Node | undefined = nodeAtPosition(context.sourceFile, diagnostic.span.start);
      while (node !== undefined && !ts.isElementAccessExpression(node)) node = node.parent;
      return node !== undefined && node.getStart(context.sourceFile) === diagnostic.span.start
        ? node.expression
        : undefined;
    }
    default:
      return undefined;
  }
}

const UNTYPED_CODES: ReadonlySet<number> = new Set([2304, 2552, 2339, 2551, 2349]);

function failedAt(
  context: DiagnosticFilterContext,
  node: ts.Node,
  failures: readonly TypeshadeDiagnostic[],
): boolean {
  const span = spanOfNode(node, context.sourceFile);
  return failures.some(
    (failure) =>
      typeof failure.code === 'number' &&
      UNTYPED_CODES.has(failure.code) &&
      failure.span.start === span.start &&
      failure.span.length === span.length,
  );
}

function initializerBehind(
  context: DiagnosticFilterContext,
  name: ts.Identifier,
): ts.Expression | undefined {
  const declaration = context.checker?.getSymbolAtLocation(name)?.valueDeclaration;
  return declaration !== undefined &&
    ts.isVariableDeclaration(declaration) &&
    declaration.type === undefined
    ? declaration.initializer
    : undefined;
}

function overloaded(context: DiagnosticFilterContext, call: ts.CallExpression): boolean {
  const callee = context.checker?.getTypeAtLocation(call.expression);
  return callee !== undefined && callee.getCallSignatures().length > 1;
}

function typedFromFailure(
  context: DiagnosticFilterContext,
  value: ts.Expression,
  failures: readonly TypeshadeDiagnostic[],
  seen: Set<ts.Node> = new Set(),
): boolean {
  const inner = unparenthesized(value);
  if (seen.has(inner)) return false;
  seen.add(inner);
  const from = (e: ts.Expression): boolean => typedFromFailure(context, e, failures, seen);
  if (failedAt(context, inner, failures)) return true;
  if (ts.isIdentifier(inner)) {
    const initializer = initializerBehind(context, inner);
    return initializer !== undefined && from(initializer);
  }
  if (ts.isPropertyAccessExpression(inner)) {
    return failedAt(context, inner.name, failures) || from(inner.expression);
  }
  if (ts.isElementAccessExpression(inner)) return from(inner.expression);
  if (ts.isCallExpression(inner)) {
    return (
      failures.some(
        (failure) =>
          typeof failure.code === 'number' &&
          CALL_CODES.has(failure.code) &&
          callOf(context, failure.span) === inner,
      ) ||
      from(inner.expression) ||
      (overloaded(context, inner) && inner.arguments.some(from))
    );
  }
  if (ts.isBinaryExpression(inner) && ERASING_OPERATORS.has(inner.operatorToken.kind)) {
    return from(inner.left) || from(inner.right);
  }
  if (ts.isPrefixUnaryExpression(inner) && ERASING_UNARY_OPERATORS.has(inner.operator)) {
    return from(inner.operand);
  }
  return false;
}

function isKnockOn(
  context: DiagnosticFilterContext,
  diagnostic: TypeshadeDiagnostic,
  typescript: readonly TypeshadeDiagnostic[],
): boolean {
  const subject = subjectOf(context, diagnostic);
  if (subject === undefined) return false;
  const failures = typescript.filter((other) => other !== diagnostic && other.severity === 'error');
  return typedFromFailure(context, subject, failures);
}

interface Refusals {
  readonly whole: readonly TypeshadeTextSpan[];
  readonly vars: readonly TypeshadeTextSpan[];
}

function namespaceStatementsRefused(
  sourceFile: ts.SourceFile,
  compilerErrors: readonly TypeshadeDiagnostic[],
): TypeshadeTextSpan[] {
  const out: TypeshadeTextSpan[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isModuleBlock(node)) {
      for (const stmt of node.statements) {
        const span = spanOfNode(stmt, sourceFile);
        const refused = compilerErrors.some(
          (e) =>
            e.code === TS_CODES.TOP_LEVEL &&
            e.span.start === span.start &&
            e.span.length === span.length,
        );
        if (refused) out.push(span);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}

const MISSING_GLOBAL_TYPE = 2318;

function needsHostGlobal(node: ts.Node): boolean {
  return (
    ts.isAwaitExpression(node) ||
    ts.isYieldExpression(node) ||
    ts.isTaggedTemplateExpression(node) ||
    (ts.isForOfStatement(node) && node.awaitModifier !== undefined) ||
    (ts.isFunctionLike(node) &&
      ((node as { asteriskToken?: ts.AsteriskToken }).asteriskToken !== undefined ||
        (ts.canHaveModifiers(node) &&
          (ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false))))
  );
}

function initializerNamedAt(
  context: DiagnosticFilterContext,
  diagnostic: TypeshadeDiagnostic,
): ts.Expression | undefined {
  if (ruleCodeOf(diagnostic.code) !== 2322) return undefined;
  for (
    let node: ts.Node | undefined = nodeAtPosition(context.sourceFile, diagnostic.span.start);
    node !== undefined;
    node = node.parent
  ) {
    if (ts.isPropertyDeclaration(node) || ts.isParameter(node)) {
      return node.name.getStart(context.sourceFile) === diagnostic.span.start
        ? node.initializer
        : undefined;
    }
  }
  return undefined;
}

function forAwaitHeadAt(
  context: DiagnosticFilterContext,
  diagnostic: TypeshadeDiagnostic,
  compilerErrors: readonly TypeshadeDiagnostic[],
): boolean {
  const loop = ts.findAncestor(
    nodeAtPosition(context.sourceFile, diagnostic.span.start),
    (n): n is ts.ForOfStatement | ts.ForInStatement =>
      (ts.isForOfStatement(n) && n.awaitModifier !== undefined) || ts.isForInStatement(n),
  );
  if (loop === undefined) return false;
  const whole = spanOfNode(loop, context.sourceFile);
  return (
    spanEnd(diagnostic.span) <= loop.statement.getStart(context.sourceFile) &&
    compilerErrors.some((e) => e.span.start === whole.start && e.span.length === whole.length)
  );
}

function restOfRefusedTarget(
  context: DiagnosticFilterContext,
  diagnostic: TypeshadeDiagnostic,
  compilerErrors: readonly TypeshadeDiagnostic[],
): boolean {
  const rest = ts.findAncestor(
    nodeAtPosition(context.sourceFile, diagnostic.span.start),
    ts.isSpreadElement,
  );
  if (rest === undefined || !ts.isArrayLiteralExpression(rest.parent)) return false;
  const target = spanOfNode(rest.parent, context.sourceFile);
  return compilerErrors.some(
    (e) =>
      e.code === TS_CODES.ASSIGN_TARGET &&
      e.span.start === target.start &&
      e.span.length === target.length,
  );
}

function repeatsRefusal(
  context: DiagnosticFilterContext,
  diagnostic: TypeshadeDiagnostic,
  refusals: Refusals,
  compilerErrors: readonly TypeshadeDiagnostic[],
): boolean {
  if (refusals.whole.some((span) => within(diagnostic.span, span))) return true;
  const subject = subjectOf(context, diagnostic) ?? initializerNamedAt(context, diagnostic);
  if (subject !== undefined) {
    const judged = spanOfNode(subject, context.sourceFile);
    if (refusals.whole.some((span) => within(span, judged))) return true;
  }
  if (forAwaitHeadAt(context, diagnostic, compilerErrors)) return true;
  if (restOfRefusedTarget(context, diagnostic, compilerErrors)) return true;
  if (diagnostic.code === MISSING_GLOBAL_TYPE) {
    let found = false;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if (needsHostGlobal(node)) {
        const span = spanOfNode(node, context.sourceFile);
        found = compilerErrors.some((error) => within(span, error.span));
        if (found) return;
      }
      ts.forEachChild(node, visit);
    };
    visit(context.sourceFile);
    return found;
  }
  if (diagnostic.code === 2403) return refusals.vars.some((span) => within(diagnostic.span, span));
  if (diagnostic.code === 2454 && context.checker !== undefined) {
    const name = nodeAtPosition(context.sourceFile, diagnostic.span.start);
    const declaration = ts.isIdentifier(name)
      ? context.checker.getSymbolAtLocation(name)?.valueDeclaration
      : undefined;
    if (declaration === undefined || !ts.isVariableDeclaration(declaration)) return false;
    const statement = declaration.parent.parent;
    if (!ts.isVariableStatement(statement)) return false;
    const span = spanOfNode(statement, context.sourceFile);
    return refusals.vars.some((v) => v.start === span.start && v.length === span.length);
  }
  return false;
}

function isResultOfRefusedCycle(
  context: DiagnosticFilterContext,
  diagnostic: TypeshadeDiagnostic,
  cycles: readonly TsCompilerDiagnostic[],
): boolean {
  if (ruleCodeOf(diagnostic.code) !== 7023) return false;
  let declaration: ts.Node | undefined = nodeAtPosition(context.sourceFile, diagnostic.span.start);
  while (
    declaration !== undefined &&
    !(
      ts.isFunctionDeclaration(declaration) ||
      ts.isMethodDeclaration(declaration) ||
      ts.isGetAccessorDeclaration(declaration)
    )
  ) {
    declaration = declaration.parent;
  }
  if (declaration === undefined) return false;
  const start = declaration.getStart(context.sourceFile);
  const length = declaration.getWidth(context.sourceFile);
  return cycles.some((cycle) =>
    cycleMembersOf(cycle).some((m) => m.start === start && m.length === length),
  );
}

function repeatsStrictModeRefusal(
  context: DiagnosticFilterContext,
  diagnostic: TypeshadeDiagnostic,
  compilerErrors: readonly TypeshadeDiagnostic[],
): boolean {
  const text = (span: TypeshadeTextSpan): string =>
    context.sourceFile.text.slice(span.start, spanEnd(span));
  const refused = new Set(
    compilerErrors
      .filter((e) => e.code === TS_CODES.RESERVED_NAME && STRICT_MODE_NAMES.has(text(e.span)))
      .map((e) => text(e.span)),
  );
  if (typeof diagnostic.code === 'number' && STRICT_MODE_CODES.has(diagnostic.code)) {
    return refused.has(text(diagnostic.span));
  }
  const checker = context.checker;
  if (checker === undefined || !context.sourceFile.text.includes('arguments')) return false;
  const subject = subjectOf(context, diagnostic);
  const region = subject === undefined ? diagnostic.span : spanOfNode(subject, context.sourceFile);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      found ||
      node.getEnd() <= region.start ||
      node.getStart(context.sourceFile) >= spanEnd(region)
    ) {
      return;
    }
    if (ts.isIdentifier(node) && node.text === 'arguments') {
      const span = spanOfNode(node, context.sourceFile);
      // Why: TypeScript gives a function's own `arguments` object a symbol with no declaration.
      const symbol = checker.getSymbolAtLocation(node);
      found =
        within(span, region) &&
        symbol !== undefined &&
        symbol.declarations === undefined &&
        (refused.has('arguments') ||
          compilerErrors.some(
            (e) =>
              e.code === TS_CODES.UNKNOWN_NAME &&
              e.span.start === span.start &&
              e.span.length === span.length,
          ));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(context.sourceFile);
  return found;
}

const NO_VALUE_SYMBOLS =
  ts.SymbolFlags.Enum | ts.SymbolFlags.Class | ts.SymbolFlags.ValueModule | ts.SymbolFlags.Function;

function readsDeclarationAsValue(
  context: DiagnosticFilterContext,
  diagnostic: TypeshadeDiagnostic,
  compilerErrors: readonly TypeshadeDiagnostic[],
): boolean {
  const checker = context.checker;
  if (checker === undefined) return false;
  const reads = compilerErrors.filter((e) => {
    if (e.code !== TS_CODES.UNKNOWN_NAME && e.code !== TS_CODES.UNSUPPORTED) return false;
    const node = nodeAtPosition(context.sourceFile, e.span.start);
    if (!ts.isIdentifier(node) || node.getEnd() !== spanEnd(e.span)) return false;
    const symbol = checker.getSymbolAtLocation(node);
    return symbol !== undefined && (symbol.flags & NO_VALUE_SYMBOLS) !== 0;
  });
  if (reads.length === 0) return false;
  const subject = operationOf(context, diagnostic) ?? subjectOf(context, diagnostic);
  const region = subject === undefined ? diagnostic.span : spanOfNode(subject, context.sourceFile);
  return reads.some((read) => within(read.span, region) || within(read.span, diagnostic.span));
}

function operationOf(
  context: DiagnosticFilterContext,
  diagnostic: TypeshadeDiagnostic,
): ts.BinaryExpression | undefined {
  if (diagnostic.code === 2447) return binaryExpressionSpanning(context, diagnostic.span);
  if (diagnostic.code !== 2362 && diagnostic.code !== 2363) return undefined;
  const binary = binaryExpressionAt(context, diagnostic.span);
  if (binary === undefined) return undefined;
  const operand = diagnostic.code === 2362 ? binary.left : binary.right;
  const start = diagnostic.span.start;
  return start >= operand.getStart(context.sourceFile) && start < operand.getEnd()
    ? binary
    : undefined;
}

function isRefusedOperation(
  context: DiagnosticFilterContext,
  node: ts.Expression,
  refusals: readonly TypeshadeDiagnostic[],
): boolean {
  const refusedAt = (at: ts.Node): boolean => {
    const span = spanOfNode(at, context.sourceFile);
    return refusals.some((r) => r.span.start === span.start && r.span.length === span.length);
  };
  if (ts.isPrefixUnaryExpression(node)) return refusedAt(node);
  if (!ts.isBinaryExpression(node)) return false;
  if (refusedAt(node)) return true;
  const op = node.operatorToken.kind;
  const atOperand =
    (op >= ts.SyntaxKind.FirstCompoundAssignment && op <= ts.SyntaxKind.LastCompoundAssignment) ||
    op === ts.SyntaxKind.LessThanLessThanToken ||
    op === ts.SyntaxKind.GreaterThanGreaterThanToken;
  return atOperand && (refusedAt(node.left) || refusedAt(node.right));
}

function fromRefusedOperation(
  context: DiagnosticFilterContext,
  value: ts.Expression,
  refusals: readonly TypeshadeDiagnostic[],
  seen: Set<ts.Node> = new Set(),
): boolean {
  const inner = unparenthesized(value);
  if (seen.has(inner)) return false;
  seen.add(inner);
  const from = (e: ts.Expression): boolean => fromRefusedOperation(context, e, refusals, seen);
  if (isRefusedOperation(context, inner, refusals)) return true;
  if (ts.isIdentifier(inner)) {
    const initializer = initializerBehind(context, inner);
    return initializer !== undefined && from(initializer);
  }
  if (ts.isPropertyAccessExpression(inner) || ts.isElementAccessExpression(inner)) {
    return from(inner.expression);
  }
  if (ts.isBinaryExpression(inner) && ERASING_OPERATORS.has(inner.operatorToken.kind)) {
    return from(inner.left) || from(inner.right);
  }
  if (ts.isPrefixUnaryExpression(inner) && ERASING_UNARY_OPERATORS.has(inner.operator)) {
    return from(inner.operand);
  }
  return false;
}

function isAboutRefusedOperation(
  context: DiagnosticFilterContext,
  diagnostic: TypeshadeDiagnostic,
  refusals: readonly TypeshadeDiagnostic[],
): boolean {
  if (refusals.length === 0) return false;
  const subject = operationOf(context, diagnostic) ?? subjectOf(context, diagnostic);
  return subject !== undefined && fromRefusedOperation(context, subject, refusals);
}

// Implements: Rule 7.10, Rule 8.25, Rule 12.4, Rule 12.7 (docs/language-design.md; traced in reqs/).
const DECORATOR_REFUSALS: ReadonlySet<string> = new Set([
  TS_CODES.BUILTIN_NAME,
  TS_CODES.ATTRIBUTE_NAME,
  TS_CODES.STRUCT_FIELD,
  TS_CODES.CLASS_MEMBER,
  TS_CODES.REFERENCE,
]);

const METHOD_DECORATOR_REFUSAL: ReadonlySet<string> = new Set([TS_CODES.CLASS_MEMBER]);

function isAboutRefusedStageCall(
  context: DiagnosticFilterContext,
  diagnostic: TypeshadeDiagnostic,
  compilerErrors: readonly TypeshadeDiagnostic[],
): boolean {
  if (typeof diagnostic.code !== 'number') return false;
  const code = diagnostic.code;
  return compilerErrors.some((error) => {
    if (error.code !== TS_CODES.ATTRIBUTE_NAME) return false;
    const callee = nodeAtPosition(context.sourceFile, error.span.start);
    const call = callee.parent;
    if (
      !ts.isIdentifier(callee) ||
      !(STAGE_CALLEES as readonly string[]).includes(callee.text) ||
      !ts.isCallExpression(call) ||
      call.expression !== callee ||
      ts.isDecorator(call.parent)
    ) {
      return false;
    }
    if (within(diagnostic.span, error.span)) return true;
    const declared = ts.isVariableDeclaration(call.parent) ? call.parent.name : undefined;
    if (declared !== undefined && within(diagnostic.span, spanOfNode(declared, context.sourceFile)))
      return true;
    if (!CALL_CODES.has(code) || !within(diagnostic.span, spanOfNode(call, context.sourceFile)))
      return false;
    return !call.arguments.some(
      (arg) =>
        (ts.isFunctionExpression(arg) || ts.isArrowFunction(arg)) &&
        within(diagnostic.span, spanOfNode(arg.body, context.sourceFile)),
    );
  });
}

function isInRefusedDecorator(
  context: DiagnosticFilterContext,
  diagnostic: TypeshadeDiagnostic,
  compilerErrors: readonly TypeshadeDiagnostic[],
): boolean {
  const refused = (decorator: ts.Decorator, codes: ReadonlySet<string>): boolean => {
    const span = spanOfNode(decorator, context.sourceFile);
    return compilerErrors.some(
      (error) =>
        codes.has(String(error.code)) &&
        error.span.start === span.start &&
        error.span.length === span.length,
    );
  };
  if (diagnostic.code === 2318 && diagnostic.message.includes("'TypedPropertyDescriptor'")) {
    return compilerErrors.some((error) => {
      if (error.code !== TS_CODES.CLASS_MEMBER) return false;
      let node: ts.Node | undefined = nodeAtPosition(context.sourceFile, error.span.start);
      while (node !== undefined && !ts.isDecorator(node)) node = node.parent;
      return node !== undefined && refused(node, METHOD_DECORATOR_REFUSAL);
    });
  }
  let node: ts.Node | undefined = nodeAtPosition(context.sourceFile, diagnostic.span.start);
  while (node !== undefined && !ts.isDecorator(node)) node = node.parent;
  if (node === undefined) return false;
  if (refused(node, DECORATOR_REFUSALS)) return true;
  const declaration = node.parent;
  const siblings = ts.canHaveDecorators(declaration) ? (ts.getDecorators(declaration) ?? []) : [];
  return siblings.some((d) => refused(d, METHOD_DECORATOR_REFUSAL));
}

function isRemovedQualifierTypeName(
  context: DiagnosticFilterContext,
  diagnostic: TypeshadeDiagnostic,
  compilerErrors: readonly TypeshadeDiagnostic[],
): boolean {
  if (diagnostic.code !== 2304 && diagnostic.code !== 2552) return false;
  const node = nodeAtPosition(context.sourceFile, diagnostic.span.start);
  if (!ts.isIdentifier(node) || !QUALIFIER_DECORATORS.has(node.text)) return false;
  if (!ts.isTypeReferenceNode(node.parent) || node.parent.typeName !== node) return false;
  return compilerErrors.some(
    (error) => error.code === TS_CODES.ATTRIBUTE_NAME && within(diagnostic.span, error.span),
  );
}

function isAboutRefusedIoArgument(
  context: DiagnosticFilterContext,
  diagnostic: TypeshadeDiagnostic,
  compilerErrors: readonly TypeshadeDiagnostic[],
): boolean {
  if (diagnostic.code !== 2344) return false;
  let node: ts.Node | undefined = nodeAtPosition(context.sourceFile, diagnostic.span.start);
  while (node !== undefined) {
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      const code =
        node.typeName.text === 'builtin'
          ? TS_CODES.BUILTIN_NAME
          : node.typeName.text === 'location'
            ? TS_CODES.ATTRIBUTE_NAME
            : undefined;
      const first = node.typeArguments?.[0];
      if (
        code !== undefined &&
        first !== undefined &&
        within(diagnostic.span, spanOfNode(first, context.sourceFile))
      ) {
        const span = spanOfNode(node, context.sourceFile);
        const nameSpan = spanOfNode(first, context.sourceFile);
        const ownName = fileDeclaresType(node, node.typeName.text, context.sourceFile);
        if (
          compilerErrors.some(
            (error) =>
              error.code === code &&
              ((error.span.start === span.start && error.span.length === span.length) ||
                (code === TS_CODES.BUILTIN_NAME &&
                  !ownName &&
                  error.span.start === nameSpan.start &&
                  error.span.length === nameSpan.length)),
          )
        )
          return true;
      }
    }
    node = node.parent;
  }
  return false;
}

function refusedBuiltinDeclarations(
  sourceFile: ts.SourceFile,
  compilerErrors: readonly TypeshadeDiagnostic[],
): ts.Node[] {
  const out: ts.Node[] = [];
  for (const error of compilerErrors) {
    if (error.code !== TS_CODES.TYPE_MISMATCH && error.code !== TS_CODES.BUILTIN_NAME) continue;
    let node: ts.Node | undefined = nodeAtPosition(sourceFile, error.span.start);
    while (node !== undefined && !ts.isTypeReferenceNode(node)) node = node.parent;
    if (
      node === undefined ||
      !ts.isIdentifier(node.typeName) ||
      node.typeName.text !== 'builtin' ||
      fileDeclaresType(node, 'builtin', sourceFile)
    )
      continue;
    const second = node.typeArguments?.[1];
    if (second !== undefined && !ts.isTypeLiteralNode(second)) continue;
    const declaration = node.parent;
    if (
      ts.isParameter(declaration) ||
      ts.isPropertySignature(declaration) ||
      ts.isPropertyDeclaration(declaration)
    )
      out.push(declaration);
  }
  return out;
}

function isAboutRefusedBuiltinValue(
  context: DiagnosticFilterContext,
  diagnostic: TypeshadeDiagnostic,
  refused: readonly ts.Node[],
  imported: readonly TsCompilerDiagnostic[],
): boolean {
  const checker = context.checker;
  if ((refused.length === 0 && imported.length === 0) || checker === undefined) return false;
  if (!diagnostic.message.includes("'never'")) return false;
  const end = diagnostic.span.start + diagnostic.span.length;
  let found = false;
  const refusedElsewhere = (d: ts.Declaration): boolean => {
    if (!ts.isPropertySignature(d) && !ts.isPropertyDeclaration(d) && !ts.isParameter(d))
      return false;
    const type = d.type;
    if (
      type === undefined ||
      !ts.isTypeReferenceNode(type) ||
      !ts.isIdentifier(type.typeName) ||
      type.typeName.text !== 'builtin'
    )
      return false;
    const file = d.getSourceFile();
    return imported.some(
      (e) => e.fileName === file.fileName && type.getStart(file) <= e.start && e.start < type.end,
    );
  };
  const seen = new Set<ts.Node>();
  const readsRefused = (node: ts.Node): boolean => {
    if (ts.isIdentifier(node)) return declares(checker.getSymbolAtLocation(node));
    if (ts.isTypeNode(node)) return false;
    return ts.forEachChild(node, readsRefused) === true;
  };
  const declares = (symbol: ts.Symbol | undefined): boolean =>
    symbol?.declarations?.some((d) => {
      if (refused.includes(d) || refusedElsewhere(d)) return true;
      if (!ts.isVariableDeclaration(d) || d.initializer === undefined || seen.has(d)) return false;
      seen.add(d);
      const reads = readsRefused(d.initializer);
      seen.delete(d);
      return reads;
    }) === true;
  const visit = (node: ts.Node): void => {
    if (found || node.getEnd() <= diagnostic.span.start || node.getStart(context.sourceFile) >= end)
      return;
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      if (
        ts.isPropertyAssignment(parent) &&
        parent.name === node &&
        ts.isObjectLiteralExpression(parent.parent)
      ) {
        const expected = checker.getContextualType(parent.parent);
        if (declares(expected?.getProperty(node.text))) found = true;
      }
      if (!found && declares(checker.getSymbolAtLocation(node))) found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(context.sourceFile);
  return found;
}

export function mergeDiagnostics(
  sourceFile: ts.SourceFile,
  typescript: readonly TypeshadeDiagnostic[],
  typeshade: readonly TypeshadeDiagnostic[],
  analysis: CompileTsSourceResult | undefined,
  checker: ts.TypeChecker | undefined,
): TypeshadeDiagnostic[] {
  if (analysis === undefined || analysis.sourceFile.text !== sourceFile.text) {
    return [...typescript, ...typeshade];
  }
  const context: DiagnosticFilterContext = { sourceFile, checker };
  const compilerErrors = typeshade.filter((d) => d.severity === 'error');
  const operatorRefusals = compilerErrors.filter((d) => d.code === TS_CODES.TYPE_MISMATCH);
  const refusals: Refusals = {
    whole: [
      ...refusedWhole(analysis.sourceFile).map((n) => spanOfNode(n, analysis.sourceFile)),
      ...namespaceStatementsRefused(analysis.sourceFile, compilerErrors),
    ],
    vars: refusedVars(analysis.sourceFile).map((n) => spanOfNode(n, analysis.sourceFile)),
  };
  const refusedBuiltins = refusedBuiltinDeclarations(sourceFile, compilerErrors);
  const importedBuiltinRefusals = analysis.diagnostics.filter(
    (d) =>
      d.category === 'error' &&
      d.fileName !== sourceFile.fileName &&
      (d.code === TS_CODES.TYPE_MISMATCH || d.code === TS_CODES.BUILTIN_NAME),
  );
  const keptTypescript = typescript.filter((diagnostic) => {
    if (diagnostic.severity !== 'error') return true;
    if (isKnockOn(context, diagnostic, typescript)) return false;
    if (isAboutRefusedOperation(context, diagnostic, operatorRefusals)) return false;
    if (isInRefusedDecorator(context, diagnostic, compilerErrors)) return false;
    if (isAboutRefusedStageCall(context, diagnostic, compilerErrors)) return false;
    if (isAboutRefusedIoArgument(context, diagnostic, compilerErrors)) return false;
    if (isRemovedQualifierTypeName(context, diagnostic, compilerErrors)) return false;
    if (isAboutRefusedBuiltinValue(context, diagnostic, refusedBuiltins, importedBuiltinRefusals))
      return false;
    if (repeatsRefusal(context, diagnostic, refusals, compilerErrors)) return false;
    if (repeatsStrictModeRefusal(context, diagnostic, compilerErrors)) return false;
    if (repeatsReadonlyWrite(diagnostic, compilerErrors)) return false;
    if (repeatsRefusedListUses(context, diagnostic, compilerErrors)) return false;
    if (readsDeclarationAsValue(context, diagnostic, compilerErrors)) return false;
    if (
      isResultOfRefusedCycle(
        context,
        diagnostic,
        analysis.diagnostics.filter((d) => d.code === TS_CODES.RECURSION),
      )
    )
      return false;
    if (
      ruleCodeOf(diagnostic.code) === 2318 &&
      diagnostic.message.includes("'Promise'") &&
      compilerErrors.some((e) => e.code === 'TS8072' && insideDynamicImport(context, e.span))
    ) {
      return false;
    }
    const pair = SAME_MISTAKE.find((p) => p.typescript === ruleCodeOf(diagnostic.code));
    if (pair === undefined) return true;
    return !compilerErrors.some(
      (error) =>
        pair.typeshade.has(String(error.code)) && sameMistakeSpans(context, diagnostic, error),
    );
  });
  return [
    ...keptTypescript.map(
      (diagnostic) =>
        foreignNameInRefusal(analysis.sourceFile, diagnostic, compilerErrors) ?? diagnostic,
    ),
    ...typeshade,
  ];
}

function insideDynamicImport(context: DiagnosticFilterContext, span: TypeshadeTextSpan): boolean {
  let node: ts.Node | undefined = nodeAtPosition(context.sourceFile, span.start);
  while (node !== undefined) {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      return true;
    }
    node = node.parent;
  }
  return false;
}

function toTypeshadeDiagnostic(
  uri: string,
  sourceFile: ts.SourceFile,
  diagnostic: ts.Diagnostic,
): TypeshadeDiagnostic {
  const span = clampSpan(sourceFile, diagnostic.start ?? 0, diagnostic.length ?? 0);
  return {
    uri,
    span,
    range: rangeForSpan(sourceFile, span),
    severity: severityOfTs(diagnostic.category),
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    code: diagnostic.code,
    source: 'typescript',
  };
}

export function getTypeScriptDiagnostics(
  languageService: ts.LanguageService,
  sourceFile: ts.SourceFile,
  uri: string,
): TypeshadeDiagnostic[] {
  const raw = [
    ...languageService.getSyntacticDiagnostics(uri),
    ...languageService.getSemanticDiagnostics(uri),
  ];
  const context: DiagnosticFilterContext = {
    sourceFile,
    checker: languageService.getProgram()?.getTypeChecker(),
  };
  return raw
    .filter((d) => !isFiltered(context, d))
    .map((d) => toTypeshadeDiagnostic(uri, sourceFile, d));
}

export function fromCompilerDiagnostic(
  sourceFile: ts.SourceFile,
  uri: string,
  diagnostic: TsCompilerDiagnostic,
): TypeshadeDiagnostic {
  const span = spanForDiagnostic(sourceFile, diagnostic);
  const related = relatedSitesOf(diagnostic).map((site) => ({
    location: {
      uri: site.fileName,
      range: {
        start: { line: site.line - 1, character: site.character - 1 },
        end: { line: site.endLine - 1, character: site.endCharacter - 1 },
      },
    },
    message: RELATED_SITE_MESSAGE,
  }));
  return {
    uri,
    span,
    range: rangeForSpan(sourceFile, span),
    severity: severityOfTypeshade(diagnostic.category),
    message: diagnostic.message,
    code: diagnostic.code ?? 'TS8099',
    source: 'typeshade',
    ...(related.length > 0 ? { relatedInformation: related } : {}),
  };
}

const RELATED_SITE_MESSAGE = 'The place this diagnostic is about.';

export function getTypeshadeDiagnostics(
  analysis: CompileTsSourceResult,
  sourceFile: ts.SourceFile,
  uri: string,
): TypeshadeDiagnostic[] {
  return (
    analysis.diagnostics
      // TypeScript's parse errors reach the editor from `getTypeScriptDiagnostics`, with their
      // own `TS1005`-style codes. The compiler's `SYNTAX` copies of them exist so a `compile()`
      // caller sees them without `tsc`; here they would underline the same token twice.
      .filter((d) => d.code !== TS_CODES.SYNTAX)
      // A document's list is what is located in it (Rule 3.9): a mistake in a file it imports
      // is shown on that file, as `tsc` shows it, and its offsets index that file's text. A
      // refusal that only this program makes about an imported declaration is located here,
      // at the use: the compiler reports it in the entry file (`compileLinked`, #1186).
      .filter((d) => d.fileName === sourceFile.fileName)
      .map((d) => fromCompilerDiagnostic(sourceFile, uri, d))
  );
}
