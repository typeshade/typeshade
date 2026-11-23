// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 11.8 (docs/language-design.md; traced in reqs/).

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from './host-face.js';
import { bothTake } from '../../core/testing/both-halves.js';
import type { KernelFace } from '../../core/host-kernel.js';
import { configure } from '../../runtime.js';

const webgl = vi.hoisted(() => ({ context: null as unknown }));
vi.mock('../../core/gl-context.js', async (original) => ({
  ...(await original<typeof import('../../core/gl-context.js')>()),
  glContext: () => webgl.context,
}));

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
afterEach(() => {
  webgl.context = null;
  configure({});
});

type Call = (...a: unknown[]) => Promise<unknown>;

interface StubGl {
  readonly gl: WebGL2RenderingContext;
  readonly uniforms: Map<string, number[]>;
  draws: number;
}

function stubGl(pixels?: (grid: Uint32Array) => void): StubGl {
  const constants = new Map<string, number>();
  const constant = (name: string): number => {
    if (!constants.has(name)) constants.set(name, name === 'NO_ERROR' ? 0 : constants.size + 1);
    return constants.get(name)!;
  };
  const stub: StubGl = {
    gl: undefined as unknown as WebGL2RenderingContext,
    uniforms: new Map(),
    draws: 0,
  };
  const uniform = (at: unknown, xs: number[]): void => void stub.uniforms.set(String(at), [...xs]);
  const calls: Record<string, (...a: unknown[]) => unknown> = {
    checkFramebufferStatus: () => constant('FRAMEBUFFER_COMPLETE'),
    getError: () => constant('NO_ERROR'),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getUniformLocation: (_p, name) => name,
    uniform1uiv: (at, xs) => uniform(at, xs as number[]),
    uniform1fv: (at, xs) => uniform(at, xs as number[]),
    uniform1iv: (at, xs) => uniform(at, xs as number[]),
    drawArrays: () => void stub.draws++,
    readPixels: (...a) => pixels?.(a[6] as Uint32Array),
  };
  (stub as { gl: WebGL2RenderingContext }).gl = new Proxy({} as object, {
    get(_, name: string) {
      if (name in calls) return calls[name];
      if (/^[A-Z0-9_]+$/.test(name)) return constant(name);
      return () => ({});
    },
  }) as WebGL2RenderingContext;
  return stub;
}

function face(source: string) {
  const f = hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f as Required<typeof f>;
}

function kernel(source: string, name: string): KernelFace {
  const e = face(source).exports.find((x) => x.name === name);
  if (e?.kind !== 'kernel') throw new Error(`${name} is ${String(e?.kind)}`);
  return e.face;
}

async function load(source: string): Promise<Record<string, Call>> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-made-gl-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, face(source).code);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, Call>;
}

const SCALARS = `"use typeshade";
export function ramp(size: u32): f32[] {
  const out = new Float32Array(size * size);
  for (let i: u32 = 0; i < size * size; i++) {
    out[i] = f32(i) * 0.5 + f32(out.length);
  }
  return out;
}
export function odds(n: u32): i32[] {
  const out = new Array(n).fill(7);
  for (let i: u32 = 0; i < n; i++) {
    if (i % 2 == 0) {
      continue;
    }
    out[i] = -i32(i);
  }
  return out;
}
export function short(size: u32): u32[] {
  const out = new Array(size).fill(0);
  for (let i: u32 = 0; i < size * 2; i++) {
    out[i] = i;
  }
  return out;
}
`;

const TWINS = `"use typeshade";
class Spark {
  pos: vec4;
  vel: vec4;
}
export function rampIn(size: u32, out: f32[]) {
  for (let i: u32 = 0; i < size * size; i++) {
    out[i] = f32(i) * 0.5 + f32(out.length);
  }
}
export function shadeMade(n: u32): vec3[] {
  const out = new Array(n).fill(vec3(0., 0., 1.));
  for (let i: u32 = 0; i < n; i++) {
    out[i] = vec3(f32(i), 0., 1.);
  }
  return out;
}
export function shadeIn(n: u32, out: vec3[]) {
  for (let i: u32 = 0; i < n; i++) {
    out[i] = vec3(f32(i), 0., 1.);
  }
}
export function driftMade(n: u32): Spark[] {
  const out = new Array(n).fill({ pos: vec4(), vel: vec4() });
  for (let i: u32 = 0; i < n; i++) {
    out[i] = { pos: vec4(f32(i)), vel: vec4() };
  }
  return out;
}
export function driftIn(n: u32, out: Spark[]) {
  for (let i: u32 = 0; i < n; i++) {
    out[i] = { pos: vec4(f32(i)), vel: vec4() };
  }
}
export function pushedMade(n: u32): f32[] {
  const out: f32[] = [];
  for (let i: u32 = 0; i < n; i++) {
    out.push(f32(i));
  }
  return out;
}
export function pushedIn(n: u32, out: f32[]) {
  for (let i: u32 = 0; i < n; i++) {
    out.push(f32(i));
  }
}
`;

const bitsOf = (x: number): number => new Uint32Array(Float32Array.of(x).buffer)[0]!;

describe('a kernel function that makes its result, on the WebGL2 tier (change 0114, A1 item 8)', () => {
  it('is taken by both halves and writes a WebGL2 program where its parameter twin has one', () => {
    bothTake(SCALARS);
    bothTake(TWINS);
    for (const name of ['ramp', 'odds', 'short']) {
      const k = kernel(SCALARS, name);
      expect(k.noWebgl2).toBeUndefined();
      expect(k.gl?.loops.map((l) => [l.out, l.outScalar])).toEqual([
        ['out', name === 'ramp' ? 'f32' : name === 'odds' ? 'i32' : 'u32'],
      ]);
    }
    expect(kernel(TWINS, 'rampIn').gl?.loops.length).toBe(1);
  });

  it('keeps the CPU tier with the reason of its parameter twin where WebGL2 runs neither', () => {
    for (const [made, twin] of [
      ['shadeMade', 'shadeIn'],
      ['driftMade', 'driftIn'],
      ['pushedMade', 'pushedIn'],
    ] as const) {
      const k = kernel(TWINS, made);
      expect(k.gl).toBeUndefined();
      expect(k.noWebgl2).toBeDefined();
      expect(k.noWebgl2).toBe(kernel(TWINS, twin).noWebgl2);
    }
  });

  it('draws the made array and resolves to what the draw read back', async () => {
    const m = await load(SCALARS);
    const stub = stubGl((grid) => grid.forEach((_, k) => (grid[k] = bitsOf(k + 0.25))));
    webgl.context = stub.gl;
    configure({ prefer: ['webgl2'] });
    const img = await m['ramp']!(3);
    expect(img).toBeInstanceOf(Float32Array);
    expect([...(img as Float32Array)]).toEqual(Array.from({ length: 9 }, (_, k) => k + 0.25));
    expect(stub.draws).toBe(1);
    expect(stub.uniforms.get('size')).toEqual([3]);
    expect(stub.uniforms.get('out_length')).toEqual([9]);
  });

  it('starts the draw target at the fill value, and draws nothing for a length of 0', async () => {
    const m = await load(SCALARS);
    const stub = stubGl();
    webgl.context = stub.gl;
    configure({ prefer: ['webgl2'] });
    const filled = await m['odds']!(4);
    expect(filled).toBeInstanceOf(Int32Array);
    expect([...(filled as Int32Array)]).toEqual([7, 7, 7, 7]);
    const empty = await m['ramp']!(0);
    expect(empty).toBeInstanceOf(Float32Array);
    expect((empty as Float32Array).length).toBe(0);
    expect(stub.draws).toBe(1);
  });

  it('checks the writes against the length before the draw, as for a parameter', async () => {
    const m = await load(SCALARS);
    const stub = stubGl();
    webgl.context = stub.gl;
    configure({ prefer: ['webgl2'] });
    await expect(m['short']!(3)).rejects.toThrow(
      new TypeError(
        'short(): the array it returns, "out", holds 3 elements, and loop 1 writes it at indices 0 to 5.',
      ),
    );
    expect(stub.draws).toBe(0);
  });

  it('names its parameter twin reason when only WebGL2 may run a vector result', async () => {
    const m = await load(TWINS);
    webgl.context = stubGl().gl;
    configure({ prefer: ['webgl2'] });
    await expect(m['shadeMade']!(2)).rejects.toThrow(
      `shadeMade(): no tier it may use can run it (webgl2: it runs on the CPU, ${String(kernel(TWINS, 'shadeIn').noWebgl2)}).`,
    );
    configure({ prefer: ['webgl2', 'cpu'] });
    expect([...((await m['shadeMade']!(2)) as Float32Array)]).toEqual([0, 0, 1, 1, 0, 1]);
  });
});
