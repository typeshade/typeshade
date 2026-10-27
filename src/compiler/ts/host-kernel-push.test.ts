// Verifies: Rule 8.21 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.22 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 11.8 (docs/language-design.md; traced in reqs/).
//
// `out.push(v)` in a kernel function's loop (change 0078): the face of the function, its WGSL,
// and its call on the CPU tier, which is the oracle. A push after a held length (change 0094,
// part 2): `{ array, length, offset? }`, read by both halves (`compile()` and the language
// service, the host view under `tsc` and in the editor), the second WGSL text, the call on the CPU
// tier, each refusal, two loops that push onto one array, and the plan on the oracle against the
// function. The recording device of `src/fuse.test.ts` holds the dispatches.

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
import type { CpuValue } from '../../core/cpu-runtime.js';
import { proveKernels } from '../../core/passes/parallel-loop.js';
import { lowerKernel } from '../../core/passes/kernel-lower.js';
import { runKernelHeld, runKernelPlan, type HeldLengths } from '../../core/testing/kernel-plan.js';
import { tscDiagnostics } from '../../core/testing/tsc-diagnostics.js';
// A device's fuse() runs through the planner `typeshade/fuse` loads (change 0071).
import '../../fuse.js';

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

async function load(source: string): Promise<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-kernel-push-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, face(source).code);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>;
}

const kernelOf = (f: ReturnType<typeof face>, name: string): KernelFace => {
  const e = f.exports.find((x) => x.name === name);
  expect(e?.kind).toBe('kernel');
  return (e as { face: KernelFace }).face;
};

const STRONG = `"use typeshade";
export function strong(xs: array<f32>, t: f32, out: array<u32>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] > t) {
      out.push(i);
    }
  }
  return out.length;
}
`;

const TWICE = `"use typeshade";
export function twice(xs: array<u32>, out: array<u32>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] % 2 == 0) {
      out.push(xs[i]);
      out.push(xs[i] * 10);
    }
  }
  return out.length;
}
`;

describe('the face of a kernel function that pushes (change 0078)', () => {
  it('writes the pushed array, and runs on WebGPU in three steps: count, scan, store', () => {
    const k = kernelOf(face(STRONG), 'strong');
    expect(k.params.find((p) => p.name === 'out')).toMatchObject({ k: 'array', writes: true });
    expect(k.noGpu).toBeUndefined();
    const loop = k.gpu!.loops[0]!;
    expect([loop.entry, loop.push?.count, loop.push?.scan, loop.push?.binding.name]).toEqual([
      'strong_loop0',
      'strong_loop0_counts',
      'strong_loop0_scan',
      'strong_loop0_push',
    ]);
    // The pushed array and the counts are no array the host passes: the face binds the counts.
    expect(k.gpu!.arrays.map((b) => b.name)).toEqual(['xs', 'out']);
    const wgsl = k.gpu!.wgsl;
    // A lane past the trip count counts the last iteration and stores no count (change 0096).
    expect(wgsl).toContain('let _cnt = strong_loop0_count(_kc);');
    expect(wgsl).toContain('if (_live) {\n    strong_loop0_push[_k] = _cnt;');
    expect(wgsl).toContain('strong_loop0_push[strong_args._n] = _at;');
    expect(wgsl).toContain('if ((_p < arrayLength(&out))) {');
    expect(k.noWebgl2).toBe(
      'loop 1 pushes onto an array, which the WebGL2 tier does not run (change 0078)',
    );
  });

  it('carries no fuse record, so a fuse plan runs the call in a group of its own', () => {
    const f = hostFace(STRONG, { fileName: '/app/m.shade.ts', runtime: RUNTIME, fuse: true });
    const e = f.exports?.find((x) => x.name === 'strong') as { face: KernelFace };
    expect(e.face.fuse).toBeUndefined();
  });

  it('runs on the CPU a loop whose counting step would change what it computes', () => {
    const gap = (body: string): string | undefined =>
      kernelOf(face(`"use typeshade";\n${body}\n`), 'f').noGpu;
    expect(
      gap(`export function f(xs: array<u32>, out: array<u32>, ys: array<u32>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) {
    out.push(xs[i]);
    ys.push(xs[i] * 2);
  }
  return out.length;
}`),
    ).toBe('loop 1 pushes onto "out" and "ys", and the call counts the pushes of one array a loop');
    expect(
      gap(`export function f(xs: array<u32>, out: array<u32>): u32 {
  let s: u32 = 0;
  for (let i: u32 = 0; i < xs.length; i++) {
    out.push(xs[i]);
    s += xs[i];
  }
  return s + out.length;
}`),
    ).toBe('loop 1 pushes and reduces "s", which its counting step would combine twice');
    expect(
      gap(`export function f(xs: array<u32>, out: array<u32>, ys: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    ys[i] = xs[i] + 1;
    if (ys[i] > 3) {
      out.push(ys[i]);
    }
  }
}`),
    ).toBe(
      'loop 1 pushes and reads back what it writes to "ys", which its counting step does not write',
    );
    // gate:differential, seed 24, found that the second loop appends after the first, while a
    // GPU loop's offsets started at 0 (change 0078, deviation 3). Both loops now start at the
    // array's length word, and the function lowers (change 0094).
    expect(
      gap(`export function f(xs: array<u32>, out: array<u32>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) {
    out.push(xs[i]);
  }
  for (let i: u32 = 0; i < xs.length; i++) {
    out.push(i);
  }
  return out.length;
}`),
    ).toBeUndefined();
    // A write the iteration does not read back runs in the store step, and the loop lowers.
    expect(
      gap(`export function f(xs: array<u32>, out: array<u32>, ys: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    ys[i] = xs[i] + 1;
    out.push(xs[i]);
  }
}`),
    ).toBeUndefined();
  });
});

describe('a kernel function that pushes, on the CPU tier (Rule 8.23)', () => {
  it('appends in the order of the iterations, and returns the count', async () => {
    const strong = (await load(STRONG)).strong as (...a: unknown[]) => Promise<number>;
    const xs = new Float32Array([0.9, 0.1, 0.7, 0.2, 0.8]);
    const out = new Uint32Array(8).fill(99);
    expect(await strong(xs, 0.5, out)).toBe(3);
    expect([...out]).toEqual([0, 2, 4, 99, 99, 99, 99, 99]);
  });

  it('appends nothing and returns 0 when no iteration pushes', async () => {
    const strong = (await load(STRONG)).strong as (...a: unknown[]) => Promise<number>;
    const out = new Uint32Array(4).fill(7);
    expect(await strong(new Float32Array([0.1, 0.2]), 0.5, out)).toBe(0);
    expect([...out]).toEqual([7, 7, 7, 7]);
  });

  it('stores up to the capacity, and returns the count appended past it (decision 1)', async () => {
    const strong = (await load(STRONG)).strong as (...a: unknown[]) => Promise<number>;
    const out = new Uint32Array(2);
    expect(await strong(new Float32Array([1, 1, 1, 1, 1]), 0.5, out)).toBe(5);
    expect([...out]).toEqual([0, 1]);
  });

  it('keeps the order of the statements when one iteration pushes twice', async () => {
    const twice = (await load(TWICE)).twice as (...a: unknown[]) => Promise<number>;
    const out = new Uint32Array(6);
    expect(await twice(new Uint32Array([2, 3, 4]), out)).toBe(4);
    expect([...out]).toEqual([2, 20, 4, 40, 0, 0]);
  });

  it('appends the pushes of a second loop after the first', async () => {
    const m = await load(`"use typeshade";
export function f(xs: array<u32>, out: array<u32>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) {
    out.push(xs[i]);
  }
  for (let i: u32 = 0; i < xs.length; i++) {
    out.push(i);
  }
  return out.length;
}
`);
    const out = new Uint32Array(5);
    expect(await (m.f as (...a: unknown[]) => Promise<number>)(Uint32Array.of(7, 8, 9), out)).toBe(
      6,
    );
    expect([...out]).toEqual([7, 8, 9, 0, 1]);
  });

  it('starts each call empty', async () => {
    const strong = (await load(STRONG)).strong as (...a: unknown[]) => Promise<number>;
    const out = new Uint32Array(4);
    await strong(new Float32Array([1, 1]), 0.5, out);
    expect(await strong(new Float32Array([0, 1]), 0.5, out)).toBe(1);
    expect([...out]).toEqual([1, 1, 0, 0]);
  });
});

describe('a loop that pushes in a fuse scope (change 0078, Rule 11.13)', () => {
  // Verifies: Rule 11.13. A fuse plan gives the bits of the calls run apart, a loop that pushes
  // between two array loops among them.
  const CHAIN = `"use typeshade";
export function scale(xs: array<f32>, ys: array<f32>, k: f32) {
  for (let i: u32 = 0; i < xs.length; i++) {
    ys[i] = xs[i] * k;
  }
}
export function keep(ys: array<f32>, t: f32, out: array<u32>): u32 {
  for (let i: u32 = 0; i < ys.length; i++) {
    if (ys[i] > t) {
      out.push(i);
    }
  }
  return out.length;
}
export function mark(xs: array<f32>, zs: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    zs[i] = xs[i] + 1.;
  }
}
`;

  it('runs scale, keep and mark in one plan as they run apart, keep a group of its own', async () => {
    const { createDevice } = await import('../../runtime/device.js');
    const m = await load(CHAIN);
    const [scale, keep, mark] = [m.scale, m.keep, m.mark] as ((
      ...a: unknown[]
    ) => Promise<unknown>)[];
    const input = Float32Array.from({ length: 40 }, (_, i) => Math.sin(i) * 3);
    const run = async (fused: boolean): Promise<number[][]> => {
      const dev = await createDevice({ prefer: ['cpu'] });
      const xs = dev.array(input);
      const ys = dev.array(input.length, 'f32');
      const out = dev.array(new Uint32Array(64).fill(9));
      const zs = dev.array(input.length, 'f32');
      let count: unknown;
      if (fused) {
        const report = await dev.fuse(() => {
          void scale(xs, ys, 2);
          void keep(ys, 1.5, out).then((n) => (count = n));
          void mark(xs, zs);
        });
        // keep stands apart, so no group holds a call on each side of it.
        expect(report.groups.map((g) => g.calls)).toEqual([['scale'], ['keep'], ['mark']]);
      } else {
        // Apart: each call a plan of its own, on the same device.
        await dev.fuse(() => void scale(xs, ys, 2));
        await dev.fuse(() => void keep(ys, 1.5, out).then((n) => (count = n)));
        await dev.fuse(() => void mark(xs, zs));
      }
      const got = [
        [count as number],
        [...(await ys.read())],
        [...(await out.read())],
        [...(await zs.read())],
      ];
      await dev.dispose();
      return got;
    };
    const apart = await run(false);
    expect(await run(true)).toEqual(apart);
    // The count and the indices a sequential run appends.
    const want = [...input].flatMap((x, i) => (Math.fround(Math.fround(x) * 2) > 1.5 ? [i] : []));
    expect(apart[0]).toEqual([want.length]);
    expect(apart[2]!.slice(0, want.length)).toEqual(want);
  });
});

// ─── a push after a held length (change 0094, part 2) ─────────────────────────────────────────

const HELD = `"use typeshade";
export function keepAbove(xs: array<f32>, t: f32, list: array<u32>): void {
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] > t) {
      list.push(i);
    }
  }
}
export function keepCount(xs: array<f32>, t: f32, list: array<u32>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] > t) {
      list.push(i);
    }
  }
  return list.length;
}
export function both(xs: array<u32>, out: array<u32>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) {
    out.push(xs[i]);
  }
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] % 2 == 0) {
      out.push(i);
    }
  }
  return out.length;
}
export function keepStore(xs: array<f32>, list: array<u32>, count: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] > 0.) {
      list.push(i);
    }
  }
  count[0] = list.length;
}
`;

type Call = (...a: unknown[]) => Promise<unknown>;
const runtime = async (): Promise<typeof import('../../core/host-runtime.js')> =>
  (await import(pathToFileURL(RUNTIME).href)) as typeof import('../../core/host-runtime.js');
const words = async (r: { read(): Promise<unknown> }): Promise<number[]> => [
  ...((await r.read()) as Uint32Array),
];

describe('a push after a held length, read by both halves (change 0094)', () => {
  it('compiles with no diagnostic, and the editor gives none', () => {
    expect(compile(HELD, { fileName: 'm.shade.ts' }).diagnostics).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', HELD);
    expect(service.getDiagnostics('m.shade.ts')).toEqual([]);
  });

  it('types a pushed array with its held length, and no other array, under tsc and in the editor (decision D5)', async () => {
    const f = face(HELD);
    const held =
      '{ readonly array: Uint32Array | Resident<Uint32Array>; readonly length: Resident<Uint32Array>; readonly offset?: number }';
    expect(f.view).toContain(
      `export declare function keepAbove(xs: Float32Array | Resident<Float32Array>, t: number, list: Uint32Array | Resident<Uint32Array> | ${held}): Promise<void>;`,
    );
    // A call whose written arrays are all resident, and that returns nothing, only queues.
    expect(f.view).toContain(
      'export declare function keepAbove(xs: Float32Array | Resident<Float32Array>, t: number, list: Resident<Uint32Array> | { readonly array: Resident<Uint32Array>; readonly length: Resident<Uint32Array>; readonly offset?: number }): void;',
    );
    // An array no loop pushes onto takes no held length.
    expect(f.view).toContain(
      `export declare function keepStore(xs: Float32Array | Resident<Float32Array>, list: Uint32Array | Resident<Uint32Array> | ${held}, count: Uint32Array | Resident<Uint32Array>): Promise<void>;`,
    );
    expect(f.view).toContain(
      'An array it pushes onto may come as { array, length, offset? }: its pushes start at the length the Resident length holds at offset, and the call leaves the new length there (Rule 8.23).',
    );
    const dir = mkdtempSync(join(tmpdir(), 'typeshade-kernel-held-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'm.shade.ts'), HELD);
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
    // One program, one call a line: the build and the editor give each line the same codes.
    const calls = [
      ['keepAbove(xs, 0.5, { array: list, length: count });', []],
      [
        'export const n: number = await keepCount(xs, 0.5, { array: new Uint32Array(8), length: count, offset: 1 });',
        [],
      ],
      ['keepAbove(xs, 0.5, { array: list, length: new Uint32Array(1) });', ['TS2769']],
      ['keepAbove(xs, 0.5, { array: list, length: count, offset: "1" });', ['TS2769']],
      ['keepAbove({ array: xs, length: count }, 0.5, list);', ['TS2769']],
    ] as const;
    const head = `import { keepAbove, keepCount } from './m.shade.ts';\nimport { resident } from ${JSON.stringify(RUNTIME)};\nconst xs = new Float32Array(4);\nconst list = resident(new Uint32Array(8));\nconst count = resident(new Uint32Array(2));\n`;
    const text = `${head}${calls.map(([call]) => call).join('\n')}\nexport {};\n`;
    const first = head.split('\n').length;
    const want = calls.map(([call, codes]) => `${call}: ${codes.join(' ')}`);
    const app = join(dir, 'app.ts');
    writeFileSync(app, text);
    const byLine = (found: readonly { code: number; line?: number | undefined }[]): string[] =>
      calls.map(
        ([call], i) =>
          `${call}: ${found
            .filter((d) => d.line === first + i)
            .map((d) => `TS${d.code}`)
            .join(' ')}`,
      );
    const tsc = await tscDiagnostics([app], options);
    expect(tsc.filter((d) => d.fileName !== app)).toEqual([]);
    expect(byLine(tsc)).toEqual(want);
    // The editor reads the same files as the build.
    const editor = ts.createLanguageService({
      getScriptFileNames: () => [app],
      getScriptVersion: () => '1',
      getScriptSnapshot: (file) => {
        const body = file === app ? text : ts.sys.readFile(file);
        return body === undefined ? undefined : ts.ScriptSnapshot.fromString(body);
      },
      getCurrentDirectory: () => dir,
      getCompilationSettings: () => options,
      getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
      fileExists: (file) => file === app || ts.sys.fileExists(file),
      readFile: (file) => (file === app ? text : ts.sys.readFile(file)),
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
    });
    const sf = editor.getProgram()!.getSourceFile(app)!;
    const edited = [...editor.getSyntacticDiagnostics(app), ...editor.getSemanticDiagnostics(app)];
    expect(
      byLine(
        edited.map((d) => ({
          code: d.code,
          line:
            d.start === undefined ? undefined : sf.getLineAndCharacterOfPosition(d.start).line + 1,
        })),
      ),
    ).toEqual(want);
    // The editor's hover on the call shows the held length.
    const info = editor.getQuickInfoAtPosition(app, text.indexOf('keepAbove(xs') + 1);
    expect(ts.displayPartsToString(info?.displayParts).replace(/\s+/g, ' ')).toContain(
      'list: Resident<Uint32Array> | { readonly array: Resident<Uint32Array>; readonly length: Resident<Uint32Array>; readonly offset?: number; }): void (+1 overload)',
    );
  });
});

describe('the face of a push after a held length (change 0094)', () => {
  it('marks the arrays a loop pushes onto, and only those (decision D5)', () => {
    const f = face(HELD);
    const pushed = (name: string): string[] =>
      kernelOf(f, name).params.flatMap((p) =>
        p.k === 'array' && p.pushed === true ? [p.name] : [],
      );
    expect(pushed('keepAbove')).toEqual(['list']);
    expect(pushed('both')).toEqual(['out']);
    expect(pushed('keepStore')).toEqual(['list']);
    expect(
      kernelOf(face(TWICE), 'twice').params.map((p) => p.k === 'array' && p.pushed === true),
    ).toEqual([false, true]);
  });

  it('gives a call with a held length a second WGSL text, and leaves the first as it was', () => {
    const k = kernelOf(face(HELD), 'keepAbove');
    const g = k.gpu!;
    // The first text: the pushes start at 0, as they always did (the Exclusions of change 0094).
    expect(g.words).toBeUndefined();
    expect(g.wgsl).not.toContain('_len0');
    expect(g.wgsl).toContain('var _acc: u32 = 0u;');
    // The second: the first invocation of the scan starts at the word and writes the new length.
    const held = g.held!;
    expect(held.wgsl).toContain(
      '@group(0) @binding(4) var<storage, read_write> keepAbove_len0: array<u32>;',
    );
    expect(held.wgsl).toContain('var _acc: u32 = keepAbove_len0[keepAbove_args._off0];');
    expect(held.wgsl).toContain('keepAbove_len0[keepAbove_args._off0] = _acc;');
    expect(held.words).toMatchObject([
      {
        param: 'list',
        field: '_off0',
        loops: [0],
        binding: { name: 'keepAbove_len0', binding: 4, rw: true },
      },
    ]);
    // The same loops and bindings, and one more field in the uniform.
    expect(held.args.layout).toMatchObject({ k: 'o' });
    expect(JSON.stringify(held.args.layout)).toContain('"_off0"');
    expect(JSON.stringify(g.args.layout)).not.toContain('"_off0"');
  });

  it('lowers two loops that push onto one array, the second from the length the first leaves (change 0078, deviation 3)', () => {
    const k = kernelOf(face(HELD), 'both');
    expect(k.noGpu).toBeUndefined();
    const g = k.gpu!;
    expect(g.words).toMatchObject([{ param: 'out', field: '_off0', loops: [0, 1] }]);
    // Every pushed array has its word already: a held length runs the same text.
    expect(g.held).toBeUndefined();
    expect(g.wgsl.match(/var _acc: u32 = both_len0\[both_args\._off0\];/g)).toHaveLength(2);
    expect(g.wgsl.match(/both_len0\[both_args\._off0\] = _acc;/g)).toHaveLength(2);
  });

  it('reads the length a store after the loops stores from the array’s word', () => {
    const k = kernelOf(face(HELD), 'keepStore');
    expect(k.noGpu).toBeUndefined();
    expect(k.gpu!.words).toMatchObject([{ param: 'list', loops: [0] }]);
    expect(k.gpu!.wgsl).toContain(
      'if ((0u < arrayLength(&count))) {\n    count[0] = keepStore_len0[keepStore_args._off0];',
    );
  });
});

describe('a push after a held length on the CPU tier (change 0094, Rule 8.23)', () => {
  it('appends after the held length, and leaves the new length in the word', async () => {
    const m = (await load(HELD)) as Record<string, Call>;
    const rt = await runtime();
    const xs = Float32Array.of(0.9, 0.1, 0.7, 0.2, 0.8);
    const list = new Uint32Array(8).fill(99);
    const count = rt.resident(new Uint32Array([0, 3, 0]));
    await m.keepAbove!(xs, 0.5, { array: list, length: count, offset: 1 });
    expect([...list]).toEqual([99, 99, 99, 0, 2, 4, 99, 99]);
    expect(await words(count)).toEqual([0, 6, 0]);
    // `offset` is 0 when left out; the result is the new length; a count past the capacity counts.
    const c0 = rt.resident(new Uint32Array([6]));
    expect(await m.keepCount!(xs, 0.5, { array: list, length: c0 })).toBe(9);
    expect([...list]).toEqual([99, 99, 99, 0, 2, 4, 0, 2]);
    expect(await words(c0)).toEqual([9]);
    // A held length past the capacity stores nothing, and still counts.
    const far = rt.resident(new Uint32Array([20]));
    expect(await m.keepCount!(xs, 0.5, { array: list, length: far })).toBe(23);
    expect([...list]).toEqual([99, 99, 99, 0, 2, 4, 0, 2]);
    // The array may be a Resident too, and a zeroed length starts at 0.
    const r = rt.resident(new Uint32Array(4));
    const z = rt.resident(1, 'u32');
    await m.keepAbove!(xs, 0.5, { array: r, length: z });
    expect(await words(r)).toEqual([0, 2, 4, 0]);
    expect(await words(z)).toEqual([3]);
  });

  it('appends the second loop after the first, from the held length', async () => {
    const m = (await load(HELD)) as Record<string, Call>;
    const rt = await runtime();
    const out = new Uint32Array(8);
    const n = rt.resident(new Uint32Array([2]));
    // Loop 1 appends 7, 8, 9 after 2; loop 2 appends the index of each even value.
    expect(await m.both!(Uint32Array.of(7, 8, 9), { array: out, length: n })).toBe(6);
    expect([...out]).toEqual([0, 0, 7, 8, 9, 1, 0, 0]);
    expect(await words(n)).toEqual([6]);
  });

  it('stores the length that a store after the loops reads, from the held length', async () => {
    const m = (await load(HELD)) as Record<string, Call>;
    const rt = await runtime();
    const list = new Uint32Array(4);
    const count = new Uint32Array(1);
    await m.keepStore!(Float32Array.of(1, -1, 2), list, count);
    expect([...count]).toEqual([2]);
    const held = rt.resident(new Uint32Array([1]));
    await m.keepStore!(Float32Array.of(1, -1, 2), { array: list, length: held }, count);
    expect([...list]).toEqual([0, 0, 2, 0]);
    expect([...count]).toEqual([3]);
    expect(await words(held)).toEqual([3]);
  });
});

describe('the refusals of a held length, before anything runs (change 0094)', () => {
  it.each([
    [
      'on an array no loop pushes onto (decision D5)',
      (r: Held) => ['keepAbove', { array: r.xs, length: r.count }, 0.5, r.list],
      'keepAbove(): parameter "xs" is an array no loop pushes onto, so it takes no { array, length, offset? }. Pass the array itself.',
    ],
    [
      'a length that is no Resident',
      (r: Held) => ['keepAbove', r.xs, 0.5, { array: r.list, length: new Uint32Array(1) }],
      'keepAbove(): "list.length" is a Resident<Uint32Array> that holds the length of "list"; got a Uint32Array.',
    ],
    [
      'a Resident of another array',
      (r: Held) => ['keepAbove', r.xs, 0.5, { array: r.list, length: r.floats }],
      'keepAbove(): "list.length" is a Resident<Uint32Array>; got a Resident of a Float32Array.',
    ],
    [
      'an offset that is no whole number',
      (r: Held) => ['keepAbove', r.xs, 0.5, { array: r.list, length: r.count, offset: 0.5 }],
      'keepAbove(): "list.offset" counts elements of "list.length", so it is a whole number from 0; got 0.5.',
    ],
    [
      'a negative offset',
      (r: Held) => ['keepAbove', r.xs, 0.5, { array: r.list, length: r.count, offset: -1 }],
      'keepAbove(): "list.offset" counts elements of "list.length", so it is a whole number from 0; got -1.',
    ],
    [
      'an offset past the array',
      (r: Held) => ['keepAbove', r.xs, 0.5, { array: r.list, length: r.count, offset: 2 }],
      'keepAbove(): "list.offset" is 2, and the length at it needs 3 elements; "list.length" holds 2.',
    ],
    [
      'a length that is another argument',
      (r: Held) => ['keepStore', r.xs, { array: r.list, length: r.count }, r.count],
      'keepStore(): "list.length" is the same resident array as parameter "count".',
    ],
    [
      'a length that is the array itself',
      (r: Held) => ['keepAbove', r.xs, 0.5, { array: r.count, length: r.count }],
      'keepAbove(): "list.length" is the same resident array as parameter "list".',
    ],
  ] as const)('%s', async (_name, args, message) => {
    const m = (await load(HELD)) as Record<string, Call>;
    const rt = await runtime();
    const r: Held = {
      xs: rt.resident(Float32Array.of(1, 2)),
      list: new Uint32Array(4).fill(9),
      count: rt.resident(new Uint32Array(2)),
      floats: rt.resident(new Float32Array(1)),
    };
    const [fn, ...rest] = args(r) as unknown as readonly [string, ...unknown[]];
    await expect(m[fn]!(...rest)).rejects.toThrow(new TypeError(message));
    // Nothing ran: the array is as it was.
    expect([...r.list]).toEqual([9, 9, 9, 9]);
  });

  it('refuses a destroyed length, an object with another key, a length of another owner and a scratch array', async () => {
    const m = (await load(HELD)) as Record<string, Call>;
    const rt = await runtime();
    const xs = Float32Array.of(1, 2);
    const list = new Uint32Array(4);
    const gone = rt.resident(new Uint32Array(1));
    gone.destroy();
    await expect(m.keepAbove!(xs, 0.5, { array: list, length: gone })).rejects.toThrow(
      new TypeError(
        'keepAbove(): "list.length": this Resident was destroyed; make a new one with resident().',
      ),
    );
    // A refused call leaves its error on the length, which it writes, for read() to throw.
    const kept = rt.resident(new Uint32Array(1));
    await expect(m.keepAbove!(xs, 0.5, { array: list, length: kept, offset: 1 })).rejects.toThrow(
      TypeError,
    );
    await expect(kept.read()).rejects.toThrow(
      'keepAbove(): "list.offset" is 1, and the length at it needs 2 elements; "list.length" holds 1.',
    );
    // Another key makes it no held length: the array's own check refuses it as a wrong value.
    const count = rt.resident(new Uint32Array(1));
    await expect(m.keepAbove!(xs, 0.5, { array: list, length: count, extra: 1 })).rejects.toThrow(
      /^keepAbove\(\): parameter "list" \(array<u32>\): /,
    );
    const { createDevice } = await import('../../runtime/device.js');
    const [a, b] = [
      await createDevice({ prefer: ['cpu'] }),
      await createDevice({ prefer: ['cpu'] }),
    ];
    try {
      await expect(
        m.keepAbove!(xs, 0.5, {
          array: a.array(new Uint32Array(4)),
          length: b.array(new Uint32Array(1)),
        }),
      ).rejects.toThrow(
        /^keepAbove\(\): "list\.length" belongs to .*, while parameter "list" belongs to .*\. A call takes resources from one owner\.$/,
      );
      await expect(
        a.fuse((scope) => {
          void m.keepAbove!(xs, 0.5, {
            array: a.array(new Uint32Array(4)),
            length: scope.scratch(1, 'u32'),
          });
        }),
      ).rejects.toThrow(
        new TypeError(
          'keepAbove(): "list.length" is a scratch array of fuse(), which the host never reads. Make the length with resident() or device.array().',
        ),
      );
      // Inside a device's scope, a length of another owner is refused as the call is recorded.
      expect(() =>
        a.fuse(() => {
          void m.keepAbove!(xs, 0.5, {
            array: a.array(new Uint32Array(4)),
            length: b.array(new Uint32Array(1)),
          });
        }),
      ).not.toThrow();
    } finally {
      await a.dispose();
      await b.dispose();
    }
  });
});

interface Held {
  readonly xs: unknown;
  readonly list: Uint32Array;
  readonly count: { read(): Promise<unknown> };
  readonly floats: unknown;
}

describe('a push after a held length in a fuse scope, on the CPU tier (change 0094, Rule 11.13)', () => {
  const READER = `${HELD}
export function fromCount(count: array<u32>, out: array<u32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = count[0] + i;
  }
}
`;

  it('runs the call in a group of its own, and a later call that reads the word reads the new length', async () => {
    const m = (await load(READER)) as Record<string, Call>;
    const { createDevice } = await import('../../runtime/device.js');
    const dev = await createDevice({ prefer: ['cpu'] });
    try {
      const xs = dev.array(Float32Array.of(0.9, 0.1, 0.7));
      const list = dev.array(new Uint32Array(4));
      const count = dev.array(new Uint32Array([1]));
      const out = dev.array(new Uint32Array(3));
      const report = await dev.fuse(() => {
        void m.keepAbove!(xs, 0.5, { array: list, length: count });
        void m.fromCount!(count, out);
      });
      expect(report.groups.map((g) => g.calls)).toEqual([['keepAbove'], ['fromCount']]);
      expect(await words(list)).toEqual([0, 0, 2, 0]);
      expect(await words(count)).toEqual([3]);
      expect(await words(out)).toEqual([3, 4, 5]);
    } finally {
      await dev.dispose();
    }
  });
});

describe('the plan of a push after a held length on the oracle (change 0094)', () => {
  const r = compile(HELD, { fileName: 'm.shade.ts' });
  const planOf = (fn: string, held: boolean) => {
    const f = r.module.funcs.find((x) => x.name === fn)!;
    const plan = lowerKernel(
      f,
      r.module,
      proveKernels(r.module).find((p) => p.fn === fn)!,
      {
        held,
      },
    );
    if ('noGpu' in plan) throw new Error(plan.noGpu);
    return plan;
  };

  it('gives what the function gives, from a held length inside, at and past the capacity, and past 2^32', () => {
    const xs = [0.9, 0.1, 0.7, 0.2, 0.8];
    for (const [held, at] of [
      [0, 0],
      [2, 1],
      [6, 0],
      [9, 2],
      [0xfffffffe, 1],
    ] as const) {
      const words = [5, 5, 5];
      words[at] = held;
      const lengths = { list: { words, offset: at } };
      for (const fn of ['keepAbove', 'keepCount']) {
        const args: CpuValue[] = [xs, 0.5, [7, 7, 7, 7, 7, 7]];
        const want = runKernelHeld(r.module, fn, args, lengths);
        expect(runKernelPlan(r.module, fn, planOf(fn, true), args, undefined, lengths)).toEqual(
          want,
        );
      }
    }
    // A loop that runs no iteration leaves the held length, which the result reads.
    const empty = { list: { words: [4], offset: 0 } };
    const args: CpuValue[] = [[], 0.5, [7, 7]];
    expect(
      runKernelPlan(r.module, 'keepCount', planOf('keepCount', true), args, undefined, empty),
    ).toEqual(runKernelHeld(r.module, 'keepCount', args, empty));
    expect(runKernelHeld(r.module, 'keepCount', args, empty).result).toBe(4);
  });

  it('appends the second loop after the first with a held length and without, and stores the length', () => {
    for (const lengths of [{}, { out: { words: [3], offset: 0 } }] as HeldLengths[]) {
      const args: CpuValue[] = [
        [4, 5, 6, 8],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
      ];
      expect(
        runKernelPlan(r.module, 'both', planOf('both', false), args, undefined, lengths),
      ).toEqual(runKernelHeld(r.module, 'both', args, lengths));
    }
    for (const lengths of [{}, { list: { words: [0, 2], offset: 1 } }] as HeldLengths[]) {
      const args: CpuValue[] = [[1, -1, 2, 3], [0, 0, 0, 0], [9]];
      const plan = planOf('keepStore', Object.keys(lengths).length > 0);
      expect(runKernelPlan(r.module, 'keepStore', plan, args, undefined, lengths)).toEqual(
        runKernelHeld(r.module, 'keepStore', args, lengths),
      );
    }
  });
});
