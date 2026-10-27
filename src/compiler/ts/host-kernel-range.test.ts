// Verifies: Rule 8.22 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 11.8 (docs/language-design.md; traced in reqs/).
//
// A trip count the device holds (change 0094, part 1), for a loop that maps: a loop whose range,
// the statements before it, its start and its bound, reads an element of an array, or the length
// of an array an earlier loop pushed onto. The face of such a function (the range entry, the trip
// buffer, the loop's entry that reads its start and trip count there), its call on the CPU tier,
// which is the oracle, the plan on the oracle against the function, the writes past an array's end
// that every tier drops (decision D2), and what still runs on the CPU tier and why. The source is
// read by both halves: `compile()` and the language service give it no diagnostic. The recording
// device of `src/fuse.test.ts` holds the dispatches.

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

const RANGES = `"use typeshade";
export function gather(count: array<u32>, list: array<u32>, xs: array<f32>, out: array<f32>): void {
  const n: u32 = count[0];
  for (let j: u32 = 0; j < n; j++) {
    out[j] = xs[list[j]];
  }
}
export function down(count: array<u32>, out: array<i32>, k: i32): void {
  for (let j: i32 = i32(count[0]) + k; j >= 0; j -= 3) {
    out[j] = j * 7;
  }
}
export function upto(bounds: array<u32>, out: array<u32>): void {
  for (let j: u32 = bounds[0]; j <= bounds[1]; j += 2) {
    out[j] = j + 1;
  }
}
export function compact(xs: array<f32>, list: array<u32>, out: array<f32>): void {
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] > 0.) {
      list.push(i);
    }
  }
  const m = list.length;
  for (let j: u32 = 0; j < m; j++) {
    out[j] = xs[list[j]] * 2.;
  }
}
export function chain(count: array<u32>, out: array<u32>, more: array<u32>): void {
  for (let j: u32 = 0; j < count[0]; j++) {
    out[j] = j + 1;
  }
  for (let j: u32 = 0; j < out[0] + 2; j++) {
    more[j] = out[0] * 10 + j;
  }
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
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-kernel-range-'));
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

/** The function on the f32 oracle and its plan on the same oracle, for `args`. */
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

describe('a trip count the device holds, read by both halves (change 0094)', () => {
  it('compiles with no diagnostic, and the editor gives none', () => {
    expect(compile(RANGES, { fileName: 'm.shade.ts' }).diagnostics).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', RANGES);
    expect(service.getDiagnostics('m.shade.ts')).toEqual([]);
  });
});

describe('the face of a loop whose range the device holds (change 0094)', () => {
  it('writes a range entry of one invocation, and the loop reads its start and trip count from the trip buffer', () => {
    const k = kernelOf(RANGES, 'gather');
    expect(k.noGpu).toBeUndefined();
    expect(k.gpu!.loops[0]!.device).toEqual({ entry: 'gather_range0', at: 0 });
    expect(k.gpu!.loops[0]!.checks).toEqual([]);
    expect(k.gpu!.trips).toMatchObject({
      write: { name: 'gather_trips', binding: 5, rw: true },
      read: { name: 'gather_tripsIn', binding: 6, writes: false },
    });
    expect(k.gpu!.trips!.read.rw).toBeUndefined();
    const wgsl = k.gpu!.wgsl;
    expect(wgsl).toContain(
      '@group(0) @binding(5) var<storage, read_write> gather_trips: array<u32>;',
    );
    expect(wgsl).toContain('@group(0) @binding(6) var<storage, read> gather_tripsIn: array<u32>;');
    expect(wgsl).toContain(
      [
        '@compute @workgroup_size(1)',
        'fn gather_range0(@builtin(global_invocation_id) _gid: vec3<u32>, @builtin(num_workgroups) _nwg: vec3<u32>, @builtin(workgroup_id) _wid: vec3<u32>) {',
        '  let n = count[0];',
      ].join('\n'),
    );
    // The workgroup count of the loop's entry, spilling into y past 65,535 as `grid` does.
    expect(wgsl).toContain('let _rx = max(1u, min(_rg, 65535u));');
    expect(wgsl).toContain('gather_trips[2u] = _rx;');
    expect(wgsl).toContain('let _live = (_k < gather_tripsIn[1u]);');
    expect(wgsl).toContain('let j = (gather_tripsIn[0u] + u32(_kc));');
    // The write past the array's end is dropped (decision D2).
    expect(wgsl).toContain('if ((j < arrayLength(&out))) {');
    // A call whose range the device holds is a group of its own in a fuse plan: no facts.
    expect(k.fuse).toBeUndefined();
    // The host view, which the editor reads in a host file, says where it runs.
    expect(face(RANGES).view).toContain(
      "A loop whose trip count it reads from an array runs from a count the GPU computes, with nothing read back, and its writes past an array's end are dropped (Rule 8.21).",
    );
  });

  it('reads the start of an i32 counter back from its bits', () => {
    const wgsl = kernelOf(RANGES, 'down').gpu!.wgsl;
    expect(wgsl).toContain('down_trips[0u] = u32(_rs);');
    expect(wgsl).toContain('let j = (i32(down_tripsIn[0u]) - (i32(_kc) * 3));');
  });

  it('gives an array whose length a later range reads a length word, which the range entry reads', () => {
    const k = kernelOf(RANGES, 'compact');
    expect(k.noGpu).toBeUndefined();
    expect(k.gpu!.loops.map((l) => l.device)).toEqual([
      undefined,
      { entry: 'compact_range1', at: 8 },
    ]);
    expect(k.gpu!.words?.map((w) => w.param)).toEqual(['list']);
    expect(k.gpu!.wgsl).toContain('let m = compact_len0[compact_args._off0];');
  });
});

describe('a trip count the device holds on the CPU tier (change 0094)', () => {
  it('runs what the function computes, the range read from the arrays', async () => {
    const m = await load(RANGES);
    const out = new Float32Array(4).fill(-1);
    await m.gather!(Uint32Array.of(3), Uint32Array.of(2, 0, 1, 1), Float32Array.of(5, 6, 7), out);
    expect([...out]).toEqual([7, 5, 6, -1]);
    const ys = new Float32Array(4);
    const list = new Uint32Array(4);
    await m.compact!(Float32Array.of(1, -1, 3, 0), list, ys);
    expect([...ys]).toEqual([2, 6, 0, 0]);
    const [a, b] = [new Uint32Array(4), new Uint32Array(6)];
    await m.chain!(Uint32Array.of(2), a, b);
    expect([...a]).toEqual([1, 2, 0, 0]);
    expect([...b]).toEqual([10, 11, 12, 0, 0, 0]);
  });

  it('does not run a call that would write past the end through a reference (decision S3-5)', () => {
    const source = `"use typeshade";
function bump(@inout p: f32) { p = p + 1.; }
export function inc(count: array<u32>, out: array<f32>): u32 {
  for (let j: u32 = 0; j < count[0]; j++) {
    bump(out[j]);
  }
  return out.length;
}
`;
    const r = compile(source, { fileName: 'm.shade.ts' });
    const out = [1, 2];
    // The oracle is the CPU tier's code: the array is a JavaScript array, which a write past its
    // end would grow.
    expect(compileModule(r.module, { precision: 'f32' }).fns['inc']!([4], out)).toBe(2);
    expect(out).toEqual([2, 3]);
  });

  it('drops a write past the end on every tier, and the length stays the array’s (decision D2)', async () => {
    const m = await load(RANGES);
    const out = new Float32Array(2).fill(-1);
    // A trip count of 5 over an array of 2: the writes at 2, 3 and 4 are dropped.
    await m.gather!(Uint32Array.of(5), Uint32Array.of(1, 0, 0, 0, 0), Float32Array.of(5, 6), out);
    expect([...out]).toEqual([6, 5]);
    const ints = new Int32Array(5);
    // From 9 down by 3: 9 and 6 are past the end of 5.
    await m.down!(Uint32Array.of(7), ints, 2);
    expect([...ints]).toEqual([0, 0, 0, 21, 0]);
  });
});

describe('the plan of a trip count the device holds on the oracle (change 0094)', () => {
  it('writes the bits the function writes: in range, past the end, none, and down by a step', () => {
    for (const [n, list] of [
      [3, [2, 0, 1, 1]],
      [6, [0, 1, 2, 0, 1, 2]],
      [0, [0]],
    ] as const) {
      const { want, got } = both(RANGES, 'gather', [[n], [...list], [5, 6, 7], [-1, -1, -1, -1]]);
      expect(got).toEqual(want);
    }
    for (const k of [-9, -3, 0, 2, 40]) {
      const { want, got } = both(RANGES, 'down', [[7], [0, 0, 0, 0, 0], k]);
      expect(got).toEqual(want);
    }
    for (const bounds of [
      [1, 9],
      [9, 3],
      [4, 4],
    ]) {
      const { want, got } = both(RANGES, 'upto', [bounds, [0, 0, 0, 0, 0, 0]]);
      expect(got).toEqual(want);
    }
    const c = both(RANGES, 'compact', [
      [1, -1, 3, 0, 5],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ]);
    expect(c.got).toEqual(c.want);
    const d = both(RANGES, 'chain', [[3], [0, 0, 0, 0], [0, 0, 0, 0, 0, 0]]);
    expect(d.got).toEqual(d.want);
    expect(d.got.arrays[2]).toEqual([10, 11, 12, 0, 0, 0]);
  });

  it('counts the workgroups as the call’s grid does: past 65,535 into y, and none for no iteration', () => {
    const r = compile(RANGES, { fileName: 'm.shade.ts' });
    const f = r.module.funcs.find((x) => x.name === 'upto')!;
    const plan = lowerKernel(
      f,
      r.module,
      proveKernels(r.module).find((p) => p.fn === 'upto')!,
    );
    if ('noGpu' in plan) throw new Error(plan.noGpu);
    const device = compileModule(plan.module, { precision: 'f32' });
    const words = (bounds: number[]): number[] => {
      const trips = new Array<number>(8).fill(0);
      device.setBinding('upto_args', { _start: 0, _n: 0 });
      device.setBinding('bounds', bounds);
      device.setBinding('out', [0]);
      device.setBinding('upto_trips', trips);
      device.dispatch('upto_range0', [1, 1, 1]);
      return trips.slice(0, 5);
    };
    // 70,000 workgroups of 64: 65,535 by 2. From 0 to 2(n - 1) by 2 is n iterations.
    const n = 70_000 * 64;
    expect(words([0, 2 * (n - 1)])).toEqual([0, n, 65535, 2, 1]);
    // One iteration past a whole workgroup: two workgroups.
    expect(words([5, 5 + 2 * 64])).toEqual([5, 65, 2, 1, 1]);
    // No iteration: y is 0, so the indirect dispatch runs no workgroup.
    expect(words([9, 3])).toEqual([9, 0, 1, 0, 1]);
  });
});

describe('loops over a device range that still run on the CPU tier, and why (change 0094)', () => {
  it.each([
    [
      'a loop that reduces, with no cap in its bound',
      `export function sumTo(count: array<u32>, xs: array<f32>): f32 {
  let s = 0.;
  for (let j: u32 = 0; j < count[0]; j++) {
    s += xs[j];
  }
  return s;
}`,
      'sumTo',
      'loop 1 reduces "s" over a trip count it reads from an array, and its bound is no min(d, c) with c a value the host knows, for which the call sizes the partials of a reduction',
    ],
    [
      'a loop that pushes, with no cap in its bound',
      `export function keep(count: array<u32>, xs: array<f32>, list: array<u32>) {
  for (let j: u32 = 0; j < count[0]; j++) {
    if (xs[j] > 0.) {
      list.push(j);
    }
  }
}`,
      'keep',
      'loop 1 pushes onto "list" over a trip count it reads from an array, and its bound is no min(d, c) with c a value the host knows, for which the call sizes the counts of a push',
    ],
    [
      'a loop that writes what the statements before it read',
      `export function first(out: array<f32>) { const a = out[0]; for (let i: u32 = 0; i < out.length; i++) { out[i] = a; } }`,
      'first',
      'loop 1 writes "out", which the statements before it read, and each of its invocations runs those statements again',
    ],
    [
      'a loop that writes through a reference a call takes',
      `function bump(@inout p: f32) { p = p + 1.; }
export function inc(count: array<u32>, out: array<f32>) {
  for (let j: u32 = 0; j < count[0]; j++) {
    bump(out[j]);
  }
}`,
      'inc',
      'loop 1 writes "out" through a reference a call takes, over a trip count it reads from an array, and the GPU runs only an assignment over such a count',
    ],
    [
      'a function that takes a Set',
      `export function marks(count: array<u32>, seen: Set<u32>, out: array<u32>) {
  for (let j: u32 = 0; j < count[0]; j++) {
    if (seen.has(j)) {
      out[j] = 1;
    }
  }
}`,
      'marks',
      'it takes the Set "seen", and loop 1 reads its trip count from an array',
    ],
    [
      'a range that reads the length of an array a later loop pushes onto',
      `export function late(xs: array<u32>, list: array<u32>, out: array<u32>) {
  for (let j: u32 = 0; j < list.length; j++) {
    out[j] = j;
  }
  for (let i: u32 = 0; i < xs.length; i++) {
    list.push(xs[i]);
  }
}`,
      'late',
      'it reads the length of an array it pushes onto before its result, which the call knows once the loop has run',
    ],
  ])('%s', (_name, body, fn, why) => {
    const source = `"use typeshade";\n${body}\n`;
    // Both halves accept the source: the CPU tier runs it as written.
    expect(compile(source, { fileName: 'm.shade.ts' }).diagnostics).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', source);
    expect(service.getDiagnostics('m.shade.ts')).toEqual([]);
    expect(kernelOf(source, fn).noGpu).toBe(why);
    // The host view's comment says why.
    expect(face(source).view).toContain(`It runs on the CPU: ${why}.`);
  });
});
