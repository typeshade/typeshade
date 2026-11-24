// The check harness's half of `host-compute` (change 0145, host form item 5). The reader does not
// need this file: `host.ts` is the example. Here the extra `runSpecialized` runs again, and the
// plan's report is held to what each tier does.
import { runSpecialized } from './host.js';
import type { Outputs } from '../../_compare.js';

type Tier = 'webgpu' | 'webgl2' | 'cpu';

/** Hold the specialization to what `result` read: the same `direct` and `planned` values, and a
 *  report that names `tier` and the selected shape. Throws on a failure. */
export async function check(result: Outputs, tier: Tier): Promise<void> {
  const n = result['ys']?.length;
  if (n === undefined) throw new Error('host-compute: the result has no ys');
  const { direct, values, report } = await runSpecialized(n);
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
