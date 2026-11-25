import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from '../compiler/ts/host-face.js';
import { array, configure } from '../runtime.js';
import { callKernel, type KernelFace } from './host-kernel.js';
import { residentState } from './resident.js';

const RUNTIME = resolve(__dirname, 'host-runtime.ts');
const dirs: string[] = [];
beforeAll(() => {
  configure({ prefer: ['cpu'] });
});
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  configure({ prefer: ['webgpu', 'webgl2', 'cpu'] });
});

const SOURCE = `"use typeshade";
export function positive(xs: array<f32>): bool {
  return xs[0] > 0.;
}
export function plain(xs: array<f32>): array<f32, 2> {
  return [xs[0], xs[0]];
}
`;

type Exports = Record<string, (...a: unknown[]) => unknown>;

async function load(): Promise<{ m: Exports; kernels: Map<string, KernelFace> }> {
  const f = hostFace(SOURCE, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const kernels = new Map<string, KernelFace>();
  for (const e of f.exports ?? []) if (e.kind === 'kernel') kernels.set(e.name, e.face);
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-gap-result-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, f.code!);
  return { m: (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Exports, kernels };
}

const REFUSAL = (name: string, result: string): string =>
  `${name}(): takes a resource, and returns ${result}, which no Buffer holds. A call on a resource gives a Buffer for a number, a vector, a bool, a key, a matrix of f32, an array<T, N> of them or of structs, and a struct or a Record of those (change 0138, Amendments A10 Q-C, A11 Q6 and A12, decision 4); pass plain data and await the call.`;

describe('the result of a call on a resource', () => {
  const refused = async (result: object, s: string): Promise<void> => {
    const { kernels } = await load();
    const k = structuredClone(kernels.get('plain')!);
    Object.assign(k, { name: 'made', result: { ...result, s } });
    const cpu = { F: {}, $: { bindings: {}, vars: {} } } as never;
    expect(() => callKernel(cpu, k, 1, [array(new Float32Array([1]))])).toThrow(
      new TypeError(REFUSAL('made', s)),
    );
  };
  const f32 = { k: 'num', t: 'f32', s: 'f32' };

  it('refuses an array<Record<K, T>, N>', () =>
    refused(
      { k: 'arr', n: 2, e: { k: 'rec', m: ['r', 'g'], e: f32, s: 'Record<Channel, f32>' } },
      'array<Record<Channel, f32>, 2>',
    ));

  it('refuses a nested sized array', () =>
    refused(
      { k: 'arr', n: 2, e: { k: 'arr', n: 2, e: f32, s: 'array<f32, 2>' } },
      'array<array<f32, 2>, 2>',
    ));

  it('lays a bool out as one u32 word', async () => {
    const { m } = await load();
    const flag = m.positive!(array(new Float32Array([1]))) as { read(): Promise<unknown> };
    expect(await flag.read()).toEqual([true]);
    expect(residentState(flag)?.view()).toEqual(Uint32Array.of(1));
    expect(residentState(flag)?.elem).toEqual({ k: 'bool' });
    const off = m.positive!(array(new Float32Array([-1]))) as { read(): Promise<unknown> };
    await off.read();
    expect(residentState(off)?.view()).toEqual(Uint32Array.of(0));
  });
});
