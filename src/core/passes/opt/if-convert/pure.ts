import type { Expr, ShaderType } from '../../../ir/index.js';
import { eachExpr } from '../../../ir/visit.js';
import { PORTABLE_INTRINSICS } from '../../../intrinsics.js';
import { armCost, COSTLY_ARM } from '../../select-composite.js';

const MAX_NODES = 16;

const NOT_FOR_SELECT: ReadonlySet<string> = new Set(['fwidth', 'transpose', 'determinant']);

const PURE_CALLS: ReadonlySet<string> = new Set([
  ...[...PORTABLE_INTRINSICS].filter((id) => !NOT_FOR_SELECT.has(id)),
  'f32',
  'i32',
  'u32',
  'select',
  'atan2',
  'round',
  'saturate',
  'mod',
  'inverseSqrt',
  'fma',
  'faceForward',
  'ldexp',
]);

export const isSelectable = (t: ShaderType): boolean => t.kind === 'scalar' || t.kind === 'vec';

const isIntegral = (t: ShaderType): boolean =>
  (t.kind === 'scalar' && (t.scalar === 'i32' || t.scalar === 'u32')) ||
  (t.kind === 'vec' && (t.elem === 'i32' || t.elem === 'u32'));

const isSafeDivisor = (e: Expr): boolean =>
  e.op === 'lit' && typeof e.value === 'number' && e.value !== 0 && e.value !== -1;

function nodeIsPure(e: Expr): boolean {
  switch (e.op) {
    case 'lit':
    case 'constref':
    case 'overrideref':
    case 'param':
    case 'varref':
    case 'unop':
    case 'compare':
    case 'logical':
    case 'construct':
    case 'member':
    case 'select':
      return true;
    case 'binop':
      return !((e.bop === '/' || e.bop === '%') && isIntegral(e.type) && !isSafeDivisor(e.b));
    case 'call':
      return e.declRef === undefined && PURE_CALLS.has(e.fn);
    case 'externref':
    case 'index':
    case 'matchExpr':
      return false;
  }
}

export function isCheapAndPure(e: Expr): boolean {
  let ok = true;
  let nodes = 0;
  eachExpr(e, (x) => {
    nodes++;
    if (!nodeIsPure(x)) ok = false;
  });
  return ok && nodes <= MAX_NODES && armCost(e, new Set()) < COSTLY_ARM;
}
