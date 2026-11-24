// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from './host-face.js';
import { bothTake } from '../../core/testing/both-halves.js';
import { warningsOf } from './growing-load.js';
import { madeOf } from '../../core/kernel-made-face.js';
import type { HostExport } from './host-face-contracts.js';
import type { KernelFace } from '../../core/host-kernel.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

type Call = (...a: unknown[]) => Promise<unknown>;

const SOURCE = `"use typeshade";
export function pairs(xs: f32[], r: f32): u32[] {
  const out: u32[] = [];
  for (let i: u32 = 0; i < xs.length; i++) {
    for (let j: u32 = i + 1; j < xs.length; j++) {
      if (abs(xs[i] - xs[j]) < r) {
        out.push(i);
        out.push(j);
      }
    }
  }
  return out;
}
export function twice(xs: f32[], r: f32): u32[] {
  const out: u32[] = [];
  for (let i: u32 = 0; i < xs.length; i++) {
    for (let j: u32 = i + 1; j < xs.length; j++) {
      if (xs[i] + xs[j] < r) {
        out.push(i);
      }
    }
  }
  for (let i: u32 = 0; i < xs.length; i++) {
    for (let j: u32 = i; j < xs.length; j++) {
      for (let q: u32 = j; q < xs.length; q++) {
        out.push(q);
      }
    }
  }
  return out;
}
`;

function faceOf(exports: readonly HostExport[], name: string): KernelFace {
  return (exports.find((e) => e.name === name) as { face: KernelFace }).face;
}

function faces(): Map<string, KernelFace> {
  const f = hostFace(SOURCE, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const all = new Map<string, KernelFace>();
  for (const e of f.exports ?? []) if ('face' in e) all.set(e.name, e.face as KernelFace);
  return all;
}

async function load(): Promise<Record<string, Call>> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-counted-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, hostFace(SOURCE, { fileName: '/app/m.shade.ts', runtime: RUNTIME }).code!);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, Call>;
}

const f32 = Math.fround;

function pairsOracle(xs: number[], r: number): number[] {
  const out: number[] = [];
  const a = xs.map(f32);
  for (let i = 0; i < a.length; i++)
    for (let j = i + 1; j < a.length; j++)
      if (Math.abs(f32(a[i]! - a[j]!)) < f32(r)) out.push(i, j);
  return out;
}

function twiceOracle(xs: number[], r: number): number[] {
  const out: number[] = [];
  const a = xs.map(f32);
  for (let i = 0; i < a.length; i++)
    for (let j = i + 1; j < a.length; j++) if (f32(a[i]! + a[j]!) < f32(r)) out.push(i);
  for (let i = 0; i < a.length; i++)
    for (let j = i; j < a.length; j++) for (let q = j; q < a.length; q++) out.push(q);
  return out;
}

const grows = (body: string, params = 'xs: f32[]'): string =>
  `"use typeshade";\nexport function f(${params}): f32[] { const out: f32[] = []; ${body} return out; }`;

describe('a push in a loop whose start reads the outer counter, Route 2 (change 0114, A12 form 2)', () => {
  it('is a program both halves take, with the hover of the parameter form', () => {
    const halves = bothTake(SOURCE);
    expect(halves.hover('out: u32[] = []')).toBeDefined();
  });

  it('gives the face a count pass and a GPU plan whose count and scan saturate', () => {
    const k = faces();
    const sat = /min\(\w+, \(?4294967295u - \w+\)?\)/;
    for (const name of ['pairs', 'twice']) {
      expect(madeOf(k.get(name)!)).toMatchObject({ counted: true, grown: true });
      expect(madeOf(k.get(name)!)!.capacity).toBeUndefined();
      expect(k.get(name)).not.toHaveProperty('noGpu');
      const wgsl = k.get(name)!.gpu!.wgsl;
      expect(wgsl).toMatch(sat);
      expect(wgsl.match(/4294967295u/g)!.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('keeps the WGSL of a push into an array the caller passes free of saturating adds', () => {
    const f = hostFace(
      `"use typeshade";\nexport function g(xs: f32[], out: u32[]): u32 { for (let i: u32 = 0; i < xs.length; i++) { if (xs[i] > 0) out.push(i); } return out.length; }`,
      { fileName: '/app/m.shade.ts', runtime: RUNTIME },
    );
    const g = faceOf(f.exports ?? [], 'g');
    expect(g.gpu!.wgsl).not.toContain('4294967295u');
  });

  it('gives the elements and the order of a JavaScript loop, for each input', async () => {
    const { pairs, twice } = await load();
    const inputs: [number[], number][] = [
      [[3], 1],
      [[1, 5, 9], 0.5],
      [[1, 1, 1, 1], 1],
      [[1, 2, 3, 4, 5], 1],
      [[0, 0.5, 1, Number.NaN, 1.5], 0.6],
      [[1, 2, 3, 4, 5, 6, 7], 2.5],
    ];
    for (const [xs, r] of inputs) {
      const got = [...((await pairs(new Float32Array(xs), r)) as Uint32Array)];
      expect(got).toEqual(pairsOracle(xs, r));
      const twin = [...((await twice(new Float32Array(xs), r)) as Uint32Array)];
      expect(twin).toEqual(twiceOracle(xs, r));
    }
  });

  it('leaves the caller array unchanged and reads it twice', async () => {
    const { pairs } = await load();
    const xs = new Float32Array([1, 2, 3, 4]);
    await pairs(xs, 1.5);
    expect([...xs]).toEqual([1, 2, 3, 4]);
  });
});

describe('what Route 2 does not count runs on the CPU tier, in both halves (change 0114, A12 form 2, Route 3)', () => {
  const nest = (inner: string): string =>
    `for (let i: u32 = 0; i < xs.length; i++) { for (let j: u32 = i + 1; j < xs.length; j++) { ${inner} } }`;
  const unread =
    'typeshade TS8070: "for (let j: u32 = i + 1; j < xs.length; j++)" pushes onto "out", and ' +
    'its start or bound reads a value the call does not know before it runs, so this function ' +
    'runs on the CPU, where the array grows as it is pushed to.';
  const routeOf = (source: string): KernelFace => {
    const f = hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
    return faceOf(f.exports!, 'f');
  };

  it('takes a nest whose elements the proof shows in range on Route 2, and the one it cannot on Route 3', () => {
    bothTake(grows(nest('out.push(xs[i] + xs[j]);')));
    expect(madeOf(routeOf(grows(nest('out.push(xs[i] + xs[j]);'))))).toMatchObject({
      counted: true,
    });
    const source = grows(nest('out.push(xs[j + 1]);'));
    expect(warningsOf(source)).toEqual([unread]);
    expect(madeOf(routeOf(source))).toMatchObject({ growing: true });
    expect(madeOf(routeOf(source))).not.toHaveProperty('counted');
  });

  it('takes a nest that also reduces, scatters or stores, with the warnings of the proof', () => {
    for (const source of [
      grows(`let total: f32 = 0.; ${nest('total += xs[j]; out.push(total);')}`),
      grows(nest('ys[j] = 1.; out.push(1.);'), 'xs: f32[], ys: f32[]'),
    ]) {
      const warnings = warningsOf(source);
      expect(warnings.length).toBeGreaterThan(0);
      for (const w of warnings) expect(w).toContain('TS8070');
      expect(madeOf(routeOf(source))).toMatchObject({ growing: true });
    }
  });

  it('takes a push as an expression and an element of the grown array', () => {
    for (const source of [
      grows(nest('const k = out.push(1.); out.push(f32(k));')),
      grows(nest('out.push(1.);') + ' out[0] = 2.;'),
    ]) {
      expect(warningsOf(source).length).toBeGreaterThan(0);
      expect(madeOf(routeOf(source))).toMatchObject({ growing: true });
    }
  });

  it('takes a second grown array target and a store after the loops', () => {
    const source = grows(nest('out.push(1.);') + ' xs[0] = 2.;');
    expect(warningsOf(source).length).toBeGreaterThan(0);
    expect(madeOf(routeOf(source))).toMatchObject({ growing: true });
  });
});
