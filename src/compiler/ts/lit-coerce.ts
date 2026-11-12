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
// are integer-written, and `+`, `-`, `*` and `%` over such an expression and written integers,
// have no type of their own: a bitwise operand with no typed peer is an integer of no kind. Each
// is a constant, folded to a literal of the integer type its value fits (the `i32`, else the
// `u32`), and kept with the expression it was folded from. A position that declares an integer
// (`let f: u32 = K | J`, `h(1 | 2)`, `vi + (1 << 2)`) gives it that type, as it gives a written
// integer its type where that type holds its value: its arithmetic is exact and its bit
// operations are TypeScript's, so the value is the one TypeScript computes, whatever the order
// of the operands. A value the type does not hold is refused with the sentence a written number
// gets (`reportIntLitRange`).

/** The literal each such expression was folded to, with the expression it was folded from. */
const kindlessBitwise = new WeakMap<Expr, Expr>();

/** Folds `tree`, a bitwise expression over written integers (see above) built in its own integer
 *  type, to a literal of the integer type its value fits, kept with `tree`. Returns the value it
 *  has in its own type when neither integer type holds it, for the caller's refusal; `undefined`
 *  when a leaf is no constant. */
export function foldKindless(tree: Expr): Expr | { readonly outside: number } | undefined {
  const own = intElemOf(tree.type);
  if (own === undefined) return undefined;
  const v = kindlessValue(tree, own);
  if (v === undefined) return undefined;
  if (fitsTarget(v, tree.type)) return keep({ op: 'lit', type: tree.type, value: v }, tree);
  // A value only the other integer type holds takes that type (`(1 | 0) + 2147483647` is the
  // `u32` 2147483648), as a written operand an `i32` does not hold does (change 0134 item 1).
  const other: ShaderType = { kind: 'scalar', scalar: own === 'i32' ? 'u32' : 'i32' };
  if (fitsTarget(v, other)) return keep({ op: 'lit', type: other, value: v }, tree);
  return { outside: v };
}

function keep(lit: Expr, tree: Expr): Expr {
  kindlessBitwise.set(lit, kindlessBitwise.get(tree) ?? tree);
  return lit;
}

/** Whether `expr` is a bitwise expression over written integers that took an integer of no
 *  kind ({@link foldKindless}). */
export function isKindlessBitwise(expr: Expr): boolean {
  return kindlessBitwise.has(expr);
}

/** The value of the kindless `expr`, computed in the integer type it was built in: the value
 *  TypeScript computes for it, except that an operand only a `u32` holds makes its bit
 *  operations a `u32`'s (change 0134 item 1). A position that declares another type takes this
 *  value where that type holds it; it never reads the bits again in that type, so `~0` is -1 in
 *  a `u32` position too, and refused there as the written `-1` is. */
function kindlessIn(expr: Expr, target: ShaderType): number | undefined {
  const tree = kindlessBitwise.get(expr);
  const own = tree === undefined ? undefined : intElemOf(tree.type);
  if (tree === undefined || own === undefined || !isIntScalar(target)) return undefined;
  return kindlessValue(tree, own);
}

/** `expr` at the integer type `target`, when it is a kindless expression of another integer
 *  type whose value `target` holds; `undefined` otherwise. */
function retypeKindless(expr: Expr, target: ShaderType): Expr | undefined {
  if (!isKindlessBitwise(expr) || !isIntScalar(target) || typeKey(expr.type) === typeKey(target)) {
    return undefined;
  }
  const v = kindlessIn(expr, target);
  return v !== undefined && fitsTarget(v, target)
    ? keep({ op: 'lit', type: target, value: v }, expr)
    : undefined;
}

/** The value of `expr`, a kindless expression or one of its leaves, computed in `int`: `+`, `-`,
 *  `*` and `%` exactly, as TypeScript computes them, and `&`, `|`, `^`, `<<`, `>>` and `~` on the
 *  bits of `int`. `undefined` where a leaf is no constant. */
function kindlessValue(expr: Expr, int: 'i32' | 'u32'): number | undefined {
  const inner = kindlessBitwise.get(expr);
  if (inner !== undefined && inner !== expr) return kindlessValue(inner, int);
  const bits = (v: number): number => (int === 'u32' ? v >>> 0 : v | 0);
  if (expr.op === 'lit') {
    return typeof expr.value === 'number' && Number.isInteger(expr.value) ? expr.value : undefined;
  }
  if (expr.op === 'call' && expr.fn === '~' && expr.args.length === 1) {
    const a = kindlessValue(expr.args[0]!, int);
    return a === undefined ? undefined : bits(~a);
  }
  if (expr.op === 'unop') {
    const a = kindlessValue(expr.a, int);
    return a === undefined ? undefined : -a;
  }
  if (expr.op === 'call' && expr.fn === 'u32' && expr.args.length === 1) {
    // A shift amount the lowering converted to `u32`.
    const a = kindlessValue(expr.args[0]!, 'i32');
    return a === undefined ? undefined : a >>> 0;
  }
  if (expr.op !== 'binop') return undefined;
  const a = kindlessValue(expr.a, int);
  // A shift amount is a `u32` whatever the target is.
  const b = kindlessValue(expr.b, expr.bop === '<<' || expr.bop === '>>' ? 'u32' : int);
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
      return bits(bits(a) & bits(b));
    case '|':
      return bits(bits(a) | bits(b));
    case '^':
      return bits(bits(a) ^ bits(b));
    case '<<':
      return b < 0 || b > 31 ? undefined : bits(bits(a) << b);
    case '>>':
      return b < 0 || b > 31 ? undefined : int === 'u32' ? bits(a) >>> b : bits(a) >> b;
    default:
      return undefined;
  }
}

export function retargetIntLit(expr: Expr, node: ts.Expression, peer: ShaderType): Expr {
  // A value whose type its uses decide takes this peer's type, as a written number does: the
  // use is recorded, and the next pass lowers the value with it (`use-inference.ts`).
  noteDemand(expr, peer);
  const kindless = retypeKindless(expr, peer);
  if (kindless !== undefined) return kindless;
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
    return v === undefined || fitsTarget(v, target) ? undefined : { value: v, node: inner };
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
      intLiteralRangeMessage(bad.value, target),
      TS_CODES.TYPE_MISMATCH,
    ),
  );
  return expr.op === 'select'
    ? { ...expr, type: target }
    : { op: 'lit', type: target, value: bad.value };
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
