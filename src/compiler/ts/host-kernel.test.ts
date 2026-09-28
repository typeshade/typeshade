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
import { lowerKernel, lowerKernelGl } from '../../core/passes/kernel-lower.js';
import { emitGlslModule } from '../../core/backends/glsl.js';

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

  it('type-checks a host program with plain tsc, and a wrong array at the host line (no overload takes it)', () => {
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
        lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
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
        `import { render, total } from './m.shade.ts';\nimport { resident } from ${JSON.stringify(RUNTIME)};\nconst dev = resident(new Float32Array(16));\nconst queued: void = render([1, 0.5, 2, 0.25], 4, dev);\nexport const s: number = await total(dev);\nexport const img: Float32Array = await dev.read();\nvoid queued;\n`,
      ),
    ).toEqual([]);
    expect(
      errors(
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
    expect(loop).toMatchObject({ out: 'out', outScalar: 'f32', reads: ['xs', 'ys'] });
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
      'an f64 reduction',
      `export function total(xs: array<f64>): f64 { let s = f64(0.); for (const x of xs) { s += x; } return s; }`,
      'total',
      'it reduces "s", an emulated f64, which a later part of change 0013 folds on the GPU',
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
