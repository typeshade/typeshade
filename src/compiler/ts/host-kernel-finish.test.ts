// Verifies: Rule 8.22 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 11.8 (docs/language-design.md; traced in reqs/).
//
// A kernel function's stores after its loops (change 0094, part 3): the face of the function, the
// entry of one invocation that runs the stores on WebGPU after the loops, their call on the CPU
// tier, which is the oracle, the plan on the oracle against the function, a store past an array's
// end that every tier drops, a function with no loop (decision D7), and what still runs on the
// CPU tier and why. The source is read by both halves: `compile()` and the language service give
// it no diagnostic. The recording device of `src/fuse.test.ts` holds the dispatches.

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
import { emitModule } from '../../core/backends/wgsl.js';
import { copy, runKernelPlan } from '../../core/testing/kernel-plan.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const STORES = `"use typeshade";
export function sumInto(xs: array<f32>, sums: array<f32>) {
  let s = 0.;
  for (let i: u32 = 0; i < xs.length; i++) {
    s += xs[i];
  }
  sums[0] = s;
}
export function sumBoth(xs: array<f32>, sums: array<f32>): f32 {
  let s = 0.;
  for (let i: u32 = 0; i < xs.length; i++) {
    s += xs[i];
  }
  sums[1] = s;
  return s;
}
export function plan(count: array<u32>, wg: array<u32>) {
  wg[0] = (count[0] + 63) / 64;
  wg[1] = 1;
  wg[2] = 1;
}
export function past(xs: array<f32>, out: array<f32>, k: i32): u32 {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = xs[i] + 1.;
  }
  out[k] = 9.;
  out[out.length + 1] = 7.;
  return out.length;
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
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-kernel-finish-'));
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

/** The function on the f32 oracle and its plan on the same oracle, for `args`: the arrays each
 *  wrote and the result, which must be the same bits. */
function both(source: string, fn: string, args: CpuValue[]) {
  const r = compile(source, { fileName: 'm.shade.ts' });
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const f = r.module.funcs.find((x) => x.name === fn)!;
  const plan = lowerKernel(
    f,
    r.module,
    proveKernels(r.module).find((p) => p.fn === fn)!,
  );
  if ('noGpu' in plan) throw new Error(plan.noGpu);
  const want = args.map(copy);
  const result = compileModule(r.module, { precision: 'f32' }).fns[fn]!(...want);
  const got = runKernelPlan(r.module, fn, plan, args);
  return { want: { result, arrays: want.filter((a) => Array.isArray(a)) }, got, plan };
}

const floats = (n: number, seed: number): number[] =>
  Array.from({ length: n }, (_, i) => Math.fround(Math.sin(i * 0.37 + seed) * 8));

describe('stores after the loops, read by both halves (change 0094)', () => {
  it('compiles with no diagnostic, and the editor gives none', () => {
    expect(compile(STORES, { fileName: 'm.shade.ts' }).diagnostics).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', STORES);
    expect(service.getDiagnostics('m.shade.ts')).toEqual([]);
  });
});

describe('the face of a kernel function that stores after its loops (change 0094)', () => {
  it('runs the stores in an entry of one invocation, after the loop and its fold', () => {
    const k = kernelOf(STORES, 'sumInto');
    expect(k.noGpu).toBeUndefined();
    expect(k.gpu!.finish).toEqual({
      entry: 'sumInto_finish',
      fn: 'sumInto__finish',
      writes: ['sums'],
    });
    const wgsl = k.gpu!.wgsl;
    // Where the entry reads what the loop folded, in the uniform beside the loop's range.
    expect(wgsl).toContain('  _out: u32,\n  _at0: u32,\n}');
    expect(wgsl).toContain(
      [
        '@compute @workgroup_size(1)',
        'fn sumInto_finish(@builtin(global_invocation_id) _gid: vec3<u32>, @builtin(num_workgroups) _nwg: vec3<u32>, @builtin(workgroup_id) _wid: vec3<u32>) {',
        '  var s: f32 = 0.0;',
        '  var _f0_s: f32 = bitcast<f32>(2147483648u);',
        '  if ((sumInto_args._at0 != 4294967295u)) {',
        '    _f0_s = sumInto_loop0_s[sumInto_args._at0];',
        '  }',
        '  s = (s + _f0_s);',
        '  if ((0u < arrayLength(&sums))) {',
        '    sums[0] = s;',
        '  }',
        '}',
      ].join('\n'),
    );
    // A call that stores after its loops is a group of its own in a fuse plan: no facts.
    expect(k.fuse).toBeUndefined();
  });

  it('gives a function with no loop the entry that stores alone (decision D7)', () => {
    const k = kernelOf(STORES, 'plan');
    expect(k.noGpu).toBeUndefined();
    expect(k.gpu!.loops).toEqual([]);
    expect(k.gpu!.finish).toMatchObject({ entry: 'plan_finish', writes: ['wg'] });
    expect(k.gpu!.wgsl).toContain(
      'if ((0u < arrayLength(&wg))) {\n    wg[0] = ((count[0] + 63u) / 64u);',
    );
    // WebGL2 draws loops; with none, the CPU tier runs the stores.
    expect(k.noWebgl2).toBe('it has no loop to draw');
    // The host view, which the editor reads in a host file, says where it runs.
    expect(face(STORES).view).toContain(
      '/** A kernel function (Rule 8.22). Its stores run on the GPU in one invocation where there is WebGPU, and on the CPU otherwise.',
    );
  });

  it('draws a map on WebGL2 and runs its stores on the CPU tier after the draw', () => {
    const k = kernelOf(STORES, 'past');
    expect(k.gl).toBeDefined();
    expect(k.gpu!.finish).toMatchObject({ fn: 'past__finish', writes: ['out'] });
    // An index the guard compares as a u32: a negative one is past every array's end.
    expect(k.gpu!.wgsl).toContain('if ((u32(past_args.k) < arrayLength(&out))) {');
  });
});

describe('stores after the loops on the CPU tier (change 0094)', () => {
  it('stores what the function computes, and a stored f32 sum has the bits of the returned one', async () => {
    const m = await load(STORES);
    const xs = Float32Array.from(floats(1000, 1));
    const sums = new Float32Array(2);
    await m.sumInto!(xs, sums);
    const r = (await m.sumBoth!(xs, sums)) as number;
    expect(Object.is(sums[0], sums[1])).toBe(true);
    expect(Object.is(sums[1], Math.fround(r))).toBe(true);
    const wg = new Uint32Array(3);
    await m.plan!(new Uint32Array([130]), wg);
    expect([...wg]).toEqual([3, 1, 1]);
  });

  it('drops a store past the end on every tier, and the length stays the array’s (decision D2)', async () => {
    const m = await load(STORES);
    const out = new Float32Array(4).fill(-1);
    // `out[9]` and `out[out.length + 1]` are past the end: dropped, and `out.length` is 4.
    expect(await m.past!(Float32Array.of(1, 2, 3, 4), out, 9)).toBe(4);
    expect([...out]).toEqual([2, 3, 4, 5]);
    expect(await m.past!(Float32Array.of(1, 2, 3, 4), out, -1)).toBe(4);
    expect([...out]).toEqual([2, 3, 4, 5]);
    expect(await m.past!(Float32Array.of(1, 2, 3, 4), out, 2)).toBe(4);
    expect([...out]).toEqual([2, 3, 9, 5]);
  });
});

describe('the plan of stores after the loops on the oracle (change 0094, Rule 7.2)', () => {
  it('stores the bits the function stores: a fold of 300, one of none, and a store past the end', () => {
    for (const xs of [floats(300, 2), floats(1, 3), []]) {
      const { want, got } = both(STORES, 'sumBoth', [xs, [5, 6]]);
      expect(got).toEqual(want);
    }
    const { want, got } = both(STORES, 'past', [[1, 2, 3, 4], [-1, -1, -1, -1], 9]);
    expect(got).toEqual(want);
    expect(got.arrays[1]).toEqual([2, 3, 4, 5]);
    const d7 = both(STORES, 'plan', [[130], [0, 0, 0]]);
    expect(d7.got).toEqual(d7.want);
    expect(d7.plan.loops).toEqual([]);
    expect(emitModule(d7.plan.module)).toContain('fn plan_finish(');
  });
});

// A store of the length of an array a loop pushes onto runs on the device from stage 2 of change
// 0094: the entry reads the array's length word (`host-kernel-push.test.ts`, `keepStore`).
describe('stores after the loops that still run on the CPU tier, and why (change 0094)', () => {
  it.each([
    [
      'a store into an array a loop scatters into',
      `export function hist(ks: array<u32>, bins: array<u32>) {
  for (let i: u32 = 0; i < ks.length; i++) {
    bins[ks[i] % bins.length] += 1;
  }
  bins[0] = 0;
}`,
      'hist',
      'a statement after its loops reaches "bins", which a loop scatters into: an atomic is read and written only by an atomic',
    ],
    [
      'a store in a function that takes a Set',
      `export function unique(xs: array<u32>, seen: Set<u32>, out: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    seen.add(xs[i]);
  }
  out[0] = 1;
}`,
      'unique',
      'it takes the Set "seen" and stores into an array after its loops',
    ],
  ])('%s', (_name, body, fn, why) => {
    const source = `"use typeshade";\n${body}\n`;
    // Both halves accept the source: the CPU tier runs it as written.
    expect(compile(source, { fileName: 'm.shade.ts' }).diagnostics).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', source);
    expect(service.getDiagnostics('m.shade.ts')).toEqual([]);
    expect(kernelOf(source, fn).noGpu).toBe(why);
  });
});
