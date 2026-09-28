// ═══ WGSL's integer answers on GLSL ES 3.00 (Rule 11.12, change 0027) ═══
//
// GLSL ES 3.00 gives some inputs of an integer `/`, `%` and shift, and of a float's conversion to
// an integer, no result, and WGSL settles every one of them:
//   - a zero divisor (§5.9 of the GLSL spec): WGSL's `x / 0` is `x`, and `x % 0` is 0;
//   - the least `int` over -1, which GLSL lets be the least or the greatest (§4.1.3): WGSL gives
//     the least, and 0 for the remainder;
//   - a `%` with a negative operand (§5.9): WGSL truncates, `-7 % 3` is -1;
//   - a shift amount of 32 or more (§5.9): WGSL takes it modulo 32;
//   - a float the integer cannot hold, or a negative float to `uint` (§5.4.1): WGSL saturates,
//     and NaN is 0.
// The CPU oracle computes WGSL's answers (Rule 11.5), and a WebGL2 driver computes others:
// measured on ANGLE over SwiftShader, `7 / 0` is -7, `-7 % 3` is 2 and `int(3e9)` is the least
// `int` (#382). So the GLSL writer spells each of these through a helper that settles those
// inputs, and keeps the bare operator only where the operands cannot reach one:
//   - an unsigned `/` or `%` by a literal that is not zero;
//   - a signed `/` by a literal that is neither 0 nor -1;
//   - a shift by a literal, which Rule 7.4 and `settleConstExprs` keep below 32.
// A signed `%` always takes its helper, since its dividend may be negative.
//
// Each helper is written once per type the module uses, a vector overload component by
// component through the scalar one, ahead of the module's own functions.

import type { BinOp, Expr } from '../ir/nodes.js';
import type { ShaderType } from '../ir/types.js';

/** The integer element of a `u32`/`i32` scalar or vector, else `undefined`. */
function intElemOf(t: ShaderType): 'i32' | 'u32' | undefined {
  if (t.kind === 'scalar') return t.scalar === 'i32' || t.scalar === 'u32' ? t.scalar : undefined;
  if (t.kind === 'vec') return t.elem === 'i32' || t.elem === 'u32' ? t.elem : undefined;
  return undefined;
}

const isF32 = (t: ShaderType): boolean =>
  (t.kind === 'scalar' && t.scalar === 'f32') || (t.kind === 'vec' && t.elem === 'f32');

/** The GLSL spelling of an `i32`/`u32`/`f32` scalar or vector. */
function glslTypeOf(t: ShaderType): string {
  const elem = t.kind === 'scalar' ? t.scalar : t.kind === 'vec' ? t.elem : undefined;
  const n = t.kind === 'vec' ? t.n : 1;
  const [scalar, prefix] =
    elem === 'i32' ? ['int', 'i'] : elem === 'u32' ? ['uint', 'u'] : ['float', ''];
  return n === 1 ? scalar : `${prefix}vec${String(n)}`;
}

/** Every component of `e` when it is a literal, a negated literal, or a vector built of them. */
function literalComponents(e: Expr): readonly number[] | undefined {
  if (e.op === 'lit') return typeof e.value === 'number' ? [e.value] : undefined;
  if (e.op === 'unop' && e.a.op === 'lit' && typeof e.a.value === 'number') return [-e.a.value];
  if (e.op === 'construct' && e.type.kind === 'vec') {
    const parts = e.args.map(literalComponents);
    if (parts.some((p) => p === undefined)) return undefined;
    const flat = parts.flatMap((p) => p!);
    return flat.length === 1 ? new Array<number>(e.type.n).fill(flat[0]!) : flat;
  }
  return undefined;
}

/** The helper an integer `/` or `%` of type `t` by `b` needs, or `undefined` where the bare
 *  operator already gives WGSL's answer on every input it can take. */
export function intDivHelper(bop: BinOp, b: Expr, t: ShaderType): string | undefined {
  if (bop !== '/' && bop !== '%') return undefined;
  const elem = intElemOf(t);
  if (elem === undefined) return undefined;
  const divisor = literalComponents(b);
  if (elem === 'u32') {
    if (divisor?.every((v) => v !== 0) === true) return undefined;
    return bop === '/' ? '_udiv' : '_urem';
  }
  if (bop === '/' && divisor?.every((v) => v !== 0 && v !== -1) === true) return undefined;
  return bop === '/' ? '_idiv' : '_irem';
}

/** Whether a shift by `b` needs its amount masked: every amount but a literal one, which the
 *  front end and `settleConstExprs` keep below 32. */
export function shiftNeedsMask(bop: BinOp, b: Expr): boolean {
  return (bop === '<<' || bop === '>>') && literalComponents(b) === undefined;
}

/** The GLSL for an integer `/`, `%` or shift of type `t` with WGSL's answer, over the operand
 *  texts `a` and `b`, each already a primary; `undefined` keeps the bare operator. */
export function glslIntBinop(
  bop: BinOp,
  bExpr: Expr,
  a: string,
  b: string,
  t: ShaderType,
): string | undefined {
  const helper = intDivHelper(bop, bExpr, t);
  if (helper !== undefined) return `${helper}(${a}, ${b})`;
  if (intElemOf(t) !== undefined && shiftNeedsMask(bop, bExpr)) return `(${a} ${bop} (${b} & 31u))`;
  return undefined;
}

/** The helper a conversion of `from` to the integer type `to` needs: `_f2i` or `_f2u` for a
 *  float source, which WGSL saturates, and `undefined` for an integer one, which both targets
 *  reinterpret. */
export function floatToIntHelper(to: ShaderType, from: ShaderType): string | undefined {
  const elem = intElemOf(to);
  if (elem === undefined || !isF32(from)) return undefined;
  // A conversion keeps the shape: a scalar of a scalar, a vector of a vector of its size.
  const n = (t: ShaderType): number => (t.kind === 'vec' ? t.n : 1);
  if (n(to) !== n(from)) return undefined;
  return elem === 'i32' ? '_f2i' : '_f2u';
}

/** Where a helper is called: its name and the GLSL type of what it returns. */
export interface IntHelperUse {
  readonly helper: string;
  readonly type: ShaderType;
}

/** The uses of the helpers in an expression tree, and in a compound assignment's operator. */
export function intHelperUses(e: Expr, out: IntHelperUse[]): void {
  if (e.op === 'binop') {
    const helper = intDivHelper(e.bop, e.b, e.type);
    if (helper !== undefined) out.push({ helper, type: e.type });
  } else if (e.op === 'call' && (e.fn === 'i32' || e.fn === 'u32') && e.args.length === 1) {
    const helper = floatToIntHelper(e.type, e.args[0]!.type);
    if (helper !== undefined) out.push({ helper, type: e.type });
  } else if (e.op === 'construct' && e.args.length === 1) {
    const helper = floatToIntHelper(e.type, e.args[0]!.type);
    if (helper !== undefined && e.type.kind === 'vec') out.push({ helper, type: e.type });
  }
}

const HELPER_ORDER = ['_idiv', '_irem', '_udiv', '_urem', '_f2i', '_f2u'];
const TYPE_ORDER = ['int', 'ivec2', 'ivec3', 'ivec4', 'uint', 'uvec2', 'uvec3', 'uvec4'];
/** The least `int`, spelled from its bits: `-2147483648` is the negation of a literal that has
 *  no `int`. */
const INT_MIN = 'int(0x80000000u)';

/** One helper's scalar definition, over `int`/`uint` operands or a `float` source. */
function scalarDef(helper: string): string {
  switch (helper) {
    case '_idiv':
      return `int _idiv(int a, int b) {
  return (b == 0 || (a == ${INT_MIN} && b == -1)) ? a : a / b;
}`;
    case '_irem':
      return `int _irem(int a, int b) {
  return (b == 0 || (a == ${INT_MIN} && b == -1)) ? 0 : a - (a / b) * b;
}`;
    case '_udiv':
      return `uint _udiv(uint a, uint b) {
  return b == 0u ? a : a / b;
}`;
    case '_urem':
      return `uint _urem(uint a, uint b) {
  return b == 0u ? 0u : a % b;
}`;
    case '_f2i':
      return `int _f2i(float x) {
  return int(mix(clamp(x, -2147483648.0, 2147483520.0), 0.0, isnan(x)));
}`;
    default:
      return `uint _f2u(float x) {
  return uint(mix(clamp(x, 0.0, 4294967040.0), 0.0, isnan(x)));
}`;
  }
}

/** One helper's vector overload of the GLSL type `T`, through the scalar one. */
function vectorDef(helper: string, T: string): string {
  const n = Number(T.slice(-1));
  const lanes = ['x', 'y', 'z', 'w'].slice(0, n);
  if (helper === '_f2i' || helper === '_f2u') {
    const src = `vec${String(n)}`;
    return `${T} ${helper}(${src} x) {
  return ${T}(${lanes.map((c) => `${helper}(x.${c})`).join(', ')});
}`;
  }
  return `${T} ${helper}(${T} a, ${T} b) {
  return ${T}(${lanes.map((c) => `${helper}(a.${c}, b.${c})`).join(', ')});
}`;
}

/** The GLSL definitions the given uses need, each scalar one ahead of the vectors that call it,
 *  in the same order whatever order the uses came in. */
export function intHelperDefs(uses: Iterable<IntHelperUse>): string[] {
  const needed = new Set<string>();
  for (const u of uses) {
    const T = glslTypeOf(u.type);
    needed.add(`${u.helper} ${T}`);
    if (T.includes('vec')) needed.add(`${u.helper} ${T.startsWith('u') ? 'uint' : 'int'}`);
  }
  const defs: string[] = [];
  for (const helper of HELPER_ORDER)
    for (const T of TYPE_ORDER)
      if (needed.has(`${helper} ${T}`))
        defs.push(T.includes('vec') ? vectorDef(helper, T) : scalarDef(helper));
  return defs;
}
