// An installed consumer negotiates instance limits, runs ordinary calls and follows its own fallback policy (0085).
// Verifies: Rule 11.8 (docs/language-design.md; traced in reqs/).
import { createDevice } from 'typeshade/runtime';
import { fuseScale } from './loops.shade.ts';

export async function checkInstanceCapabilities(): Promise<void> {
  const gpu = await createDevice({
    prefer: ['webgpu'],
    limits: { maxStorageBufferBindingSize: 16384 },
    features: [],
  });
  const cpu = await createDevice({ prefer: ['cpu'] });
  const fallback = await createDevice({
    prefer: ['webgpu', 'cpu'],
    features: ['typeshade-deliberately-unavailable-feature'],
  });
  try {
    if (gpu.tier !== 'webgpu' || gpu.limits.maxStorageBufferBindingSize! < 16384)
      throw new Error('The instance did not enable its required WebGPU limit.');
    if (
      fallback.tier !== 'cpu' ||
      !fallback.skipped[0]?.reason.includes('createDevice({ features })')
    )
      throw new Error('The instance did not report and follow its own capability fallback.');
    for (const owner of [gpu, cpu]) {
      const input = owner.array(Float32Array.of(1, -2, 3));
      const output = owner.array(3, 'f32');
      await fuseScale(input, output, 4);
      if (JSON.stringify([...(await output.read())]) !== '[4,-8,12]')
        throw new Error(`Instance capability execution differed on ${owner.tier}.`);
    }
  } finally {
    await gpu.dispose();
    await cpu.dispose();
    await fallback.dispose();
  }
}
