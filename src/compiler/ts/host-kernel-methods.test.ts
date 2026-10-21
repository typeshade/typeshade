// Verifies: Rule 8.22 (docs/language-design.md; traced in reqs/).
//
// An array's methods on a kernel function's array (change 0079, part 1): `forEach`, `reduce`,
// `some` and `every` are loops of the kernel function's body. Read twice on one source (Rule
// 12.7): `compile()` and the language service. The face says which loops run on the GPU, and the
// CPU tier gives what ECMAScript's own `Array.prototype` gives on the same input.

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compile } from './compile.js';
import { hostFace } from './host-face.js';
import type { KernelFace } from '../../core/host-kernel.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const module = (body: string): string => `"use typeshade";\n${body}\n`;

const compiled = (body: string): string[] =>
  compile(module(body), { fileName: 'm.shade.ts' }).diagnostics.map(
    (d) => `${d.category} ${d.code} ${d.message}`,
  );

const edited = (body: string): string[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('m.shade.ts', module(body));
  return service
    .getDiagnostics('m.shade.ts')
    .map((d) => `${d.severity} ${String(d.code)} ${d.message}`);
};

function kernel(body: string, name: string): KernelFace {
  const f = hostFace(module(body), { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const e = f.exports?.find((x) => x.name === name);
  expect(e?.kind).toBe('kernel');
  return (e as { face: KernelFace }).face;
}

async function load(body: string): Promise<Record<string, (...a: unknown[]) => Promise<unknown>>> {
  const f = hostFace(module(body), { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-kernel-methods-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, f.code!);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<
    string,
    (...a: unknown[]) => Promise<unknown>
  >;
}

const SOURCE = `export function double(xs: array<f32>, out: array<f32>) {
  xs.forEach((x, i) => {
    out[i] = x * 2.;
  });
}
export function total(xs: array<f32>): f32 {
  return xs.reduce((a, x) => a + x, 0.);
}
export function norm(xs: array<f32>): f32 {
  const s = xs.reduce((a, x) => a + x * x, 0.);
  return sqrt(s);
}
export function count(xs: array<u32>, t: u32): u32 {
  return xs.reduce((n, x) => n + select(u32(0), u32(1), x > t), u32(0));
}
export function any(xs: array<f32>, t: f32): bool {
  return xs.some((x) => x > t);
}
export function all(xs: array<f32>, t: f32): bool {
  return xs.every((x) => x > t);
}
export function both(xs: array<i32>, out: array<i32>): i32 {
  xs.forEach((x, i) => {
    out[i] = x + i;
  });
  let m: i32 = 0;
  xs.forEach((x) => {
    m = max(m, x);
  });
  return m;
}`;

describe("an array method on a kernel function's array (change 0079)", () => {
  it('compiles quietly in both halves', () => {
    expect(compiled(SOURCE)).toEqual([]);
    expect(edited(SOURCE)).toEqual([]);
  });

  it('runs each loop on the GPU, as the for loop it is would', () => {
    for (const [name, loops] of [
      ['double', 1],
      ['total', 1],
      ['norm', 1],
      ['count', 1],
      ['any', 1],
      ['all', 1],
      ['both', 2],
    ] as const) {
      const k = kernel(SOURCE, name);
      expect([name, k.noGpu]).toEqual([name, undefined]);
      expect([name, k.gpu?.loops.length]).toEqual([name, loops]);
    }
  });

  it('gives on the CPU tier what Array.prototype gives', async () => {
    const m = await load(SOURCE);
    const xs = Float32Array.from([0.5, -1.25, 3, 2.5, -0.75]);
    const out = new Float32Array(5);
    await m.double!(xs, out);
    expect([...out]).toEqual([...xs].map((x) => Math.fround(x * 2)));
    expect(await m.total!(xs)).toBe([...xs].reduce((a, x) => Math.fround(a + x), 0));
    expect(await m.any!(xs, 2.75)).toBe([...xs].some((x) => x > 2.75));
    expect(await m.any!(xs, 3)).toBe(false);
    expect(await m.all!(xs, -2)).toBe(true);
    expect(await m.all!(xs, 0)).toBe(false);
    expect(await m.count!(Uint32Array.from([1, 5, 7, 2, 9]), 4)).toBe(3);
    const ys = Int32Array.from([3, -7, 11, 0]);
    const zs = new Int32Array(4);
    expect(await m.both!(ys, zs)).toBe(11);
    expect([...zs]).toEqual([3, -6, 13, 3]);
  });

  it('runs a reduce whose function is no reduction on the CPU, saying why in both halves', () => {
    const body = `export function last(xs: array<f32>): f32 {
  return xs.reduce((a, x) => x - a, 0.);
}`;
    const c = compiled(body);
    expect(c).toHaveLength(1);
    // The running value reads as the name the function gives it, on the line of the call.
    expect(c[0]).toBe(
      'warning TS8070 This loop runs on the CPU because line 3 writes "a", which the next iteration reads. Declare it inside the loop, or combine it with one of += *= min max & | ^.',
    );
    expect(edited(body)).toEqual(c);
  });

  it('refuses a function that returns from inside its body, in both halves', () => {
    const body = `export function f(xs: array<f32>, out: array<f32>) {
  xs.forEach((x, i) => {
    if (x < 0.) {
      return;
    }
    out[i] = x;
  });
}`;
    const c = compiled(body);
    expect(c.some((d) => d.startsWith('error ') && d.includes('end it with one return'))).toBe(
      true,
    );
    expect(edited(body).some((d) => d.includes('end it with one return'))).toBe(true);
  });
});
