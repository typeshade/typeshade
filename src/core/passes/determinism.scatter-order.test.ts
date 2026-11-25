import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { determinismReport } from './determinism.js';

const scatter = (elem: 'f32' | 'i32' | 'u32'): string => `"use typeshade";
export function scat(g: array<${elem}>, idx: array<u32>, x: array<${elem}>) {
  for (let i: u32 = 0; i < x.length; i++) {
    g[idx[i]] += x[i];
  }
}`;

const orderRows = (src: string) => {
  const r = compile(src, { fileName: 'm.shade.ts' });
  return determinismReport(r.module).filter((e) => e.kind === 'order');
};

describe('the order rows of a scatter with +=', () => {
  it('has one for an f32 write and none for an i32 or a u32 write', () => {
    expect(orderRows(scatter('f32')).map((e) => [e.op, e.elem])).toEqual([['+', 'f32']]);
    expect(orderRows(scatter('i32'))).toEqual([]);
    expect(orderRows(scatter('u32'))).toEqual([]);
  });
});
