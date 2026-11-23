// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from './host-face.js';
import { bothHalves, bothTake } from '../../core/testing/both-halves.js';
import type { KernelFace } from '../../core/host-kernel.js';
import { madeOf } from '../../core/kernel-made-face.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

type Call = (...a: unknown[]) => Promise<unknown>;

const KEEP_SCALED = `export function keepScaled(xs: f32[], t: f32): f32[] {
  const out: f32[] = [];
  for (const x of xs) {
    if (x > t) {
      out.push(x);
    }
  }
  for (let j: u32 = 0; j < out.length; j++) {
    out[j] = out[j] / t;
  }
  return out;
}
`;

const SOURCE = `"use typeshade";
${KEEP_SCALED}export function edges(xs: f32[], t: f32): f32[] {
  const out: f32[] = [];
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] > t) {
      out.push(xs[i]);
    }
  }
  out[0] = 2.;
  out[out.length] = 9.;
  return out;
}
export function readAt(xs: f32[], t: f32, k: u32): f32[] {
  const out: f32[] = [];
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] > t) {
      out.push(xs[i]);
    }
  }
  xs[0] = 99.;
  out[k] += out[k];
  return out;
}
export function writeAt(xs: f32[], k: i32): f32[] {
  const out: f32[] = [];
  for (let i: u32 = 0; i < xs.length; i++) {
    out.push(xs[i]);
  }
  xs[0] = 99.;
  out[k] = 5.;
  return out;
}
export function last(xs: f32[]): f32[] {
  const out: f32[] = [];
  for (let i: u32 = 0; i < xs.length; i++) {
    out.push(xs[i] * 2.);
  }
  out[0] = out[out.length - 1];
  return out;
}
export function overwrite(n: u32): f32[] {
  const out: f32[] = [];
  for (let i: u32 = 0; i < n; i++) {
    out.push(1.);
    out[i] = f32(i) * 2.;
  }
  return out;
}
`;

const PARAMETER = `"use typeshade";
export function keepScaled(xs: f32[], t: f32, out: f32[]) {
  for (let j: u32 = 0; j < out.length; j++) {
    out[j] = out[j] / t;
  }
}
`;

function kernels(): Map<string, KernelFace> {
  const f = hostFace(SOURCE, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const all = new Map<string, KernelFace>();
  for (const e of f.exports ?? []) if ('face' in e) all.set(e.name, e.face as KernelFace);
  return all;
}

async function load(): Promise<Record<string, Call>> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-grown-elements-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, hostFace(SOURCE, { fileName: '/app/m.shade.ts', runtime: RUNTIME }).code!);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, Call>;
}

const f32s = (xs: readonly number[]): number[] => xs.map((x) => Math.fround(x));
const kept = (xs: readonly number[], t: number): number[] => xs.filter((x) => x > t);
const pastLength = (fn: string, text: string, verb: string, k: number, n: number): string =>
  `${fn}(): "${text}" ${verb} index ${String(k)} of "out", whose length is ${String(n)} there. ` +
  `A ${verb === 'reads' ? 'read' : 'write'} past the length is not supported yet.`;

describe('an element of the array a kernel function grows with push (change 0114, A12, form 1)', () => {
  it('is a program both halves take, and the pushing loop that writes in place warns in both', () => {
    bothTake(`"use typeshade";\n${KEEP_SCALED}`);
    const halves = bothHalves(SOURCE);
    expect(halves.compiler).toEqual([]);
    expect(halves.editor).toEqual(
      halves.result.diagnostics
        .filter((d) => d.category === 'warning')
        .map((d) => `typeshade ${d.code}: ${d.message}`),
    );
    expect(halves.editor.join('\n')).toContain('TS8070');
  });

  it('shows the same type text on hover as the parameter form', () => {
    const typeOf = (hover: string | undefined): string | undefined =>
      hover?.match(/out: ([^\n]*)/)?.[1];
    const grown = typeOf(bothTake(`"use typeshade";\n${KEEP_SCALED}`).hover('out[j] ='));
    expect(grown).toBe('array<f32>');
    expect(typeOf(bothTake(PARAMETER).hover('out[j] ='))).toBe(grown);
  });

  it('keeps a GPU plan where every access is proved below the length', () => {
    const k = kernels();
    expect(k.get('keepScaled')!.noGpu).toBeUndefined();
    expect(k.get('keepScaled')!.gpu).toBeDefined();
    expect(madeOf(k.get('keepScaled')!)!.checks).toBeUndefined();
  });

  it('has no GPU plan where an access is not proved, and its reason names the access', () => {
    const k = kernels();
    for (const [fn, verb, text] of [
      ['edges', 'writes', 'out[0]'],
      ['readAt', 'reads', 'out[k]'],
      ['writeAt', 'writes', 'out[k]'],
      ['last', 'writes', 'out[0]'],
      ['overwrite', 'writes', 'out[i]'],
    ] as const) {
      const face = k.get(fn)!;
      expect(face.gpu).toBeUndefined();
      expect(face.gl).toBeUndefined();
      expect(face.noGpu).toBe(
        `it ${verb} "${text}", an element of "out" at an index the compiler cannot prove is ` +
          `below its length, and only the CPU tier checks such an index at the call`,
      );
    }
  });

  it('counts each write it cannot prove below the length as one push', () => {
    const k = kernels();
    expect(madeOf(k.get('edges')!)!.capacity?.map((t) => t.pushes)).toEqual([2, 1]);
    expect(madeOf(k.get('overwrite')!)!.capacity?.map((t) => t.pushes)).toEqual([2]);
    expect(madeOf(k.get('readAt')!)!.capacity?.map((t) => t.pushes)).toEqual([1]);
  });

  it('runs each access as JavaScript runs it on the CPU tier', async () => {
    const m = await load();
    const xs = [1, 5, 3, 7];
    expect([...((await m['keepScaled']!(new Float32Array(xs), 2)) as Float32Array)]).toEqual(
      f32s(kept(xs, 2).map((x) => x / 2)),
    );
    expect([...((await m['keepScaled']!(new Float32Array(xs), 9)) as Float32Array)]).toEqual([]);
    const edges = (t: number): number[] => {
      const out = kept(xs, t);
      out[0] = 2;
      out[out.length] = 9;
      return out;
    };
    expect([...((await m['edges']!(new Float32Array(xs), 2)) as Float32Array)]).toEqual(edges(2));
    expect([...((await m['edges']!(new Float32Array(xs), 9)) as Float32Array)]).toEqual(edges(9));
    const readAt = kept(xs, 2);
    readAt[1]! += readAt[1]!;
    expect([...((await m['readAt']!(new Float32Array(xs), 2, 1)) as Float32Array)]).toEqual(readAt);
    expect([...((await m['writeAt']!(new Float32Array([1, 2]), 2)) as Float32Array)]).toEqual([
      1, 2, 5,
    ]);
    expect([...((await m['writeAt']!(new Float32Array([1, 2]), 0)) as Float32Array)]).toEqual([
      5, 2,
    ]);
    expect([...((await m['last']!(new Float32Array([1, 2, 3]))) as Float32Array)]).toEqual([
      6, 4, 6,
    ]);
    expect([...((await m['overwrite']!(3)) as Float32Array)]).toEqual([0, 2, 4]);
    expect([...((await m['overwrite']!(0)) as Float32Array)]).toEqual([]);
  });

  it('throws a RangeError for an index past the length, and leaves the caller arrays unchanged', async () => {
    const m = await load();
    const xs = new Float32Array([1, 5, 3, 7]);
    await expect(m['readAt']!(xs, 2, 3)).rejects.toThrow(
      new RangeError(pastLength('readAt', 'out[k]', 'reads', 3, 3)),
    );
    expect([...xs]).toEqual([1, 5, 3, 7]);
    const two = new Float32Array([1, 2]);
    await expect(m['writeAt']!(two, 3)).rejects.toThrow(
      new RangeError(pastLength('writeAt', 'out[k]', 'writes', 3, 2)),
    );
    await expect(m['writeAt']!(two, -1)).rejects.toThrow(
      new RangeError(pastLength('writeAt', 'out[k]', 'writes', -1, 2)),
    );
    expect([...two]).toEqual([1, 2]);
    await expect(m['readAt']!(xs, 9, 0)).rejects.toThrow(
      new RangeError(pastLength('readAt', 'out[k]', 'reads', 0, 0)),
    );
    expect([...xs]).toEqual([1, 5, 3, 7]);
  });
});
