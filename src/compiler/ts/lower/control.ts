import ts from 'typescript';
import type { BinOp, Expr, Stmt } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { boolT, i32T, isVec, isVec64, typeKey, u32T } from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { authorTypeText, dropsRecoveredUse, type LoweringScope } from '../context.js';
import { irNameOf, readOnlyPhrase, writableRemedy, writeRules } from '../context.js';
import {
  analyzeCountedFor,
  type CountedLoop,
  boundWrittenIn,
  comparesToBound,
  foldConstNumber,
  forUpdateRefusal,
  openLoopError,
} from '../loop-bound.js';
import { fitsTarget, isIntScalar } from '../lit-coerce.js';
import { mapTsTypeToShaderType } from '../type-map.js';
import { numericMismatch } from '../numeric.js';
import { makeDiagnostic } from '../diagnostic.js';
import { withSpan } from '../span.js';
import { TS_CODES, type TsCode } from '../codes.js';
import { reportIntLitRange, retargetDeclaredIntLit } from '../lit-coerce.js';
import { lowerExpression, unknownIdentifierSentence } from './expression.js';
import { arrayLengthOf } from './expression-prop.js';
import { lowerLValue, lowerStatement, lowerStatements, refuseParamWrite } from './statement.js';
import { finishAccessorWrite, lowerAccessorTarget, refuseReadonlyWrite } from './class-access.js';
import { unknownNameAlreadyReported } from '../refused-names.js';
import { fallsIntoABody } from '../fallthrough.js';

/**
 * A counted `for` (Rule 7.5), or undefined after an error that says why it is not one.
 *
 * The caller drops a statement this returns nothing for, so a refusal that reports nothing
 * deletes the loop, body and all, from both targets: `for (…; v.x += 1.)` and `for (…; zz += 1)`
 * compiled that way with no diagnostic (Rule 12.6). Each refusal below says why; this keeps
 * the invariant for any that does not, with a `TS8099` that says the loop was refused, not
 * dropped. A header that reads a name whose declaration was refused, a `const` or a function
 * alike, is explained by that refusal, which a read of the name does not repeat (Rule 12.4,
 * #171).
 */
export function lowerFor(
  node: ts.ForStatement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  const errors = errorCount(diagnostics);
  const loop = lowerCountedFor(node, sourceFile, scope, diagnostics);
  if (
    loop === undefined &&
    errorCount(diagnostics) === errors &&
    !readsARefusedName(node, sourceFile, scope, diagnostics)
  ) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'for loop could not be lowered, and no other diagnostic says why. It is refused rather ' +
        'than left out of the module; report it as a compiler bug.',
      TS_CODES.UNSUPPORTED,
    );
  }
  return loop;
}

function errorCount(diagnostics: readonly TsCompilerDiagnostic[]): number {
  return diagnostics.filter((d) => d.category === 'error').length;
}

/** Whether the `for` header reads a name an error already stands for: `i < n` for a refused
 *  `declare const n: i32` is not lowered, and says nothing more than the declaration's
 *  refusal. Nor is `i < lim(1)` for a `function lim(x?: i32)` whose signature was refused,
 *  which a call of it answers by the same predicate (`declarationRefused`). The header is
 *  where every `undefined` of {@link lowerCountedFor} comes from. */
function readsARefusedName(
  node: ts.ForStatement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: readonly TsCompilerDiagnostic[],
): boolean {
  const refused = (n: ts.Identifier): boolean =>
    scope.declarationRefused(n.text) ||
    unknownNameAlreadyReported(n, n.text, sourceFile, diagnostics);
  const reads = (n: ts.Node): boolean =>
    (ts.isIdentifier(n) && refused(n)) || ts.forEachChild(n, (c) => reads(c) || undefined) === true;
  return [node.initializer, node.condition, node.incrementor].some((h) => h && reads(h));
}

function lowerCountedFor(
  node: ts.ForStatement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  if (!node.condition) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'for is missing an exit condition. A for loop is counted; a loop that ends at a break ' +
        'is "while (true) { … }".',
      TS_CODES.LOOP_INFINITE,
    );
    return undefined;
  }
  if (!node.initializer || !ts.isVariableDeclarationList(node.initializer)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'for-init must be `let i: i32 = <start>`.',
      TS_CODES.LOOP_INDUCTION,
    );
    return undefined;
  }
  if (!node.incrementor) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'for-update is required (e.g. i++).',
      TS_CODES.LOOP_INDUCTION,
    );
    return undefined;
  }
  scope.push();
  scope.enterLoop();
  try {
    const hint = counterTypeFromBound(node, node.initializer, sourceFile, scope);
    const initStmt = lowerForInit(node.initializer, sourceFile, scope, diagnostics, hint);
    if (!initStmt) return undefined;
    // The `for` header's own two statements never pass through `lowerStatement`, so the
    // blanket stamp there does not reach them; give each the span of the clause it came from
    // rather than the whole loop's, so stepping a loop highlights `let i: i32 = 0` and `i++`.
    withSpan(initStmt, sourceFile, node.initializer);
    const cond = lowerExpression(node.condition, sourceFile, scope, diagnostics);
    if (!cond) return undefined;
    if (typeKey(cond.type) !== 'bool') {
      pushDiag(
        diagnostics,
        sourceFile,
        node.condition,
        `for condition must be bool, got ${authorTypeText(cond.type)}.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    // lowerForInit took exactly one identifier, the counter as the author spelled it.
    const counter = node.initializer.declarations[0]!.name.getText(sourceFile);
    if (initStmt.s === 'var') {
      const extra = extraExitClause(node.condition, cond, initStmt.name, sourceFile, scope);
      if (extra !== undefined) {
        pushDiag(diagnostics, sourceFile, node.condition, extra, TS_CODES.LOOP_BOUND);
        return undefined;
      }
    }
    const update = lowerUpdate(node.incrementor, sourceFile, scope, diagnostics, counter);
    if (!update) return undefined;
    withSpan(update, sourceFile, node.incrementor);
    const counted = analyzeCountedFor(initStmt, cond, update, scope);
    if (!counted.ok) {
      pushDiag(diagnostics, sourceFile, node, counted.message, counted.code);
      return undefined;
    }
    const body = lowerBody(node.statement, sourceFile, scope, diagnostics);
    // A runtime bound counts the loop only if the body leaves it alone (Rule 7.5).
    const moved = boundWrittenIn(cond, initStmt.s === 'var' ? initStmt.name : '', scope, body);
    if (moved !== undefined) {
      pushDiag(
        diagnostics,
        sourceFile,
        node.condition,
        `for bound reads "${moved}", which the loop body writes, so it does not bound the ` +
          `loop. Read it into a const before the loop, or write the loop as a while.`,
        TS_CODES.LOOP_BOUND,
      );
      return undefined;
    }
    return { s: 'for', init: initStmt, cond, update, body, counted: countedFact(counted.loop) };
  } finally {
    scope.exitLoop();
    scope.pop();
  }
}

/**
 * The type an unannotated counter takes from the bound it is compared with (Rule 7.5).
 *
 * `for (let i = 0; i < data.length; i++)` is the loop a TypeScript author writes first, and
 * `data.length` is a `u32`. An unannotated counter was always an `i32`, so the comparison was
 * `TS8003 cannot compare i32 and u32`, a type the author never wrote. A counter whose initializer
 * is a plain non-negative integer literal and whose bound is a `u32` is a `u32`, which is the one
 * type the loop can have. Anything else keeps the `i32` default: an annotation, a negative or
 * computed start, an `i32` or float bound.
 *
 * The bound is lowered once here into a scratch list, to read its type, and again where the
 * condition is lowered, which reports its diagnostics. Lowering an expression declares nothing.
 */
function counterTypeFromBound(
  node: ts.ForStatement,
  list: ts.VariableDeclarationList,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
): ShaderType | undefined {
  const decl = list.declarations[0];
  if (!decl || list.declarations.length !== 1 || decl.type || !ts.isIdentifier(decl.name)) {
    return undefined;
  }
  let start = decl.initializer;
  while (start && ts.isParenthesizedExpression(start)) start = start.expression;
  if (!start || !ts.isNumericLiteral(start) || !/^\d+$/.test(start.text)) return undefined;
  const name = decl.name.text;
  const isCounter = (e: ts.Expression): boolean => ts.isIdentifier(e) && e.text === name;
  // Under an `&&` exit, the clause that compares the counter: the loop is refused for its
  // other clause (`extraExitClause`), and it should be told that, not "cannot compare i32 and
  // u32" about the counter's type.
  const compared = (e: ts.Expression): ts.BinaryExpression | undefined => {
    if (ts.isParenthesizedExpression(e)) return compared(e.expression);
    if (!ts.isBinaryExpression(e)) return undefined;
    if (e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return compared(e.left) ?? compared(e.right);
    }
    const counted = isCounter(e.left) || isCounter(e.right);
    return COMPARISONS.has(e.operatorToken.kind) && counted ? e : undefined;
  };
  const cond = node.condition && compared(node.condition);
  if (!cond) return undefined;
  const bound = isCounter(cond.left) ? cond.right : cond.left;
  const lowered = lowerExpression(bound, sourceFile, scope, []);
  return lowered && typeKey(lowered.type) === 'u32' ? lowered.type : undefined;
}

const COMPARISONS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

/**
 * The refusal of an exit that joins the counter's bound with `&&` to another test, or
 * undefined when the exit is not that shape (Rule 7.5).
 *
 * `for (let i: i32 = 0; i < 8 && i !== 3; i++)` does compare `i` to a bound, so the general
 * sentence, that the exit must compare it to one, was false of it. The refused part is the
 * other clause, and the loop that says the same thing tests it as the body's first statement,
 * negated, and leaves with a `break`: the header's clauses and that test end the same trips.
 * The negation is written as one comparison where that is exact, which is `===` against `!==`
 * always and an ordering on integers; `!(a < b)` is not `a >= b` for a NaN, so a float
 * ordering, and anything else, is negated whole.
 */
function extraExitClause(
  written: ts.Expression,
  cond: Expr,
  counter: string,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
): string | undefined {
  const clauses: ts.Expression[] = [];
  const lowered: Expr[] = [];
  const split = (w: ts.Expression): void => {
    if (ts.isParenthesizedExpression(w)) return split(w.expression);
    if (
      ts.isBinaryExpression(w) &&
      w.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      split(w.left);
      split(w.right);
    } else clauses.push(w);
  };
  const splitIr = (e: Expr): void => {
    if (e.op === 'logical' && e.lop === '&&') {
      splitIr(e.a);
      splitIr(e.b);
    } else lowered.push(e);
  };
  split(written);
  splitIr(cond);
  if (clauses.length < 2 || clauses.length !== lowered.length) return undefined;
  // The bound is the clause that compares the counter, an ordering before an equality, so
  // `i !== 3 && i < 8` is told about `i !== 3` as `i < 8 && i !== 3` is.
  const bounds = lowered.flatMap((c, k) => (comparesToBound(c, counter, scope) ? [k] : []));
  const ordering = (k: number): boolean => {
    const c = lowered[k]!;
    return c.op === 'compare' && c.cop !== '==' && c.cop !== '!=';
  };
  const at = bounds.find(ordering) ?? bounds[0];
  if (at === undefined) return undefined;
  const text = (w: ts.Expression): string => w.getText(sourceFile);
  const rest = clauses.filter((_, k) => k !== at);
  // `split` took the author's parentheses off each clause, and a clause that binds looser than
  // `&&` needs them back to stay one clause beside another: `(a || b) && c` joined bare read
  // as `a || (b && c)`, a different test and a `break` that ran other trips.
  const joined =
    rest.length === 1
      ? text(rest[0]!)
      : rest.map((w) => (loose(w) ? `(${text(w)})` : text(w))).join(' && ');
  const test =
    rest.length === 1 ? negated(rest[0]!, lowered[at === 0 ? 1 : 0]!, sourceFile) : undefined;
  const leave = test ?? `!(${joined})`;
  return (
    `for exit joins the bound "${text(clauses[at]!)}" with "${joined}", ` +
    `and a counted loop's exit is its bound alone. Make "if (${leave}) { break; }" the body's ` +
    `first statement, or write the loop as a while.`
  );
}

/** Whether `w`'s own operator binds looser than `&&`, so that it takes parentheses to stand as
 *  one operand of it: `||`, `??`, `?:`, an assignment or a comma. */
function loose(w: ts.Expression): boolean {
  if (ts.isConditionalExpression(w)) return true;
  if (!ts.isBinaryExpression(w)) return false;
  const k = w.operatorToken.kind;
  return (
    k === ts.SyntaxKind.BarBarToken ||
    k === ts.SyntaxKind.QuestionQuestionToken ||
    k === ts.SyntaxKind.CommaToken ||
    (k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment)
  );
}

/** The comparison's source operators and their negations. */
const NEGATED: Readonly<Partial<Record<ts.SyntaxKind, string>>> = {
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: '!==',
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]: '===',
  [ts.SyntaxKind.EqualsEqualsToken]: '!=',
  [ts.SyntaxKind.ExclamationEqualsToken]: '==',
  [ts.SyntaxKind.LessThanToken]: '>=',
  [ts.SyntaxKind.LessThanEqualsToken]: '>',
  [ts.SyntaxKind.GreaterThanToken]: '<=',
  [ts.SyntaxKind.GreaterThanEqualsToken]: '<',
};

/** `clause` negated, as the author would write it: one comparison flipped where that is exact
 *  (see {@link extraExitClause}), `!ok` read as `ok`, else `!` over the whole of it. */
function negated(clause: ts.Expression, lowered: Expr, sourceFile: ts.SourceFile): string {
  const text = clause.getText(sourceFile);
  if (ts.isPrefixUnaryExpression(clause) && clause.operator === ts.SyntaxKind.ExclamationToken) {
    let operand: ts.Expression = clause.operand;
    while (ts.isParenthesizedExpression(operand)) operand = operand.expression;
    return operand.getText(sourceFile);
  }
  if (ts.isBinaryExpression(clause) && lowered.op === 'compare') {
    const flip = NEGATED[clause.operatorToken.kind];
    const exact = lowered.cop === '==' || lowered.cop === '!=' || isIntScalar(lowered.a.type);
    if (flip !== undefined && exact) {
      return `${clause.left.getText(sourceFile)} ${flip} ${clause.right.getText(sourceFile)}`;
    }
  }
  const bare =
    ts.isIdentifier(clause) ||
    clause.kind === ts.SyntaxKind.TrueKeyword ||
    clause.kind === ts.SyntaxKind.FalseKeyword ||
    ts.isCallExpression(clause) ||
    ts.isPropertyAccessExpression(clause) ||
    ts.isElementAccessExpression(clause);
  return bare ? `!${text}` : `!(${text})`;
}

function lowerForInit(
  list: ts.VariableDeclarationList,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  hint: ShaderType | undefined,
): Stmt | undefined {
  const decl = list.declarations[0];
  if (!decl || list.declarations.length !== 1 || !ts.isIdentifier(decl.name)) {
    pushDiag(
      diagnostics,
      sourceFile,
      list,
      'for-init must declare exactly one identifier.',
      TS_CODES.LOOP_INDUCTION,
    );
    return undefined;
  }
  if ((list.flags & ts.NodeFlags.Let) === 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      list,
      'for-init must be `let` (mutable induction).',
      TS_CODES.LOOP_INDUCTION,
    );
    return undefined;
  }
  const name = decl.name.text;
  if (!decl.initializer) {
    pushDiag(
      diagnostics,
      sourceFile,
      decl,
      `for-init "${name}" requires an initializer.`,
      TS_CODES.LOOP_INDUCTION,
    );
    return undefined;
  }
  const annotated = decl.type
    ? mapTsTypeToShaderType(decl.type, sourceFile, diagnostics)
    : undefined;
  let init = lowerExpression(decl.initializer, sourceFile, scope, diagnostics);
  if (!init) return undefined;
  // The induction variable's declared type, or i32 when there is no annotation, since that is
  // the type it must have. `for (let j: i32 = -1; …)` reaches this with a PrefixUnaryExpression
  // rather than a NumericLiteral, which the `init.op === 'lit'` special case this replaces
  // never matched — so the initializer kept the f32 the bare `1` was given and the loop emitted
  // `var j: i32 = -1.0`, with no diagnostic, which neither Tint nor ANGLE accepts (issue #40).
  const counterType = annotated ?? hint ?? i32T;
  init = retargetDeclaredIntLit(init, decl.initializer, counterType);
  // Out of range, the §13 sentence is the one diagnostic: the loop-bound walk below would
  // otherwise add a second one about a start value the author has already been told about.
  if (reportIntLitRange(init, decl.initializer, counterType, sourceFile, diagnostics)) {
    return undefined;
  }
  if (annotated && typeKey(annotated) !== typeKey(init.type)) {
    // The check statement.ts has always had at its own declaration site, and the reason this
    // one was silent rather than merely wrong: nothing compared the two.
    pushDiag(
      diagnostics,
      sourceFile,
      decl,
      numericMismatch(`for-init ${name}`, annotated, init.type),
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  const type: ShaderType = annotated ?? init.type;
  const k = typeKey(type);
  if (k !== 'i32' && k !== 'u32') {
    pushDiag(
      diagnostics,
      sourceFile,
      decl,
      `for induction must be i32 or u32, got ${authorTypeText(type)}.`,
      TS_CODES.LOOP_INDUCTION,
    );
    return undefined;
  }
  const bound = scope.define({
    kind: 'local',
    name,
    type,
    mutable: true,
    constValue: init.op === 'lit' ? init.value : undefined,
  });
  scope.recordDeclaration(sourceFile, decl.name, { name, kind: 'local', type, mutable: true });
  // What a local function in the loop body reads `i` through (Rule 8.17).
  scope.bindDeclaration(decl, bound);
  // Two sequential loops over `i` are the first shape a shader author writes; the second
  // counter takes the IR name `i_1` so the two never collide in the function (#38).
  return { s: 'var', name: irNameOf(bound), type, init };
}

export function lowerWhile(
  node: ts.WhileStatement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  const cond = lowerExpression(node.expression, sourceFile, scope, diagnostics);
  if (!cond) return undefined;
  const written = node.expression.getText(sourceFile);
  if (typeKey(cond.type) !== 'bool') {
    pushDiag(
      diagnostics,
      sourceFile,
      node.expression,
      whileConditionSentence(cond, written, scope),
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  const err = openLoopError(cond, scope, bodyHasExit(node.statement), written);
  if (err) {
    pushDiag(diagnostics, sourceFile, node, err.message, err.code);
    return undefined;
  }
  scope.enterLoop();
  try {
    // The IR has one loop statement, the `for`, so a `while` is a `for` whose counter nothing
    // reads. The counter is an `i32` whatever the condition compares: it used to take the
    // type of the condition's left operand, which made it an `f32` under `while (a < 4.)` and
    // a `bool` under `while (true)`. It is a name of the compiler's own, so it takes one no
    // other local has and binds no source name: written as `_w` outright, it collided with an
    // author's `_w` and with the counter of a second `while` in the function, in the backend.
    const name = scope.defineTemp('_w', i32T, true);
    const body = lowerBody(node.statement, sourceFile, scope, diagnostics);
    const w = { op: 'varref' as const, type: i32T, name };
    return {
      s: 'for',
      init: { s: 'var', name, type: i32T, init: { op: 'lit', type: i32T, value: 0 } },
      cond,
      update: {
        s: 'assign',
        target: w,
        expr: { op: 'binop', type: i32T, bop: '+', a: w, b: { op: 'lit', type: i32T, value: 1 } },
      },
      body,
    };
  } finally {
    scope.exitLoop();
  }
}

/** The sentence for a `while` whose condition is not a `bool`, as `if` and `for` have one
 *  (Rules 7.5, 12.6). TypeScript takes any value there by its truthiness, and the loop compiled
 *  with no word; Tint then refused the module, "for-loop condition must be bool". A number is
 *  compared with zero and a vector of bools reduced with `any`, the spellings that say what
 *  the truthiness did; a struct, an array or a numeric vector has no one such spelling, and
 *  neither has a constant (`E.A`), whose comparison the editor refuses as always the same
 *  (TS2367). */
function whileConditionSentence(cond: Expr, written: string, scope: LoweringScope): string {
  const type = cond.type;
  const said = `while condition must be bool, got ${authorTypeText(type)}.`;
  if (foldConstNumber(cond, scope) !== undefined) return said;
  const operand = /^[\w$.]+$/.test(written) ? written : `(${written})`;
  if (type.kind === 'scalar' && (type.scalar === 'f32' || isIntScalar(type))) {
    return `${said} Compare it with zero: while (${operand} !== ${type.scalar === 'f32' ? '0.' : '0'}).`;
  }
  if (isVec(type) && type.elem === 'bool') {
    return `${said} Reduce it: while (any(${written})) or while (all(${written})).`;
  }
  return said;
}

/** Whether a `while` body can leave its loop: a `break` that belongs to it, or a `return`.
 *  A `break` inside a nested loop or a `switch` leaves that statement instead, and a nested
 *  function's `return` is its own; labels are refused (surface §17), so no `break` names an
 *  outer loop. */
function bodyHasExit(body: ts.Statement): boolean {
  const walk = (n: ts.Node, ownsBreak: boolean): boolean => {
    if (ts.isReturnStatement(n)) return true;
    if (ts.isBreakStatement(n)) return ownsBreak && n.label === undefined;
    if (ts.isFunctionLike(n) || ts.isClassLike(n)) return false;
    const nested = ts.isIterationStatement(n, false) || ts.isSwitchStatement(n) ? false : ownsBreak;
    return ts.forEachChild(n, (c) => walk(c, nested) || undefined) === true;
  };
  return walk(body, true);
}

/**
 * `for (const x of xs)` over an array: a counted loop over its indices (Rules 7.2, 7.5).
 *
 * `for (var _i: u32 = 0u; _i < len; _i = _i + 1u) { let x = xs[_i]; … }`, where `len` is the
 * array's size for an `array<T, N>` and `arrayLength(&xs)` for a runtime-sized storage array.
 * The element is read at the top of each trip, as TypeScript's array iterator reads it, and a
 * `let x` is a copy the body may change without writing the array. The array must be a place,
 * a name or a member or index path to one, since it is read on every trip and a place is the
 * only expression both targets read twice for what it read once.
 */
export function lowerForOf(
  node: ts.ForOfStatement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  if (node.awaitModifier) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'for await iterates an async JS iterable. Shader functions are synchronous.',
      TS_CODES.HOST_STMT,
    );
    return undefined;
  }
  const list = node.initializer;
  const decl = ts.isVariableDeclarationList(list) ? list.declarations[0] : undefined;
  if (
    !ts.isVariableDeclarationList(list) ||
    list.declarations.length !== 1 ||
    !decl ||
    !ts.isIdentifier(decl.name) ||
    (list.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let)) === 0
  ) {
    pushDiag(
      diagnostics,
      sourceFile,
      list,
      'for-of declares one element: `for (const x of xs)` or `for (let x of xs)`.',
      TS_CODES.LOOP_INDUCTION,
    );
    return undefined;
  }
  const array = lowerExpression(node.expression, sourceFile, scope, diagnostics);
  if (!array) return undefined;
  if (array.type.kind !== 'array') {
    pushDiag(
      diagnostics,
      sourceFile,
      node.expression,
      `for-of iterates an array; this is a ${authorTypeText(array.type)}. Index it with a counted ` +
        `for, or write the value into an array<T, N>.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  if (!isPlace(array)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node.expression,
      'for-of reads its array on every trip, so the array has to be a name: bind it first, ' +
        '`const xs = …; for (const x of xs)`.',
      TS_CODES.LOOP_BOUND,
    );
    return undefined;
  }
  const length =
    array.type.size !== undefined
      ? ({ op: 'lit', type: u32T, value: array.type.size } as const)
      : arrayLengthOf(array, node.expression, sourceFile, scope, diagnostics, '.length');
  if (!length) return undefined;
  const elemType = array.type.elem;
  const mutable = (list.flags & ts.NodeFlags.Let) !== 0;
  scope.push();
  scope.enterLoop();
  try {
    // The counter is a name of the compiler's own, which an author cannot write (Rule 2.2): it
    // binds no source name, so an `_i` the body reads is the author's. Bound as `_i`, the body's
    // `f32(_i)` read the counter and not the author's `let _i`, with no diagnostic.
    const i = { op: 'varref' as const, type: u32T, name: scope.defineTemp('_i', u32T, true) };
    let element;
    try {
      element = scope.define({ kind: 'local', name: decl.name.text, type: elemType, mutable });
    } catch (e) {
      pushDiag(
        diagnostics,
        sourceFile,
        decl.name,
        e instanceof Error ? e.message : String(e),
        TS_CODES.DUPLICATE_SYMBOL,
      );
      return undefined;
    }
    scope.recordDeclaration(sourceFile, decl.name, {
      name: decl.name.text,
      kind: 'local',
      type: elemType,
      mutable,
    });
    const read: Expr = { op: 'index', type: elemType, base: array, idx: i };
    const bind: Stmt = mutable
      ? { s: 'var', name: irNameOf(element), type: elemType, init: read }
      : { s: 'let', name: irNameOf(element), expr: read };
    withSpan(bind, sourceFile, list);
    const body = lowerBody(node.statement, sourceFile, scope, diagnostics);
    const one = { op: 'lit' as const, type: u32T, value: 1 };
    return {
      s: 'for',
      init: { s: 'var', name: i.name, type: u32T, init: { op: 'lit', type: u32T, value: 0 } },
      cond: { op: 'compare', type: boolT, cop: '<', a: i, b: length },
      update: { s: 'assign', target: i, expr: { op: 'binop', type: u32T, bop: '+', a: i, b: one } },
      body: [bind, ...body],
      // A counted loop over the array's indices (Rule 7.5), from 0 by 1.
      counted: {
        name: i.name,
        op: 'add',
        step: 1,
        start: 0,
        ...(array.type.size !== undefined
          ? { bound: array.type.size, trips: array.type.size }
          : {}),
      },
    };
  } finally {
    scope.exitLoop();
    scope.pop();
  }
}

/** The counted fact the IR `for` carries (Rule 7.5), with no absent field written out. */
function countedFact(loop: CountedLoop): NonNullable<(Stmt & { s: 'for' })['counted']> {
  return {
    name: loop.name,
    op: loop.op,
    step: loop.step,
    ...(loop.start !== undefined ? { start: loop.start } : {}),
    ...(loop.bound !== undefined ? { bound: loop.bound } : {}),
    ...(loop.trips !== undefined ? { trips: loop.trips } : {}),
  };
}

/** A name, or a member or index path to one: what a for-of may read on every trip. */
function isPlace(e: Expr): boolean {
  switch (e.op) {
    case 'varref':
    case 'param':
    case 'constref':
    case 'externref':
      return true;
    case 'member':
      return isPlace(e.base);
    case 'index':
      return isPlace(e.base) && (isPlace(e.idx) || e.idx.op === 'lit');
    default:
      return false;
  }
}

export function lowerSwitch(
  node: ts.SwitchStatement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  const scrut = lowerExpression(node.expression, sourceFile, scope, diagnostics);
  if (!scrut) return undefined;
  const k = typeKey(scrut.type);
  if (k !== 'i32' && k !== 'u32') {
    pushDiag(
      diagnostics,
      sourceFile,
      node.expression,
      `switch scrutinee must be i32 or u32, got ${authorTypeText(scrut.type)}.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  const cases: { values: number[]; body: readonly Stmt[] }[] = [];
  const seen = new Set<number>();
  // Selectors written above a clause with no body of its own. `case 0: case 1: return 1;` is
  // how TypeScript spells one body under two labels, and it read as "switch case
  // fall-through is not allowed" — the one shape that is NOT fall-through, since an empty
  // clause has nothing to fall through. WGSL spells it `case 0, 1:` and GLSL ES 3.00 stacks
  // the labels; both are one clause with several selectors, which is what the IR now holds.
  let pending: number[] = [];
  let defaultBody: readonly Stmt[] | undefined;
  // Inside the case bodies a `break` is the switch's own, not an enclosing loop's.
  scope.enterSwitch();
  try {
    const clauses = node.caseBlock.clauses;
    for (const [index, clause] of clauses.entries()) {
      // A body whose end is reachable runs on into the next body in TypeScript, and WGSL has
      // no fall-through: the lowering ends the clause here, so `case 0: x = 1.` above
      // `case 1: x += 2.; break` gave `k = 0` 3 in TypeScript and 1 on the GPU, with no
      // diagnostic (Rule 7.3, #202). The label is the anchor, as TypeScript's own TS7029 is.
      if (fallsIntoABody(clauses, index)) {
        const isDefault = ts.isDefaultClause(clause);
        pushDiag(
          diagnostics,
          sourceFile,
          isDefault ? (clause.getFirstToken(sourceFile) ?? clause) : clause.expression,
          `${isDefault ? '"default:"' : `switch case ${clause.expression.getText(sourceFile)}`} ` +
            `falls through into the next case: TypeScript runs both bodies, and WGSL runs only ` +
            `this one. End it with "break", or repeat the shared statements in each case.`,
          TS_CODES.SWITCH_CASE,
        );
      }
      if (ts.isDefaultClause(clause)) {
        // Selectors written ABOVE `default:` share the DEFAULT's body, not the body of
        // whatever clause follows. Carrying them past here attached `case 1:` to the next
        // case's body — `case 1: default: r = 10; break; case 2: r = 20;` lowered to
        // `case 1, 2: { r = 20; } default: { r = 10; }`, which is a silent miscompile both
        // CPU engines agreed with. WGSL has no way to say "these selectors run the default",
        // so they are reported rather than guessed at.
        if (pending.length > 0) {
          pushDiag(
            diagnostics,
            sourceFile,
            clause,
            `switch case ${pending.map(String).join(', ')} sits above "default:" with no body ` +
              `of its own. A case that should do what the default does needs its own body; ` +
              `WGSL has no form for sharing the default's.`,
            TS_CODES.SWITCH_CASE,
          );
          pending = [];
        }
        // The mirror image, and the same silent miscompile the other way round. An EMPTY
        // `default:` above another clause falls through to it in TypeScript and does nothing
        // on both targets: `default: case 2: return 0;` emitted `default: { }`, so `f(5)`
        // left the switch where TypeScript returns 0. An empty default as the LAST clause is
        // harmless — it does nothing in either language — so only this shape is refused.
        if (clause.statements.length === 0 && index < clauses.length - 1) {
          pushDiag(
            diagnostics,
            sourceFile,
            clause,
            `"default:" has no body of its own and a clause follows it. In TypeScript it runs ` +
              `that clause's body; on both targets it runs nothing. Give the default its own ` +
              `body, or move it below the clause it should share.`,
            TS_CODES.SWITCH_CASE,
          );
          continue;
        }
        defaultBody = caseBody(clause.statements, sourceFile, scope, diagnostics);
        continue;
      }
      const value = caseValue(clause, k, sourceFile, scope, diagnostics);
      if (value === undefined) continue;
      // Both compilers reject a repeated label, and this surface makes one easy to write
      // without seeing it: `case 1 + 1:` beside `case 2:`, or two module constants that fold
      // to the same number. Reported here rather than at the backend, where the message names
      // neither the label nor the file.
      if (seen.has(value)) {
        pushDiag(
          diagnostics,
          sourceFile,
          clause.expression,
          `Duplicate switch case ${String(value)}; each label may appear once.`,
          TS_CODES.SWITCH_CASE,
        );
        // Drop what this clause had accumulated: the program is already failing, and
        // carrying the selectors on would add "has no body" about the same mistake.
        if (clause.statements.length > 0) pending = [];
        continue;
      }
      seen.add(value);
      if (clause.statements.length === 0) {
        // No body: this selector shares the NEXT clause's. A trailing empty clause with no
        // clause after it falls out of the loop and is reported below, since WGSL has no
        // label without a body to run.
        pending.push(value);
        continue;
      }
      cases.push({
        values: [...pending, value],
        body: caseBody(clause.statements, sourceFile, scope, diagnostics),
      });
      pending = [];
    }
  } finally {
    scope.exitSwitch();
  }
  // A TRAILING empty clause: `case 2:` as the last one names a value and then runs nothing,
  // and neither target has a label without a body. (An empty clause above `default:` is a
  // different mistake with a different message, raised in the loop above.)
  if (pending.length > 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `switch case ${pending.map(String).join(', ')} has no body: an empty case shares the ` +
        `body of the case below it, and there is none. Give it a body, or delete it.`,
      TS_CODES.SWITCH_CASE,
    );
  }
  return { s: 'switch', scrut, cases, defaultBody };
}

/** The compound assignments a `for` update may use: `+=`, `-=`, `*=` and `/=`. Multiplication
 *  and division are here because a loop that scales its induction variable is still counted.
 *
 *  `%=` is arithmetic too and is deliberately not here. A remainder step does not advance a
 *  counter: `i %= 3` is a fixed point after one application for every start, so the only
 *  `for` it could head is one that never exits, and taking it would mean a trip counter that
 *  has to model a sequence with no direction. The bitwise forms are out for the same reason
 *  with a different shape: a shift or a mask is not one of the sequences
 *  {@link analyzeCountedFor} can read a step out of. */
const FOR_UPDATE_OP: Readonly<Record<number, BinOp>> = {
  [ts.SyntaxKind.PlusEqualsToken]: '+',
  [ts.SyntaxKind.MinusEqualsToken]: '-',
  [ts.SyntaxKind.AsteriskEqualsToken]: '*',
  [ts.SyntaxKind.SlashEqualsToken]: '/',
};

/** The constant a `case` label selects on. A bare literal is the common form; `case -1:` is
 *  a PrefixUnaryExpression and `case MODE_B:` a module constant, and both fold to the same
 *  number the IR's `cases[].values` holds — the same fold `xs[N]` and a loop bound use, so
 *  the three places a constant has to be known at compile time agree on what counts as one.
 *
 *  `scrutKind` is the selector's own type, and the label has to fit it: the emitter spells
 *  every label with the selector's suffix, so `case -1:` on a u32 selector emitted `case -1u:`
 *  and Tint answered `no matching overload for 'operator - (u32)'`. That source was refused
 *  before this item accepted a negative label at all, so refusing it here takes nothing back. */
function caseValue(
  clause: ts.CaseClause,
  scrutKind: string,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): number | undefined {
  const expr = lowerExpression(clause.expression, sourceFile, scope, diagnostics);
  // `lowerExpression` already reported an unresolvable label (`case ZZZ:`), and a second
  // diagnostic saying it is not a constant adds nothing but noise.
  if (!expr) return undefined;
  const value = foldConstNumber(expr, scope);
  if (value === undefined || !Number.isInteger(value)) {
    pushDiag(
      diagnostics,
      sourceFile,
      clause.expression,
      'switch case must be an integer constant: a literal or a module const.',
      TS_CODES.SWITCH_CASE,
    );
    return undefined;
  }
  if (scrutKind === 'u32' && value < 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      clause.expression,
      `switch case ${String(value)} does not fit a u32 selector.`,
      TS_CODES.SWITCH_CASE,
    );
    return undefined;
  }
  return value;
}

/** Lower one clause's statements, dropping a TRAILING `break`.
 *
 *  The IR switch does not fall through — WGSL's does not, and {@link emitStmt} writes the
 *  C-style `break;` GLSL needs itself — so the `break` TypeScript requires at the end of a
 *  case carries no information here, and keeping it would emit `break; break;` in GLSL and
 *  a dead `break;` in WGSL. Dropping only the last statement leaves an early
 *  `if (c) { break }` inside the case exactly where the author put it. */
function caseBody(
  statements: readonly ts.Statement[],
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt[] {
  const body = lowerStatements(statements, sourceFile, scope, diagnostics);
  if (body.length > 0 && body[body.length - 1]!.s === 'break') body.pop();
  return body;
}

/**
 * `x++` and `x--` as a statement, and a `for` header's update. `counter` is the header's
 * induction variable as the author spelled it, and is set only for the header: an update that
 * is none of the forms a counted loop steps by (`i <<= 1`, `i %= 3`, `i = i * 2`, `v.x += 1.`)
 * then gets the sentence the counter's own check gives `j += 1` (Rule 7.5), not a reasonless
 * `TS8099`, so one mistake reads one way whatever operator it was written with (Rule 12.4).
 */
export function lowerUpdate(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  counter?: string,
): Stmt | undefined {
  const refuse = (): undefined => {
    if (counter === undefined) {
      pushDiag(diagnostics, sourceFile, expr, 'Unsupported update operator.', TS_CODES.UNSUPPORTED);
    } else {
      pushDiag(diagnostics, sourceFile, expr, forUpdateRefusal(counter), TS_CODES.LOOP_INDUCTION);
    }
    return undefined;
  };
  if (ts.isPrefixUnaryExpression(expr) || ts.isPostfixUnaryExpression(expr)) {
    const op = expr.operator;
    if (op !== ts.SyntaxKind.PlusPlusToken && op !== ts.SyntaxKind.MinusMinusToken) {
      return refuse();
    }
    const targetExpr = expr.operand;
    // `o.x++` where `x` is an accessor reads through its getter and writes through its setter
    // (Rule 8.11); the statement below is built on the getter's call and handed to the setter.
    const accessor = lowerAccessorTarget(targetExpr, true, sourceFile, scope, diagnostics);
    if (accessor === undefined) return undefined;
    // A member or element target (`v.x++`, `ps[i].a++`) goes through lowerLValue, which owns
    // the writability and single-component-swizzle rules; a bare identifier keeps its own
    // path so its wording is unchanged.
    const viaName = ts.isIdentifier(targetExpr);
    let target: Expr | undefined;
    if (accessor !== 'not-an-accessor') {
      target = accessor.read;
    } else if (viaName && ts.isIdentifier(targetExpr)) {
      const binding = scope.resolve(targetExpr.text);
      // A declaration refused where it is written said why there (Rule 12.4).
      if (!binding && scope.declarationRefused(targetExpr.text)) return undefined;
      // Two different failures, kept apart as origin/main split them: an UNKNOWN name reported
      // "it is declared with const", a statement about a declaration that does not exist.
      if (!binding) {
        // A refused declaration already said why the name is unbound (Rule 12.4, #171).
        if (!unknownNameAlreadyReported(targetExpr, targetExpr.text, sourceFile, diagnostics)) {
          pushDiag(
            diagnostics,
            sourceFile,
            targetExpr,
            unknownIdentifierSentence(
              targetExpr,
              `Cannot assign to unknown name "${targetExpr.text}".`,
            ),
            TS_CODES.UNKNOWN_NAME,
          );
        }
        return undefined;
      }
      // A captured variable's parameter keeps the variable's rules (Rule 8.17).
      const rules = writeRules(binding);
      if (!rules.mutable) {
        pushDiag(
          diagnostics,
          sourceFile,
          expr,
          `Cannot assign to "${targetExpr.text}" — it is ${readOnlyPhrase(rules.kind)}.` +
            writableRemedy(rules, sourceFile),
          TS_CODES.CONST_ASSIGN,
        );
        return undefined;
      }
      // A parameter is a value on both targets, so `a++` is refused for the same reason
      // `a = v` is — one rule, one wording, stated once in statement.ts. This branch builds
      // its own target instead of going through lowerLValue, so without this call the emit
      // was `a = (a + 1);`, which Tint refuses with `cannot assign to parameter 'a'`.
      if (rules.kind === 'param') {
        refuseParamWrite(expr, targetExpr.text, sourceFile, diagnostics);
        return undefined;
      }
      // A binding whose declared type was refused says nothing more (see `lowerLValue`).
      if (dropsRecoveredUse(sourceFile, binding)) return undefined;
      binding.capture?.byRef();
      // withSpan, as origin/main's #32 gives every authored lvalue: the write position is
      // what a stepped run and a diagnostic point at, and this branch builds the target
      // itself rather than going through lowerLValue, which carries its own.
      target = withSpan(
        {
          op: binding.kind === 'param' ? 'param' : 'varref',
          type: binding.type,
          name: irNameOf(binding),
        } as Expr,
        sourceFile,
        targetExpr,
      );
    } else {
      target = lowerLValue(targetExpr, sourceFile, scope, diagnostics);
      if (target && refuseReadonlyWrite(target, targetExpr, sourceFile, scope, diagnostics)) {
        return undefined;
      }
    }
    if (!target) return undefined;
    const token = op === ts.SyntaxKind.PlusPlusToken ? '++' : '--';
    if (!isSteppable(target.type)) {
      pushDiag(
        diagnostics,
        sourceFile,
        expr,
        isVec(target.type) || isVec64(target.type)
          ? `Cannot apply ${token} to ${authorTypeText(target.type)}: a vector has no literal to step by. Write the addition out${stepHint(target.type)}.`
          : `Cannot apply ${token} to ${authorTypeText(target.type)}: ${token} steps a numeric scalar (f32, i32, u32, f64).`,
        TS_CODES.ASSIGN_TARGET,
      );
      return undefined;
    }
    const bop = op === ts.SyntaxKind.PlusPlusToken ? '+' : '-';
    const one: Expr = { op: 'lit', type: target.type, value: 1 };
    // A bare name keeps the assign-of-binop it has always lowered to, so its emitted text does
    // not move. A member or element target becomes an assignOp instead, so the lvalue is
    // written ONCE: `ps[i].a = (ps[i].a + 1.0)` repeats the storage load, and CSE hoisting
    // that repeated read into an immutable `let` is what made such an emit invalid. An
    // emulated-double target keeps the binop form, since the fp64 pass lowers an assignOp on
    // a vec64 target only when the value is a vec64 too (SD0041).
    if (viaName || isVec64(target.type)) {
      return finishAccessorWrite(
        {
          s: 'assign',
          target,
          expr: { op: 'binop', type: target.type, bop, a: target, b: one },
        },
        accessor,
      );
    }
    return finishAccessorWrite({ s: 'assignOp', target, bop, expr: one }, accessor);
  }
  if (ts.isBinaryExpression(expr)) {
    // All four of FOR_UPDATE_OP, not just `+=` (#8 A15). `i *= 2` and `i /= 2` are ordinary
    // counted loops — a 64-wide halving reaches its bound in six iterations — and the only
    // reason they were "Unsupported for-update" is that nothing lowered them.
    // analyzeCountedFor reads the step back out and refuses one that cannot advance.
    const step = stepOf(expr);
    if (step !== undefined) {
      const bop = step.bop;
      const left = expr.left;
      // A member or an element (`v.x += 1.`, `xs[0] += 1`) is not the counter. Returning here
      // without a word dropped the whole loop from both targets (Rule 12.6).
      if (!ts.isIdentifier(left)) return refuse();
      const binding = scope.resolve(left.text);
      // The sentence `zz++` gets above; this returned nothing, and the loop was dropped too.
      if (!binding) {
        if (!unknownNameAlreadyReported(left, left.text, sourceFile, diagnostics)) {
          pushDiag(
            diagnostics,
            sourceFile,
            left,
            unknownIdentifierSentence(left, `Cannot assign to unknown name "${left.text}".`),
            TS_CODES.UNKNOWN_NAME,
          );
        }
        return undefined;
      }
      let rhs: Expr | undefined;
      if (step.sum === undefined) {
        rhs = lowerExpression(step.by, sourceFile, scope, diagnostics);
        if (!rhs) return undefined;
      } else {
        // `i = i + c` is typed as the same assignment in a body is (Rule 7.1): `i + 2.` on an
        // i32 counter is `TS8003` in both. Lowering `c` alone and retyping it below took any
        // number as the step, and dropped an `f32(2)` or a `u32(1)` the author wrote.
        const sum = lowerExpression(step.sum, sourceFile, scope, diagnostics);
        if (!sum) return undefined;
        if (sum.op !== 'binop') return refuse();
        rhs = step.first ? sum.a : sum.b;
      }
      // Any COMPILE-TIME-CONSTANT step is rebuilt as a literal of the induction variable's own
      // type, not just a bare one. Retyping only a `lit` left `i *= (1 + 1)` and `i += -2` as
      // f32 — `i *= 2.0` and `i += -2.0` into an i32 loop, which Tint and ANGLE both reject.
      // `foldConstNumber` is the fold the bound and the trip count already use, so the step the
      // emit carries and the step the counter reasons about are the same number by
      // construction. A non-constant step is left alone and refused downstream, where the
      // message can say a loop needs a constant step.
      //
      // A step the induction type cannot HOLD is refused here rather than retyped. `i *= 2.5`
      // on an i32 counter used to become `{ op: 'lit', type: i32, value: 2.5 }`, which only
      // the backend caught, as SD0017 out of `compile()` naming a literal the author's source
      // does not contain. `fitsTarget` is #30's own predicate, the one `retargetDeclaredIntLit`
      // uses to decide the same question at a declaration, so the two sites agree on what an
      // integer type can hold.
      if (isFoldableStepType(binding.type)) {
        const folded = foldConstNumber(rhs, scope);
        if (
          folded !== undefined &&
          isIntScalar(binding.type) &&
          !fitsTarget(folded, binding.type)
        ) {
          pushDiag(
            diagnostics,
            sourceFile,
            expr,
            `for step "${left.text} ${bop}= ${String(folded)}" does not fit "${left.text}", ` +
              `which is ${authorTypeText(binding.type)}: ${String(folded)} ` +
              `${Number.isInteger(folded) ? 'is outside its range' : 'is not a whole number'}.`,
            TS_CODES.TYPE_MISMATCH,
          );
          return undefined;
        }
        if (folded !== undefined) rhs = { op: 'lit', type: binding.type, value: folded };
      }
      // The same parameter rule as `i++` above: `for (…; p += 2)` on a formal parameter
      // emitted `p += 2`, which is `cannot assign to parameter 'p'` on Tint. A captured
      // variable's parameter keeps the variable's rules (Rule 8.17).
      const rules = writeRules(binding);
      if (rules.kind === 'param') {
        refuseParamWrite(expr, left.text, sourceFile, diagnostics);
        return undefined;
      }
      if (!rules.mutable) {
        pushDiag(
          diagnostics,
          sourceFile,
          expr,
          `Cannot assign to "${left.text}" — it is ${readOnlyPhrase(rules.kind)}.`,
          TS_CODES.CONST_ASSIGN,
        );
        return undefined;
      }
      binding.capture?.byRef();
      // `i += 2` writes `i`, so the target carries the lvalue's span (#32) — for all four
      // operators, the same way main stamped the `+=`-only form this generalises.
      const target: Expr = withSpan(
        {
          op: binding.kind === 'param' ? 'param' : 'varref',
          type: binding.type,
          name: irNameOf(binding),
        } as Expr,
        sourceFile,
        left,
      );
      // `i = i + 1` is the assign-of-binop `i++` builds, which the counter reads the same way.
      if (step.sum) {
        const [a, b] = step.first ? [rhs, target] : [target, rhs];
        return { s: 'assign', target, expr: { op: 'binop', type: binding.type, bop, a, b } };
      }
      return { s: 'assignOp', target, bop, expr: rhs };
    }
  }
  return refuse();
}

/**
 * The step a `for` update is written with, or undefined when it is none of the forms: a
 * compound assignment of {@link FOR_UPDATE_OP}, or `i = i + c`, `i = c + i` or `i = i - c`,
 * which is `i += c` or `i -= c` spelled out (Rule 7.5). `by` is the step as written; `sum`, set
 * for the spelled-out form only, is its right side, `i + c`; and `first` marks `c + i`, whose
 * step comes first.
 */
function stepOf(
  expr: ts.BinaryExpression,
):
  | { bop: BinOp; by: ts.Expression; sum: ts.BinaryExpression | undefined; first: boolean }
  | undefined {
  const compound = FOR_UPDATE_OP[expr.operatorToken.kind];
  if (compound !== undefined) {
    return { bop: compound, by: expr.right, sum: undefined, first: false };
  }
  if (expr.operatorToken.kind !== ts.SyntaxKind.EqualsToken || !ts.isIdentifier(expr.left)) {
    return undefined;
  }
  const name = expr.left.text;
  const bare = (e: ts.Expression): ts.Expression =>
    ts.isParenthesizedExpression(e) ? bare(e.expression) : e;
  const isName = (e: ts.Expression): boolean => {
    const b = bare(e);
    return ts.isIdentifier(b) && b.text === name;
  };
  const right = bare(expr.right);
  if (!ts.isBinaryExpression(right)) return undefined;
  const kind = right.operatorToken.kind;
  if (kind === ts.SyntaxKind.PlusToken || kind === ts.SyntaxKind.MinusToken) {
    const bop = kind === ts.SyntaxKind.PlusToken ? '+' : '-';
    if (isName(right.left)) return { bop, by: right.right, sum: right, first: false };
    if (bop === '+' && isName(right.right)) {
      return { bop, by: right.left, sum: right, first: true };
    }
  }
  return undefined;
}

/** The types a folded for-update step may be rebuilt as: a numeric scalar the target can
 *  spell a literal of. Narrower than {@link isSteppable}, which answers a different question
 *  and includes `f64`: an emulated double is not one literal but a `vec2<f32>` pair the fp64
 *  pass builds, so writing `{ op: 'lit', type: f64T }` here would hand the emit a node no
 *  backend spells. An f64 cannot head a counted `for` anyway (the induction variable must be
 *  i32 or u32), so nothing is lost by leaving it out. */
function isFoldableStepType(t: ShaderType): boolean {
  const k = typeKey(t);
  return k === 'f32' || k === 'i32' || k === 'u32';
}

/** The `e.g.` clause the `++` refusal on a vector carries, for the vector kinds whose
 *  written-out addition has a spelling that compiles: a native vector, where
 *  `v = v + vec3(1., 1., 1.)` is accepted and, because a literal inside `vec2i(...)` takes the
 *  constructor's element type (#8 A3), so is `v = v + vec2i(1, 1)`. An emulated-double vector
 *  has no literal spelling at all (a float literal is `f32`, so `vec3f64(1., 1., 1.)` is
 *  TS8003), so it gets no example rather than one that does not compile; each spelling here
 *  was checked by compiling it. */
function stepHint(t: ShaderType): string {
  if (!isVec(t)) return '';
  const one = t.elem === 'f32' ? '1.' : t.elem === 'i32' || t.elem === 'u32' ? '1' : undefined;
  if (one === undefined) return '';
  const suffix = t.elem === 'f32' ? '' : t.elem === 'i32' ? 'i' : 'u';
  return `, e.g. v = v + vec${t.n}${suffix}(${Array.from({ length: t.n }, () => one).join(', ')})`;
}

/** The types `++` and `--` can step: a numeric scalar, and nothing else. The step is one
 *  literal of the target's type, so a vector cannot be stepped at all (no vector literal has
 *  a spelling, and `v++` failed in the backend with SD0017 rather than emitting), and a bool,
 *  a struct, an array and a matrix have nothing to add `1` to: `p.q++` on a struct-typed
 *  field emitted `p.q = (p.q + 1.0)`, which Tint and ANGLE both reject and the CPU oracle
 *  evaluates to undefined. The identifier arm shares the check, which closes the same hole
 *  it has always had for a bare `q++`. */
function isSteppable(t: ShaderType): boolean {
  // A numeric SCALAR only, vectors included out. `++` builds its step as one literal of the
  // target's type, and no vector literal has a spelling: `v++` on a `vec3` and on a `vec3f64`
  // alike fails closed at emit with SD0017 ("vec constant with no valueExpr"), on `main` and on
  // this branch, for the bare name as well as for the member and element forms this item adds.
  // Measured against origin/main before narrowing this, so it refuses nothing that compiles —
  // it moves a backend failure to the source, where the message can name the fix.
  const k = typeKey(t);
  // f64 belongs here: an emulated double is a numeric scalar the fp64 pass lowers, and `s++`
  // on one emitted `s = df64_add(s, vec2<f32>(1.0, 0.0))` before this check existed. Leaving
  // it out made the check reject a program that compiled — the one thing it must not do.
  return k === 'f32' || k === 'i32' || k === 'u32' || k === 'f64';
}

function lowerBody(
  node: ts.Statement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt[] {
  if (ts.isBlock(node)) return lowerStatements(node.statements, sourceFile, scope, diagnostics);
  const one = lowerStatement(node, sourceFile, scope, diagnostics);
  if (!one) return [];
  return Array.isArray(one) ? one : [one];
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
