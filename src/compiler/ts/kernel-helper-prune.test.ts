import { describe, expect, it } from 'vitest';
import { bothTake } from '../../core/testing/both-halves.js';
import { hostFace } from './host-face.js';

const SOURCE = `"use typeshade";
declare const xs: storage<array<f32>>;
function sample(i: u32): f32 { return xs[i]; }
export function fill(out: array<f32>, n: u32, value: f32) {
  for (let i: u32 = 0; i < n; i++) out[i] = value;
}
`;

describe('a kernel module keeps only the helpers its entries reach (#1093)', () => {
  it('drops an unreached helper that reads a binding the kernel does not bind', () => {
    bothTake(SOURCE);
    const host = hostFace(SOURCE, { fileName: '/app/prune.shade.ts' });
    expect(host.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const fill = host.exports?.find((e) => e.name === 'fill');
    if (fill?.kind !== 'kernel') throw new Error('Expected a kernel face');
    const wgsl = fill.face.gpu?.wgsl ?? '';
    expect(wgsl).toContain('fill_args');
    expect(wgsl).not.toContain('fn sample');
    expect(wgsl).not.toContain('xs');
  });
});
