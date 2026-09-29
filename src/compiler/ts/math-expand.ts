// Expansions for Math.* names that are not 1:1 WGSL builtins.

import type { Expr } from '../../core/ir/nodes.js';
import type { ShaderType } from '../../core/ir/types.js';
import { f32T, vec2fT, vec3fT } from '../../core/ir/types.js';
import { typeKey } from '../../core/ir/types.js';
import { authorTypeText } from './context.js';

const lit = (value: number): Expr => ({ op: 'lit', type: f32T, value });
const call = (fn: string, type: ShaderType, args: readonly Expr[]): Expr => ({
  op: 'call',
  type,
  fn,
  args,
});
const bin = (bop: '+' | '-' | '*' | '/', a: Expr, b: Expr): Expr => ({
  op: 'binop',
  type: a.type,
  bop,
  a,
  b,
});

export type ExpandId = 'log10' | 'log1p' | 'expm1' | 'cbrt' | 'hypot';

/** How many arguments each expansion takes, as the fewest and the most: what `expandMath` checks
 *  at the call, and what the editor's declaration of the same `Math` member is written from
 *  (`ambient.ts`), so that the two cannot name different counts (Rule 12.7, #186). */
export const EXPAND_ARITY: Readonly<Record<ExpandId, readonly [fewest: number, most: number]>> = {
  log10: [1, 1],
  log1p: [1, 1],
  expm1: [1, 1],
  cbrt: [1, 1],
  hypot: [2, 3],
};

export function expandMath(id: ExpandId, args: readonly Expr[]): Expr | string {
  const [fewest, most] = EXPAND_ARITY[id];
  if (args.length < fewest || args.length > most) {
    return fewest === most
      ? `${id} expects ${fewest} argument${fewest === 1 ? '' : 's'}.`
      : `${id} expects ${fewest} or ${most} arguments.`;
  }
  if (id === 'hypot') {
    for (const a of args) {
      if (typeKey(a.type) !== 'f32')
        return `hypot arguments must be f32, got ${authorTypeText(a.type)}.`;
    }
    const ctorType = args.length === 2 ? vec2fT : vec3fT;
    const vec: Expr = { op: 'construct', type: ctorType, args: [...args] };
    return call('length', f32T, [vec]);
  }
  const x = args[0]!;
  if (typeKey(x.type) !== 'f32') return `${id} expects f32, got ${authorTypeText(x.type)}.`;
  switch (id) {
    case 'log10':
      return bin('*', call('log', f32T, [x]), lit(Math.LOG10E));
    case 'log1p':
      return call('log', f32T, [bin('+', x, lit(1))]);
    case 'expm1':
      return bin('-', call('exp', f32T, [x]), lit(1));
    case 'cbrt':
      return call('pow', f32T, [x, lit(1 / 3)]);
  }
}
