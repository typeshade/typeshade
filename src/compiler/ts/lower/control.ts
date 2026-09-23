import ts from 'typescript';
import type { BinOp, Expr, Stmt } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { i32T, isVec, isVec64, typeKey } from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import type { LoweringScope } from '../context.js';
import { irNameOf, readOnlyPhrase } from '../context.js';
import {
  analyzeCountedFor,
  boundWrittenIn,
  foldConstNumber,
  openLoopError,
} from '../loop-bound.js';
import { fitsTarget, isIntScalar } from '../lit-coerce.js';
import { mapTsTypeToShaderType } from '../type-map.js';
import { numericMismatch } from '../numeric.js';
import { makeDiagnostic } from '../diagnostic.js';
import { withSpan } from '../span.js';
import { TS_CODES, type TsCode } from '../codes.js';
import { reportIntLitRange, retargetDeclaredIntLit } from '../lit-coerce.js';
import { lowerExpression } from './expression.js';
import { lowerLValue, lowerStatement, lowerStatements, refuseParamWrite } from './statement.js';
import { finishAccessorWrite, lowerAccessorTarget, refuseReadonlyWrite } from './class-access.js';

export function lowerFor(
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
        `for condition must be bool, got ${typeKey(cond.type)}.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    const update = lowerUpdate(node.incrementor, sourceFile, scope, diagnostics);
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
    return { s: 'for', init: initStmt, cond, update, body };
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
  let cond = node.condition;
  while (cond && ts.isParenthesizedExpression(cond)) cond = cond.expression;
  if (!cond || !ts.isBinaryExpression(cond) || !COMPARISONS.has(cond.operatorToken.kind)) {
    return undefined;
  }
  const name = decl.name.text;
  const isCounter = (e: ts.Expression): boolean => ts.isIdentifier(e) && e.text === name;
  const bound = isCounter(cond.left) ? cond.right : isCounter(cond.right) ? cond.left : undefined;
  if (!bound) return undefined;
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
      `for induction must be i32 or u32, got ${k}.`,
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
  const err = openLoopError(cond, scope, bodyHasExit(node.statement));
  if (err) {
    pushDiag(diagnostics, sourceFile, node, err.message, err.code);
    return undefined;
  }
  scope.enterLoop();
  try {
    const body = lowerBody(node.statement, sourceFile, scope, diagnostics);
    // The IR has one loop statement, the `for`, so a `while` is a `for` whose counter nothing
    // reads. The counter is an `i32` whatever the condition compares: it used to take the
    // type of the condition's left operand, which made it an `f32` under `while (a < 4.)` and
    // a `bool` under `while (true)`.
    const w = { op: 'varref' as const, type: i32T, name: '_w' };
    return {
      s: 'for',
      init: { s: 'var', name: '_w', type: i32T, init: { op: 'lit', type: i32T, value: 0 } },
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
      `switch scrutinee must be i32 or u32, got ${k}.`,
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
  // A case body is a branch for §25's barrier rule, like an `if` arm.
  scope.enterBranch();
  try {
    const body = lowerStatements(statements, sourceFile, scope, diagnostics);
    if (body.length > 0 && body[body.length - 1]!.s === 'break') body.pop();
    return body;
  } finally {
    scope.exitBranch();
  }
}

export function lowerUpdate(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  if (ts.isPrefixUnaryExpression(expr) || ts.isPostfixUnaryExpression(expr)) {
    const op = expr.operator;
    if (op !== ts.SyntaxKind.PlusPlusToken && op !== ts.SyntaxKind.MinusMinusToken) {
      pushDiag(diagnostics, sourceFile, expr, 'Unsupported update operator.', TS_CODES.UNSUPPORTED);
      return undefined;
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
      // Two different failures, kept apart as origin/main split them: an UNKNOWN name reported
      // "it is declared with const", a statement about a declaration that does not exist.
      if (!binding) {
        pushDiag(
          diagnostics,
          sourceFile,
          expr,
          `Cannot assign to unknown name "${targetExpr.text}".`,
          TS_CODES.UNKNOWN_NAME,
        );
        return undefined;
      }
      if (!binding.mutable) {
        pushDiag(
          diagnostics,
          sourceFile,
          expr,
          `Cannot assign to "${targetExpr.text}" — it is ${readOnlyPhrase(binding.kind)}.`,
          TS_CODES.CONST_ASSIGN,
        );
        return undefined;
      }
      // A parameter is a value on both targets, so `a++` is refused for the same reason
      // `a = v` is — one rule, one wording, stated once in statement.ts. This branch builds
      // its own target instead of going through lowerLValue, so without this call the emit
      // was `a = (a + 1);`, which Tint refuses with `cannot assign to parameter 'a'`.
      if (binding.kind === 'param') {
        refuseParamWrite(expr, targetExpr.text, sourceFile, diagnostics);
        return undefined;
      }
      // withSpan, as origin/main's #32 gives every authored lvalue: the write position is
      // what a stepped run and a diagnostic point at, and this branch builds the target
      // itself rather than going through lowerLValue, which carries its own.
      target = withSpan(
        { op: 'varref', type: binding.type, name: irNameOf(binding) } as Expr,
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
          ? `Cannot apply ${token} to ${typeKey(target.type)}: a vector has no literal to step by. Write the addition out${stepHint(target.type)}.`
          : `Cannot apply ${token} to ${typeKey(target.type)}: ${token} steps a numeric scalar (f32, i32, u32, f64).`,
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
    const bop = FOR_UPDATE_OP[expr.operatorToken.kind];
    if (bop !== undefined) {
      const left = expr.left;
      if (!ts.isIdentifier(left)) return undefined;
      const binding = scope.resolve(left.text);
      if (!binding) return undefined;
      let rhs = lowerExpression(expr.right, sourceFile, scope, diagnostics);
      if (!rhs) return undefined;
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
              `which is ${typeKey(binding.type)}: ${String(folded)} ` +
              `${Number.isInteger(folded) ? 'is outside its range' : 'is not a whole number'}.`,
            TS_CODES.TYPE_MISMATCH,
          );
          return undefined;
        }
        if (folded !== undefined) rhs = { op: 'lit', type: binding.type, value: folded };
      }
      // The same parameter rule as `i++` above: `for (…; p += 2)` on a formal parameter
      // emitted `p += 2`, which is `cannot assign to parameter 'p'` on Tint.
      if (binding.kind === 'param') {
        refuseParamWrite(expr, left.text, sourceFile, diagnostics);
        return undefined;
      }
      if (!binding.mutable) {
        pushDiag(
          diagnostics,
          sourceFile,
          expr,
          `Cannot assign to "${left.text}" — it is ${readOnlyPhrase(binding.kind)}.`,
          TS_CODES.CONST_ASSIGN,
        );
        return undefined;
      }
      // `i += 2` writes `i`, so the target carries the lvalue's span (#32) — for all four
      // operators, the same way main stamped the `+=`-only form this generalises.
      const target: Expr = withSpan(
        { op: 'varref', type: binding.type, name: irNameOf(binding) } as Expr,
        sourceFile,
        left,
      );
      return { s: 'assignOp', target, bop, expr: rhs };
    }
  }
  pushDiag(diagnostics, sourceFile, expr, 'Unsupported for-update.', TS_CODES.UNSUPPORTED);
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
