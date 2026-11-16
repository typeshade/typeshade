// Pins Rule 8.23 (docs/language-design.md).
// Pins Rule 8.25 (docs/language-design.md).
// Pins Rule 7.6 (docs/language-design.md).
//
// An `@out` array of a kernel function (change 0138, Amendment A15, decision 2): the call fills
// the whole argument with zeros before the body runs, so the body reads zeros whatever the caller
// held, an element the body did not write comes back zero, and an array the body never writes comes
// back all zeros. Read by both halves (`compile()` and the language service), by the face, by the
// call on the CPU tier with plain arrays and with a `Buffer`, and by the host view under `tsc`,
// which gives an `@out` array no `{ array, length, offset? }`. An `@inout` array keeps the
// caller's values. The WebGPU and WebGL2 tiers are read by `journeys/_host-import`, which runs the
// same kernels on a device (`bun run gate:journeys`).

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
export function ramp(@out xs: array<f32>, k: f32): void {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] = xs[i] + k * f32(i);
  }
}
export function untouched(@out xs: array<f32>, k: f32): void {
  let s: f32 = k;
  s += 1.;
}
export function head(@out xs: array<f32>): void {
  for (let i: u32 = 0; i < 2; i++) {
    xs[i] = 1.;
  }
}
export function bump(@inout xs: array<f32>, k: f32): void {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] = xs[i] + k;
  }
}
export function shift(@out vs: array<vec2f>): void {
  for (let i: u32 = 0; i < vs.length; i++) {
    vs[i] = vs[i] + vec2f(1., 2.);
  }
}
export function fillWith(@out xs: array<u32>): void {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] = xs[i] + 7;
  }
}
export function grow(xs: array<f32>, @out list: array<u32>): void {
  for (let i: u32 = 0; i < xs.length; i++) {
    list.push(i);
  }
}
`;

const kernelOf = (f: ReturnType<typeof face>, name: string): KernelFace => {
  const e = f.exports.find((x) => x.name === name);
  expect(e?.kind).toBe('kernel');
  return (e as { face: KernelFace }).face;
};

describe('an @out array, read by both halves (change 0138, Amendment A15)', () => {
  it('compiles with no diagnostic, and the editor gives none: no TS8075 on a read or an unwritten path', () => {
    expect(compile(SOURCE, { fileName: 'm.shade.ts' }).diagnostics).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', SOURCE);
    expect(service.getDiagnostics('m.shade.ts')).toEqual([]);
  });

  it('marks the parameter out in the face, and writes it back whether the body writes it or not', () => {
    const f = face(SOURCE);
    expect(kernelOf(f, 'ramp').params[0]).toMatchObject({ k: 'array', out: true, writes: true });
    expect(kernelOf(f, 'untouched').params[0]).toMatchObject({
      k: 'array',
      out: true,
      writes: true,
    });
    expect(kernelOf(f, 'bump').params[0]).toMatchObject({ k: 'array', writes: true });
    expect(kernelOf(f, 'bump').params[0]).not.toHaveProperty('out');
  });
});

describe('the call of an @out array on the CPU tier (Rule 8.25)', () => {
  it('fills the argument with zeros before the body runs, so the body reads zeros', async () => {
    const m = await load(SOURCE);
    const xs = new Float32Array(4).fill(9);
    await m.ramp!(xs, 2);
    expect([...xs]).toEqual([0, 2, 4, 6]);
  });

  it('comes back all zeros when the body never writes it', async () => {
    const m = await load(SOURCE);
    const xs = new Float32Array(4).fill(9);
    await m.untouched!(xs, 2);
    expect([...xs]).toEqual([0, 0, 0, 0]);
  });

  it('leaves an element the body did not write at zero', async () => {
    const m = await load(SOURCE);
    const xs = new Float32Array(5).fill(9);
    await m.head!(xs);
    expect([...xs]).toEqual([1, 1, 0, 0, 0]);
  });

  it('fills a whole array of vectors, and an unsigned array', async () => {
    const m = await load(SOURCE);
    const vs = new Float32Array(6).fill(5);
    await m.shift!(vs);
    expect([...vs]).toEqual([1, 2, 1, 2, 1, 2]);
    const us = new Uint32Array(3).fill(5);
    await m.fillWith!(us);
    expect([...us]).toEqual([7, 7, 7]);
  });

  it('keeps the caller’s values for an @inout array', async () => {
    const m = await load(SOURCE);
    const xs = Float32Array.of(1, 2, 3);
    await m.bump!(xs, 10);
    expect([...xs]).toEqual([11, 12, 13]);
  });

  it('fills a Buffer, and the host reads zeros where the body wrote none', async () => {
    const m = await load(SOURCE);
    const buffer = array(new Float32Array(4).fill(9));
    await m.ramp!(buffer, 2);
    expect([...((await buffer.read()) as Float32Array)]).toEqual([0, 2, 4, 6]);
    const again = array(new Float32Array(3).fill(9));
    await m.untouched!(again, 1);
    expect([...((await again.read()) as Float32Array)]).toEqual([0, 0, 0]);
    // A second call starts from zero again, not from what the first left.
    await m.ramp!(buffer, 1);
    expect([...((await buffer.read()) as Float32Array)]).toEqual([0, 1, 2, 3]);
  });

  it('fills a Buffer of a device, in a plan, after the call that wrote it', async () => {
    const { createDevice } = await import('../../runtime/device.js');
    const m = await load(SOURCE);
    const dev = await createDevice({ prefer: ['cpu'] });
    const xs = dev.array(new Float32Array(4).fill(9));
    await dev.fuse(() => {
      void m.bump!(xs, 1);
      void m.ramp!(xs, 3);
    });
    expect([...((await xs.read()) as Float32Array)]).toEqual([0, 3, 6, 9]);
    await dev.dispose();
  });
});

describe('a held length on an @out array (change 0138, Amendment A15, follow-up question 5)', () => {
  it('is refused at the call with a TypeError, and an array with its length is taken by @inout only', async () => {
    const m = await load(SOURCE);
    const list = new Uint32Array(8);
    const length = array(new Uint32Array([0]));
    // A held length is a Buffer, so the call is one on a resource and throws at the call.
    await expect(
      Promise.resolve().then(() => m.grow!(Float32Array.of(1, 2), { array: list, length })),
    ).rejects.toThrow(
      new TypeError(
        'grow(): parameter "list" is @out, which the call fills with zeros whole, so it takes no { array, length, offset? }. Write @inout list to pass a held length, or pass the array itself.',
      ),
    );
  });
});

describe('the host view of an @out array, under tsc (change 0138, Amendment A15)', () => {
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
