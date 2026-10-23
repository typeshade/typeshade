// Dispatch a `@compute` entry and read what it wrote (surface §67, Rule 8.24).
//
// The import is the shader module itself: the Vite plugin turns `scale` into a function that
// takes the entry's bindings by name, as plain values, and the number of workgroups.
import { createDevice, type FuseReport } from 'typeshade/runtime';
import 'typeshade/fuse';
import { scale } from './host-compute.shade.ts';

/** Scale `n` numbers by 2.5 on the GPU, and return them. */
export async function run(n = 259): Promise<Float32Array> {
  const xs = Float32Array.from({ length: n }, (_, i) => i);
  const ys = new Float32Array(n);
  // WIDTH defaults to 64, GAIN to 1. When the promise resolves, `ys` holds
  // what the entry wrote.
  await scale({ k: 2.5, xs, ys }, Math.ceil(n / 64));
  return ys;
}

/** Select ordinary constants in a direct call, then a workgroup size in a device plan. */
export async function runSpecialized(n = 259): Promise<{
  direct: Float32Array;
  values: Float32Array;
  report: FuseReport;
}> {
  const xs = Float32Array.from({ length: n }, (_, i) => i);
  const direct = new Float32Array(n);
  // Omitted WIDTH keeps 64. Ordinary constants work on WebGL2 too.
  await scale({ k: 2.5, xs, ys: direct }, Math.ceil(n / 64), {
    constants: { GAIN: 0.5 },
  });

  const device = await createDevice();
  try {
    // WebGL2 supports the authored workgroup shape. The other tiers can select 32 here.
    const width = device.tier === 'webgl2' ? 64 : 32;
    const input = device.array(direct);
    const output = device.array(n, 'f32');
    const report = await device.fuse(() => {
      // The group count is the caller's: selecting WIDTH does not recalculate it.
      scale({ k: 2, xs: input, ys: output }, Math.ceil(n / width), {
        constants: { WIDTH: width },
      });
    });
    // On WebGPU: one entry group, one dispatch, one submission, shape [32, 1, 1].
    // Repeating the same constants on this owner reuses its pipeline.
    return { direct, values: await output.read(), report };
  } finally {
    await device.dispose();
  }
}
