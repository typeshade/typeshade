import type { CpuValue } from '../../cpu-runtime.js';
import { compileModule } from '../../oracle.js';
import { copy } from '../kernel-plan.js';
import type { ChainCorpus } from '../random-ir.js';
import { callArgs, type Inputs } from './inputs.js';

export interface Outcome {
  readonly arrays: Readonly<Record<string, CpuValue>>;
  readonly results: Readonly<Record<string, CpuValue>>;
}

export function outcomeOf(
  c: ChainCorpus,
  store: ReadonlyMap<string, CpuValue>,
  results: Map<string, CpuValue>,
): Outcome {
  return {
    arrays: Object.fromEntries(
      c.arrays.filter((a) => a.written && !a.scratch).map((a) => [a.id, store.get(a.id)!]),
    ),
    results: Object.fromEntries(results),
  };
}

export function runApart(c: ChainCorpus, inputs: Inputs, precision: 'f32' | 'f64'): Outcome {
  const cpu = compileModule(c.module, { precision });
  const store = new Map<string, CpuValue>(
    [...inputs.arrays].map(([id, v]) => [id, copy(v as unknown as CpuValue)]),
  );
  const results = new Map<string, CpuValue>();
  c.calls.forEach((call, j) => {
    const r = cpu.fns[call.fn]!(...callArgs(c, j, inputs, store));
    if (r !== undefined) results.set(call.fn, r);
  });
  return outcomeOf(c, store, results);
}
