import { describe, expect, it } from 'vitest';
import { hostFace } from './host-face.js';

const SOURCE = `"use typeshade";
class P { a: f32; b: f32; }
export function ordinary(ps: array<P>, out: array<f32>) {
  for (let i: u32 = 0; i < ps.length; i++) out[i] = ps[i].a;
}
export function pushes(ps: array<P>, out: array<f32>) {
  for (let i: u32 = 0; i < ps.length; i++) { if (ps[i].a > 0.) out.push(ps[i].a); }
}
`;

function gpuOf(name: string) {
  const host = hostFace(SOURCE, { fileName: '/app/m.shade.ts' });
  expect(host.diagnostics.filter((d) => d.category === 'error').map((d) => d.message)).toEqual([]);
  const kernel = host.exports?.find((e) => e.name === name);
  if (kernel?.kind !== 'kernel') throw new Error(`${name} is ${kernel?.kind}`);
  expect(kernel.face.noGpu).toBeUndefined();
  return kernel.face.gpu!;
}

describe('the private face of a kernel call, with the arrays it reads cut to their fields', () => {
  it('is carried by an ordinary call', () => {
    expect(gpuOf('ordinary').projected).toBeDefined();
  });

  it('is not carried by a call whose loop pushes, which keeps the full layout', () => {
    expect(gpuOf('pushes').projected).toBeUndefined();
  });
});
