// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.25 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 7.6 (docs/language-design.md; traced in reqs/).
//
// A kernel function's array parameter, written in place (change 0142, which removed `@out` and its
// zero fill): the call writes the caller's array, an element the body did not write keeps its value,
// and an array the body never writes comes back as it went in, as JavaScript does. Read by both
// halves (`compile()` and the language service), by the face, by the call on the CPU tier with plain
// arrays and with a `Buffer`, and by the host view under `tsc`. The WebGPU and WebGL2 tiers are
// read by `journeys/_host-import`, which runs the same kernels on a device (`bun run
// gate:journeys`).

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { hostFace } from './host-face.js';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import type { KernelFace } from '../../core/host-kernel.js';
import { tscDiagnostics } from '../../core/testing/tsc-diagnostics.js';
import { array } from '../../runtime.js';

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

type Call = (...a: unknown[]) => Promise<unknown>;

async function load(source: string): Promise<Record<string, Call>> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-kernel-out-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, face(source).code);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, Call>;
}

const SOURCE = `"use typeshade";
export function ramp(xs: array<f32>, k: f32): void {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] = xs[i] + k * f32(i);
  }
}
export function untouched(xs: array<f32>, k: f32): void {
  let s: f32 = k;
  s += 1.;
}
export function head(xs: array<f32>): void {
  for (let i: u32 = 0; i < 2; i++) {
    xs[i] = 1.;
  }
}
export function bump(xs: array<f32>, k: f32): void {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] = xs[i] + k;
  }
}
export function shift(vs: array<vec2f>): void {
  for (let i: u32 = 0; i < vs.length; i++) {
    vs[i] = vs[i] + vec2f(1., 2.);
  }
}
export function fillWith(xs: array<u32>): void {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] = xs[i] + 7;
  }
}
export function grow(xs: array<f32>, list: array<u32>): void {
  for (let i: u32 = 0; i < list.length; i++) {
    list[i] = i;
  }
}
`;

const kernelOf = (f: ReturnType<typeof face>, name: string): KernelFace => {
  const e = f.exports.find((x) => x.name === name);
  expect(e?.kind).toBe('kernel');
  return (e as { face: KernelFace }).face;
};

describe("a kernel function's array, read by both halves (change 0142)", () => {
  it('compiles with no diagnostic, and the editor gives none', () => {
    expect(compile(SOURCE, { fileName: 'm.shade.ts' }).diagnostics).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', SOURCE);
    expect(service.getDiagnostics('m.shade.ts')).toEqual([]);
  });

  it('writes the parameter back only when the body writes it, and marks none out', () => {
    const f = face(SOURCE);
    expect(kernelOf(f, 'ramp').params[0]).toMatchObject({ k: 'array', writes: true });
    expect(kernelOf(f, 'untouched').params[0]).toMatchObject({ k: 'array', writes: false });
    expect(kernelOf(f, 'bump').params[0]).toMatchObject({ k: 'array', writes: true });
    for (const name of ['ramp', 'untouched', 'bump'])
      expect(kernelOf(f, name).params[0]).not.toHaveProperty('out');
  });
});

describe("a fixed-size array of a helper is the caller's array, and nothing is zeroed (Rule 8.25)", () => {
  const READS = `"use typeshade";
function h(a: array<f32, 4>): void { a[1] = a[0] + 1.; }
function none(a: array<f32, 4>): void { }
export function f(ys: array<f32>): void {
  let a: array<f32, 4> = [5., 5., 5., 5.];
  h(a);
  ys[0] = a[1];
  ys[1] = a[0];
  let b: array<f32, 4> = [5., 5., 5., 5.];
  none(b);
  ys[2] = b[3];
}
`;
  it('gives no diagnostic in the compiler and none in the editor', () => {
    expect(
      compile(READS, { fileName: 'm.shade.ts' }).diagnostics.filter((d) => d.category === 'error'),
    ).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', READS);
    expect(service.getDiagnostics('m.shade.ts').filter((d) => d.severity === 'error')).toEqual([]);
  });
  it('reads the values the caller holds on the CPU tier', async () => {
    const m = await load(READS);
    const ys = new Float32Array(3).fill(9);
    await m.f!(ys);
    expect([...ys]).toEqual([6, 5, 5]);
  });
  it('writes no zeros at the start of the helper in the WGSL', () => {
    const out = compile(
      `"use typeshade";
declare const dst: storage<array<f32>, "read_write">;
function h(a: array<f32, 4>): void { a[1] = a[0] + 1.; }
@compute([1]) export function main(): void {
  let a: array<f32, 4> = [5., 5., 5., 5.];
  h(a);
  dst[0] = a[1];
}
`,
      { fileName: 'm.shade.ts' },
    );
    expect(out.diagnostics).toEqual([]);
    expect(out.wgsl).toContain('fn h(a: ptr<function, array<f32, 4>>) {');
    expect(out.wgsl).not.toContain('(*a) = array<f32, 4>(0.0, 0.0, 0.0, 0.0);');
  });
});

describe("the call of a kernel function on the CPU tier writes the caller's array in place", () => {
  it('reads the values the caller held, so the body adds to them', async () => {
    const m = await load(SOURCE);
    const xs = new Float32Array(4).fill(9);
    await m.ramp!(xs, 2);
    expect([...xs]).toEqual([9, 11, 13, 15]);
  });

  it('comes back as it went in when the body never writes it', async () => {
    const m = await load(SOURCE);
    const xs = new Float32Array(4).fill(9);
    await m.untouched!(xs, 2);
    expect([...xs]).toEqual([9, 9, 9, 9]);
  });

  it('keeps the value of an element the body did not write', async () => {
    const m = await load(SOURCE);
    const xs = new Float32Array(5).fill(9);
    await m.head!(xs);
    expect([...xs]).toEqual([1, 1, 9, 9, 9]);
  });

  it('writes a whole array of vectors, and an unsigned array', async () => {
    const m = await load(SOURCE);
    const vs = new Float32Array(6).fill(5);
    await m.shift!(vs);
    expect([...vs]).toEqual([6, 7, 6, 7, 6, 7]);
    const us = new Uint32Array(3).fill(5);
    await m.fillWith!(us);
    expect([...us]).toEqual([12, 12, 12]);
  });

  it('keeps the caller’s values under a body that adds to them', async () => {
    const m = await load(SOURCE);
    const xs = Float32Array.of(1, 2, 3);
    await m.bump!(xs, 10);
    expect([...xs]).toEqual([11, 12, 13]);
  });

  it('writes a Buffer, and the host reads what the body left', async () => {
    const m = await load(SOURCE);
    const buffer = array(new Float32Array(4).fill(9));
    await m.ramp!(buffer, 2);
    expect([...((await buffer.read()) as Float32Array)]).toEqual([9, 11, 13, 15]);
    const again = array(new Float32Array(3).fill(9));
    await m.untouched!(again, 1);
    expect([...((await again.read()) as Float32Array)]).toEqual([9, 9, 9]);
    // A second call starts from what the first left.
    await m.ramp!(buffer, 1);
    expect([...((await buffer.read()) as Float32Array)]).toEqual([9, 12, 15, 18]);
  });

  it('writes a Buffer made of a number[], whose element is open, and a Buffer of vectors', async () => {
    const m = await load(SOURCE);
    const open = array([9, 9, 9, 9]);
    await m.ramp!(open, 2);
    expect(Array.from((await open.read()) as ArrayLike<number>)).toEqual([9, 11, 13, 15]);
    const unwritten = array([9, 9, 9]);
    await m.untouched!(unwritten, 1);
    expect(Array.from((await unwritten.read()) as ArrayLike<number>)).toEqual([9, 9, 9]);
    const vs = array(new Float32Array(6).fill(9));
    await m.shift!(vs);
    expect(Array.from((await vs.read()) as ArrayLike<number>).slice(0, 2)).toEqual([10, 11]);
  });

  it('writes a Buffer of a device, in a plan, after the call that wrote it', async () => {
    const { createDevice } = await import('../../runtime/device.js');
    const m = await load(SOURCE);
    const dev = await createDevice({ prefer: ['cpu'] });
    const xs = dev.array(new Float32Array(4).fill(9));
    await dev.fuse(() => {
      void m.bump!(xs, 1);
      void m.ramp!(xs, 3);
    });
    expect([...((await xs.read()) as Float32Array)]).toEqual([10, 13, 16, 19]);
    await dev.dispose();
  });
});

describe('a held length on an array no loop pushes onto (change 0094, change 0142)', () => {
  it('is refused at the call with a TypeError', async () => {
    const m = await load(SOURCE);
    const list = new Uint32Array(8);
    const length = array(new Uint32Array([0]));
    // A held length is a Buffer, so the call is one on a resource and throws at the call.
    await expect(
      Promise.resolve().then(() => m.grow!(Float32Array.of(1, 2), { array: list, length })),
    ).rejects.toThrow(
      new TypeError(
        'grow(): parameter "list" is an array no loop pushes onto, so it takes no { array, length, offset? }. Pass the array itself.',
      ),
    );
  });
});

describe('the host view of an array no loop pushes onto, under tsc (change 0142)', () => {
  it('takes the array and a Buffer, and no { array, length, offset? }', async () => {
    const f = face(SOURCE);
    expect(f.view).toContain(
      'export declare function grow(xs: Float32Array, list: Uint32Array): Promise<void>;',
    );
    expect(f.view).not.toMatch(/grow\([^)]*length: Buffer<u32>/);
    const dir = mkdtempSync(join(tmpdir(), 'typeshade-kernel-out-view-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'm.shade.ts'), SOURCE);
    writeFileSync(join(dir, 'm.shade.typeshade.ts'), f.view);
    const options: ts.CompilerOptions = {
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
      moduleSuffixes: ['.typeshade', ''],
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
      types: [],
    };
    const calls = [
      ['grow(xs, list);', []],
      ['grow(xs, { array: list, length: count });', ['TS2769']],
      ['ramp(xs, 1);', []],
    ] as const;
    const head = `import { grow, ramp } from './m.shade.ts';\nimport { array } from ${JSON.stringify(resolve(__dirname, '../../runtime.ts'))};\nconst xs = new Float32Array(4);\nconst list = new Uint32Array(8);\nconst count = array(new Uint32Array(2));\n`;
    const text = `${head}${calls.map(([call]) => call).join('\n')}\nexport {};\n`;
    const first = head.split('\n').length;
    const app = join(dir, 'app.ts');
    writeFileSync(app, text);
    const tsc = await tscDiagnostics([app], options);
    expect(tsc.filter((d) => d.fileName !== app)).toEqual([]);
    const byLine = calls.map(
      ([call], i) =>
        `${call}: ${tsc
          .filter((d) => d.line === first + i)
          .map((d) => `TS${d.code}`)
          .join(' ')}`,
    );
    expect(byLine).toEqual(calls.map(([call, codes]) => `${call}: ${codes.join(' ')}`));
  });
});
