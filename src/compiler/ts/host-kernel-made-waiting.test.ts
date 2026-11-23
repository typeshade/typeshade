// Verifies: Rule 8.21 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).

import { afterAll, describe, expect, it } from 'vitest';
import ts from 'typescript';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from './host-face.js';
import { bothTake } from '../../core/testing/both-halves.js';
import { tscDiagnostics } from '../../core/testing/tsc-diagnostics.js';
import { array } from '../../runtime.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

type Call = (...a: unknown[]) => unknown;

function face(source: string) {
  const f = hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f as Required<typeof f>;
}

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-made-waiting-'));
  dirs.push(dir);
  return dir;
}

async function load(source: string): Promise<Record<string, Call>> {
  const file = join(scratch(), 'm.shade.mjs');
  writeFileSync(file, face(source).code);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, Call>;
}

async function consumerErrors(source: string, consumer: string): Promise<string[]> {
  const dir = scratch();
  writeFileSync(join(dir, 'm.shade.ts'), source);
  writeFileSync(join(dir, 'm.shade.typeshade.ts'), face(source).view);
  writeFileSync(join(dir, 'app.ts'), consumer);
  const diagnostics = await tscDiagnostics([join(dir, 'app.ts')], {
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
  return diagnostics.map(
    (d) => `${d.fileName ? d.fileName.slice(dir.length + 1) : ''} TS${d.code}`,
  );
}

const PLAIN_STRUCT = `"use typeshade";
export class P { a: f32; b: vec3f; }
export function pointsBoth(xs: f32[], ys: f32[]): P[] {
  const out = new Array(xs.length).fill({ a: 0., b: vec3f() });
  for (let i: u32 = 0; i < xs.length; i++) {
    ys[i] = xs[i];
    out[i] = { a: xs[i], b: vec3f(f32(i), 2., 3.) };
  }
  return out;
}
`;

const WAITING = `"use typeshade";
export function sizedBoth(xs: f32[], n: u32, ys: f32[]): f32[] {
  const out = new Float32Array(n);
  for (let i: u32 = 0; i < xs.length; i++) {
    ys[i] = xs[i];
    out[i] = xs[i];
  }
  return out;
}
export function keptBoth(xs: f32[], ys: f32[]): f32[] {
  const out: f32[] = [];
  for (let i: u32 = 0; i < xs.length; i++) {
    ys[i] = xs[i];
    out.push(xs[i] * 2.);
  }
  return out;
}
`;

describe('a waiting call of a kernel function that makes its result (change 0114, A13)', () => {
  it('is taken by both halves', () => {
    bothTake(PLAIN_STRUCT);
    bothTake(WAITING);
  });

  it('declares the promise of an array of the class for a struct element in the host view', () => {
    const f = face(PLAIN_STRUCT);
    expect(f.view).toContain(
      'export declare function pointsBoth(xs: Float32Array, ys: Float32Array): Promise<P[]>;',
    );
    expect(f.view).toContain(
      'export declare function pointsBoth(xs: Float32Array | Buffer<f32>, ys: Float32Array | Buffer<f32>): Promise<P[]>;',
    );
  });

  it('gives the editor the type P[] for the awaited call, and refuses another type', async () => {
    const host = (line: string): string =>
      `import { pointsBoth, P } from './m.shade.ts';\nconst xs = new Float32Array(2);\nconst ys = new Float32Array(2);\n${line}\nexport {};\n`;
    expect(
      await consumerErrors(
        PLAIN_STRUCT,
        host('const ps: P[] = await pointsBoth(xs, ys);\nconst a: number = ps[0]!.a;\nvoid a;'),
      ),
    ).toEqual([]);
    expect(
      await consumerErrors(
        PLAIN_STRUCT,
        host('const n: number[] = await pointsBoth(xs, ys);\nvoid n;'),
      ),
    ).toEqual(['app.ts TS2322']);
  });

  it('rejects a length that reads a resource argument, with the TypeError of the call', async () => {
    const m = await load(WAITING);
    const xs = array(new Float32Array([1, 2]));
    const n = array(new Uint32Array([2]));
    const call = m['sizedBoth']!(xs, n, new Float32Array(2));
    expect(call).toBeInstanceOf(Promise);
    await expect(call).rejects.toEqual(
      new TypeError(
        'sizedBoth(): parameter "n" is a resource, and the length or the fill value of the array it returns, "out", reads it; a call on a resource that reads them from a resource is not supported yet. Pass "n" as plain data.',
      ),
    );
    xs.dispose();
    n.dispose();
  });

  it('gives plain data equal to a JavaScript run for a grown array', async () => {
    const m = await load(WAITING);
    const xs = array(new Float32Array([1, 2, 3]));
    const ys = new Float32Array(3);
    const call = m['keptBoth']!(xs, ys);
    expect(call).toBeInstanceOf(Promise);
    const got = (await call) as Float32Array;
    expect(got).toBeInstanceOf(Float32Array);
    const expected = [1, 2, 3].map((x) => x * 2);
    expect([...got]).toEqual(expected);
    expect([...ys]).toEqual([1, 2, 3]);
    const plain = (await m['keptBoth']!(
      new Float32Array([1, 2, 3]),
      new Float32Array(3),
    )) as Float32Array;
    expect([...plain]).toEqual(expected);
    xs.dispose();
  });
});
