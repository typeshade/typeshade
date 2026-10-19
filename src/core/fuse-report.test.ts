// `mergeReports` (change 0071, Amendment 2): the report of several plans as one, as a plan of
// several groups reports its own. The type and the function come from `typeshade/runtime` and
// the root, so a host that ships the runtime alone holds and sums reports without the planner.
//
// Verifies: Rule 11.13 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { mergeReports, type FuseReport } from '../runtime.js';
import * as root from '../index.js';
import * as fuse from '../fuse.js';

const cpu: FuseReport = { tier: 'cpu', dispatches: 0, submissions: 0, groups: [] };
const gl: FuseReport = {
  tier: 'webgl2',
  dispatches: 2,
  submissions: 0,
  groups: [
    { calls: ['add'], fused: false },
    { calls: ['mul'], fused: false, why: 'webgl2' },
  ],
};
const gpu: FuseReport = {
  tier: 'webgpu',
  dispatches: 3,
  submissions: 1,
  groups: [
    { calls: ['add', 'mul', 'relu'], fused: true, workgroupShapes: [[64, 1, 1]], gpuTime: 1200 },
    { calls: ['total'], fused: false, why: 'total reduces', workgroupShapes: [[256, 1, 1]] },
  ],
};

describe('mergeReports (change 0071, Amendment 2)', () => {
  it('sums the dispatches and the submissions and keeps the groups in the order given', () => {
    const merged = mergeReports([gpu, cpu, gl]);
    expect(merged.dispatches).toBe(5);
    expect(merged.submissions).toBe(1);
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

  it('is the report of a plan that did nothing for no report, and the report itself for one', () => {
    expect(mergeReports([])).toEqual({ tier: 'cpu', dispatches: 0, submissions: 0, groups: [] });
    expect(mergeReports([gpu])).toEqual(gpu);
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
