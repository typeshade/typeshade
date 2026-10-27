// Verifies: Rule 8.22 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 11.8 (docs/language-design.md; traced in reqs/).
//
// A loop that pushes or reduces over a trip count the device holds (change 0094, part 1, stage 4):
// its bound is written `min(d, c)`, with `c` a value the host knows, and the call sizes the loop's
// scratch for `c` (decision D6). The face of such a function (the cap's CPU-tier function, the
// range entry that also writes the workgroup count of each fold level, the fold level that reads
// its count from the trip buffer, the scan that writes the length after the loop there), its call
// on the CPU tier, which is the oracle, the plan on the oracle against the function, and what
// still runs on the CPU tier and why. The source is read by both halves: `compile()` and the
// language service give it no diagnostic. The recording device of `src/fuse.test.ts` holds the
// dispatches.

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compile } from './compile.js';
import { hostFace } from './host-face.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import type { KernelFace } from '../../core/host-kernel.js';
import { compileModule, type CpuValue } from '../../core/oracle.js';
import { proveKernels } from '../../core/passes/parallel-loop.js';
import { lowerKernel } from '../../core/passes/kernel-lower.js';
import { copy, runKernelPlan } from '../../core/testing/kernel-plan.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const CAPPED = `"use typeshade";
export function keepAbove(count: array<u32>, xs: array<f32>, t: f32, list: array<u32>): void {
  const n: u32 = min(count[0], xs.length);
  for (let i: u32 = 0; i < n; i++) {
    if (xs[i] > t) {
      list.push(i);
    }
  }
}
export function countAbove(count: array<u32>, xs: array<f32>, t: f32, list: array<u32>): u32 {
  for (let i: u32 = 0; i < min(count[0], xs.length); i++) {
    if (xs[i] > t) {
      list.push(i);
    }
  }
  return list.length;
}
export function sumInto(count: array<u32>, out: array<f32>, sums: array<f32>): void {
  let s = 0.;
  let lo = 1000.;
  const n: u32 = min(count[0], out.length);
  for (let j: u32 = 0; j < n; j++) {
    s += out[j];
    lo = min(lo, out[j]);
  }
  sums[0] = s;
  sums[1] = lo;
}
export function total(count: array<u32>, xs: array<f32>): f32 {
  let s = 0.;
  for (let j: u32 = 0; j < min(count[0], xs.length); j++) {
    s += xs[j];
  }
  return s;
}
export function signed(count: array<i32>, xs: array<i32>, k: i32): i32 {
  let p: i32 = 0;
  for (let j: i32 = k; j <= min(count[0], i32(xs.length) - 1); j++) {
    p += xs[j];
  }
  return p;
}
export function wide(count: array<u32>, xs: array<f32>, m: u32, sums: array<f32>): void {
  let s = 0.;
  for (let j: u32 = 0; j < min(min(count[0], m), m + 1); j++) {
    s += xs[j % xs.length];
  }
  sums[0] = s;
}
export function again(xs: array<f32>, list: array<u32>, picks: array<u32>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] > 0.) {
      list.push(i);
    }
  }
  for (let j: u32 = 0; j < min(list.length, xs.length); j++) {
    if (list[j] % 2 == 0) {
      picks.push(list[j]);
    }
  }
  return picks.length;
}
`;

function face(source: string) {
  const f = hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f as Required<typeof f>;
}

async function load(
  source: string,
): Promise<Record<string, (...a: unknown[]) => Promise<unknown>>> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-kernel-cap-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, face(source).code);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<
    string,
    (...a: unknown[]) => Promise<unknown>
  >;
}

const kernelOf = (source: string, name: string): KernelFace => {
  const e = face(source).exports.find((x) => x.name === name);
  expect(e?.kind).toBe('kernel');
  return (e as { face: KernelFace }).face;
};

const compiled = compile(CAPPED, { fileName: 'm.shade.ts' });
const proofs = proveKernels(compiled.module);

const planOf = (fn: string) => {
  const f = compiled.module.funcs.find((x) => x.name === fn)!;
  const plan = lowerKernel(
    f,
    compiled.module,
    proofs.find((p) => p.fn === fn)!,
  );
  if ('noGpu' in plan) throw new Error(plan.noGpu);
  return plan;
};

/** The function on the f32 oracle and its plan on the same oracle, for `args`. */
function both(fn: string, args: CpuValue[]) {
  const want = args.map(copy);
  const result = compileModule(compiled.module, { precision: 'f32' }).fns[fn]!(...want);
  const got = runKernelPlan(compiled.module, fn, planOf(fn), args);
  return { want: { result, arrays: want.filter((a) => Array.isArray(a)) }, got };
}

describe('a loop that pushes or reduces over a capped device range, read by both halves (change 0094)', () => {
  it('compiles with no diagnostic, and the editor gives none', () => {
    expect(compiled.diagnostics).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', CAPPED);
    expect(service.getDiagnostics('m.shade.ts')).toEqual([]);
  });
});

describe('the face of a capped loop over a device range (change 0094, stage 4)', () => {
  it('names the cap of each loop that pushes or reduces, which the CPU-tier code holds', () => {
    for (const fn of ['keepAbove', 'countAbove', 'sumInto', 'total', 'signed', 'wide']) {
      const k = kernelOf(CAPPED, fn);
      expect(k.noGpu).toBeUndefined();
      expect(k.gpu!.loops[0]!.device).toEqual({ entry: `${fn}_range0`, at: 0, cap: `${fn}__cap0` });
      expect(face(CAPPED).code).toContain(`${fn}__cap0`);
    }
    // The second loop of `again` pushes over the length the first loop pushed, capped by xs.
    expect(kernelOf(CAPPED, 'again').gpu!.loops.map((l) => l.device)).toEqual([
      undefined,
      { entry: 'again_range1', at: 8, cap: 'again__cap1' },
    ]);
    // A loop that pushes is drawn by no WebGL2 program, and one that reduces neither (Rule 11.8).
    expect(kernelOf(CAPPED, 'keepAbove').noWebgl2).toBeDefined();
    expect(kernelOf(CAPPED, 'total').noWebgl2).toBeDefined();
  });

  it('writes the count and the workgroups of each fold level, and a level reads its count there', () => {
    const wgsl = kernelOf(CAPPED, 'sumInto').gpu!.wgsl;
    expect(wgsl).toContain('sumInto_trips[8u] = _rg;');
    expect(wgsl).toContain('let _rq0 = max(1u, ((_rg + 255u) / 256u));');
    expect(wgsl).toContain('sumInto_trips[12u] = _rq0;');
    expect(wgsl).toContain('sumInto_trips[19u] = 1u;');
    expect(wgsl).toContain('let _fn = sumInto_tripsIn[sumInto_args._n];');
    // A level of one partial or none copies it, or writes the identity, with no tree.
    expect(wgsl).toContain('if ((_fn <= 1u)) {');
    // The loop's lanes past the trip count are the device's count.
    expect(wgsl).toContain('let _live = (_k < sumInto_tripsIn[1u]);');
  });

  it('runs the scan of a push from the trip count, and writes the length after the loop there', () => {
    const wgsl = kernelOf(CAPPED, 'countAbove').gpu!.wgsl;
    expect(wgsl).toContain('let _run = ((countAbove_trips[1u] + 255u) / 256u);');
    expect(wgsl).toContain('countAbove_trips[5u] = _at;');
    expect(wgsl).toContain('let _live = (_k < countAbove_tripsIn[1u]);');
  });

  it('says in the host view that the scratch is sized for the cap', () => {
    expect(face(CAPPED).view).toContain(
      'A loop that pushes or reduces over such a count has its bound written min(d, c), and the call sizes its scratch for c (Rule 8.22).',
    );
  });
});

describe('a capped loop over a device range on the CPU tier (change 0094, stage 4)', () => {
  it('runs what the function computes, the range read from the arrays and capped by c', async () => {
    const m = await load(CAPPED);
    const xs = Float32Array.of(1, 0, 3, 4, 0);
    const list = new Uint32Array(5);
    await m.keepAbove!(Uint32Array.of(4), xs, 0.5, list);
    expect([...list]).toEqual([0, 2, 3, 0, 0]);
    expect(await m.countAbove!(Uint32Array.of(99), xs, 0.5, new Uint32Array(5))).toBe(3);
    const sums = new Float32Array(2);
    await m.sumInto!(Uint32Array.of(3), xs, sums);
    expect([...sums]).toEqual([4, 0]);
    expect(await m.total!(Uint32Array.of(9), xs)).toBe(8);
    expect(await m.signed!(Int32Array.of(9), Int32Array.of(1, 2, 3), 1)).toBe(5);
    expect(await m.again!(xs, new Uint32Array(5), new Uint32Array(5))).toBe(2);
  });
});

describe('the plan of a capped loop over a device range on the oracle (change 0094, stage 4)', () => {
  it('writes and returns the bits the function does, for no iteration, one, a cap reached and a cap passed', () => {
    for (const n of [1, 5, 300, 1100]) {
      const xs = Array.from({ length: n }, (_, i) => ((i * 7) % 13) / 8 - 0.5);
      for (const c of [0, 1, 2, n - 1, n, n + 5]) {
        const cases: [string, CpuValue[]][] = [
          ['keepAbove', [[c], xs, 0.25, new Array<number>(n).fill(0)]],
          ['countAbove', [[c], xs, 0.25, new Array<number>(n).fill(0)]],
          ['sumInto', [[c], xs, [9, 9, 9]]],
          ['total', [[c], xs]],
          ['signed', [[c - 3], xs.map((x) => Math.round(x * 8)), 2]],
          ['wide', [[c], xs, Math.floor(n / 2), [0]]],
          ['again', [xs, new Array<number>(n).fill(0), new Array<number>(n).fill(0)]],
        ];
        for (const [fn, args] of cases) {
          const { want, got } = both(fn, args);
          expect(got, `${fn} n=${String(n)} c=${String(c)}`).toEqual(want);
        }
      }
    }
  });

  it('folds 70,000 iterations in two levels as the function does', () => {
    const xs = Array.from({ length: 70_000 }, (_, i) => ((i * 5) % 11) / 4);
    for (const c of [70_000, 65_537]) {
      const { want, got } = both('total', [[c], xs]);
      expect(got).toEqual(want);
    }
  });

  it('counts each fold level as the call’s levels do: past 65,535 into y, and one workgroup at least', () => {
    const plan = planOf('wide');
    const device = compileModule(plan.module, { precision: 'f32' });
    const words = (count: number, m: number): number[] => {
      const trips = new Array<number>(20).fill(0);
      device.setBinding('wide_args', { _start: 0, _n: 0, m });
      device.setBinding('count', [count]);
      device.setBinding('xs', [0]);
      device.setBinding('sums', [0]);
      device.setBinding('wide_trips', trips);
      device.dispatch('wide_range0', [1, 1, 1]);
      return trips;
    };
    // 70,000 workgroups of 256 iterations: the loop at 65,535 by 2, then 274 partials and 2.
    const n = 70_000 * 256;
    expect(words(n, n)).toEqual([
      0,
      n,
      65535,
      2,
      1,
      0,
      0,
      0,
      70000,
      274,
      1,
      1,
      274,
      2,
      1,
      1,
      2,
      1,
      1,
      1,
    ]);
    // No iteration: the loop runs no workgroup, and each level one, which writes the identity.
    expect(words(0, 7)).toEqual([0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });
});

describe('loops that push or reduce over a device range and still run on the CPU tier (change 0094, stage 4)', () => {
  const noCap = 'its bound is no min(d, c) with c a value the host knows';
  it.each([
    [
      'a bound with no cap',
      `export function f(count: array<u32>, xs: array<f32>): f32 {
  let s = 0.;
  for (let j: u32 = 0; j < count[0]; j++) {
    s += xs[j];
  }
  return s;
}`,
      `loop 1 reduces "s" over a trip count it reads from an array, and ${noCap}, for which the call sizes the partials of a reduction`,
    ],
    [
      'a loop that counts down',
      `export function f(count: array<u32>, xs: array<u32>, list: array<u32>) {
  for (let j: u32 = min(count[0], xs.length); j > 0; j--) {
    list.push(xs[j - 1]);
  }
}`,
      `loop 1 pushes onto "list" over a trip count it reads from an array, and ${noCap}, for which the call sizes the counts of a push`,
    ],
    [
      'a start that reads an element',
      `export function f(count: array<u32>, xs: array<f32>): f32 {
  let s = 0.;
  for (let j: u32 = count[1]; j < min(count[0], xs.length); j++) {
    s += xs[j];
  }
  return s;
}`,
      `loop 1 reduces "s" over a trip count it reads from an array, and ${noCap}, for which the call sizes the partials of a reduction`,
    ],
    [
      'a cap read through a mutable local',
      `export function f(count: array<u32>, xs: array<f32>, sums: array<f32>) {
  let s = 0.;
  let c: u32 = xs.length;
  for (let j: u32 = 0; j < min(count[0], c); j++) {
    s += xs[j];
  }
  sums[0] = s;
}`,
      `loop 1 reduces "s" over a trip count it reads from an array, and ${noCap}, for which the call sizes the partials of a reduction`,
    ],
  ])('%s', (_name, body, why) => {
    const source = `"use typeshade";\n${body}\n`;
    // Both halves accept the source: the CPU tier runs it as written.
    expect(compile(source, { fileName: 'm.shade.ts' }).diagnostics).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', source);
    expect(service.getDiagnostics('m.shade.ts')).toEqual([]);
    expect(kernelOf(source, 'f').noGpu).toBe(why);
    // The host view's comment says why.
    expect(face(source).view).toContain(`It runs on the CPU: ${why}.`);
  });
});
