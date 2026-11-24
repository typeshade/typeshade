// The check harness's half of `host-compute` (change 0145, host form item 5). The reader does not
// need this file: `host.ts` is the example. Here the entry is called again with `{ constants }`,
// first in a direct call, then in a device plan, and the plan's report is held to what each tier
// does.
import { createDevice, type FuseReport } from 'typeshade/runtime';
import 'typeshade/fuse';
import { scale } from './host-compute.shade.ts';
import type { Outputs } from '../../_compare.js';

type Tier = 'webgpu' | 'webgl2' | 'cpu';

/** Select ordinary constants in a direct call, then a workgroup size in a device plan. */
export async function specialized(n = 259): Promise<{
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

/** Hold the specialization to what `result` read: the same `direct` and `planned` values, and a
 *  report that names `tier` and the selected shape. Throws on a failure. */
export async function check(result: Outputs, tier: Tier): Promise<void> {
  const n = result['ys']?.length;
  if (n === undefined) throw new Error('host-compute: the result has no ys');
  const { direct, values, report } = await specialized(n);
  const same = (a: readonly number[] | undefined, b: ArrayLike<number>): boolean =>
    a !== undefined && a.length === b.length && a.every((x, i) => x === b[i]);
  if (!same(result['direct'], direct)) throw new Error('host-compute: direct differs on a rerun');
  if (!same(result['planned'], values)) throw new Error('host-compute: planned differs on a rerun');
  if (report.tier !== tier) throw new Error(`host-compute: the plan ran on ${report.tier}`);
  const shapes = report.groups.map((g) => [g.calls, g.workgroupShapes]);
  const width = tier === 'webgl2' ? 64 : 32;
  if (tier === 'webgpu' && (report.dispatches !== 1 || report.submissions !== 1))
    throw new Error(
      `host-compute: ${report.dispatches} dispatches, ${report.submissions} submissions`,
    );
  if (tier !== 'cpu' && JSON.stringify(shapes) !== JSON.stringify([[['scale'], [[width, 1, 1]]]]))
    throw new Error(`host-compute: the entry group is ${JSON.stringify(shapes)}`);
}
