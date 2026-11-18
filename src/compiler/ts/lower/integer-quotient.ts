// Why: TypeScript's ToInt32 and ToUint32 read the ±Infinity or NaN of a division by zero as 0,
// and WGSL's integer `x / 0` is `x` (issue 1320, Amendment A4 of change 0134). A call of the
// helper evaluates each operand once, in order, where a select's arms would be sequenced lazily.
import type { Expr } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { boolT, i32T, u32T } from '../../../core/ir/types.js';
import { logicalTypeKey as typeKey, optionalHelper } from '../optional.js';
import {
  fitsTarget,
  integerQuotientAt,
  isIntegerQuotient,
  isKindlessBitwise,
  retypeKindlessDeclared,
} from '../lit-coerce.js';

function guardZero(div: Expr & { op: 'binop' }): Expr {
  if (div.b.op === 'lit') return div;
  return optionalHelper('div0', [div.a, div.b], ([a, b]) => ({
    op: 'select',
    type: div.type,
    cond: {
      op: 'compare',
      type: boolT,
      cop: '==',
      a: b!,
      b: { op: 'lit', type: b!.type, value: 0 },
    },
    ifTrue: { op: 'lit', type: div.type, value: 0 },
    ifFalse: { ...div, a: a!, b: b! },
  }));
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
