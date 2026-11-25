import { expect, it, vi } from 'vitest';
import { createDevice } from '../runtime/device.js';
import { callKernel, type KernelFace } from './host-kernel.js';
import type { GeneratedCpu } from './host-entry.js';

const failure = vi.hoisted(() => ({ error: new Error('local executor chunk missing') }));
vi.mock('./fuse-plan.js', () => {
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

it('leaves the host free to read what a plan that failed to load would have written', async () => {
  const owner = await createDevice({ prefer: ['cpu'] });
  try {
    const out = owner.array(Float32Array.of(7, 8));
    const input = owner.array(Float32Array.of(1, 2));
    const cpu: GeneratedCpu = { F: { copy: () => 0 }, $: { bindings: {}, vars: {} } };
    const plan = owner.fuse(() => {
      void callKernel(cpu, copy, 2, [out, input]);
    });
    expect(() => out.at(0).get()).toThrow('a call wrote this Buffer');
    await plan.catch(() => undefined);
    expect(out.at(0).get()).toBe(7);
    await expect(out.read()).rejects.toHaveProperty('cause', failure.error);
  } finally {
    await owner.dispose();
  }
});
