// `mergeReports` (change 0071, Amendment 2): the report of several plans as one, as a plan of
// several groups reports its own. The type and the function come from `typeshade/runtime` and
// the root, so a host that ships the runtime alone holds and sums reports without the planner.
// Each group names the tier it ran on (change 0118), and a merged report keeps it.
//
// Verifies: Rule 11.13 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { mergeReports, type FuseReport } from '../runtime.js';
import * as root from '../index.js';
import * as fuse from '../fuse.js';

const cpu: FuseReport = { tier: 'cpu', dispatches: 0, submissions: 0, groups: [] };

// Old literals remain valid. A present member is complete and readonly on every public face.
const scratchTypeChecks = (report: FuseReport): void => {
  const legacy: root.FuseReport = cpu;
  const same: fuse.FuseReport = legacy;
  const unknown: number | undefined = report.webgpuScratch?.allocatedBytes;
  // @ts-expect-error a present member requires all four counters
  const partial: FuseReport = { ...cpu, webgpuScratch: { allocations: 0 } };
  // @ts-expect-error a metric cannot be written through the public report type
  if (report.webgpuScratch !== undefined) report.webgpuScratch.allocations = 1;
  // @ts-expect-error the member itself is readonly
  report.webgpuScratch = undefined;
  void [same, unknown, partial];
};
void scratchTypeChecks;
const gl: FuseReport = {
  tier: 'webgl2',
  dispatches: 2,
  submissions: 0,
  groups: [
    { calls: ['add'], fused: false, tier: 'webgl2', dispatches: 1 },
    { calls: ['mul'], fused: false, tier: 'webgl2', dispatches: 1, why: 'webgl2' },
  ],
};
const gpu: FuseReport = {
  tier: 'webgpu',
  dispatches: 3,
  submissions: 1,
  groups: [
    {
      calls: ['add', 'mul', 'relu'],
      fused: true,
      tier: 'webgpu',
      dispatches: 1,
      workgroupShapes: [[64, 1, 1]],
      gpuTime: 1200,
    },
    {
      calls: ['total'],
      fused: false,
      tier: 'webgpu',
      dispatches: 2,
      why: 'total reduces',
      workgroupShapes: [[256, 1, 1]],
    },
  ],
};
/** A plan on WebGL2 whose reduction ran on the CPU tier, which has no WebGL2 program (change
 *  0118): the group names its tier and says why it ran on a later tier than its plan's. */
const glWithCpu: FuseReport = {
  tier: 'webgl2',
  dispatches: 1,
  submissions: 0,
  groups: [
    { calls: ['gain'], fused: false, tier: 'webgl2', dispatches: 1 },
    {
      calls: ['peak'],
      fused: false,
      tier: 'cpu',
      dispatches: 0,
      why: 'peak runs on the CPU, it runs on the CPU, loop 1 reduces, which WebGL2 has no workgroup memory for',
    },
  ],
};

describe('mergeReports (change 0071, Amendment 2)', () => {
  it('sums the dispatches and the submissions and keeps the groups in the order given', () => {
    const merged = mergeReports([gpu, cpu, gl]);
    expect(merged.dispatches).toBe(5);
    expect(merged.submissions).toBe(1);
    expect(merged.groups.map((g) => g.dispatches)).toEqual([1, 2, 1, 1]);
    expect(merged.groups.reduce((n, g) => n + g.dispatches, 0)).toBe(merged.dispatches);
    expect(merged.groups.map((g) => g.calls)).toEqual([
      ['add', 'mul', 'relu'],
      ['total'],
      ['add'],
      ['mul'],
    ]);
    // Each group is the one its report held: the shapes, the time and the reason travel with it.
    expect(merged.groups[0]).toBe(gpu.groups[0]);
    expect(merged.groups[3]?.why).toBe('webgl2');
  });

  it('reports the tier the most capable report ran on, WebGPU before WebGL2 before the CPU', () => {
    expect(mergeReports([cpu, gl]).tier).toBe('webgl2');
    expect(mergeReports([gl, cpu, gpu]).tier).toBe('webgpu');
    expect(mergeReports([cpu, cpu]).tier).toBe('cpu');
  });

  it('keeps the tier each group ran on and its reason, and the best tier of the reports (change 0118)', () => {
    const merged = mergeReports([cpu, glWithCpu, gpu]);
    // Each group is the one its report held, with the tier it ran on: a merged report joins no
    // group to another and asks no planner about them.
    expect(merged.groups.map((g) => g.tier)).toEqual(['webgl2', 'cpu', 'webgpu', 'webgpu']);
    expect(merged.groups.map((g) => g.dispatches)).toEqual([1, 0, 1, 2]);
    expect(merged.groups.reduce((n, g) => n + g.dispatches, 0)).toBe(merged.dispatches);
    expect(merged.groups[1]).toBe(glWithCpu.groups[1]);
    expect(merged.groups[1]?.why).toBe(glWithCpu.groups[1]?.why);
    // The merged tier stays the best tier of the reports, and so the best tier of the groups.
    expect(merged.tier).toBe('webgpu');
    expect(mergeReports([glWithCpu, cpu]).tier).toBe('webgl2');
    // The type of a group names its tier: a host reads it with no cast.
    const tier: 'webgpu' | 'webgl2' | 'cpu' = merged.groups[0]!.tier;
    expect(tier).toBe('webgl2');
  });

  it('is the report of a plan that did nothing for no report, and the report itself for one', () => {
    expect(mergeReports([])).toEqual({
      tier: 'cpu',
      dispatches: 0,
      submissions: 0,
      groups: [],
      webgpuScratch: { allocations: 0, allocatedBytes: 0, reuses: 0, reusedBytes: 0 },
    });
    expect(mergeReports([gpu])).toEqual(gpu);
  });

  it('sums known scratch acquisitions into a detached snapshot (change 0128)', () => {
    const a = {
      ...gpu,
      webgpuScratch: { allocations: 2, allocatedBytes: 80, reuses: 1, reusedBytes: 16 },
    };
    const b = {
      ...cpu,
      webgpuScratch: { allocations: 0, allocatedBytes: 0, reuses: 0, reusedBytes: 0 },
    };
    const c = {
      ...gl,
      webgpuScratch: { allocations: 1, allocatedBytes: 32, reuses: 2, reusedBytes: 48 },
    };
    const before = JSON.stringify([a, b, c]);
    const merged = mergeReports([a, b, c]);
    expect(merged.webgpuScratch).toEqual({
      allocations: 3,
      allocatedBytes: 112,
      reuses: 3,
      reusedBytes: 64,
    });
    expect(merged.webgpuScratch).not.toBe(a.webgpuScratch);
    expect(merged.groups[0]).toBe(gpu.groups[0]);
    expect(JSON.stringify([a, b, c])).toBe(before);
  });

  it('keeps legacy omissions unknown regardless of input order (change 0128)', () => {
    const known = {
      ...gpu,
      webgpuScratch: { allocations: 1, allocatedBytes: 16, reuses: 0, reusedBytes: 0 },
    };
    for (const reports of [[known, cpu], [cpu, known], [known, cpu, known], [cpu]]) {
      expect(mergeReports(reports)).not.toHaveProperty('webgpuScratch');
    }
  });

  it('does not change the reports it was given', () => {
    const before = JSON.stringify([gpu, gl, cpu]);
    const merged = mergeReports([gpu, gl, cpu]);
    expect(merged.groups).toHaveLength(4);
    expect(JSON.stringify([gpu, gl, cpu])).toBe(before);
  });

  it('leaves the chunk row out of a merged report, which is no one chunk (change 0074, D6)', () => {
    const chunked: FuseReport = { ...gpu, chunk: { key: 'sweep', units: 4, elapsedMs: 12.5 } };
    const merged = mergeReports([chunked, gl]);
    expect('chunk' in merged).toBe(false);
    expect(merged.dispatches).toBe(5);
    expect('chunk' in mergeReports([chunked])).toBe(false);
  });

  it('is exported from the root too, and the type is one with the one typeshade/fuse exports', () => {
    expect(root.mergeReports).toBe(mergeReports);
    // A report `fuse()` resolves to is a `FuseReport` of the runtime: the same type.
    const r: FuseReport = gpu;
    const viaFuse: Awaited<ReturnType<typeof fuse.fuse>> = r;
    expect(viaFuse).toBe(gpu);
  });
});
