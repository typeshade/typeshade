import { groupCalls, type Group, type GroupCall } from '../../fuse-group.js';
import { scheduleKernelPlan } from '../kernel-plan.js';
import type { ChainCorpus } from '../random-ir.js';
import { callArgs, type Inputs } from './inputs.js';
import type { Lowered } from './types.js';

export function groupCallsOf(
  c: ChainCorpus,
  lows: readonly Lowered[],
  inputs: Inputs,
): GroupCall[] {
  const byId = new Map(c.arrays.map((a) => [a.id, a]));
  return c.calls.map((call, j) => {
    const low = lows[j]!;
    const first = scheduleKernelPlan(low.m, call.fn, low.plan, callArgs(c, j, inputs)).steps[0];
    return {
      k: low.face,
      arrays: call.args.map((a) => ('array' in a ? byId.get(a.array) : undefined)),
      range:
        first === undefined
          ? { start: 0, n: 0 }
          : { start: first.args['_start'] as number, n: first.args['_n'] as number },
      tier: 'webgpu',
    };
  });
}

export function planChain(c: ChainCorpus, calls: readonly GroupCall[], limit: number): Group[] {
  return groupCalls(calls, limit, new Set(c.arrays.filter((a) => a.scratch)));
}
