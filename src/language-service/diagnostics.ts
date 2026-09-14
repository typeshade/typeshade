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
 * operand alone is never reason enough to drop one.
 */
function isGpuBinaryOperand(context: DiagnosticFilterContext, diagnostic: ts.Diagnostic): boolean {
  const binary = binaryExpressionAt(context, diagnostic)
  if (binary === undefined || binary.getStart() !== (diagnostic.start ?? 0)) return false
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
