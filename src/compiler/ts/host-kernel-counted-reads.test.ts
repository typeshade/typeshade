// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from './host-face.js';
import { bothRefuse, bothTake } from '../../core/testing/both-halves.js';
import { madeOf } from '../../core/kernel-made-face.js';
import type { KernelFace } from '../../core/host-kernel.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

type Call = (...a: unknown[]) => Promise<unknown>;

const REPEATED = `export function repeated(xs: f32[], counts: u32[]): f32[] {
  const out: f32[] = [];
  for (let i: u32 = 0; i < xs.length; i++) {
    for (let j: u32 = 0; j < counts[i]; j++) {
      out.push(xs[i]);
    }
  }
  return out;
}`;
const BY_N = `export function byN(counts: u32[], n: u32): u32[] {
  const out: u32[] = [];
  for (let i: u32 = 0; i < n; i++) {
    for (let j: u32 = 0; j < counts[i]; j++) {
      out.push(i);
    }
  }
  return out;
}`;
const GUARDED = `export function guarded(xs: f32[], counts: u32[]): f32[] {
  const out: f32[] = [];
  for (let i: u32 = 0; i < xs.length; i++) {
    if (i < counts.length) {
      for (let j: u32 = 0; j < counts[i]; j++) {
        out.push(xs[i]);
      }
    }
  }
  return out;
}`;
const SECOND = `export function second(xs: f32[], counts: u32[]): f32[] {
  const out: f32[] = [];
  for (let i: u32 = 0; i < xs.length; i++) {
    out.push(xs[i]);
  }
  for (let i: u32 = 0; i < xs.length; i++) {
    for (let j: u32 = 0; j < counts[i]; j++) {
      out.push(xs[i]);
    }
  }
  return out;
}`;
const SOURCE = `"use typeshade";\n${[REPEATED, BY_N, GUARDED, SECOND].join('\n')}\n`;

const faceSet = (source: string): Map<string, KernelFace> => {
  const f = hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const all = new Map<string, KernelFace>();
  for (const e of f.exports ?? []) if ('face' in e) all.set(e.name, e.face as KernelFace);
  return all;
};

async function load(source: string, wrap?: (name: string) => void): Promise<Record<string, Call>> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-counted-reads-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  const code = hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME }).code!;
  writeFileSync(file, code);
  void wrap;
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, Call>;
}

const f32 = Math.fround;
const js = (xs: number[], counts: number[], n = xs.length): number[] => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < (counts[i] ?? 0); j++) out.push(f32(xs[i]!));
  return out;
};

const wrap = (body: string, params = 'xs: f32[], counts: u32[]'): string =>
  `"use typeshade";\nexport function f(${params}): f32[] { const out: f32[] = []; ${body} return out; }`;

describe('an inner loop whose bound reads an element at the outer counter, Route 2 (change 0114, A17)', () => {
  it('is a program both halves take, with the hover of the parameter form', () => {
    const halves = bothTake(SOURCE);
    expect(halves.hover('out: f32[] = []')).toBeDefined();
  });

  it('gives the face a count pass, a GPU plan and a check of counts at the counter', () => {
    const k = faceSet(SOURCE);
    for (const name of ['repeated', 'byN', 'second']) {
      expect(madeOf(k.get(name)!)).toMatchObject({ counted: true, grown: true });
      expect(k.get(name)).not.toHaveProperty('noGpu');
      expect(madeOf(k.get(name)!)).not.toHaveProperty('growing');
      const loops = k.get(name)!.gpu!.loops;
      const checks = loops.flatMap((l) => l.checks);
      expect(checks).toContainEqual(
        expect.objectContaining({ param: 'counts', a: 1, c: 0, read: true }),
      );
    }
    expect(madeOf(k.get('guarded')!)).toMatchObject({ growing: true });
    expect(madeOf(k.get('guarded')!)).not.toHaveProperty('counted');
  });

  it('gives the elements of a JavaScript loop on the CPU tier', async () => {
    const m = await load(SOURCE);
    const xs = [1.5, 2.5, 3.5];
    expect([
      ...((await m.repeated!(new Float32Array(xs), new Uint32Array([2, 0, 1]))) as Float32Array),
    ]).toEqual(js(xs, [2, 0, 1]));
    expect([
      ...((await m.repeated!(new Float32Array(xs), new Uint32Array([0, 0, 0, 4]))) as Float32Array),
    ]).toEqual([]);
    expect([...((await m.byN!(new Uint32Array([2, 1, 3]), 2)) as Uint32Array)]).toEqual([0, 0, 1]);
    expect([
      ...((await m.guarded!(new Float32Array(xs), new Uint32Array([2]))) as Float32Array),
    ]).toEqual([1.5, 1.5]);
    expect([
      ...((await m.second!(new Float32Array(xs), new Uint32Array([2, 0, 1]))) as Float32Array),
    ]).toEqual([...xs, ...js(xs, [2, 0, 1])]);
  });

  it('refuses an array too short before anything runs, and leaves the caller arrays unchanged', async () => {
    const m = await load(SOURCE);
    const xs = new Float32Array([1, 2, 3]);
    const counts = new Uint32Array([1]);
    await expect(m.repeated!(xs, counts)).rejects.toThrow(
      new TypeError(
        'repeated(): parameter "counts" holds 1 elements, and loop 1 reads it at indices 0 to 2.',
      ),
    );
    await expect(m.second!(xs, counts)).rejects.toThrow(
      new TypeError(
        'second(): parameter "counts" holds 1 elements, and loop 2 reads it at indices 0 to 2.',
      ),
    );
    await expect(m.byN!(new Uint32Array([2, 1]), 3)).rejects.toThrow(
      new TypeError(
        'byN(): parameter "counts" holds 2 elements, and loop 1 reads it at indices 0 to 2.',
      ),
    );
    expect([...xs]).toEqual([1, 2, 3]);
    expect([...counts]).toEqual([1]);
  });
});

describe('what the new form does not take (change 0114, A17)', () => {
  const sentence = (header: string): string =>
    `"${header}" pushes onto "out", and its start or bound reads a value the call does not know ` +
    'before it runs. It reads the value parameters, their components and fields, module constants, ' +
    'the length of an array parameter, number literals, u32, i32 and f32 of these, and top-level ' +
    'consts of these, with +, -, *, /, %, min and max; any other operand is not supported yet.';
  const inner = 'for (let j: u32 = 0; j < counts[i]; j++) { out.push(xs[i]); }';
  const outer = (rest: string, bound = 'xs.length'): string =>
    `for (let i: u32 = 0; i < ${bound}; i++) { ${rest} }`;
  const innerHeader = 'for (let j: u32 = 0; j < counts[i]; j++)';

  it('refuses a read at an offset of the counter', () => {
    bothRefuse(
      wrap(outer('for (let j: u32 = 0; j < counts[i + 1]; j++) { out.push(xs[i]); }')),
      'TS8099',
      sentence('for (let j: u32 = 0; j < counts[i + 1]; j++)'),
    );
  });

  it('refuses a read at the counter of an inner loop', () => {
    bothRefuse(
      wrap(
        outer(
          `for (let j: u32 = 0; j < counts[i]; j++) { for (let q: u32 = 0; q < counts[j]; q++) { out.push(xs[i]); } }`,
        ),
      ),
      'TS8099',
      sentence(innerHeader),
    );
  });

  it('refuses a loop whose range the device holds, whatever stands before it', () => {
    bothRefuse(wrap(`let m: u32 = counts[0]; ${outer(inner)}`), 'TS8099', sentence(innerHeader));
    bothRefuse(
      wrap(outer(inner, 'counts[0]')),
      'TS8099',
      sentence('for (let i: u32 = 0; i < counts[0]; i++)'),
    );
  });

  it('refuses a function whose loops count with two types, which has no GPU plan', () => {
    const source = wrap(`${outer(inner)} for (let k: i32 = 0; k < 2; k++) { out.push(1.); }`);
    bothRefuse(source, 'TS8099', sentence(innerHeader));
  });

  it('keeps a read at a counter the loop does not bound by the array on Route 1', () => {
    const k = faceSet(
      wrap('for (let i: u32 = 0; i < n; i++) { out.push(xs[i]); }', 'xs: f32[], n: u32'),
    );
    expect(madeOf(k.get('f')!)).not.toHaveProperty('counted');
    expect(madeOf(k.get('f')!)).toHaveProperty('capacity');
  });
});
