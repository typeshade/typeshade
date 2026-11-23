// Why: `u32()` and `i32()` of an `f32` that the compiler chose (nothing decides the type of the
// `let`, change 0134 Amendment A9, issue 1353) read the value as TypeScript's ToUint32 and
// ToInt32 do, so they wrap where WGSL's float conversion saturates.
import type { Expr } from '../../../core/ir/nodes.js';
import { boolT, f32T, i32T, u32T } from '../../../core/ir/types.js';
import { optionalHelper } from '../optional/helpers.js';
import { readsUndecided } from '../use-inference.js';

const TWO_POW_31 = 2147483648;
const TWO_POW_32 = 4294967296;

const lit = (value: number): Expr => ({ op: 'lit', type: f32T, value });
const call = (fn: string, type: Expr['type'], ...args: Expr[]): Expr => ({
  op: 'call',
  type,
  fn,
  args,
});

export function wrapChosenF32(name: 'i32' | 'u32', arg: Expr): Expr | undefined {
  const chosen = arg.type.kind === 'scalar' && arg.type.scalar === 'f32' && readsUndecided(arg);
  if (!chosen) return undefined;
  const target = name === 'u32' ? u32T : i32T;
  const other = name === 'u32' ? i32T : u32T;
  return optionalHelper(`wrap_${name}`, [arg], ([v]) => {
    const truncated = call('trunc', f32T, v!);
    const scaled = call('floor', f32T, {
      op: 'binop',
      type: f32T,
      bop: '/',
      a: truncated,
      b: lit(TWO_POW_32),
    });
    const remainder: Expr = {
      op: 'binop',
      type: f32T,
      bop: '-',
      a: truncated,
      b: { op: 'binop', type: f32T, bop: '*', a: scaled, b: lit(TWO_POW_32) },
    };
    const inI32: Expr = {
      op: 'logical',
      type: boolT,
      lop: '&&',
      a: { op: 'compare', type: boolT, cop: '>=', a: v!, b: lit(-TWO_POW_31) },
      b: { op: 'compare', type: boolT, cop: '<', a: v!, b: lit(TWO_POW_31) },
    };
    const inRange = call('i32', i32T, v!);
    const direct = name === 'u32' ? call('u32', u32T, inRange) : inRange;
    const viaBits =
      name === 'u32'
        ? call('u32', u32T, remainder)
        : call('i32', i32T, call('u32', other, remainder));
    return { op: 'select', type: target, cond: inI32, ifTrue: direct, ifFalse: viaBits };
  });
}
