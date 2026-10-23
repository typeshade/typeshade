// Verifies: Rule 11.13 (docs/language-design.md; traced in reqs/).
// A failed local executor load must settle the whole reserved plan and its written residents.
import { expect, it, vi } from 'vitest';
import { createDevice } from '../runtime/device.js';
import { callKernel, type KernelFace } from './host-kernel.js';
import type { GeneratedCpu } from './host-entry.js';
import { kernelQueue, residentState, type Resident } from './resident.js';

const failure = vi.hoisted(() => ({ error: new Error('local executor chunk missing'), loads: 0 }));
vi.mock('./fuse-plan.js', () => {
  failure.loads++;
  throw failure.error;
});

const copy: KernelFace = {
  name: 'copy',
  fn: 'copy',
  result: { k: 'void', s: 'void' },
  params: ['out', 'input'].map((name) => ({
    name,
    k: 'array',
    writes: name === 'out',
    s: 'array<f32>',
    layout: { k: 'a', n: null, st: 4, e: { k: 's', t: 'f32' } },
  })),
};

it('propagates a cached load failure after synchronous recording, releases scratch and leaves the queue usable', async () => {
  const owner = await createDevice({ prefer: ['cpu'] });
  const input = owner.array(Float32Array.of(1, 2));
  const out = owner.array(2, 'f32');
  const execute = vi.fn(() => 0);
  const cpu: GeneratedCpu = { F: { copy: execute }, $: { bindings: {}, vars: {} } };
  let scratch!: Resident<Float32Array>;
  const recorded: Promise<unknown>[] = [];
  let bodies = 0;
  try {
    const plan = owner.fuse((scope) => {
      bodies++;
      scratch = scope.scratch(2);
      recorded.push(callKernel(cpu, copy, 2, [scratch, input]));
      recorded.push(callKernel(cpu, copy, 2, [out, scratch]));
    });
    expect(bodies).toBe(1);
    expect(failure.loads).toBe(0);
    const read = out.read();
    const after = kernelQueue.run(async () => 'after the failed plan');
    const errors = await Promise.all(
      [plan, ...recorded, read].map((p) =>
        p.then(
          () => undefined,
          (error: unknown) => error,
        ),
      ),
    );
    const error = errors[0];
    // Vitest wraps an import factory's error. Every consumer must receive that same rejection.
    expect(error).toHaveProperty('cause', failure.error);
    expect(errors.every((value) => value === error)).toBe(true);
    expect(await after).toBe('after the failed plan');
    expect([...(await input.read())]).toEqual([1, 2]);
    expect(residentState(scratch)).toMatchObject({
      phase: 'done',
      gpu: undefined,
      host: undefined,
    });
    expect(execute).not.toHaveBeenCalled();
    expect(bodies).toBe(1);
    await expect(owner.fuse(() => undefined)).rejects.toBe(error);
    expect(failure.loads).toBe(1);
  } finally {
    await owner.dispose();
  }
});
