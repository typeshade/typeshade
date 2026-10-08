// Math.* 1:1 aliases + expansions + GLSL-style free names.
//
// Implements: Rule 2.2 (docs/language-design.md; traced in reqs/).

import { isKnownIntrinsic } from '../../core/intrinsics.js';
import type { ExpandId } from './math-expand.js';

export const MATH_FN_ALIAS: Readonly<Record<string, string>> = {
  abs: 'abs',
  acos: 'acos',
  acosh: 'acosh',
  asin: 'asin',
  asinh: 'asinh',
  atan: 'atan',
  atanh: 'atanh',
  atan2: 'atan2',
  ceil: 'ceil',
  cos: 'cos',
  cosh: 'cosh',
  exp: 'exp',
  floor: 'floor',
  fround: 'f32',
  log: 'log',
  log2: 'log2',
  max: 'max',
  min: 'min',
  pow: 'pow',
  round: 'round',
  sign: 'sign',
  sin: 'sin',
  sinh: 'sinh',
  sqrt: 'sqrt',
  tan: 'tan',
  tanh: 'tanh',
  trunc: 'trunc',
};

export const MATH_EXPAND_ALIAS: Readonly<Record<string, ExpandId>> = {
  log10: 'log10',
  log1p: 'log1p',
  expm1: 'expm1',
  cbrt: 'cbrt',
  hypot: 'hypot',
};

export const MATH_FN_ARITY: Readonly<Record<string, number>> = {
  abs: 1,
  acos: 1,
  acosh: 1,
  asin: 1,
  asinh: 1,
  atan: 1,
  atanh: 1,
  atan2: 2,
  ceil: 1,
  cos: 1,
  cosh: 1,
  exp: 1,
  floor: 1,
  f32: 1,
  log: 1,
  log2: 1,
  max: 2,
  min: 2,
  pow: 2,
  round: 1,
  sign: 1,
  sin: 1,
  sinh: 1,
  sqrt: 1,
  tan: 1,
  tanh: 1,
  trunc: 1,
  clamp: 3,
  mix: 3,
  smoothstep: 3,
  step: 2,
  length: 1,
  normalize: 1,
  fract: 1,
  degrees: 1,
  radians: 1,
  inverseSqrt: 1,
  distance: 2,
  dot: 2,
  cross: 2,
  mod: 2,
  // Builtins the IR already spells on every target (src/core/intrinsics.ts) that this
  // surface had no name for: exp2 and fwidth are portable, saturate, dpdx, dpdy and fma
  // have a per-target INTRINSICS entry. `select` is NOT here — it is an Expr op, the same
  // node `c ? a : b` lowers to, not a call, and lowerCall handles it on its own.
  exp2: 1,
  saturate: 1,
  fwidth: 1,
  dpdx: 1,
  dpdy: 1,
  fma: 3,
  // Roadmap 0.2 item 8, builtin breadth (§10): geometry, matrices, exponents, bits and the
  // coarse and fine derivatives. `frexp` and `modf` return a struct and follow on their own.
  reflect: 2,
  refract: 3,
  faceForward: 3,
  transpose: 1,
  determinant: 1,
  ldexp: 2,
  countOneBits: 1,
  reverseBits: 1,
  countLeadingZeros: 1,
  countTrailingZeros: 1,
  firstLeadingBit: 1,
  firstTrailingBit: 1,
  extractBits: 3,
  insertBits: 4,
  dpdxCoarse: 1,
  dpdxFine: 1,
  dpdyCoarse: 1,
  dpdyFine: 1,
  fwidthCoarse: 1,
  fwidthFine: 1,
};

/** The builtins roadmap 0.2 item 8 added, as one list for the places that enumerate them. */
export const BREADTH_BUILTINS: readonly string[] = [
  'reflect',
  'refract',
  'faceForward',
  'transpose',
  'determinant',
  'ldexp',
  'countOneBits',
  'reverseBits',
  'countLeadingZeros',
  'countTrailingZeros',
  'firstLeadingBit',
  'firstTrailingBit',
  'extractBits',
  'insertBits',
  'dpdxCoarse',
  'dpdxFine',
  'dpdyCoarse',
  'dpdyFine',
  'fwidthCoarse',
  'fwidthFine',
];

export const MATH_CONST_ALIAS: Readonly<Record<string, number>> = {
  E: Math.E,
  LN10: Math.LN10,
  LN2: Math.LN2,
  LOG10E: Math.LOG10E,
  LOG2E: Math.LOG2E,
  PI: Math.PI,
  SQRT1_2: Math.SQRT1_2,
  SQRT2: Math.SQRT2,
};

/** Every member `Math.` names on this surface: the function aliases, the expansions, the
 *  constants and `random`. What a misspelled `Math.` member is measured against (Rule 12.1). */
export const MATH_MEMBER_NAMES: readonly string[] = [
  ...Object.keys(MATH_FN_ALIAS),
  ...Object.keys(MATH_EXPAND_ALIAS),
  ...Object.keys(MATH_CONST_ALIAS),
  'random',
];

/** The bit-level builtins #150 made authorable: the ten pack/unpack ids the registry could
 *  already spell, plus `quantizeToF16` and `bitcast`. Listed here so a file that declares its
 *  own function under one of these names keeps the call, by the same additivity rule item 8's
 *  builtins follow: before #150 each was an ordinary unknown name. */
export const BIT_BUILTIN_NAMES: readonly string[] = [
  'quantizeToF16',
  'bitcast',
  'pack4x8unorm',
  'pack4x8snorm',
  'unpack4x8unorm',
  'unpack4x8snorm',
  'pack2x16float',
  'pack2x16unorm',
  'pack2x16snorm',
  'unpack2x16float',
  'unpack2x16unorm',
  'unpack2x16snorm',
  // The packed 4x8 integer family (#152), added by the same additivity rule: each was an
  // ordinary unknown name before, so a file declaring its own `pack4xU8` keeps the call.
  'dot4U8Packed',
  'dot4I8Packed',
  'pack4xU8',
  'pack4xI8',
  'pack4xU8Clamp',
  'pack4xI8Clamp',
  'unpack4xU8',
  'unpack4xI8',
];

/** The texture reads this surface spells. Kept as one list so a new texture name joins the set
 *  below by being spelled here: they once joined the surface without joining the set of names a
 *  declaration wins over, and a file declaring its own `textureSample` lost the call to the
 *  builtin (#147, audit DC11 and A4). */
export const TEXTURE_BUILTIN_NAMES: readonly string[] = [
  'textureSample',
  'textureSampleLevel',
  'textureSampleBias',
  'textureSampleGrad',
  'textureSampleCompare',
  'textureSampleCompareLevel',
  'textureLoad',
  'textureStore',
  'textureGather',
  'textureGatherCompare',
  'textureDimensions',
  'textureNumLayers',
  'textureNumSamples',
];

/** The builtin functions a call can name that no table above lists: roadmap 0.2 item 8's breadth
 *  and bit builtins, the texture reads, the atomics and barriers, `arrayLength`,
 *  `workgroupUniformLoad`, `exp2`, `saturate`, `fma`, the derivatives and `select`.
 *
 *  A function the file declares wins over every one of them, as it does over each name the tables
 *  above give (Rule 9.5, change 0029), so the list decides nothing about a call. It is what a reader
 *  that has to know a name is a builtin function, and can read no table for it, asks:
 *  `new-target.ts`, which says a `new` of one is a function called without `new`. */
export const EXTRA_BUILTIN_FUNCTIONS: ReadonlySet<string> = new Set([
  ...BREADTH_BUILTINS,
  ...BIT_BUILTIN_NAMES,
  ...TEXTURE_BUILTIN_NAMES,
  'arrayLength',
  'atomicLoad',
  'atomicStore',
  'atomicAdd',
  'atomicSub',
  'atomicMin',
  'atomicMax',
  'atomicAnd',
  'atomicOr',
  'atomicXor',
  'atomicExchange',
  'workgroupBarrier',
  'storageBarrier',
  'textureBarrier',
  'workgroupUniformLoad',
  'exp2',
  'saturate',
  'fwidth',
  'dpdx',
  'dpdy',
  'fma',
  'select',
]);

/** The value constructors a function the file declares still wins over: the two scalar casts
 *  roadmap 0.2 item 8 added, `bool` and `f64`.
 *
 *  A declared function wins over every builtin function of its name (Rule 9.5, change 0029), and
 *  over no value constructor. As a type name keeps its precedence over an alias (Rule 4.2), a call
 *  of `f32`, `i32`, `u32`, a vector, a matrix or `array` builds the value whatever the file
 *  declares, which `isValueConstructor` (`lower/constructors.ts`) says. `bool` and `f64` are the
 *  two that are not: before item 8 each was an ordinary unknown name, so `function bool(x: f32)`
 *  followed by `bool(x)` called the author's function, and an addition may not change what a
 *  program means. */
export const USER_FIRST_BUILTINS: ReadonlySet<string> = new Set(['bool', 'f64']);

export function resolveMathFn(jsName: string): string | undefined {
  const id = MATH_FN_ALIAS[jsName];
  if (!id) return undefined;
  if (id !== 'f32' && !isKnownIntrinsic(id) && id !== 'atan2' && id !== 'mod') return undefined;
  return id;
}

export function resolveMathExpand(name: string): ExpandId | undefined {
  return MATH_EXPAND_ALIAS[name];
}

export function resolveMathConst(jsName: string): number | undefined {
  return Object.prototype.hasOwnProperty.call(MATH_CONST_ALIAS, jsName)
    ? MATH_CONST_ALIAS[jsName]
    : undefined;
}

export function isCanonicalMathFn(name: string): boolean {
  if (name === 'mod' || MATH_EXPAND_ALIAS[name]) return true;
  if (MATH_FN_ARITY[name] !== undefined && !MATH_FN_ALIAS[name]) return true;
  for (const id of Object.values(MATH_FN_ALIAS)) if (id === name) return true;
  return false;
}

export function expectedArity(intrinsicId: string): number | undefined {
  return MATH_FN_ARITY[intrinsicId];
}

export const LANG_CONST: Readonly<Record<string, number>> = {
  PI: Math.PI,
  TAU: Math.PI * 2,
  E: Math.E,
  LN2: Math.LN2,
  LN10: Math.LN10,
  LOG2E: Math.LOG2E,
  LOG10E: Math.LOG10E,
};

export function resolveLangConst(name: string): number | undefined {
  return Object.prototype.hasOwnProperty.call(LANG_CONST, name) ? LANG_CONST[name] : undefined;
}

/** The intrinsics a module constant may call and a constant expression may fold: the math
 *  builtins, minus the three screen-space derivatives, which have no value outside a
 *  fragment invocation. Both WGSL (`const`) and GLSL ES 3.00 (a constant expression) accept a
 *  builtin call over constant arguments, so a constant that calls one is emitted as the call
 *  and the GPU computes it; the CPU oracle computes the same call through `BUILTINS`. */
export function isConstEvaluableMathFn(name: string): boolean {
  return (name === 'mod' || isCanonicalMathFn(name)) && !DERIVATIVES.has(name);
}

const DERIVATIVES: ReadonlySet<string> = new Set(['fwidth', 'dpdx', 'dpdy']);
