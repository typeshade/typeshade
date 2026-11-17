import type { BinOp, ShaderType } from '../../../ir/index.js';

export function intElemOf(t: ShaderType): 'i32' | 'u32' | undefined {
  if (t.kind === 'scalar') return t.scalar === 'i32' || t.scalar === 'u32' ? t.scalar : undefined;
  if (t.kind === 'vec') return t.elem === 'i32' || t.elem === 'u32' ? t.elem : undefined;
  return undefined;
}

export const wrapInt = (v: number, elem: 'i32' | 'u32'): number =>
  elem === 'u32' ? v >>> 0 : v | 0;

const isShiftCountEveryTargetAgreesOn = (n: number): boolean => n >= 0 && n <= 31;

export function foldIntLit(
  bop: BinOp,
  a: number,
  b: number,
  elem: 'i32' | 'u32',
): number | undefined {
  const ua = elem === 'u32' ? a >>> 0 : a | 0;
  const ub = elem === 'u32' ? b >>> 0 : b | 0;
  switch (bop) {
    case '+':
      return wrapInt(ua + ub, elem);
    case '-':
      return wrapInt(ua - ub, elem);
    case '*':
      return wrapInt(Math.imul(ua, ub), elem);
    case '/':
      return ub === 0 ? undefined : wrapInt(Math.trunc(ua / ub), elem);
    case '%':
      return ub === 0 ? undefined : wrapInt(ua % ub, elem);
    case '&':
      return wrapInt(ua & ub, elem);
    case '|':
      return wrapInt(ua | ub, elem);
    case '^':
      return wrapInt(ua ^ ub, elem);
    case '<<':
      return isShiftCountEveryTargetAgreesOn(ub) ? wrapInt(ua << ub, elem) : undefined;
    case '>>':
      return isShiftCountEveryTargetAgreesOn(ub)
        ? wrapInt(elem === 'u32' ? ua >>> ub : ua >> ub, elem)
        : undefined;
    default:
      return undefined;
  }
}
