// Verifies: Rule 8.21 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.22 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).
//
// A kernel function called from host code (change 0013, part 2): `await render(k, 512, img)`.
// Read twice, as every host call is: `tsc` reads the host view (the parameter types, the promise),
// and the program runs the generated module. Node has no WebGPU, so the calls here run on the CPU
// tier and are held against the CPU oracle on the same arguments; the WebGPU tier, each loop one
// dispatch, is checked in a browser by the import journey (`scripts/user-journey.ts`).

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { hostFace } from './host-face.js';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';
import { proveKernels } from '../../core/passes/parallel-loop.js';
import { lowerKernel } from '../../core/passes/kernel-lower.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tempDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'typeshade-kernel-'));
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

const TERRAIN = `"use typeshade";
export function height(p: vec2, k: vec4): f32 {
  return k.x * sin(p.x * k.y) + k.z * cos(p.y * k.w);
}
export function render(k: vec4, size: u32, out: array<f32>) {
  for (let i: u32 = 0; i < size * size; i++) {
    const p = vec2(f32(i % size), f32(i / size)) / f32(size);
    out[i] = height(p, k);
  }
}
export function total(xs: array<f32>): f32 {
  let s = 0.;
  for (const x of xs) {
    s += x;
  }
  return s;
}
class Particle {
  pos: vec4;
  vel: vec4;
}
export function drift(ps: array<Particle>, dt: f32) {
  for (let i: u32 = 0; i < ps.length; i++) {
    ps[i].pos = ps[i].pos + ps[i].vel * dt;
  }
}
`;

describe('the host view of a kernel function (Rule 8.21)', () => {
  const f = face(TERRAIN);

  it('is asynchronous, and types each array as the typed array or objects it takes', () => {
    expect(f.view).toContain(
      'export declare function render(k: readonly [number, number, number, number], size: number, out: Float32Array): Promise<void>;',
    );
    expect(f.view).toContain('export declare function total(xs: Float32Array): Promise<number>;');
    expect(f.view).toContain(
      'export declare function drift(ps: { pos: [number, number, number, number]; vel: [number, number, number, number] }[], dt: number): Promise<void>;',
    );
    // A helper stays synchronous (0009).
    expect(f.view).toContain('export declare function height(p: readonly [number, number]');
  });

  it('says where it runs', () => {
    expect(f.view).toMatch(
      /Each of its loops runs on the GPU, one invocation per iteration.*\n.*function render/,
    );
    expect(f.view).toMatch(
      /It runs on the CPU: a loop of it reduces, which a later part of change 0013 lowers\..*\n.*function total/,
    );
  });

  it('type-checks a host program with plain tsc, and a wrong array at the host line', () => {
    const errors = (app: string): string[] => {
      const dir = tempDir();
      writeFileSync(join(dir, 'm.shade.ts'), TERRAIN);
      writeFileSync(join(dir, 'm.shade.typeshade.ts'), f.view);
      writeFileSync(join(dir, 'app.ts'), app);
      const program = ts.createProgram([join(dir, 'app.ts')], {
        strict: true,
        noEmit: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        allowImportingTsExtensions: true,
        moduleSuffixes: ['.typeshade', ''],
        lib: ['lib.es2022.d.ts'],
        types: [],
      });
      return ts.getPreEmitDiagnostics(program).map((d) => `TS${d.code}`);
    };
    expect(
      errors(
        `import { render, total } from './m.shade.ts';\nconst img = new Float32Array(16);\nawait render([1, 0.5, 2, 0.25], 4, img);\nexport const s: number = await total(img);\n`,
      ),
    ).toEqual([]);
    expect(
      errors(
        `import { render } from './m.shade.ts';\nawait render([1, 0.5, 2, 0.25], 4, [1, 2]);\nexport {};\n`,
      ),
    ).toEqual(['TS2345']);
  });
});

describe('the call, on the CPU tier where there is no WebGPU', () => {
  it('writes each array back in place, as the CPU oracle computes it', async () => {
    const m = await load(TERRAIN);
    const oracle = compileModule(compile(TERRAIN).module, { precision: 'f32' });
    const k = [1, 0.5, 2, 0.25];
    const img = new Float32Array(16);
    await (m.render as (...a: unknown[]) => Promise<void>)(k, 4, img);
    const want = new Array<number>(16).fill(0);
    oracle.fns.render!(k as never, 4 as never, want as never);
    expect([...img]).toEqual(want);
    const ps = [
      { pos: [0, 0, 0, 1], vel: [1, 2, 3, 0] },
      { pos: [1, 1, 1, 1], vel: [-1, 0, 0.5, 0] },
    ];
    await (m.drift as (...a: unknown[]) => Promise<void>)(ps, 0.5);
    expect(ps).toEqual([
      { pos: [0.5, 1, 1.5, 1], vel: [1, 2, 3, 0] },
      { pos: [0.5, 1, 1.25, 1], vel: [-1, 0, 0.5, 0] },
    ]);
  });

  it('resolves to what the function returns', async () => {
    const m = await load(TERRAIN);
    await expect(
      (m.total as (xs: unknown) => Promise<number>)(Float32Array.of(1, 2, 3.5)),
    ).resolves.toBe(6.5);
  });

  it('checks each array against the indices a loop writes before anything runs', async () => {
    const m = await load(TERRAIN);
    const render = m.render as (...a: unknown[]) => Promise<void>;
    await expect(render([1, 0.5, 2, 0.25], 4, new Float32Array(10))).rejects.toThrow(
      new TypeError(
        'render(): parameter "out" holds 10 elements, and loop 1 writes it at indices 0 to 15.',
      ),
    );
    await expect(render([1, 0.5, 2, 0.25], 4, [1, 2])).rejects.toThrow(
      'render(): parameter "out" (array<f32>): got an array of length 2, not a Float32Array.',
    );
    await expect(render([1, 0.5], 4, new Float32Array(16))).rejects.toThrow(
      'render(): parameter "k" (vec4): got an array of length 2.',
    );
    await expect(render([1, 0.5, 2, 0.25], 4)).rejects.toThrow(
      new TypeError('render() takes 3 arguments; got 2.'),
    );
  });
});

describe('what the call dispatches (change 0013 part 2: maps)', () => {
  const lowered = (source: string, fn: string) => {
    const r = compile(source, { fileName: 'm.shade.ts' });
    const f = r.module.funcs.find((x) => x.name === fn)!;
    return lowerKernel(
      f,
      r.module,
      proveKernels(r.module).find((p) => p.fn === fn)!,
    );
  };

  it("lowers each accepted map to a compute entry, and its continue to the invocation's return", () => {
    const plan = lowered(
      `"use typeshade";
export function odds(out: array<f32>, n: i32) {
  for (let i = n - 1; i >= 0; i--) {
    if (i % 2 === 0) {
      continue;
    }
    out[i * 3] = f32(i);
  }
}`,
      'odds',
    );
    if ('noGpu' in plan) throw new Error(plan.noGpu);
    expect(plan.loops).toEqual([
      {
        entry: 'odds_loop0',
        range: 'odds__range0',
        cop: '>=',
        step: -1,
        writes: ['out'],
        checks: [{ param: 'out', a: 3, c: 0 }],
      },
    ]);
    const entry = plan.module.funcs.find((f) => f.name === 'odds_loop0')!;
    expect(entry.stage).toBe('compute');
    expect(JSON.stringify(entry.body)).not.toContain('"s":"continue"');
    expect(plan.module.bindings.map((b) => `${b.name} ${b.space} ${b.access ?? ''}`)).toEqual([
      'odds_args uniform ',
      'out storage read_write',
    ]);
  });

  it.each([
    [
      'a reduction',
      `export function total(xs: array<f32>): f32 { let s = 0.; for (const x of xs) { s += x; } return s; }`,
      'total',
      'a loop of it reduces, which a later part of change 0013 lowers',
    ],
    [
      'a refused loop',
      `export function prefix(out: array<f32>) { for (let i: u32 = 1; i < out.length; i++) { out[i] = out[i] + out[i - 1]; } }`,
      'prefix',
      'a loop of it runs on the CPU (TS8070)',
    ],
    [
      'a bool parameter',
      `export function mask(out: array<f32>, on: bool) { for (let i: u32 = 0; i < out.length; i++) { out[i] = select(0., 1., on); } }`,
      'mask',
      'parameter "on" is a bool, which no buffer holds',
    ],
    [
      'a module binding',
      `declare const scale: uniform<vec4>;\nexport function sc(out: array<f32>) { for (let i: u32 = 0; i < out.length; i++) { out[i] = scale.x; } }`,
      'sc',
      'it reaches "scale", which the call does not pass',
    ],
    [
      'an element read before the loop',
      `export function first(out: array<f32>) { const a = out[0]; for (let i: u32 = 0; i < out.length; i++) { out[i] = a; } }`,
      'first',
      "the statements before loop 1 read an array's elements, which the call runs before it dispatches",
    ],
  ])('runs %s on the CPU, saying why', (_name, body, fn, why) => {
    expect(lowered(`"use typeshade";\n${body}\n`, fn)).toEqual({ noGpu: why });
  });
});
