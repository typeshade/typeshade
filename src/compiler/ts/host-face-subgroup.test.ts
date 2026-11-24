import { describe, expect, it, vi } from 'vitest';
import { hostFace } from './host-face.js';

vi.mock('../../core/backends/wgsl.js', async (original) => {
  const real = await original<typeof import('../../core/backends/wgsl.js')>();
  return {
    ...real,
    emitModule: (...args: Parameters<typeof real.emitModule>) => {
      const text = real.emitModule(...args);
      if (text.includes('enable subgroups;')) throw new Error('the subgroup text did not emit');
      return text;
    },
  };
});

describe('a subgroup variant whose text does not emit (change 0119)', () => {
  const source = `"use typeshade";
export function total(xs: array<u32>): u32 {
  let s: u32 = 0;
  for (let i: u32 = 0; i < xs.length; i++) s += xs[i];
  return s;
}
`;

  it('leaves the function its tree text on the GPU, with no variant', () => {
    const f = hostFace(source, { fileName: '/app/m.shade.ts' });
    expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const kernel = f.exports!.find((e) => e.name === 'total');
    if (kernel?.kind !== 'kernel') throw new Error(`total is ${kernel?.kind}`);
    expect(kernel.face.noGpu).toBeUndefined();
    expect(kernel.face.gpu!.wgsl).toContain('@compute');
    expect(kernel.face.gpu!.loops.map((l) => l.subgroupFold)).toEqual([true]);
    expect(kernel.face.gpu!.wgslSubgroup).toBeUndefined();
  });
});
