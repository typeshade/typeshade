// Math.* 1:1 aliases + expansions + GLSL-style free names.

import { isKnownIntrinsic } from '../../core/intrinsics.js'
import type { ExpandId } from './math-expand.js'

export const MATH_FN_ALIAS: Readonly<Record<string, string>> = {
  abs: 'abs', acos: 'acos', acosh: 'acosh', asin: 'asin', asinh: 'asinh',
  atan: 'atan', atanh: 'atanh', atan2: 'atan2', ceil: 'ceil', cos: 'cos',
  cosh: 'cosh', exp: 'exp', floor: 'floor', fround: 'f32', log: 'log',
  log2: 'log2', max: 'max', min: 'min', pow: 'pow', round: 'round',
  sign: 'sign', sin: 'sin', sinh: 'sinh', sqrt: 'sqrt', tan: 'tan',
  tanh: 'tanh', trunc: 'trunc',
}

export const MATH_EXPAND_ALIAS: Readonly<Record<string, ExpandId>> = {
  log10: 'log10',
  log1p: 'log1p',
  expm1: 'expm1',
  cbrt: 'cbrt',
  hypot: 'hypot',
}

export const MATH_FN_ARITY: Readonly<Record<string, number>> = {
  abs: 1, acos: 1, acosh: 1, asin: 1, asinh: 1, atan: 1, atanh: 1,
  atan2: 2, ceil: 1, cos: 1, cosh: 1, exp: 1, floor: 1, f32: 1,
  log: 1, log2: 1, max: 2, min: 2, pow: 2, round: 1, sign: 1,
  sin: 1, sinh: 1, sqrt: 1, tan: 1, tanh: 1, trunc: 1,
  clamp: 3, mix: 3, smoothstep: 3, step: 2, length: 1, normalize: 1,
  fract: 1, degrees: 1, radians: 1, inverseSqrt: 1, distance: 2,
  dot: 2, cross: 2, mod: 2,
}

export const MATH_CONST_ALIAS: Readonly<Record<string, number>> = {
  E: Math.E, LN10: Math.LN10, LN2: Math.LN2, LOG10E: Math.LOG10E,
  LOG2E: Math.LOG2E, PI: Math.PI, SQRT1_2: Math.SQRT1_2, SQRT2: Math.SQRT2,
}

export function resolveMathFn(jsName: string): string | undefined {
  const id = MATH_FN_ALIAS[jsName]
  if (!id) return undefined
  if (id !== 'f32' && !isKnownIntrinsic(id) && id !== 'atan2' && id !== 'mod') return undefined
  return id
}

export function resolveMathExpand(name: string): ExpandId | undefined {
  return MATH_EXPAND_ALIAS[name]
}

export function resolveMathConst(jsName: string): number | undefined {
  return Object.prototype.hasOwnProperty.call(MATH_CONST_ALIAS, jsName)
    ? MATH_CONST_ALIAS[jsName]
    : undefined
}

export function isCanonicalMathFn(name: string): boolean {
  if (name === 'mod' || MATH_EXPAND_ALIAS[name]) return true
  if (MATH_FN_ARITY[name] !== undefined && !MATH_FN_ALIAS[name]) return true
  for (const id of Object.values(MATH_FN_ALIAS)) if (id === name) return true
  return false
}

export function expectedArity(intrinsicId: string): number | undefined {
  return MATH_FN_ARITY[intrinsicId]
}

export const LANG_CONST: Readonly<Record<string, number>> = {
  PI: Math.PI,
  TAU: Math.PI * 2,
  E: Math.E,
  LN2: Math.LN2,
  LN10: Math.LN10,
  LOG2E: Math.LOG2E,
  LOG10E: Math.LOG10E,
}

export function resolveLangConst(name: string): number | undefined {
  return Object.prototype.hasOwnProperty.call(LANG_CONST, name) ? LANG_CONST[name] : undefined
}
