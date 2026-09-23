// === TypeScript + TypeShade diagnostics, merged into one TypeshadeDiagnostic list (§5, §6) ===

import ts from 'typescript';
import type { CompileTsSourceResult, TsCompilerDiagnostic } from '../compiler/ts/source-file.js';
import { TS_CODES } from '../compiler/ts/codes.js';
import { moduleVarSpace } from '../compiler/ts/module-vars.js';
import { GPU_BRAND_TAGS } from './ambient.js';
import { clampSpan, nodeAtPosition, rangeForSpan, spanForDiagnostic } from './positions.js';
import { ERASING_OPERATORS, ERASING_UNARY_OPERATORS } from './projection.js';
import type { TypeshadeDiagnostic, TypeshadeSeverity, TypeshadeTextSpan } from './types.js';

/**
 * One TypeScript diagnostic code the ambient lib cannot silence, and the rule that decides
 * whether one occurrence of it is a real problem or the false positive §6 measured. Kept as one
 * table, per file, rather than scattered `if` statements, so every filtered code and its reason
 * is visible in one place.
 */
interface DiagnosticFilterRule {
  /** The numeric TypeScript diagnostic code this rule may drop. */
  readonly code: number;
  /** Why this code is filtered here instead of by the ambient lib. */
  readonly reason: string;
  /** Returns `true` when this specific occurrence is the known false positive and should be
   * dropped; `false` lets it through as a real diagnostic. */
  readonly when: (context: DiagnosticFilterContext, diagnostic: ts.Diagnostic) => boolean;
}

/** The part of a diagnostic the locators below read: where it starts and how long it is. A
 * `ts.Diagnostic` is one, and so is a merged diagnostic's span, which is how the merge step
 * (`mergeDiagnostics`) asks the same questions of a diagnostic that is no longer TypeScript's. */
type DiagnosticSpan = Pick<ts.Diagnostic, 'start' | 'length'>;

/**
 * What a rule may consult about the document one diagnostic came from: the parsed source file,
 * and the program's type checker for the rules that decide from an expression's TYPE rather
 * than from the syntax alone (the vector and matrix arithmetic rules below). `checker` is
 * `undefined` only when the language service holds no program; a rule that cannot prove an
 * occurrence is the known false positive then leaves the diagnostic alone, so a missing
 * checker can only ever show more diagnostics, never hide one.
 */
interface DiagnosticFilterContext {
  readonly sourceFile: ts.SourceFile;
  readonly checker: ts.TypeChecker | undefined;
}

/**
 * A top-level function declaration, exported or not. `lower/function.ts`'s
 * `lowerSourceFunctions` is the authority on what counts as a `"use typeshade"` entry point —
 * it collects every `sourceFile.statements.filter(ts.isFunctionDeclaration)` with no `export`
 * requirement at all, so `@vertex`/`@fragment`/`@compute` on a non-exported top-level function
 * compiles and emits today. The old `export`-only predicate here disagreed with that and left
 * TS1206 red on a program the compiler accepts outright.
 */
function isTopLevelFunctionDeclaration(node: ts.Node): node is ts.FunctionDeclaration {
  return (
    ts.isFunctionDeclaration(node) && node.parent !== undefined && ts.isSourceFile(node.parent)
  );
}

/**
 * TS1206 ("Decorators are not valid here") fires on a function declaration's own decorator
 * (`@vertex`) and on a parameter decorator (`@builtin("vertex_index")`) alike, because legacy
 * decorators are grammatically valid only on a class, its members, or their parameters — never
 * on a plain function declaration. `"use typeshade"` deliberately puts `@vertex`/`@fragment`/
 * `@compute` on a top-level function (exported or not — see `isTopLevelFunctionDeclaration`)
 * and `@builtin`/`@location` on that function's parameters, so this is the one syntax-level
 * restriction no ambient `.d.ts` can configure away (§6); this predicate recognizes exactly
 * that shape, on the entry function itself or on one of its parameters, so any other TS1206
 * (a decorator TypeShade does not define) still surfaces.
 */
function isDecoratorOnTopLevelFunction(
  context: DiagnosticFilterContext,
  diagnostic: ts.Diagnostic,
): boolean {
  const pos = diagnostic.start ?? 0;
  let node: ts.Node | undefined = nodeAtPosition(context.sourceFile, pos);
  while (node !== undefined && !ts.isDecorator(node)) node = node.parent;
  if (node === undefined) return false;
  const decorated = node.parent;
  if (decorated === undefined) return false;
  if (isTopLevelFunctionDeclaration(decorated)) return true;
  if (ts.isParameter(decorated) && decorated.parent !== undefined) {
    return isTopLevelFunctionDeclaration(decorated.parent);
  }
  return false;
}

/**
 * The escaped name TypeScript gives a property whose key is a unique symbol, for example
 * `__@vecTag@15`. The trailing number is that symbol's internal id, which moves with the
 * TypeScript version (`api-surface.test.ts` records the same hazard about its own snapshot),
 * so only the tag name between the two `@` is ever matched.
 */
const UNIQUE_SYMBOL_PROPERTY = /^__@(.+)@\d+$/;

/** `GPU_BRAND_TAGS` as a set, for the per-property lookup in `isGpuBrandedType`. */
const GPU_BRAND_TAG_NAMES: ReadonlySet<string> = new Set(GPU_BRAND_TAGS);

/**
 * Whether `type` is one of the ambient lib's vector or matrix types, decided structurally: it
 * carries a property keyed by one of the unique symbols `GPU_BRAND_TAGS` names. Structural
 * rather than by type name because a type reaches here under any of its names (`vec3f` is
 * `vec3`, a matrix column is `MatColumn<...>`), and because a vector type `ambient.ts` gains
 * later is then covered with no second list to keep in step. A union or intersection counts when any constituent does.
 */
export function isGpuBrandedType(type: ts.Type): boolean {
  if (type.isUnionOrIntersection()) return type.types.some(isGpuBrandedType);
  return type.getProperties().some((property) => {
    const tag = UNIQUE_SYMBOL_PROPERTY.exec(property.getName())?.[1];
    return tag !== undefined && GPU_BRAND_TAG_NAMES.has(tag);
  });
}

/**
 * Whether `expression`'s type is an ambient vector or matrix. With no checker every rule that
 * decides from a type answers `false` and the diagnostic survives, per `DiagnosticFilterContext`.
 */
function isGpuExpression(context: DiagnosticFilterContext, expression: ts.Expression): boolean {
  if (context.checker === undefined) return false;
  return isGpuBrandedType(context.checker.getTypeAtLocation(expression));
}

/**
 * The nearest binary expression enclosing `diagnostic`'s position, if any. Each caller then
 * checks that position against the operand its own code names, which is also what rejects the
 * unrelated enclosing binary expression this walk finds when the position is not inside an
 * operand at all.
 */
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

/**
 * The binary expression `diagnostic` covers EXACTLY, if it is reported on one. A code that names
 * both operands (TS2365) spans the whole operation, and a left-nested product starts at the same
 * offset as the operation it is nested in (`n * 3. + v` and `n * 3.` both start at `n`), so the
 * nearest enclosing binary is the wrong one to ask about half the time: it made `n * 3. + v`
 * report while `v + n * 3.` and `(n * 3.) + v`, the same program respelled, did not. Matching
 * the end as well as the start picks the operation the code is actually about, the same guard
 * `argumentAt` uses for an argument.
 */
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

/**
 * Whether `expression` is a vector or a matrix: to TypeScript (`isGpuExpression`), or to the
 * compiler through an operation whose type TypeScript erased to a `number` or a `boolean`
 * (`gpuArithmeticShape`), such as `(a < b)` in `(a < b) & m` or `(n * 2.)` in `(n * 2.) * m`.
 * What an operator makes of such an operand is the compiler's to say, as it is for a branded
 * one.
 */
function isGpuValue(context: DiagnosticFilterContext, expression: ts.Expression): boolean {
  return (
    isGpuExpression(context, expression) || gpuArithmeticShape(context, expression) !== undefined
  );
}

/**
 * TS2362 points at the LEFT operand of an arithmetic operation whose type is not numeric, so
 * this drops it only when that operand is a vector or a matrix (`isGpuValue`). `v * s`,
 * `c.rgb * 0.5`, `vec4(0.) * Math.PI`, `m * v` and `v *= 2.` are the arithmetic "use typeshade"
 * is written in and no ambient declaration can type them: a branded object type is not a
 * `number`, and un-branding the vectors to please this check would take every real vector check
 * with it (issue #21). Deciding per operand rather than "either operand is a vector" is what
 * keeps `v * "x"` red, through the TS2363 on the string.
 */
function isGpuLeftOperand(context: DiagnosticFilterContext, diagnostic: ts.Diagnostic): boolean {
  const binary = binaryExpressionAt(context, diagnostic);
  if (binary === undefined) return false;
  const pos = diagnostic.start ?? 0;
  if (pos < binary.left.getStart() || pos >= binary.operatorToken.getStart()) return false;
  return isGpuValue(context, binary.left);
}

/** TS2363 is TS2362 for the RIGHT operand (`m * v`'s vector, `2. * v`), and filtered the same
 * way: only when the operand the code points at is itself a vector or a matrix. */
function isGpuRightOperand(context: DiagnosticFilterContext, diagnostic: ts.Diagnostic): boolean {
  const binary = binaryExpressionAt(context, diagnostic);
  if (binary === undefined) return false;
  const pos = diagnostic.start ?? 0;
  if (pos < binary.right.getStart() || pos >= binary.right.getEnd()) return false;
  return isGpuValue(context, binary.right);
}

/**
 * TS2365 ("Operator '+' cannot be applied to types 'vec3' and 'vec3'") names both operands and
 * is reported on the whole expression, so either operand being an ambient vector or matrix is
 * what makes it the known false positive. `vec3(1.) + vec2(1.)` is dropped here too, and is not
 * thereby unreported: the compiler's own TYPE_MISMATCH (`TS8003`, "Vectors must have the same
 * size") is the authority on what combines with what, and leaving both would show the editor
 * two messages for one mistake. The operator has to be one the front end gives the operands'
 * own shape (`ERASING_OPERATORS`), arithmetic or bitwise: a comparison draws TS2365 only when
 * its operands really do not compare, a vector with a vector of another size or with a scalar,
 * which the compiler reports as well, so that TS2365 is not a false positive but the same
 * mistake, and the merge keeps the compiler's (`SAME_MISTAKE`). The operation asked about is
 * the one the code SPANS (see `binaryExpressionSpanning`), not the nearest one enclosing its
 * start offset, which for a left-nested product is a different operation entirely.
 */
function isGpuBinaryOperand(context: DiagnosticFilterContext, diagnostic: ts.Diagnostic): boolean {
  const binary = binaryExpressionSpanning(context, diagnostic);
  if (binary === undefined) return false;
  if (ERASING_OPERATORS.get(binary.operatorToken.kind) !== 'shape') return false;
  return isGpuValue(context, binary.left) || isGpuValue(context, binary.right);
}

/** The operators TypeScript refuses on two booleans with TS2447, suggesting `&&`, `||` or
 *  `!==` in their place. */
const BOOLEAN_BITWISE_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.AmpersandToken,
  ts.SyntaxKind.BarToken,
  ts.SyntaxKind.CaretToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
]);

/**
 * TS2447 ("The '&' operator is not allowed for boolean types"), on two masks: `(a < b) & (c < d)`.
 * A comparison of two vectors is the `bool` vector of their width to the compiler and a
 * `boolean` to TypeScript, which refuses a bitwise operator on two booleans. On `vecN<bool>`,
 * `&`, `|` and `^` are WGSL's componentwise and, or and xor, and the `&&` and `||` TypeScript
 * suggests instead take a scalar `bool` only. Dropped when either operand is a vector
 * (`isGpuValue`); the compiler reports two masks of different widths itself. On two scalar
 * booleans the code stands.
 */
function isGpuMaskOperation(context: DiagnosticFilterContext, diagnostic: ts.Diagnostic): boolean {
  const binary = binaryExpressionSpanning(context, diagnostic);
  if (binary === undefined || !BOOLEAN_BITWISE_OPERATORS.has(binary.operatorToken.kind)) {
    return false;
  }
  return isGpuValue(context, binary.left) || isGpuValue(context, binary.right);
}

/** The operation a name stands for (`erasedNameOf`), with the declarations already read through
 *  to reach it. */
interface ErasedName {
  readonly operation: ts.Expression;
  readonly expanding: ReadonlySet<ts.Node>;
}

/**
 * The operation a NAME stands for, when TypeScript typed the name from an operation that erased
 * a vector's type and nothing wrote the type back in: the name's declaration is a `const` or
 * `let` of this file with no type annotation, whose initializer is itself such an operation
 * (`const t = m * s`, `const c = a < b`), so TypeScript typed it the `number` or `boolean` the
 * operation's own report is filtered for.
 *
 * In the program the service builds, the projection has written the type into every such
 * declaration the compiler gave a vector or a matrix (`projection.ts`), so a declaration left
 * without one is, in practice, one the compiler REFUSED: it has reported the operation, and
 * every TypeScript report about the name is that `number` again. The name is judged as the
 * operation would be in its place, `return t` as `return m * s`, so the compiler's report
 * stands alone, the way `refused-names.ts` has the compiler itself say nothing more about a
 * name whose declaration it refused. A name TypeScript typed from anything else (a call, a
 * swizzle, a literal) is judged by TypeScript's own type.
 *
 * `expanding` holds the declarations already read through, so names declared from each other
 * (`const a = b * 2.` and `const b = a * 2.`) end the walk.
 */
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

/**
 * Whether `node` applies an operator that erases a vector's type (`ERASING_OPERATORS`,
 * `ERASING_UNARY_OPERATORS`) to an ambient vector or matrix anywhere inside it: arithmetic, a
 * bitwise or shift operator, a comparison, or a unary one. The whole subtree is searched because
 * the `number` or `boolean` such an operation produces spreads: in `normalize(a * 2.)` the
 * argument is already a `number` when the call's return type is inferred, so the node TS2322 is
 * reported on can sit several levels above the operation that caused it. A name declared from
 * such an operation with no type written in stands for it (`erasedNameOf`).
 */
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

/**
 * The value TS2322 found unassignable, recovered from the syntax the code is reported on: the
 * `return` keyword of a return statement, the name of a variable declaration, the property name
 * of an object literal member, or the left-hand side of an assignment (`out[idx] = v * s`
 * included). Only a position ahead of the value itself is accepted, so a TS2322 raised inside
 * the value is never mistaken for one about the value. The one exception is an arrow function's
 * expression body, which is its return with no keyword to point at: TypeScript reports it on
 * the body itself, so the diagnostic has to cover exactly that body (#162).
 */
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

/**
 * TypeScript's TS2322, "Type 'X' is not assignable to type 'Y'", is reported under a code of
 * its own when the only reason is members the source lacks: TS2741 for one, TS2739 for a few,
 * TS2740 for many. A vector is an interface carrying every swizzle (`ambient.ts`), so a vector
 * of the wrong size, and the `number` vector arithmetic is typed as, reach an assignment as
 * one of these three. Each rule and pair that reads TS2322 reads them as TS2322.
 */
const MISSING_MEMBERS_CODES: ReadonlySet<number> = new Set([2739, 2740, 2741]);

/** The code a rule or a pair is keyed on for a diagnostic of `code`. */
const ruleCodeOf = (code: number | string): number | string =>
  typeof code === 'number' && MISSING_MEMBERS_CODES.has(code) ? 2322 : code;

/**
 * An object literal typed as a class that declares methods, `let rng: Rng = { state: 1 }`,
 * which TypeScript reports as TS2741 "Property 'next' is missing" (TS2739 and TS2740 for more).
 * The value of a class is its fields (Rule 6.9), and its methods and accessors are functions of
 * the module that take the value (Rules 8.10, 8.11), so the compiler builds it from a literal
 * that names the fields and has nothing else for the literal to carry. Dropped only when every
 * member TypeScript finds missing is a method or an accessor, so a literal that leaves out a
 * field still reports, as the compiler does.
 */
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

/**
 * TS2322 ("Type 'number' is not assignable to type 'vec3'") in a position that wants a vector
 * or matrix. Dropped only when the TARGET is an ambient vector or matrix and the value either
 * is one too or applies an operation that erases a vector's type (`hasGpuArithmetic`), because
 * such an operation is the only thing that makes the checker wrong here: `v * s` is typed
 * `number` and `a < b` `boolean`, so the `vec3` or `vec3b` return annotation, local, field or
 * assignment target it flows into reports a mismatch the compiler accepts. The annotation the
 * projection writes into a declaration from one (`const c = a < b`) is such a target. `let n: f32 = v` therefore keeps its TS2322: a scalar target is
 * a `number` to TypeScript, so nothing about that mismatch is the brand's doing. When target and
 * value are both vectors of the wrong shapes for each other, the compiler's own TYPE_MISMATCH
 * is the message the editor shows, as it is for TS2365.
 */
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

/**
 * The argument of a call expression one diagnostic is reported on, with the call and the
 * argument's index, so a rule can ask what the callee wanted in that position.
 */
interface ArgumentPosition {
  readonly call: ts.CallExpression;
  readonly index: number;
  readonly argument: ts.Expression;
}

/**
 * The argument `diagnostic` covers exactly, if it is reported on one. TS2345 spans the whole
 * argument expression, so the walk up from the diagnostic's position takes the first ancestor
 * that is an argument of a call AND has exactly the diagnostic's span: without that span check,
 * a diagnostic reported on a callee (`inner` in `outer(inner(x))`, which starts at the same
 * offset as the argument `inner(x)`) would be attributed to the outer call's parameter.
 */
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

/** Whether `symbol` is a signature's rest parameter (`...args: T[]`), read from its own
 * declaration rather than from the parameter's position in the list. */
function isRestParameter(symbol: ts.Symbol): boolean {
  const declaration = symbol.valueDeclaration;
  return (
    declaration !== undefined &&
    ts.isParameter(declaration) &&
    declaration.dotDotDotToken !== undefined
  );
}

/**
 * The type `signature` declares for the argument at `index`, or `undefined` when the signature
 * has no parameter there (a call with too many arguments, which is TS2554's business, not this
 * file's). A rest parameter covers every index from its own onwards and is unwrapped to its
 * element type, so `hypot(v * s, w)`'s second argument is measured against `T`, not `T[]`.
 */
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

/**
 * Every parameter type the argument at `position` could be measured against: the one from the
 * signature the checker resolved, plus, when the callee is overloaded and the checker resolved
 * none of its declared overloads, the parameter type each overload declares at that index. The
 * ambient vector constructors are the overloaded callees that matter here (`vec4` has four
 * overloads), and a TS2345 on one of them usually MEANS no overload matched, so there is no
 * single picked signature to ask; "some overload wants a vector in this position" is then the
 * honest question, and the argument side of the rule is what keeps `vec4(1., 1.)` reported.
 */
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

/**
 * The type parameter the parameter `position` lands on, when that parameter is INFERRED from the
 * call's own arguments, that is, when the signature declares it as one of its own type
 * parameters (`dot<T extends Numeric>`, `hypot<T>(...args: T[])`); `undefined` for a parameter
 * of a fixed type. Such a position has no fixed type to compare against: it is whatever the
 * checker inferred from the arguments, so one argument's type decides the type every other
 * argument in a position of the same type parameter is then checked against. A position of a
 * fixed type beside them (`select`'s `cond`) takes no part in that.
 */
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

/** Whether the parameter `position` lands on is inferred (`inferredParameterOf`). */
function isInferredParameter(
  checker: ts.TypeChecker,
  position: ArgumentPosition,
  signature: ts.Signature,
): boolean {
  return inferredParameterOf(checker, position, signature) !== undefined;
}

/**
 * Every brand shape a type carries, as keys that compare two branded types by SHAPE alone:
 * `vecTag:readonly ["f32", 3]` for a `vec3`, `vecTag:readonly ["i32", 3]` for a `vec3i`,
 * `matTag:readonly ["f32", 4]` for a `mat4`. The tag is part of the key because the brand
 * payloads collide across families (a `vec4` and a `mat4` are both branded `readonly
 * ["f32", 4]`), and a union contributes each of its constituents' shapes, which is how an
 * overload set's `vec3 | number` answers "a vec3 fits here". A type with no brand contributes
 * nothing, so an empty set means "this position is not about vectors at all".
 */
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

/** The one brand shape `expression`'s own type carries, or `undefined` when it carries none (a
 * `number`, an `f32`, the `number` a product is typed) or more than one. */
function gpuShapeOfExpression(
  context: DiagnosticFilterContext,
  expression: ts.Expression,
): string | undefined {
  const checker = context.checker;
  if (checker === undefined) return undefined;
  const keys = gpuShapeKeysOfType(checker, checker.getTypeAtLocation(expression), expression);
  return keys.size === 1 ? [...keys][0] : undefined;
}

/** `expression` with any parentheses around it taken off: `(lit)` is the name `lit`. */
function unparenthesized(expression: ts.Expression): ts.Expression {
  let inner = expression;
  while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
  return inner;
}

/** `matTag:` keys, so `gpuArithmeticShape` can tell a matrix operand from a vector one. */
const MATRIX_SHAPE_PREFIX = 'matTag:';

/** The shape an arithmetic operation produces from its operands' shapes. A matrix times a
 * vector is a VECTOR (`m * c` is the `vec4` every camera example ends with), so the vector
 * operand wins; anything else keeps the branded operand it has. */
function gpuOperationShape(
  left: string | undefined,
  right: string | undefined,
): string | undefined {
  if (left === undefined || right === undefined) return left ?? right;
  if (left.startsWith(MATRIX_SHAPE_PREFIX) && !right.startsWith(MATRIX_SHAPE_PREFIX)) return right;
  return left;
}

/** A vector's shape key, either brand, with its width captured: `vecTag:readonly ["f32", 3]`
 *  or `vec64Tag:3`. */
const VECTOR_SHAPE = /^(?:vecTag:readonly \["\w+", (\d)\]|vec64Tag:(\d))$/;

/** The shape a comparison makes of operands of `shape`: the `bool` vector of their width, as
 *  `gpuShapeKeysOfType` reads it off a `vec3b`. `undefined` for a matrix, which compares to
 *  nothing. */
function comparisonShape(shape: string): string | undefined {
  const match = VECTOR_SHAPE.exec(shape);
  const n = match?.[1] ?? match?.[2];
  return n === undefined ? undefined : `vecTag:readonly ["bool", ${n}]`;
}

/**
 * The shape the vector or matrix operation inside `node` would have produced if its type had
 * survived it: what `hasGpuArithmetic` finds, answered with a shape instead of a yes. The walk
 * takes the OUTERMOST such operation, because that is the value the call receives:
 * `u.tint.rgb * (vo.uv.y * u.gain)` is a `vec3`, decided by its own operands, not by the scalar
 * product nested in its right-hand side. An operand is measured the same way, so `m * (c * 2.)`
 * is the vector a matrix times a vector makes, and `(a * 2.) < b` the `bool` vector a comparison
 * does.
 */
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
  // An operand's own shape already searched the operand, so an operation whose operands have
  // none has none, and the walk does not go down it a second time.
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

/** The shape a value would have if the operations inside it kept a vector's type: its own, or
 * the one the operation inside it produced. `undefined` for a value that is not about vectors
 * at all. */
function gpuValueShape(
  context: DiagnosticFilterContext,
  expression: ts.Expression,
  expanding: ReadonlySet<ts.Node> = new Set(),
): string | undefined {
  return (
    gpuShapeOfExpression(context, expression) ?? gpuArithmeticShape(context, expression, expanding)
  );
}

/** Every brand shape the parameter at `position` accepts, across the signatures
 * `parameterTypesAt` considers. Empty when that parameter is not a vector or matrix position:
 * an `f32`, or a type parameter the arguments have already poisoned to `number`. */
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

/**
 * Whether every OTHER argument of the call still fits where it sits, measured with the brand
 * arithmetic erased put back. TypeScript checks a call's arguments in order and reports only the
 * FIRST that fails, so dropping this one hides every later argument's mismatch with it: without
 * this check `cross(a * 2., b)` with a `vec2` `b` goes completely silent, and the front end has
 * no argument check for the ambient math functions to speak in TypeScript's place.
 *
 * A sibling in an INFERRED position is measured against the shape its type parameter settles
 * to, since a type parameter is one type for the whole call: `shape`, when this argument sits in
 * a position of the same type parameter, and otherwise the first sibling's shape in one. A
 * sibling in a fixed position is measured against the shapes its own parameter declares, so in
 * `select(a, b, (a < b) & m)` the two values settle `T` between them and the mask is measured
 * against `cond`. A sibling that carries no shape at all (a literal, an `f32`, a string) is left
 * alone: it is not this rule's business, and TypeScript reports it on its own once the
 * arithmetic stops hiding it.
 */
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

/**
 * TS2345 ("Argument of type 'number' is not assignable to parameter of type 'vec3'"), the same
 * lost brand as TS2322 seen at a call instead of at an assignment: `vec4(u.tint.rgb * k, ...)`,
 * `normalize(v * s)`, `mix(a, b * 0.5, t)` and a user function's `f(v * s)` all hand a vector
 * position a value TypeScript has already typed `number`. Two shapes, because vector arithmetic
 * reaches a call from two directions (issue #43):
 *
 * - the argument itself does vector or matrix arithmetic and that arithmetic's SHAPE is one the
 *   parameter there accepts (`vec3 * f32` into a `vec3` parameter);
 * - the parameter's type is INFERRED from the arguments and another argument's arithmetic, of
 *   exactly this argument's shape, poisoned the inference: in `dot(a * 2., b)` with two `vec3`
 *   the first argument is already `number`, so `T` infers `number` and TypeScript reports the
 *   perfectly good `b` instead.
 *
 * Both arms compare SHAPES, never just "there is a brand here and arithmetic somewhere", because
 * the ambient math functions are checked by nothing else: the compiler front end has no argument
 * check for them at all (`dot(vec3, vec2)` produces no compiler diagnostic), so a wrong size that
 * TypeScript stops reporting is a wrong size nobody reports. `dot(a * 2., b)` with a `vec2` `b`
 * keeps its TS2345 because `vec2` is not the `vec3` the arithmetic would have inferred, and
 * `otherArgumentsFit` extends the same question to the arguments TypeScript never got to.
 *
 * Arithmetic on a branded operand is required in both arms, never "the argument is branded" on
 * its own, so a branded argument of the wrong shape in an arithmetic-free call still reports
 * (`ambient.test.ts` pins that a `vec2` fails a `vec4` parameter). That is the one way this rule
 * is narrower than the TS2322 rule it mirrors, where the compiler's own TYPE_MISMATCH does cover
 * the both-branded case.
 */
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

/** The shape key an INFERRED parameter position carries for an argument with no vector or
 * matrix brand at all (a literal, an `f32`, a `bool`). A type parameter is one type for the
 * whole call, so "scalar" has to be a shape of its own here: without it `mix(vec3i, vec3i, i32)`
 * would look like a call the generic `mix<T>(a: T, b: T, t: T)` accepts, and that is a program
 * Tint rejects ("no matching call to mix(vec3<i32>, vec3<i32>, i32)"). */
const SCALAR_SHAPE = 'scalar';

/**
 * Whether `overload` accepts every argument of `call` once the brand vector arithmetic erased is
 * put back: each argument is measured by `gpuValueShape` (its own brand, or the one the
 * arithmetic inside it would have produced), a parameter the overload declares concretely by the
 * brands its type carries, and a parameter the overload infers by the one shape a type parameter
 * can settle on for the whole call.
 *
 * The arity check is first and is exact, because none of the ambient declarations has an
 * optional parameter: without it `mix(a * 0.5, b)` would "fit" the three-parameter overload
 * whose first two parameters it matches, and the missing argument would go unreported.
 */
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

/**
 * The call a diagnostic is reported on as a WHOLE, rather than on one of its arguments.
 *
 * TypeScript puts an overload failure on an ARGUMENT span only when the first argument is the
 * one that failed; as soon as a later argument is the mismatch, the span it reports is the
 * call's own callee instead. `max(base, u.tint.rgb * u.gain)` with two `vec3` therefore arrives
 * as a TS2769 on `max`, where `argumentAt` finds no argument at all and the rule below would
 * give up on a call it is exactly meant to drop. Both spellings are recognized here: a span
 * covering the call's expression (the callee identifier, or the property access of a method
 * call), and one covering the whole `CallExpression`.
 *
 * The span match is exact at both ends for the reason `argumentAt` states: a callee and the
 * arguments nested under it share a start offset, so start alone attributes a diagnostic to the
 * wrong node half the time.
 */
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

/**
 * TS2769 ("No overload matches this call"), the shape TS2345 takes when the callee is
 * overloaded and no candidate matched. `mix` is the callee that matters: its concrete overloads
 * and its generic one all take three arguments, so TypeScript has no single candidate to blame
 * and reports this code instead of naming the parameter.
 *
 * Dropped only when the call does vector or matrix arithmetic somewhere AND some overload
 * accepts every argument with that arithmetic's shape restored. Asking the whole signature,
 * rather than each index against the union of every overload's parameter there, is what keeps
 * `mix(c * 0.5, vo.uv, 0.5)` reported: a `vec2` is a shape SOME overload accepts in the second
 * position, but no one overload accepts a `vec3` first and a `vec2` second. Arithmetic is
 * required for the same reason it is in the TS2345 rule, and it is what keeps
 * `mix(vec3i, vec3i, i32)` reporting, which is a call the front end lowers and Tint then
 * rejects.
 *
 * TWO SPANS, because TypeScript reports this code on two of them. An overload failure caused by
 * the FIRST argument lands on that argument, which is the `argumentAt` path and keeps the
 * per-argument guard the TS2345 rule uses: the argument reported on has to be about vectors at
 * all. One caused by a LATER argument lands on the callee, where there is no argument to guard
 * with, so the two whole-call tests carry the rule on their own. They are enough because
 * `overloadFitsRestoredShapes` asks about the whole signature: `max(a, b * 2.)` with two `vec3`
 * fits the generic overload and goes, while the same call with a `vec2` `b` fits none and stays.
 * Without this second path 30 valid vector calls reported in the editor, every one of them a
 * `min`/`max`/`pow`/`step`/`mod`/`atan2`/`clamp`/`smoothstep` whose arithmetic sits anywhere but
 * the first argument.
 */
function isGpuArithmeticOverloadCall(
  context: DiagnosticFilterContext,
  diagnostic: ts.Diagnostic,
): boolean {
  const checker = context.checker;
  if (checker === undefined) return false;
  const position = argumentAt(context, diagnostic);
  if (position !== undefined && gpuValueShape(context, position.argument) === undefined) {
    return false;
  }
  const call = position?.call ?? calleeCallAt(context, diagnostic);
  if (call === undefined) return false;
  if (!call.arguments.some((argument) => hasGpuArithmetic(context, argument))) return false;
  return checker
    .getTypeAtLocation(call.expression)
    .getCallSignatures()
    .some((overload) => overloadFitsRestoredShapes(context, checker, call, overload));
}

/**
 * TS2339 ("Property 'xy' does not exist on type 'number'"): a member read on a vector whose type
 * an operation erased, in place (`(n * 2.).xy`, `(a < b).x`) or through a name declared from
 * one that the projection could not type (`erasedNameOf`). TypeScript has no vector there to
 * find the member on. The front end checks every swizzle itself and names what is wrong with a
 * bad one (`TS8022 .w out of range on vec3<f32>`), so it is the authority here, as `TS8003` is
 * for TS2365: the whole family of this code on such a value is dropped, and a real mistake is
 * reported once, by the compiler.
 *
 * A value TypeScript still types as a vector keeps its TS2339, and so does a matrix, which has
 * no members to read.
 */
function isLostBrandMember(context: DiagnosticFilterContext, diagnostic: ts.Diagnostic): boolean {
  const pos = diagnostic.start ?? 0;
  let node: ts.Node | undefined = nodeAtPosition(context.sourceFile, pos);
  while (node !== undefined && !ts.isPropertyAccessExpression(node)) node = node.parent;
  if (node === undefined || node.name.getStart(context.sourceFile) !== pos) return false;
  const object = node.expression;
  // An erased type shows as the `number` arithmetic is typed, the `boolean` a comparison is, or
  // the `any` of an erroneous operation. An object TypeScript types as anything else, a struct
  // included, is measured by TypeScript's own member check.
  const checker = context.checker;
  if (checker === undefined) return false;
  const flags = checker.getTypeAtLocation(object).flags;
  if ((flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.Any)) === 0) {
    return false;
  }
  const shape = gpuValueShape(context, object);
  return shape !== undefined && !shape.startsWith(MATRIX_SHAPE_PREFIX);
}

/**
 * Workgroup memory, `let tile: workgroup<array<f32, 64>>`: a top-level `let` whose annotation
 * is the `workgroup<T>` wrapper, the test `module-vars.ts` makes a module variable by
 * (`moduleVarSpace`). It never has an initializer, since WGSL gives a `var<workgroup>` none and
 * the compiler refuses one, and a kernel writes it through an element (`tile[i] = x`), which
 * TypeScript does not count as an assignment to `tile`.
 */
function isWorkgroupDeclaration(declaration: ts.Declaration): boolean {
  if (!ts.isVariableDeclaration(declaration)) return false;
  const list = declaration.parent;
  if (!ts.isVariableDeclarationList(list) || (list.flags & ts.NodeFlags.Let) === 0) return false;
  const statement = list.parent;
  return (
    ts.isVariableStatement(statement) &&
    ts.isSourceFile(statement.parent) &&
    moduleVarSpace(declaration.type) === 'workgroup'
  );
}

/**
 * TS2454 ("Variable 'tile' is used before being assigned") on a name that resolves to workgroup
 * memory. The checker resolves the name, so a local that shadows it keeps its own diagnostic;
 * without a checker the occurrence cannot be proved, and it stays.
 */
function isWorkgroupMemoryRead(
  context: DiagnosticFilterContext,
  diagnostic: ts.Diagnostic,
): boolean {
  const checker = context.checker;
  if (checker === undefined) return false;
  const node = nodeAtPosition(context.sourceFile, diagnostic.start ?? 0);
  if (!ts.isIdentifier(node)) return false;
  const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
  return declaration !== undefined && isWorkgroupDeclaration(declaration);
}

const TS_DIAGNOSTIC_FILTERS: readonly DiagnosticFilterRule[] = [
  {
    code: 1206,
    reason:
      '@vertex/@fragment/@compute on a top-level function, and @builtin/@location on that ' +
      'function\'s parameters, are exactly the grammar "use typeshade" defines (the compiler ' +
      'does not require export either — see lower/function.ts) — legacy decorators otherwise ' +
      'forbid a function declaration or its parameters as a target, and no compiler option ' +
      'relaxes that. See design doc §6.',
    when: isDecoratorOnTopLevelFunction,
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
      '`&`, `|` or `^` on two masks, `(a < b) & (c < d)`: a comparison of vectors is a `bool` ' +
      'vector to the compiler and a `boolean` to TypeScript, which refuses a bitwise operator ' +
      "on two booleans. On `vecN<bool>` the three are WGSL's componentwise and, or and xor, and " +
      'the `&&` and `||` suggested instead take a scalar `bool` only. Dropped when either ' +
      'operand is a vector to the compiler; on two scalar booleans the code stands.',
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
    code: 2339,
    reason:
      'A swizzle of a vector whose type an operation erased, in place (`(n * 2.).xy`, ' +
      '`(a < b).x`) or through a name declared from one that the projection could not type, ' +
      'because the compiler refused the declaration. The front end checks every swizzle and ' +
      'names a bad one (`TS8022 .w out of range on vec3<f32>`), so it is the authority and a ' +
      'real mistake is reported once. A value TypeScript still types as a vector keeps this ' +
      'code, and so does a matrix.',
    when: isLostBrandMember,
  },
  {
    code: 2454,
    reason:
      'Workgroup memory is declared with no initializer, `let tile: workgroup<array<f32, 64>>`, ' +
      'because a WGSL `var<workgroup>` takes none: it is zero at the start of each workgroup, ' +
      'and the compiler refuses an initializer. TypeScript 5.7 and later report a `let` that no ' +
      'statement assigns as used before being assigned in every function that reads it, and a ' +
      'kernel writes workgroup memory through an element (`tile[i] = x`), which is not an ' +
      'assignment to `tile`. So under TypeScript 5.9 every read was TS2454, and four examples ' +
      '(`workgroup-scratch`, `workgroup-reduce`, `compute-sync`, `workgroup-tile-2d`) showed ' +
      'errors in the Playground. Dropped only when the name resolves to a top-level `let` ' +
      'annotated `workgroup<T>`. A per-invocation module `let` that nothing assigns keeps the ' +
      'diagnostic, as a local read before its first assignment does (Rule 7.6): GLSL ES 3.00 ' +
      'leaves either one undefined, while workgroup memory exists on WGSL alone.',
    when: isWorkgroupMemoryRead,
  },
];

function isFiltered(context: DiagnosticFilterContext, diagnostic: ts.Diagnostic): boolean {
  return TS_DIAGNOSTIC_FILTERS.some(
    (rule) => rule.code === ruleCodeOf(diagnostic.code) && rule.when(context, diagnostic),
  );
}

// === One mistake, one diagnostic, across the two halves (Rule 12.4) ===
//
// TypeScript and the compiler front end both check a `"use typeshade"` file, and a mistake both
// can see was reported by both: `y = 2.` on a `const` as TS2588 and TS8005, `g(x)` one argument
// short as TS2554 and TS8019, `colr` as TS2304 and TS8022. A person reads past the second
// sentence; a coding agent fixes both. The merged list keeps one, by two rules.

/** A mistake both halves report, by code: TypeScript's `typescript` and the compiler's
 *  `typeshade`. The merged list keeps the compiler's. */
interface SameMistake {
  readonly typescript: number;
  readonly typeshade: ReadonlySet<string>;
  readonly reason: string;
}

/**
 * The pairs. The compiler's diagnostic is the one kept, for three reasons: it is what
 * `compile()` and the build report, so the editor, `typeshade check` and the build agree
 * (Rule 12.7); it is written in the surface's words and names the remedy (Rule 12.1), where
 * TypeScript's spells a brand's internals (`'{ readonly [vecTag]: readonly ["f32", 3]; }'`);
 * and it is the authority on what combines with what, as it already is for TS2365.
 *
 * That holds for a misspelled name too, so no pair is an exception. The compiler names the name
 * a misspelled one is spelled like, by TypeScript's own rule (`src/compiler/ts/unknown-names.ts`),
 * and TypeShade's spelling of a GLSL or HLSL name before any guess by letters, which for `fmod`
 * would be `mod` (#218); TypeScript's "Did you mean" (TS2552, TS2551, TS2561) has nothing to add.
 */
const SAME_MISTAKE: readonly SameMistake[] = [
  {
    typescript: 2304,
    typeshade: new Set(['TS8022', 'TS8004', 'TS8002', 'TS8012']),
    reason: 'An unknown name: a value, a function, a type or a host API (`Date`).',
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
    typeshade: new Set(['TS8019']),
    reason: 'The wrong number of arguments.',
  },
  {
    typescript: 2322,
    typeshade: new Set(['TS8003']),
    reason: 'A value of the wrong type, assigned or declared.',
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
    typescript: 2345,
    typeshade: new Set(['TS8003', 'TS8019', 'TS8036']),
    reason: 'An argument of the wrong type, or too few components for a vector constructor.',
  },
  {
    typescript: 2769,
    typeshade: new Set(['TS8003', 'TS8019', 'TS8036']),
    reason: 'The same at an overloaded callee, the math builtins and the vector constructors.',
  },
];

/** The TypeScript codes reported about a CALL, on its callee or on one of its arguments. */
const CALL_CODES: ReadonlySet<number> = new Set([2345, 2554, 2769]);

const spanEnd = (span: TypeshadeTextSpan): number => span.start + span.length;

/** Whether `inner` lies inside `outer`, ends included. */
const within = (inner: TypeshadeTextSpan, outer: TypeshadeTextSpan): boolean =>
  inner.start >= outer.start && spanEnd(inner) <= spanEnd(outer);

const spanOfNode = (node: ts.Node, sourceFile: ts.SourceFile): TypeshadeTextSpan => {
  const start = node.getStart(sourceFile);
  return { start, length: node.getEnd() - start };
};

/** The call a TypeScript diagnostic in `CALL_CODES` is about: the one whose argument it covers,
 * or whose callee (TypeScript's span for a failed overload on a later argument, and for too few
 * arguments). */
function callOf(
  context: DiagnosticFilterContext,
  span: TypeshadeTextSpan,
): ts.CallExpression | undefined {
  return argumentAt(context, span)?.call ?? calleeCallAt(context, span);
}

/**
 * Whether a TypeScript diagnostic and a compiler one that `SAME_MISTAKE` pairs by code sit where
 * one mistake would put them.
 *
 * For a code about a call, anywhere in the same call: the compiler reports an argument count on
 * the call (`TS8019` on `g(x)`) where TypeScript reports it on the callee or on the first extra
 * argument, and a math builtin's mismatch on the argument (`TS8036` on `w`) where TypeScript
 * reports a failed overload on the callee (`max`).
 *
 * Otherwise TypeScript's span lies inside the compiler's and shares one of its ends: a name the
 * compiler cannot find (a value, a callee, a type, a field, a method) is the name itself in
 * both, and a `const` write the same target; a swizzle out of range is the member TypeScript
 * names at the end of the access the compiler names; a declared type mismatch is the name at
 * the start of the declaration. Inside alone is not enough, since a second mistake can sit
 * inside the span of a first: a misspelled argument inside a call the compiler refuses whole.
 */
function sameMistakeSpans(
  context: DiagnosticFilterContext,
  diagnostic: TypeshadeDiagnostic,
  error: TypeshadeDiagnostic,
): boolean {
  if (typeof diagnostic.code === 'number' && CALL_CODES.has(diagnostic.code)) {
    const call = callOf(context, diagnostic.span);
    const region = call === undefined ? diagnostic.span : spanOfNode(call, context.sourceFile);
    return within(error.span, region) || within(diagnostic.span, error.span);
  }
  return (
    within(diagnostic.span, error.span) &&
    (diagnostic.span.start === error.span.start || spanEnd(diagnostic.span) === spanEnd(error.span))
  );
}

/**
 * The expression a TypeScript diagnostic finds fault with the type of: the value TS2322 found
 * unassignable, the argument TS2345 or TS2769 names (or the call, when TS2769 is on its
 * callee), the object whose member TS2339 or TS2551 did not find, and the operation TS2365 or
 * TS2367 could not apply to its operands.
 */
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
    default:
      return undefined;
  }
}

/**
 * The TypeScript codes that say TypeScript could not type the node they sit on: a name it cannot
 * find (TS2304, and TS2552 with a suggestion), a member it cannot find (TS2339, TS2551), and a
 * callee it cannot call (TS2349). TypeScript types the value there `any`.
 */
const UNTYPED_CODES: ReadonlySet<number> = new Set([2304, 2552, 2339, 2551, 2349]);

/** Whether one of `failures` says TypeScript could not type `node` itself (`UNTYPED_CODES`). */
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

/**
 * The initializer TypeScript typed the local `name` reads from: that of a local declared with no
 * type. `undefined` for anything else (a parameter, a declared type), and without a checker.
 */
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

/** Whether TypeScript chose the signature of `call` among several, as it does for a builtin
 * declared once per shape (`normalize` on a `vec2`, a `vec3` and a `vec4`). */
function overloaded(context: DiagnosticFilterContext, call: ts.CallExpression): boolean {
  const callee = context.checker?.getTypeAtLocation(call.expression);
  return callee !== undefined && callee.getCallSignatures().length > 1;
}

/**
 * Whether TypeScript typed `value` from something it could not type itself, so that the type it
 * judges `value` by is its guess, not the program's:
 *
 * - a name or a member it cannot find, or a callee it cannot call (`UNTYPED_CODES`), all `any`,
 *   and a member or an element of such a value;
 * - a call it failed to resolve (`CALL_CODES`), which it types from a signature that did not
 *   match, a call of a callee it could not type, and a call of an overloaded function with an
 *   argument it could not type, where it takes the first overload that admits `any`;
 * - a local declared with no type, whose initializer is such a value;
 * - an operation of `ERASING_OPERATORS` or `ERASING_UNARY_OPERATORS` on such a value, which it
 *   types `number` or `boolean` from an `any` operand as readily as from a scalar.
 *
 * `failures` are the TypeScript errors to consult, the one being judged left out.
 */
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

/**
 * Whether a TypeScript diagnostic is TypeScript's own knock-on of something it could not type.
 * When no overload of a call matches (TS2769), or an argument fails (TS2345) or the count does
 * (TS2554), TypeScript still gives the call a type, from a signature that did not match; a name
 * it cannot find (`lerp`, TS2304) or a field (`frame.tiem`, TS2551) it types `any`, and an
 * arithmetic operation on an `any` `number`. Every place the value then reaches is judged by
 * that guess. `return max(v, w)` with a `vec2` `w` is the shape: the failed `max` is `number`,
 * and the `return` reports TS2322 about a value whose only fault is the call already reported.
 * The fault is the call's, so the report about the value goes (`typedFromFailure`): directly,
 * through a local declared with no type (`const c = max(v, w)` and then `return c`, `c.x`,
 * `cross(c, n)`), and through an operation (`const c = lerp(a, b, t)` and then
 * `vec4(c * x, 1.)`).
 *
 * TypeScript's own failure is the test, never a compiler error inside the value: the compiler
 * refuses things TypeScript types correctly (a function imported from another shader file is
 * `TS8004` to the single-file compiler, #187), and TypeScript's report about such a value
 * stands.
 */
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

/**
 * The merged list for one document: `typescript` (already filtered by
 * `TS_DIAGNOSTIC_FILTERS`) and `typeshade`, with one diagnostic per mistake (Rule 12.4). Two
 * rules drop a report, and each only ever drops an ERROR that another error already covers:
 *
 * - a TypeScript error that is TypeScript's own knock-on of a call it failed to resolve
 *   (`isKnockOn`) goes;
 * - a TypeScript error that `SAME_MISTAKE` pairs by code with a compiler error, and whose span
 *   sits where one mistake would put the two (`sameMistakeSpans`), goes: the compiler's stays.
 *
 * Without `analysis` nothing is dropped: the service passes none when a test asks for the two
 * halves unmerged (`TypeshadeLanguageServiceTestOptions`).
 */
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
  const keptTypescript = typescript.filter((diagnostic) => {
    if (diagnostic.severity !== 'error') return true;
    if (isKnockOn(context, diagnostic, typescript)) return false;
    const pair = SAME_MISTAKE.find((p) => p.typescript === ruleCodeOf(diagnostic.code));
    if (pair === undefined) return true;
    return !compilerErrors.some(
      (error) =>
        pair.typeshade.has(String(error.code)) && sameMistakeSpans(context, diagnostic, error),
    );
  });
  return [...keptTypescript, ...typeshade];
}

function severityOfTs(category: ts.DiagnosticCategory): TypeshadeSeverity {
  switch (category) {
    case ts.DiagnosticCategory.Error:
      return 'error';
    case ts.DiagnosticCategory.Warning:
      return 'warning';
    case ts.DiagnosticCategory.Suggestion:
      return 'hint';
    default:
      return 'information';
  }
}

function severityOfTypeshade(category: 'error' | 'warning' | 'message'): TypeshadeSeverity {
  return category === 'message' ? 'information' : category;
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

/**
 * Returns `sourceFile`'s TypeScript syntactic and semantic diagnostics from `languageService`,
 * mapped to `TypeshadeDiagnostic` with `source: 'typescript'`, with `TS_DIAGNOSTIC_FILTERS`
 * applied (§6). `uri` is the document's uri, threaded through for the returned diagnostics'
 * `uri` field (`sourceFile.fileName` inside the language service's program is the same value,
 * but naming it explicitly keeps this function agnostic to that detail).
 */
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

/**
 * Maps one front-end diagnostic (`TsCompilerDiagnostic`, one-based lines plus raw offsets) to a
 * `TypeshadeDiagnostic` with `source: 'typeshade'` and its `TS8xxx` code, the span coming
 * straight from the compiler's own `start`/`length` (see `spanForDiagnostic`). Shared by
 * `getTypeshadeDiagnostics` and by `getCompiledOutput`'s emit-failure diagnostic in
 * `service.ts`, so both shape a compiler diagnostic the same way.
 */
export function fromCompilerDiagnostic(
  sourceFile: ts.SourceFile,
  uri: string,
  diagnostic: TsCompilerDiagnostic,
): TypeshadeDiagnostic {
  const span = spanForDiagnostic(sourceFile, diagnostic);
  return {
    uri,
    span,
    range: rangeForSpan(sourceFile, span),
    severity: severityOfTypeshade(diagnostic.category),
    message: diagnostic.message,
    code: diagnostic.code ?? 'TS8099',
    source: 'typeshade',
  };
}

/**
 * Returns `sourceFile`'s TypeShade diagnostics from `analysis`, the front end's own analysis
 * of it (`compileTsSource` with `{ emit: false }`, run once per document version by
 * `service.ts` and shared with symbols, semantic tokens and hover, so `getDiagnostics` never
 * produces shader text and never lowers a document a second time for the same version, §8).
 * Mapped to `TypeshadeDiagnostic` with `source: 'typeshade'` and the `TS8xxx` codes from
 * `compiler/ts/codes.ts`.
 */
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
      .map((d) => fromCompilerDiagnostic(sourceFile, uri, d))
  );
}
