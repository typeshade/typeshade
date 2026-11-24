// The check harness's half of `host-compute` (change 0145, host form item 5). The reader does not
// need this file: `host.ts` is the example. Here the result of the extra `runSpecialized`, which
// the driver ran, is held to `run`'s values, and the plan's report to what each tier does.
import type { runSpecialized } from './host.js';
import type { Outputs } from '../../_compare.js';

type Tier = 'webgpu' | 'webgl2' | 'cpu';

/** Hold the extra `runSpecialized` to what `result` read: the same `direct` and `planned` values,
 *  and a report that names `tier` and the selected shape. Throws on a failure. */
export async function check(
  result: Outputs,
  tier: Tier,
  extras: Readonly<Record<string, unknown>>,
): Promise<void> {
  const ran = extras['runSpecialized'] as Awaited<ReturnType<typeof runSpecialized>> | undefined;
  if (ran === undefined) throw new Error('host-compute: the driver gave no runSpecialized result');
  const { direct, values, report } = ran;
  const same = (a: readonly number[] | undefined, b: ArrayLike<number>): boolean =>
    a !== undefined && a.length === b.length && a.every((x, i) => x === b[i]);
  if (!same(result['direct'], direct))
    throw new Error('host-compute: direct differs from the extra');
  if (!same(result['planned'], values))
    throw new Error('host-compute: planned differs from the extra');
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
