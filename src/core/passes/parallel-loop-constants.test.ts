import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { proveKernels } from './parallel-loop.js';

function verdict(body: string): string {
  const r = compile(`"use typeshade";\n${body}\n`, { fileName: 'm.shade.ts' });
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const proofs = proveKernels(r.module);
  expect(proofs).toHaveLength(1);
  expect(proofs[0]!.shape).toBeUndefined();
  const v = proofs[0]!.loops[0]!;
  if (!v.ok) return `${v.refusal.rule} ${'why' in v.refusal ? v.refusal.why : 'call'}`;
  return [...v.writes.map((w) => `${w.kind} ${w.name}`)].join(', ');
}

describe('a let is read through as a constant only when what it was made from cannot change', () => {
  const tile = (before: string, declared: string, bound: string): string =>
    `export function tile(out: array<f32>, w: u32, h: u32) {
  ${before}
  for (let y: u32 = 0; y < h; y++) {
    ${declared}
    for (let x: u32 = 0; x < ${bound}; x++) { out[y * W2 + x] = f32(x + y); }
  }
}`;

  it('reads a top-level let through when nothing it reads is set again', () => {
    expect(verdict(tile('const W2 = w * 2;', '', 'w * 2'))).toBe('row-major out');
  });

  it('does not read a top-level let through when it reads a name that is set again', () => {
    const before = 'let s: u32 = 2; const W2 = s * w; s = 5;';
    expect(verdict(tile(before, '', 's * w'))).toBe('R3 shared');
  });

  it('reads a let of the body through when nothing it reads is set again', () => {
    expect(verdict(tile('', 'const W2 = w * 2;', 'w * 2'))).toBe('row-major out');
  });

  it('does not read a let of the body through when it reads a name that is set again', () => {
    const body = tile('let s: u32 = 2;', 'const W2 = s * w;', 's * w');
    expect(verdict(body)).toBe('R3 shared');
  });
});

describe('one index at every write, whose coefficient of the counter is loop-invariant', () => {
  const scaled = (index: string, extra = ''): string =>
    `export function put(out: array<f32>, xs: array<u32>, n: u32, k: u32) {
  for (let i: u32 = 0; i < n; i++) { ${extra} out[${index}] = 1.; }
}`;

  it.each(['i * k', 'k * i', 'i * k + n', 'n + k * i', 'n + i'])('accepts out[%s]', (index) => {
    expect(verdict(scaled(index))).toBe('scaled out');
  });

  it('refuses a coefficient that the loop computes', () => {
    expect(verdict(scaled('i * m', 'const m = xs[i];'))).toBe('R3 shared');
  });

  it('refuses an added value that the loop computes', () => {
    expect(verdict(scaled('i * k + m', 'const m = xs[i];'))).toBe('R3 shared');
  });

  it('refuses two writes at different indices of the same coefficient', () => {
    const body = `export function put(out: array<f32>, n: u32, k: u32) {
  for (let i: u32 = 0; i < n; i++) { out[i * k] = 1.; out[i * k + 1] = 2.; }
}`;
    expect(verdict(body)).toBe('R3 shared');
  });
});
