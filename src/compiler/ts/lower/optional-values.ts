// ═══ Lowering an optional value, `T | undefined` (Rule 7.10, change 0088) ═══
//
// The type and its struct are `../optional.ts`; the flow walk that narrows a read is
// `../narrowing.ts`. This file is the lowering of each form an author writes with one:
//
//   undefined                  the absent value, where a `T | undefined` is expected
//   v                          `v.value` where the flow says `v` is present; refused where it
//                              does not and a `T` is needed (TS8003, in TypeScript's TS18048 place)
//   v === undefined            `!v.present`; `v !== undefined` is `v.present`
//   v === x, v === w           `v.present && v.value == x`; both absent compare equal
//   v ?? d                     `select(d, v.value, v.present)`, `d` evaluated only when absent
//                              once the Rule 7.9 pass sequences a `d` that writes
//   o?.f, o?.xy, o?.[i]        `{ value: o.value.f, present: o.present }`
//   v ??= d                    `if (!v.present) { v = d; }`
//   v!, o?.m(), if (v)         refused, each with the test to write instead
//
// A value read twice (`f(x) ?? d` reads the flag and the value) is bound to a temporary ahead of
// the statement, since a call runs once; a name or a member of one needs no temporary.
//
// Implements: Rule 7.10 (docs/language-design.md; traced in reqs/).

import ts from 'typescript';
import type { Expr, Stmt } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { boolT, typeKey } from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { authorTypeText, irNameOf, type Binding, type LoweringScope } from '../context.js';
import { makeDiagnostic } from '../diagnostic.js';
import { TS_CODES } from '../codes.js';
import {
  absentOf,
  absentRemedyValue,
  isOptional,
  isUndefinedLiteral,
  notOf,
  optionalInner,
  optionalT,
  presentFlagOf,
  valueOf,
} from '../optional.js';
import { narrowingAt } from '../narrowing.js';
import { retargetIntLitCtx } from '../lit-coerce.js';
import { lowerExpression, placeOf } from './expression.js';

const pushDiag = (
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: (typeof TS_CODES)[keyof typeof TS_CODES] = TS_CODES.TYPE_MISMATCH,
): void => {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code));
};

const skipParens = (e: ts.Expression): ts.Expression => {
  let x = e;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  return x;
};

// ─── What each lowered expression gave, before any wrapping (the narrowing's `from`) ───

/** The type each expression lowered to, as written: `1.` is an `f32` even where the position
 *  wrapped it as a present `f32 | undefined`. The flow walk records that `v = e` ran last, and
 *  what `e` gave says whether `v` is present (a `T`) or unknown (an optional). */
const valueTypes = new WeakMap<ts.Node, ShaderType>();

export function noteValueType(node: ts.Node, type: ShaderType): void {
  valueTypes.set(node, type);
}

/** The binding `node` reads when it is a bare name bound to an optional local or parameter. */
export function optionalBindingOf(node: ts.Expression, scope: LoweringScope): Binding | undefined {
  const x = skipParens(node);
  if (!ts.isIdentifier(x)) return undefined;
  const b = scope.resolve(x.text);
  if (b === undefined || (b.kind !== 'local' && b.kind !== 'param')) return undefined;
  return isOptional(b.type) ? b : undefined;
}

/** What the flow says of the optional `id` reads: present, absent, or nothing it can say. */
export function narrowedStateOf(
  sourceFile: ts.SourceFile,
  id: ts.Identifier,
): 'present' | 'absent' | undefined {
  const n = narrowingAt(sourceFile, id);
  if (n === undefined) return undefined;
  if (n === 'absent') return n;
  for (const source of n.sources) {
    if (source === null) continue;
    const from = valueTypes.get(source);
    if (from === undefined || isOptional(from)) return undefined;
  }
  return 'present';
}

/** A read of the optional binding `b` as the IR spells it. */
export const rawRead = (b: Binding): Expr =>
  b.kind === 'param'
    ? { op: 'param', type: b.type, name: irNameOf(b) }
    : { op: 'varref', type: b.type, name: irNameOf(b) };

// ─── The un-narrowed read ───

/** What the position around `node` takes, for the sentence about an un-narrowed read. */
function positionPhrase(node: ts.Node, sourceFile: ts.SourceFile): string {
  let at: ts.Node = node;
  while (ts.isParenthesizedExpression(at.parent)) at = at.parent;
  const p = at.parent;
  if (ts.isBinaryExpression(p)) return `"${p.operatorToken.getText(sourceFile)}" takes`;
  if (ts.isPrefixUnaryExpression(p)) return `"${ts.tokenToString(p.operator) ?? ''}" takes`;
  if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
    const i = [...(p.arguments ?? [])].indexOf(at as ts.Expression);
    const callee = ts.isCallExpression(p)
      ? p.expression.getText(sourceFile)
      : p.expression.getText(sourceFile);
    return i >= 0 ? `argument ${String(i + 1)} of "${callee}" takes` : `"${callee}" takes`;
  }
  if (ts.isReturnStatement(p)) return 'the result here is';
  if (ts.isVariableDeclaration(p)) return `"${p.name.getText(sourceFile)}" is declared`;
  if (ts.isPropertyAccessExpression(p) && p.expression === at) return `".${p.name.text}" needs`;
  if (ts.isElementAccessExpression(p) && p.expression === at) return 'an index needs';
  if (ts.isElementAccessExpression(p)) return 'an index is';
  if (ts.isPropertyAssignment(p)) return `the field "${p.name.getText(sourceFile)}" is`;
  if (
    ts.isConditionalExpression(p) ||
    ts.isIfStatement(p) ||
    ts.isWhileStatement(p) ||
    ts.isForStatement(p)
  )
    return 'a condition is';
  return 'this position takes';
}

/** The TS8003 sentence for an optional read where a `T` is needed, in TypeScript's TS18048
 *  place: the value, the type, what the position takes, and the two edits that work. */
export function unnarrowedReadSentence(
  node: ts.Node,
  type: ShaderType,
  sourceFile: ts.SourceFile,
): string {
  const inner = optionalInner(type)!;
  const written = node.getText(sourceFile);
  const name = ts.isIdentifier(skipParens(node as ts.Expression)) ? written : 'it';
  return (
    `"${written}" is "${authorTypeText(type)}" here, and ${positionPhrase(node, sourceFile)} ` +
    `${anOf(authorTypeText(inner))}. Test it first, "if (${name} !== undefined)", or give the ` +
    `absent case a value, "${name} ?? ${absentRemedyValue(inner, authorTypeText)}".`
  );
}

/** `an f32`, `an i32`, `an array<…>`, `a u32`, `a vec2`: the article as the name is read aloud. */
const anOf = (t: string): string => (/^[aeiofAEIOF]/.test(t) ? `an ${t}` : `a ${t}`);

/** Refuse `value` where a `T` is needed when it is an optional nothing narrowed; true when
 *  refused. The identifier read reports itself (`lowerIdentifier`); this covers a call, a
 *  member read through `?.` and any other expression that gives an optional. */
export function refuseOptionalUse(
  value: Expr | undefined,
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  if (value === undefined || !isOptional(value.type)) return false;
  pushDiag(diagnostics, sourceFile, node, unnarrowedReadSentence(node, value.type, sourceFile));
  return true;
}

/** The read of an optional local or parameter `b` at `id`, where `contextual` is what the
 *  position declares: the narrowed `v.value` where the flow says `v` is present; the value
 *  itself where an optional is expected; refused otherwise, with the sentence above. */
export function lowerOptionalRead(
  id: ts.Identifier,
  b: Binding,
  contextual: ShaderType | undefined,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const inner = optionalInner(b.type)!;
  const state = narrowedStateOf(sourceFile, id);
  if (state === 'present') return valueOf(rawRead(b), inner);
  if (isOptional(contextual) && typeKey(contextual!) === typeKey(b.type)) return rawRead(b);
  pushDiag(diagnostics, sourceFile, id, unnarrowedReadSentence(id, b.type, sourceFile));
  return undefined;
}

// ─── `undefined` as a value ───

/** `undefined` written as a value: the absent value where an optional is expected, and
 *  refused anywhere else, since it is no value of any other type. */
export function lowerUndefinedValue(
  node: ts.Identifier,
  contextual: ShaderType | undefined,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const inner = optionalInner(contextual);
  if (inner !== undefined) return absentOf(contextual!, inner, (n) => scope.structByName(n));
  // On the statement for a `return undefined;`, where TypeScript puts its TS2322 (Rule 12.4).
  pushDiag(
    diagnostics,
    sourceFile,
    placeOf(node),
    `"undefined" is the absent value of an optional type, "T | undefined", and nothing here ` +
      `declares one (Rule 7.10). Write it where a "T | undefined" is expected: a result, a ` +
      `local or a parameter declared so.`,
  );
  return undefined;
}

// ─── An operand that may be optional, read as it is ───

/** `node` lowered as the value it is, an optional included: a name bound to an optional reads
 *  as the whole value, which `lowerIdentifier` would otherwise refuse as un-narrowed. */
export function lowerOptionalOperand(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const b = optionalBindingOf(node, scope);
  if (b !== undefined) return rawRead(b);
  return lowerExpression(node, sourceFile, scope, diagnostics);
}

/** `value`, read more than once: as it is when reading it twice is reading a name or a member
 *  of one, else bound to a temporary ahead of the statement. Undefined, having said why,
 *  where no statement can take the temporary (a loop's condition, a module constant). */
function once(
  value: Expr,
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (readsOnce(value)) return value;
  if (scope.canHoist()) return scope.hoistTemp('_opt', value);
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `"${node.getText(sourceFile)}" is read twice here, for its flag and its value, and runs ` +
      `once: take it in a const on a line of its own first, or, in a loop's condition, in a ` +
      `local the body assigns.`,
    TS_CODES.UNSUPPORTED,
  );
  return undefined;
}

const readsOnce = (e: Expr): boolean =>
  e.op === 'varref' ||
  e.op === 'param' ||
  e.op === 'constref' ||
  e.op === 'lit' ||
  (e.op === 'member' && readsOnce(e.base)) ||
  (e.op === 'index' && readsOnce(e.base) && readsOnce(e.idx));

// ─── `v === undefined` and `v === x` ───

const EQUALITY: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

const isEqualsOp = (k: ts.SyntaxKind): boolean =>
  k === ts.SyntaxKind.EqualsEqualsEqualsToken || k === ts.SyntaxKind.EqualsEqualsToken;

/** `v === undefined` and its three spellings, in either order: the flag, or its negation.
 *  'not-a-test' when neither operand is `undefined`. */
export function lowerUndefinedTest(
  node: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined | 'not-a-test' {
  if (!EQUALITY.has(node.operatorToken.kind)) return 'not-a-test';
  const tested = isUndefinedLiteral(node.right)
    ? node.left
    : isUndefinedLiteral(node.left)
      ? node.right
      : undefined;
  if (tested === undefined) return 'not-a-test';
  const value = lowerOptionalOperand(tested, sourceFile, scope, diagnostics);
  if (value === undefined) return undefined;
  if (!isOptional(value.type)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${tested.getText(sourceFile)}" is ${anOf(authorTypeText(value.type))}, which is always ` +
        `there, so comparing it with undefined is never true. Declare it ` +
        `"${authorTypeText(value.type)} | undefined" if it may be absent, or drop the test.`,
    );
    return undefined;
  }
  const flag = presentFlagOf(value);
  return isEqualsOp(node.operatorToken.kind) ? notOf(flag) : flag;
}

/** `v === x` where one or both operands are optional (Rule 7.10): ECMAScript's result. Two
 *  absent values are equal; an absent value equals no `T`. 'not-optional' when neither is. */
export function lowerOptionalEquality(
  node: ts.BinaryExpression,
  left: Expr,
  right: Expr,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined | 'not-optional' {
  const lo = optionalInner(left.type);
  const ro = optionalInner(right.type);
  if (lo === undefined && ro === undefined) return 'not-optional';
  if (!EQUALITY.has(node.operatorToken.kind)) {
    const bad = lo !== undefined ? node.left : node.right;
    pushDiag(
      diagnostics,
      sourceFile,
      bad,
      unnarrowedReadSentence(bad, lo !== undefined ? left.type : right.type, sourceFile),
    );
    return undefined;
  }
  const inner = lo ?? ro!;
  if (
    typeKey(inner) !== typeKey(lo === undefined ? left.type : ro === undefined ? right.type : ro!)
  ) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Type mismatch in compare: ${authorTypeText(left.type)} and ${authorTypeText(right.type)}.`,
    );
    return undefined;
  }
  if (inner.kind !== 'scalar' && inner.kind !== 'vec' && inner.kind !== 'f64') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Cannot ${node.operatorToken.getText(sourceFile)} ${authorTypeText(inner)}: WGSL has no ` +
        `equality on ${anOf(inner.kind === 'struct' ? 'struct' : inner.kind === 'array' ? 'array' : 'matrix')}. Compare the fields, or test the flag alone, "v !== undefined".`,
    );
    return undefined;
  }
  const l = lo !== undefined ? once(left, node.left, sourceFile, scope, diagnostics) : left;
  const r = ro !== undefined ? once(right, node.right, sourceFile, scope, diagnostics) : right;
  if (l === undefined || r === undefined) return undefined;
  const negated = !isEqualsOp(node.operatorToken.kind);
  const lv = lo !== undefined ? valueOf(l, inner) : l;
  const rv = ro !== undefined ? valueOf(r, inner) : r;
  const sameValue: Expr =
    inner.kind === 'vec'
      ? // Componentwise, as `===` on two vectors is (§27): a vector of bools picked by the flag.
        { op: 'compare', type: { kind: 'vec', n: inner.n, elem: 'bool' }, cop: '==', a: lv, b: rv }
      : { op: 'compare', type: boolT, cop: '==', a: lv, b: rv };
  let both: Expr;
  if (lo !== undefined && ro !== undefined) {
    // Equal flags, and equal values when both are there.
    const flags: Expr = {
      op: 'compare',
      type: boolT,
      cop: '==',
      a: presentFlagOf(l),
      b: presentFlagOf(r),
    };
    if (inner.kind === 'vec') {
      const all: Expr = { op: 'call', type: boolT, fn: 'all', args: [sameValue] };
      both = {
        op: 'logical',
        type: boolT,
        lop: '&&',
        a: flags,
        b: { op: 'logical', type: boolT, lop: '||', a: notOf(presentFlagOf(l)), b: all },
      };
    } else {
      both = {
        op: 'logical',
        type: boolT,
        lop: '&&',
        a: flags,
        b: { op: 'logical', type: boolT, lop: '||', a: notOf(presentFlagOf(l)), b: sameValue },
      };
    }
  } else {
    const flag = presentFlagOf(lo !== undefined ? l : r);
    if (inner.kind === 'vec') {
      const no: Expr = { op: 'lit', type: boolT, value: false };
      const falses: Expr = {
        op: 'construct',
        type: { kind: 'vec', n: inner.n, elem: 'bool' },
        args: Array.from({ length: inner.n }, () => no),
      };
      const picked: Expr = {
        op: 'select',
        type: falses.type,
        cond: flag,
        ifTrue: sameValue,
        ifFalse: falses,
      };
      return negated ? notVec(picked) : picked;
    }
    both = { op: 'logical', type: boolT, lop: '&&', a: flag, b: sameValue };
  }
  return negated ? notOf(both) : both;
}

const notVec = (m: Expr): Expr => {
  const t = m.type as { kind: 'vec'; n: 2 | 3 | 4 };
  const no: Expr = { op: 'lit', type: boolT, value: false };
  return {
    op: 'compare',
    type: m.type,
    cop: '==',
    a: m,
    b: { op: 'construct', type: m.type, args: Array.from({ length: t.n }, () => no) },
  };
};

// ─── `v ?? d` ───

/** `v ?? d`: `v.value` when `v` is present, `d` otherwise. The Rule 7.9 pass makes an `if` of
 *  the `select` when `d` writes, so `d` runs only when `v` is absent. A `v` that is no
 *  optional is itself, as ECMAScript reads it; `d` is still checked. */
export function lowerNullish(
  node: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  contextual: ShaderType | undefined,
): Expr | undefined {
  const left = lowerOptionalOperand(node.left, sourceFile, scope, diagnostics);
  if (left === undefined) return undefined;
  const inner = optionalInner(left.type);
  if (inner === undefined) {
    // Never absent: the left operand is the value. TypeScript accepts the form and so does
    // this; the right operand is lowered for its own mistakes and dropped.
    lowerExpression(node.right, sourceFile, scope, [], left.type);
    return left;
  }
  // The right operand takes the left's own type as its context, so `v ?? 1` takes an i32's
  // literal and `v ?? w` with an optional `w` keeps the result optional.
  const rightCtx = optionalInner(contextual) !== undefined ? contextual : inner;
  const rightName = optionalBindingOf(node.right, scope);
  let right =
    rightName !== undefined &&
    narrowedStateOf(sourceFile, skipParens(node.right) as ts.Identifier) !== 'present'
      ? rawRead(rightName)
      : lowerExpression(node.right, sourceFile, scope, diagnostics, rightCtx);
  if (right === undefined) return undefined;
  right = retargetIntLitCtx(right, node.right, inner);
  const v = once(left, node.left, sourceFile, scope, diagnostics);
  if (v === undefined) return undefined;
  if (typeKey(right.type) === typeKey(inner)) {
    return {
      op: 'select',
      type: inner,
      cond: presentFlagOf(v),
      ifTrue: valueOf(v, inner),
      ifFalse: right,
    };
  }
  if (typeKey(right.type) === typeKey(left.type)) {
    return { op: 'select', type: left.type, cond: presentFlagOf(v), ifTrue: v, ifFalse: right };
  }
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `"??" gives ${authorTypeText(inner)} from "${node.left.getText(sourceFile)}" and ` +
      `${authorTypeText(right.type)} from "${node.right.getText(sourceFile)}", and a value has one type.`,
  );
  return undefined;
}

/** `v ??= d` as a statement: `if (!v.present) { v = d; }`. */
export function lowerNullishAssign(
  node: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  const b = optionalBindingOf(node.left, scope);
  if (b === undefined) {
    const target = lowerOptionalOperand(node.left, sourceFile, scope, diagnostics);
    if (target === undefined) return undefined;
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"??=" assigns an optional local or parameter when it is absent, and ` +
        `"${node.left.getText(sourceFile)}" is ${anOf(authorTypeText(target.type))}.`,
    );
    return undefined;
  }
  if (!b.mutable) {
    pushDiag(
      diagnostics,
      sourceFile,
      node.left,
      `Cannot assign to "${node.left.getText(sourceFile)}": it is a const.`,
      TS_CODES.CONST_ASSIGN,
    );
    return undefined;
  }
  const right = lowerExpression(node.right, sourceFile, scope, diagnostics, b.type);
  if (right === undefined) return undefined;
  if (typeKey(right.type) !== typeKey(b.type)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node.right,
      `Type mismatch in assign: ${authorTypeText(right.type)} to ${authorTypeText(b.type)}.`,
    );
    return undefined;
  }
  const target = rawRead(b);
  return {
    s: 'if',
    arms: [{ cond: notOf(presentFlagOf(target)), body: [{ s: 'assign', target, expr: right }] }],
  };
}

// ─── `o?.f`, `o?.xy`, `o?.[i]` ───

/** A member, a swizzle or an element of a present `o`, as an optional of its type. `read`
 *  lowers the access as if `o` were the value it holds; this binds `o` once and wraps it. */
export function lowerOptionalChain(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  read: () => Expr | undefined,
): Expr | undefined {
  const obj = lowerOptionalOperand(node.expression, sourceFile, scope, diagnostics);
  if (obj === undefined) return undefined;
  const inner = optionalInner(obj.type);
  if (inner === undefined) {
    // `?.` on a value that is always there reads as `.`, as TypeScript reads it.
    scope.setChainAlias(node.expression, () => obj);
    return read();
  }
  const o = once(obj, node.expression, sourceFile, scope, diagnostics);
  if (o === undefined) return undefined;
  scope.setChainAlias(node.expression, () => valueOf(o, inner));
  const member = read();
  if (member === undefined) return undefined;
  if (isOptional(member.type)) return member;
  // `{ value: o.value.f, present: o.present }`: an absent `o` holds its zero, so the member
  // read is harmless and the flag alone says what the result is.
  return { op: 'construct', type: optionalT(member.type), args: [member, presentFlagOf(o)] };
}

// ─── The refusals ───

/** The sentence for an optional where a condition is read (`if (v)`, `v && …`): a condition
 *  is a bool, and the test to write names the flag. */
export function optionalConditionSentence(
  node: ts.Expression,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
): string | undefined {
  const b = optionalBindingOf(node, scope);
  if (b === undefined) return undefined;
  const inner = optionalInner(b.type)!;
  const name = node.getText(sourceFile);
  const remedy =
    typeKey(inner) === 'bool'
      ? `"${name} === true", or "${name} ?? false"`
      : `"${name} !== undefined"`;
  return `A condition is a bool, and "${name}" is "${authorTypeText(b.type)}". Write ${remedy}.`;
}

/** `v!` on an optional: refused, since a shader cannot check the assertion (decision D6). */
export function refuseNonNull(
  node: ts.NonNullExpression,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  const b = optionalBindingOf(node.expression, scope);
  if (b === undefined) return false;
  const inner = optionalInner(b.type)!;
  const name = node.expression.getText(sourceFile);
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `"${name}!" asserts that "${name}" is there, which a shader cannot check. Test it, ` +
      `"if (${name} !== undefined)", or give the absent case a value, ` +
      `"${name} ?? ${absentRemedyValue(inner, authorTypeText)}".`,
  );
  return true;
}

/** `o?.m()` and `f?.()`: refused. A call has effects, and a shader has no function value to
 *  test. */
export function refuseOptionalCall(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  const callee = node.expression;
  const chained =
    node.questionDotToken !== undefined ||
    ((ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) &&
      callee.questionDotToken !== undefined);
  if (!chained) return false;
  const obj =
    ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)
      ? callee.expression.getText(sourceFile)
      : callee.getText(sourceFile);
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `"?." before a call tests a function value, and a shader has none. Test the object first, ` +
      `"if (${obj} !== undefined)", and call it there.`,
    TS_CODES.UNSUPPORTED,
  );
  return true;
}

/** Whether the body contains a `return undefined;` (Rule 8.19): a function that writes no
 *  result type and returns `undefined` beside a value returns `T | undefined`. Closures are
 *  not read, since each has a result of its own. */
export function bodyReturnsUndefined(body: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)) return;
    if (ts.isReturnStatement(n) && n.expression !== undefined && isUndefinedLiteral(n.expression)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(body);
  return found;
}

/** The initializer of a declaration that writes no type, when it is an optional local or
 *  parameter (Rule 7.10): its value where the flow says it is present, as TypeScript types
 *  `const w = v` there, and the whole optional otherwise, so `w` is one too. Undefined when the
 *  initializer is anything else, which lowers as usual. */
export function lowerOptionalInitializer(
  init: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
): Expr | undefined {
  const b = optionalBindingOf(init, scope);
  if (b === undefined) return undefined;
  const id = skipParens(init) as ts.Identifier;
  const inner = optionalInner(b.type)!;
  const value =
    narrowedStateOf(sourceFile, id) === 'present' ? valueOf(rawRead(b), inner) : rawRead(b);
  noteValueType(init, value.type);
  return value;
}
