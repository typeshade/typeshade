// === Phase 7 Math.* alias → TypeShade intrinsic / f32 const ===

import { isKnownIntrinsic } from '../../core/intrinsics.js'

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
}

export const MATH_FN_ARITY: Readonly<Record<string, number>> = {
  abs: 1, acos: 1, acosh: 1, asin: 1, asinh: 1, atan: 1, atanh: 1,
  atan2: 2, ceil: 1, cos: 1, cosh: 1, exp: 1, floor: 1, f32: 1,
  log: 1, log2: 1, max: 2, min: 2, pow: 2, round: 1, sign: 1,
  sin: 1, sinh: 1, sqrt: 1, tan: 1, tanh: 1, trunc: 1,
}

export const MATH_CONST_ALIAS: Readonly<Record<string, number>> = {
  E: Math.E,
  LN10: Math.LN10,
  LN2: Math.LN2,
  LOG10E: Math.LOG10E,
  LOG2E: Math.LOG2E,
  PI: Math.PI,
  SQRT1_2: Math.SQRT1_2,
  SQRT2: Math.SQRT2,
}

export function resolveMathFn(jsName: string): string | undefined {
  const id = MATH_FN_ALIAS[jsName]
  if (!id) return undefined
  if (id !== 'f32' && !isKnownIntrinsic(id) && id !== 'atan2' && id !== 'mod') {
    return undefined
  }
  return id
}

export function resolveMathConst(jsName: string): number | undefined {
  return Object.prototype.hasOwnProperty.call(MATH_CONST_ALIAS, jsName)
    ? MATH_CONST_ALIAS[jsName]
    : undefined
}

export function isCanonicalMathFn(name: string): boolean {
  if (name === 'mod') return true
  for (const id of Object.values(MATH_FN_ALIAS)) {
    if (id === name) return true
  }
  return false
}

export function expectedArity(intrinsicId: string): number | undefined {
  return MATH_FN_ARITY[intrinsicId]
}

export const LANG_CONST: Readonly<Record<string, number>> = {
  PI: Math.PI,
  TAU: Math.PI * 2,
  E: Math.E,
}

export function resolveLangConst(name: string): number | undefined {
  return Object.prototype.hasOwnProperty.call(LANG_CONST, name) ? LANG_CONST[name] : undefined
}
