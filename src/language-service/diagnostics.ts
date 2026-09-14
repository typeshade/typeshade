// === TypeScript + TypeShade diagnostics, merged into one TypeshadeDiagnostic list (§5, §6) ===

import ts from 'typescript'
import type { CompileTsSourceResult, TsCompilerDiagnostic } from '../compiler/ts/source-file.js'
import { TS_CODES } from '../compiler/ts/codes.js'
import { GPU_BRAND_TAGS } from './ambient.js'
import { clampSpan, nodeAtPosition, rangeForSpan, spanForDiagnostic } from './positions.js'
import type { TypeshadeDiagnostic, TypeshadeSeverity } from './types.js'

/**
 * One TypeScript diagnostic code the ambient lib cannot silence, and the rule that decides
 * whether one occurrence of it is a real problem or the false positive §6 measured. Kept as one
 * table, per file, rather than scattered `if` statements, so every filtered code and its reason
 * is visible in one place.
 */
interface DiagnosticFilterRule {
  /** The numeric TypeScript diagnostic code this rule may drop. */
  readonly code: number
  /** Why this code is filtered here instead of by the ambient lib. */
  readonly reason: string
  /** Returns `true` when this specific occurrence is the known false positive and should be
   * dropped; `false` lets it through as a real diagnostic. */
  readonly when: (context: DiagnosticFilterContext, diagnostic: ts.Diagnostic) => boolean
}

/**
 * What a rule may consult about the document one diagnostic came from: the parsed source file,
 * and the program's type checker for the rules that decide from an expression's TYPE rather
 * than from the syntax alone (the vector and matrix arithmetic rules below). `checker` is
 * `undefined` only when the language service holds no program; a rule that cannot prove an
 * occurrence is the known false positive then leaves the diagnostic alone, so a missing
 * checker can only ever show more diagnostics, never hide one.
 */
interface DiagnosticFilterContext {
  readonly sourceFile: ts.SourceFile
  readonly checker: ts.TypeChecker | undefined
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
  return ts.isFunctionDeclaration(node) && node.parent !== undefined && ts.isSourceFile(node.parent)
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
  const pos = diagnostic.start ?? 0
  let node: ts.Node | undefined = nodeAtPosition(context.sourceFile, pos)
  while (node !== undefined && !ts.isDecorator(node)) node = node.parent
  if (node === undefined) return false
  const decorated = node.parent
  if (decorated === undefined) return false
  if (isTopLevelFunctionDeclaration(decorated)) return true
  if (ts.isParameter(decorated) && decorated.parent !== undefined) {
    return isTopLevelFunctionDeclaration(decorated.parent)
  }
  return false
}

/**
 * The escaped name TypeScript gives a property whose key is a unique symbol, for example
 * `__@vecTag@15`. The trailing number is that symbol's internal id, which moves with the
 * TypeScript version (`api-surface.test.ts` records the same hazard about its own snapshot),
 * so only the tag name between the two `@` is ever matched.
 */
const UNIQUE_SYMBOL_PROPERTY = /^__@(.+)@\d+$/

/** `GPU_BRAND_TAGS` as a set, for the per-property lookup in `isGpuBrandedType`. */
const GPU_BRAND_TAG_NAMES: ReadonlySet<string> = new Set(GPU_BRAND_TAGS)

/**
 * Whether `type` is one of the ambient lib's vector or matrix types, decided structurally: it
 * carries a property keyed by one of the unique symbols `GPU_BRAND_TAGS` names. Structural
 * rather than by type name because the checker hands back the resolved type (an intersection
 * of the brand with the swizzle members, printed as `VecOf<'f32', 3>`) rather than the `vec3`
 * a program spelled, and because a vector alias `ambient.ts` gains later is then covered with
 * no second list to keep in step. A union or intersection counts when any constituent does.
 */
function isGpuBrandedType(type: ts.Type): boolean {
  if (type.isUnionOrIntersection()) return type.types.some(isGpuBrandedType)
  return type.getProperties().some((property) => {
    const tag = UNIQUE_SYMBOL_PROPERTY.exec(property.getName())?.[1]
    return tag !== undefined && GPU_BRAND_TAG_NAMES.has(tag)
  })
}

/**
 * Whether `expression`'s type is an ambient vector or matrix. With no checker every rule that
 * decides from a type answers `false` and the diagnostic survives, per `DiagnosticFilterContext`.
 */
function isGpuExpression(context: DiagnosticFilterContext, expression: ts.Expression): boolean {
  if (context.checker === undefined) return false
  return isGpuBrandedType(context.checker.getTypeAtLocation(expression))
}

/**
 * The nearest binary expression enclosing `diagnostic`'s position, if any. Each caller then
 * checks that position against the operand its own code names, which is also what rejects the
 * unrelated enclosing binary expression this walk finds when the position is not inside an
 * operand at all.
 */
function binaryExpressionAt(
  context: DiagnosticFilterContext,
  diagnostic: ts.Diagnostic,
): ts.BinaryExpression | undefined {
  let node: ts.Node | undefined = nodeAtPosition(context.sourceFile, diagnostic.start ?? 0)
  while (node !== undefined) {
    if (ts.isBinaryExpression(node)) return node
    node = node.parent
  }
  return undefined
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
  diagnostic: ts.Diagnostic,
): ts.BinaryExpression | undefined {
  const pos = diagnostic.start ?? 0
  const end = pos + (diagnostic.length ?? 0)
  let node: ts.Node | undefined = nodeAtPosition(context.sourceFile, pos)
  while (node !== undefined) {
    if (ts.isBinaryExpression(node) && node.getStart() === pos && node.getEnd() === end) return node
    node = node.parent
  }
  return undefined
}

/** `+ - * / %` and their compound-assignment forms: the operators a vector or matrix operand
 * makes TypeScript give up on, and so the only ones `hasGpuArithmetic` accepts as the reason a
 * `number` turned up where a vector belongs. */
const ARITHMETIC_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
])

/** The unary forms of the same arithmetic: `-v`, `+v`, `v++`, `v--`. */
const ARITHMETIC_UNARY_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.PlusPlusToken,
  ts.SyntaxKind.MinusMinusToken,
])

/**
 * TS2362 points at the LEFT operand of an arithmetic operation whose type is not numeric, so
 * this drops it only when that operand is an ambient vector or matrix. `v * s`, `c.rgb * 0.5`,
 * `vec4(0.) * Math.PI`, `m * v` and `v *= 2.` are the arithmetic "use typeshade" is written in
 * and no ambient declaration can type them: a branded object type is not a `number`, and
 * un-branding the vectors to please this check would take every real vector check with it
 * (issue #21). Deciding per operand rather than "either operand is a vector" is what keeps
 * `v * "x"` red, through the TS2363 on the string.
 */
function isGpuLeftOperand(context: DiagnosticFilterContext, diagnostic: ts.Diagnostic): boolean {
  const binary = binaryExpressionAt(context, diagnostic)
  if (binary === undefined) return false
  const pos = diagnostic.start ?? 0
  if (pos < binary.left.getStart() || pos >= binary.operatorToken.getStart()) return false
  return isGpuExpression(context, binary.left)
}

/** TS2363 is TS2362 for the RIGHT operand (`m * v`'s vector, `2. * v`), and filtered the same
 * way: only when the operand the code points at is itself an ambient vector or matrix. */
function isGpuRightOperand(context: DiagnosticFilterContext, diagnostic: ts.Diagnostic): boolean {
  const binary = binaryExpressionAt(context, diagnostic)
  if (binary === undefined) return false
  const pos = diagnostic.start ?? 0
  if (pos < binary.right.getStart() || pos >= binary.right.getEnd()) return false
  return isGpuExpression(context, binary.right)
}

/**
 * TS2365 ("Operator '+' cannot be applied to types 'vec3' and 'vec3'") names both operands and
 * is reported on the whole expression, so either operand being an ambient vector or matrix is
 * what makes it the known false positive. `vec3(1.) + vec2(1.)` is dropped here too, and is not
 * thereby unreported: the compiler's own TYPE_MISMATCH (`TS8003`, "Vectors must have the same
 * size") is the authority on what combines with what, and leaving both would show the editor
 * two messages for one mistake. The operator has to be arithmetic as well: TS2365 is raised for
 * other operators too, and this rule claims only the arithmetic false positive, so a vector
 * operand alone is never reason enough to drop one. The operation asked about is the one the
 * code SPANS (see `binaryExpressionSpanning`), not the nearest one enclosing its start offset,
 * which for a left-nested product is a different operation entirely.
 */
function isGpuBinaryOperand(context: DiagnosticFilterContext, diagnostic: ts.Diagnostic): boolean {
  const binary = binaryExpressionSpanning(context, diagnostic)
  if (binary === undefined) return false
  if (!ARITHMETIC_OPERATORS.has(binary.operatorToken.kind)) return false
  return isGpuExpression(context, binary.left) || isGpuExpression(context, binary.right)
}

/**
 * Whether `node` does arithmetic on an ambient vector or matrix anywhere inside it. The whole
 * subtree is searched because the `number` such an operation produces spreads: in
 * `normalize(a * 2.)` the argument is already a `number` when the call's return type is
 * inferred, so the node TS2322 is reported on can sit several levels above the operation that
 * caused it.
 */
function hasGpuArithmetic(context: DiagnosticFilterContext, node: ts.Node): boolean {
  if (
    ts.isBinaryExpression(node) &&
    ARITHMETIC_OPERATORS.has(node.operatorToken.kind) &&
    (isGpuExpression(context, node.left) || isGpuExpression(context, node.right))
  ) {
    return true
  }
  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    ARITHMETIC_UNARY_OPERATORS.has(node.operator) &&
    isGpuExpression(context, node.operand)
  ) {
    return true
  }
  return (
    ts.forEachChild(node, (child) => (hasGpuArithmetic(context, child) ? true : undefined)) ?? false
  )
}

/**
 * The value TS2322 found unassignable, recovered from the syntax the code is reported on: the
 * `return` keyword of a return statement, the name of a variable declaration, the property name
 * of an object literal member, or the left-hand side of an assignment (`out[idx] = v * s`
 * included). Only a position ahead of the value itself is accepted, so a TS2322 raised inside
 * the value is never mistaken for one about the value.
 */
function assignedExpressionAt(
  context: DiagnosticFilterContext,
  diagnostic: ts.Diagnostic,
): ts.Expression | undefined {
  const pos = diagnostic.start ?? 0
  let node: ts.Node | undefined = nodeAtPosition(context.sourceFile, pos)
  while (node !== undefined) {
    if (ts.isReturnStatement(node)) return node.expression
    if (ts.isVariableDeclaration(node)) {
      const initializer = node.initializer
      return initializer !== undefined && pos < initializer.getStart() ? initializer : undefined
    }
    if (ts.isPropertyAssignment(node)) {
      return pos < node.initializer.getStart() ? node.initializer : undefined
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      return pos < node.operatorToken.getStart() ? node.right : undefined
    }
    node = node.parent
  }
  return undefined
}

/**
 * TS2322 ("Type 'number' is not assignable to type 'vec3'") in a position that wants a vector
 * or matrix. Dropped only when the TARGET is an ambient vector or matrix and the value either
 * is one too or contains vector or matrix arithmetic, because arithmetic is the only thing that
 * makes the checker wrong here: `v * s` is typed `number`, so the `vec3` return annotation, the
 * `vec3` local, the `vec3` field or the `vec3` assignment target it flows into reports a
 * mismatch the compiler accepts. `let n: f32 = v` therefore keeps its TS2322: a scalar target is
 * a `number` to TypeScript, so nothing about that mismatch is the brand's doing. When target and
 * value are both vectors of the wrong shapes for each other, the compiler's own TYPE_MISMATCH
 * is the message the editor shows, as it is for TS2365.
 */
function isGpuArithmeticAssignment(
  context: DiagnosticFilterContext,
  diagnostic: ts.Diagnostic,
): boolean {
  const checker = context.checker
  if (checker === undefined) return false
  const value = assignedExpressionAt(context, diagnostic)
  if (value === undefined) return false
  const target = checker.getContextualType(value)
  if (target === undefined || !isGpuBrandedType(target)) return false
  return isGpuExpression(context, value) || hasGpuArithmetic(context, value)
}

/**
 * The argument of a call expression one diagnostic is reported on, with the call and the
 * argument's index, so a rule can ask what the callee wanted in that position.
 */
interface ArgumentPosition {
  readonly call: ts.CallExpression
  readonly index: number
  readonly argument: ts.Expression
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
  diagnostic: ts.Diagnostic,
): ArgumentPosition | undefined {
  const pos = diagnostic.start ?? 0
  const end = pos + (diagnostic.length ?? 0)
  let node: ts.Node | undefined = nodeAtPosition(context.sourceFile, pos)
  while (node !== undefined) {
    const parent: ts.Node | undefined = node.parent
    if (parent !== undefined && ts.isCallExpression(parent) && node.getStart() === pos) {
      const index = parent.arguments.indexOf(node as ts.Expression)
      if (index >= 0 && node.getEnd() === end) {
        return { call: parent, index, argument: node as ts.Expression }
      }
    }
    node = parent
  }
  return undefined
}

/** Whether `symbol` is a signature's rest parameter (`...args: T[]`), read from its own
 * declaration rather than from the parameter's position in the list. */
function isRestParameter(symbol: ts.Symbol): boolean {
  const declaration = symbol.valueDeclaration
  return (
    declaration !== undefined &&
    ts.isParameter(declaration) &&
    declaration.dotDotDotToken !== undefined
  )
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
  const parameters = signature.getParameters()
  const last = parameters[parameters.length - 1]
  const symbol =
    parameters[index] ?? (last !== undefined && isRestParameter(last) ? last : undefined)
  if (symbol === undefined) return undefined
  const type = checker.getTypeOfSymbolAtLocation(symbol, location)
  if (!isRestParameter(symbol)) return type
  return checker.getIndexTypeOfType(type, ts.IndexKind.Number) ?? type
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
  const { call, index } = position
  const types: ts.Type[] = []
  if (resolved !== undefined) {
    const type = parameterTypeOfSignature(checker, resolved, index, call)
    if (type !== undefined) types.push(type)
  }
  const overloads = checker.getTypeAtLocation(call.expression).getCallSignatures()
  if (overloads.length > 1 && (resolved === undefined || !overloads.includes(resolved))) {
    for (const overload of overloads) {
      const type = parameterTypeOfSignature(checker, overload, index, call)
      if (type !== undefined) types.push(type)
    }
  }
  return types
}

/**
 * Whether the parameter `position` lands on is INFERRED from the call's own arguments, that is,
 * whether the signature declares it as one of its own type parameters (`dot<T extends Numeric>`,
 * `hypot<T>(...args: T[])`). Such a position has no fixed type to compare against: it is
 * whatever the checker inferred from the arguments, so one argument's type decides the type
 * every other argument is then checked against.
 */
function isInferredParameter(
  checker: ts.TypeChecker,
  position: ArgumentPosition,
  signature: ts.Signature,
): boolean {
  const declaration = signature.getDeclaration() as ts.SignatureDeclaration | undefined
  if (declaration === undefined) return false
  const parameters = declaration.parameters
  const last = parameters[parameters.length - 1]
  const parameter =
    parameters[position.index] ??
    (last !== undefined && last.dotDotDotToken !== undefined ? last : undefined)
  const declared = parameter?.type
  if (declared === undefined) return false
  const node =
    parameter.dotDotDotToken !== undefined && ts.isArrayTypeNode(declared)
      ? declared.elementType
      : declared
  return (checker.getTypeAtLocation(node).flags & ts.TypeFlags.TypeParameter) !== 0
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
  const keys = new Set<string>()
  const collect = (candidate: ts.Type): void => {
    if (candidate.isUnion()) {
      for (const constituent of candidate.types) collect(constituent)
      return
    }
    for (const property of candidate.getProperties()) {
      const tag = UNIQUE_SYMBOL_PROPERTY.exec(property.getName())?.[1]
      if (tag === undefined || !GPU_BRAND_TAG_NAMES.has(tag)) continue
      const brand = checker.getTypeOfSymbolAtLocation(property, location)
      keys.add(`${tag}:${checker.typeToString(brand)}`)
    }
  }
  collect(type)
  return keys
}

/** The one brand shape `expression`'s own type carries, or `undefined` when it carries none (a
 * `number`, an `f32`, the `number` a product is typed) or more than one. */
function gpuShapeOfExpression(
  context: DiagnosticFilterContext,
  expression: ts.Expression,
): string | undefined {
  const checker = context.checker
  if (checker === undefined) return undefined
  const keys = gpuShapeKeysOfType(checker, checker.getTypeAtLocation(expression), expression)
  return keys.size === 1 ? [...keys][0] : undefined
}

/** `matTag:` keys, so `gpuArithmeticShape` can tell a matrix operand from a vector one. */
const MATRIX_SHAPE_PREFIX = 'matTag:'

/** The shape an arithmetic operation produces from its operands' shapes. A matrix times a
 * vector is a VECTOR (`m * c` is the `vec4` every camera example ends with), so the vector
 * operand wins; anything else keeps the branded operand it has. */
function gpuOperationShape(
  left: string | undefined,
  right: string | undefined,
): string | undefined {
  if (left === undefined || right === undefined) return left ?? right
  if (left.startsWith(MATRIX_SHAPE_PREFIX) && !right.startsWith(MATRIX_SHAPE_PREFIX)) return right
  return left
}

/**
 * The shape the vector or matrix arithmetic inside `node` would have produced if the brand had
 * survived it: what `hasGpuArithmetic` finds, answered with a shape instead of a yes. The walk
 * takes the OUTERMOST such operation, because that is the value the call receives:
 * `u.tint.rgb * (vo.uv.y * u.gain)` is a `vec3`, decided by its own operands, not by the scalar
 * product nested in its right-hand side.
 */
function gpuArithmeticShape(context: DiagnosticFilterContext, node: ts.Node): string | undefined {
  if (ts.isBinaryExpression(node) && ARITHMETIC_OPERATORS.has(node.operatorToken.kind)) {
    const shape = gpuOperationShape(
      gpuShapeOfExpression(context, node.left),
      gpuShapeOfExpression(context, node.right),
    )
    if (shape !== undefined) return shape
  }
  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    ARITHMETIC_UNARY_OPERATORS.has(node.operator)
  ) {
    const shape = gpuShapeOfExpression(context, node.operand)
    if (shape !== undefined) return shape
  }
  return ts.forEachChild(node, (child) => gpuArithmeticShape(context, child))
}

/** The shape a value would have if arithmetic kept the brand: its own, or the one the
 * arithmetic inside it produced. `undefined` for a value that is not about vectors at all. */
function gpuValueShape(
  context: DiagnosticFilterContext,
  expression: ts.Expression,
): string | undefined {
  return gpuShapeOfExpression(context, expression) ?? gpuArithmeticShape(context, expression)
}

/** Every brand shape the parameter at `position` accepts, across the signatures
 * `parameterTypesAt` considers. Empty when that parameter is not a vector or matrix position:
 * an `f32`, or a type parameter the arguments have already poisoned to `number`. */
function parameterShapesAt(
  checker: ts.TypeChecker,
  position: ArgumentPosition,
  resolved: ts.Signature | undefined,
): ReadonlySet<string> {
  const keys = new Set<string>()
  for (const type of parameterTypesAt(checker, position, resolved)) {
    for (const key of gpuShapeKeysOfType(checker, type, position.call)) keys.add(key)
  }
  return keys
}

/**
 * Whether every OTHER argument of the call still fits where it sits, measured with the brand
 * arithmetic erased put back. TypeScript checks a call's arguments in order and reports only the
 * FIRST that fails, so dropping this one hides every later argument's mismatch with it: without
 * this check `cross(a * 2., b)` with a `vec2` `b` goes completely silent, and the front end has
 * no argument check for the ambient math functions to speak in TypeScript's place.
 *
 * A sibling in an INFERRED position is measured against `shape`, since a type parameter is one
 * type for the whole call and `shape` is what this argument settles it to; one in a fixed
 * position is measured against the shapes its own parameter declares. A sibling that carries no
 * shape at all (a literal, an `f32`, a string) is left alone: it is not this rule's business,
 * and TypeScript reports it on its own once the arithmetic stops hiding it.
 */
function otherArgumentsFit(
  context: DiagnosticFilterContext,
  checker: ts.TypeChecker,
  position: ArgumentPosition,
  resolved: ts.Signature | undefined,
  shape: string,
): boolean {
  return position.call.arguments.every((argument, index) => {
    if (index === position.index) return true
    const other = gpuValueShape(context, argument)
    if (other === undefined) return true
    const at: ArgumentPosition = { call: position.call, index, argument }
    if (resolved !== undefined && isInferredParameter(checker, at, resolved)) return other === shape
    const declared = parameterShapesAt(checker, at, resolved)
    return declared.size === 0 || declared.has(other)
  })
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
  const checker = context.checker
  if (checker === undefined) return false
  const position = argumentAt(context, diagnostic)
  if (position === undefined) return false
  const shape = gpuValueShape(context, position.argument)
  if (shape === undefined) return false
  const resolved = checker.getResolvedSignature(position.call)
  if (
    hasGpuArithmetic(context, position.argument) &&
    parameterShapesAt(checker, position, resolved).has(shape)
  ) {
    return otherArgumentsFit(context, checker, position, resolved, shape)
  }
  if (!isGpuExpression(context, position.argument)) return false
  if (resolved === undefined || !isInferredParameter(checker, position, resolved)) return false
  const poisoned = position.call.arguments.some(
    (argument, index) =>
      index !== position.index &&
      hasGpuArithmetic(context, argument) &&
      gpuArithmeticShape(context, argument) === shape,
  )
  return poisoned && otherArgumentsFit(context, checker, position, resolved, shape)
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
      'types, so `1 * "x"` and the string in `v * "x"` stay red. Issue #21, design doc §6.',
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
      'vectors reports this, not TS2362). Dropped when the operator is arithmetic and either ' +
      "operand is a branded vector or matrix; the compiler's own TYPE_MISMATCH stays the " +
      'authority on which shapes combine, so a real `vec3(1.) + vec2(1.)` is reported once, by ' +
      '`TS8003`, instead of twice. TS2365 from any other operator is left alone.',
    when: isGpuBinaryOperand,
  },
  {
    code: 2322,
    reason:
      'The knock-on of the three above: vector arithmetic is typed `number`, so the `vec3` ' +
      'return, local, field or assignment target it flows into looks unassignable. Dropped ' +
      'only when the target is a branded vector or matrix AND the value is one too or does ' +
      'vector or matrix arithmetic, so `let n: f32 = v` (a scalar target) still reports.',
    when: isGpuArithmeticAssignment,
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
]

function isFiltered(context: DiagnosticFilterContext, diagnostic: ts.Diagnostic): boolean {
  return TS_DIAGNOSTIC_FILTERS.some(
    (rule) => rule.code === diagnostic.code && rule.when(context, diagnostic),
  )
}

function severityOfTs(category: ts.DiagnosticCategory): TypeshadeSeverity {
  switch (category) {
    case ts.DiagnosticCategory.Error:
      return 'error'
    case ts.DiagnosticCategory.Warning:
      return 'warning'
    case ts.DiagnosticCategory.Suggestion:
      return 'hint'
    default:
      return 'information'
  }
}

function severityOfTypeshade(category: 'error' | 'warning' | 'message'): TypeshadeSeverity {
  return category === 'message' ? 'information' : category
}

function toTypeshadeDiagnostic(
  uri: string,
  sourceFile: ts.SourceFile,
  diagnostic: ts.Diagnostic,
): TypeshadeDiagnostic {
  const span = clampSpan(sourceFile, diagnostic.start ?? 0, diagnostic.length ?? 0)
  return {
    uri,
    span,
    range: rangeForSpan(sourceFile, span),
    severity: severityOfTs(diagnostic.category),
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    code: diagnostic.code,
    source: 'typescript',
  }
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
  ]
  const context: DiagnosticFilterContext = {
    sourceFile,
    checker: languageService.getProgram()?.getTypeChecker(),
  }
  return raw
    .filter((d) => !isFiltered(context, d))
    .map((d) => toTypeshadeDiagnostic(uri, sourceFile, d))
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
  const span = spanForDiagnostic(sourceFile, diagnostic)
  return {
    uri,
    span,
    range: rangeForSpan(sourceFile, span),
    severity: severityOfTypeshade(diagnostic.category),
    message: diagnostic.message,
    code: diagnostic.code ?? 'TS8099',
    source: 'typeshade',
  }
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
  )
}
