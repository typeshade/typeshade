// The check harness's half of `loop-fuse` (change 0145, host form item 5). The reader does not
// need this file. It holds the fuse report of each scope to what each tier does: on WebGPU the
// groups and the dispatch counts, on the CPU tier no dispatch and no fused group.
import { run } from './host.js';
import { KERNEL_TREE } from '../../../src/core/kernel-tree.js';
import type { Outputs } from '../../_compare.js';

type Tier = 'webgpu' | 'webgl2' | 'cpu';

/** The `FuseReport` fields this check reads. */
interface Report {
  tier: string;
  dispatches: number;
  submissions: number;
  groups: { calls: string[]; fused: boolean; tier: string; why?: string }[];
}

const calls = (r: Report): string => JSON.stringify(r.groups.map((g) => g.calls));

/** The dispatches that fold the partial sums of `total`, one for each level. */
const foldLevels = (count: number): number =>
  count <= 1 ? 0 : 1 + foldLevels(Math.ceil(count / KERNEL_TREE));

/** Run `loop-fuse` and hold each scope's report to `tier`. Throws on a failure. */
export async function check(result: Outputs, tier: Tier): Promise<void> {
  const n = result['chain']?.length;
  if (n === undefined) throw new Error('loop-fuse: the result has no chain');
  const { chain, split, reduce } = await run();
  const a = chain.report as unknown as Report;
  const b = split.report as unknown as Report;
  const c = reduce.report as unknown as Report;
  const scopes: [string, Report][] = [
    ['chain', a],
    ['split', b],
    ['reduce', c],
  ];
  for (const [name, r] of scopes)
    if (r.tier !== tier) throw new Error(`loop-fuse ${name}: ran on ${r.tier}, not ${tier}`);
  if (tier === 'cpu') {
    for (const [name, r] of scopes) {
      if (r.dispatches !== 0) throw new Error(`loop-fuse ${name}: ${r.dispatches} dispatches`);
      if (r.groups.length === 0 || r.groups.some((g) => g.fused))
        throw new Error(`loop-fuse ${name}: a call did not run apart on the CPU tier`);
    }
    return;
  }
  if (tier !== 'webgpu') return;
  const want = (name: string, ok: boolean, r: Report): void => {
    if (!ok) throw new Error(`loop-fuse ${name}: ${JSON.stringify(r)}`);
  };
  want(
    'chain',
    a.dispatches === 1 &&
      calls(a) === JSON.stringify([['add', 'mul', 'relu']]) &&
      a.groups[0].fused,
    a,
  );
  want(
    'split',
    b.dispatches === 2 &&
      calls(b) ===
        JSON.stringify([
          ['add', 'mul'],
          ['pairsum', 'relu'],
        ]) &&
      /^mul and pairsum run as two dispatches because pairsum reads `t\[i \^ 1\]` \(line \d+\)$/.test(
        b.groups[1]?.why ?? '',
      ),
    b,
  );
  want(
    'reduce',
    c.dispatches === 1 + foldLevels(Math.ceil(n / KERNEL_TREE)) &&
      c.submissions === 1 &&
      calls(c) === JSON.stringify([['add', 'mul', 'total']]) &&
      c.groups[0].fused,
    c,
  );
}
