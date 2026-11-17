import { type UniformityViolation } from '../../../core/passes/uniformity.js';
import { type DerivativeRewriteReason } from '../../../core/passes/derivative-rewrite.js';

const UNIFORMITY_SITES: Readonly<
  Record<UniformityViolation['via'], { reached: string; move: string; on: string }>
> = {
  branch: {
    reached: 'under',
    move: 'Move it out of the branch',
    on: 'branch on',
  },
  'short-circuit': {
    reached: 'on the right of an && or || whose left side reads',
    move: 'Call it before the && or ||',
    on: 'make the left side',
  },
  conditional: {
    reached: 'in an arm of a ?: whose condition reads',
    move: 'Call it before the ?:',
    on: 'make the condition',
  },
  loop: {
    reached: 'in a loop whose condition reads',
    move: 'Move it out of the loop',
    on: 'bound the loop by',
  },
  return: {
    reached: 'after a return taken under',
    move: 'Move it above the return',
    on: 'return on',
  },
  'loop-return': {
    reached: 'after a return taken inside a loop under',
    move: 'Move it above the loop',
    on: 'return on',
  },
  'bound-return': {
    reached: 'after a return inside a loop whose condition reads',
    move: 'Move it above the loop',
    on: 'bound the loop by',
  },
  break: {
    reached: 'in a loop some invocations leave by a break taken under',
    move: 'Move it out of the loop',
    on: 'break on',
  },
  continue: {
    reached: 'in a loop where some invocations skip ahead by a continue taken under',
    move: 'Move it out of the loop',
    on: 'continue on',
  },
  'switch-break': {
    reached: 'after a break out of the switch taken under',
    move: 'Move it above the break',
    on: 'break on',
  },
};

export function uniformityMessage(v: UniformityViolation): string {
  const site = UNIFORMITY_SITES[v.via];
  const reached = `${site.reached} ${v.cause}`;
  if (v.kind === 'subgroup') {
    return (
      `${v.callee}() is reached ${reached}, and every invocation of the subgroup has to reach ` +
      `it together: WGSL's subgroup_uniformity rule refuses the call where one may not. ` +
      `${site.move}, or ${site.on} a value the whole workgroup shares (a uniform, a module ` +
      `const, builtin<"workgroup_id">).`
    );
  }
  return (
    `${v.callee}() is reached ${reached}, and every invocation of the workgroup has ` +
    `to reach it: one that does not is a workgroup that waits forever. ${site.move}, or ` +
    `${site.on} a value the whole workgroup shares (a uniform, a module const, ` +
    `builtin<"workgroup_id">).`
  );
}

const HOIST_PAST: Readonly<Record<UniformityViolation['via'], string>> = {
  branch: 'the branch',
  'short-circuit': 'the && or ||',
  conditional: 'the ?:',
  loop: 'the loop',
  return: 'the return',
  'loop-return': 'the loop',
  'bound-return': 'the loop',
  break: 'the loop',
  continue: 'the loop',
  'switch-break': 'the break',
};

function unreachedReason(r: DerivativeRewriteReason): string {
  switch (r.kind) {
    case 'memory':
      return `its operand reads "${r.name}", which the branch writes`;
    case 'atomic':
      return 'its operand depends on an atomic operation';
    case 'loop-trips':
      return 'its operand is computed in a loop whose trip count is not a constant';
    case 'no-gradient':
      return r.what === 'depth'
        ? `"${r.texture}" is a depth texture, which has no gradient form, and its arguments are computed in the branch`
        : `"${r.texture}" is a texture_1d, which has no gradient form, and its arguments are computed in the branch`;
    case 'loop-variant':
      return 'its operand changes on each iteration of a loop that not every invocation runs';
    case 'other':
      return 'its operand depends on a value the compiler cannot recompute there';
  }
}

export function unreachedMessage(v: UniformityViolation, reason: DerivativeRewriteReason): string {
  const site = UNIFORMITY_SITES[v.via];
  const past = HOIST_PAST[v.via];
  const reached = `${v.callee}() is reached ${site.reached} ${v.cause}, which WGSL's derivative_uniformity rule refuses: `;
  return v.isDerivativeBuiltin
    ? `${reached}it differences neighbouring invocations, and one that did not run has no value ` +
        `to difference against. The compiler could not compute it before ${past}: ` +
        `${unreachedReason(reason)}. Compute the value it differences before ${past}, call ` +
        `${v.callee}() there, and use the result inside.`
    : `${reached}the implicit level of detail is a difference between neighbouring invocations, ` +
        `and one that did not run has no value to difference against. The compiler could not ` +
        `compute the gradients before ${past}: ${unreachedReason(reason)}. Move the call above ` +
        `${past} and select from its result, or call textureSampleLevel or textureSampleGrad ` +
        `with the level or the gradients you want.`;
}
