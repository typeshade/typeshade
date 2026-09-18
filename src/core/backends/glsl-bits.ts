// ═══ The bit builtins on GLSL ES 3.00 (roadmap 0.2 item 8, §10) ═══
//
// WGSL has `countOneBits`, `reverseBits`, `countLeadingZeros`, `countTrailingZeros`,
// `firstLeadingBit`, `firstTrailingBit`, `extractBits` and `insertBits`. GLSL ES 3.10 has
// their counterparts (`bitCount`, `findMSB`, `bitfieldExtract` and the rest); GLSL ES 3.00,
// which is what WebGL2 compiles, has none of them: ANGLE refuses every one with "no matching
// overloaded function found". This file writes each as a small GLSL function over the shift,
// mask and comparison operators ES 3.00 does have, one overload per argument type the module
// calls it with, so a call spells the same way whatever the type: `_popcnt(x)` on a `uint`, a
// `uvec3` or an `int`. The helpers are leaves over builtins and each other, emitted ahead of
// the module's own functions in a fixed order that defines each before its first use.
//
// The results are WGSL's, including the cases the spec pins: 32 leading or trailing zeros
// for a zero, all ones (`0xffffffff`, or `-1` on a signed type) for the first bit of a zero,
// the signed `firstLeadingBit` as the highest bit that differs from the sign bit, and the
// offset and count of `extractBits` and `insertBits` clamped to the 32 bits.

import type { ShaderType } from '../ir/types.js'

/** The GLSL helper each WGSL bit builtin calls. */
export const BIT_HELPER_OF: Readonly<Record<string, string>> = {
  countOneBits: '_popcnt',
  reverseBits: '_brev',
  firstLeadingBit: '_msb',
  firstTrailingBit: '_lsb',
  countLeadingZeros: '_clz',
  countTrailingZeros: '_ctz',
  extractBits: '_xbits',
  insertBits: '_ibits',
}

/** Define-before-use order: a signed overload casts to the unsigned one of the same width,
 *  `_lsb` and `_clz` call `_msb`, `_ctz` calls `_popcnt`. */
const HELPER_ORDER = ['_popcnt', '_brev', '_msb', '_lsb', '_clz', '_ctz', '_xbits', '_ibits']
const TYPE_ORDER = ['uint', 'uvec2', 'uvec3', 'uvec4', 'int', 'ivec2', 'ivec3', 'ivec4']

/** The GLSL type of a `u32`/`i32` scalar or vector, or `undefined` for anything else. */
function integerGlslType(t: ShaderType): string | undefined {
  if (t.kind === 'scalar')
    return t.scalar === 'u32' ? 'uint' : t.scalar === 'i32' ? 'int' : undefined
  if (t.kind === 'vec')
    return t.elem === 'u32' ? `uvec${t.n}` : t.elem === 'i32' ? `ivec${t.n}` : undefined
  return undefined
}

const isSigned = (type: string): boolean => type.startsWith('i')
/** `int` to `uint`, `ivec3` to `uvec3`. */
const unsignedOf = (type: string): string => (type === 'int' ? 'uint' : `u${type.slice(1)}`)
const isVector = (type: string): boolean => type.includes('vec')

/** `x >= c` as a `T` of 0s and 1s: GLSL compares vectors through `greaterThanEqual`. */
const ge = (type: string, c: string): string =>
  isVector(type) ? `${type}(greaterThanEqual(x, ${type}(${c})))` : `uint(x >= ${c})`
const eqZero = (type: string): string =>
  isVector(type) ? `${type}(equal(x, ${type}(0u)))` : `uint(x == 0u)`

/** The unsigned body of each helper; a signed overload is written by `signedDef`. */
function unsignedDef(fn: string, T: string): string {
  switch (fn) {
    case '_popcnt':
      return `${T} _popcnt(${T} x) {
  x = x - ((x >> 1u) & ${T}(0x55555555u));
  x = (x & ${T}(0x33333333u)) + ((x >> 2u) & ${T}(0x33333333u));
  x = (x + (x >> 4u)) & ${T}(0x0F0F0F0Fu);
  return (x * ${T}(0x01010101u)) >> 24u;
}`
    case '_brev':
      return `${T} _brev(${T} x) {
  x = ((x >> 1u) & ${T}(0x55555555u)) | ((x & ${T}(0x55555555u)) << 1u);
  x = ((x >> 2u) & ${T}(0x33333333u)) | ((x & ${T}(0x33333333u)) << 2u);
  x = ((x >> 4u) & ${T}(0x0F0F0F0Fu)) | ((x & ${T}(0x0F0F0F0Fu)) << 4u);
  x = ((x >> 8u) & ${T}(0x00FF00FFu)) | ((x & ${T}(0x00FF00FFu)) << 8u);
  return (x >> 16u) | (x << 16u);
}`
    case '_msb':
      // A binary search for the highest set bit, componentwise and without a branch: each
      // step shifts a half away when the value reaches it and records the shift. A zero ends
      // at 0 with x still 0, and the final subtraction wraps it to all ones.
      return `${T} _msb(${T} x) {
  ${T} r = ${T}(0u);
  ${T} s = ${ge(T, '0x10000u')} << 4u;
  x >>= s; r |= s;
  s = ${ge(T, '0x100u')} << 3u;
  x >>= s; r |= s;
  s = ${ge(T, '0x10u')} << 2u;
  x >>= s; r |= s;
  s = ${ge(T, '0x4u')} << 1u;
  x >>= s; r |= s;
  r |= x >> 1u;
  return r - ${eqZero(T)};
}`
    case '_lsb':
      // The lowest set bit isolated, then its position; a zero stays zero and gets all ones.
      return `${T} _lsb(${T} x) {
  return _msb(x & (~x + 1u));
}`
    case '_clz':
      // 31 minus the position; for a zero, 31 minus all ones wraps to the 32 WGSL specifies.
      return `${T} _clz(${T} x) {
  return 31u - _msb(x);
}`
    case '_ctz':
      // The bits below the lowest set one, counted; a zero turns into all 32.
      return `${T} _ctz(${T} x) {
  return _popcnt(~x & (x - 1u));
}`
    default:
      throw new Error(`typeshade: no unsigned GLSL helper ${fn}`)
  }
}

/** A signed overload: the unsigned helper on the bits, cast back. `_msb` first flips a
 *  negative value so the search finds the highest bit that differs from the sign bit. */
function signedDef(fn: string, T: string): string {
  const U = unsignedOf(T)
  const arg = fn === '_msb' ? `${U}(x ^ (x >> 31))` : `${U}(x)`
  return `${T} ${fn}(${T} x) {
  return ${T}(${fn}(${arg}));
}`
}

/** `extractBits` and `insertBits`, one text for both signednesses: a right shift of a
 *  signed `T` is arithmetic in GLSL, which is the sign extension WGSL asks for. The offset
 *  and count clamp as in WGSL, and the shifts stay below 32, which GLSL leaves undefined. */
function bitfieldDef(fn: string, T: string): string {
  if (fn === '_xbits') {
    return `${T} _xbits(${T} e, uint o, uint c) {
  o = min(o, 32u);
  c = min(c, 32u - o);
  if (c == 0u) return ${T}(0);
  return (e << (32u - o - c)) >> (32u - c);
}`
  }
  return `${T} _ibits(${T} e, ${T} n, uint o, uint c) {
  o = min(o, 32u);
  c = min(c, 32u - o);
  if (c == 0u) return e;
  ${T} mask = ${T}((0xffffffffu >> (32u - c)) << o);
  return (e & ~mask) | ((n << o) & mask);
}`
}

function helperDef(fn: string, T: string): string {
  if (fn === '_xbits' || fn === '_ibits') return bitfieldDef(fn, T)
  return isSigned(T) ? signedDef(fn, T) : unsignedDef(fn, T)
}

/** The helpers `fn` on a `T` argument needs defined before it, itself included. */
function closure(fn: string, T: string, out: Set<string>): void {
  const key = `${fn} ${T}`
  if (out.has(key)) return
  if (fn !== '_xbits' && fn !== '_ibits' && isSigned(T)) closure(fn, unsignedOf(T), out)
  if (fn === '_lsb' || fn === '_clz') closure('_msb', T, out)
  if (fn === '_ctz') closure('_popcnt', T, out)
  out.add(key)
}

/** The GLSL definitions a module calling the given bit builtins needs, in an order that
 *  defines each before its first use, and the same order whatever order the calls came in.
 *
 *  @param calls Every `call` of a builtin in {@link BIT_HELPER_OF}, with the type of its first
 *  argument. A call on a type that is not a `u32`/`i32` scalar or vector is skipped: the
 *  front end never lowers one, and the GPU's own error is clearer than a helper that cannot
 *  be written.
 *  @returns The definitions, one string each; empty when the module calls none. */
export function bitHelperDefs(
  calls: Iterable<{ readonly fn: string; readonly argType: ShaderType }>,
): string[] {
  const needed = new Set<string>()
  for (const c of calls) {
    const helper = BIT_HELPER_OF[c.fn]
    const T = integerGlslType(c.argType)
    if (helper === undefined || T === undefined) continue
    closure(helper, T, needed)
  }
  const defs: string[] = []
  for (const fn of HELPER_ORDER) {
    for (const T of TYPE_ORDER) {
      if (needed.has(`${fn} ${T}`)) defs.push(helperDef(fn, T))
    }
  }
  return defs
}
