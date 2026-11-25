import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from '../compiler/ts/host-face.js';
import { array } from '../runtime.js';
import { grid, orderWord, tierFit, type CheckedCall, type KernelFace } from './host-kernel.js';
import type { CallOwner } from './owner.js';
import { failurePending } from './submission.js';

const RUNTIME = resolve(__dirname, 'host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function faces(source: string): { code: string; kernels: Map<string, KernelFace> } {
  const f = hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const kernels = new Map<string, KernelFace>();
  for (const e of f.exports ?? []) if (e.kind === 'kernel') kernels.set(e.name, e.face);
  return { code: f.code!, kernels };
}

async function load(source: string): Promise<Record<string, (...a: unknown[]) => Promise<void>>> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-invariants-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, faces(source).code);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as never;
}

describe('the workgroups of a dispatch', () => {
  it('keeps x within 65535 and spills the rest into y', () => {
    expect(grid(65535)).toEqual({ wg: [65535, 1, 1], slots: 65535 });
    expect(grid(65536)).toEqual({ wg: [65535, 2, 1], slots: 131070 });
    expect(grid(131071)).toEqual({ wg: [65535, 3, 1], slots: 196605 });
  });

  it('gives one workgroup in x and none in y for no groups', () => {
    expect(grid(0)).toEqual({ wg: [1, 0, 1], slots: 0 });
  });
});

describe('the order word of a key', () => {
  it('is the unsigned bits of an integer key', () => {
    expect(orderWord('u32', 0xffffffff)).toBe(0xffffffff);
    expect(orderWord('i32', -1)).toBe(0xffffffff);
    expect(orderWord('i32', -0x80000000)).toBe(0x80000000);
  });

  it('is one word for every NaN and for both zeros', () => {
    expect(orderWord('f32', NaN)).toBe(0x7fc00000);
    expect(orderWord('f32', 0)).toBe(0);
    expect(orderWord('f32', -0)).toBe(0);
    expect(orderWord('f32', 1)).toBe(0x3f800000);
  });
});

const LOOPS = `"use typeshade";
export function upTo(out: array<f32>, n: u32): void {
  for (let i: u32 = 0; i <= n; i++) {
    out[i] = 1.;
  }
}
export function downTo(out: array<f32>, n: i32): void {
  for (let i: i32 = n; i >= 0; i--) {
    out[i] = 1.;
  }
}
export function downOver(out: array<f32>, n: i32): void {
  for (let i: i32 = n; i > 0; i--) {
    out[i] = 1.;
  }
}
export function downBy(out: array<f32>, n: i32): void {
  for (let i: i32 = n; i >= 0; i -= 3) {
    out[i] = 1.;
  }
}
export function mirror(out: array<f32>, xs: array<f32>): void {
  for (let i: u32 = 0; i < 8; i++) {
    out[i] = xs[7 - i];
  }
}
export function shifted(out: array<f32>, xs: array<f32>): void {
  for (let i: u32 = 0; i < 8; i++) {
    let v = 0.;
    if (i > 3) {
      v = xs[i - 4];
    }
    out[i] = v;
  }
}
export function shiftedFrom(out: array<f32>, xs: array<f32>): void {
  for (let i: u32 = 0; i < 8; i++) {
    let v = 0.;
    if (i >= 4) {
      v = xs[i - 4];
    }
    out[i] = v;
  }
}
`;

describe('the indices a loop reaches, checked before anything runs', () => {
  it('counts an inclusive bound and a descending counter by the iterations that run', async () => {
    const m = await load(LOOPS);
    await expect(m.upTo!(new Float32Array(3), 3)).rejects.toThrow(
      'upTo(): parameter "out" holds 3 elements, and loop 1 writes it at indices 0 to 3.',
    );
    await expect(m.downTo!(new Float32Array(3), 3)).rejects.toThrow(
      'downTo(): parameter "out" holds 3 elements, and loop 1 writes it at indices 0 to 3.',
    );
    await expect(m.downOver!(new Float32Array(3), 3)).rejects.toThrow(
      'downOver(): parameter "out" holds 3 elements, and loop 1 writes it at indices 1 to 3.',
    );
    await expect(m.downBy!(new Float32Array(3), 3)).rejects.toThrow(
      'downBy(): parameter "out" holds 3 elements, and loop 1 writes it at indices 0 to 3.',
    );
    const ok = new Float32Array(4);
    await m.upTo!(ok, 3);
    expect([...ok]).toEqual([1, 1, 1, 1]);
    const stepped = new Float32Array(4);
    await m.downBy!(stepped, 3);
    expect([...stepped]).toEqual([1, 0, 0, 1]);
  });

  it('checks a read at a falling index from the other end of the range', async () => {
    const m = await load(LOOPS);
    await expect(m.mirror!(new Float32Array(8), new Float32Array(4))).rejects.toThrow(
      'mirror(): parameter "xs" holds 4 elements, and loop 1 reads it at indices 0 to 7.',
    );
  });

  it('starts the counter after a strict guard and at a non-strict one', async () => {
    const m = await load(LOOPS);
    const out = new Float32Array(8);
    await m.shifted!(out, Float32Array.of(1, 2, 3, 4));
    expect([...out]).toEqual([0, 0, 0, 0, 1, 2, 3, 4]);
    const again = new Float32Array(8);
    await m.shiftedFrom!(again, Float32Array.of(1, 2, 3, 4));
    expect([...again]).toEqual([0, 0, 0, 0, 1, 2, 3, 4]);
    await expect(m.shifted!(new Float32Array(8), new Float32Array(3))).rejects.toThrow(
      'shifted(): parameter "xs" holds 3 elements, and loop 1 reads it at indices 0 to 3.',
    );
  });
});

const GRIDS = `"use typeshade";
export function cells(out: array<f32>, w: u32, h: u32): void {
  for (let y: u32 = 0; y < h; y++) {
    for (let x: u32 = 0; x < w; x++) {
      out[y * w + x] = f32(x + y);
    }
  }
}
`;

describe('the rows a nested loop writes', () => {
  it('refuses an array that ends inside the last row, and takes one that holds it', async () => {
    const m = await load(GRIDS);
    await expect(m.cells!(new Float32Array(5), 2, 3)).rejects.toThrow(
      'cells(): parameter "out" holds 5 elements, and loop 1 writes it at indices 0 to 5.',
    );
    const out = new Float32Array(6);
    await m.cells!(out, 2, 3);
    expect([...out]).toEqual([0, 1, 1, 2, 2, 3]);
  });
});

const SETS = `"use typeshade";
export function labels(pixels: array<u32>, seen: Set<u32>): u32 {
  for (let i: u32 = 0; i < pixels.length; i++) {
    seen.add(pixels[i]);
  }
  return seen.size;
}
export function signed(xs: array<i32>, seen: Set<i32>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) {
    seen.add(xs[i]);
  }
  return seen.size;
}
export function floats(xs: array<f32>, seen: Set<f32>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) {
    seen.add(xs[i]);
  }
  return seen.size;
}
`;

describe('the keys a host collection holds', () => {
  it('takes every u32 and every i32, and refuses the next one outside the range', async () => {
    const m = await load(SETS);
    const ids = new Set([0x80000000, 0xffffffff]);
    await expect(m.labels!(Uint32Array.of(1), ids)).resolves.toBe(3);
    await expect(m.labels!(Uint32Array.of(1), new Set([0x100000000]))).rejects.toThrow(
      'labels(): parameter "seen" (Set<u32>): the key 4294967296 is not a u32.',
    );
    const signed = new Set([-0x80000000, 0x7fffffff]);
    await expect(m.signed!(Int32Array.of(1), signed)).resolves.toBe(3);
    await expect(m.signed!(Int32Array.of(1), new Set([0x80000000]))).rejects.toThrow(
      'signed(): parameter "seen" (Set<i32>): the key 2147483648 is not a i32.',
    );
  });

  it('takes NaN and the f32 values as f32 keys, and refuses a number no f32 holds', async () => {
    const m = await load(SETS);
    await expect(m.floats!(Float32Array.of(1), new Set([NaN, 0.5]))).resolves.toBe(3);
    await expect(m.floats!(Float32Array.of(1), new Set([0.1]))).rejects.toThrow(
      'floats(): parameter "seen" (Set<f32>): the key 0.1 is not a f32.',
    );
  });
});

const owner = (limit: number | undefined): CallOwner =>
  ({
    label: 'test',
    tiers: () => ['webgpu'],
    device: () =>
      Promise.resolve(
        limit === undefined ? {} : { limits: { maxStorageBuffersPerShaderStage: limit } },
      ),
    fp64Flavor: () => 'float',
    subgroupFolds: () => false,
  }) as unknown as CallOwner;

const call = (k: KernelFace, held: CheckedCall['held'] = []): CheckedCall =>
  ({
    hosts: k.params.map(() => undefined),
    ranges: [],
    held: k.params.map((_, i) => held[i]),
  }) as unknown as CheckedCall;

const TIERS = `"use typeshade";
export function sumInto(xs: array<f32>, sums: array<f32>) {
  let s = 0.;
  for (let i: u32 = 0; i < xs.length; i++) {
    s += xs[i];
  }
  sums[0] = s;
}
export function gather(count: array<u32>, list: array<u32>, xs: array<f32>, out: array<f32>): void {
  const n: u32 = count[0];
  for (let j: u32 = 0; j < n; j++) {
    out[j] = xs[list[j]];
  }
}
export function plain(xs: array<f32>, out: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = xs[i];
  }
}
`;

async function boundary(k: KernelFace): Promise<{ enough: number; message: string }> {
  let message = '';
  for (let limit = 1; limit <= 32; limit++) {
    const fit = await tierFit(k, call(k), owner(limit), 'webgpu');
    if (fit.why === undefined) return { enough: limit, message };
    message = fit.why;
  }
  throw new Error('no limit fits');
}

describe('the storage buffers a device allows a stage', () => {
  const { kernels } = faces(TIERS);

  it('refuses the stores after the loops one buffer below what they bind, and runs them at it', async () => {
    const { enough, message } = await boundary(kernels.get('sumInto')!);
    expect(message).toBe(
      `its stores after the loops bind ${enough} storage buffers, and the device allows ${enough - 1}`,
    );
  });

  it('refuses a range the device holds one buffer below what its entries bind, and runs it at it', async () => {
    const { enough, message } = await boundary(kernels.get('gather')!);
    expect(message).toMatch(
      new RegExp(
        `^loop 1 reads its trip count from an array, and its entries bind ${enough} storage buffers, which the device allows ${enough - 1}$`,
      ),
    );
  });

  it('takes the default limit of a device that reports none', async () => {
    const k = kernels.get('plain')!;
    expect((await tierFit(k, call(k), owner(undefined), 'webgpu')).why).toBeUndefined();
    const s = kernels.get('sumInto')!;
    expect((await tierFit(s, call(s), owner(undefined), 'webgpu')).why).toBeUndefined();
  });

  it('sends a held length of an array with no length word to the CPU tier', async () => {
    const k = kernels.get('plain')!;
    const held = [undefined, { state: {}, offset: 0 }] as unknown as CheckedCall['held'];
    expect((await tierFit(k, call(k, held), owner(8), 'webgpu')).why).toBe(
      'its pushes onto "out" start after a held length only on the CPU tier',
    );
  });
});

const PUSHES = `"use typeshade";
export function two(xs: array<f32>, a: array<u32>, b: array<u32>): void {
  for (let i: u32 = 0; i < xs.length; i++) {
    a.push(i);
    b.push(i);
  }
}
export function read(xs: array<f32>, out: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = xs[i];
  }
}
class Pair {
  x: f32;
  y: f32;
}
export function sumXs(xs: array<Pair>, out: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = xs[i].x;
  }
}
export function other(xs: array<f32>, out: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = xs[i] + 1.;
  }
}
`;

describe('the calls of a program that holds lengths', () => {
  it('refuses one length Buffer held for two arrays', async () => {
    const m = await load(PUSHES);
    const count = array(new Uint32Array(1));
    expect(() =>
      (m.two as unknown as (...a: unknown[]) => unknown)(
        Float32Array.of(1, 2),
        { array: new Uint32Array(4), length: count },
        { array: new Uint32Array(4), length: count },
      ),
    ).toThrow(new TypeError('two(): "b.length" is the same Buffer as "a.length".'));
  });

  it('writes back only the arrays the function writes', async () => {
    const m = await load(PUSHES);
    const xs = [Object.freeze({ x: 1, y: 2 }), Object.freeze({ x: 3, y: 4 })];
    const out = new Float32Array(2);
    await m.sumXs!(xs, out);
    expect([...out]).toEqual([1, 3]);
  });

  it('throws the failure of a call nobody awaited at the next call, once', async () => {
    const m = await load(PUSHES);
    const rt = (await import(pathToFileURL(RUNTIME).href)) as typeof import('./host-runtime.js');
    const call = (name: string, ...a: unknown[]): Promise<void> | unknown =>
      (m[name] as unknown as (...a: unknown[]) => unknown)(...a);
    try {
      rt.configure({ prefer: ['webgpu'] });
      call('read', array(Float32Array.of(1, 2)), array(new Float32Array(2)));
      for (let i = 0; i < 50 && !failurePending(); i++) await new Promise((r) => setTimeout(r, 0));
      expect(failurePending()).toBe(true);
      await expect(call('other', Float32Array.of(1, 2), new Float32Array(2))).rejects.toThrow(
        /^read\(\): no tier it may use can run it/,
      );
      expect(failurePending()).toBe(false);
      await expect(call('other', Float32Array.of(1, 2), new Float32Array(2))).rejects.toThrow(
        /^other\(\): no tier/,
      );
    } finally {
      rt.configure({});
    }
  });
});
