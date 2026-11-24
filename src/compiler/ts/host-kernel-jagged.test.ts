import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from './host-face.js';
import { bothTake } from '../../core/testing/both-halves.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const kernel = (type: string): string => `"use typeshade";
export function first(xs: ${type}, out: array<u32>) {
  out[0] = xs[0][0];
}
`;

function face(source: string) {
  const f = hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f as Required<typeof f>;
}

type Fn = (...a: unknown[]) => Promise<unknown>;

async function load(source: string): Promise<Record<string, Fn>> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-kernel-jagged-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, face(source).code);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, Fn>;
}

const REASON =
  'parameter "xs": a jagged array, an array of arrays with no inner size, is not supported yet (issue #1560)';

describe('a kernel function with a jagged parameter (#1557)', () => {
  for (const type of ['u32[][]', 'Array<u32[]>', 'array<array<u32>>']) {
    it(`${type}: both halves take it, and the host view declares it never`, () => {
      bothTake(kernel(type));
      const f = face(kernel(type));
      expect(f.exports.find((e) => e.name === 'first')).toEqual({
        kind: 'never',
        name: 'first',
        reason: REASON,
      });
      expect(f.view).toContain(`Not callable from host code (Rule 8.20): ${REASON}.`);
      expect(f.view).toContain('export declare const first: never;');
    });
  }

  it('the call throws a TypeError that names the parameter, for arrays and typed arrays', async () => {
    const m = await load(kernel('u32[][]'));
    const out = new Uint32Array(1);
    const inputs = [
      [[1, 2], [3]],
      [new Uint32Array([1, 2]), new Uint32Array([3])],
    ];
    for (const xs of inputs) {
      expect(() => m.first!(xs, out)).toThrow(TypeError);
      expect(() => m.first!(xs, out)).toThrow(/parameter "xs".*not supported yet \(issue #1560\)/);
    }
  });

  it('a fixed inner size keeps its face and its call', async () => {
    const source = kernel('array<array<u32, 3>>');
    bothTake(source);
    const f = face(source);
    expect(f.exports.find((e) => e.name === 'first')?.kind).toBe('kernel');
    expect(f.view).toContain('xs: readonly array<u32, 3>[]');
  });
});
