// Verifies: Rule 8.21 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { hostFace } from './host-face.js';
import { bothHalves, bothTake } from '../../core/testing/both-halves.js';
import { tscDiagnostics } from '../../core/testing/tsc-diagnostics.js';
import type { KernelFace } from '../../core/host-kernel.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tempDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'typeshade-grown-'));
  dirs.push(d);
  return d;
};

type Call = (...a: unknown[]) => Promise<unknown>;

function face(source: string) {
  const f = hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f as Required<typeof f>;
}

async function load(source: string): Promise<Record<string, Call>> {
  const file = join(tempDir(), 'm.shade.mjs');
  writeFileSync(file, face(source).code);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, Call>;
}

const HEIGHT = `"use typeshade";
export function height(p: vec2, k: vec4): f32 {
  return k.x * sin(p.x * k.y) + k.z * cos(p.y * k.w);
}
`;

const GROWN = `${HEIGHT}export function render(k: vec4, size: u32): f32[] {
  const out: f32[] = [];
  for (let i: u32 = 0; i < size * size; i++) {
    const p = vec2(f32(i % size), f32(i / size)) / f32(size);
    if (height(p, k) > 0.) { out.push(height(p, k)); }
  }
  return out;
}
`;

const PARAMETER = `${HEIGHT}export function render(k: vec4, size: u32, out: f32[]) {
  for (let i: u32 = 0; i < size * size; i++) {
    const p = vec2(f32(i % size), f32(i / size)) / f32(size);
    out[i] = height(p, k);
  }
}
`;

const MADE = `${HEIGHT}export function render(k: vec4, size: u32): f32[] {
  const out = new Float32Array(size * size);
  for (let i: u32 = 0; i < size * size; i++) {
    out[i] = 1.;
  }
  return out;
}
`;

const FORMS = `"use typeshade";
const K = 2;
export function squares(n: u32): u32[] {
  const out: u32[] = [];
  for (let i: u32 = 0; i < n; i++) {
    out.push(i * i);
  }
  return out;
}
export function above(xs: f32[], t: f32): f32[] {
  const out: f32[] = [];
  for (const x of xs) {
    if (x > t) {
      out.push(x * 2.);
    }
  }
  return out;
}
export function twoLoops(n: u32, m: i32): i32[] {
  const out: i32[] = [];
  for (let i: u32 = 0; i < n + K; i++) {
    out.push(i32(i));
  }
  for (let j: i32 = m; j > 0; j -= 2) {
    if (j % 3 != 0) {
      out.push(-j);
    }
  }
  return out;
}
export function twice(n: u32): u32[] {
  const out: u32[] = [];
  for (let i: u32 = 0; i < n; i++) {
    out.push(i);
    out.push(i + 100);
  }
  return out;
}
export function none(n: u32): f32[] {
  const out: f32[] = [];
  return out;
}
`;

const COUNTED = `"use typeshade";
export function counted(n: u32): u32[] {
  const out: u32[] = [];
  for (let i: u32 = 0; i < n; i++) {
    out.push(out.length * 10);
  }
  return out;
}
`;

const typeAfterName = (hover: string | undefined): string | undefined =>
  /\bout: ([^\n`]+)/.exec(hover ?? '')?.[1];

describe('a kernel function that grows the array it returns with push (change 0114, S5d)', () => {
  it('is taken by both halves, and out hovers as the made and the parameter forms do', () => {
    const grown = bothTake(GROWN);
    expect(typeAfterName(grown.hover('out: f32[] = []'))).toBe('array<f32>');
    expect(typeAfterName(grown.hover('out: f32[] = []'))).toBe(
      typeAfterName(bothTake(MADE).hover('out = new')),
    );
    expect(typeAfterName(grown.hover('out: f32[] = []'))).toBe(
      typeAfterName(bothTake(PARAMETER).hover('out: f32[]')),
    );
    expect(grown.hover('render(k')).toContain(
      'function render(k: vec4<f32>, size: u32): array<f32>',
    );
  });

  it('takes a for…of loop, two loops, two pushes in one iteration and no loop in both halves', () => {
    bothTake(FORMS);
  });

  it('marks the face as grown, writes no WebGL2 program and no fusion facts, and has its loop on WebGPU', () => {
    const render = face(GROWN).exports.find((e) => e.name === 'render') as { face: KernelFace };
    expect(render.face.gl).toBeUndefined();
    expect(render.face.fuse).toBeUndefined();
    expect(render.face.gpu?.loops.length).toBe(1);
    expect((render.face as unknown as { made: unknown }).made).toEqual({
      param: 'out',
      count: 'out_length',
      shown: 'out',
      array: 'f32',
      length: 'render__length',
      grown: true,
    });
  });

  it('keeps the elements a conditional push appends, in order, on the CPU tier', async () => {
    const grown = await load(GROWN);
    const parameter = await load(PARAMETER);
    const k = [1, 3, -2, 2];
    const all = new Float32Array(64);
    await parameter['render']!(k, 8, all);
    const kept = (await grown['render']!(k, 8)) as Float32Array;
    expect(kept).toBeInstanceOf(Float32Array);
    const want = [...all].filter((v) => v > 0);
    expect(want.length).toBeGreaterThan(0);
    expect(want.length).toBeLessThan(64);
    expect([...kept]).toEqual(want);
  });

  it('appends every iteration of an unconditional push, as a JavaScript loop does', async () => {
    const m = await load(FORMS);
    const squares = (await m['squares']!(6)) as Uint32Array;
    expect(squares).toBeInstanceOf(Uint32Array);
    expect([...squares]).toEqual([0, 1, 4, 9, 16, 25]);
    const xs = new Float32Array([3, -1, 5, 0, 7]);
    const above = (await m['above']!(xs, 2)) as Float32Array;
    expect([...above]).toEqual([...xs].filter((x) => x > 2).map((x) => x * 2));
  });

  it('appends the pushes of a second loop after the first, and two pushes in statement order', async () => {
    const m = await load(FORMS);
    const two = (await m['twoLoops']!(2, 9)) as Int32Array;
    expect(two).toBeInstanceOf(Int32Array);
    const want: number[] = [];
    for (let i = 0; i < 2 + 2; i++) want.push(i);
    for (let j = 9; j > 0; j -= 2) if (j % 3 !== 0) want.push(-j);
    expect([...two]).toEqual(want);
    expect([...((await m['twice']!(3)) as Uint32Array)]).toEqual([0, 100, 1, 101, 2, 102]);
  });

  it('gives an empty array when nothing is pushed', async () => {
    const m = await load(FORMS);
    for (const empty of [await m['squares']!(0), await m['none']!(4)]) {
      expect(empty).toBeInstanceOf(empty instanceof Uint32Array ? Uint32Array : Float32Array);
      expect((empty as ArrayLike<number>).length).toBe(0);
    }
  });

  it('reads the number pushed so far as out.length in the body, and both halves say the loop runs on the CPU', async () => {
    const halves = bothHalves(COUNTED);
    const warning =
      'TS8070: This loop runs on the CPU because line 5 reads "out.length", and "out" is an ' +
      'array the loop pushes onto, whose length and elements depend on the iterations before. ' +
      'Read it after the loop.';
    expect(halves.result.diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([warning]);
    expect(halves.editor).toEqual([`typeshade ${warning}`]);
    const m = await load(COUNTED);
    expect([...((await m['counted']!(4)) as Uint32Array)]).toEqual([0, 10, 20, 30]);
  });

  it('counts its arguments without the array it grows', async () => {
    const m = await load(GROWN);
    await expect(m['render']!([1, 1, 1, 1])).rejects.toThrow(
      new TypeError('render() takes 2 arguments; got 1.'),
    );
  });

  it('runs the journey’s renderPushed and renderKept on the CPU tier as the parameter form', async () => {
    const source = readFileSync(
      new URL('../../../journeys/_host-import/src/loops.shade.ts', import.meta.url),
      'utf8',
    );
    const m = await load(source);
    const k = [1, 0.5, 2, 0.25];
    const all = new Float32Array(64 * 64);
    await m['render']!(k, 64, all);
    expect([...((await m['renderPushed']!(k, 64)) as Float32Array)]).toEqual([...all]);
    const kept = (await m['renderKept']!(k, 64)) as Float32Array;
    expect([...kept]).toEqual([...all].filter((_, i) => Math.floor(i / 64) % 3 !== 1));
  });
});

describe('the host view of a kernel function that grows its result, under tsc', () => {
  it('returns Promise<Float32Array>, takes no array for it, and says its length is what it pushes', async () => {
    const f = face(GROWN);
    expect(f.view).toContain(
      'export declare function render(k: vec4, size: u32): Promise<Float32Array>;',
    );
    expect(f.view).toContain(
      'It makes the array it returns, "out", a new Float32Array whose length is the number of elements it pushes, and the caller owns it;',
    );
    expect(f.view.match(/export declare function render\(/g)?.length).toBe(1);
    const dir = tempDir();
    writeFileSync(join(dir, 'm.shade.ts'), GROWN);
    writeFileSync(join(dir, 'm.shade.typeshade.ts'), f.view);
    const app = join(dir, 'app.ts');
    writeFileSync(
      app,
      `import { render } from './m.shade.ts';\nconst k = [1, 0.5, 2, 0.25] as const;\nconst img: Float32Array = await render(k, 512);\nawait render(k, 512, img);\nexport {};\n`,
    );
    const tsc = await tscDiagnostics([app], {
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
      moduleSuffixes: ['.typeshade', ''],
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
      types: [],
    });
    expect(tsc.map((d) => `${d.line}: TS${d.code}`)).toEqual(['4: TS2554']);
  });
});
