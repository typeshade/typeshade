// Verifies: Rule 8.21 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.22 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { hostFace } from './host-face.js';
import { bothTake } from '../../core/testing/both-halves.js';
import { tscDiagnostics } from '../../core/testing/tsc-diagnostics.js';
import type { KernelFace } from '../../core/host-kernel.js';
import { array } from '../../runtime.js';
import { fuse } from '../../fuse.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tempDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'typeshade-made-'));
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

const MADE = `${HEIGHT}export function render(k: vec4, size: u32): f32[] {
  const out = new Float32Array(size * size);
  for (let i: u32 = 0; i < size * size; i++) {
    const p = vec2(f32(i % size), f32(i / size)) / f32(size);
    out[i] = height(p, k);
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

const FORMS = `"use typeshade";
const K = 3;
export function ones(n: i32, v: u32): u32[] {
  const half = n / 2;
  const out = new Array(half + 1).fill(v + 1);
  return out;
}
export function minus(n: u32): i32[] {
  const out = new Array(n).fill(-1);
  for (let i: u32 = 0; i < n; i++) {
    out[i] = out[i] + i32(i);
  }
  return out;
}
export function measured(xs: f32[], v: vec2u): f32[] {
  const out = new Float32Array(min(xs.length, v.y) + K);
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = f32(i) * 0.5;
  }
  return out;
}
export function scaled(s: f32): f32[] {
  const out = new Float32Array(s * 2.);
  return out;
}
export function short(size: u32): f32[] {
  const out = new Float32Array(size);
  for (let i: u32 = 0; i < size * 2; i++) {
    out[i] = 1.;
  }
  return out;
}
export function counted(n: u32, xs: u32[]): f32[] {
  const out = new Float32Array(n);
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] = out.length + i;
  }
  return out;
}
export function held(xs: u32[]): f32[] {
  const out = new Float32Array(xs.length);
  for (let i: u32 = 0; i < xs[0]; i++) {
    out[i] = 1.;
  }
  return out;
}
`;

const typeAfterName = (hover: string | undefined): string | undefined =>
  /\bout: ([^\n`]+)/.exec(hover ?? '')?.[1];

describe('a kernel function that makes the array it returns (change 0114, S5)', () => {
  it('is taken by both halves, and out hovers as the parameter form does', () => {
    const made = bothTake(MADE);
    const parameter = bothTake(PARAMETER);
    expect(typeAfterName(made.hover('out = new'))).toBe('array<f32>');
    expect(typeAfterName(made.hover('out = new'))).toBe(
      typeAfterName(parameter.hover('out: f32[]')),
    );
    expect(made.hover('render(k')).toContain(
      'function render(k: vec4<f32>, size: u32): array<f32>',
    );
  });

  it('takes the other forms of slice 1 in both halves', () => {
    bothTake(FORMS);
  });

  it('writes no WebGL2 program and no fusion facts, and names the array in the face', () => {
    const f = face(MADE);
    const render = f.exports.find((e) => e.name === 'render') as { face: KernelFace };
    expect(render.face.gl).toBeUndefined();
    expect(render.face.fuse).toBeUndefined();
    expect(render.face.noWebgl2).toContain('which the WebGL2 tier does not support yet');
    expect(render.face.gpu?.loops.length).toBe(1);
    expect((render.face as unknown as { made: unknown }).made).toEqual({
      param: 'out',
      count: 'out_length',
      shown: 'out',
      array: 'f32',
      length: 'render__length',
      reads: ['size'],
    });
  });

  it('returns a Float32Array of size * size with the values of the parameter form on the CPU tier', async () => {
    const made = await load(MADE);
    const parameter = await load(PARAMETER);
    const k = [1, 0.5, 2, 0.25];
    const img = await made['render']!(k, 8);
    expect(img).toBeInstanceOf(Float32Array);
    expect((img as Float32Array).length).toBe(64);
    const want = new Float32Array(64);
    await parameter['render']!(k, 8, want);
    expect([...(img as Float32Array)]).toEqual([...want]);
    const loop = Array.from({ length: 64 }, (_, i) => {
      const [x, y] = [(i % 8) / 8, Math.floor(i / 8) / 8];
      return k[0]! * Math.sin(x * k[1]!) + k[2]! * Math.cos(y * k[3]!);
    });
    (img as Float32Array).forEach((v, i) => expect(Math.abs(v - loop[i]!)).toBeLessThan(1e-5));
  });

  it('fills, measures and counts as JavaScript does', async () => {
    const m = await load(FORMS);
    expect([...((await m['ones']!(5, 6)) as Uint32Array)]).toEqual([7, 7, 7]);
    expect(await m['ones']!(5, 6)).toBeInstanceOf(Uint32Array);
    expect([...((await m['minus']!(3)) as Int32Array)]).toEqual([-1, 0, 1]);
    const measured = await m['measured']!(new Float32Array(5), [9, 2]);
    expect([...(measured as Float32Array)]).toEqual([0, 0.5, 1, 1.5, 2]);
    expect([...((await m['scaled']!(1.5)) as Float32Array)]).toEqual([0, 0, 0]);
    expect([...((await m['held']!(new Uint32Array([10, 0]))) as Float32Array)]).toEqual([1, 1]);
  });

  it('gives an empty array for a length of 0', async () => {
    const m = await load(FORMS);
    const empty = await m['scaled']!(0);
    expect(empty).toBeInstanceOf(Float32Array);
    expect((empty as Float32Array).length).toBe(0);
  });

  it('reads n as out.length in the body, 0 included', async () => {
    const m = await load(FORMS);
    const seen = new Uint32Array(2);
    expect((await m['counted']!(0, seen)) as Float32Array).toHaveLength(0);
    expect([...seen]).toEqual([0, 1]);
    expect((await m['counted']!(5, seen)) as Float32Array).toHaveLength(5);
    expect([...seen]).toEqual([5, 6]);
    const counted = face(FORMS).exports.find((e) => e.name === 'counted') as {
      face: KernelFace;
    };
    expect(counted.face.gpu?.wgsl).not.toContain('arrayLength(&out)');
  });

  it('throws a RangeError for a negative or fractional length, before anything runs', async () => {
    const m = await load(FORMS);
    await expect(m['ones']!(-4, 1)).rejects.toThrow(
      new RangeError(
        'ones(): the array it returns, "out", would have length -1, and JavaScript throws a RangeError for it: a length is a whole number of 0 or more.',
      ),
    );
    await expect(m['scaled']!(1.25)).rejects.toThrow(RangeError);
  });

  it('checks the writes of a loop against the length before anything runs', async () => {
    const m = await load(FORMS);
    await expect(m['short']!(3)).rejects.toThrow(
      new TypeError(
        'short(): the array it returns, "out", holds 3 elements, and loop 1 writes it at indices 0 to 5.',
      ),
    );
    const held = face(FORMS).exports.find((e) => e.name === 'held') as { face: KernelFace };
    expect(held.face.gpu?.loops[0]?.device).toBeDefined();
  });

  it('counts its arguments without the array it makes', async () => {
    const m = await load(MADE);
    await expect(m['render']!([1, 1, 1, 1])).rejects.toThrow(
      new TypeError('render() takes 2 arguments; got 1.'),
    );
  });

  it('returns a Buffer on a resource, and refuses a call inside fuse() as not supported yet', async () => {
    const m = await load(FORMS);
    const xs = array(new Float32Array(4));
    const made = m['measured']!(xs, [1, 1]) as unknown as ReturnType<typeof array>;
    expect([...((await made.read()) as Float32Array)]).toEqual([0, 0.5, 1, 1.5]);
    made.dispose();
    xs.dispose();
    let inside: unknown;
    await fuse(() => {
      try {
        void m['scaled']!(2);
      } catch (e) {
        inside = e;
      }
    });
    expect(inside).toEqual(
      new TypeError(
        'scaled(): returns the array it makes, "out", and a call inside fuse() that makes its result is not supported yet. Call scaled() outside fuse().',
      ),
    );
  });
});

describe('the host view of a kernel function that makes its result, under tsc', () => {
  it('returns Promise<Float32Array>, or a Buffer<f32> on a resource, and takes no array for it', async () => {
    const f = face(MADE);
    expect(f.view).toContain(
      'export declare function render(k: vec4, size: u32): Promise<Float32Array>;',
    );
    expect(f.view).toContain(
      'export declare function render(k: vec4 | Buffer<vec4>, size: u32): Buffer<f32>;',
    );
    expect(f.view.match(/export declare function render\(/g)?.length).toBe(2);
    const dir = tempDir();
    writeFileSync(join(dir, 'm.shade.ts'), MADE);
    writeFileSync(join(dir, 'm.shade.typeshade.ts'), f.view);
    const app = join(dir, 'app.ts');
    writeFileSync(
      app,
      `import { render } from './m.shade.ts';\nimport type { Buffer, f32, vec4 } from '${RUNTIME}';\nconst k = [1, 0.5, 2, 0.25] as const;\nconst img: Float32Array = await render(k, 512);\nawait render(k, 512, img);\ndeclare const kb: Buffer<vec4>;\nconst made: Buffer<f32> = render(kb, 512);\nexport { made };\n`,
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
    expect(tsc.map((d) => `${d.line}: TS${d.code}`)).toEqual(['5: TS2554']);
  });
});
