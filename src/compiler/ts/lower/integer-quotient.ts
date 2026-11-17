// Why: TypeScript's ToInt32 and ToUint32 read the ±Infinity or NaN of a division by zero as 0,
// and WGSL's integer `x / 0` is `x` (issue 1320, Amendment A4 of change 0134).
import type { Expr } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { boolT, i32T, u32T } from '../../../core/ir/types.js';
import { isKnownIntrinsic } from '../../../core/intrinsics.js';
import { EFFECTFUL_INTRINSICS } from '../../../core/passes/effects.js';
import { logicalTypeKey as typeKey } from '../optional.js';
import {
  fitsTarget,
  integerQuotientAt,
  isIntegerQuotient,
  isKindlessBitwise,
  retypeKindlessDeclared,
} from '../lit-coerce.js';

function readsAgain(e: Expr): boolean {
  switch (e.op) {
    case 'lit':
    case 'varref':
    case 'param':
    case 'constref':
    case 'overrideref':
      return true;
    case 'member':
      return readsAgain(e.base);
    case 'index':
      return readsAgain(e.base) && readsAgain(e.idx);
    case 'unop':
      return readsAgain(e.a);
    case 'binop':
    case 'compare':
    case 'logical':
      return readsAgain(e.a) && readsAgain(e.b);
    case 'select':
      return readsAgain(e.cond) && readsAgain(e.ifTrue) && readsAgain(e.ifFalse);
    case 'construct':
      return e.args.every(readsAgain);
    case 'call':
      return (
        e.declRef === undefined &&
        (['i32', 'u32', 'f32'].includes(e.fn) ||
          (isKnownIntrinsic(e.fn) && !EFFECTFUL_INTRINSICS.has(e.fn))) &&
        e.args.every(readsAgain)
      );
    default:
      return false;
  }
}

function guardZero(div: Expr & { op: 'binop' }): Expr {
  if (div.b.op === 'lit' || !readsAgain(div.b)) return div;
  return {
    op: 'select',
    type: div.type,
    cond: {
      op: 'compare',
      type: boolT,
      cop: '==',
      a: div.b,
      b: { op: 'lit', type: div.b.type, value: 0 },
    },
    ifTrue: { op: 'lit', type: div.type, value: 0 },
    ifFalse: div,
  };
}

export function integerQuotientIn(
  at: (t: ShaderType) => readonly [Expr, Expr],
  target: ShaderType,
  declared: boolean,
): Expr | undefined {
  const [a, b] = at(target);
  if (typeKey(a.type) !== typeKey(target) || typeKey(b.type) !== typeKey(target)) return undefined;
  const div = { op: 'binop', type: target, bop: '/', a, b } as const;
  return declared ? guardZero(div) : div;
}

export function integerConversionArg(arg: Expr, target: ShaderType): Expr {
  if (isIntegerQuotient(arg)) {
    const own = integerQuotientAt(arg, target, true);
    if (own !== undefined) return own;
    return integerQuotientAt(arg, typeKey(target) === 'u32' ? i32T : u32T, true) ?? arg;
  }
  if (!isKindlessBitwise(arg) || arg.op !== 'lit' || typeof arg.value !== 'number') return arg;
  if (Number.isInteger(arg.value)) return arg;
  const truncated = Math.trunc(arg.value);
  return retypeKindlessDeclared(arg, fitsTarget(truncated, i32T) ? i32T : u32T) ?? arg;
}
