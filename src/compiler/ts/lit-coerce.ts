// Implements: Rule 5.1 (docs/language-design.md; traced in reqs/).

import { logicalTypeKey as typeKey } from './optional.js';
import ts from 'typescript';
import type { Expr } from '../../core/ir/nodes.js';
import type { ShaderType } from '../../core/ir/types.js';
import { f64T, isF64 } from '../../core/ir/types.js';
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

// ─── Bitwise expressions over written integers (Rule 5.1, change 0134 item 1; issue 1261) ───
//
// `&`, `|`, `^`, `<<`, `>>` and `~` over written integers and constants of no fixed type that
// are integer-written, and `+`, `-`, `*`, `%` and a unary minus over such an expression and
// written integers, have no type of their own: a bitwise operand with no typed peer is an
// integer of no kind. Each is a constant. Its value is the one TypeScript computes for the whole
// expression (`kindlessValue`): `+`, `-`, `*` and `%` exactly, and `&`, `|`, `^`, `~`, `<<` and
// `>>` on ToInt32 of their operands, as ECMAScript does. One exception, change 0134 item 1: where
// the OUTERMOST operator is a bit operator and one of its own operands is a written number only
// a `u32` holds (`3000000000 | 1`, `0x80000000 >> 4`), it works on `u32` bits, its operands
// ToUint32 and `>>` a logical shift, and the value is that `u32` (TypeScript's
// `(3000000000 | 1) >>> 0`). Inside a larger expression the same operator computes as TypeScript
// does, so `(0x80000000 | 1) - 0x80000000` is -4294967295. Such an operator beside a negative
// written number (`3000000000 | -1`) is refused where it is lowered (the owner's decision of
// 2026-11-11, "거부 유지"). The type is chosen once, from the value: the `i32` where it holds it,
// else the `u32`; a value neither holds is refused (Rule 5.4). The expression is folded to a
// literal of that type and kept with the expression. A position that declares an integer type
// (`let f: u32 = K | J`, `h(1 | 2)`, `vi + (1 << 2)`) takes the same value where that type holds
// it, and refuses it with the sentence a written number gets where it does not
// (`reportIntLitRange`).

/** The literal each such expression was folded to, with the expression it was folded from. */
const kindlessBitwise = new WeakMap<Expr, Expr>();

/** Folds `tree`, a bitwise expression over written integers (see above), to a literal of the
 *  integer type its value fits, kept with `tree`. Returns the value when neither integer type
 *  holds it, for the caller's refusal; `undefined` when a leaf is no constant. */
export function foldKindless(
  tree: Expr,
):
  | Expr
  | { readonly outside: number; readonly lit: Expr }
  | { readonly readings: { readonly u32: number; readonly ts: number } }
  | undefined {
  // A `>>` over a written number only a `u32` holds shifts its `u32` bits logically, and
  // TypeScript shifts the ToInt32 of it arithmetically: where the two give other bits
  // (`0xF0000000 >> 28` is 15 and -1), the program does not say which it means (the owner's
  // decision of 2026-11-11, "거부"). `&`, `|`, `^`, `~` and `<<` give the same bits either way.
  if (tree.op === 'binop' && tree.bop === '>>' && writtenU32(tree.a)) {
    const u = kindlessRoot(tree);
    const t = kindlessValue(tree);
    if (u !== undefined && t !== undefined && u >>> 0 !== t >>> 0) {
      return { readings: { u32: u, ts: t } };
    }
  }
  const v = kindlessRoot(tree);
  if (v === undefined) return undefined;
  for (const type of [i32Scalar, u32Scalar]) {
    if (fitsTarget(v, type)) return keep({ op: 'lit', type, value: v }, tree);
  }
  // A value no integer type holds is refused only where it stands as a whole: a larger
  // expression folds it again, through ToInt32 at a bit operator (`((1 << 30) * 4) | 0` is 0).
  return { outside: v, lit: keep({ op: 'lit', type: i32Scalar, value: v }, tree) };
}

/** The refusal each kindless literal of a value no integer type holds carries until a larger
 *  kindless expression folds it ({@link retractKindlessRefusal}) or a position refuses it in its
 *  own words. */
const pendingRefusals = new WeakMap<
  Expr,
  { readonly diagnostic: TsCompilerDiagnostic; readonly into: TsCompilerDiagnostic[] }
>();

/** Records that `lit` stands refused by `diagnostic`, pushed into `into`. */
export function noteKindlessRefusal(
  lit: Expr,
  diagnostic: TsCompilerDiagnostic,
  into: TsCompilerDiagnostic[],
): void {
  into.push(diagnostic);
  pendingRefusals.set(lit, { diagnostic, into });
}

/** Withdraws the refusal of `expr`, when it is a kindless literal that carries one: a larger
 *  expression folds it, or a position says it in its own words. Returns whether it did. */
export function retractKindlessRefusal(expr: Expr): boolean {
  const pending = pendingRefusals.get(expr);
  if (pending === undefined) return false;
  pendingRefusals.delete(expr);
  const i = pending.into.indexOf(pending.diagnostic);
  if (i >= 0) pending.into.splice(i, 1);
  return true;
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

function keep(lit: Expr, tree: Expr): Expr {
  kindlessBitwise.set(lit, kindlessBitwise.get(tree) ?? tree);
  return lit;
}

/** Whether `expr` is a bitwise expression over written integers that took an integer of no
 *  kind ({@link foldKindless}). */
export function isKindlessBitwise(expr: Expr): boolean {
  return kindlessBitwise.has(expr);
}

/** The value of the kindless `expr` ({@link kindlessRoot}), for a position of the integer type
 *  `target`, which takes it where it holds it: `~0` is -1 in a `u32` position too, and refused
 *  there as the written `-1` is. */
function kindlessIn(expr: Expr, target: ShaderType): number | undefined {
  const tree = kindlessBitwise.get(expr);
  return tree === undefined || !isIntScalar(target) ? undefined : kindlessRoot(tree);
}

/** `expr` at the integer type `target`, when it is a kindless expression of another integer
 *  type whose value `target` holds; `undefined` otherwise. */
function retypeKindless(expr: Expr, target: ShaderType): Expr | undefined {
  if (!isKindlessBitwise(expr) || !isIntScalar(target) || typeKey(expr.type) === typeKey(target)) {
    return undefined;
  }
  const v = kindlessIn(expr, target);
  if (v !== undefined && pendingRefusals.has(expr)) {
    // Refused already for its value: the position takes it with no second mistake to say.
    const lit = keep({ op: 'lit', type: target, value: v }, expr);
    pendingRefusals.set(lit, pendingRefusals.get(expr)!);
    pendingRefusals.delete(expr);
    return lit;
  }
  return v !== undefined && fitsTarget(v, target)
    ? keep({ op: 'lit', type: target, value: v }, expr)
    : undefined;
}

const BIT_OPS: ReadonlySet<string> = new Set(['&', '|', '^', '<<', '>>']);

/** Whether `e` is a written number only a `u32` holds: a literal that is no folded expression. */
function writtenU32(e: Expr): boolean {
  return (
    e.op === 'lit' && typeof e.value === 'number' && e.value > 2147483647 && !kindlessBitwise.has(e)
  );
}

/** The value of the kindless expression `tree` as a whole (see above): TypeScript's, with the
 *  `u32` exception for its outermost bit operator. */
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

/** The value TypeScript computes for `expr`, a kindless expression or one of its leaves: `+`,
 *  `-`, `*` and `%` exactly, and `&`, `|`, `^`, `~`, `<<` and `>>` on ToInt32 of their operands.
 *  `undefined` where a leaf is no constant. */
function kindlessValue(expr: Expr): number | undefined {
  const inner = kindlessBitwise.get(expr);
  if (inner !== undefined && inner !== expr) return kindlessValue(inner);
  if (expr.op === 'lit') {
    return typeof expr.value === 'number' && Number.isInteger(expr.value) ? expr.value : undefined;
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
    case '%':
      return b === 0 ? undefined : a % b;
    case '&':
      return a & b;
    case '|':
      return a | b;
    case '^':
      return a ^ b;
    case '<<':
      return b < 0 || b > 31 ? undefined : a << b;
    case '>>':
      return b < 0 || b > 31 ? undefined : a >> b;
    default:
      return undefined;
  }
}

/** The module constants of each file whose initializer is a bitwise expression over written
 *  integers (`const K = 1 << 4`), by IR name: a `/` over a read of one is refused as a `/` over
 *  the expression is (D-b of #1272, issue 1261). */
const kindlessModuleConsts = new WeakMap<ts.SourceFile, Set<string>>();

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

/** The declaration with its type written of a binding {@link markKindlessBinding} marked. */
export function kindlessDeclaration(binding: object | undefined): string | undefined {
  return binding === undefined ? undefined : kindlessBindings.get(binding);
}

/** Where `expr` comes from, for a `/` over it (Amendment A2 of change 0134, the owner's decision
 *  of 2026-11-11, D-b): `'kindless'` when it is a bitwise expression over written integers, a
 *  binding that holds one, or `+ - * % & | ^ << >>`, a minus or a `~` over those and written
 *  integers; `'written'` for a written integer alone; `'typed'` for anything with a type of its
 *  own. `resolve` finds the binding of a name. */
export function kindlessOrigin(
  expr: Expr,
  resolve: (name: string) => object | undefined,
  sourceFile?: ts.SourceFile,
): 'kindless' | 'written' | 'typed' {
  if (kindlessBitwise.has(expr)) return 'kindless';
  if (expr.op === 'lit') return typeof expr.value === 'number' ? 'written' : 'typed';
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
  const parts: Expr[] =
    expr.op === 'unop'
      ? [expr.a]
      : expr.op === 'call' && expr.fn === '~' && expr.declRef === undefined
        ? [...expr.args]
        : expr.op === 'binop' && ['+', '-', '*', '%', '&', '|', '^', '<<', '>>'].includes(expr.bop)
          ? [expr.a, expr.b]
          : [];
  if (parts.length === 0) return 'typed';
  const each = parts.map((e) => kindlessOrigin(e, resolve, sourceFile));
  if (each.includes('typed')) return 'typed';
  return each.includes('kindless') ? 'kindless' : 'written';
}

/** The `/` over a bitwise expression of written integers that is refused where no integer
 *  position reads it (D-b), lowered as the float division its edit names, each with its integer
 *  division at an integer type: an integer position takes that (Amendment A4). */
const integerQuotients = new WeakMap<Expr, (target: ShaderType) => Expr | undefined>();

/** Records `float` as such a quotient, with its integer division `at` a type. Returns `float`. */
export function markIntegerQuotient(
  float: Expr,
  at: (target: ShaderType) => Expr | undefined,
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
export function markQuotientRead(read: Expr, binding: object): Expr {
  if (quotientBindings.has(binding)) {
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
export function integerQuotientAt(expr: Expr, target: ShaderType): Expr | undefined {
  const at = integerQuotients.get(expr);
  return at === undefined || !isIntScalar(target) ? undefined : at(target);
}

export function retargetIntLit(expr: Expr, node: ts.Expression, peer: ShaderType): Expr {
  // A value whose type its uses decide takes this peer's type, as a written number does: the
  // use is recorded, and the next pass lowers the value with it (`use-inference.ts`).
  noteDemand(expr, peer);
  const kindless = retypeKindless(expr, peer);
  if (kindless !== undefined) return kindless;
  // An integer position reads a quotient refused elsewhere: the integer division (A4).
  if (isIntScalar(peer) && integerQuotients.has(expr)) {
    noteIntegerContext(node, typeKey(peer) === 'u32' ? 'u32' : 'i32');
    const q = integerQuotientAt(expr, peer);
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
export function retargetIntLitCtx(expr: Expr, node: ts.Expression, target: ShaderType): Expr {
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
  const kindless = retypeKindless(expr, target);
  if (kindless !== undefined) return kindless;
  const quotient = integerQuotientAt(expr, target);
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
    const v = kindlessIn(expr, target);
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
