// A tiled matmul entry (proposal 0069, Q2): `compile()` and the language service read the same
// source and agree (Rule 12.7), and the CPU oracle runs the tiled entry to the bits of the naive
// kernel, which adds the products of each sum in ascending `k` (the order a tile also keeps).
//
// Verifies: Rule 8.24 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const SRC = `"use typeshade";
declare const a: storage<array<f32>>;
declare const b: storage<array<f32>>;
declare const c: storage<array<f32>, "read_write">;
declare const n: uniform<u32>;
let ta: workgroup<array<f32, 256>>;
let tb: workgroup<array<f32, 256>>;
@compute([16, 16, 1])
export function tiled(
  @builtin("global_invocation_id") gid: vec3u,
  @builtin("local_invocation_id") lid: vec3u,
): void {
  let acc: f32 = 0.;
  for (let t: u32 = 0; t < n / 16; t++) {
    ta[lid.y * 16 + lid.x] = a[gid.y * n + (t * 16 + lid.x)];
    tb[lid.y * 16 + lid.x] = b[(t * 16 + lid.y) * n + gid.x];
    workgroupBarrier();
    for (let kk: u32 = 0; kk < 16; kk++) {
      acc = acc + ta[lid.y * 16 + kk] * tb[kk * 16 + lid.x];
    }
    workgroupBarrier();
  }
  c[gid.y * n + gid.x] = acc;
}
export function naive(c: array<f32>, a: array<f32>, b: array<f32>, n: u32): void {
  for (let i: u32 = 0; i < c.length; i++) {
    const r = i / n;
    const col = i % n;
    let s: f32 = 0.;
    for (let k: u32 = 0; k < n; k++) {
      s = s + a[r * n + k] * b[k * n + col];
    }
    c[i] = s;
  }
}
`;

describe('a tiled matmul entry (proposal 0069)', () => {
  it('compiles with no diagnostic, and the language service says the same (Rule 12.7)', () => {
    const compiled = compile(SRC).diagnostics.map((d) => `${d.code} ${d.message}`);
    const service = createTypeshadeLanguageService();
    service.openDocument('tiled.shade.ts', SRC);
    const editor = service
      .getDiagnostics('tiled.shade.ts')
      .map((d) => `${String(d.code)} ${d.message}`);
    expect(compiled).toEqual([]);
    expect(editor).toEqual(compiled);
  });

  it.each([32, 64])(
    'the CPU oracle gives the tiled entry the bits of the naive kernel (N = %i)',
    (N) => {
      const r = compile(SRC);
      expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
      const a = Array.from({ length: N * N }, (_, i) => Math.sin(i * 0.37) * 3 + (i % 7) * 0.001);
      const b = Array.from({ length: N * N }, (_, i) => Math.cos(i * 0.91) * 2 - (i % 5) * 0.002);
      const tiled = Array.from({ length: N * N }, () => 0);
      const cm = compileModule(r.module!);
      cm.setBinding('a', a);
      cm.setBinding('b', b);
      cm.setBinding('c', tiled);
      cm.setBinding('n', N);
      cm.dispatch('tiled', [N / 16, N / 16, 1]);
      const naive = Array.from({ length: N * N }, () => 0);
      compileModule(r.module!).fns['naive']!(naive, a, b, N);
      expect(tiled.every((x, i) => Object.is(x, naive[i]))).toBe(true);
    },
    60_000,
  );
});
