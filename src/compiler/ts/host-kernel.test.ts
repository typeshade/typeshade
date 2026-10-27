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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { hostFace } from './host-face.js';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';
import { proveKernels } from '../../core/passes/parallel-loop.js';
import { lowerKernel, lowerKernelGl } from '../../core/passes/kernel-lower.js';
import { emitGlslModule } from '../../core/backends/glsl.js';
import { emitModule } from '../../core/backends/wgsl.js';
import { fromPortable } from '../../core/ir/portable.js';
import { VERSION } from '../../core/version.js';
import type { KernelFace } from '../../core/host-kernel.js';
import { copy, runKernelPlan } from '../../core/testing/kernel-plan.js';
import { tscDiagnostics } from '../../core/testing/tsc-diagnostics.js';
import type { CpuValue } from '../../core/cpu-runtime.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

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
export function prefix(out: array<f32>) {
  for (let i: u32 = 1; i < out.length; i++) {
    out[i] = out[i] + out[i - 1];
  }
}
`;

describe('the host view of a kernel function (Rule 8.21)', () => {
  const f = face(TERRAIN);

  it('is asynchronous, and types each array as the typed array or objects it takes', () => {
    expect(f.view).toContain(
      'export declare function render(k: readonly [number, number, number, number], size: number, out: Float32Array | Resident<Float32Array>): Promise<void>;',
    );
    expect(f.view).toContain(
      'export declare function total(xs: Float32Array | Resident<Float32Array>): Promise<number>;',
    );
    expect(f.view).toContain(
      'export declare function drift(ps: { pos: [number, number, number, number]; vel: [number, number, number, number] }[] | Resident<{ pos: [number, number, number, number]; vel: [number, number, number, number] }[]>, dt: number): Promise<void>;',
    );
  });

  it('gives a call whose written arrays are all resident, and that returns nothing, a void signature', () => {
    expect(f.view).toContain(`import type { Resident } from ${JSON.stringify(RUNTIME)};`);
    expect(f.view).toContain(
      'export declare function render(k: readonly [number, number, number, number], size: number, out: Resident<Float32Array>): void;',
    );
    // A function with a result always waits.
    expect(f.view).not.toMatch(/function total\([^)]*\): void/);
    // A helper stays synchronous (0009).
    expect(f.view).toContain('export declare function height(p: readonly [number, number]');
  });

  it('says where it runs', () => {
    expect(f.view).toMatch(
      /Each of its loops runs on the GPU, one invocation per iteration.*\n.*function render/,
    );
    expect(f.view).toMatch(
      /Each of its loops runs on the GPU, one invocation per iteration.*\n.*function total/,
    );
    expect(f.view).toMatch(
      /It runs on the CPU: a loop of it runs on the CPU \(TS8070\)\..*\n.*function prefix/,
    );
  });

  it('type-checks a host program with plain tsc, and a wrong array at the host line (no overload takes it)', async () => {
    const errors = async (app: string): Promise<string[]> => {
      const dir = tempDir();
      writeFileSync(join(dir, 'm.shade.ts'), TERRAIN);
      writeFileSync(join(dir, 'm.shade.typeshade.ts'), f.view);
      writeFileSync(join(dir, 'app.ts'), app);
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
      return diagnostics.map((d) => `TS${d.code}`);
    };
    expect(
      await errors(
        `import { render, total } from './m.shade.ts';\nconst img = new Float32Array(16);\nawait render([1, 0.5, 2, 0.25], 4, img);\nexport const s: number = await total(img);\n`,
      ),
    ).toEqual([]);
    expect(
      await errors(
        `import { render, total } from './m.shade.ts';\nimport { resident } from ${JSON.stringify(RUNTIME)};\nconst dev = resident(new Float32Array(16));\nconst queued: void = render([1, 0.5, 2, 0.25], 4, dev);\nexport const s: number = await total(dev);\nexport const img: Float32Array = await dev.read();\nvoid queued;\n`,
      ),
    ).toEqual([]);
    expect(
      await errors(
        `import { render } from './m.shade.ts';\nawait render([1, 0.5, 2, 0.25], 4, [1, 2]);\nexport {};\n`,
      ),
    ).toEqual(['TS2769']);
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

  it('loads when a kernel function is named after a global the module reads', async () => {
    // A name the file declares is the file's (Rule 2.1), and the generated module binds none of
    // them (proposal 0008 §1): a kernel function bound as written, `Object`, left the enum's
    // `Object.freeze` undefined, and the module did not load.
    const m = await load(`"use typeshade";
export enum Mode { A, B = 4 }
export function Object(xs: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] = xs[i] * 2.;
  }
}
`);
    expect(m.Mode).toEqual({ A: 0, B: 4, 0: 'A', 4: 'B' });
    const xs = Float32Array.of(1, 2, 3);
    await (m.Object as (xs: Float32Array) => Promise<void>)(xs);
    expect([...xs]).toEqual([2, 4, 6]);
    expect((m.Object as () => unknown).name).toBe('Object');
  });
});

describe('a kernel function that takes an f64 (change 0013, the f64 split)', () => {
  const SCALE64 = `"use typeshade";
export function scale(xs: array<f64>, k: f64) {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] = xs[i] * k;
  }
}
`;

  it('takes a Float64Array and a number, and computes each as a double on the CPU tier', async () => {
    const f = face(SCALE64);
    expect(f.view).toContain(
      'export declare function scale(xs: Float64Array | Resident<Float64Array>, k: number): Promise<void>;',
    );
    const m = await load(SCALE64);
    const xs = Float64Array.of(1 + 1e-12, 2, 3);
    await (m.scale as (xs: unknown, k: number) => Promise<void>)(xs, 3);
    expect([...xs]).toEqual([(1 + 1e-12) * 3, 6, 9]);
  });

  it('dispatches on the GPU, the guard bound and each reduction folded as an f64 by the tree', () => {
    const f = face(`"use typeshade";
export function stats(xs: array<f64>, k: f64): vec2f64 {
  let sum: f64 = 0;
  let lo: f64 = 1e30;
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] = xs[i] * k;
    sum += xs[i];
    lo = min(lo, xs[i]);
  }
  return vec2f64(sum, lo);
}
`);
    const e = f.exports.find((x) => x.name === 'stats');
    if (e?.kind !== 'kernel') throw new Error(`stats is ${e?.kind}`);
    const g = e.face.gpu!;
    expect(e.face.noGpu).toBeUndefined();
    // The module emulates f64, so its WGSL reads the `_fp64` guard, which the call binds.
    expect(g.guard).toEqual({ group: 0, binding: 4 });
    expect(g.wgsl).toContain('var _fp64: texture_2d<f32>;');
    // The face carries the WGSL under the integer flavor too, which declares no guard and does
    // its arithmetic through integer primitives (change 0073).
    expect(g.wgslInteger).toBeDefined();
    expect(g.wgslInteger).not.toContain('_fp64');
    expect(g.wgslInteger).toContain('fn df64_ipack');
    expect(g.wgslInteger).toContain('fn df64_mul');
    expect(g.loops[0]!.reduce!.vars.map((v) => [v.name, v.op, v.scalar, v.n])).toEqual([
      ['sum', '+', 'f64', 1],
      ['lo', 'min', 'f64', 1],
    ]);
    // Each partial is an f64 the runtime joins from its hi and lo.
    expect(g.loops[0]!.reduce!.vars[0]!.binding.layout).toEqual({
      k: 'a',
      n: null,
      st: 8,
      e: { k: 's', t: 'f64' },
    });
    // An 8-byte element is not the WebGL2 tier's.
    expect(e.face.noWebgl2).toBeDefined();
  });

  it('carries one WGSL for a function of a module that emulates no f64 (change 0073)', () => {
    const e = face(TERRAIN).exports.find((x) => x.name === 'render');
    if (e?.kind !== 'kernel') throw new Error(`render is ${e?.kind}`);
    expect(e.face.gpu!.guard).toBeUndefined();
    expect(e.face.gpu!.wgslInteger).toBeUndefined();
  });
});

describe('a resident array and the tiers (Rule 11.8)', () => {
  it('holds its own array across calls on the CPU tier, and read() waits for the calls before it', async () => {
    const m = await load(TERRAIN);
    const rt = (await import(
      pathToFileURL(RUNTIME).href
    )) as typeof import('../../core/host-runtime.js');
    const src = new Float32Array(16);
    const dev = rt.resident(src);
    const k = [1, 0.5, 2, 0.25];
    // Queued, not awaited: read() waits for it.
    void (m.render as (...a: unknown[]) => Promise<void>)(k, 4, dev);
    const img = await dev.read();
    const oracle = compileModule(compile(TERRAIN).module, { precision: 'f32' });
    const want = new Array<number>(16).fill(0);
    oracle.fns.render!(k as never, 4 as never, want as never);
    expect([...img]).toEqual(want);
    // The caller's array is not the handle's.
    expect([...src]).toEqual(new Array(16).fill(0));
    // A reduction reads it where it takes an array.
    await expect((m.total as (xs: unknown) => Promise<number>)(dev)).resolves.toBeCloseTo(
      want.reduce((a, b) => a + b, 0),
      4,
    );
  });

  it('keeps the error of a queued call for read() to throw', async () => {
    const m = await load(TERRAIN);
    const rt = (await import(
      pathToFileURL(RUNTIME).href
    )) as typeof import('../../core/host-runtime.js');
    const short = rt.resident(new Float32Array(10));
    void (m.render as (...a: unknown[]) => Promise<void>)([1, 0.5, 2, 0.25], 4, short).catch(
      () => undefined,
    );
    await expect(short.read()).rejects.toThrow(
      'render(): parameter "out" holds 10 elements, and loop 1 writes it at indices 0 to 15.',
    );
  });

  it('runs on the tiers configure names, and says why none could', async () => {
    const m = await load(TERRAIN);
    const rt = (await import(
      pathToFileURL(RUNTIME).href
    )) as typeof import('../../core/host-runtime.js');
    const render = m.render as (...a: unknown[]) => Promise<void>;
    try {
      rt.configure({ prefer: ['webgpu'] });
      await expect(render([1, 0.5, 2, 0.25], 4, new Float32Array(16))).rejects.toThrow(
        'render(): no tier it may use can run it (webgpu: there is no WebGPU device).',
      );
      rt.configure({ prefer: ['webgl2', 'webgpu'] });
      await expect(render([1, 0.5, 2, 0.25], 4, new Float32Array(16))).rejects.toThrow(
        'render(): no tier it may use can run it (webgl2: there is no WebGL2 context; webgpu: there is no WebGPU device).',
      );
      rt.configure({ prefer: ['webgl2', 'cpu'] });
      await expect(render([1, 0.5, 2, 0.25], 4, new Float32Array(16))).resolves.toBeUndefined();
      expect(() => rt.configure({ prefer: [] })).toThrow(
        new TypeError('configure(): prefer takes a non-empty list of tiers.'),
      );
      expect(() => rt.configure({ prefer: ['gpu' as never] })).toThrow(
        new TypeError('configure(): "gpu" is not a tier; the tiers are webgpu, webgl2 and cpu.'),
      );
    } finally {
      rt.configure({});
    }
  });

  it('types the zeroed form resident(length, element), and refuses any other element under tsc', async () => {
    const f = face(TERRAIN);
    const dir = tempDir();
    writeFileSync(join(dir, 'm.shade.ts'), TERRAIN);
    writeFileSync(join(dir, 'm.shade.typeshade.ts'), f.view);
    const head = `import { render } from './m.shade.ts';\nimport { resident, type Resident } from ${JSON.stringify(RUNTIME)};\n`;
    // One program holds every case, a file each: a program reads the library files once.
    const apps: Record<string, string> = {
      accepted: `${head}const r: Resident<Float32Array> = resident(8, 'f32');\nconst q: Resident<Int32Array> = resident(8, 'i32');\nconst u: Resident<Uint32Array> = resident(8, 'u32');\nconst queued: void = render([1, 0.5, 2, 0.25], 4, r);\nvoid [q, u, queued];\n`,
      // An element that is not the array's element is refused before the run, as it is at the run.
      wrongArray: `${head}render([1, 0.5, 2, 0.25], 4, resident(8, 'i32'));\n`,
      wrongType: `${head}const r: Resident<Int32Array> = resident(8, 'f32');\nvoid r;\n`,
      f64: `${head}resident(8, 'f64');\nexport {};\n`,
      undef: `${head}resident(8, undefined);\nexport {};\n`,
    };
    for (const [name, text] of Object.entries(apps)) writeFileSync(join(dir, `${name}.ts`), text);
    const diagnostics = await tscDiagnostics(
      Object.keys(apps).map((name) => join(dir, `${name}.ts`)),
      {
        strict: true,
        noEmit: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        allowImportingTsExtensions: true,
        moduleSuffixes: ['.typeshade', ''],
        lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
        types: [],
      },
    );
    const errors: Record<string, string[]> = {};
    for (const d of diagnostics) {
      const name = d.fileName === undefined ? '' : (d.fileName.split('/').pop() ?? '');
      (errors[name.replace(/\.ts$/, '')] ??= []).push(`TS${d.code}`);
    }
    expect(errors['accepted']).toBeUndefined();
    expect(errors['wrongArray']).toHaveLength(1);
    expect(errors['wrongType']).toEqual(['TS2322']);
    expect(errors['f64']).toEqual(['TS2345']);
    expect(errors['undef']).toEqual(['TS2345']);
    expect(Object.keys(errors).sort()).toEqual(['f64', 'undef', 'wrongArray', 'wrongType']);
  }, 180_000);

  it('makes a zeroed handle that holds zeros until a call writes it, and the CPU tier writes what the oracle does', async () => {
    const m = await load(TERRAIN);
    const rt = (await import(
      pathToFileURL(RUNTIME).href
    )) as typeof import('../../core/host-runtime.js');
    const dev = rt.resident(16, 'f32');
    // No call has written it: read() returns zeros, and keeps no host copy.
    expect(await dev.read()).toEqual(new Float32Array(16));
    const k = [1, 0.5, 2, 0.25];
    void (m.render as (...a: unknown[]) => Promise<void>)(k, 4, dev);
    const img = await dev.read();
    const oracle = compileModule(compile(TERRAIN).module, { precision: 'f32' });
    const want = new Array<number>(16).fill(0);
    oracle.fns.render!(k as never, 4 as never, want as never);
    expect([...img]).toEqual(want);
  });

  it('takes a zeroed Resident for an array of vectors as it takes the typed array of the same element', async () => {
    const m = await load(`"use typeshade";
export function lift(out: array<vec4>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = vec4(f32(i), 1., 2., 3.);
  }
}
export function lift3(out: array<vec3>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = vec3(f32(i), 1., 2.);
  }
}
export function ints(out: array<i32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = 1;
  }
}
`);
    const rt = (await import(
      pathToFileURL(RUNTIME).href
    )) as typeof import('../../core/host-runtime.js');
    const call = (name: string, ...a: unknown[]) => (m[name] as (...a: unknown[]) => unknown)(...a);
    // The plain handle of a Float32Array is the oracle: the zeroed handle holds what it holds.
    for (const name of ['lift', 'lift3'] as const) {
      const plain = rt.resident(new Float32Array(12));
      const zero = rt.resident(12, 'f32');
      void call(name, plain);
      void call(name, zero);
      expect(await zero.read()).toEqual(await plain.read());
    }
    // A length that is not a whole number of vectors is refused, as the typed array is.
    const ragged = rt.resident(10, 'f32');
    void call('lift', ragged);
    await expect(ragged.read()).rejects.toThrow(/not a whole number of 4-component elements/);
    // An element that is not the array's is refused, as the typed array is.
    const wrong = rt.resident(4, 'f32');
    void call('ints', wrong);
    await expect(wrong.read()).rejects.toThrow(/only an array of f32/);
    const right = rt.resident(4, 'i32');
    void call('ints', right);
    expect(await right.read()).toEqual(Int32Array.of(1, 1, 1, 1));
  });

  it('takes a Resident of a Float32Array for an array<vec4f>, and refuses a length that is not a whole number of vectors (change 0068, probe results 3 and 5)', async () => {
    const m = await load(`"use typeshade";
export function copy4(out: array<vec4f>, a: array<vec4f>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i];
  }
}
`);
    const rt = (await import(
      pathToFileURL(RUNTIME).href
    )) as typeof import('../../core/host-runtime.js');
    const copy4 = m.copy4 as (...a: unknown[]) => Promise<void>;
    // Result 3: a Resident of the typed array takes the place of the typed array.
    const src = rt.resident(new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]));
    const out = rt.resident(new Float32Array(8));
    await copy4(out, src);
    expect(Array.from(await out.read())).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // Result 5: a length that is not a multiple of 4 is a TypeError before any loop runs.
    await expect(copy4(new Float32Array(8), new Float32Array(6))).rejects.toThrow(
      new TypeError(
        'copy4(): parameter "a" (array<vec4>): got 6 numbers, which is not a whole number of 4-component elements.',
      ),
    );
    await expect(copy4(new Float32Array(6), new Float32Array(8))).rejects.toThrow(
      new TypeError(
        'copy4(): parameter "out" (array<vec4>): got 6 numbers, which is not a whole number of 4-component elements.',
      ),
    );
  });

  it('refuses a zeroed Resident with the three refusals of Rule 11.8, and keeps resident(value) for one argument', async () => {
    const rt = (await import(
      pathToFileURL(RUNTIME).href
    )) as typeof import('../../core/host-runtime.js');
    const R1 = (got: string) =>
      new TypeError(
        `resident(): a zeroed Resident takes a length that is a whole number from 1 to 4294967295; got ${got}.`,
      );
    expect(() => rt.resident(0, 'f32')).toThrow(R1('0'));
    expect(() => rt.resident(1.5, 'f32')).toThrow(R1('1.5'));
    expect(() => rt.resident(4, 'f64' as never)).toThrow(
      new TypeError(
        "resident(): a zeroed Resident takes the element 'f32', 'i32' or 'u32'; got 'f64'.",
      ),
    );
    expect(() => rt.resident(8, undefined as never)).toThrow(
      new TypeError(
        "resident(): a zeroed Resident takes the element 'f32', 'i32' or 'u32'; got undefined.",
      ),
    );
    expect(() => rt.resident([1] as never, 'f32')).toThrow(
      new TypeError(
        'resident(): with an element, the first argument is the length, a whole number; got an array.',
      ),
    );
    expect(await rt.resident(5).read()).toBe(5);
  });

  it('refuses one resident array passed as two parameters', async () => {
    const m = await load(`"use typeshade";
export function copy(src: array<f32>, dst: array<f32>) {
  for (let i: u32 = 0; i < src.length; i++) {
    dst[i] = src[i];
  }
}
`);
    const rt = (await import(
      pathToFileURL(RUNTIME).href
    )) as typeof import('../../core/host-runtime.js');
    const r = rt.resident(new Float32Array(4));
    await expect((m.copy as (...a: unknown[]) => Promise<void>)(r, r)).rejects.toThrow(
      new TypeError('copy(): parameter "dst" is the same resident array as parameter "src".'),
    );
  });
});

describe('what the call dispatches (change 0013 parts 2 and 3: maps and reductions)', () => {
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
        wg: 64,
        iterates: 'odds_loop0',
        iteration: 4,
        continues: true,
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

  it('says where the iteration starts in the body of the function that holds it (change 0058)', () => {
    // The four statements before the iteration of a map's entry index the invocation, return a
    // workgroup wholly past the trip count, set the lane's flag and clamp its index (change
    // 0096). A consumer cuts them by the number the plan records, not by a 4 of its own: the
    // number and the body are one construction.
    const map = lowered(
      `"use typeshade";
export function scale(out: array<f32>, x: array<f32>, k: f32) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = x[i] * k;
  }
}`,
      'scale',
    );
    if ('noGpu' in map) throw new Error(map.noGpu);
    const [m] = map.loops;
    const entry = map.module.funcs.find((f) => f.name === m!.iterates)!;
    expect(m).toMatchObject({ entry: 'scale_loop0', iterates: 'scale_loop0', continues: false });
    expect(entry.body.slice(0, m!.iteration).map((st) => st.s)).toEqual([
      'let',
      'if',
      'let',
      'let',
    ]);
    expect(entry.body[0]).toMatchObject({ s: 'let', name: '_k' });
    expect(entry.body[m!.iteration]).toMatchObject({ s: 'let', name: 'i' });

    // A loop that reduces runs its iteration in a helper, which is all iteration.
    const sum = lowered(
      `"use typeshade";
export function stats(xs: array<f32>, out: array<f32>): f32 {
  let s = 0.;
  for (let i: u32 = 0; i < xs.length; i++) {
    out[i] = xs[i] * 2.;
    s += xs[i];
  }
  return s;
}`,
      'stats',
    );
    if ('noGpu' in sum) throw new Error(sum.noGpu);
    const [r] = sum.loops;
    const helper = sum.module.funcs.find((f) => f.name === r!.iterates)!;
    expect(r).toMatchObject({ entry: 'stats_loop0', iterates: 'stats_loop0_iteration' });
    expect(r!.iteration).toBe(0);
    expect(helper.stage).toBeUndefined();
    expect(helper.body[r!.iteration]).toMatchObject({ s: 'let', name: 'i' });
  });

  it.each([
    ['none', 'out[i] = x[i];', false],
    ['at the top of the body', 'if (x[i] < 0.) { continue; } out[i] = x[i];', true],
    ['in an else arm', 'if (x[i] >= 0.) { out[i] = x[i]; } else { continue; }', true],
    [
      'in a switch, which continues the loop around it',
      'switch (i % 3) { case 0: continue; default: out[i] = x[i]; }',
      true,
    ],
    [
      "in a nested loop, which is that loop's and not this one's",
      'for (let k: u32 = 0; k < 2; k++) { if (k === 1) { continue; } out[i] = x[i]; }',
      false,
    ],
  ])('says whether the loop has a continue of its own: %s', (_name, body, want) => {
    const plan = lowered(
      `"use typeshade";
export function f(out: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    ${body}
  }
}`,
      'f',
    );
    if ('noGpu' in plan) throw new Error(plan.noGpu);
    const [loop] = plan.loops;
    expect(loop!.continues).toBe(want);
    // The same fact from the lowered body: its own continue is the only return in the iteration.
    const entry = plan.module.funcs.find((f) => f.name === loop!.iterates)!;
    expect(JSON.stringify(entry.body.slice(loop!.iteration)).includes('"s":"return"')).toBe(want);
  });

  it('lowers a reduction to a tree per workgroup, a fold of the partials, and a tail on the CPU', () => {
    const plan = lowered(
      `"use typeshade";
export function stats(xs: array<f32>, out: array<f32>): f32 {
  let s = 0.;
  let m = -1e30;
  for (let i: u32 = 0; i < xs.length; i++) {
    out[i] = xs[i] * 2.;
    s += xs[i];
    m = max(m, xs[i]);
  }
  return s / f32(xs.length) + m;
}`,
      'stats',
    );
    if ('noGpu' in plan) throw new Error(plan.noGpu);
    const [loop] = plan.loops;
    expect(loop).toMatchObject({
      entry: 'stats_loop0',
      wg: 256,
      writes: ['out'],
      reduce: {
        entry: 'stats_loop0_fold',
        vars: [
          { name: 's', op: '+', binding: 'stats_loop0_s' },
          { name: 'm', op: 'max', binding: 'stats_loop0_m' },
        ],
      },
    });
    expect(plan.tail).toBe('stats__tail');
    expect(plan.module.bindings.map((b) => `${b.name} ${b.space} ${b.access ?? ''}`)).toEqual([
      'stats_args uniform ',
      'xs storage read',
      'out storage read_write',
      'stats_loop0_s storage read_write',
      'stats_loop0_m storage read_write',
    ]);
    const fold = plan.module.funcs.find((f) => f.name === 'stats_loop0_fold')!;
    expect(fold.workgroupSize).toBe(256);
    // The tail combines what the GPU folded, then returns: no loop is left in it.
    const tail = plan.ranges.find((f) => f.name === 'stats__tail')!;
    expect(tail.params.map((p) => p.name)).toEqual(['xs', 'out', '_t0_s', '_t0_m']);
    expect(tail.body.some((st) => st.s === 'for')).toBe(false);
  });

  it('lowers a scatter into an integer array to an atomic on array<atomic<T>>', () => {
    const plan = lowered(
      `"use typeshade";
export function histogram(xs: array<f32>, bins: array<u32>, lo: f32, scale: f32) {
  const top = bins.length - 1;
  for (let i: u32 = 0; i < xs.length; i++) {
    const k = min(u32(max((xs[i] - lo) * scale, 0.)), top);
    bins[k] += 1;
  }
}`,
      'histogram',
    );
    if ('noGpu' in plan) throw new Error(plan.noGpu);
    expect(plan.loops[0]).toMatchObject({ entry: 'histogram_loop0', writes: ['bins'], checks: [] });
    const bins = plan.module.bindings.find((b) => b.name === 'bins')!;
    expect(bins.type).toEqual({ kind: 'array', elem: { kind: 'atomic', elem: 'u32' } });
    expect(bins.access).toBe('read_write');
    expect(
      JSON.stringify(plan.module.funcs.find((f) => f.name === 'histogram_loop0')!.body),
    ).toContain('"fn":"atomicAdd"');
  });

  it("gives each scatter its own operator's atomic when two loops scatter into one array", () => {
    // The lowering kept one operator per array, the last loop's, so the first loop's `&=` ran as
    // `atomicOr` on WebGPU. The generated-kernel differential found it (#349).
    const source = `"use typeshade";
export function mask(ks: array<u32>, bits: array<u32>) {
  for (let i: u32 = 0; i < ks.length; i++) {
    bits[ks[i] % bits.length] &= ks[i];
  }
  for (let i: u32 = 0; i < ks.length; i++) {
    bits[ks[i] % bits.length] |= 1;
  }
}`;
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', source);
    expect(service.getDiagnostics('m.shade.ts')).toEqual([]);
    const plan = lowered(source, 'mask');
    if ('noGpu' in plan) throw new Error(plan.noGpu);
    const atomics = (entry: string): string[] =>
      [
        ...JSON.stringify(plan.module.funcs.find((f) => f.name === entry)!.body).matchAll(
          /"fn":"(atomic\w+)"/g,
        ),
      ].map((m) => m[1]!);
    expect(atomics('mask_loop0')).toEqual(['atomicAnd']);
    expect(atomics('mask_loop1')).toEqual(['atomicOr']);
    // What the plugin writes into the generated module, which the WebGPU tier dispatches.
    const kernel = face(source).exports.find((e) => e.kind === 'kernel');
    const wgsl = kernel?.kind === 'kernel' ? (kernel.face.gpu?.wgsl ?? '') : '';
    expect(wgsl.match(/atomic(And|Or)\(&bits\[/g)).toEqual(['atomicAnd(&bits[', 'atomicOr(&bits[']);
  });

  it('lowers a map that writes one f32 array at i to a WebGL2 fragment program', () => {
    const r = compile(
      `"use typeshade";
export function axpy(a: f32, xs: array<f32>, ys: array<f32>, out: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    if (xs[i] < 0.) {
      continue;
    }
    out[i] = a * xs[i] + ys[i];
  }
}`,
      { fileName: 'm.shade.ts' },
    );
    const f = r.module.funcs.find((x) => x.name === 'axpy')!;
    const plan = lowerKernelGl(
      f,
      r.module,
      proveKernels(r.module).find((p) => p.fn === 'axpy')!,
    );
    if ('noWebgl2' in plan) throw new Error(plan.noWebgl2);
    const [loop] = plan.loops;
    expect(loop).toMatchObject({
      out: 'out',
      outScalar: 'f32',
      reads: [
        { param: 'xs', name: 'xs' },
        { param: 'ys', name: 'ys' },
      ],
    });
    expect(loop!.uniforms.map((u) => u.name)).toEqual(['a', '_start']);
    const glsl = emitGlslModule(loop!.module, 'fragment');
    // One texel per iteration: the write is the fragment's output, a `continue` its discard.
    expect(glsl).toContain('_ret = floatBitsToUint(');
    expect(glsl).toContain('discard;');
    expect(glsl).toContain('uniform sampler2D xs;');
  });

  it.each([
    [
      'a reduction',
      `export function total(xs: array<f32>): f32 { let s = 0.; for (const x of xs) { s += x; } return s; }`,
      'total',
      'loop 1 reduces, which WebGL2 has no workgroup memory for',
    ],
    [
      'a write other than at i',
      `export function odds(out: array<f32>) { for (let i: u32 = 0; i < 8; i++) { out[i * 2] = 1.; } }`,
      'odds',
      'loop 1 writes "out" other than at i',
    ],
    [
      'a struct array',
      `class P { a: vec4; }\nexport function zero(ps: array<P>) { for (let i: u32 = 0; i < ps.length; i++) { ps[i].a = vec4(0.); } }`,
      'zero',
      'loop 1 writes "ps", whose element is not one f32, i32 or u32',
    ],
    [
      'a write through a reference',
      `function bump(@inout v: f32): void { v += 1.; }\nexport function inc(out: array<f32>) { for (let i: u32 = 0; i < out.length; i++) { bump(out[i]); } }`,
      'inc',
      'loop 1 writes "out" through a reference a call takes, and WebGL2 writes its texel by an assignment',
    ],
    [
      'a struct argument',
      `class S { k: f32; }\nexport function scale(out: array<f32>, s: S) { for (let i: u32 = 0; i < out.length; i++) { out[i] = s.k; } }`,
      'scale',
      'parameter "s" is not a number or a vector, which a uniform holds',
    ],
  ])('keeps %s off WebGL2, saying why', (_name, body, fn, why) => {
    const r = compile(`"use typeshade";\n${body}\n`, { fileName: 'm.shade.ts' });
    const f = r.module.funcs.find((x) => x.name === fn)!;
    expect(
      lowerKernelGl(
        f,
        r.module,
        proveKernels(r.module).find((p) => p.fn === fn)!,
      ),
    ).toEqual({
      noWebgl2: why,
    });
  });

  it.each([
    [
      'a scatter with *',
      `export function scale(bins: array<u32>, ks: array<u32>) { for (let i: u32 = 0; i < ks.length; i++) { bins[ks[i]] *= 2; } }`,
      'scale',
      'it scatters into "bins" with *, which no atomic does',
    ],
    [
      'a scattered array another loop writes in place',
      `export function both(bins: array<u32>, ks: array<u32>) { for (let i: u32 = 0; i < bins.length; i++) { bins[i] = 0; } for (let i: u32 = 0; i < ks.length; i++) { bins[ks[i]] += 1; } }`,
      'both',
      'a loop writes "bins" in place, and another scatters into it',
    ],
    [
      'a scattered array another loop reads',
      `export function peek(bins: array<u32>, ks: array<u32>, out: array<u32>) { for (let i: u32 = 0; i < ks.length; i++) { bins[ks[i]] += 1; } for (let i: u32 = 0; i < out.length; i++) { out[i] = bins[i]; } }`,
      'peek',
      'a loop reads "bins", which a loop scatters into: an atomic is read only by an atomic',
    ],
    [
      'a statement after a reduction that a later loop replays',
      `export function norm(xs: array<f32>) { let s = 0.; for (const x of xs) { s += x; } const inv = 1. / s; for (let i: u32 = 0; i < xs.length; i++) { xs[i] = xs[i] * inv; } }`,
      'norm',
      'a statement before loop 2 reads "s", which an earlier loop reduces',
    ],
    [
      'a result that reads an element',
      `export function head(xs: array<f32>): f32 { let s = 0.; for (const x of xs) { s += x; } return s + xs[0]; }`,
      'head',
      "its result reads an array's elements, which the call computes on the CPU tier",
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

describe('what typeshade({ fuse: true }) adds to the face of a kernel function (change 0058)', () => {
  const OPS = `"use typeshade";
function act(x: f32): f32 {
  return max(x, 0.);
}
function neverCalled(x: f32): f32 {
  return x + 1.;
}
export function add(out: array<f32>, a: array<f32>, b: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i] + b[i];
  }
}
export function relu(out: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = act(x[i]);
  }
}
export function blur(out: array<f32>, t: array<f32>) {
  for (let i: u32 = 1; i < out.length - 1; i++) {
    out[i] = t[i - 1] + t[i] + t[i + 1];
  }
}
export function axpy(x: array<f32>, y: array<f32>) {
  for (let i: u32 = 0; i < y.length; i++) {
    y[i] += 2. * x[i];
  }
}
export function stride(out: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < x.length; i++) {
    out[2 * i] = x[i];
  }
}
export function skip(out: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    if (x[i] < 0.) {
      continue;
    }
    out[i] = x[i];
  }
}
export function dot(a: array<f32>, b: array<f32>): f32 {
  let s = 0.;
  for (let i: u32 = 0; i < a.length; i++) {
    s += a[i] * b[i];
  }
  return s;
}
export function histogram(xs: array<f32>, bins: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    bins[u32(xs[i])] += 1;
  }
}
export function twice(out: array<f32>, t: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = t[i];
  }
  for (let i: u32 = 1; i < out.length - 1; i++) {
    out[i] = t[i - 1] + t[i + 1];
  }
}
export function prefix(out: array<f32>) {
  for (let i: u32 = 1; i < out.length; i++) {
    out[i] = out[i] + out[i - 1];
  }
}
export function lenscale(out: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = x[i] * f32(x.length);
  }
}
export function measure(out: array<f32>, shape: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = f32(shape.length);
  }
}
export function mean(out: array<f32>, x: array<f32>) {
  const n = f32(x.length);
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = x[i] / n;
  }
}
export function reverse(out: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = x[x.length - 1 - i];
  }
}
export function sizes(out: array<f32>, a: array<f32>, b: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = f32(b.length) + f32(a.length) + f32(out.length);
  }
}
`;

  /** The face of kernel function `name`, with facts enabled or explicitly omitted. */
  const kernelFace = (source: string, name: string, fuse: boolean): KernelFace => {
    const f = hostFace(source, {
      fileName: '/app/m.shade.ts',
      runtime: RUNTIME,
      fuse,
    });
    expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const e = f.exports?.find((x) => x.name === name);
    if (e?.kind !== 'kernel') throw new Error(`${name} is ${e?.kind}`);
    return e.face;
  };
  const factsOf = (name: string) => kernelFace(OPS, name, true).fuse!.facts;
  const lineOf = (needle: string): number =>
    OPS.split('\n').findIndex((l) => l.includes(needle)) + 1;

  it('omits the record only with fuse: false, leaving the other metadata intact (0085)', () => {
    for (const name of ['add', 'dot', 'twice', 'histogram']) {
      const off = kernelFace(OPS, name, false);
      const on = kernelFace(OPS, name, true);
      expect(off.fuse).toBeUndefined();
      expect(on.fuse).toBeDefined();
      const { fuse: _fuse, ...rest } = on;
      // The loops the call dispatches carry no field of the record: the same JSON, byte for byte.
      expect(JSON.stringify(rest)).toBe(JSON.stringify(off));
    }
    const code = (fuse: boolean): string =>
      hostFace(OPS, {
        fileName: '/app/m.shade.ts',
        runtime: RUNTIME,
        fuse,
      }).code!;
    expect(code(false)).not.toMatch(/"fuse"|"iteration"|"iterates"|"continues"/);
    expect(code(true)).toContain(`"fuse":${JSON.stringify(kernelFace(OPS, 'add', true).fuse)}`);
  });

  it('writes none for a function that runs on the CPU', () => {
    const face = kernelFace(OPS, 'prefix', true);
    expect(face.noGpu).toBeDefined();
    expect(face.fuse).toBeUndefined();
  });

  it('says what a map loop reaches: each array, how, and whether at i', () => {
    expect(factsOf('add')).toEqual([
      {
        entry: 'add_loop0',
        wg: 64,
        arrays: [
          { param: 'out', access: 'write', atI: true },
          { param: 'a', access: 'read', atI: true },
          { param: 'b', access: 'read', atI: true },
        ],
        reduces: false,
        scatters: false,
        continues: false,
        iterates: 'add_loop0',
        iteration: 4,
      },
    ]);
    // An update in place reads what it writes.
    expect(factsOf('axpy')[0]!.arrays).toEqual([
      { param: 'x', access: 'read', atI: true },
      { param: 'y', access: 'readwrite', atI: true },
    ]);
  });

  it("words the first access that is not at i in the author's names, with its line", () => {
    expect(factsOf('blur')[0]!.arrays).toEqual([
      { param: 'out', access: 'write', atI: true },
      {
        param: 't',
        access: 'read',
        atI: false,
        first: { text: 't[i - 1]', line: lineOf('t[i - 1]') },
      },
    ]);
    expect(factsOf('stride')[0]!.arrays).toEqual([
      {
        param: 'out',
        access: 'write',
        atI: false,
        first: { text: 'out[2 * i]', line: lineOf('out[2 * i]') },
      },
      { param: 'x', access: 'read', atI: true },
    ]);
    // The second loop's counter is `i_1` in the IR, and `i` in the author's file.
    const [, second] = factsOf('twice');
    expect(second!.arrays[1]).toEqual({
      param: 't',
      access: 'read',
      atI: false,
      first: { text: 't[i - 1]', line: lineOf('out[i] = t[i - 1] + t[i + 1]') },
    });
  });

  it('says what the planner reads about a loop that continues, reduces or scatters', () => {
    expect(factsOf('skip')[0]).toMatchObject({ continues: true, reduces: false, iteration: 4 });
    expect(factsOf('dot')).toEqual([
      {
        entry: 'dot_loop0',
        fold: 'dot_loop0_fold',
        wg: 256,
        arrays: [
          { param: 'a', access: 'read', atI: true },
          { param: 'b', access: 'read', atI: true },
        ],
        reduces: true,
        scatters: false,
        continues: false,
        iterates: 'dot_loop0_iteration',
        iteration: 0,
      },
    ]);
    expect(factsOf('histogram')[0]).toMatchObject({
      scatters: true,
      reduces: false,
      arrays: [
        { param: 'xs', access: 'read', atI: true },
        {
          param: 'bins',
          access: 'write',
          atI: false,
          first: { text: 'bins[u32(xs[i])]', line: lineOf('bins[u32(xs[i])]') },
        },
      ],
    });
    expect(factsOf('twice').map((l) => l.entry)).toEqual(['twice_loop0', 'twice_loop1']);
  });

  it('names the arrays an iteration measures by their length, in the order of the parameters', () => {
    // An array a loop reaches by an element and also measures is in both lists.
    const lenscale = factsOf('lenscale')[0]!;
    expect(lenscale.arrays).toEqual([
      { param: 'out', access: 'write', atI: true },
      { param: 'x', access: 'read', atI: true },
    ]);
    expect(lenscale.bare).toEqual([
      { param: 'x', first: { text: 'x.length', line: lineOf('f32(x.length)') } },
    ]);
    // An array it only measures reaches no element, so it is in no fact of the arrays.
    const measure = factsOf('measure')[0]!;
    expect(measure.arrays).toEqual([{ param: 'out', access: 'write', atI: true }]);
    expect(measure.bare).toEqual([
      { param: 'shape', first: { text: 'shape.length', line: lineOf('f32(shape.length)') } },
    ]);
    // The loop's own bound is the range function's, and not the iteration's: `out.length` there
    // names nothing. `out.length` in the body does, and so do the other arrays, in parameter order.
    expect(factsOf('sizes')[0]!.bare!.map((b) => [b.param, b.first.text])).toEqual([
      ['out', 'out.length'],
      ['a', 'a.length'],
      ['b', 'b.length'],
    ]);
    expect(factsOf('add')[0]!.bare).toBeUndefined();
    expect('bare' in factsOf('add')[0]!).toBe(false);
  });

  it('names an array a statement before the loop measures, which the entry replays', () => {
    expect(factsOf('mean')[0]!.bare).toEqual([
      { param: 'x', first: { text: 'x.length', line: lineOf('const n = f32(x.length)') } },
    ]);
  });

  it('words a measure inside an index as the author wrote it, and not as the IR spells it', () => {
    const reverse = factsOf('reverse')[0]!;
    expect(reverse.bare).toEqual([
      { param: 'x', first: { text: 'x.length', line: lineOf('x[x.length - 1 - i]') } },
    ]);
    // The same measure in an access that is not at the counter, in the first access's words.
    expect(reverse.arrays[1]).toEqual({
      param: 'x',
      access: 'read',
      atI: false,
      first: { text: 'x[x.length - 1 - i]', line: lineOf('x[x.length - 1 - i]') },
    });
  });

  it('records where the record comes from, and the package version that wrote the IR', () => {
    const { fuse } = kernelFace(OPS, 'add', true);
    expect(fuse!.origin).toBe('/app/m.shade.ts');
    expect(fuse!.ir.version).toBe(VERSION);
  });

  it("carries the lowered module as IR, which the WGSL writer emits as the face's WGSL when nothing is cut", () => {
    // A helper the function calls, a reduction with its tree, a scatter, and a struct array: each
    // face's own functions are all it has, so the cut leaves the module whole.
    const sources: [string, string][] = [
      [
        'a map that calls a helper',
        `"use typeshade";
function height(p: vec2, k: vec4): f32 {
  return k.x * sin(p.x * k.y) + k.z * cos(p.y * k.w);
}
export function render(k: vec4, size: u32, out: array<f32>) {
  for (let i: u32 = 0; i < size * size; i++) {
    const p = vec2(f32(i % size), f32(i / size)) / f32(size);
    out[i] = height(p, k);
  }
}`,
      ],
      [
        'a reduction and the map beside it',
        `"use typeshade";
export function stats(xs: array<f32>, out: array<f32>): f32 {
  let s = 0.;
  let m = -1e30;
  for (let i: u32 = 0; i < xs.length; i++) {
    out[i] = xs[i] * 2.;
    s += xs[i];
    m = max(m, xs[i]);
  }
  return s / f32(xs.length) + m;
}`,
      ],
      [
        'a map with a continue, counting down',
        `"use typeshade";
export function odds(out: array<f32>, n: i32) {
  for (let i = n - 1; i >= 0; i--) {
    if (i % 2 === 0) {
      continue;
    }
    out[i * 3] = f32(i);
  }
}`,
      ],
      [
        'a scatter',
        `"use typeshade";
export function histogram(xs: array<f32>, bins: array<u32>, lo: f32, scale: f32) {
  const top = bins.length - 1;
  for (let i: u32 = 0; i < xs.length; i++) {
    const k = min(u32(max((xs[i] - lo) * scale, 0.)), top);
    bins[k] += 1;
  }
}`,
      ],
      [
        'an array of structs, in place',
        `"use typeshade";
class Particle {
  pos: vec4;
  vel: vec4;
}
export function drift(ps: array<Particle>, dt: f32) {
  for (let i: u32 = 0; i < ps.length; i++) {
    ps[i].pos = ps[i].pos + ps[i].vel * dt;
  }
}`,
      ],
      [
        'an f64 array, whose guard the writer binds',
        `"use typeshade";
export function scale(xs: array<f64>, k: f64) {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] = xs[i] * k;
  }
}`,
      ],
    ];
    for (const [what, source] of sources) {
      const f = hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME, fuse: true });
      const kernels = (f.exports ?? []).filter((e) => e.kind === 'kernel');
      expect(kernels.length, what).toBeGreaterThan(0);
      for (const e of kernels) {
        if (e.kind !== 'kernel') continue;
        // Through JSON, as the generated module carries it.
        const fuse = (JSON.parse(JSON.stringify(e.face)) as KernelFace).fuse!;
        expect(emitModule(fromPortable(fuse.ir)), `${what}: ${e.name}`).toBe(e.face.gpu!.wgsl);
      }
    }
  });

  it('cuts the helpers the loop entries do not reach, and nothing else', () => {
    const lowerOf = (name: string) => {
      const r = compile(OPS, { fileName: 'm.shade.ts' });
      const f = r.module.funcs.find((x) => x.name === name)!;
      const plan = lowerKernel(
        f,
        r.module,
        proveKernels(r.module).find((p) => p.fn === name)!,
      );
      if ('noGpu' in plan) throw new Error(plan.noGpu);
      return plan;
    };
    for (const [name, kept] of [
      ['add', ['add_loop0']],
      ['relu', ['act', 'relu_loop0']],
      ['dot', ['dot_loop0_iteration', 'dot_loop0', 'dot_loop0_fold']],
    ] as const) {
      const face = kernelFace(OPS, name, true);
      const restored = fromPortable(face.fuse!.ir);
      expect(restored.funcs.map((x) => x.name).sort(), name).toEqual([...kept].sort());
      // The module the lowering made, less the helpers no entry reaches: the same WGSL.
      const plan = lowerOf(name);
      expect(
        plan.module.funcs.map((x) => x.name),
        name,
      ).toContain('neverCalled');
      expect(emitModule(restored), name).toBe(
        emitModule({
          ...plan.module,
          funcs: plan.module.funcs.filter((x) => (kept as readonly string[]).includes(x.name)),
        }),
      );
      // And the face's own WGSL, which holds them all, is that and the cut helpers.
      expect(face.gpu!.wgsl).toContain('fn neverCalled(');
      expect(emitModule(restored)).not.toContain('fn neverCalled(');
    }
  });

  it('holds on the shipped loop examples: as before without the option, and the IR is the WGSL with it', () => {
    // The kernel functions of these three leave no helper of their file unreached.
    for (const example of ['loop-kernel', 'loop-reduction', 'loop-struct-array']) {
      const file = `${example}.shade.ts`;
      const source = readFileSync(resolve(__dirname, '../../../examples', file), 'utf8');
      const options = { fileName: `/app/${file}`, runtime: RUNTIME };
      const off = hostFace(source, { ...options, fuse: false });
      const on = hostFace(source, { ...options, fuse: true });
      expect(off.code, example).not.toMatch(/"fuse"|"iteration"|"iterates"|"continues"/);
      const kernels = (on.exports ?? []).flatMap((e) => (e.kind === 'kernel' ? [e] : []));
      expect(kernels.length, example).toBeGreaterThan(0);
      for (const e of kernels) {
        const fuse = e.face.fuse!;
        expect(emitModule(fromPortable(fuse.ir)), `${example}: ${e.name}`).toBe(e.face.gpu!.wgsl);
        expect(fuse.facts.length, e.name).toBe(e.face.gpu!.loops.length);
        expect(
          fuse.facts.map((l) => l.entry),
          e.name,
        ).toEqual(e.face.gpu!.loops.map((l) => l.entry));
      }
    }
  });
});

describe('a lane past the trip count (change 0096, Rule 8.22)', () => {
  // Verifies: Rule 8.22 (docs/language-design.md; traced in reqs/).
  const lowered = (source: string, fn: string) => {
    const r = compile(source, { fileName: 'm.shade.ts' });
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const f = r.module.funcs.find((x) => x.name === fn)!;
    const plan = lowerKernel(
      f,
      r.module,
      proveKernels(r.module).find((p) => p.fn === fn)!,
    );
    if ('noGpu' in plan) throw new Error(plan.noGpu);
    return { module: r.module, plan, wgsl: emitModule(plan.module) };
  };
  /** The function on the f32 oracle and its plan on the same oracle, for `args`: the arrays each
   *  wrote and the result, which must be the same bits. */
  const both = (source: string, fn: string, args: CpuValue[]) => {
    const { module, plan } = lowered(source, fn);
    const cpu = compileModule(module, { precision: 'f32' });
    const want = args.map(copy);
    const result = cpu.fns[fn]!(...want);
    const got = runKernelPlan(module, fn, plan, args);
    return { want: { result, arrays: want.filter((a) => Array.isArray(a)) }, got };
  };
  const SCALE = `"use typeshade";
export function scale(out: array<f32>, x: array<f32>, k: f32) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = x[i] * k;
  }
}`;
  const floats = (n: number, seed: number): number[] =>
    Array.from({ length: n }, (_, i) => Math.fround(Math.sin(i * 0.37 + seed) * 8));

  it("a map's entry: a workgroup wholly past the trip count returns as one, and a lane past it runs the last iteration with its write masked", () => {
    const { plan, wgsl } = lowered(SCALE, 'scale');
    expect(plan.loops[0]!.iteration).toBe(4);
    expect(wgsl).toContain(
      [
        'fn scale_loop0(@builtin(global_invocation_id) _gid: vec3<u32>, @builtin(num_workgroups) _nwg: vec3<u32>, @builtin(workgroup_id) _wid: vec3<u32>) {',
        '  let _k = (_gid.x + (_gid.y * (_nwg.x * 64u)));',
        '  if ((((_wid.x + (_wid.y * _nwg.x)) * 64u) >= scale_args._n)) {',
        '    return;',
        '  }',
        '  let _live = (_k < scale_args._n);',
        '  let _kc = min(_k, (scale_args._n - 1u));',
        '  let i = (scale_args._start + u32(_kc));',
        '  if (_live) {',
        '    out[i] = (x[i] * scale_args.k);',
        '  }',
        '}',
      ].join('\n'),
    );
    // The guard of the whole workgroup is the one early return.
    expect(wgsl.match(/return;/g)).toHaveLength(1);
  });

  it('a loop that reads back what it writes skips the iteration under the flag (decision D2)', () => {
    const { plan, wgsl } = lowered(
      `"use typeshade";
export function bump(out: array<f32>, k: f32) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = out[i] * k;
  }
}`,
      'bump',
    );
    const entry = plan.module.funcs.find((f) => f.name === 'bump_loop0')!;
    const [counter, rest, ...more] = entry.body.slice(plan.loops[0]!.iteration);
    expect(counter).toMatchObject({ s: 'let', name: 'i' });
    expect(rest).toMatchObject({ s: 'if', arms: [{ cond: { op: 'varref', name: '_live' } }] });
    expect(more).toEqual([]);
    expect(wgsl).toContain(
      '  let i = (bump_args._start + u32(_kc));\n  if (_live) {\n    out[i] = (out[i] * bump_args.k);\n  }\n}',
    );
  });

  it('a loop that loads a texel it stores skips the iteration under the flag (decision D2)', () => {
    const { wgsl } = lowered(
      `"use typeshade";
export function half(img: texture_storage_2d<"r32float", "read_write">, w: u32, n: u32) {
  for (let i: u32 = 0; i < n; i++) {
    textureStore(img, vec2u(i % w, i / w), textureLoad(img, vec2u(i % w, i / w)) * 0.5);
  }
}`,
      'half',
    );
    expect(wgsl).toMatch(/let i = \(half_args\._start \+ u32\(_kc\)\);\n  if \(_live\) \{\n/);
    expect(wgsl).toMatch(/textureStore\(img, [^\n]*\* 0\.5\)\);\n  \}\n\}/);
  });

  it('a loop that writes through an @inout argument of a call skips the iteration under the flag (decision D2)', () => {
    const { wgsl } = lowered(
      `"use typeshade";
function bump(@inout v: f32) { v = v + 1.; }
export function viaRef(out: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    bump(out[i]);
  }
}`,
      'viaRef',
    );
    expect(wgsl).toContain(
      '  let i = (viaRef_args._start + u32(_kc));\n  if (_live) {\n    bump(&out[i]);\n  }\n}',
    );
  });

  it('a texel store with no load of the texture keeps the clamped form, its store masked', () => {
    const { wgsl } = lowered(
      `"use typeshade";
export function fill(img: texture_storage_2d<"r32float", "write">, w: u32, n: u32) {
  for (let i: u32 = 0; i < n; i++) {
    textureStore(img, vec2u(i % w, i / w), vec4f(f32(i)));
  }
}`,
      'fill',
    );
    expect(wgsl).toMatch(
      /let i = \(fill_args\._start \+ u32\(_kc\)\);\n  if \(_live\) \{\n    textureStore\(img, /,
    );
  });

  it('the plan gives the bits of the function for a partial last workgroup: a map, a reduction, a push', () => {
    // 100 elements in workgroups of 64: the second holds 28 lanes past the trip count.
    const map = both(SCALE, 'scale', [floats(100, 1), floats(100, 2), 1.5]);
    expect(map.got).toEqual(map.want);
    // 300 elements in the tree of 256: the second workgroup holds 212 lanes past it.
    const sum = both(
      `"use typeshade";
export function total(xs: array<f32>): f32 {
  let s = 0.;
  for (let i: u32 = 0; i < xs.length; i++) {
    s += xs[i];
  }
  return s;
}`,
      'total',
      [floats(300, 3)],
    );
    expect(sum.got).toEqual(sum.want);
    expect(Object.is(sum.got.result, sum.want.result)).toBe(true);
    const push = both(
      `"use typeshade";
export function strong(xs: array<f32>, t: f32, out: array<u32>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] > t) {
      out.push(i);
    }
  }
  return out.length;
}`,
      'strong',
      [floats(100, 4), 0.5, new Array<number>(100).fill(0)],
    );
    expect(push.got).toEqual(push.want);
  });

  it('the plan gives the bits of the function when the grid spills into y, where whole workgroups lie past the trip count', () => {
    // Workgroups of one lane: 65,537 iterations are a grid of 65,535 by 2, whose second row holds
    // one lane within the trip count and 65,533 workgroups wholly past it.
    const { got, want } = both(
      `"use typeshade";
@workgroup_size([1])
export function ramp(out: array<f32>, k: f32) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = f32(i) * k;
  }
}`,
      'ramp',
      [new Array<number>(65537).fill(0), 0.25],
    );
    expect(got).toEqual(want);
  });
});
