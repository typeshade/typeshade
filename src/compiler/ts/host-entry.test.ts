// Verifies: Rule 8.24 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.21 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 11.7 (docs/language-design.md; traced in reqs/).
//
// A `@compute` entry called from host code (change 0016, part 1): `entry(bindings, workgroups)`.
// Read twice, as every host call is: `tsc` reads the host view (the bindings object's type, the
// workgroup count), and the program runs the generated module. Node has no WebGPU, so the calls
// here run on the CPU tier, and each is held against the interpreter's own lockstep dispatch
// (`CpuModule.dispatch`) on the same values. The WebGPU tier is checked in a browser by the
// import journey (`scripts/user-journey.ts`).

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { hostFace, type HostExport } from './host-face.js';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';
import { wgslLayout } from '../../core/reflect.js';
import type { EntryBinding } from '../../core/host-entry.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const ROOT = resolve(__dirname, '../../..');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tempDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'typeshade-entry-'));
  dirs.push(d);
  return d;
};

function face(source: string) {
  const f = hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f as Required<typeof f>;
}

async function load(source: string): Promise<Record<string, unknown>> {
  const file = join(tempDir(), 'm.shade.mjs');
  writeFileSync(file, face(source).code);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>;
}

const entryOf = (exports: readonly HostExport[], name: string) => {
  const e = exports.find((x) => x.name === name);
  if (e?.kind !== 'compute') throw new Error(`${name} is ${e?.kind}`);
  return e;
};

const PARTICLES = readFileSync(join(ROOT, 'journeys/particles/particles.shade.ts'), 'utf8');
const HISTOGRAM = readFileSync(join(ROOT, 'examples/atomic-histogram.shade.ts'), 'utf8');
const SYNC = readFileSync(join(ROOT, 'examples/compute-sync.shade.ts'), 'utf8');

const SCALE = `"use typeshade";
declare const k: uniform<f32>;
declare const xs: storage<array<f32>>;
declare const ys: storage<array<f32>, "read_write">;
declare const pts: storage<array<vec2>, "read_write">;

@compute([8])
export function scale(@builtin("global_invocation_id") gid: vec3u) {
  if (gid.x >= xs.length) {
    return;
  }
  ys[gid.x] = xs[gid.x] * k;
  pts[gid.x] = vec2(f32(gid.x), xs[gid.x]);
}
`;

describe('which entries a host can call (Rule 8.24)', () => {
  it('calls a @compute entry, draws a fragment entry, and says why a vertex entry is neither', () => {
    const f = face(`"use typeshade";
class VsOut { @builtin("position") pos: vec4; }
@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut { return { pos: vec4(f32(vi), 0., 0., 1.) }; }
@fragment
export function fs(@builtin("position") p: vec4): vec4 { return p; }
declare const out: storage<array<u32>, "read_write">;
@compute([64])
export function fill(@builtin("global_invocation_id") gid: vec3u) { out[gid.x] = gid.x; }
`);
    const kinds = Object.fromEntries(
      f.exports.map((e) => [e.name, e.kind === 'never' ? e.reason : e.kind]),
    );
    expect(kinds.fill).toBe('compute');
    expect(kinds.vs).toMatch(/^it is a vertex entry.*#204/);
    expect(kinds.fs).toBe('fragment');
  });

  it('takes a texture on WebGPU only, and refuses a binding with no host value, naming it', () => {
    const f = face(`"use typeshade";
declare const tex: texture_2d<f32>;
declare const vol: texture_3d<f32>;
declare const out: storage<array<vec4>, "read_write">;
@compute([8])
export function copy(@builtin("global_invocation_id") gid: vec3u) {
  out[gid.x] = textureLoad(tex, vec2i(i32(gid.x), 0), 0);
}
@compute([8])
export function deep(@builtin("global_invocation_id") gid: vec3u) {
  out[gid.x] = textureLoad(vol, vec3i(i32(gid.x), 0, 0), 0);
}
`);
    const copy = entryOf(f.exports, 'copy');
    expect(copy.entry.noCpu).toBe(
      'it reaches the texture_2d<f32> "tex", which the CPU tier cannot read',
    );
    expect(copy.bindingsType).toContain('readonly tex: ImageBitmap | ImageData | HTMLImageElement');
    const deep = f.exports.find((x) => x.name === 'deep')!;
    expect(deep.kind === 'never' && deep.reason).toBe(
      'binding "vol" is a texture_3d<f32>, which has no host value yet; #204, the rendering design, adds it',
    );
  });
});

describe('the host view of an entry', () => {
  it('types the bindings object exactly, read-only where the entry only reads', () => {
    const f = face(SCALE);
    expect(f.view).toContain(
      'export declare function scale(bindings: { readonly k: number; readonly xs: Float32Array; readonly ys: Float32Array; readonly pts: Float32Array }, workgroups: number | readonly [number, number?, number?]): Promise<void>;',
    );
    expect(f.view).toContain('`@workgroup_size(8, 1, 1)`');
  });

  it('boxes a written scalar, takes an atomic array as a typed array, and a written struct mutable', () => {
    const f = face(HISTOGRAM);
    const e = entryOf(f.exports, 'histogram');
    expect(e.bindingsType).toBe(
      '{ readonly src: Float32Array; readonly bins: Uint32Array; readonly summary: { count: number; maxBin: number }; readonly firstValue: Uint32Array }',
    );
  });

  it('type-checks a host call with plain tsc, and catches a misspelled binding at the host line', () => {
    const f = face(SCALE);
    const dir = tempDir();
    writeFileSync(join(dir, 'm.shade.ts'), SCALE);
    writeFileSync(join(dir, 'm.shade.typeshade.ts'), f.view);
    const check = (host: string): string[] => {
      writeFileSync(join(dir, 'app.ts'), host);
      const program = ts.createProgram([join(dir, 'app.ts')], {
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
      return ts.getPreEmitDiagnostics(program).map((d) => `TS${d.code}`);
    };
    const xs = 'new Float32Array(16)';
    expect(
      check(
        `import { scale } from './m.shade.ts';\nawait scale({ k: 2, xs: ${xs}, ys: ${xs}, pts: new Float32Array(32) }, 2);\nexport {};\n`,
      ),
    ).toEqual([]);
    expect(
      check(
        `import { scale } from './m.shade.ts';\nawait scale({ k: 2, xz: ${xs}, ys: ${xs}, pts: ${xs} }, 2);\nexport {};\n`,
      ),
    ).toEqual(['TS2353']);
  });
});

describe('the byte layout the call packs by', () => {
  it("agrees with reflect()'s struct layouts, uniform and storage", () => {
    const src = `"use typeshade";
class U { a: vec3; b: f32; c: array<f32, 3>; m: mat3x3; }
class S { a: vec3; b: f32; c: array<f32, 3>; d: vec2; }
declare const u: uniform<U>;
declare const s: storage<S, "read_write">;
@compute([1])
export function touch(@builtin("global_invocation_id") gid: vec3u) { s.b = u.b + u.c[1] + u.m[0].x; }
`;
    const e = entryOf(face(src).exports, 'touch');
    const structs = new Map(compile(src).module.structs.map((d) => [d.name, d]));
    for (const [name, kind] of [
      ['u', 'std140'],
      ['s', 'std430'],
    ] as const) {
      const b = e.entry.bindings.find((x) => x.name === name)! as EntryBinding;
      const decl = structs.get(name.toUpperCase())!;
      const want = wgslLayout(decl, kind, structs);
      expect(b.layout.k === 'o' && b.layout.f.map(([n, off]) => [n, off])).toEqual(
        want.fields.map((x) => [x.name, x.offset]),
      );
      expect(b.layout.k === 'o' && b.layout.sz).toBe(want.size);
    }
  });
});

describe('the call, on the CPU tier where there is no WebGPU', () => {
  it('runs the particle step as the interpreter dispatches it, and writes back in place', async () => {
    const m = await load(PARTICLES);
    const sim = { dt: Math.fround(1 / 30), gravity: 9.8, floor: 0, bounce: 0.6 };
    const make = () =>
      Array.from({ length: 100 }, (_, i) => ({
        pos: [i * 0.1, 3 - i * 0.03, 0, 1].map(Math.fround),
        vel: [1, 2 - i * 0.05, 0, 0].map(Math.fround),
      }));
    const particles = make();
    const first = particles[0];
    const step = m.step as (b: unknown, w: unknown) => Promise<void>;
    for (let k = 0; k < 5; k++) await step({ sim, particles }, Math.ceil(particles.length / 64));
    expect(particles[0]).toBe(first); // the same objects, updated
    const cpu = compileModule(compile(PARTICLES).module, { precision: 'f32' });
    const ref = make();
    cpu.setBinding('sim', { ...sim, gravity: Math.fround(9.8), bounce: Math.fround(0.6) } as never);
    cpu.setBinding('particles', ref as never);
    for (let k = 0; k < 5; k++) cpu.dispatch!('step', [2, 1, 1]);
    expect(particles).toEqual(ref);
  });

  it('reads back a typed array, a vector array, an atomic array, a written struct and a boxed atomic', async () => {
    const m = await load(HISTOGRAM);
    const src = Float32Array.from({ length: 200 }, (_, i) => ((i * 37) % 101) / 100);
    const bins = new Uint32Array(8);
    const summary = { count: 0, maxBin: 0 };
    const firstValue = new Uint32Array(1);
    await (m.histogram as (b: unknown, w: unknown) => Promise<void>)(
      { src, bins, summary, firstValue },
      Math.ceil(src.length / 64),
    );
    const cpu = compileModule(compile(HISTOGRAM).module, { precision: 'f32' });
    const ref = { bins: new Array(8).fill(0), summary: { count: 0, maxBin: 0 }, first: 0 };
    cpu.setBinding('src', [...src] as never);
    cpu.setBinding('bins', ref.bins as never);
    cpu.setBinding('summary', ref.summary as never);
    cpu.setBinding('firstValue', 0 as never);
    cpu.dispatch!('histogram', [4, 1, 1]);
    expect([...bins]).toEqual(ref.bins);
    expect(summary).toEqual(ref.summary);
    expect(summary.count).toBe(200);
    expect(firstValue[0]).toBe(Math.floor(src[0]! * 1000));

    const s = await load(SCALE);
    const xs = Float32Array.from({ length: 10 }, (_, i) => i + 0.5);
    const ys = new Float32Array(10);
    const pts = new Float32Array(20);
    await (s.scale as (b: unknown, w: unknown) => Promise<void>)({ k: 3, xs, ys, pts }, 2);
    expect([...ys]).toEqual([...xs].map((x) => Math.fround(x * 3)));
    expect([...pts]).toEqual([...xs].flatMap((x, i) => [i, x]));
  });

  it('refuses a value that does not fit, naming the entry, the binding and its type', async () => {
    const s = (await load(SCALE)).scale as (...a: unknown[]) => Promise<void>;
    const xs = new Float32Array(4);
    await expect(s({ k: 1, xs: [1, 2], ys: xs, pts: new Float32Array(8) }, 1)).rejects.toThrow(
      'scale(): binding "xs" (array<f32>): got an array of length 2, not a Float32Array.',
    );
    await expect(s({ k: 1, xs, ys: xs, pts: new Float32Array(3) }, 1)).rejects.toThrow(
      'scale(): binding "pts" (array<vec2<f32>>): got 3 numbers, which is not a whole number of 2-component elements.',
    );
    await expect(s({ k: 1, xs, ys: xs }, 1)).rejects.toThrow(
      'scale(): binding "pts" (array<vec2<f32>>) is missing.',
    );
    await expect(s({ k: 1, xs, ys: xs, pts: new Float32Array(8) }, [1, 0.5])).rejects.toThrow(
      '"workgroups" counts workgroups, so each is a whole number; got number 0.5.',
    );
    await expect(s({ k: 1, xs, ys: xs, pts: new Float32Array(8) })).rejects.toThrow(
      'scale() takes 2 arguments, (bindings, workgroups); got 1.',
    );
    await expect(
      s({ k: 1, xs: new Float32Array(0), ys: xs, pts: new Float32Array(8) }, 1),
    ).rejects.toThrow('binding "xs" (array<f32>): got an empty array, which WebGPU cannot bind.');
  });

  it('needs WebGPU for an entry that reaches a barrier, naming the barrier and its line', async () => {
    const e = entryOf(face(SYNC).exports, 'cs');
    expect(e.entry.barrier).toMatch(/^workgroupBarrier\(\) at m\.shade\.ts:\d+$/);
    const m = await load(SYNC);
    const call = m.cs as (b: unknown, w: unknown) => Promise<void>;
    const bindings = Object.fromEntries(
      (e.entry.bindings as readonly EntryBinding[]).map((b) => [
        b.name,
        b.layout.k === 'a' ? new Uint32Array(64) : b.layout.k === 's' ? new Uint32Array(1) : {},
      ]),
    );
    await expect(call(bindings, 1)).rejects.toThrow(
      /^cs\(\) needs WebGPU: it reaches workgroupBarrier\(\) at m\.shade\.ts:\d+, and a barrier has no CPU tier\.$/,
    );
  });
});
