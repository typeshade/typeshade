import { describe, expect, it } from 'vitest';
import type { CpuValue } from '../cpu-runtime.js';
import { moduleOf, steppedResult } from '../testing/stepped-run.js';
import { dispatchCompute } from './dispatch.js';
import { dispatchPhased } from './phased.js';

const KERNELS = `"use typeshade";
let acc: f32 = 0.;
declare const out: storage<array<f32>, "read_write">;
declare const mats: storage<array<mat2x2>, "read_write">;
declare const k: override<f32>;
let tile: workgroup<array<f32, 4>>;
@compute([4, 1, 1]) export function keepsPrivate(lid: builtin<"local_invocation_id">): void {
  acc = f32(lid.x) + 1.;
  tile[lid.x] = acc;
  workgroupBarrier();
  out[lid.x] = acc + tile[(lid.x + 1) % 4];
}
@compute([2, 1, 1]) export function writesColumn(gid: builtin<"global_invocation_id">): void {
  mats[gid.x][1] = vec2(f32(gid.x), 7.);
}
@compute([2, 1, 1]) export function racesOnColumn(gid: builtin<"global_invocation_id">): void {
  if (gid.x === 0) {
    mats[0][1] = vec2(5., 5.);
  }
  out[gid.x] = mats[0][1].x;
}
@compute([1, 1, 1]) export function readsOverride(gid: builtin<"global_invocation_id">): void {
  out[0] = k * 2.;
}
`;

const PASSING = `"use typeshade";
let G: array<f32, 2> = [1., 2.];
function f(a: array<f32, 2>): f32 {
  G[0] = 9.;
  return a[0];
}
export function t(): f32 {
  return f(G);
}
`;

const phased = (entry: string, bindings: Record<string, CpuValue>): Record<string, CpuValue> => {
  dispatchPhased(moduleOf(KERNELS), entry, 1, bindings);
  return bindings;
};

describe('a phased dispatch keeps what a pass undoes and redoes apart from what it must not', () => {
  it('keeps a private variable across a barrier', () => {
    expect(phased('keepsPrivate', { out: [0, 0, 0, 0] }).out).toEqual([3, 5, 7, 5]);
  });

  it('writes a matrix column of storage memory', () => {
    expect(
      phased('writesColumn', {
        mats: [
          [0, 0, 0, 0],
          [0, 0, 0, 0],
        ],
      }).mats,
    ).toEqual([
      [0, 0, 0, 7],
      [0, 0, 1, 7],
    ]);
  });
});

describe('a pass of a phased dispatch', () => {
  it('reads a matrix column as the pass began, and its own write as written', () => {
    expect(phased('racesOnColumn', { out: [9, 9], mats: [[0, 0, 0, 0]] }).out).toEqual([5, 0]);
  });
});

describe('a lockstep dispatch', () => {
  it('keeps a private variable across a barrier', () => {
    const bindings: Record<string, CpuValue> = { out: [0, 0, 0, 0] };
    dispatchCompute(moduleOf(KERNELS), 'keepsPrivate', 1, bindings);
    expect(bindings.out).toEqual([3, 5, 7, 5]);
  });

  it('runs an override at its default, and at the value the caller selects', () => {
    const run = (overrides?: Record<string, CpuValue>): CpuValue | undefined => {
      const bindings: Record<string, CpuValue> = { out: [0] };
      dispatchCompute(
        moduleOf(KERNELS),
        'readsOverride',
        1,
        bindings,
        overrides ? { overrides } : {},
      );
      return bindings.out;
    };
    expect(run()).toEqual([0]);
    expect(run({ k: 5 })).toEqual([10]);
  });
});

describe('a stepped call', () => {
  it('hands a function that writes a copy of an aggregate it was passed by value', () => {
    expect(steppedResult(PASSING, 't')).toBe(1);
  });
});
