// === Expression lowering ===
//
// Implements: Rule 7.4 (docs/language-design.md; traced in reqs/).
import {
  carriedOf,
  isUndecidedRead,
  markInferredRead,
  noteDemand,
  quietDemands,
  softDemands,
} from '../use-inference.js';
import {
  carriedByCall,
  abstractLiteralOf,
  genericDivisionRemedy,
  isAbstractRead,
  isIntegerWrittenRead,
  markAbstractRead,
  markCarriedRead,
  noteAbstractDivision,
  noteCheckedRefusal,
  noteZeroDivision,
  noteWrittenDivision,
  noteWrittenDivisionRead,
  noteForcedRead,
  readTypeFor,
} from '../abstract-const.js';
import { logicalTypeKey as typeKey } from '../optional.js';
import ts from 'typescript';
import type { Expr, BinOp, CmpOp, LogOp } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { f32T, boolT, i32T, u32T, isF64, isVec64 } from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { authorTypeText, dropsRecoveredUse, irNameOf, type LoweringScope } from '../context.js';
import { LANG_CONST, resolveLangConst, resolveMathConst } from '../math-alias.js';
import { mathBindingOf } from '../math-binding.js';
import { removedConstantSentence } from '../removed-names.js';
import { refusedBySemantics } from '../semantic.js';
import {
  constF32OutOfRange,
  constShiftAmountOutOfRange,
  foldConstComponents,
  foldConstNumber,
} from '../loop-bound.js';
import {
  broadcastResultType,
  f64WidenResultType,
  numericMismatch,
  retargetLit,
} from '../numeric.js';
import {
  foldNumericLit,
  isIntegerLiteralTree,
  isKindlessBitwise,
  isKindlessModuleConst,
  kindlessOrigin,
  kindlessReadings,
  statesType,
  foldKindless,
  markKindlessLeaf,
  noteKindlessDivision,
  noteKindlessRefusal,
  replaceRefusal,
  type RefusalCell,
  retractKindlessRefusal,
  integerQuotientAt,
  isIntegerQuotient,
  readKindlessExactly,
  markIntegerQuotient,
  markQuotientRead,
  retractOperandRefusals,
  intLiteralRangeMessage,
  retargetIntLitCtx,
  shiftAmountMessage,
} from '../lit-coerce.js';
import { foldF64ModuleConst } from '../module-const-f64.js';
import { libraryNameSentence, mapTsTypeToShaderType, writesRefusedType } from '../type-map.js';
import { lowerIndex, lowerSelect, matVecMul } from './index-select.js';
import { lowerArrayLiteral, refuseListSpread } from './expression-array.js';
import { refuseBareAtomic } from './atomics.js';
import { builtinCalleeNames, lowerCall } from './expression-call.js';
import { declarationOf } from './closures.js';
import { lowerNew, lowerThis } from './class-methods.js';
import { notAValueSentence } from './new-target.js';
import { lowerObjectLiteral, lowerPropertyAccess } from './expression-prop.js';
import { makeDiagnostic } from '../diagnostic.js';
import { withSpan } from '../span.js';
import { workgroupStageMessage } from '../stage-restrictions.js';
import { TS_CODES, type TsCode } from '../codes.js';
import { refuseIdentityKind, refuseNegationKind, refuseOperatorKind } from './operator-kinds.js';
import { unknownNameAlreadyReported } from '../refused-names.js';
import { recordLoweredExpression } from '../symbols.js';
import { namesInScope, unknownNameSentence, type NameScopes } from '../unknown-names.js';
import { readonlyClassUpcast } from '../class-upcasts.js';
import { f32RangeSentence, refuseConstCall } from './const-call.js';
import { keyTypeText, keysOf, sameKeys } from '../key-types.js';
import { isOptional, optionalInner, presentOf } from '../optional.js';
import {
  lowerNullish,
  lowerOptionalEquality,
  lowerOptionalOperand,
  lowerOptionalRead,
  lowerUndefinedTest,
  lowerUndefinedValue,
  convertOptional,
  noteValueType,
  optionalConditionSentence,
  refuseNonNull,
  refuseOptionalUse,
  refuseOptionalWhereInnerWanted,
} from './optional-values.js';

const ARITH: Readonly<Record<number, BinOp>> = {
  [ts.SyntaxKind.PlusToken]: '+',
  [ts.SyntaxKind.MinusToken]: '-',
  [ts.SyntaxKind.AsteriskToken]: '*',
  [ts.SyntaxKind.SlashToken]: '/',
  [ts.SyntaxKind.PercentToken]: '%',
};
/** The largest finite f32, `(2 - 2^-23) * 2^127`. A literal past it has no f32 to be. */
const MAX_F32 = 3.4028234663852886e38;

const BITWISE: Readonly<Record<number, BinOp>> = {
  [ts.SyntaxKind.AmpersandToken]: '&',
  [ts.SyntaxKind.BarToken]: '|',
  [ts.SyntaxKind.CaretToken]: '^',
  [ts.SyntaxKind.LessThanLessThanToken]: '<<',
  [ts.SyntaxKind.GreaterThanGreaterThanToken]: '>>',
};
const LOGICAL: Readonly<Record<number, LogOp>> = {
  [ts.SyntaxKind.AmpersandAmpersandToken]: '&&',
  [ts.SyntaxKind.BarBarToken]: '||',
};
const EQUALITY_OPS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);
const COMPARE: Readonly<Record<number, CmpOp>> = {
  [ts.SyntaxKind.LessThanToken]: '<',
  [ts.SyntaxKind.GreaterThanToken]: '>',
  [ts.SyntaxKind.LessThanEqualsToken]: '<=',
  [ts.SyntaxKind.GreaterThanEqualsToken]: '>=',
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: '==',
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]: '!=',
  [ts.SyntaxKind.EqualsEqualsToken]: '==',
  [ts.SyntaxKind.ExclamationEqualsToken]: '!=',
};

/**
 * Lower one TypeScript expression.
 *
 * `contextual` is the type the POSITION declares, when it declares one: a function's return
 * type, a `let`/`const` annotation, or a parameter type. Object and array literals read it
 * to determine their composite type (#8 A11); a derived class value may take its proven
 * read-only base representation. Other shapes ignore it, which is why it is optional rather
 * than a parameter threaded through the whole walk. A caller that has no type to offer passes
 * nothing and gets the behaviour it always had.
 */
/** `x as T`, `<T>x` and `x satisfies T`: the operand, lowered against the claimed type when
 *  that type is one this surface knows, since the claim is the contextual type TypeScript
 *  gives it. `as const` claims no type of its own and is the operand unchanged.
 *
 *  A claim that names a type the operand does not have is refused: `as` and `satisfies` emit
 *  nothing, so the value would travel under a name it does not have, and the conversion the
 *  author meant has a spelling of its own. */
function lowerTypeClaim(
  node: ts.Expression,
  typeNode: ts.TypeNode,
  keyword: 'as' | 'satisfies',
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  contextual: ShaderType | undefined,
): Expr | undefined {
  const operand = (node as ts.AsExpression | ts.SatisfiesExpression | ts.TypeAssertion).expression;
  // `as const` is a literal's own type and names nothing this surface maps.
  const isConst =
    ts.isTypeReferenceNode(typeNode) &&
    ts.isIdentifier(typeNode.typeName) &&
    typeNode.typeName.text === 'const';
  const claimed = isConst ? undefined : mapTsTypeToShaderType(typeNode, sourceFile, /* quiet */ []);
  // A claim of a generic interface or alias, `{ x: a } as G<f32>`, names a declaration refused
  // where it is written, which said why; the operand, built for it, adds nothing (Rule 12.4).
  if (claimed === undefined && writesRefusedType(typeNode, sourceFile)) return undefined;
  const lowered = lowerExpression(operand, sourceFile, scope, diagnostics, claimed ?? contextual);
  if (!lowered || claimed === undefined) return lowered;
  if (typeKey(lowered.type) !== typeKey(claimed)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${keyword}" states a type, it does not convert: "${node.getText(sourceFile)}" is ` +
        `${authorTypeText(lowered.type)}, not ${typeNode.getText(sourceFile)}. Write ` +
        `${typeNode.getText(sourceFile)}(...) to convert, or drop the "${keyword}".`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  return lowered;
}

export function lowerExpression(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  contextual?: ShaderType,
): Expr | undefined {
  // A number where a key type is expected is no member of it (change 0081), though a literal
  // would take the u32 the key is held as.
  if (keysOf(contextual) !== undefined && isNumberLiteral(skipParens(node))) {
    pushDiag(
      diagnostics,
      sourceFile,
      placeOf(node),
      keyMismatchSentence(node.getText(sourceFile), contextual!, undefined),
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  let value = lowerExpressionNode(node, sourceFile, scope, diagnostics, contextual);
  // A call of a function, a method or a getter that writes no result type and returns a value
  // that comes from a constant of no fixed type carries that origin (Amendment A3 of 0134).
  if (value?.op === 'call')
    markCarriedRead(value, skipParens(node), carriedByCall(sourceFile, value.fn));
  // What the expression gave as written, before the position wraps it (change 0088).
  if (value !== undefined) noteValueType(node, value.type);
  // An optional nothing narrowed, where the position wants its `T`: the test to write, in
  // TypeScript's TS2322 place (Rule 7.10, change 0093).
  if (refuseOptionalWhereInnerWanted(value, node, contextual, sourceFile, diagnostics))
    return undefined;
  if (value !== undefined && keysDisagree(contextual, value.type)) {
    pushDiag(
      diagnostics,
      sourceFile,
      placeOf(node),
      keyMismatchSentence(node.getText(sourceFile), contextual!, value.type),
      TS_CODES.TYPE_MISMATCH,
    );
    value = undefined;
  }
  let lowered =
    value === undefined ? undefined : readonlyClassUpcast(value, contextual, scope, sourceFile);
  // Every expression goes through here, so this one line is the whole of the expression table
  // an editor is held to (`symbols.ts`, 0015). A refused expression records nothing.
  // A representation conversion does not change the source expression's concrete type.
  if (value !== undefined) recordLoweredExpression(sourceFile, node, value.type);
  // A `T` written where a `T | undefined` is expected is present (Rule 7.10, change 0088): the
  // value and `true`. An integer literal takes the `T` first, as it takes a declared i32.
  const inner = optionalInner(contextual);
  if (lowered !== undefined && inner !== undefined) {
    const fitted = retargetIntLitCtx(lowered, node, inner);
    if (typeKey(fitted.type) === typeKey(inner)) lowered = presentOf(contextual!, fitted);
    else if (isOptional(lowered.type))
      lowered = convertOptional(lowered, contextual!, node, sourceFile, scope, diagnostics);
  }
  return lowered;
}

function lowerExpressionNode(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  contextual?: ShaderType,
): Expr | undefined {
  // A call a chain already ran as a statement stands for the object it handed back (chains.ts).
  const alias = scope.chainAlias(node);
  if (alias !== undefined) return alias();
  if (ts.isParenthesizedExpression(node))
    return lowerExpression(node.expression, sourceFile, scope, diagnostics, contextual);
  if (ts.isIdentifier(node))
    return lowerIdentifier(node, sourceFile, scope, diagnostics, contextual);
  // An object literal, a list and a type claim read the `T` of a `T | undefined` position; the
  // position wraps what they build (change 0088).
  const innerCtx = optionalInner(contextual) ?? contextual;
  if (node.kind === ts.SyntaxKind.NullKeyword)
    return lowerUndefinedValue(node, contextual, sourceFile, scope, diagnostics);
  // `this` and `new` belong to a class with members (#86): the method's object, and the
  // class's constructor function.
  if (node.kind === ts.SyntaxKind.ThisKeyword)
    return lowerThis(node, sourceFile, scope, diagnostics);
  if (ts.isNewExpression(node)) return lowerNew(node, sourceFile, scope, diagnostics);
  if (ts.isNumericLiteral(node)) {
    const v = Number(node.text);
    // A decimal float literal that overflows f32 is a shader-creation error in WGSL and
    // implementation-defined in GLSL ES 3.00 (§52). `1e40` reached the writer, which printed
    // `1e+40` — a value f32 cannot hold, so the shader ran on a number nobody wrote. An
    // Magnitude alone decides, with no "is it integer-written" test: `1e40` IS a whole
    // number to JavaScript, and the integer kinds a literal can be retargeted to bound at
    // ±2^31 and 2^32, far below this. So a value past the f32 range has no target type at
    // all, and `lit-coerce.ts`'s own bound check never sees it.
    if (Number.isFinite(v) && Math.abs(v) > MAX_F32) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `${node.text} is outside the range of f32 (about ±3.4e38), and there is no wider ` +
          `type here for it to take.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    return { op: 'lit', type: f32T, value: v };
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { op: 'lit', type: boolT, value: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { op: 'lit', type: boolT, value: false };
  if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
    if (
      node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken
    ) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        '++/-- is a statement, not a value.',
        TS_CODES.UNSUPPORTED,
      );
      return undefined;
    }
    if (ts.isPrefixUnaryExpression(node))
      return lowerPrefixUnary(node, sourceFile, scope, diagnostics);
  }
  if (ts.isObjectLiteralExpression(node))
    return lowerObjectLiteral(node, sourceFile, scope, diagnostics, innerCtx);
  if (ts.isBinaryExpression(node))
    return lowerBinary(node, sourceFile, scope, diagnostics, contextual);
  // TypeScript's type-level shapes (roadmap 0.3 item T7, #92). `x as T`, `<T>x`,
  // `x as const`, `x satisfies T` and `x!` are claims about a type, not conversions: each
  // emits exactly what its operand emits, which is what it does in TypeScript. A developer
  // writes them without thinking, and before this every one was
  // "TS8099 Unsupported expression".
  //
  // An assertion that names a DIFFERENT shader type is the one shape that does not pass, and
  // for the reason the rule gives: `0.5 as i32` would have to emit a conversion, and `as`
  // emits nothing, so a silent f32 would travel under an i32's name.
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
    return lowerTypeClaim(node, node.type, 'as', sourceFile, scope, diagnostics, innerCtx);
  }
  if (ts.isSatisfiesExpression(node)) {
    return lowerTypeClaim(node, node.type, 'satisfies', sourceFile, scope, diagnostics, innerCtx);
  }
  if (ts.isNonNullExpression(node)) {
    // `v!` on an optional is refused (Rule 7.10, decision D6); on anything else it is its operand.
    if (refuseNonNull(node, scope, sourceFile, diagnostics)) return undefined;
    return lowerExpression(node.expression, sourceFile, scope, diagnostics, contextual);
  }
  if (ts.isCallExpression(node)) {
    // `import("./x")` and `require("./x")` are semantic.ts's TS8072, the call's one sentence
    // (Rule 12.4): what it is called with is there only because the call is.
    if (refusedBySemantics(node)) return undefined;
    const call = lowerCall(node, sourceFile, scope, diagnostics);
    // The one expression kind that carries a span in this increment: stepping into a helper
    // has to tell two calls in one statement apart. A call that lowered to something else —
    // an intrinsic the front end expands, a constructor — keeps no span, since the node it
    // produced is no longer a call site.
    return call?.op === 'call' ? withSpan(call, sourceFile, node) : call;
  }
  if (ts.isPropertyAccessExpression(node))
    return lowerPropertyAccess(node, sourceFile, scope, diagnostics);
  if (ts.isElementAccessExpression(node)) return lowerIndex(node, sourceFile, scope, diagnostics);
  if (ts.isConditionalExpression(node))
    return lowerSelect(node, sourceFile, scope, diagnostics, contextual);
  if (ts.isArrayLiteralExpression(node)) {
    // A list is lowered against a declared `array<T, N>` (#8 A16), which a declaration gives
    // it — and so does any other position that declares one: a return whose function is
    // declared `array<f32, 2>`, an argument whose parameter is, a field of a struct being
    // built. Those are exactly the positions a tuple is written in (roadmap 0.3 item T10,
    // #92), and each already carries its declared type here as `contextual`.
    if (innerCtx?.kind === 'array') {
      return lowerArrayLiteral(node, innerCtx, sourceFile, scope, diagnostics);
    }
    // A spread is the list's one sentence, and counting `[...a, 1.]` as two elements would name
    // an arity the author never wrote (Rule 12.4).
    if (refuseListSpread(node, sourceFile, scope, diagnostics)) return undefined;
    // With no type declared anywhere there is nothing to fill, so say which spelling does work
    // rather than repeating the generic "Unsupported expression".
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `A list takes its type from the position it is written in: declare one, as "const xs: array<T, ${node.elements.length}> = [...]" or a return type, or call array<T, ${node.elements.length}>(...) here.`,
      TS_CODES.UNSUPPORTED,
    );
    return undefined;
  }
  // `super` on its own (roadmap 0.3 item T5, #92). `super(...)`, `super.m(...)` and `super.x`
  // are lowered where the call and the member access are (Rules 8.10, 8.11, 8.13); what reaches
  // here is `super` as a value or under a computed `super[k]`, which names no member the
  // collector could lower a base's body for.
  if (node.kind === ts.SyntaxKind.SuperKeyword) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"super" reaches a member of the class above by its name, "super.m(...)" or "super.x"; ` +
        `as a value, or under a computed "super[k]", it names nothing to call or read.`,
      TS_CODES.UNSUPPORTED,
    );
    return undefined;
  }
  // `await x`, `yield`, a template string and a spread argument are semantic.ts's refusals
  // (TS8013), each with its reason, and one mistake reads as one diagnostic (Rule 12.4).
  if (refusedBySemantics(node)) return undefined;
  // A string literal where a key type is expected is its id (change 0081, Rule 7.8).
  if (ts.isStringLiteralLike(node) && keysOf(contextual) !== undefined) {
    return keyLiteral(node, contextual!, sourceFile, diagnostics);
  }
  if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `A string has no GPU representation: there is nothing for it to be at run time, and no ` +
        `instruction takes one. Text that picks between cases is a key type, a union of string ` +
        `literals the GPU holds as ids, or an enum; text a human reads belongs on the host.`,
      TS_CODES.UNSUPPORTED,
    );
    return undefined;
  }
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `Unsupported expression "${node.getText(sourceFile)}".`,
    TS_CODES.UNSUPPORTED,
  );
  return undefined;
}

/** Whether `decl`, what the file declares under a name where it is read, declares a VALUE of
 *  that name: anything {@link declarationOf} finds but a namespace that holds only types, which
 *  TypeScript does not instantiate. An interface and a type alias declare no value and are not
 *  found at all. */
function declaresValue(decl: ts.Node | undefined): boolean {
  if (decl === undefined) return false;
  if (!ts.isModuleDeclaration(decl)) return true;
  const body = decl.body;
  if (body === undefined) return false;
  if (ts.isModuleDeclaration(body)) return declaresValue(body);
  if (!ts.isModuleBlock(body)) return false;
  return body.statements.some(
    (st) =>
      !ts.isInterfaceDeclaration(st) &&
      !ts.isTypeAliasDeclaration(st) &&
      (!ts.isModuleDeclaration(st) || declaresValue(st)),
  );
}

/** The two operators that ask what a value is at run time, and why neither can (roadmap 0.3
 *  item T10, #92). Both are read before the operands are lowered. */
const RUNTIME_TYPE_TEST: Readonly<Partial<Record<ts.SyntaxKind, string>>> = {
  [ts.SyntaxKind.InstanceOfKeyword]:
    '"instanceof" asks what a value is at run time. A struct on the GPU is its fields and ' +
    'nothing else — no type tag to read — and every call this file emits is resolved at ' +
    'compile time, so a base-typed value is its base. Give the struct a field saying which ' +
    'kind it holds, and branch on that.',
  [ts.SyntaxKind.InKeyword]:
    '"in" asks which fields a value has at run time. A struct on the GPU has exactly the ' +
    'fields its type declares, known at compile time, so the answer is already in the type: ' +
    'write the field access.',
};

/** The builtin values a name may be meant as: the language constants, `Math` and `console`, and
 *  every builtin function, which TypeScript's own suggestion offers for a value too. */
let builtinValues: readonly string[] | undefined;
export const builtinValueNames = (): readonly string[] =>
  (builtinValues ??= [...Object.keys(LANG_CONST), 'Math', 'console', ...builtinCalleeNames()]);

/** The candidates for a misspelled value where `node` is written: the names in scope there,
 *  innermost first, then the builtins. */
export const valueScopes = (node: ts.Node): NameScopes => [
  ...namesInScope(node, 'value'),
  builtinValueNames(),
];

/** The sentence for a value read that names no binding: what a name the library declares is
 *  where the file declares nothing of it (`Number`, `Math`), what a name the file declares is
 *  when it is an enum, a namespace, a class or a type ({@link notAValueSentence}), else {@link
 *  unknownIdentifierSentence}'s (Rule 2.1, Rule 12.1). Undefined where the declaration's own
 *  refusal already said it: an enum inside a namespace (Rule 12.4). */
export function unknownValueSentence(node: ts.Identifier): string | undefined {
  const library =
    declarationOf(node) === undefined ? libraryNameSentence(node.text, 'value') : undefined;
  if (library !== undefined) return library;
  const what = notAValueSentence(node, node.getSourceFile());
  // Null: the declaration's own refusal is the one diagnostic (Rule 12.4).
  if (what === null) return undefined;
  return what ?? unknownIdentifierSentence(node, `Unknown identifier "${node.text}".`);
}

/**
 * The sentence for an identifier that names no binding, `mistake` followed by its remedy
 * (Rule 12.1): TypeShade's spelling of a GLSL or HLSL name, or the name in scope a misspelled
 * one is spelled like. A name the file declares is not misspelled, and a spelling guess would
 * send the author to another name: when its declaration is further down the same scope, the
 * mistake is the order, which is TypeScript's TS2448 too, and the sentence says so.
 */
export function unknownIdentifierSentence(node: ts.Identifier, mistake: string): string {
  const declared = declarationOf(node);
  if (declared === undefined) return unknownNameSentence(mistake, node.text, valueScopes(node));
  if (
    (ts.isVariableDeclaration(declared) || ts.isBindingElement(declared)) &&
    declared.getStart() > node.getStart()
  ) {
    return `"${node.text}" is read before its declaration. Declare it above this line.`;
  }
  return mistake;
}

function lowerIdentifier(
  node: ts.Identifier,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  contextual?: ShaderType,
): Expr | undefined {
  // A name a `const` binds to a `Math` member: the member's inlined literal, or a function alias
  // that only a call may name (Rule 9.4, change 0113). The declaration TypeScript's lookup finds
  // decides, so a parameter or a local of the same name is not read here.
  const mathBound = mathBindingOf(node);
  if (mathBound !== undefined) {
    const value = resolveMathConst(mathBound.member);
    if (value !== undefined) return { op: 'lit', type: f32T, value };
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${node.text}" is Math.${mathBound.member}, a function alias. Call it.`,
      TS_CODES.UNSUPPORTED,
    );
    return undefined;
  }
  const binding = scope.resolve(node.text);
  if (!binding) {
    // `undefined` is the absent value of an optional type (Rule 7.10, change 0088), where one
    // is expected, and no value anywhere else. TypeScript's own value, which no file declares.
    if (node.text === 'undefined') {
      return lowerUndefinedValue(node, contextual, sourceFile, scope, diagnostics);
    }
    // A §9.3 constant is the ambient library's, and a name the file declares shadows it, as
    // TypeScript resolves it: `enum E`, `namespace PI`, `class TAU` and `function PI` read as
    // the file's, never as e, π or τ (Rule 2.1).
    // A removed one (`PI`, `E`, `LN2`, `LN10`, `LOG2E`, `LOG10E`) is refused with the `Math`
    // member that replaces it, unless the file declares the name itself (change 0112).
    const removedConst = removedConstantSentence(node.text);
    if (removedConst !== undefined && !declaresValue(declarationOf(node))) {
      pushDiag(diagnostics, sourceFile, node, removedConst, TS_CODES.UNKNOWN_NAME);
      return undefined;
    }
    const c = resolveLangConst(node.text);
    const declared = c === undefined ? undefined : declarationOf(node);
    if (c !== undefined && !declaresValue(declared)) return { op: 'lit', type: f32T, value: c };
    // A function named where a value is read (Rule 8.17). A call of it is lowered where the call
    // is, and a function handed to a fold is read there, so what reaches here asks for the
    // function as a value: to hold, return, compare or choose at run time.
    if (
      scope.resolveCallee(node.text) !== undefined ||
      scope.isGenericFunction(node.text) ||
      (declared !== undefined &&
        ts.isFunctionDeclaration(declared) &&
        !scope.declarationRefused(node.text))
    ) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"${node.text}" is a function, and a shader has no function values: nothing at run ` +
          `time can hold one, return one or choose between two. Call it where its value is ` +
          `needed, "${node.text}(...)", or hand it to a parameter that takes a function ` +
          `(Rule 8.18).`,
        TS_CODES.UNSUPPORTED,
      );
      return undefined;
    }
    if (scope.declarationRefused(node.text)) return undefined;
    // A name whose declaration was refused, or one an error already covers, says nothing
    // more: the refusal is the one diagnostic for the one mistake (Rule 12.4, #171).
    if (unknownNameAlreadyReported(node, node.text, sourceFile, diagnostics)) return undefined;
    const sentence = unknownValueSentence(node);
    if (sentence !== undefined) {
      pushDiag(diagnostics, sourceFile, node, sentence, TS_CODES.UNKNOWN_NAME);
    }
    return undefined;
  }
  switch (binding.kind) {
    case 'param':
      if (isOptional(binding.type)) {
        return lowerOptionalRead(node, binding, contextual, sourceFile, diagnostics);
      }
      return markInferredRead(
        markCarriedRead(
          markAbstractRead(
            { op: 'param', type: binding.type, name: irNameOf(binding) },
            node,
            binding.abstract,
          ),
          node,
          carriedOf(binding.carries, binding.inferred),
        ),
        node,
        binding.inferred,
      );
    case 'module':
      return markAbstractRead(
        { op: 'constref', type: binding.type, name: binding.name },
        node,
        binding.abstract,
      );
    // A resource binding is a module-scope `var`, so it reads as a `varref` — the same shape
    // the fn() EDSL builds. `constref` here is what #14 was: invisible to the binding
    // reachability walk, which counts `varref` names alone. Spelled as an exhaustive switch
    // rather than a fallthrough so a fifth BindingKind cannot silently land on this arm.
    case 'modvar': {
      // Workgroup memory is a compute entry's alone (§24): a vertex or fragment entry that
      // names it is refused here, on the read, with the reason. A helper function has no
      // stage and passes; the final call-graph check inherits its callers' stages.
      const stage = scope.currentStage();
      if (binding.space === 'workgroup' && (stage === 'vertex' || stage === 'fragment')) {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          workgroupStageMessage(node.text, stage),
          TS_CODES.MODULE_VAR,
        );
        return undefined;
      }
      if (refuseBareAtomic(binding.type, node, sourceFile, scope, diagnostics)) return undefined;
      const ref: Expr = { op: 'varref', type: binding.type, name: irNameOf(binding) };
      // A module variable whose uses decide its type (change 0134 item 1).
      return markInferredRead(
        markCarriedRead(
          binding.space === 'workgroup' ? withSpan(ref, sourceFile, node) : ref,
          node,
          carriedOf(undefined, binding.inferred),
        ),
        node,
        binding.inferred,
      );
    }
    case 'binding':
    case 'local':
      // A binding whose declared type was refused holds the mapper's placeholder, not a type the
      // author wrote: `storage<array<vec2h>>` holds a struct called `array`. A sentence about a
      // use of it would name that placeholder as theirs, "Cannot index array", and the refusal
      // at the declaration is already the one mistake to fix (Rule 12.4).
      if (dropsRecoveredUse(sourceFile, binding)) return undefined;
      // A `storage<atomic<u32>>` binding is a location, not a value (lower/atomics.ts).
      if (refuseBareAtomic(binding.type, node, sourceFile, scope, diagnostics)) return undefined;
      // An optional local reads as its value where the flow says it is present, as itself
      // where an optional is expected, and is refused elsewhere (Rule 7.10, change 0088).
      if (binding.kind === 'local' && isOptional(binding.type)) {
        return lowerOptionalRead(node, binding, contextual, sourceFile, diagnostics);
      }
      {
        // A loop counter's start lowered again at its type on `main` reads the constant as
        // that integer (`withReadTypes`, Amendment A3 of change 0134).
        const forced = readTypeFor(binding.abstract);
        // The read is a typed value there, not a written number (`isAbstractRead`), so a peer
        // literal takes its type (`Math.max(k, 1)`, `k >> 1`).
        if (forced !== undefined && binding.abstract !== undefined) {
          noteForcedRead(node, binding.abstract, forced);
          return { op: 'lit', type: forced, value: binding.abstract.value };
        }
      }
      return markInferredRead(
        markCarriedRead(
          markAbstractRead(
            markQuotientRead(
              { op: 'varref', type: binding.type, name: irNameOf(binding) },
              binding,
              node,
            ),
            node,
            binding.abstract,
          ),
          node,
          carriedOf(binding.carries, binding.inferred),
        ),
        node,
        binding.inferred,
      );
    // A specialization constant is its own IR node: the optimizer must never fold an
    // overrideref, since its value is not known until the pipeline is built (#8 A7).
    case 'override':
      return { op: 'overrideref', type: binding.type, name: binding.name };
    default: {
      const never: never = binding.kind;
      throw new Error(`typeshade: unhandled BindingKind ${String(never)}`);
    }
  }
}

function lowerPrefixUnary(
  node: ts.PrefixUnaryExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  // `!v` on an optional reads it as a condition, which a bool alone is (Rule 7.10).
  if (node.operator === ts.SyntaxKind.ExclamationToken) {
    const sentence = optionalConditionSentence(node.operand, scope, sourceFile);
    if (sentence !== undefined) {
      pushDiag(diagnostics, sourceFile, node.operand, sentence, TS_CODES.TYPE_MISMATCH);
      return undefined;
    }
  }
  let operand = lowerExpression(node.operand, sourceFile, scope, diagnostics);
  if (!operand) return undefined;
  if (refuseOptionalUse(operand, node.operand, sourceFile, diagnostics)) return undefined;
  if (node.operator === ts.SyntaxKind.MinusToken) {
    // The negation of a bitwise expression over written integers is computed exactly
    // (`-(~2147483647)` is 2147483648, a u32), as its arithmetic is (issue 1261).
    if (isKindlessBitwise(operand)) {
      const negated: Expr = { op: 'unop', type: operand.type, a: operand };
      return foldKindlessOrRefuse(negated, node, sourceFile, diagnostics);
    }
    // WGSL defines unary `-` for the signed and floating kinds and their vectors, and NOT for
    // u32 (§52): `-u` on a u32 emitted `(-u)` and Tint answered `no matching overload for
    // 'operator - (u32)'`. The two spellings that do work are named, because "unsupported"
    // alone leaves an author guessing which one they wanted.
    const k = operand.type.kind === 'vec' ? operand.type.elem : typeKey(operand.type);
    if (k === 'u32') {
      // The two spellings are written for the operand's OWN width: `0u - x` and `i32(x)` are
      // not expressions on a `vec4u`, so a vector operand is told `vec4u(0u) - x` and
      // `vec4i(x)`, which is what an author would have to write.
      const n = operand.type.kind === 'vec' ? operand.type.n : 0;
      const zero = n === 0 ? '0u' : `vec${String(n)}u(0u)`;
      const signed = n === 0 ? 'i32(x)' : `vec${String(n)}i(x)`;
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Unary "-" is not defined on ${authorTypeText(operand.type)}; WGSL has no negation for an ` +
          `unsigned integer. Write ${zero} - x to wrap, or ${signed} to change kind first.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    // A bool, a matrix, a struct and an array have no negation in WGSL either (Rule 7.1).
    if (refuseNegationKind(operand.type, node, sourceFile, diagnostics)) return undefined;
    return { op: 'unop', type: operand.type, a: operand };
  }
  // Unary `+` is the identity WGSL and GLSL both give it, so it lowers to its operand and
  // emits nothing (§52). Refusing it meant a program that reads `+1.` in a list of signed
  // constants had to drop the sign that made the list line up.
  if (node.operator === ts.SyntaxKind.PlusToken) {
    const k = operand.type.kind === 'vec' ? operand.type.elem : typeKey(operand.type);
    if (k === 'bool') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Unary "+" requires a numeric operand, got ${authorTypeText(operand.type)}.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    // A struct, an array or a texture is not a number either: TypeScript's `+x` on one is `NaN`,
    // and the identity would hand the shader the value itself (Rule 7.1).
    if (refuseIdentityKind(operand.type, node, sourceFile, diagnostics)) return undefined;
    return operand;
  }
  // `~x`, the bitwise complement (§52). Both targets spell it `~x`; it is an INTRINSIC rather
  // than an IR `unop`, because that node is negation-only and carries no operator field.
  if (node.operator === ts.SyntaxKind.TildeToken) {
    // The operand of `~` is a bitwise operand with no typed peer (Rule 5.1, change 0134 item 1):
    // a value its uses decide asks an integer of no kind, and a written integer, or a constant
    // of no fixed type that is one, is an `i32`, or a `u32` where an `i32` does not hold it. It
    // was left an `f32`, so `~1` and `~K` were refused (issue 1261).
    noteDemand(operand, 'int');
    operand = bitOperandLeaf(integerOperand(operand, node.operand), node.operand, scope);
    let written: Expr | undefined;
    if (noKindOperand(operand, node.operand)) {
      const lit = foldNumericLit(operand);
      const kind =
        lit.op === 'lit' && typeof lit.value === 'number' && lit.value > 2147483647 ? u32T : i32T;
      const lowered = (written = operand);
      operand = softDemands(() => retargetIntLitCtx(lowered, node.operand, kind));
    }
    const k = operand.type.kind === 'vec' ? operand.type.elem : typeKey(operand.type);
    if (k !== 'i32' && k !== 'u32') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Unary "~" requires an i32 or u32 operand, got ${authorTypeText(operand.type)}.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    // The intrinsic id is the OPERATOR, not a name: CSE keys a call by `fn` alone
    // (passes/opt/expr-utils.ts), so an id an author can also spell — `bitNot` — would let a
    // user function of that name and `~x` share one key and fold into each other, silently,
    // on the GPU and in the oracle alike. `~` is not a TypeScript identifier, so no author
    // declaration can collide with it.
    const complement: Expr & { op: 'call' } = {
      op: 'call',
      type: operand.type,
      fn: '~',
      args: [operand],
    };
    if (!written) return complement;
    // Over written integers the complement is a constant, folded as the other operators are:
    // the range and shift-amount checks then read its value, and the targets receive a value
    // of the type, not `~3` for Tint to evaluate as an abstract integer (`(~3 & 255) << 24`
    // overflowed there).
    return foldKindlessOrRefuse(complement, node, sourceFile, diagnostics);
  }
  if (node.operator === ts.SyntaxKind.ExclamationToken) {
    // `!m` on a vector of bools is componentwise (§27): the same compare-with-false the scalar
    // form lowers to, against a vector of falses, which WGSL spells `!m` too and GLSL `not(m)`.
    if (operand.type.kind === 'vec' && operand.type.elem === 'bool') {
      const no: Expr = { op: 'lit', type: boolT, value: false };
      return {
        op: 'compare',
        type: operand.type,
        cop: '==',
        a: operand,
        b: {
          op: 'construct',
          type: operand.type,
          args: Array.from({ length: operand.type.n }, () => no),
        },
      };
    }
    if (typeKey(operand.type) !== 'bool') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Unary "!" requires a bool operand, got ${authorTypeText(operand.type)}.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    return {
      op: 'compare',
      type: boolT,
      cop: '==',
      a: operand,
      b: { op: 'lit', type: boolT, value: false },
    };
  }
  pushDiag(diagnostics, sourceFile, node, 'Unsupported unary operator.', TS_CODES.UNSUPPORTED);
  return undefined;
}

/** Retargets a bare numeric literal on either side to its peer's kind. The peer of a literal
 *  that meets a vector is the vector's element scalar (`v * 2` with `v: vec3<u32>` types the
 *  `2` as u32, and against a vec64 the literal becomes an f64 carrying the full double); a
 *  scalar peer is taken as is, so `i + 1` with `i: u32` behaves as before. */
function pair(left: Expr, right: Expr, lNode: ts.Expression, rNode: ts.Expression): [Expr, Expr] {
  // A peer with no type of its own (a written integer, a constant of no fixed type, a value no
  // use has decided) asks nothing of a value its uses decide: its `f32` is no use's (change
  // 0134 item 1). A call of a function its callers decide counts an `f32` peer, so it matters.
  return [
    lendsNoType(rNode)
      ? quietDemands(() => retargetLit(left, lNode, right.type))
      : retargetLit(left, lNode, right.type),
    lendsNoType(lNode)
      ? quietDemands(() => retargetLit(right, rNode, left.type))
      : retargetLit(right, rNode, left.type),
  ];
}

/** Whether `node` is a written integer, or a read of a constant of no fixed type that is one,
 *  with arithmetic over those (`isIntegerLiteralTree`): an operand with no type of its own. */
function writtenIntegerOperand(node: ts.Expression): boolean {
  if (isIntegerLiteralTree(node) || isIntegerWrittenRead(node)) return true;
  // `%` over written integers is arithmetic over them, as `+ - * /` are (`(7 % 3) | 0`,
  // `((7 % 3) * 5) << 1`).
  const inner = ts.isParenthesizedExpression(node) ? node.expression : node;
  if (ts.isPrefixUnaryExpression(inner) && inner.operator === ts.SyntaxKind.MinusToken) {
    return writtenIntegerOperand(inner.operand);
  }
  const k = ts.isBinaryExpression(inner) ? inner.operatorToken.kind : undefined;
  return (
    ts.isBinaryExpression(inner) &&
    (k === ts.SyntaxKind.PercentToken ||
      k === ts.SyntaxKind.PlusToken ||
      k === ts.SyntaxKind.MinusToken ||
      k === ts.SyntaxKind.AsteriskToken) &&
    writtenIntegerOperand(inner.left) &&
    writtenIntegerOperand(inner.right)
  );
}

/** `tree`, a bitwise expression over written integers built in its own integer type, folded to
 *  the literal of the integer type its value fits (`foldKindless`); `tree` itself where a leaf
 *  is no constant. A value neither integer type holds is refused with the sentence a written
 *  number gets (Rule 5.4, issue 1261): `(1 << 30) * 4` is 4294967296. */
function foldKindlessOrRefuse(
  tree: Expr,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const verdict = foldKindless(tree);
  if (verdict === undefined) return tree;
  // This fold reads its operands whole: a verdict one of them left pending is not the
  // program's, only the root's is (`((1 << 30) * 4) | 0` is 0).
  retractOperandRefusals(tree);
  let cell: RefusalCell | undefined;
  const pending = (
    diagnostic: TsCompilerDiagnostic,
    at?: (peer: ShaderType) => TsCompilerDiagnostic,
  ): Expr => {
    cell = noteKindlessRefusal(verdict.lit, {
      diagnostic,
      into: diagnostics,
      kind: verdict.kind,
      value: 'value' in verdict ? verdict.value : 0,
      ...(at !== undefined ? { at } : {}),
    });
    return verdict.lit;
  };
  switch (verdict.kind) {
    case 'int':
      return verdict.lit;
    case 'readings': {
      // The owner's decision of 2026-11-11, "거부": the edit picks the u32 reading, a conversion
      // that compiles in both halves (`>>>` is not part of the surface).
      const bin = node as ts.BinaryExpression;
      const left = bin.left.getText(sourceFile);
      const right = bin.right.getText(sourceFile);
      return pending(
        makeDiagnostic(
          sourceFile,
          node,
          `Bitwise ">>" over ${left}, which only a u32 holds, gives ${String(verdict.u32)} on ` +
            `its u32 bits and ${String(verdict.ts)} in TypeScript, so it does not say which it ` +
            `means. Write "u32(${left}) >> ${right}" for the u32 shift.`,
          TS_CODES.TYPE_MISMATCH,
        ),
      );
    }
    case 'outside':
      return pending(
        makeDiagnostic(
          sourceFile,
          node,
          intLiteralRangeMessage(verdict.value, verdict.value < 0 ? i32T : u32T),
          TS_CODES.TYPE_MISMATCH,
        ),
        (peer) =>
          makeDiagnostic(
            sourceFile,
            node,
            intLiteralRangeMessage(verdict.value, peer),
            TS_CODES.TYPE_MISMATCH,
          ),
      );
    case 'quotient': {
      // The edit names the whole tree, so it compiles in one step (`(f32(1 | 2) / 2) / 2`). The
      // checked-edit path of `abstract-const.ts` chooses its type from where the quotient flows
      // and compiles it with every other refusal's edit; where that does not compile, the
      // refusal names no edit.
      const root = node as ts.Expression;
      const state: { peer?: ShaderType; edit?: string | null; allowed?: readonly string[] } = {};
      const known = new Map<string, string>();
      const editIn = (type: ShaderType | undefined): string => {
        const key = type === undefined ? '' : typeKey(type);
        let edit = known.get(key);
        if (edit === undefined) known.set(key, (edit = treeQuotientEdit(root, sourceFile, type)));
        return edit;
      };
      const diagnostic = (): TsCompilerDiagnostic =>
        quotientDiagnostic(
          root,
          sourceFile,
          state.edit === undefined ? editIn(state.peer) : state.edit,
          state.peer,
          treeQuotientEdit(root, sourceFile, state.peer, false),
          state.allowed,
        );
      const lit = pending(diagnostic(), (peer) => {
        state.peer = peer;
        state.edit = undefined;
        return diagnostic();
      });
      // The cell follows the refusal to whichever literal carries it (a peer retypes it).
      const held = cell!;
      noteCheckedRefusal(sourceFile, {
        node: root,
        peer: () => (state.peer === undefined ? undefined : typeKey(state.peer)),
        edit: (type) => editIn(type === 'f32' ? undefined : { kind: 'scalar', scalar: type }),
        current: () => held.diagnostic,
        restate: (edit, allowed) => {
          state.edit = edit;
          state.allowed = allowed;
          replaceRefusal(held, diagnostic());
        },
      });
      return lit;
    }
  }
}

/** The operators whose result depends on which of two values modulo 2^32 an operand is. */
const VALUE_SENSITIVE: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

/** Whether `n` is a conversion the author wrote, `i32(…)`, `u32(…)` or `f32(…)`. */
function writtenConversion(n: ts.Expression): boolean {
  const inner = skipParensNode(n);
  return (
    ts.isCallExpression(inner) &&
    ts.isIdentifier(inner.expression) &&
    ['i32', 'u32', 'f32'].includes(inner.expression.text)
  );
}

/** The `/` of a tree of written integers, as {@link noteKindlessDivision} records it. */
interface KindlessDivision {
  readonly node: ts.BinaryExpression;
  readonly sourceFile: ts.SourceFile;
  /** Whether each operand carries a bit operator. */
  readonly left: boolean;
  readonly right: boolean;
}

/** The edit that makes the tree at `root` divide in `peer`'s type, or in `f32`: each `/`
 *  whose value reaches the root through arithmetic converts an operand that is no written number,
 *  and an operand of `+ - * %` beside a converted one converts too, so the edited tree has one
 *  type in one step (`((1 | 2) / 2) / 2` gives `(f32(1 | 2) / 2) / 2`). A bit operator ends the
 *  walk: a `/` under it is read through ToInt32 and is no part of the quotient. */
function treeQuotientEdit(
  root: ts.Expression,
  sourceFile: ts.SourceFile,
  peer?: ShaderType,
  value = true,
  /** Receives each operand the edit converts, with its value where no integer type holds it. */
  subjects?: { text: string; value?: number }[],
): string {
  const type = peer === undefined ? 'f32' : typeKey(peer);
  const written = (n: ts.Expression): boolean => {
    const inner = skipParensNode(n);
    return isIntegerLiteralTree(inner) || (ts.isNumericLiteral(inner) && peer === undefined);
  };
  // The value TypeScript computes for an operand of written numbers alone, for the third edit,
  // which converts that value (`f32(4294967296) / 3` where `f32((1 << 30) * 4) / 3` is refused
  // for its range); `undefined` where a leaf is no written number.
  const valueOf = (n: ts.Expression): number | undefined => {
    if (ts.isParenthesizedExpression(n)) return valueOf(n.expression);
    if (ts.isNumericLiteral(n)) return Number(n.text);
    if (ts.isPrefixUnaryExpression(n)) {
      const a = valueOf(n.operand);
      if (a === undefined) return undefined;
      return n.operator === ts.SyntaxKind.MinusToken
        ? -a
        : n.operator === ts.SyntaxKind.TildeToken
          ? ~a
          : undefined;
    }
    if (!ts.isBinaryExpression(n)) return undefined;
    const a = valueOf(n.left);
    const b = valueOf(n.right);
    if (a === undefined || b === undefined) return undefined;
    switch (n.operatorToken.kind) {
      case ts.SyntaxKind.PlusToken:
        return a + b;
      case ts.SyntaxKind.MinusToken:
        return a - b;
      case ts.SyntaxKind.AsteriskToken:
        return a * b;
      case ts.SyntaxKind.SlashToken:
        return a / b;
      case ts.SyntaxKind.PercentToken:
        return a % b;
      case ts.SyntaxKind.BarToken:
        return a | b;
      case ts.SyntaxKind.AmpersandToken:
        return a & b;
      case ts.SyntaxKind.CaretToken:
        return a ^ b;
      case ts.SyntaxKind.LessThanLessThanToken:
        return a << b;
      case ts.SyntaxKind.GreaterThanGreaterThanToken:
        return a >> b;
      default:
        return undefined;
    }
  };
  let byValue = false;
  const convert = (n: ts.Expression): string => {
    if (subjects !== undefined && !byValue) {
      const at = valueOf(n);
      const text = skipParensNode(n).getText(sourceFile).replace(/\s+/g, ' ');
      subjects.push(
        at !== undefined && Number.isInteger(at) && (at < -(2 ** 31) || at > 2 ** 32 - 1)
          ? { text, value: at }
          : { text },
      );
    }
    // Only a value no integer type holds is written as its value; another operand keeps its text.
    const v = byValue ? valueOf(n) : undefined;
    return v !== undefined && Number.isInteger(v) && (v < -(2 ** 31) || v > 2 ** 32 - 1)
      ? `${type}(${String(v)})`
      : `${type}(${skipParensNode(n).getText(sourceFile).replace(/\s+/g, ' ')})`;
  };
  const edit = (both: boolean): string => {
    const walk = (n: ts.Expression): { text: string; typed: boolean } => {
      if (ts.isParenthesizedExpression(n)) {
        const r = walk(n.expression);
        return { text: `(${r.text})`, typed: r.typed };
      }
      if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.MinusToken) {
        const r = walk(n.operand);
        return { text: `-${r.text}`, typed: r.typed };
      }
      if (ts.isBinaryExpression(n)) {
        const k = n.operatorToken.kind;
        const arith =
          k === ts.SyntaxKind.PlusToken ||
          k === ts.SyntaxKind.MinusToken ||
          k === ts.SyntaxKind.AsteriskToken ||
          k === ts.SyntaxKind.PercentToken;
        const between = sourceFile.text.slice(n.left.getEnd(), n.right.getStart(sourceFile));
        if (k === ts.SyntaxKind.SlashToken) {
          let l = walk(n.left);
          let r = walk(n.right);
          if (!l.typed && !r.typed) {
            if (written(n.left) && written(n.right) && peer === undefined) {
              return { text: `${l.text}${between}${r.text}`, typed: true };
            }
            // Each operand that is no written number converts: one left as it is would be an
            // integer beside the converted one (`f32(1 | 2) / f32(1 << 1)`).
            if (both || !written(n.left)) l = { text: convert(n.left), typed: true };
            if (both || !written(n.right) || !l.typed) r = { text: convert(n.right), typed: true };
          } else if (l.typed !== r.typed) {
            // A tree beside a converted quotient converts too: `(f32(1|2)/2) / f32(1<<2)`.
            if (!r.typed && !written(n.right)) r = { text: convert(n.right), typed: true };
            if (!l.typed && !written(n.left)) l = { text: convert(n.left), typed: true };
          }
          return { text: `${l.text}${between}${r.text}`, typed: true };
        }
        if (arith) {
          let l = walk(n.left);
          let r = walk(n.right);
          if (l.typed && !r.typed && !written(n.right)) r = { text: convert(n.right), typed: true };
          if (r.typed && !l.typed && !written(n.left)) l = { text: convert(n.left), typed: true };
          return { text: `${l.text}${between}${r.text}`, typed: l.typed || r.typed };
        }
      }
      return { text: n.getText(sourceFile), typed: false };
    };
    return walk(root).text.replace(/\s+/g, ' ');
  };
  const first = edit(false);
  if (!value) return first;
  // An operand no integer type holds is converted by its value, since its text is refused for
  // its range (`f32(4294967296) / 3`).
  byValue = true;
  return edit(false) === first ? first : edit(false);
}

/** The refusal of verdict 4 (D-b) at `root`, naming `edit` (see {@link treeQuotientEdit}). */
function quotientDiagnostic(
  root: ts.Expression,
  sourceFile: ts.SourceFile,
  /** The edit to name; `null` names none (the edits of the module's refusals do not compile
   *  together). */
  edit: string | null,
  peer: ShaderType | undefined,
  /** The edit that converts the operands as written, which names the subject. */
  written0: string,
  /** The types the quotient's positions take, which a remedy that names no edit lists. */
  allowed?: readonly string[],
): TsCompilerDiagnostic {
  const written = root.getText(sourceFile).replace(/\s+/g, ' ');
  const type = peer === undefined ? 'f32' : typeKey(peer);
  // The subject is the first operand the edit converts: the integer a bit operator makes.
  const subject = new RegExp(`${type}\\((.*)$`).exec(written0)?.[1] ?? written;
  let depth = 0;
  let end = subject.length;
  for (let i = 0; i < subject.length; i++) {
    if (subject[i] === '(') depth++;
    else if (subject[i] === ')') {
      if (depth === 0) {
        end = i;
        break;
      }
      depth--;
    }
  }
  let remedy: string;
  if (edit !== null) {
    remedy = `Write "${edit}" for the ${edit.includes('f32(') ? 'float' : 'integer'} division.`;
  } else {
    // The operands the float edit converts are the ones a written type decides; one no integer
    // type holds leaves only the float division, written with its value.
    const subjects: { text: string; value?: number }[] = [];
    treeQuotientEdit(root, sourceFile, undefined, false, subjects);
    const big = subjects.find((s) => s.value !== undefined);
    // Where the positions take an `f32`, the float division of the value is the one form that
    // chooses it; where they take only integers, no form does, and the sentence says so.
    const float = allowed === undefined || allowed.includes('f32');
    remedy =
      big === undefined
        ? genericDivisionRemedy(
            subjects.map((s) => s.text),
            allowed,
          )
        : float
          ? `No integer type holds "${big.text}" (${String(big.value)}), so only the float ` +
            `division chooses it: write "${treeQuotientEdit(root, sourceFile)}".`
          : `No integer type holds "${big.text}" (${String(big.value)}), and the quotient is ` +
            `read as an integer here, so no division of it computes this value.`;
  }
  return makeDiagnostic(
    sourceFile,
    root,
    `"${subject.slice(0, end)}" is an integer by its bit operator, and no operand of "${written}" ` +
      `has a declared type, so the "/" does not say which division it is. ${remedy}`,
    TS_CODES.TYPE_MISMATCH,
  );
}

/** `expr`, lowered from `node`, an operand of a bit operator: where it is written arithmetic
 *  (`0x7fffffff + 1`), a leaf of its value. Change 0134 item 1 makes a bit operator a `u32`'s
 *  beside a WRITTEN number only a `u32` holds; a sum is computed, and read as TypeScript reads it,
 *  so `(0x7fffffff + 1) | 0` is -2147483648. */
function bitOperandLeaf(expr: Expr, node: ts.Expression, scope: LoweringScope): Expr {
  if (isKindlessBitwise(expr) || !writtenIntegerOperand(node)) return expr;
  const inner = skipParensNode(node);
  if (ts.isNumericLiteral(inner) || isIntegerWrittenRead(inner)) return expr;
  if (ts.isPrefixUnaryExpression(inner) && ts.isNumericLiteral(skipParensNode(inner.operand))) {
    return expr;
  }
  const lit = foldNumericLit(abstractLiteralOf(expr) ?? expr);
  const v =
    lit.op === 'lit' && typeof lit.value === 'number' ? lit.value : foldConstNumber(expr, scope);
  return v !== undefined && Number.isInteger(v)
    ? markKindlessLeaf({ op: 'lit', type: i32T, value: v })
    : expr;
}

/** `node` with its parentheses taken off. */
function skipParensNode(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? skipParensNode(node.expression) : node;
}

/** `expr`, a bitwise operand: where it is a quotient refused elsewhere (D-b of #1272), its
 *  integer division, which an integer position reads (Amendment A4). */
function integerOperand(expr: Expr, node: ts.Expression): Expr {
  // ToInt32 of the quotient is the integer division of the two integers, so the value is
  // TypeScript's: the bit operator reads it as a position that states its type would.
  void node;
  return integerQuotientAt(expr, i32T, true) ?? expr;
}

/** Whether `expr`, lowered from `node`, is an operand with no type of its own: a written integer
 *  or a constant of no fixed type that is one, still an `f32`, or a bitwise expression over such
 *  operands, which took an integer of no kind (issue 1261). */
function noKindOperand(expr: Expr, node: ts.Expression): boolean {
  return (
    isKindlessBitwise(expr) || (intElem(expr.type) === undefined && writtenIntegerOperand(node))
  );
}

function lendsNoType(node: ts.Expression): boolean {
  return isIntegerLiteralTree(node) || isAbstractRead(node) || isUndecidedRead(node);
}

/** Whether `e` is a divisor the constant folder proves is zero in at least one component. */
export function divisorIsZero(e: Expr, scope: LoweringScope): boolean {
  if (scope.preservesConstantF32()) return foldF64ModuleConst(e, scope) === 0;
  const parts = foldConstComponents(e, scope);
  return parts !== undefined && parts.some((v) => v === 0);
}

/** `e`, or undefined with the literal's `TS8003` sentence when it is a constant `f32` expression
 *  whose value no `f32` holds (#374, Rule 12.6). A literal past the range is refused as it is
 *  written; this is the value arithmetic over literals and constants folds to, which Tint
 *  refused with "cannot be represented as 'f32'". */
function refuseF32OutOfRange(
  e: Expr,
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const v = constF32OutOfRange(e, scope);
  if (v === undefined) return e;
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    f32RangeSentence(node.getText(sourceFile), v),
    TS_CODES.TYPE_MISMATCH,
  );
  return undefined;
}

function lowerBinary(
  node: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  contextual?: ShaderType,
): Expr | undefined {
  // Read before the operands: `d instanceof B` would lower `B` first and report "Unknown
  // identifier B" — a complaint about the one part of the line that is spelled right
  // (roadmap 0.3 item T10, #92).
  const asked = RUNTIME_TYPE_TEST[node.operatorToken.kind];
  if (asked !== undefined) {
    pushDiag(diagnostics, sourceFile, node, asked, TS_CODES.UNSUPPORTED);
    return undefined;
  }
  // The forms an optional value has of its own (Rule 7.10, change 0088), read before the
  // operands: `v ?? d`, and `v === undefined` in its four spellings and either order.
  if (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    return lowerNullish(node, sourceFile, scope, diagnostics, contextual);
  }
  const test = lowerUndefinedTest(node, sourceFile, scope, diagnostics);
  if (test !== 'not-a-test') return test;
  // `typeof v === "undefined"` is a recorded divergence (Rule 7.2): the test to write is the
  // comparison with `undefined` itself, said once for the whole comparison.
  const typeofOperand = [node.left, node.right].map(skipParens).find(ts.isTypeOfExpression);
  if (typeofOperand !== undefined && EQUALITY_OPS.has(node.operatorToken.kind)) {
    const tested = typeofOperand.expression.getText(sourceFile);
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"typeof ${tested}" has no shader form: a value's type is fixed where it is declared. ` +
        `Test an optional value with "${tested} === undefined" or "${tested} !== undefined".`,
      TS_CODES.UNSUPPORTED,
    );
    return undefined;
  }
  // An optional as an operand of `&&` or `||` is read as a condition, which a bool alone is.
  if (LOGICAL[node.operatorToken.kind] !== undefined) {
    for (const side of [node.left, node.right]) {
      const sentence = optionalConditionSentence(side, scope, sourceFile);
      if (sentence !== undefined) {
        pushDiag(diagnostics, sourceFile, side, sentence, TS_CODES.TYPE_MISMATCH);
        return undefined;
      }
    }
  }
  // A string literal beside a key type takes its id from the other operand (change 0081), so
  // the other one is lowered first: `c === "r"` and `"r" === c` alike.
  // Any other operand is lowered with no context, as before.
  const literalLeft = ts.isStringLiteralLike(skipParens(node.left));
  const literalRight = ts.isStringLiteralLike(skipParens(node.right));
  // An optional name under `===` or `!==` is read whole, for ECMAScript's equality (Rule
  // 7.10); under any other operator it is read as the `T` the operator takes.
  const whole = EQUALITY_OPS.has(node.operatorToken.kind);
  const operand = (side: ts.Expression, ctx: ShaderType | undefined): Expr | undefined =>
    whole && ctx === undefined
      ? lowerOptionalOperand(side, sourceFile, scope, diagnostics)
      : lowerExpression(side, sourceFile, scope, diagnostics, ctx);
  let right = literalLeft ? operand(node.right, undefined) : undefined;
  let left = operand(node.left, literalLeft ? right?.type : undefined);
  const rightMark = scope.hoistMark();
  if (!literalLeft) {
    right = operand(node.right, literalRight ? left?.type : undefined);
  }
  const rightSetup =
    LOGICAL[node.operatorToken.kind] !== undefined ? scope.takeHoisted(rightMark) : [];
  if (!left || !right) return undefined;
  // A tree whose `u32` bits and TypeScript's value differ (`3000000000 | 0`), beside a typed
  // `u32` under an operator whose result depends on which it is (`/`, `%`, a comparison): it
  // does not say which value it means, as a `>>` over it does not (the owner's decision of
  // 2026-11-11, "거부"). `+ - *` and the bit operators agree on both, modulo 2^32.
  if (VALUE_SENSITIVE.has(node.operatorToken.kind)) {
    const resolve = (n: string) => scope.resolveIr(n);
    for (const [e, other, n, m] of [
      [left, right, node.left, node.right],
      [right, left, node.right, node.left],
    ] as const) {
      const readings = kindlessReadings(e);
      if (
        readings === undefined ||
        typeKey(other.type) !== 'u32' ||
        (!writtenConversion(m) && kindlessOrigin(other, resolve, sourceFile) !== 'typed')
      ) {
        continue;
      }
      const text = skipParensNode(n).getText(sourceFile).replace(/\s+/g, ' ');
      const operator = node.operatorToken.getText(sourceFile);
      retractKindlessRefusal(e);
      pushDiag(
        diagnostics,
        sourceFile,
        n,
        `"${text}" is ${String(readings.u32)} on its u32 bits and ${String(readings.ts)} in ` +
          `TypeScript, so the "${operator}" does not say which value it means. Write ` +
          `"u32(${text})" for the u32 value.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
  }
  // A `/` over constants of no fixed type and written numbers alone (change 0134, decisions Q10
  // and Q11): recorded, and refused once the module's reads are known.
  noteAbstractDivision(
    node,
    sourceFile,
    (name) => scope.resolveCallee(name) === undefined && scope.resolve(name) === undefined,
  );
  // `v === x` with an optional operand is ECMAScript's equality (Rule 7.10); any other
  // operator takes the `T`, which an optional nothing narrowed is not.
  const equality = lowerOptionalEquality(node, left, right, sourceFile, scope, diagnostics);
  if (equality !== 'not-optional') return equality;
  if (refuseKeyOperands(node, left.type, right.type, sourceFile, diagnostics)) return undefined;
  // The f64 module folder must see every operation of a concrete f32 subtree. Folding
  // only a nested literal operand here would erase a rounding step, depending on grouping.
  // A literal-only f64 position still folds the whole tree when it is retargeted or cast.
  if (
    !scope.preservesConstantF32() ||
    typeKey(left.type) !== 'f32' ||
    typeKey(right.type) !== 'f32'
  ) {
    [left, right] = pair(left, right, node.left, node.right);
  }
  const arith = ARITH[node.operatorToken.kind];
  if (arith !== undefined) {
    // A divisor this can PROVE is zero (a literal, a scalar const, a vector constructor with a
    // zero component, arithmetic over those) is refused wherever a division is lowered, not
    // only inside a module constant's initializer (#68): Tint rejects `1.0 / 0.0` as a value
    // f32 cannot represent, ANGLE folds it with a warning, and the oracle would answer
    // Infinity or NaN. A divisor that does not fold is not proven anything and passes.
    // It is the one mistake, said before any tree or D-b verdict: a refusal an operand left
    // pending is not the program's (Rule 12.4).
    if ((arith === '/' || arith === '%') && divisorIsZero(right, scope)) {
      retractKindlessRefusal(left);
      retractKindlessRefusal(right);
      noteZeroDivision(node);
      pushDiag(
        diagnostics,
        sourceFile,
        node.right,
        `Division by zero: "${node.right.getText(sourceFile)}" is 0 on every invocation. WGSL refuses it and GLSL ES 3.00 leaves it undefined.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    // Arithmetic, a `/` included, over a tree of written integers and written integers is the
    // tree (THE RULE, `lit-coerce.ts`): one fold reads it, and only its root decides. A module
    // constant that holds such a tree is a leaf of it here, read as its value.
    const leaf = (e: Expr): Expr => {
      if (e.op !== 'constref' || !isKindlessModuleConst(sourceFile, e.name)) return e;
      const v = scope.resolveIr(e.name)?.constValue;
      return typeof v === 'number' ? markKindlessLeaf({ op: 'lit', type: e.type, value: v }) : e;
    };
    // (A leaf only of a `/`: elsewhere a read keeps the constant's name in the emitted text.)
    const [la, ra] = arith === '/' ? [leaf(left), leaf(right)] : [left, right];
    if (
      (isKindlessBitwise(la) || isKindlessBitwise(ra)) &&
      (isKindlessBitwise(la) || writtenIntegerOperand(node.left)) &&
      (isKindlessBitwise(ra) || writtenIntegerOperand(node.right))
    ) {
      const type = isKindlessBitwise(la) ? la.type : ra.type;
      const tree: Expr = { op: 'binop', type, bop: arith, a: la, b: ra };
      if (arith === '/') {
        noteKindlessDivision(tree, {
          node,
          sourceFile,
          left: isKindlessBitwise(la),
          right: isKindlessBitwise(ra),
        } satisfies KindlessDivision);
      }
      if (foldKindless(tree) !== undefined) {
        return foldKindlessOrRefuse(tree, node, sourceFile, diagnostics);
      }
    }
    if (arith === '*') {
      const mixed = matVecMul(left, right);
      if (mixed) return mixed;
    }
    // A `/` over a bitwise expression of written integers and written integers has no
    // operand of a declared type: it is refused, as a `/` over a constant some read makes an
    // integer is (Amendment A2; the owner's decision of 2026-11-11, D-b), unless an integer
    // position reads the quotient (Amendment A4). The edit converts each such operand to
    // `f32`, and the quotient is lowered as that edit is, so its `f32` raises no second mistake
    // where it flows (Rule 12.4); an integer position takes the integer division instead.
    let refusedQuotient: Expr | undefined;
    if (arith === '/') {
      const resolve = (n: string) => scope.resolveIr(n);
      // A conversion written around an operand (`(1 | 2) / i32(2)`) states its type (decision
      // Q11 of change 0134); a builtin carries its arguments' origin (`kindlessOrigin`).
      const origin = (e: Expr, n: ts.Expression) =>
        statesType(n) ? 'typed' : kindlessOrigin(e, resolve, sourceFile);
      const [lo, ro] = [origin(left, node.left), origin(right, node.right)];
      if (lo !== 'typed' && ro !== 'typed' && (lo === 'kindless' || ro === 'kindless')) {
        const text = (n: ts.Expression): string => {
          const inner = ts.isParenthesizedExpression(n) ? n.expression : n;
          return inner.getText(sourceFile).replace(/\s+/g, ' ');
        };
        const shown = (n: ts.Expression, origin: string): string =>
          origin === 'kindless' ? `f32(${text(n)})` : n.getText(sourceFile).replace(/\s+/g, ' ');
        const subject = text(lo === 'kindless' ? node.left : node.right);
        const edit = `${shown(node.left, lo)} / ${shown(node.right, ro)}`;
        const peerEdit = (type: string): string =>
          [node.left, node.right]
            .map((n, i) =>
              [lo, ro][i] === 'kindless'
                ? `${type}(${text(n)})`
                : n.getText(sourceFile).replace(/\s+/g, ' '),
            )
            .join(' / ');
        const subjects = [node.left, node.right]
          .filter((_, i) => [lo, ro][i] === 'kindless')
          .map(text);
        noteWrittenDivision(node, sourceFile, subject, edit, 'float', peerEdit, subjects);
        const asF32 = (e: Expr): Expr =>
          intElem(e.type) === undefined ? e : { op: 'call', type: f32T, fn: 'f32', args: [e] };
        const [l, r] = [left, right];
        const integerAt = (target: ShaderType, declared = true): Expr | undefined => {
          const a = retargetIntLitCtx(l, node.left, target);
          const b = retargetIntLitCtx(r, node.right, target);
          if (typeKey(a.type) !== typeKey(target) || typeKey(b.type) !== typeKey(target)) {
            return undefined;
          }
          // A position that states an integer type reads the quotient (A4); a peer that states
          // none keeps the `/` refused, with the edit in its type.
          noteWrittenDivisionRead(
            node,
            sourceFile,
            declared ? 'read' : typeKey(target) === 'u32' ? 'u32' : 'i32',
          );
          return { op: 'binop', type: target, bop: '/', a, b };
        };
        // An integer position that states its type reads the quotient: the integer division of
        // that type (Amendment A4). Anywhere else the `f32` its edit names, which an integer
        // position that reads it later converts (`integerQuotientAt`).
        refusedQuotient =
          contextual !== undefined && intElem(contextual) !== undefined
            ? integerAt(contextual)
            : markIntegerQuotient(
                { op: 'binop', type: f32T, bop: '/', a: asF32(l), b: asF32(r) },
                integerAt,
              );
      }
    }
    if (refusedQuotient !== undefined) return refusedQuotient;
    if (typeKey(left.type) !== typeKey(right.type)) {
      // A vector against a scalar of its element kind broadcasts, as it does in WGSL, GLSL and
      // the fn() EDSL; the result is the vector's type and the operand order stays as written.
      const broadcast = broadcastResultType(left.type, right.type, arith);
      if (broadcast) {
        // A vector of bools broadcasts its element as any vector does, and has no arithmetic.
        if (refuseOperatorKind(arith, broadcast, node, sourceFile, diagnostics)) return undefined;
        return refuseF32OutOfRange(
          { op: 'binop', type: broadcast, bop: arith, a: left, b: right },
          node,
          sourceFile,
          scope,
          diagnostics,
        );
      }
      // An f32 beside a scalar f64 widens exactly, as it does in the fn() EDSL and as the
      // fp64 pass's contract states (#151 F64-02).
      const widened = f64WidenResultType(left.type, right.type, arith);
      if (widened) return { op: 'binop', type: widened, bop: arith, a: left, b: right };
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        numericMismatch(node.operatorToken.getText(sourceFile), left.type, right.type),
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    // Two operands of one type still need a kind WGSL has the operator for: two structs, two
    // arrays, two bools, or a matrix of doubles under anything but `*` passed the check above
    // and reached Tint as `no matching overload for 'operator + (A, A)'` (Rule 7.1,
    // lower/operator-kinds.ts).
    if (refuseOperatorKind(arith, left.type, node, sourceFile, diagnostics)) return undefined;
    // WGSL gives a matrix `+`, `-` and `*` and no `/` or `%` (and GLSL ES 3.00 agrees). Two
    // matrices of one shape pass the key check above without ever reaching `binResultType`,
    // so `m / n` was accepted here and emitted `(a / b)`, which both compilers refuse.
    if (left.type.kind === 'mat' && (arith === '/' || arith === '%')) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Cannot ${arith} ${authorTypeText(left.type)}: a matrix has + - and * on both targets and no ` +
          `${arith}. Divide the columns, or multiply by the inverse you computed.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    // WGSL's matrix product cancels the shared dimension — `matKxR * matCxK -> matCxR`, so
    // the left operand's COLUMN count must equal the right operand's ROW count. `matVecMul`
    // above types every pair that meets and returns undefined for one that does not, which
    // then falls to the key check; but two matrices of ONE non-square shape have one key, so
    // nothing looked at their dimensions and the pair was typed as the left operand.
    // `mat2x3 * mat2x3` reached Tint as `(a * b)` and came back "no matching overload for
    // 'operator * (mat2x3<f32>, mat2x3<f32>)'" (#169). `binResultType` already refuses it in
    // the fn() EDSL (SD0001), so this is the two surfaces agreeing again.
    if (
      arith === '*' &&
      left.type.kind === 'mat' &&
      right.type.kind === 'mat' &&
      left.type.cols !== right.type.rows
    ) {
      const meets =
        typeKey(left.type) === typeKey(right.type)
          ? ` transpose(${node.right.getText(sourceFile)}) turns this pair into one that meets.`
          : '';
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Type mismatch: cannot * ${authorTypeText(left.type)} and ${authorTypeText(right.type)}. WGSL's ` +
          `matrix product is matKxR * matCxK -> matCxR: the left operand's ` +
          `${String(left.type.cols)} columns must meet the right operand's ` +
          `${String(right.type.rows)} rows.${meets}`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    // `%` is the one arithmetic operator the emulation has no body for: there is no
    // df64 remainder, and `binResultType` refuses the pair in the fn() EDSL for the same
    // reason. Same-typed operands pass the key check above, so without this the program
    // reached emit and came back as a span-less SD0041 (#151).
    if (arith === '%' && (isF64(left.type) || isVec64(left.type))) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Cannot % ${authorTypeText(left.type)}: the emulated double has no remainder — the fp64 ` +
          `pass has a df64 body for + - * / and the comparisons only. Narrow first, e.g. ` +
          `${isF64(left.type) ? 'f32(x) % f32(y)' : `vec${(left.type as { n: number }).n}(v) % vec${(left.type as { n: number }).n}(w)`}.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    const sum: Expr = { op: 'binop', type: left.type, bop: arith, a: left, b: right };
    // A constant `f32` result past the range (#374): `1e30 * 1e30`, or `K * K`.
    return refuseF32OutOfRange(sum, node, sourceFile, scope, diagnostics);
  }
  // `a ** b` is WGSL's and GLSL's pow(a, b); TypeScript's exponent operator is the only
  // arithmetic token with no binop of its own. pow is component-wise over equal types on both
  // targets, so the two operands must agree — and it takes FLOATS only, so an integer pair is
  // refused here rather than emitted as `pow(i32, i32)`, which Tint answers with "no matching
  // call to 'pow(i32, i32)'" and ANGLE with "no matching overloaded function". The sentence says
  // what TypeShade takes. WGSL defines pow for AbstractFloat, f32 and f16 (§17.5.46), so "WGSL
  // defines it for f32 only", which it said before, was false (#616, Rule 12.5).
  if (node.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskToken) {
    if (typeKey(left.type) !== typeKey(right.type)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Type mismatch: cannot ** ${authorTypeText(left.type)} and ${authorTypeText(right.type)}. ` +
          '** is pow(a, b), which takes two values of one type; ' +
          'splat the exponent, e.g. v ** vec3(2.).',
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    if (!isFloatPowOperand(left.type)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Cannot ** ${authorTypeText(left.type)}. ** is pow(a, b), which takes floating-point ` +
          'values only; cast first, e.g. f32(a) ** f32(b).',
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    const call: Expr & { op: 'call' } = {
      op: 'call',
      type: left.type,
      fn: 'pow',
      args: [left, right],
    };
    // `10. ** 40.` is `pow(10.0, 40.0)`, a constant call Tint refuses (#613).
    if (refuseConstCall(call, '**', node, sourceFile, scope, diagnostics)) return undefined;
    return call;
  }
  const bit = BITWISE[node.operatorToken.kind];
  if (bit !== undefined) {
    // A bitwise operand is an integer position: a quotient refused elsewhere is its integer
    // division here (Amendment A4; D-b of #1272).
    {
      const [l0, r0] = [left, right];
      left = integerOperand(left, node.left);
      right = integerOperand(right, node.right);
      // A written peer took the quotient's `f32` in `pair` above: it takes the integer now.
      if (left !== l0 || right !== r0) [left, right] = pair(left, right, node.left, node.right);
    }
    // A constant shift amount outside 0..31 has no bit to shift into: WGSL makes it a
    // shader-creation error and GLSL ES 3.00 leaves the result undefined (#71). The fold is
    // the loop bound's, so `16 + 16` and a module const are caught with the literal; a
    // runtime amount is left alone, since WGSL masks it to the low five bits.
    const isShift = bit === '<<' || bit === '>>';
    if (isShift) {
      const amount = constShiftAmountOutOfRange(right, scope);
      if (amount !== undefined) {
        // The amount's own range refusal, pending, is this one said again (Rule 12.4).
        retractKindlessRefusal(right);
        pushDiag(
          diagnostics,
          sourceFile,
          node.right,
          shiftAmountMessage(amount),
          TS_CODES.TYPE_MISMATCH,
        );
        return undefined;
      }
    }
    // A SHIFT amount is a u32 whatever the target is (§52). WGSL's only scalar overload is
    // `e1 << e2` with `e2: u32`, so `x << n` with an i32 `n` emitted `(x << n)`, which Tint
    // refuses with `no matching overload for 'operator << (i32, i32)'` — while `x << 1u`, the
    // one spelling it accepts, was refused HERE by the equal-types rule below. The compound
    // path (`y <<= n`) already did this; the binary path did not, which is the whole of row
    // L38. An integer literal takes u32, an i32 amount goes through the `u32(...)` cast the
    // surface already has, and GLSL ES 3.00 allows the mixed signedness that produces
    // (glsl-es-300.txt §5.9: the operands of a shift need not have the same type). `&`, `|`
    // and `^` keep the equality rule: there both operands must be one type on both targets.
    if (isShift) {
      // An integer-WRITTEN literal still types f32 by default (roadmap item 25), so
      // `1 << 0` — the way a bit flag is spelled — arrived here as two f32s. Retarget each
      // side to the kind a shift is defined for before the check below reads it; the amount
      // is then retyped to u32 again a few lines on, which is idempotent for a literal.
      // Of a value its uses decide, each asks an integer of no kind (change 0134 item 1).
      left = bitOperandLeaf(left, node.left, scope);
      right = bitOperandLeaf(right, node.right, scope);
      const [l, r] = [left, right];
      // A written target with no type of its own is an integer of no kind: a position that
      // declares the other integer type gives it that type (issue 1261).
      const writtenTarget = noKindOperand(l, node.left);
      // A written target only a `u32` holds (`0xF0000000 >> 28`) shifts a `u32` (change 0134
      // item 1); any other takes the `i32`.
      const lv =
        writtenTarget && !isKindlessBitwise(l) ? foldNumericLit(abstractLiteralOf(l) ?? l) : l;
      const targetT =
        lv.op === 'lit' && typeof lv.value === 'number' && lv.value > 2147483647 ? u32T : i32T;
      left = softDemands(() => retargetIntLitCtx(l, node.left, targetT));
      right = softDemands(() => retargetIntLitCtx(r, node.right, u32T));
      // A shift over written integers is a constant whatever type each operand took
      // (`(1 + 2) << 1` is 6): it is folded from the values, as `&`, `|` and `^` are.
      if (writtenTarget && noKindOperand(r, node.right) && laneCount(left.type) === 1) {
        const tree: Expr = { op: 'binop', type: targetT, bop: bit, a: left, b: right };
        if (foldKindless(tree) !== undefined) {
          return foldKindlessOrRefuse(tree, node, sourceFile, diagnostics);
        }
      }
      // A shift is defined componentwise, so read the ELEMENT kind: `vec2u << vec2u` is a
      // shift of two lanes, not a type error. The width rule below keeps the two sides the
      // same shape, which is what both targets accept.
      const amountKind = intElem(right.type);
      if (amountKind === undefined) {
        pushDiag(
          diagnostics,
          sourceFile,
          node.right,
          `Bitwise "${bit}" needs an i32 or u32 shift amount, got ${authorTypeText(right.type)}.`,
          TS_CODES.TYPE_MISMATCH,
        );
        return undefined;
      }
      const targetKind = intElem(left.type);
      if (targetKind === undefined) {
        pushDiag(
          diagnostics,
          sourceFile,
          node.left,
          `Bitwise "${bit}" needs an i32 or u32 target, got ${authorTypeText(left.type)}.`,
          TS_CODES.TYPE_MISMATCH,
        );
        return undefined;
      }
      // WGSL's vector overload is `vecN<T> << vecN<u32>` — the amount is a vector of the SAME
      // width, never a scalar broadcast (Tint: `no matching overload for 'operator << (vec2<u32>,
      // u32)'`). GLSL ES 3.00 §5.9 does allow the scalar form, so refusing it here is what keeps
      // one source compiling on both; splat the amount to say it explicitly.
      const lanes = laneCount(left.type);
      if (lanes !== laneCount(right.type)) {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `Bitwise "${bit}" shifts ${authorTypeText(left.type)} by ${authorTypeText(right.type)}: a shift amount ` +
            `has the width of its target. Splat it, e.g. ${authorTypeText(left.type)} << vec${String(lanes)}u(n).`,
          TS_CODES.TYPE_MISMATCH,
        );
        return undefined;
      }
      // A bare literal amount is retyped rather than wrapped, so `x << 1` stays one token.
      const folded = foldNumericLit(right);
      const amountT: ShaderType = lanes === 1 ? u32T : { kind: 'vec', n: lanes, elem: 'u32' };
      const amount: Expr =
        folded.op === 'lit' && typeof folded.value === 'number' && Number.isInteger(folded.value)
          ? { op: 'lit', type: u32T, value: folded.value }
          : amountKind === 'i32'
            ? lanes === 1
              ? { op: 'call', type: u32T, fn: 'u32', args: [right] }
              : { op: 'construct', type: amountT, args: [right] }
            : right;
      const shifted: Expr = { op: 'binop', type: left.type, bop: bit, a: left, b: amount };
      if (!writtenTarget || lanes !== 1) return shifted;
      return foldKindlessOrRefuse(shifted, node, sourceFile, diagnostics);
    }
    // `&`, `|` and `^` have no float overload on either target (Rule 7.1: WGSL's bit expressions
    // take the integer kinds, and `&` and `|` bools; GLSL ES 3.00 §5.9 takes integers only), but
    // this path compared only the two operand types. So `a & b` on two f32s emitted `(a & b)`,
    // which Tint refuses with `no matching overload for 'operator & (f32, f32)'`, and two f64s
    // came back from the fp64 pass as a span-less SD0041. A float operand is refused here, in
    // the author's words (Rule 12.6), and before the equal-types rule below, whose remedy for
    // `f32 & u32` begins with `f32(intVal)`: two floats, which is this refusal again.
    //
    // Two whole numbers in a module constant are the exception. `const M = 1 | 2` at module
    // scope, or an enum member over two flags, is folded to the number (§12) before a target
    // reads it, which compiles; that is left as it was. Anywhere else the pair is emitted, so
    // two written integers are made integers above, and a pair that is still `f32` (a whole
    // float-written number, or a module variable over module constants) is refused here: it
    // reached the targets as `(1.0 | 2.0)` before (issue 1261).
    // A value its uses decide is an integer here: the typed peer's, or of no kind (`f | 4`).
    // A written operand that an `i32` cannot hold makes it a `u32` (`f | 3000000000`).
    // The value of an operand with no type of its own: a written number, a constant of no fixed
    // type (`const K = 3000000000` reads as its number, as the written one does), or a bitwise
    // expression over those.
    const valueOf = (e: Expr): number | undefined => {
      const lit = foldNumericLit(abstractLiteralOf(e) ?? e);
      if (lit.op === 'lit' && typeof lit.value === 'number') return lit.value;
      return foldConstNumber(e, scope);
    };
    const kindless = (peer: Expr): 'int' | 'u32' => {
      const v = valueOf(peer);
      return v !== undefined && v > 2147483647 ? 'u32' : 'int';
    };
    // Two operands with no type of their own, each a written integer or a constant of no fixed
    // type that is one (`1 | 2`, `K | J`), or a bitwise expression over such operands, are each
    // a bitwise operand with no typed peer: an integer of no kind, an `i32` unless an operand
    // does not fit one (Rule 5.1, change 0134 item 1). They were left as two `f32`s, so
    // `let f = K | J` emitted `var f: f32 = (K | J);`, which no target accepts (issue 1261). A
    // module constant is folded to its number before any target reads it, so it keeps the
    // value it had. A written integer beside a bitwise expression of no kind took that
    // expression's `i32` in `pair` above, which is no type of its own either.
    // Whether an operand is a tree already or written arithmetic, which a module constant routes
    // through the fold; two single written numbers (`const M = 1 | 2`) keep the `f32` of `main`.
    const single = (n: ts.Expression): boolean => {
      const inner = skipParensNode(n);
      return ts.isNumericLiteral(inner) || isIntegerWrittenRead(inner);
    };
    const holdsTree =
      isKindlessBitwise(left) ||
      isKindlessBitwise(right) ||
      !single(node.left) ||
      !single(node.right);
    left = bitOperandLeaf(left, node.left, scope);
    right = bitOperandLeaf(right, node.right, scope);
    const leftKindless = isKindlessBitwise(left);
    const rightKindless = isKindlessBitwise(right);
    const noKind = (e: Expr, n: ts.Expression, peerKindless: boolean): boolean =>
      isKindlessBitwise(e) ||
      (writtenIntegerOperand(n) && (intElem(e.type) === undefined || peerKindless));
    let kindlessPair = false;
    // A module constant routes through the same fold, unless both operands are plain written
    // numbers (`const M = 1 | 2` keeps its `f32` 3.0, the value it had on `main`).
    if (
      !(scope.atModuleConstant() && !holdsTree) &&
      noKind(left, node.left, rightKindless) &&
      noKind(right, node.right, leftKindless)
    ) {
      const [lv, rv] = [valueOf(left), valueOf(right)];
      // A value only `u32` holds beside a negative one has no integer type: the written
      // `3000000000 | -1` would compute -1 in TypeScript, which no `u32` is.
      // Only a WRITTEN number makes the operator a `u32`'s (change 0134 item 1): a computed
      // value an `i32` does not hold (`(1 << 30) * 2`) is read as TypeScript reads it, ToInt32.
      const big = [
        [lv, left],
        [rv, right],
      ]
        .filter(([, e]) => !isKindlessBitwise(e as Expr))
        .map(([v]) => v as number | undefined)
        .find((v) => v !== undefined && v > 2147483647);
      const negative = [
        [lv, node.left],
        [rv, node.right],
      ].find(([v]) => v !== undefined && (v as number) < 0);
      if (big !== undefined && negative !== undefined) {
        const v = negative[0] as number;
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `Bitwise "${bit}" has no integer type for ${String(big)} and ${String(v)}: ` +
            `${String(big)} is a u32, and a u32 does not hold ${String(v)}. Write ` +
            `${String(v)} as its u32 bits, ${String(v >>> 0)}.`,
          TS_CODES.TYPE_MISMATCH,
        );
        return undefined;
      }
      const kind = big !== undefined ? u32T : i32T;
      const [l, r] = [left, right];
      left = softDemands(() => retargetIntLitCtx(l, node.left, kind));
      right = softDemands(() => retargetIntLitCtx(r, node.right, kind));
      // The value is computed from the whole expression and its type chosen from the value, so
      // the operands' own types, which a folded operand took from its value, do not matter.
      const tree: Expr = { op: 'binop', type: kind, bop: bit, a: left, b: right };
      if (foldKindless(tree) !== undefined) {
        return foldKindlessOrRefuse(tree, node, sourceFile, diagnostics);
      }
      kindlessPair = true;
    }
    noteDemand(left, intElem(right.type) === undefined ? kindless(right) : right.type);
    noteDemand(right, intElem(left.type) === undefined ? kindless(left) : left.type);
    const float = [left.type, right.type].find(isFloatBitOperand);
    if (float !== undefined && !(scope.atModuleConstant() && isWholeF32Pair(left, right, scope))) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        bitwiseFloatMessage(bit, float),
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    if (typeKey(left.type) !== typeKey(right.type)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        numericMismatch('bitwise', left.type, right.type),
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    // `&` and `|` take integers and bools, `^` integers alone: two bools under `^`, and two
    // structs, arrays or matrices under any of them, have one type and reached Tint as `no
    // matching overload` (Rule 7.1).
    if (refuseOperatorKind(bit, left.type, node, sourceFile, diagnostics)) return undefined;
    const result: Expr = { op: 'binop', type: left.type, bop: bit, a: left, b: right };
    return kindlessPair ? foldKindlessOrRefuse(result, node, sourceFile, diagnostics) : result;
  }
  const log = LOGICAL[node.operatorToken.kind];
  if (log !== undefined) {
    if (typeKey(left.type) !== 'bool' || typeKey(right.type) !== 'bool') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Logical "${log}" requires bool operands.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    if (rightSetup.length > 0) {
      const fixed: Expr = { op: 'lit', type: boolT, value: log === '||' };
      return log === '&&'
        ? scope.selectWithSetup(left, right, fixed, rightSetup)
        : scope.selectWithSetup(left, fixed, right, [], rightSetup);
    }
    return { op: 'logical', type: boolT, lop: log, a: left, b: right };
  }
  const cmp = COMPARE[node.operatorToken.kind];
  if (cmp !== undefined) {
    // A comparison reads a quotient of written integers exactly, in `f32` beside an `f32`, and no
    // number flows on: the `/` gives TypeScript's answer, so it stands (THE RULE, verdict 4).
    if (typeKey(left.type) === 'f32' && typeKey(right.type) === 'f32') {
      for (const [e, n] of [
        [left, node.left],
        [right, node.right],
      ] as const) {
        readKindlessExactly(e);
        if (isIntegerQuotient(e)) noteWrittenDivisionRead(skipParensNode(n), sourceFile, 'read');
      }
    }
    // An f32 compared against a scalar f64 widens exactly, the same rule the arithmetic
    // follows and the one `binResultType` applies in the fn() EDSL, whose `f64.lt(f32)`
    // builds and emits. Without it `s < t` was a mismatch while `s - t < 0.` was not (#151).
    if (f64WidenResultType(left.type, right.type, '-') !== undefined) {
      return { op: 'compare', type: boolT, cop: cmp, a: left, b: right };
    }
    if (typeKey(left.type) !== typeKey(right.type)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        numericMismatch('compare', left.type, right.type),
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    // Two vectors compare componentwise and yield a vector of bools (§27), which `any`, `all`
    // and `select` take. A vector of emulated doubles is one too: §39 gives it the six
    // comparisons, and the fp64 pass lowers them lane by lane. Typed as one scalar bool, as it
    // was, `a < b` on two `vec3f64` was refused wherever a mask goes and reached WGSL as a `<`
    // on two structs wherever a bool does. An ordering on bools has no meaning on either target.
    if (left.type.kind === 'vec' || isVec64(left.type)) {
      if (left.type.kind === 'vec' && left.type.elem === 'bool' && cmp !== '==' && cmp !== '!=') {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `"${cmp}" has no meaning on ${authorTypeText(left.type)}: compare bool vectors with === or !==, or reduce them with any() or all().`,
          TS_CODES.TYPE_MISMATCH,
        );
        return undefined;
      }
      return {
        op: 'compare',
        type: { kind: 'vec', n: left.type.n, elem: 'bool' },
        cop: cmp,
        a: left,
        b: right,
      };
    }
    // An ordering takes numbers, and `===` a scalar or a vector: two bools under `<`, and two
    // matrices, structs or arrays under either, have one type and no WGSL overload (Rule 7.1).
    if (
      refuseOperatorKind(
        node.operatorToken.getText(sourceFile),
        left.type,
        node,
        sourceFile,
        diagnostics,
      )
    ) {
      return undefined;
    }
    return { op: 'compare', type: boolT, cop: cmp, a: left, b: right };
  }
  if (node.operatorToken.kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'Unsigned right shift >>> is not supported.',
      TS_CODES.UNSUPPORTED,
    );
    return undefined;
  }
  pushDiag(diagnostics, sourceFile, node, 'Unsupported binary operator.', TS_CODES.UNSUPPORTED);
  return undefined;
}

/** The integer element kind of a shift/bitwise operand — the scalar's own kind, or a
 *  vector's element — or undefined when the type is not an integer one. */
function intElem(t: ShaderType): 'i32' | 'u32' | undefined {
  const k = t.kind === 'vec' ? t.elem : typeKey(t);
  return k === 'i32' || k === 'u32' ? k : undefined;
}

/** How many lanes a value carries: a vector's width, 1 for a scalar. */
function laneCount(t: ShaderType): 1 | 2 | 3 | 4 {
  return t.kind === 'vec' ? t.n : 1;
}

/** `pow` is float-only on both targets: an f32 scalar, or a vector of f32. An emulated-double
 *  is out too — there is no df64 pow. */
function isFloatPowOperand(t: ShaderType): boolean {
  if (t.kind === 'vec') return t.elem === 'f32';
  return typeKey(t) === 'f32';
}

/** Whether `t` is a float that `&`, `|` and `^` have no overload for on either target: an f32,
 *  a vector of f32, or an emulated double, scalar or vector. */
function isFloatBitOperand(t: ShaderType): boolean {
  if (t.kind === 'vec') return t.elem === 'f32';
  return typeKey(t) === 'f32' || isF64(t) || isVec64(t);
}

/** Whether both operands are f32 whole numbers the front end folds (`foldConstNumber`): `1 | 2`,
 *  or two flags declared `const A = 1`. A module constant, an enum member and a `case` label
 *  hold the folded number, so no operator reaches a target there. */
function isWholeF32Pair(a: Expr, b: Expr, scope: LoweringScope): boolean {
  return [a, b].every((e) => {
    if (typeKey(e.type) !== 'f32') return false;
    const v = foldConstNumber(e, scope);
    return v !== undefined && Number.isInteger(v);
  });
}

/** The sentence `&`, `|` and `^` raise for a float operand (Rule 12.1): the kind, then the
 *  conversion to write, which the surface has for each kind. An f32 may be reinterpreted
 *  instead (`bitcast<u32>`, surface §44), and an emulated double narrows to f32 before any
 *  integer conversion, as its casts require. */
function bitwiseFloatMessage(bit: BinOp, t: ShaderType): string {
  const fix =
    t.kind === 'vec'
      ? `Convert first, e.g. vec${String(t.n)}u(a) ${bit} vec${String(t.n)}u(b).`
      : t.kind === 'vec64'
        ? `Narrow and convert first, e.g. vec${String(t.n)}u(vec${String(t.n)}(a)) ${bit} ` +
          `vec${String(t.n)}u(vec${String(t.n)}(b)).`
        : isF64(t)
          ? `Narrow and convert first, e.g. u32(f32(a)) ${bit} u32(f32(b)).`
          : `Convert first, e.g. u32(a) ${bit} u32(b), or reinterpret the bits with bitcast<u32>(a).`;
  return `Bitwise "${bit}" needs i32 or u32 operands, got ${authorTypeText(t)}. ${fix}`;
}

function pushDiag(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code));
}

export function exprType(expr: Expr): ShaderType {
  return expr.type;
}

/** A string literal written where the key type `t` is expected: its id, a `u32` literal of `t`
 *  (change 0081). A string outside the union is refused, with the members it could be. */
function keyLiteral(
  node: ts.StringLiteralLike,
  t: ShaderType,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const keys = keysOf(t)!;
  const id = keys.indexOf(node.text);
  if (id < 0) {
    // On the comparison it is an operand of, where TypeScript reports the two types as having
    // no overlap (TS2367), so the editor reads the two as one mistake (Rule 12.4).
    const p = node.parent;
    const at =
      ts.isBinaryExpression(p) && KEY_OPERATORS.has(p.operatorToken.kind) ? p : placeOf(node);
    pushDiag(
      diagnostics,
      sourceFile,
      at,
      `${JSON.stringify(node.text)} is not a member of ${keyTypeText(keys)}, so it has no id ` +
        `there. Write one of the members.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  return { op: 'lit', type: t, value: id };
}

const skipParens = (e: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(e) ? skipParens(e.expression) : e;

/** The operators a key-type value takes (change 0081): `===` and `!==` (and `==`, `!=`). */
const KEY_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

/** Refuses a binary operator on a key-type value other than an equality against a value of the
 *  same key type (change 0081): its id is no number an author computes with, and two key types,
 *  or a key and a number, have no value in common. True when it refused. */
function refuseKeyOperands(
  node: ts.BinaryExpression,
  a: ShaderType,
  b: ShaderType,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  const ka = keysOf(a);
  const kb = keysOf(b);
  if (ka === undefined && kb === undefined) return false;
  const op = node.operatorToken.getText(sourceFile);
  if (!KEY_OPERATORS.has(node.operatorToken.kind)) {
    const keys = (ka ?? kb)!;
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `A value of ${keyTypeText(keys)} is one of its members, and "${op}" has nothing to do ` +
        `with one: compare it with === or !==, or switch over it.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return true;
  }
  if (ka !== undefined && kb !== undefined && sameKeys(ka, kb)) return false;
  const text = (t: ShaderType): string => {
    const k = keysOf(t);
    return k === undefined ? authorTypeText(t) : keyTypeText(k);
  };
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `"${op}" compares ${text(a)} with ${text(b)}, and the two have no value in common. ` +
      `Compare a key with a member of its own union.`,
    TS_CODES.TYPE_MISMATCH,
  );
  return true;
}

const isNumberLiteral = (e: ts.Expression): boolean =>
  ts.isNumericLiteral(e) ||
  (ts.isPrefixUnaryExpression(e) && ts.isNumericLiteral(skipParens(e.operand)));

/** Whether a value of `got` in a place of `want` mixes a key type with a u32 that is no key of
 *  it, or two key types (change 0081). Both are a u32 to every check that reads `typeKey`, so
 *  this is the one place that tells them apart. */
function keysDisagree(want: ShaderType | undefined, got: ShaderType): boolean {
  if (want === undefined || typeKey(want) !== 'u32' || typeKey(got) !== 'u32') return false;
  const kw = keysOf(want);
  const kg = keysOf(got);
  if (kw === undefined && kg === undefined) return false;
  return kw === undefined || kg === undefined || !sameKeys(kw, kg);
}

/** The sentence for a key type and a value that is none of its members, or a key in a place
 *  of another type (change 0081). */
function keyMismatchSentence(text: string, want: ShaderType, got: ShaderType | undefined): string {
  const kw = keysOf(want);
  const kg = got === undefined ? undefined : keysOf(got);
  const gotText =
    kg !== undefined ? keyTypeText(kg) : got !== undefined ? authorTypeText(got) : 'a number';
  if (kw !== undefined) {
    return (
      `"${text}" is ${gotText}, and a place of ${keyTypeText(kw)} holds one of its members. ` +
      `Write a member as a string.`
    );
  }
  return (
    `"${text}" is ${gotText}, a key and not a number, and this place is ` +
    `${authorTypeText(want)}. Compare it with a member, or switch over it.`
  );
}

/** Where a value that does not fit its place is reported: the declaration, the assignment, the
 *  `return` or the property it is written in, as a declared type mismatch is, so that the
 *  editor reads TypeScript's TS2322 there as the same mistake (Rule 12.4). */
export function placeOf(node: ts.Expression): ts.Node {
  const p = node.parent;
  if (
    (ts.isVariableDeclaration(p) && p.initializer === node) ||
    (ts.isPropertyAssignment(p) && p.initializer === node) ||
    (ts.isReturnStatement(p) && p.expression === node) ||
    (ts.isBinaryExpression(p) &&
      p.right === node &&
      p.operatorToken.kind === ts.SyntaxKind.EqualsToken)
  ) {
    return p;
  }
  return node;
}
