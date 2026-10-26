// Verifies: Rule 8.22 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).
//
// `out.push(v)` in a kernel function's loop (change 0078, part 1): the face of the function, and
// its call on the CPU tier, which is the oracle. The WebGPU lowering is a later part of the change.

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from './host-face.js';
import type { KernelFace } from '../../core/host-kernel.js';
// A device's fuse() runs through the planner `typeshade/fuse` loads (change 0071).
import '../../fuse.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function face(source: string) {
  const f = hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f as Required<typeof f>;
}

async function load(source: string): Promise<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-kernel-push-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, face(source).code);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>;
}

const kernelOf = (f: ReturnType<typeof face>, name: string): KernelFace => {
  const e = f.exports.find((x) => x.name === name);
  expect(e?.kind).toBe('kernel');
  return (e as { face: KernelFace }).face;
};

const STRONG = `"use typeshade";
export function strong(xs: array<f32>, t: f32, out: array<u32>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] > t) {
      out.push(i);
    }
  }
  return out.length;
}
`;

const TWICE = `"use typeshade";
export function twice(xs: array<u32>, out: array<u32>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] % 2 == 0) {
      out.push(xs[i]);
      out.push(xs[i] * 10);
    }
  }
  return out.length;
}
`;

describe('the face of a kernel function that pushes (change 0078)', () => {
  it('writes the pushed array, and runs on WebGPU in three steps: count, scan, store', () => {
    const k = kernelOf(face(STRONG), 'strong');
    expect(k.params.find((p) => p.name === 'out')).toMatchObject({ k: 'array', writes: true });
    expect(k.noGpu).toBeUndefined();
    const loop = k.gpu!.loops[0]!;
    expect([loop.entry, loop.push?.count, loop.push?.scan, loop.push?.binding.name]).toEqual([
      'strong_loop0',
      'strong_loop0_counts',
      'strong_loop0_scan',
      'strong_loop0_push',
    ]);
    // The pushed array and the counts are no array the host passes: the face binds the counts.
    expect(k.gpu!.arrays.map((b) => b.name)).toEqual(['xs', 'out']);
    const wgsl = k.gpu!.wgsl;
    // A lane past the trip count counts the last iteration and stores no count (change 0096).
    expect(wgsl).toContain('let _cnt = strong_loop0_count(_kc);');
    expect(wgsl).toContain('if (_live) {\n    strong_loop0_push[_k] = _cnt;');
    expect(wgsl).toContain('strong_loop0_push[strong_args._n] = _at;');
    expect(wgsl).toContain('if ((_p < arrayLength(&out))) {');
    expect(k.noWebgl2).toBe(
      'loop 1 pushes onto an array, which the WebGL2 tier does not run (change 0078)',
    );
  });

  it('carries no fuse record, so a fuse plan runs the call in a group of its own', () => {
    const f = hostFace(STRONG, { fileName: '/app/m.shade.ts', runtime: RUNTIME, fuse: true });
    const e = f.exports?.find((x) => x.name === 'strong') as { face: KernelFace };
    expect(e.face.fuse).toBeUndefined();
  });

  it('runs on the CPU a loop whose counting step would change what it computes', () => {
    const gap = (body: string): string | undefined =>
      kernelOf(face(`"use typeshade";\n${body}\n`), 'f').noGpu;
    expect(
      gap(`export function f(xs: array<u32>, out: array<u32>, ys: array<u32>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) {
    out.push(xs[i]);
    ys.push(xs[i] * 2);
  }
  return out.length;
}`),
    ).toBe('loop 1 pushes onto "out" and "ys", and the call counts the pushes of one array a loop');
    expect(
      gap(`export function f(xs: array<u32>, out: array<u32>): u32 {
  let s: u32 = 0;
  for (let i: u32 = 0; i < xs.length; i++) {
    out.push(xs[i]);
    s += xs[i];
  }
  return s + out.length;
}`),
    ).toBe('loop 1 pushes and reduces "s", which its counting step would combine twice');
    expect(
      gap(`export function f(xs: array<u32>, out: array<u32>, ys: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    ys[i] = xs[i] + 1;
    if (ys[i] > 3) {
      out.push(ys[i]);
    }
  }
}`),
    ).toBe(
      'loop 1 pushes and reads back what it writes to "ys", which its counting step does not write',
    );
    // gate:differential, seed 24: the second loop appends after the first, and a GPU loop's
    // offsets start at 0.
    expect(
      gap(`export function f(xs: array<u32>, out: array<u32>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) {
    out.push(xs[i]);
  }
  for (let i: u32 = 0; i < xs.length; i++) {
    out.push(i);
  }
  return out.length;
}`),
    ).toBe('loops 1 and 2 both push onto "out", and the second appends after the first');
    // A write the iteration does not read back runs in the store step, and the loop lowers.
    expect(
      gap(`export function f(xs: array<u32>, out: array<u32>, ys: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    ys[i] = xs[i] + 1;
    out.push(xs[i]);
  }
}`),
    ).toBeUndefined();
  });
});

describe('a kernel function that pushes, on the CPU tier (Rule 8.23)', () => {
  it('appends in the order of the iterations, and returns the count', async () => {
    const strong = (await load(STRONG)).strong as (...a: unknown[]) => Promise<number>;
    const xs = new Float32Array([0.9, 0.1, 0.7, 0.2, 0.8]);
    const out = new Uint32Array(8).fill(99);
    expect(await strong(xs, 0.5, out)).toBe(3);
    expect([...out]).toEqual([0, 2, 4, 99, 99, 99, 99, 99]);
  });

  it('appends nothing and returns 0 when no iteration pushes', async () => {
    const strong = (await load(STRONG)).strong as (...a: unknown[]) => Promise<number>;
    const out = new Uint32Array(4).fill(7);
    expect(await strong(new Float32Array([0.1, 0.2]), 0.5, out)).toBe(0);
    expect([...out]).toEqual([7, 7, 7, 7]);
  });

  it('stores up to the capacity, and returns the count appended past it (decision 1)', async () => {
    const strong = (await load(STRONG)).strong as (...a: unknown[]) => Promise<number>;
    const out = new Uint32Array(2);
    expect(await strong(new Float32Array([1, 1, 1, 1, 1]), 0.5, out)).toBe(5);
    expect([...out]).toEqual([0, 1]);
  });

  it('keeps the order of the statements when one iteration pushes twice', async () => {
    const twice = (await load(TWICE)).twice as (...a: unknown[]) => Promise<number>;
    const out = new Uint32Array(6);
    expect(await twice(new Uint32Array([2, 3, 4]), out)).toBe(4);
    expect([...out]).toEqual([2, 20, 4, 40, 0, 0]);
  });

  it('appends the pushes of a second loop after the first', async () => {
    const m = await load(`"use typeshade";
export function f(xs: array<u32>, out: array<u32>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) {
    out.push(xs[i]);
  }
  for (let i: u32 = 0; i < xs.length; i++) {
    out.push(i);
  }
  return out.length;
}
`);
    const out = new Uint32Array(5);
    expect(await (m.f as (...a: unknown[]) => Promise<number>)(Uint32Array.of(7, 8, 9), out)).toBe(
      6,
    );
    expect([...out]).toEqual([7, 8, 9, 0, 1]);
  });

  it('starts each call empty', async () => {
    const strong = (await load(STRONG)).strong as (...a: unknown[]) => Promise<number>;
    const out = new Uint32Array(4);
    await strong(new Float32Array([1, 1]), 0.5, out);
    expect(await strong(new Float32Array([0, 1]), 0.5, out)).toBe(1);
    expect([...out]).toEqual([1, 1, 0, 0]);
  });
});

describe('a loop that pushes in a fuse scope (change 0078, Rule 11.13)', () => {
  // Verifies: Rule 11.13. A fuse plan gives the bits of the calls run apart, a loop that pushes
  // between two array loops among them.
  const CHAIN = `"use typeshade";
export function scale(xs: array<f32>, ys: array<f32>, k: f32) {
  for (let i: u32 = 0; i < xs.length; i++) {
    ys[i] = xs[i] * k;
  }
}
export function keep(ys: array<f32>, t: f32, out: array<u32>): u32 {
  for (let i: u32 = 0; i < ys.length; i++) {
    if (ys[i] > t) {
      out.push(i);
    }
  }
  return out.length;
}
export function mark(xs: array<f32>, zs: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    zs[i] = xs[i] + 1.;
  }
}
`;

  it('runs scale, keep and mark in one plan as they run apart, keep a group of its own', async () => {
    const { createDevice } = await import('../../runtime/device.js');
    const m = await load(CHAIN);
    const [scale, keep, mark] = [m.scale, m.keep, m.mark] as ((
      ...a: unknown[]
    ) => Promise<unknown>)[];
    const input = Float32Array.from({ length: 40 }, (_, i) => Math.sin(i) * 3);
    const run = async (fused: boolean): Promise<number[][]> => {
      const dev = await createDevice({ prefer: ['cpu'] });
      const xs = dev.array(input);
      const ys = dev.array(input.length, 'f32');
      const out = dev.array(new Uint32Array(64).fill(9));
      const zs = dev.array(input.length, 'f32');
      let count: unknown;
      if (fused) {
        const report = await dev.fuse(() => {
          void scale(xs, ys, 2);
          void keep(ys, 1.5, out).then((n) => (count = n));
          void mark(xs, zs);
        });
        // keep stands apart, so no group holds a call on each side of it.
        expect(report.groups.map((g) => g.calls)).toEqual([['scale'], ['keep'], ['mark']]);
      } else {
        // Apart: each call a plan of its own, on the same device.
        await dev.fuse(() => void scale(xs, ys, 2));
        await dev.fuse(() => void keep(ys, 1.5, out).then((n) => (count = n)));
        await dev.fuse(() => void mark(xs, zs));
      }
      const got = [
        [count as number],
        [...(await ys.read())],
        [...(await out.read())],
        [...(await zs.read())],
      ];
      await dev.dispose();
      return got;
    };
    const apart = await run(false);
    expect(await run(true)).toEqual(apart);
    // The count and the indices a sequential run appends.
    const want = [...input].flatMap((x, i) => (Math.fround(Math.fround(x) * 2) > 1.5 ? [i] : []));
    expect(apart[0]).toEqual([want.length]);
    expect(apart[2]!.slice(0, want.length)).toEqual(want);
  });
});
