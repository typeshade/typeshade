// Implements: Rule 5.1 (docs/language-design.md; traced in reqs/).

import { logicalTypeKey as typeKey } from './optional.js';
import ts from 'typescript';
import type { Expr } from '../../core/ir/nodes.js';
import type { ShaderType } from '../../core/ir/types.js';
import { f64T, isF64 } from '../../core/ir/types.js';
import { BUILTIN_IDS } from '../../core/builtin-ids.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { makeDiagnostic } from './diagnostic.js';
import { noteDemand } from './use-inference.js';
import { TS_CODES } from './codes.js';
import {
  abstractLiteralOf,
  abstractTreeOf,
  isIntegerWrittenRead,
  noteF64Read,
  noteIntegerContext,
  noteIntegerRead,
  noteQuotientRead,
} from './abstract-const.js';
import { foldIntLit, intElemOf, wrapInt } from '../../core/passes/opt/expr-utils.js';

export function isIntegerLiteralNode(node: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(node)) return isIntegerLiteralNode(node.expression);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    return isIntegerLiteralNode(node.operand);
  }
  // A read of a constant of no fixed type stands where its written number could (item 2 of
  // change 0134).
  return (ts.isNumericLiteral(node) && isIntegerWritten(node)) || isIntegerWrittenRead(node);
}

/** Whether a numeric literal is written as an integer (Rule 5.1): `1`, `0x9e3779b9`, `0b1011`,
 *  `0o17`, `1_000`, but not `1.`, `1.5` or `1e3`. A `0x`, `0b` or `0o` literal is an integer
 *  whatever its digits, so an `e` in one is a hex digit and not an exponent (#182). The source
 *  text decides, not `node.text`, which TypeScript normalizes: `1.0` reads `1` and `1e3` `1000`. */
export function isIntegerWritten(node: ts.NumericLiteral): boolean {
  const written = node.getText();
  return /^0[xXbBoO]/.test(written) || !/[.eE]/.test(written);
}

export function isIntScalar(t: ShaderType): boolean {
  const k = typeKey(t);
  return k === 'i32' || k === 'u32';
}

/** Whether every leaf of `node` is an integer literal — the literal itself, one behind
 *  parentheses or a unary minus, or the two sides of `+ - * /` over such leaves.
 *
 *  This is what separates "an integer written without a decimal point" from "a number that
 *  happens to fold to a whole one". {@link retargetIntLit} folds BEFORE it retargets, so
 *  without this check `return 2.5 + 0.5` in a `u32` function emitted `return 3u;` — floats
 *  written as floats, silently retyped, which is the opposite of what §13 says the rule is. */
export function isIntegerLiteralTree(node: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(node)) return isIntegerLiteralTree(node.expression);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    return isIntegerLiteralTree(node.operand);
  }
  if (ts.isBinaryExpression(node)) {
    const k = node.operatorToken.kind;
    const arith =
      k === ts.SyntaxKind.PlusToken ||
      k === ts.SyntaxKind.MinusToken ||
      k === ts.SyntaxKind.AsteriskToken ||
      k === ts.SyntaxKind.SlashToken;
    return arith && isIntegerLiteralTree(node.left) && isIntegerLiteralTree(node.right);
  }
  return isIntegerLiteralNode(node);
}

/** Whether `v` is exactly representable in `target`. The retarget produced the literal by
 *  folding, so nothing downstream would have caught an out-of-range one: `return -1` in a
 *  `u32` function reported a type mismatch before this item and then became a silent `-1`
 *  that only the backend refused. Out of range, the expression is left exactly as it was and
 *  the type check that always covered it fires again. */
export function fitsTarget(v: number, target: ShaderType): boolean {
  if (!Number.isInteger(v)) return false;
  return typeKey(target) === 'u32'
    ? v >= 0 && v <= 4294967295
    : v >= -2147483648 && v <= 2147483647;
}

/** Folds a literal-only `binop` or a negated literal into one literal, with the arithmetic of
 *  the node's own type. A node typed `f32` (a written number has no other type until a position
 *  gives it one) folds with ECMAScript doubles, so `1 / 2` is `0.5` (decision Q1 of change
 *  0134). A node typed `i32` or `u32` folds as the target computes it (`foldIntLit`): a
 *  scalar cast yields a value of its type, so `u32(7) / 2` truncates to `3` and
 *  `u32(7) - 8` wraps to `4294967295`, as WGSL and GLSL ES 3.00 do. A fold the integer rule
 *  leaves undefined (a divisor of zero, a shift out of range) leaves the node as it is. */
export function foldNumericLit(expr: Expr): Expr {
  const int = intElemOf(expr.type);
  if (expr.op === 'unop' && expr.a.op === 'lit' && typeof expr.a.value === 'number') {
    // A negated `u32` has no value of its type to fold to: the node is left for the check
    // that refuses it, as it was before.
    if (int === 'u32') return expr;
    return {
      op: 'lit',
      type: expr.type,
      value: int === 'i32' ? wrapInt(-expr.a.value, 'i32') : -expr.a.value,
    };
  }
  if (
    expr.op === 'binop' &&
    (expr.bop === '+' || expr.bop === '-' || expr.bop === '*' || expr.bop === '/')
  ) {
    const a = foldNumericLit(expr.a);
    const b = foldNumericLit(expr.b);
    if (
      a.op === 'lit' &&
      b.op === 'lit' &&
      typeof a.value === 'number' &&
      typeof b.value === 'number'
    ) {
      if (int !== undefined) {
        const v = foldIntLit(expr.bop, a.value, b.value, int);
        return v === undefined ? expr : { op: 'lit', type: expr.type, value: v };
      }
      const v =
        expr.bop === '+'
          ? a.value + b.value
          : expr.bop === '-'
            ? a.value - b.value
            : expr.bop === '*'
              ? a.value * b.value
              : b.value === 0
                ? undefined
                : a.value / b.value;
      if (v !== undefined) return { op: 'lit', type: expr.type, value: v };
    }
  }
  return expr;
}

// ─── Trees of written integers (Rule 5.1, change 0134 item 1; issue 1261) ───────────────────
//
// THE RULE. `&`, `|`, `^`, `<<`, `>>`, `~`, `+`, `-`, `*`, `%`, `/` and a unary minus over written
// integers, integer-written constants of no fixed type and module constants that hold such a
// tree, with at least one bit operator among them, make one TREE. A tree has no type of its own:
// a bitwise operand with no typed peer is an integer of no kind. ONE function folds it,
// {@link foldKindless}, called at every operator of the tree as if that operator were the root;
// a larger tree that reads it folds it again from its leaves, and withdraws the verdict the
// smaller one left pending ({@link retractOperandRefusals}). Only the verdict of the outermost
// operator, the ROOT, stands. The root computes the value TypeScript computes for the whole
// tree (`kindlessValue`): `+ - * /` and `%` exactly, `& | ^ ~ << >>` on ToInt32 of their
// operands. One exception, change 0134 item 1: where the root is a bit operator beside a written
// number only a `u32` holds (`3000000000 | 1`), it works on `u32` bits and the value is that
// `u32`. The root then decides one of five verdicts:
//   1. an integer value an `i32` holds, else a `u32`: a literal of that type;
//   2. an integer value neither holds: refused (Rule 5.4);
//   3. a `>>` root beside a written `u32` whose `u32` bits and ToInt32 give other values:
//      refused, with the `u32()` edit (the owner's decision of 2026-11-11, "거부");
//   4. a value that is no integer, through a `/` (`(1 | 2) / 2` is 1.5): refused (D-b), with the
//      `f32()` edit, unless the position that reads it states an integer type (a declaration, a
//      parameter, a result, `i32()` or `u32()`, an index), which takes it truncated toward zero
//      as Amendment A4 takes a quotient, or a comparison reads it, which reads the exact value.
//      An integer peer that states no type (`vi + q`, `min(q, ii)`) refuses it with the integer
//      edit (`u32(1 | 2) / 2`). So no division gives a value other than TypeScript's, or its
//      truncation by a type the program states, without a diagnostic;
//   5. a `>>`, `&`, `|` or `^` root beside a written `u32` and a negative operand
//      (`3000000000 | -1`) is refused where it is lowered (the owner's decision, "거부 유지").
// Each refusal is pending until the root: it is pushed, and withdrawn when a larger tree reads
// the literal, or replaced when a position says it in its own words. The literal of a pending
// refusal has the type its position would take, so the refusal is the program's one mistake.

/** The literal each such tree was folded to, with the tree it was folded from. */
const kindlessBitwise = new WeakMap<Expr, Expr>();

/** The `/` of a tree, with the operator it was lowered from, for the sentence of verdict 4. */
const kindlessDivisions = new WeakMap<Expr, object>();

/** Records that `tree`, a `/` of a tree, was lowered from `info` (its node, and which operands
 *  carry a bit operator). */
export function noteKindlessDivision(tree: Expr, info: object): void {
  kindlessDivisions.set(tree, info);
}

/** The verdict of {@link foldKindless} for a tree read as a root. */
export type KindlessVerdict =
  | { readonly kind: 'int'; readonly lit: Expr }
  | { readonly kind: 'outside'; readonly lit: Expr; readonly value: number }
  | {
      readonly kind: 'readings';
      readonly lit: Expr;
      readonly u32: number;
      readonly ts: number;
    }
  | {
      readonly kind: 'quotient';
      readonly lit: Expr;
      readonly value: number;
      readonly division: object;
    };

/** Folds `tree`, read as the root (see THE RULE), to its verdict; `undefined` when a leaf is no
 *  constant, or the value is none (a divisor of zero). */
export function foldKindless(tree: Expr): KindlessVerdict | undefined {
  if (tree.op === 'binop' && tree.bop === '>>' && writtenU32(tree.a)) {
    const u = kindlessRoot(tree);
    const t = kindlessValue(tree);
    if (u !== undefined && t !== undefined && u >>> 0 !== t >>> 0) {
      return {
        kind: 'readings',
        lit: keep({ op: 'lit', type: u32Scalar, value: u }, tree),
        u32: u,
        ts: t,
      };
    }
  }
  const v = kindlessRoot(tree);
  if (v === undefined) return undefined;
  // TypeScript computes in doubles: a product past their range is Infinity, which ToInt32 at a
  // larger tree's bit operator reads as 0, and which no integer type holds at the root.
  if (!Number.isFinite(v)) {
    return { kind: 'outside', lit: keep({ op: 'lit', type: i32Scalar, value: v }, tree), value: v };
  }
  if (!Number.isInteger(v)) {
    const division = outermostDivision(tree);
    if (division === undefined) return undefined;
    return {
      kind: 'quotient',
      lit: keep({ op: 'lit', type: f32Scalar, value: v }, tree),
      value: v,
      division,
    };
  }
  for (const type of [i32Scalar, u32Scalar]) {
    if (fitsTarget(v, type)) return { kind: 'int', lit: keep({ op: 'lit', type, value: v }, tree) };
  }
  return { kind: 'outside', lit: keep({ op: 'lit', type: i32Scalar, value: v }, tree), value: v };
}

/** The outermost `/` of `tree` whose quotient is no integer, through the trees it reads. */
function outermostDivision(tree: Expr): object | undefined {
  const queue: Expr[] = [tree];
  while (queue.length > 0) {
    const e = queue.shift()!;
    const inner = kindlessBitwise.get(e);
    if (inner !== undefined && inner !== e) {
      queue.push(inner);
      continue;
    }
    const info = kindlessDivisions.get(e);
    if (info !== undefined) {
      const q = kindlessValue(e);
      if (q !== undefined && !Number.isInteger(q)) return info;
    }
    if (e.op === 'binop') queue.push(e.a, e.b);
    else if (e.op === 'unop') queue.push(e.a);
    else if (e.op === 'call') queue.push(...e.args);
  }
  return undefined;
}

/** A refusal a kindless literal carries until the root (see THE RULE). */
interface PendingRefusal {
  readonly diagnostic: TsCompilerDiagnostic;
  readonly into: TsCompilerDiagnostic[];
  readonly kind: KindlessVerdict['kind'];
  readonly value: number;
  /** The same refusal at a position of the integer type `peer` that states no type: the range
   *  sentence of that type, or the integer edit of verdict 4. */
  readonly at?: (peer: ShaderType) => TsCompilerDiagnostic;
}

/** One pending refusal as it stands, whichever literal of its tree carries it now: a retyped
 *  literal takes it over (`carryPending`), and a check of its edit reads it here. */
export interface RefusalCell {
  /** The refusal as it stands; `undefined` once it is withdrawn. */
  diagnostic: TsCompilerDiagnostic | undefined;
  readonly into: TsCompilerDiagnostic[];
  readonly kind: KindlessVerdict['kind'];
  readonly value: number;
  readonly at?: (peer: ShaderType) => TsCompilerDiagnostic;
}

const pendingRefusals = new WeakMap<Expr, RefusalCell>();

/** Records that `lit` stands refused, pending until the root: `diagnostic` is pushed into `into`.
 *  Returns the cell that follows the refusal wherever it moves. */
export function noteKindlessRefusal(lit: Expr, refusal: PendingRefusal): RefusalCell {
  refusal.into.push(refusal.diagnostic);
  const cell: RefusalCell = { ...refusal };
  pendingRefusals.set(lit, cell);
  return cell;
}

/** The verdict kind of the refusal `expr` carries, if it carries one. */
export function pendingKindlessRefusal(expr: Expr): KindlessVerdict['kind'] | undefined {
  return pendingRefusals.get(expr)?.kind;
}

/** Puts `diagnostic` in place of the refusal `cell` holds, if it still stands. */
export function replaceRefusal(cell: RefusalCell, diagnostic: TsCompilerDiagnostic): void {
  if (cell.diagnostic === undefined) return;
  const i = cell.into.indexOf(cell.diagnostic);
  if (i >= 0) cell.into[i] = diagnostic;
  cell.diagnostic = diagnostic;
}

/** Withdraws the refusal of `expr`, when it is a kindless literal that carries one: a larger
 *  tree folds it, or a position reads it as THE RULE allows. Returns whether it did. */
export function retractKindlessRefusal(expr: Expr): boolean {
  const cell = pendingRefusals.get(expr);
  if (cell === undefined) return false;
  pendingRefusals.delete(expr);
  if (cell.diagnostic !== undefined) {
    const i = cell.into.indexOf(cell.diagnostic);
    if (i >= 0) cell.into.splice(i, 1);
    cell.diagnostic = undefined;
  }
  return true;
}

/** Puts the refusal of `expr` in the words of a position of the integer type `peer`. */
function restatePending(expr: Expr, peer: ShaderType): void {
  const cell = pendingRefusals.get(expr);
  if (cell?.at === undefined) return;
  replaceRefusal(cell, cell.at(peer));
}

/** Withdraws the refusals of the direct operands of `tree`, which a fold of `tree` reads. */
export function retractOperandRefusals(tree: Expr): void {
  const parts: Expr[] =
    tree.op === 'binop'
      ? [tree.a, tree.b]
      : tree.op === 'unop'
        ? [tree.a]
        : tree.op === 'call'
          ? [...tree.args]
          : [];
  for (const part of parts) {
    retractKindlessRefusal(part);
    if (part.op === 'call' && part.fn === 'u32') retractKindlessRefusal(part.args[0]!);
  }
}

const i32Scalar: ShaderType = { kind: 'scalar', scalar: 'i32' };
const u32Scalar: ShaderType = { kind: 'scalar', scalar: 'u32' };
const f32Scalar: ShaderType = { kind: 'scalar', scalar: 'f32' };

function keep(lit: Expr, tree: Expr): Expr {
  kindlessBitwise.set(lit, kindlessBitwise.get(tree) ?? tree);
  return lit;
}

/** Moves the pending refusal of `from` to `to`, a retyped literal of the same tree. */
function carryPending(from: Expr, to: Expr): Expr {
  const pending = pendingRefusals.get(from);
  if (pending !== undefined) {
    pendingRefusals.set(to, pending);
    pendingRefusals.delete(from);
  }
  return to;
}

/** Whether `expr` is the literal of a tree of written integers ({@link foldKindless}). */
export function isKindlessBitwise(expr: Expr): boolean {
  return kindlessBitwise.has(expr);
}

/** The value of the kindless `expr` read as the root ({@link kindlessRoot}). */
function kindlessIn(expr: Expr, target: ShaderType): number | undefined {
  const tree = kindlessBitwise.get(expr);
  return tree === undefined || !isIntScalar(target) ? undefined : kindlessRoot(tree);
}

/** `expr` at the integer type `target` (see THE RULE). `declared` is whether the position states
 *  its type (a declaration, a parameter, a result, an index), which takes a value that is no
 *  integer truncated toward zero (Amendment A4); a peer that states none (`vi + q`) refuses it.
 *  `undefined` where the position refuses the value in its own words (`reportIntLitRange`). */
function retypeKindless(expr: Expr, target: ShaderType, declared: boolean): Expr | undefined {
  if (!isKindlessBitwise(expr) || !isIntScalar(target)) return undefined;
  let v = kindlessIn(expr, target);
  if (v === undefined) return undefined;
  // A tree whose `u32` bits and TypeScript value differ is that value at an `i32`, which is
  // ToInt32 of its bits: both readings agree there.
  const readings = kindlessReadings(expr);
  if (readings !== undefined && typeKey(target) === 'i32') v = readings.ts;
  const pending = pendingRefusals.get(expr);
  if (pending?.kind === 'readings') {
    // Refused for its two readings: the position reads it as the refused program would.
    return typeKey(expr.type) === typeKey(target)
      ? undefined
      : carryPending(expr, keep({ op: 'lit', type: target, value: v >>> 0 }, expr));
  }
  if (!Number.isInteger(v)) {
    const t = Math.trunc(v);
    if (declared) {
      // Amendment A4: the position that states an integer type reads the quotient truncated.
      retractKindlessRefusal(expr);
      return fitsTarget(t, target) ? keep({ op: 'lit', type: target, value: t }, expr) : undefined;
    }
    // A peer that states no type: the `/` is refused with the integer edit, and the position
    // takes the truncated value, so it adds no second mistake.
    restatePending(expr, target);
    return carryPending(expr, keep({ op: 'lit', type: target, value: t }, expr));
  }
  if (typeKey(expr.type) === typeKey(target) && fitsTarget(v, target)) return undefined;
  if (fitsTarget(v, target)) return keep({ op: 'lit', type: target, value: v }, expr);
  if (pending?.kind === 'outside' && !declared) {
    // Refused already for its value: the peer's type names the range, with no second mistake.
    restatePending(expr, target);
    return carryPending(expr, keep({ op: 'lit', type: target, value: v }, expr));
  }
  return undefined;
}

/** Reads `expr`, a kindless literal, where a comparison or a declared conversion reads it: a
 *  value that is no integer is read exactly (a comparison) or truncated by the conversion's
 *  type, which the program states, so verdict 4 does not stand. */
export function readKindlessExactly(expr: Expr): void {
  if (pendingRefusals.get(expr)?.kind === 'quotient') retractKindlessRefusal(expr);
}

/** Where a declared integer position (an index) reads `expr`, a kindless literal: its value at
 *  `target` (see {@link retypeKindless}); `undefined` for any other expression. */
export function retypeKindlessDeclared(expr: Expr, target: ShaderType): Expr | undefined {
  return retypeKindless(expr, target, true);
}

const BIT_OPS: ReadonlySet<string> = new Set(['&', '|', '^', '<<', '>>']);

/** Whether `e` is a written number only a `u32` holds: a literal that is no folded expression. */
function writtenU32(e: Expr): boolean {
  return (
    e.op === 'lit' && typeof e.value === 'number' && e.value > 2147483647 && !kindlessBitwise.has(e)
  );
}

/** The value of the tree `tree` read as the root (see THE RULE): TypeScript's, with the `u32`
 *  exception for a root bit operator beside a written `u32`. */
function kindlessRoot(tree: Expr): number | undefined {
  if (
    tree.op === 'call' &&
    tree.fn === '~' &&
    tree.args.length === 1 &&
    writtenU32(tree.args[0]!)
  ) {
    return ~(tree.args[0] as { value: number }).value >>> 0;
  }
  if (tree.op === 'binop' && BIT_OPS.has(tree.bop) && (writtenU32(tree.a) || writtenU32(tree.b))) {
    const a = kindlessValue(tree.a);
    const b = kindlessValue(tree.b);
    if (a === undefined || b === undefined) return undefined;
    const [ua, ub] = [a >>> 0, b >>> 0];
    switch (tree.bop) {
      case '&':
        return (ua & ub) >>> 0;
      case '|':
        return (ua | ub) >>> 0;
      case '^':
        return (ua ^ ub) >>> 0;
      case '<<':
        return ub > 31 ? undefined : (ua << ub) >>> 0;
      default:
        return ub > 31 ? undefined : ua >>> ub;
    }
  }
  return kindlessValue(tree);
}

/** The two values of a tree of written integers whose root reads a written `u32` (THE RULE's
 *  `u32` exception): its `u32` bits and TypeScript's ToInt32 value, where they differ
 *  (`3000000000 | 0` is 3000000000 and -1294967296). `undefined` for any other value. */
export function kindlessReadings(
  expr: Expr,
): { readonly u32: number; readonly ts: number } | undefined {
  if (!kindlessBitwise.has(expr)) return undefined;
  const tree = kindlessBitwise.get(expr)!;
  const u = kindlessRoot(tree);
  const t = kindlessValue(tree);
  if (u === undefined || t === undefined || u === t) return undefined;
  return { u32: u, ts: t };
}

/** The value TypeScript computes for `expr`, a tree or one of its leaves: `+ - * /` and `%`
 *  exactly, `& | ^ ~ << >>` on ToInt32 of their operands. `undefined` where a leaf is no
 *  constant. */
function kindlessValue(expr: Expr): number | undefined {
  const inner = kindlessBitwise.get(expr);
  if (inner !== undefined && inner !== expr) return kindlessValue(inner);
  if (expr.op === 'lit') {
    return typeof expr.value === 'number' && Number.isFinite(expr.value) ? expr.value : undefined;
  }
  if (expr.op === 'call' && expr.fn === '~' && expr.args.length === 1) {
    const a = kindlessValue(expr.args[0]!);
    return a === undefined ? undefined : ~a;
  }
  if (expr.op === 'unop') {
    const a = kindlessValue(expr.a);
    return a === undefined ? undefined : -a;
  }
  if (expr.op === 'call' && expr.fn === 'u32' && expr.args.length === 1) {
    // A shift amount the lowering converted to `u32`.
    const a = kindlessValue(expr.args[0]!);
    return a === undefined ? undefined : a >>> 0;
  }
  if (expr.op !== 'binop') return undefined;
  const a = kindlessValue(expr.a);
  const b = kindlessValue(expr.b);
  if (a === undefined || b === undefined) return undefined;
  switch (expr.bop) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return b === 0 ? undefined : a / b;
    case '%':
      return b === 0 ? undefined : a % b;
    case '&':
      return a & b;
    case '|':
      return a | b;
    case '^':
      return a ^ b;
    case '<<':
      return b >>> 0 > 31 ? undefined : a << b;
    case '>>':
      return b >>> 0 > 31 ? undefined : a >> b;
    default:
      return undefined;
  }
}

/** The module constants of each file whose initializer is a bitwise expression over written
 *  integers (`const K = 1 << 4`), by IR name: a `/` over a read of one is refused as a `/` over
 *  the expression is (D-b of #1272, issue 1261). */
const kindlessModuleConsts = new WeakMap<ts.SourceFile, Set<string>>();

/** Whether the module constant `name` of `sourceFile` holds a tree of written integers. */
export function isKindlessModuleConst(sourceFile: ts.SourceFile, name: string): boolean {
  return kindlessModuleConsts.get(sourceFile)?.has(name) === true;
}

/** Marks `lit`, the value of a module constant that holds a tree, as a leaf of a larger tree. */
export function markKindlessLeaf(lit: Expr): Expr {
  kindlessBitwise.set(lit, lit);
  return lit;
}

/** Records that the module constant `name` of `sourceFile` holds such a value. */
export function markKindlessModuleConst(sourceFile: ts.SourceFile, name: string): void {
  let names = kindlessModuleConsts.get(sourceFile);
  if (names === undefined) kindlessModuleConsts.set(sourceFile, (names = new Set()));
  names.add(name);
}

/** The local bindings with no declared type whose initializer is a bitwise expression over
 *  written integers, or arithmetic over such values and written integers (`let a = 1 | 2`). */
const kindlessBindings = new WeakMap<object, string>();

/** Records that `binding` holds such a value: a `/` over it does not say which division it is.
 *  `declared` is its declaration with its type written, the edit a refused `/=` names. */
export function markKindlessBinding(binding: object, declared: string): void {
  kindlessBindings.set(binding, declared);
}

/** The bindings that hold a tree whose `u32` bits and TypeScript value differ
 *  (`let a = 3000000000 | 0`), with those two values: every use of the binding where the two
 *  give different results is refused (the owner's decision of 2026-11-12, D2). */
const readingsBindings = new WeakMap<object, { readonly u32: number; readonly ts: number }>();

/** The two values of `expr` where its `u32` bits and TypeScript value differ: a tree
 *  ({@link kindlessReadings}) or a read of a binding that holds one. */
export function readingsOf(
  expr: Expr,
  resolve: (name: string) => object | undefined,
): { readonly u32: number; readonly ts: number } | undefined {
  const direct = kindlessReadings(expr);
  if (direct !== undefined) return direct;
  if (expr.op !== 'varref') return undefined;
  const b = resolve(expr.name);
  return b === undefined ? undefined : readingsBindings.get(b);
}

/** Records that `binding` holds a value with `readings` (a compound assignment added one). */
export function markReadingsWith(
  binding: object | undefined,
  readings: { readonly u32: number; readonly ts: number } | undefined,
): void {
  if (binding !== undefined && readings !== undefined) readingsBindings.set(binding, readings);
}

/** Records that `binding` holds `init`'s two readings, where it has two. */
export function markReadingsBinding(
  binding: object,
  init: Expr,
  resolve: (name: string) => object | undefined,
): void {
  const readings = readingsOf(init, resolve);
  if (readings !== undefined) readingsBindings.set(binding, readings);
}

/** The declaration with its type written of a binding {@link markKindlessBinding} marked. */
export function kindlessDeclaration(binding: object | undefined): string | undefined {
  return binding === undefined ? undefined : kindlessBindings.get(binding);
}

/** Where `expr` comes from, for a `/` over it (Amendment A2 of change 0134, the owner's decision
 *  of 2026-11-11, D-b): `'kindless'` when it is a bitwise expression over written integers, a
 *  binding that holds one, or `+ - * % & | ^ << >>`, a minus or a `~` over those and written
 *  integers; `'written'` for a written integer alone; `'typed'` for anything with a type of its
 *  own. `resolve` finds the binding of a name. */
/** Whether `n` holds a conversion the author wrote, `i32(…)`, `u32(…)` or `f32(…)`, as an
 *  operand of its arithmetic (`i32(2) + 1`): such a value states its type (decision Q11 of
 *  change 0134), and a `/` beside it is that type's division. */
export function statesType(n: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(n)) return statesType(n.expression);
  if (ts.isCallExpression(n)) {
    return ts.isIdentifier(n.expression) && ['i32', 'u32', 'f32'].includes(n.expression.text);
  }
  if (ts.isPrefixUnaryExpression(n)) return statesType(n.operand);
  if (ts.isBinaryExpression(n)) return statesType(n.left) || statesType(n.right);
  return false;
}

/** The builtins whose call states its type: a conversion or a constructor. */
const STATED_TYPE = /^(f32|f16|f64|i32|u32|bool|vec[234][fiuh]?|mat[234](x[234])?[fh]?|array)$/;

export function kindlessOrigin(
  expr: Expr,
  resolve: (name: string) => object | undefined,
  sourceFile?: ts.SourceFile,
): 'kindless' | 'written' | 'typed' {
  if (kindlessBitwise.has(expr)) return 'kindless';
  if (expr.op === 'lit') return typeof expr.value === 'number' ? 'written' : 'typed';
  // A read of a constant of no fixed type (`const K = 4`, in a module, a function or another
  // file) is its written number (change 0134 item 2): it states no type.
  const abstract = abstractLiteralOf(expr);
  if (
    abstract !== undefined &&
    kindlessModuleConsts.get(sourceFile!)?.has((expr as { name?: string }).name ?? '') !== true
  ) {
    return abstract.op === 'lit' && typeof abstract.value === 'number' ? 'written' : 'typed';
  }
  // A module constant whose initializer is one (`const K = 1 << 4`), read in a function.
  if (expr.op === 'constref') {
    return sourceFile !== undefined && kindlessModuleConsts.get(sourceFile)?.has(expr.name) === true
      ? 'kindless'
      : 'typed';
  }
  if (expr.op === 'varref' || expr.op === 'param') {
    const b = resolve(expr.name);
    return b !== undefined && kindlessBindings.has(b) ? 'kindless' : 'typed';
  }
  // A builtin carries the origin of its arguments (`abs(1 << 1)`, `min(1 << 1, 9)`), as it
  // carries a constant's (Amendment A3 of change 0134); `select` carries its two arms'. A
  // conversion and a constructor state a type.
  const parts: Expr[] =
    expr.op === 'unop'
      ? [expr.a]
      : expr.op === 'call' && expr.fn === '~' && expr.declRef === undefined
        ? [...expr.args]
        : expr.op === 'call' &&
            expr.declRef === undefined &&
            BUILTIN_IDS.has(expr.fn) &&
            !STATED_TYPE.test(expr.fn)
          ? expr.fn === 'select'
            ? expr.args.slice(0, -1)
            : [...expr.args]
          : expr.op === 'select'
            ? [expr.ifTrue, expr.ifFalse]
            : expr.op === 'binop' &&
                ['+', '-', '*', '%', '&', '|', '^', '<<', '>>'].includes(expr.bop)
              ? [expr.a, expr.b]
              : [];
  if (parts.length === 0) return 'typed';
  const each = parts.map((e) => kindlessOrigin(e, resolve, sourceFile));
  if (each.includes('typed')) return 'typed';
  // A bit operator over written integers is an integer by its operator, also where a part is
  // no fold (`(c ? 3 : 9) << 2`).
  const bits =
    (expr.op === 'binop' && ['&', '|', '^', '<<', '>>'].includes(expr.bop)) ||
    (expr.op === 'call' && expr.fn === '~');
  return bits || each.includes('kindless') ? 'kindless' : 'written';
}

/** The `/` over a bitwise expression of written integers that is refused where no integer
 *  position reads it (D-b), lowered as the float division its edit names, each with its integer
 *  division at an integer type: an integer position takes that (Amendment A4). */
const integerQuotients = new WeakMap<
  Expr,
  (target: ShaderType, declared: boolean) => Expr | undefined
>();

/** Records `float` as such a quotient, with its integer division `at` a type. Returns `float`. */
export function markIntegerQuotient(
  float: Expr,
  at: (target: ShaderType, declared: boolean) => Expr | undefined,
): Expr {
  integerQuotients.set(float, at);
  return float;
}

/** Whether `expr` is a quotient {@link markIntegerQuotient} recorded. */
export function isIntegerQuotient(expr: Expr): boolean {
  return integerQuotients.has(expr);
}

/** The local bindings that hold such a quotient (`let q = (1 | 2) / 2`). */
const quotientBindings = new WeakSet<object>();

/** Records that `binding` holds a quotient refused where no integer position reads it. */
export function markQuotientBinding(binding: object): void {
  quotientBindings.add(binding);
}

/** `read`, a read of `binding`: where the binding holds a refused quotient, an integer position
 *  converts it to its type, so the refusal of the `/` is the program's one mistake (Rule 12.4;
 *  `xs[q]` with `let q = (1 | 2) / 2`). Returns `read`. */
export function markQuotientRead(read: Expr, binding: object, node?: ts.Node): Expr {
  if (quotientBindings.has(binding)) {
    if (node !== undefined) noteQuotientRead(node);
    integerQuotients.set(read, (target) => ({
      op: 'call',
      type: target,
      fn: typeKey(target) === 'u32' ? 'u32' : 'i32',
      args: [read],
    }));
  }
  return read;
}

/** The integer division of the quotient `expr` at the integer type `target`, when `expr` is one
 *  {@link markIntegerQuotient} recorded. */
export function integerQuotientAt(
  expr: Expr,
  target: ShaderType,
  declared: boolean,
): Expr | undefined {
  const at = integerQuotients.get(expr);
  return at === undefined || !isIntScalar(target) ? undefined : at(target, declared);
}

export function retargetIntLit(expr: Expr, node: ts.Expression, peer: ShaderType): Expr {
  // A value whose type its uses decide takes this peer's type, as a written number does: the
  // use is recorded, and the next pass lowers the value with it (`use-inference.ts`).
  noteDemand(expr, peer);
  const kindless = retypeKindless(expr, peer, false);
  if (kindless !== undefined) return kindless;
  // An integer peer reads a quotient over a binding: its integer division, with the `/` refused
  // in the peer's words (D-b).
  if (isIntScalar(peer) && integerQuotients.has(expr)) {
    const q = integerQuotientAt(expr, peer, false);
    if (q !== undefined) return q;
  }
  // A read of a constant of no fixed type, or arithmetic over such reads and written numbers,
  // takes an integer peer's type as the written number would (Rule 5.1, change 0134 item 2).
  // Beside anything else it is left as lowered, so an `f32` read keeps the constant's name.
  // An integer position asks an integer of a `/` inside what it reads (`xs[k / 2]`,
  // `r + y / 2`), whether or not a literal is kept: the refusal of that `/` names the integer edit.
  if (isIntScalar(peer)) noteIntegerContext(node, typeKey(peer) === 'u32' ? 'u32' : 'i32');
  const abstract = abstractLiteralOf(expr);
  if (abstract !== undefined && abstract.op === 'lit' && typeof abstract.value === 'number') {
    if (!isIntScalar(peer)) return expr;
    const kind = typeKey(peer) === 'u32' ? 'u32' : 'i32';
    const tree = abstractTreeOf(node);
    if (
      tree === undefined ||
      !tree.integerWritten ||
      !Number.isInteger(abstract.value) ||
      !fitsTarget(abstract.value, peer)
    )
      return expr;
    // The literal is kept, so this is a read of the constant as an integer.
    noteIntegerRead(node, kind);
    return { op: 'lit', type: peer, value: abstract.value };
  }
  return retargetWrittenIntLit(expr, node, peer);
}

function retargetWrittenIntLit(expr: Expr, node: ts.Expression, peer: ShaderType): Expr {
  const folded = foldNumericLit(expr);
  if (folded.op !== 'lit' || typeof folded.value !== 'number') return folded;
  if (!isIntScalar(peer)) return folded;
  // A conversion the author wrote states its type, also inside arithmetic (`f32(2) + 1`,
  // `i32(2) + 1`): its fold keeps that type (decision Q11 of change 0134).
  if (statesType(node)) return folded;
  if (!isIntegerLiteralNode(node) && folded === expr) return folded;
  if (!isIntegerLiteralNode(node) && !Number.isInteger(folded.value)) return folded;
  if (!isIntegerLiteralNode(node) && expr.op !== 'unop' && expr.op !== 'binop') return folded;
  if (!isIntegerLiteralNode(node) && expr.op === 'lit') return folded;
  if (!fitsTarget(folded.value, peer)) return expr;
  return { op: 'lit', type: peer, value: folded.value };
}

function stripParens(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? stripParens(node.expression) : node;
}

/** The f64 arm of {@link retargetIntLitCtx}: a literal WRITTEN as a number, in a position
 *  declared `f64`, becomes an f64 literal carrying the full double. An expression that is not
 *  a literal (a call, a parameter, arithmetic that does not fold) is returned untouched and
 *  keeps whatever mismatch it had. */
function retargetF64DeclaredLit(expr: Expr, node: ts.Expression): Expr {
  if (ts.isCallExpression(stripParens(node))) return expr;
  // A constant of no fixed type read in a declared `f64` position carries the full double.
  const folded = foldNumericLit(abstractLiteralOf(expr) ?? expr);
  if (folded.op !== 'lit' || typeof folded.value !== 'number') return expr;
  if (typeKey(folded.type) !== 'f32') return expr;
  noteF64Read(node, f64T);
  return { op: 'lit', type: f64T, value: folded.value };
}

/** A bare integer literal takes the type the context around it declares (#8 A3).
 *
 *  `return 0` in a function declared `u32`, `g(1)` where `g` takes an i32, `{ id: 0 }` for a
 *  u32 field, `vec3u(1, 2, 3)`, `min(i, 4)` with `i` an i32 — WGSL's abstract integers do
 *  this, and the EDSL does it through `liftAgainst`. Only a context that states an integer
 *  type changes anything: for every other target the expression is returned untouched, so no
 *  program that compiles today is lowered differently. What the `isIntScalar` guard protects
 *  is the IR SHAPE, which is what `fn()` is the oracle for: without it the fold inside
 *  {@link retargetIntLit} would run against an f32 target and rewrite `1 + 1` into a single
 *  `lit 2` at sites that built a `binop` before. `1 + 1`, not `1. + 1.`: the guard is this
 *  function's first statement, so the float-written form does reach it, but with the guard
 *  deleted it is stopped one line later by {@link isIntegerLiteralTree}, which rejects the `.`,
 *  so that form cannot tell whether the guard is there. The emitted TEXT would not move either way — the
 *  emit-level constant folder collapses both — so only an IR assertion can see the difference,
 *  and `int-lit-context.test.ts` carries one, on `1 + 1`.
 *
 *  Only what is WRITTEN as an integer is retargeted ({@link isIntegerLiteralTree}), and only
 *  when the value fits the target, so `return 2.5 + 0.5` and `return -1` in a `u32` function
 *  keep the diagnostics they always had.
 *
 *  A conditional is retargeted through its arms, so `c ? 1 : 2` in a u32 position is a
 *  `select` of two u32 literals rather than a select of two f32 ones. */
export function retargetIntLitCtx(
  expr: Expr,
  node: ts.Expression,
  target: ShaderType,
  /** Whether the author wrote the position's type. A variable whose type its uses decide
   *  states none (`a = a / 2` over `let a = 1 | 2`), so its `/` stays refused (D-b). */
  declared = true,
): Expr {
  noteDemand(expr, target);
  // An integer position asks an integer of a `/` inside what it reads (`let j: u32 = k / 2`,
  // `h((k % 4) / 2)`): the refusal of that `/` names the integer edit (change 0134).
  if (isIntScalar(target)) noteIntegerContext(node, typeKey(target) === 'u32' ? 'u32' : 'i32');
  // A DECLARED f64 is the one non-integer context that retypes a literal, and for the same
  // reason the integer contexts do: the type is stated, so the written number means a value
  // of it. `const k: f64 = 0.1` lowered `0.1` to an f32 and then reported "cannot let/const k
  // f64 and f32", so the natural spelling of an f64 constant did not compile and the only one
  // that did was the explicit `f64(0.1)` (#151 F64-03). Both carry the whole double —
  // `lowerScalarCast` folds the cast's literal argument at full precision — so this is about
  // the spelling, not the value. Only a literal is retyped; a call says which precision it
  // means and is left alone, as it is beside an f64 operand.
  if (isF64(target)) return retargetF64DeclaredLit(expr, node);
  if (!isIntScalar(target)) return expr;
  const kindless = retypeKindless(expr, target, declared);
  if (kindless !== undefined) return kindless;
  const quotient = integerQuotientAt(expr, target, declared);
  if (quotient !== undefined) return quotient;
  const inner = stripParens(node);
  if (!ts.isConditionalExpression(inner) && !isIntegerLiteralTree(inner)) return expr;
  if (expr.op === 'select' && ts.isConditionalExpression(inner)) {
    const ifTrue = retargetIntLitCtx(expr.ifTrue, inner.whenTrue, target);
    const ifFalse = retargetIntLitCtx(expr.ifFalse, inner.whenFalse, target);
    if (ifTrue === expr.ifTrue && ifFalse === expr.ifFalse) return expr;
    if (typeKey(ifTrue.type) !== typeKey(ifFalse.type)) return expr;
    return { ...expr, type: ifTrue.type, ifTrue, ifFalse };
  }
  return retargetIntLit(expr, node, target);
}

/** The DECLARATION-site retarget: {@link retargetIntLitCtx}, and where that declines, the
 *  acceptance `let`/`const` and the `for` init had before this item existed.
 *
 *  That acceptance was a plain `init.op === 'lit'` retarget to the annotated type, so a literal
 *  WRITTEN as a float but valued as an integer took the declared integer type: `let y: i32 = 0.`
 *  emitted `var y: i32 = 0;`, `let y: u32 = 0.` emitted `0u`, and `let y: i32 = 1e3` emitted
 *  `1000`. {@link retargetIntLitCtx} alone refuses those, because {@link isIntegerLiteralTree}
 *  rejects any text carrying `.` or `e` — which turned three shapes that compiled into TS8003.
 *
 *  So the fallback is exactly the old rule and nothing wider: a single `lit` as lowered, an
 *  integral value, inside the target's range. A non-integral one (`let y: i32 = 1.5`) is left
 *  alone and keeps its mismatch, as it had at emit before, and so is any arithmetic or a
 *  negated float (`2.5 + 0.5`, `-1.`): those lower to a `binop` or a `unop`, which the old
 *  rule never matched either. Only the two DECLARATION sites use this — a
 *  return, an argument and a field never had the acceptance, so there is nothing there to
 *  preserve. */
export function retargetDeclaredIntLit(expr: Expr, node: ts.Expression, target: ShaderType): Expr {
  const byContext = retargetIntLitCtx(expr, node, target);
  // A kindless bitwise expression is a constant computed in the target, which the range check
  // reads (`reportIntLitRange`): it never takes the target through this fallback.
  if (byContext !== expr || !isIntScalar(target) || isKindlessBitwise(expr)) return byContext;
  // The lowered expression itself, NOT a folded one: `-1.` lowers to a `unop` and `2. + 3.` to
  // a `binop`, and neither matched `init.op === 'lit'` before this item, so neither is accepted
  // now. Folding first widened the rule to ten shapes that had always been a mismatch.
  if (expr.op !== 'lit' || typeof expr.value !== 'number') return expr;
  if (!fitsTarget(expr.value, target)) return expr;
  return { op: 'lit', type: target, value: expr.value };
}

/** §13's sentence for an integer literal that does not fit the integer type its position
 *  declares: "The value has to fit." One wording for every declared position, so
 *  `const a: u32 = 4294967296` is not told it mixed a u32 with an f32 when it wrote no f32. */
export function intLiteralRangeMessage(value: number, target: ShaderType): string {
  const k = typeKey(target);
  const range = k === 'u32' ? '0 to 4294967295' : '-2147483648 to 2147483647';
  return `The value has to fit: ${String(value)} is outside ${k}, which holds ${range} (§13).`;
}

/** The literal {@link retargetIntLitCtx} declined for its RANGE alone: written as an integer
 *  ({@link isIntegerLiteralTree}), folded to a whole number, in a position declaring `i32` or
 *  `u32`, and outside that type. A conditional is looked through arm by arm, as the retarget
 *  does. Anything else (a float written as a float, a call, a value that fits) is `undefined`
 *  and keeps whatever diagnostic it had. */
export function outOfRangeIntLit(
  expr: Expr,
  node: ts.Expression,
  target: ShaderType,
): { readonly value: number; readonly node: ts.Expression } | undefined {
  if (!isIntScalar(target)) return undefined;
  const inner = stripParens(node);
  if (expr.op === 'select' && ts.isConditionalExpression(inner)) {
    return (
      outOfRangeIntLit(expr.ifTrue, inner.whenTrue, target) ??
      outOfRangeIntLit(expr.ifFalse, inner.whenFalse, target)
    );
  }
  // A kindless bitwise expression is a constant, computed in `target` (issue 1261).
  if (isKindlessBitwise(expr)) {
    const exact = kindlessIn(expr, target);
    // A value that is no integer is read truncated by a position that states its type (A4).
    const v = exact === undefined ? undefined : Math.trunc(exact);
    if (v === undefined || fitsTarget(v, target)) return undefined;
    // The position says the refusal in its own words, in place of the one the value carried.
    retractKindlessRefusal(expr);
    return { value: v, node: inner };
  }
  if (!isIntegerLiteralTree(inner)) return undefined;
  const folded = foldNumericLit(abstractLiteralOf(expr) ?? expr);
  if (folded.op !== 'lit' || typeof folded.value !== 'number') return undefined;
  if (!Number.isInteger(folded.value) || fitsTarget(folded.value, target)) return undefined;
  return { value: folded.value, node: inner };
}

/** Reports {@link outOfRangeIntLit} with {@link intLiteralRangeMessage} (TS8003, the code the
 *  scalar casts' and the module constants' range checks already use) and returns the
 *  expression retyped to `target`, so the position's own type check does not add the
 *  int/float mismatch the author did not write. `undefined` when there is nothing to report.
 *  Call it right after the retarget, with the same three arguments. */
export function reportIntLitRange(
  expr: Expr,
  node: ts.Expression,
  target: ShaderType,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const bad = outOfRangeIntLit(expr, node, target);
  if (!bad) return undefined;
  diagnostics.push(
    makeDiagnostic(
      sourceFile,
      bad.node,
      intLiteralRangeMessage(bad.value, target) + bitsEdit(expr, bad.value, target),
      TS_CODES.TYPE_MISMATCH,
    ),
  );
  return expr.op === 'select'
    ? { ...expr, type: target }
    : { op: 'lit', type: target, value: bad.value };
}

/** The edit a refused bit operation over written integers names in a `u32` position: its value
 *  is negative, as TypeScript computes it (`~0` is -1), and the `u32` with the same bits is the
 *  number that compiles (`0xffffffff`; the owner's decision of 2026-11-11 on #1272, "거부 유지").
 *  Empty for any other refusal: an arithmetic result (`(1 | 2) - 5`) means its value, not its
 *  bits. */
function bitsEdit(expr: Expr, value: number, target: ShaderType): string {
  const tree = kindlessBitwise.get(expr);
  if (tree === undefined) return '';
  // An `i32` position over a value only a `u32` holds (`(1 << 30) * 2` is 2147483648): the
  // `i32` with the same bits compiles (the owner's decision of 2026-11-11, D-a, "거부").
  if (typeKey(target) === 'i32' && value > 2147483647 && value <= 4294967295) {
    return ` Write the i32 with the same bits, ${String(value | 0)}, or declare a u32.`;
  }
  if (typeKey(target) !== 'u32' || value >= 0 || value < -2147483648) return '';
  const bitwise =
    (tree.op === 'call' && tree.fn === '~') ||
    (tree.op === 'binop' && ['&', '|', '^', '<<', '>>'].includes(tree.bop));
  return bitwise ? ` Write the u32 with the same bits, 0x${(value >>> 0).toString(16)}.` : '';
}

/** The width a shift amount has to fit under, on both targets: WGSL's `i32`/`u32` and GLSL ES
 *  3.00's `int`/`uint` are all 32 bits. */
const SHIFT_BITS = 32;

/** The ONE sentence both shift paths raise for an amount outside `0 .. 31` (#71).
 *
 *  Both had their own wording, which said the same thing in different words and let the two
 *  drift; a rule stated twice is a rule that will be changed once. The binary path lowers
 *  `x << 32` and the compound path `y <<= 32`, and what they refuse is the same number for the
 *  same reason: WGSL makes a constant amount that is not smaller than the bit width a
 *  shader-creation error, and GLSL ES 3.00 leaves the result undefined — so `x << 32` is
 *  `x << 0` on one target and anything at all on the other. A RUNTIME amount is not this: WGSL
 *  masks it to the low five bits, so neither path says anything about one. */
export function shiftAmountMessage(amount: number): string {
  return (
    `A shift amount must be between 0 and ${String(SHIFT_BITS - 1)}, got ${String(amount)}: ` +
    `a ${String(SHIFT_BITS)}-bit integer has no bit to shift into.`
  );
}

/** Whether `amount` is outside the range {@link shiftAmountMessage} describes. */
export function shiftAmountOutOfRange(amount: number): boolean {
  return amount < 0 || amount >= SHIFT_BITS;
}
