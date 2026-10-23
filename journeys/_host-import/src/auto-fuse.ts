// A fresh browser or worker imports this module without the legacy registration subpath (0085).
import { createDevice } from 'typeshade/runtime';
import { fuseMark, fuseScale } from './loops.shade.ts';

export async function run(tier: 'webgpu' | 'cpu' = 'webgpu') {
  const owner = await createDevice({ prefer: [tier] });
  try {
    const input = owner.array(Float32Array.of(1, -2, 3));
    const out = owner.array(3, 'f32');
    const after = owner.array(3, 'f32');
    let bodies = 0;
    const started = performance.now();
    const plan = owner.fuse((scope) => {
      bodies++;
      const scratch = scope.scratch(3);
      fuseScale(input, scratch, 2);
      void owner.fuse(() => {
        bodies++;
        fuseMark(scratch, out);
      });
    });
    const synchronous = bodies === 2;
    // Neither the plan nor its lazy load is awaited before this ordinary call and read.
    fuseScale(out, after, 3);
    const values = [...(await after.read())];
    const report = await plan;
    return {
      values,
      firstUseMs: performance.now() - started,
      synchronous,
      bodies,
      tier: report.tier,
      dispatches: report.dispatches,
      fused: report.groups[0]?.fused === true,
    };
  } finally {
    await owner.dispose();
  }
}
