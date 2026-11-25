import { describe, expect, it } from 'vitest';
import { bothHalves } from './testing/both-halves.js';
import { compileModule } from './oracle.js';
import type { CpuValue } from './cpu-runtime.js';

const compiled = (body: string) => {
  const halves = bothHalves(`"use typeshade";\n${body}\n`);
  expect(halves.compiler).toEqual([]);
  expect(halves.editor.filter((d) => !d.startsWith('typeshade TS8070'))).toEqual([]);
  return compileModule(halves.result.module);
};

const asArgs = (...xs: number[][]): CpuValue[] => xs as unknown as CpuValue[];

describe('oracle: a scatter loop of a kernel function', () => {
  it('leaves the real array behind the name, so a read after the loop sees the fold', () => {
    const cpu = compiled(`export function run(g: array<f32>, idx: array<u32>, x: array<f32>): f32 {
  for (let i: u32 = 0; i < x.length; i++) { g[idx[i]] += x[i]; }
  return g[0] + g[1];
}`);
    expect(cpu.fns['run']!(...asArgs([10, 20], [0, 0, 1], [1, 2, 4]))).toBe(37);
  });

  it('folds the contributions already made when a discard leaves the loop', () => {
    const cpu = compiled(`export function run(g: array<f32>, idx: array<u32>, x: array<f32>): f32 {
  for (let i: u32 = 0; i < x.length; i++) {
    g[idx[i]] += x[i];
    if (x[i] < 0.) { discard; }
  }
  return g[0];
}`);
    const g = [10, 20];
    expect(cpu.fns['run']!(...asArgs(g, [0, 0, 1, 1], [1, 2, -3, 8]))).toBeUndefined();
    expect(g).toEqual([13, 17]);
  });
});
