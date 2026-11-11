import { inferredReadAt, isOpenCounter, noteDemand, noteOpenCounter } from '../use-inference.js';
import { abstractTreeOf, originOf, withReadTypes, type AbstractConst } from '../abstract-const.js';
import { localNumericInference } from '../local-numeric-inference.js';
import ts from 'typescript';
import { logicalTypeKey as typeKey } from '../optional.js';
import type { BinOp, Expr, Stmt } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { boolT, i32T, isVec, isVec64, u32T } from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { authorTypeText, dropsRecoveredUse, type LoweringScope } from '../context.js';
import { cloneIr, irNameOf, readOnlyPhrase, writableRemedy, writeRules } from '../context.js';
import {
  analyzeCountedFor,
  type CountedLoop,
  boundWrittenIn,
  foldConstNumber,
  forUpdateRefusal,
  openLoopError,
} from '../loop-bound.js';
import { fitsTarget, isIntegerLiteralTree, isIntegerWritten, isIntScalar } from '../lit-coerce.js';
import { mapTsTypeToShaderType } from '../type-map.js';
import { keyTypeText, keysOf, sameKeys } from '../key-types.js';
import { numericMismatch } from '../numeric.js';
import { makeDiagnostic } from '../diagnostic.js';
import { withSpan } from '../span.js';
import { TS_CODES, type TsCode } from '../codes.js';
import { reportIntLitRange, retargetDeclaredIntLit } from '../lit-coerce.js';
import { lowerExpression, unknownIdentifierSentence } from './expression.js';
import { arrayLengthOf } from './expression-prop.js';
import {
  lowerDeclarationList,
  lowerExpressionAsStatement,
  lowerLValue,
  lowerStatement,
  lowerStatements,
  refuseParamWrite,
} from './statement.js';
import { finishAccessorWrite, lowerAccessorTarget, refuseReadonlyWrite } from './class-access.js';
import { unknownNameAlreadyReported } from '../refused-names.js';
import { fallsIntoABody } from '../fallthrough.js';
import { optionalConditionSentence } from './optional-values.js';

/**
 * A `for` statement (Rule 7.5), or undefined after an error that says why it was refused.
 *
 * A `for` means what it means in TypeScript: the initializer runs once, the condition (`true`
 * when there is none) is tested before each trip, and the update runs after each trip and at
 * each `continue`. A `for` of the counted shape carries the counted fact the analysis proves
 * (the IR `for`'s `counted`); any other `for` is an open loop, as a `while` is (change 0136). The
 * one loop refused is the one the compiler proves never ends: no condition, or one that is
 * always true, with no `break` or `return` to leave it, and a constant header whose step never
 * reaches its bound.
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
): Stmt | Stmt[] | undefined {
  const errors = errorCount(diagnostics);
  const loop = lowerForLoop(node, sourceFile, scope, diagnostics);
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
 *  where every `undefined` of {@link lowerForLoop} comes from. */
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

/** The clauses of a header part the comma operator joins, in the order they run:
 *  `i++, j--` is `i++` then `j--` (change 0136, decision F2.1). */
function commaClauses(e: ts.Expression): ts.Expression[] {
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    return [...commaClauses(e.left), ...commaClauses(e.right)];
  }
  return [e];
}

function lowerForLoop(
  node: ts.ForStatement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | Stmt[] | undefined {
  scope.push();
  scope.enterLoop();
  try {
    // The initializer runs once, before the first test. `counter` is the one `let` a counted
    // loop declares, when the header declares exactly one.
    const pre: Stmt[] = [];
    let counter: (Stmt & { s: 'var' }) | undefined;
    // The one `let` of the header, when it is an unannotated integer-written literal.
    let writtenCounter: ts.VariableDeclaration | undefined;
    const init = node.initializer;
    if (init !== undefined && ts.isVariableDeclarationList(init)) {
      const isLet = (init.flags & ts.NodeFlags.Let) !== 0;
      const single = init.declarations.length === 1;
      for (const decl of init.declarations) {
        // With several declarators, each takes its own temporaries in front of it, so a later
        // one reads the earlier ones in order.
        const mark = single ? undefined : scope.hoistMark();
        let lowered: Stmt[];
        // The counter of a `for` that is not counted is a value its uses decide (Rule 5.1,
        // Amendment A1 of change 0134): an earlier pass of this compile found the loop open, so
        // the declaration is lowered as the `let` it is.
        if (
          single &&
          isLet &&
          decl.type === undefined &&
          decl.initializer !== undefined &&
          isIntegerLiteralTree(decl.initializer)
        ) {
          writtenCounter = decl;
        }
        if (isLet && isHeaderCounter(decl, sourceFile) && !isOpenCounter(sourceFile, decl)) {
          const one = lowerHeaderCounter(node, decl, sourceFile, scope, diagnostics);
          if (!one) return undefined;
          // The `for` header's own statements never pass through `lowerStatement`, so the
          // blanket stamp there does not reach them; give each the span of the clause it came
          // from rather than the whole loop's, so stepping a loop highlights `let i: i32 = 0`.
          withSpan(one, sourceFile, single ? init : decl);
          lowered = [one];
          if (single) counter = one;
        } else {
          const list = lowerDeclarationList(
            init,
            single ? init : decl,
            sourceFile,
            scope,
            diagnostics,
            [decl],
          );
          if (list === undefined) return undefined;
          lowered = Array.isArray(list) ? list : [list];
        }
        if (mark !== undefined) pre.push(...scope.takeHoisted(mark));
        pre.push(...lowered);
      }
    } else if (init !== undefined) {
      const clauses = commaClauses(init);
      for (const clause of clauses) {
        const one = lowerHeaderClause(clause, clauses.length > 1, sourceFile, scope, diagnostics);
        if (one === undefined) return undefined;
        pre.push(...one);
      }
    }
    // A loop's condition runs on every trip, so nothing in it may be hoisted ahead of the loop
    // (change 0088); an optional read as the condition names the test to write.
    let cond: Expr = { op: 'lit', type: boolT, value: true };
    if (node.condition !== undefined) {
      const optional = optionalConditionSentence(node.condition, scope, sourceFile);
      if (optional !== undefined) {
        pushDiag(diagnostics, sourceFile, node.condition, optional, TS_CODES.TYPE_MISMATCH);
        return undefined;
      }
      const lowered = scope.withHoisting(false, () =>
        lowerExpression(node.condition!, sourceFile, scope, diagnostics),
      );
      if (!lowered) return undefined;
      if (typeKey(lowered.type) !== 'bool') {
        pushDiag(
          diagnostics,
          sourceFile,
          node.condition,
          `for condition must be bool, got ${authorTypeText(lowered.type)}.`,
          TS_CODES.TYPE_MISMATCH,
        );
        return undefined;
      }
      cond = lowered;
    }
    const clauses = node.incrementor === undefined ? [] : commaClauses(node.incrementor);
    // The counted fact, when the header has the counted shape (Rule 7.5). The update is lowered
    // as a counter's step first, its sentences kept aside: a step that is none of the counted
    // forms is the update of an open loop, lowered as the statement it is below.
    let update: Stmt[] | undefined;
    let counted: CountedLoop | undefined;
    if (counter !== undefined && node.condition !== undefined && clauses.length === 1) {
      const shown = counterShown(node);
      // Kept aside on a copy, so a name an earlier error explains is not reported again.
      const scratch: TsCompilerDiagnostic[] = [...diagnostics];
      const step = scope.withHoisting(false, () =>
        lowerUpdate(clauses[0]!, sourceFile, scope, scratch, shown),
      );
      const aside = scratch.slice(diagnostics.length);
      // A refusal of the expression itself, not of its shape as a step (`i *= 2.5` on an `i32`,
      // a name that is unknown or read-only), is the update's own error, said as it was.
      const own = aside.filter((d) => d.category === 'error' && d.code !== TS_CODES.LOOP_INDUCTION);
      if (own.length > 0) {
        // A step the counter's integer type refuses (`i *= 2.5`) is no counted step: the loop
        // is open, and the next pass types the counter from its uses.
        if (writtenCounter !== undefined) noteOpenCounter(sourceFile, writtenCounter);
        diagnostics.push(...aside);
        return undefined;
      }
      if (step !== undefined && !aside.some((d) => d.category === 'error')) {
        withSpan(step, sourceFile, node.incrementor!);
        const verdict = analyzeCountedFor(counter, cond, step, scope);
        if (!verdict.ok && verdict.endless) {
          pushDiag(diagnostics, sourceFile, node, verdict.message, verdict.code);
          return undefined;
        }
        if (verdict.ok) counted = verdict.loop;
        diagnostics.push(...aside);
        update = [step];
      }
    }
    if (update === undefined) {
      update = [];
      for (const clause of clauses) {
        const one = lowerHeaderClause(clause, true, sourceFile, scope, diagnostics);
        if (one === undefined) return undefined;
        update.push(...one);
      }
    }
    if (counted === undefined) {
      const err = openLoopError(
        cond,
        scope,
        bodyHasExit(node.statement),
        `for (${headerText(node, sourceFile)})`,
      );
      if (err) {
        pushDiag(diagnostics, sourceFile, node, err.message, err.code);
        return undefined;
      }
    }
    const body = lowerBody(node.statement, sourceFile, scope, diagnostics);
    // A runtime bound counts the loop only if the body leaves it alone (Rule 7.5); a body that
    // moves it makes the loop an open one.
    if (counted !== undefined && boundWrittenIn(cond, counter!.name, scope, body) === undefined) {
      return [
        ...pre.filter((s) => s !== counter),
        { s: 'for', init: counter!, cond, update: update[0]!, body, counted: countedFact(counted) },
      ];
    }
    if (writtenCounter !== undefined) noteOpenCounter(sourceFile, writtenCounter);
    return openFor(pre, cond, update, body, scope);
  } finally {
    scope.exitLoop();
    scope.pop();
  }
}

/** The counter as the author spelled it, for the step's sentences. */
function counterShown(node: ts.ForStatement): string {
  const list = node.initializer;
  const decl = list && ts.isVariableDeclarationList(list) ? list.declarations[0] : undefined;
  return decl && ts.isIdentifier(decl.name) ? decl.name.text : '';
}

/** The header as written, `let i = 0; i < n; i++`, for a sentence about the loop. */
function headerText(node: ts.ForStatement, sourceFile: ts.SourceFile): string {
  const parts = [node.initializer, node.condition, node.incrementor].map(
    (n) => n?.getText(sourceFile) ?? '',
  );
  // `for (;;)` as an author writes it, and `for (let i = 0; ; i++)` as prettier spells it.
  return parts.every((p) => p === '') ? ';;' : parts.join('; ').trimEnd();
}

/** One clause of a header's initializer or update, as the statement it is (change 0136): `k = 2`,
 *  `j--`, `i = i * 3 + 1`. A temporary its expression needs goes in front of it, and both run
 *  where the clause runs. `stamp` gives the statements the clause's own span. */
function lowerHeaderClause(
  clause: ts.Expression,
  stamp: boolean,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt[] | undefined {
  const mark = scope.hoistMark();
  const lowered = scope.withHoisting(true, () =>
    lowerExpressionAsStatement(clause, clause, sourceFile, scope, diagnostics),
  );
  const hoisted = scope.takeHoisted(mark);
  if (lowered === undefined) return undefined;
  const list = [...hoisted, ...(Array.isArray(lowered) ? lowered : [lowered])];
  if (stamp) for (const s of list) withSpan(s, sourceFile, clause);
  return list;
}

/**
 * An open `for` in the IR (change 0136): the loop a `while` lowers to, with no counted fact.
 *
 * The IR `for` holds one initializer and one update, and WGSL's header takes one declaration and
 * one assignment. A header that fits keeps its shape: `for (var x: f32 = 0.0; x < 1.0; x += 0.25)`.
 * Any other runs its initializer ahead of the loop and its update at the end of the body and at
 * each `continue` that belongs to the loop, and the loop is a `for` over a counter of the
 * compiler's own, as a `while` is (decision F2.1). The names the initializer declares are the
 * IR names the scope gave them, which no other local of the function has (#38), so declaring
 * them ahead of the loop takes no name from the code that follows it.
 */
function openFor(
  pre: readonly Stmt[],
  cond: Expr,
  update: readonly Stmt[],
  body: readonly Stmt[],
  scope: LoweringScope,
): Stmt | Stmt[] {
  const first = pre[0];
  const step = update[0];
  if (
    pre.length === 1 &&
    first!.s === 'var' &&
    update.length === 1 &&
    (step!.s === 'assign' || step!.s === 'assignOp') &&
    step!.target.op === 'varref'
  ) {
    return { s: 'for', init: first!, cond, update: step!, body };
  }
  const name = scope.defineTemp('_w', i32T, true);
  const w = { op: 'varref' as const, type: i32T, name };
  const loop: Stmt = {
    s: 'for',
    init: { s: 'var', name, type: i32T, init: { op: 'lit', type: i32T, value: 0 } },
    cond,
    update: {
      s: 'assign',
      target: w,
      expr: { op: 'binop', type: i32T, bop: '+', a: w, b: { op: 'lit', type: i32T, value: 1 } },
    },
    body: update.length === 0 ? body : withUpdates(body, update, true),
  };
  return pre.length === 0 ? loop : [...pre, loop];
}

/** `body` with a copy of `update` before each `continue` that belongs to its loop and, when
 *  `atEnd`, after its last statement unless that statement leaves the trip. A `continue` inside
 *  a nested loop is that loop's. */
function withUpdates(body: readonly Stmt[], update: readonly Stmt[], atEnd: boolean): Stmt[] {
  const copy = (): Stmt[] => update.map((s) => cloneIr(s));
  const out: Stmt[] = [];
  for (const s of body) {
    switch (s.s) {
      case 'continue':
        out.push(...copy(), s);
        break;
      case 'if':
        out.push({
          ...s,
          arms: s.arms.map((a) => ({ ...a, body: withUpdates(a.body, update, false) })),
          ...(s.elseBody !== undefined ? { elseBody: withUpdates(s.elseBody, update, false) } : {}),
        });
        break;
      case 'switch':
        out.push({
          ...s,
          cases: s.cases.map((c) => ({ ...c, body: withUpdates(c.body, update, false) })),
          ...(s.defaultBody !== undefined
            ? { defaultBody: withUpdates(s.defaultBody, update, false) }
            : {}),
        });
        break;
      default:
        out.push(s);
    }
  }
  const last = out[out.length - 1];
  const leaves =
    last !== undefined &&
    (last.s === 'continue' || last.s === 'break' || last.s === 'return' || last.s === 'discard');
  if (atEnd && !leaves) out.push(...copy());
  return out;
}

/** Whether a header declarator is read with the counter's rule (Rule 7.5): a name with a
 *  value, written with no type or with `i32` or `u32`. Any other declarator is a `let` as any
 *  `let` is. */
function isHeaderCounter(decl: ts.VariableDeclaration, sourceFile: ts.SourceFile): boolean {
  if (!ts.isIdentifier(decl.name) || decl.initializer === undefined) return false;
  if (decl.type === undefined) return true;
  const mapped = mapTsTypeToShaderType(decl.type, sourceFile, []);
  return mapped !== undefined && isIntScalar(mapped);
}

/**
 * The bound a header's condition compares the name `name` with, or undefined: `n` in `i < n`,
 * and under an `&&` exit the clause that compares it.
 */
function comparedBound(node: ts.ForStatement, name: string): ts.Expression | undefined {
  const isCounter = (e: ts.Expression): boolean => ts.isIdentifier(e) && e.text === name;
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
  return isCounter(cond.left) ? cond.right : cond.left;
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
 * A `let` the `for` header declares with a value and no type other than `i32` or `u32`: its type
 * is the counter's (Rule 7.5), and the lowered `var`.
 *
 * An annotation is the type. An unannotated name whose value is written as an integer is an
 * `i32`, or a `u32` when the value is a non-negative integer literal and the bound it is
 * compared with is a `u32`: `for (let i = 0; i < data.length; i++)` is the loop a TypeScript
 * author writes first, and `data.length` is a `u32`. Any other value gives the name the value's
 * type, as a `let` takes it: `for (let x = 0.; x < 1.; x += 0.25)` counts in `f32` (change 0136).
 * A float literal compared with an integer bound keeps the `i32` it had before that change, so
 * `for (let i = 0.; i < 10; i++)` is still counted.
 *
 * The bound is lowered once here into a scratch list, to read its type, and again where the
 * condition is lowered, which reports its diagnostics. Lowering an expression declares nothing.
 */
function lowerHeaderCounter(
  node: ts.ForStatement,
  decl: ts.VariableDeclaration,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): (Stmt & { s: 'var' }) | undefined {
  const name = (decl.name as ts.Identifier).text;
  const written = decl.initializer!;
  const annotated = decl.type
    ? mapTsTypeToShaderType(decl.type, sourceFile, diagnostics)
    : undefined;
  let init = lowerExpression(written, sourceFile, scope, diagnostics);
  if (!init) return undefined;
  let start: ts.Expression = written;
  while (ts.isParenthesizedExpression(start)) start = start.expression;
  const bound = comparedBound(node, name);
  const boundType =
    bound === undefined ? undefined : lowerExpression(bound, sourceFile, scope, [])?.type;
  // A written integer bound makes a float-written start an `i32` counter. A constant of no
  // fixed type is no such bound: it takes the counter's type, as it did when it was an `f32`
  // constant, so `for (let j = 0.; j < K; j += 1.)` keeps its `f32` counter (change 0134).
  const intBound =
    bound !== undefined &&
    ((isIntegerLiteralTree(bound) && (abstractTreeOf(bound)?.reads.length ?? 0) === 0) ||
      (boundType !== undefined && isIntScalar(boundType)));
  const floatWritten = ts.isNumericLiteral(start) && !isIntegerWritten(start);
  // A start that comes from a constant of no fixed type keeps the type the counter has on
  // `main`, the constant's emitted type, as a counter bounded by one does, and the counter
  // carries that origin (Amendment A3 of change 0134).
  const builtin = (callee: string): boolean =>
    scope.resolveCallee(callee) === undefined && scope.resolve(callee) === undefined;
  const origin = decl.type === undefined ? originOf(written, builtin) : undefined;
  const fromConstant = origin !== undefined && origin.reaches.length > 0;
  // On `main` a function-local `const` took an integer type from its declared uses (changes 0036
  // and 0037), and a counter started by an expression over it took the type that expression had
  // then. The counter keeps it (A3, and the owner's decision of 2026-11-10, "`main`과 같이 u32
  // 유지"): the start is lowered again with each such constant read at that type. Where that
  // lowering is refused, as `-k` of a `u32` was on `main`, the counter keeps the type it has here.
  const onMain = fromConstant ? mainReadTypes(origin.reaches, sourceFile) : undefined;
  if (onMain !== undefined) {
    // A start that lowers there lowers with no error; a refused one gives `undefined`. What it
    // would say again goes to a scratch list.
    const scratch: TsCompilerDiagnostic[] = [];
    const again = withReadTypes(onMain, () => lowerExpression(written, sourceFile, scope, scratch));
    if (again !== undefined) init = again;
  }
  // An integer conversion is a value of its type, not a value written as an integer (Rule
  // 7.5): the counter takes that type, as `u32(x)` with an `f32` `x` always did. The fold gives
  // the conversion of a written number a literal of its type (#1217), which the block below
  // would otherwise retarget to `i32`: `u32(3)` counted in `i32`. An `f32(…)` start keeps the
  // retarget: an `f32` counter needs `TS8007` to catch a step that rounds away (the owner's
  // decision of 2026-11-11, "이 PR은 i32/u32만"; issue #1242).
  const conversion =
    decl.type === undefined &&
    ts.isCallExpression(start) &&
    ts.isIdentifier(start.expression) &&
    ['i32', 'u32'].includes(start.expression.text) &&
    scope.resolveCallee(start.expression.text) === undefined;
  if (!fromConstant && !conversion && (annotated !== undefined || !floatWritten || intBound)) {
    // The induction variable's declared type, or i32 when there is no annotation. `for (let j:
    // i32 = -1; …)` reaches this with a PrefixUnaryExpression rather than a NumericLiteral, which
    // the `init.op === 'lit'` special case this replaces never matched — so the initializer kept
    // the f32 the bare `1` was given and the loop emitted `var j: i32 = -1.0`, with no
    // diagnostic, which neither Tint nor ANGLE accepts (issue #40).
    const hint =
      decl.type === undefined &&
      ts.isNumericLiteral(start) &&
      /^\d+$/.test(start.text) &&
      boundType !== undefined &&
      typeKey(boundType) === 'u32'
        ? boundType
        : undefined;
    const counterType = annotated ?? hint ?? i32T;
    init = retargetDeclaredIntLit(init, written, counterType);
    // Out of range, the §13 sentence is the one diagnostic: the loop-bound walk would
    // otherwise add a second one about a start value the author has already been told about.
    if (reportIntLitRange(init, written, counterType, sourceFile, diagnostics)) return undefined;
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
  const read =
    decl.type === undefined && ts.isIdentifier(start) ? inferredReadAt(start) : undefined;
  const startValue = read !== undefined && read.type === undefined ? read : undefined;
  const bound_ = scope.define({
    kind: 'local',
    name,
    type,
    mutable: true,
    constValue: init.op === 'lit' ? init.value : undefined,
    ...(fromConstant ? { carries: origin } : {}),
    // A counter that starts at a value whose uses have not decided its type takes that type:
    // its own uses decide it (`let y = k; for (let j = y; …) h(j)` makes `y` a `u32`; change
    // 0134 item 1).
    ...(startValue !== undefined ? { inferred: startValue } : {}),
  });
  scope.recordDeclaration(sourceFile, decl.name, { name, kind: 'local', type, mutable: true });
  // What a local function in the loop body reads `i` through (Rule 8.17).
  scope.bindDeclaration(decl, bound_);
  // Two sequential loops over `i` are the first shape a shader author writes; the second
  // counter takes the IR name `i_1` so the two never collide in the function (#38).
  return { s: 'var', name: irNameOf(bound_), type, init };
}

/** The integer type each constant of `reaches` had on `main`, when every one is a function-local
 *  `const` that took an integer type from its declared uses there (changes 0036 and 0037). A
 *  constant derived from others (`const kk = k + 1`) takes theirs when they agree. A module
 *  constant was an `f32` on `main`, so a start that reaches one gives `undefined`. Two types
 *  that disagree (`k + m`) make the start's lowering refuse, and the counter keeps its type. */
export function mainReadTypes(
  reaches: readonly AbstractConst[],
  sourceFile: ts.SourceFile,
): Map<AbstractConst, ShaderType> | undefined {
  const typeOf = (info: AbstractConst): ShaderType | undefined => {
    const decl = info.nameNode.parent;
    if (!ts.isVariableDeclaration(decl) || info.nameNode.getSourceFile() !== sourceFile) {
      return undefined;
    }
    const own = localNumericInference(decl, sourceFile)?.type;
    if (own !== undefined) return own;
    const from = info.sources.map(typeOf);
    const first = from[0];
    return first !== undefined &&
      from.every((t) => t !== undefined && typeKey(t) === typeKey(first))
      ? first
      : undefined;
  };
  const types = new Map<AbstractConst, ShaderType>();
  for (const info of reaches) {
    const type = typeOf(info);
    if (type === undefined) return undefined;
    types.set(info, type);
  }
  return types.size > 0 ? types : undefined;
}

export function lowerWhile(
  node: ts.WhileStatement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  const optional = optionalConditionSentence(node.expression, scope, sourceFile);
  if (optional !== undefined) {
    pushDiag(diagnostics, sourceFile, node.expression, optional, TS_CODES.TYPE_MISMATCH);
    return undefined;
  }
  const cond = scope.withHoisting(false, () =>
    lowerExpression(node.expression, sourceFile, scope, diagnostics),
  );
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
  const err = openLoopError(cond, scope, bodyHasExit(node.statement), `while (${written})`);
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
      : arrayLengthOf(array, node.expression, sourceFile, scope, diagnostics);
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
  // A value its uses decide is an integer of no kind here (change 0134 item 1).
  if (scrut) noteDemand(scrut, 'int');
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
  let seenDefault = false;
  // Inside the case bodies a `break` is the switch's own, not an enclosing loop's.
  scope.enterSwitch();
  try {
    const clauses = node.caseBlock.clauses;
    for (const [index, clause] of clauses.entries()) {
      if (ts.isDefaultClause(clause)) {
        // Keep the first clause: overwriting it silently accepted a second default (#321).
        // Track its presence separately, since an empty clause may itself be refused below.
        if (seenDefault) {
          pushDiag(
            diagnostics,
            sourceFile,
            clause,
            'Duplicate switch default; each switch may have only one default clause.',
            TS_CODES.SWITCH_CASE,
          );
          continue;
        }
        seenDefault = true;
      }
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
      const value = caseValue(clause, k, scrut.type, sourceFile, scope, diagnostics);
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
  scrutType: ShaderType,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): number | undefined {
  // A label over a key type is one of its members, written as a string (change 0081), and the
  // scrutinee's type gives it its id.
  const keys = keysOf(scrutType);
  const expr = lowerExpression(
    clause.expression,
    sourceFile,
    scope,
    diagnostics,
    keys !== undefined ? scrutType : undefined,
  );
  // `lowerExpression` already reported an unresolvable label (`case ZZZ:`), and a second
  // diagnostic saying it is not a constant adds nothing but noise.
  if (!expr) return undefined;
  const labelKeys = keysOf(expr.type);
  if (keys !== undefined && (labelKeys === undefined || !sameKeys(keys, labelKeys))) {
    pushDiag(
      diagnostics,
      sourceFile,
      clause.expression,
      `The switch is over ${keyTypeText(keys)}, so each case is one of its members, written ` +
        `as a string.`,
      TS_CODES.SWITCH_CASE,
    );
    return undefined;
  }
  if (keys === undefined && labelKeys !== undefined) {
    pushDiag(
      diagnostics,
      sourceFile,
      clause.expression,
      `A case of ${keyTypeText(labelKeys)} labels a switch over a number, and the two have no ` +
        `value in common.`,
      TS_CODES.SWITCH_CASE,
    );
    return undefined;
  }
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
  if (!fitsTarget(value, scrutType)) {
    pushDiag(
      diagnostics,
      sourceFile,
      clause.expression,
      `switch case ${String(value)} does not fit a ${scrutKind} selector.`,
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
      // Whole writes to ordinary value parameters already use their automatic locals.
      // Share the fallback with assignment lowering if this input still has no writable local.
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
      // Use the same remaining-input fallback as `i++`; ordinary value parameters already
      // have writable locals. Captured variables keep their own rules (Rule 8.17).
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
