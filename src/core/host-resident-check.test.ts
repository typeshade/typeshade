// ═══ The check of a call reads no element of a Resident of numbers (#717) ═══
//
// `checkEntryCall` checks each value of a call before anything runs. A binding that is no bulk
// copy (an `f64` array is never one) was dry-packed into scratch memory, element by element, on
// every call, and that held for a `Resident`, whose array is already on the device. A Resident of
// numbers or vectors is a typed array, so `byteSize` checks its type and its length and packing it
// cannot fail after that. These tests count the element reads of the check through a `Proxy`.
//
// Verifies: Rule 11.8 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { checkEntryCall } from './host-compute.js';
import type { ComputeEntry, EntryBinding, Layout } from './host-entry.js';
import { ResidentArrayState, adopt } from './resident.js';

const F64: Layout = { k: 'a', n: null, st: 8, e: { k: 's', t: 'f64' } };
const VEC2F64: Layout = { k: 'a', n: null, st: 16, e: { k: 'v', n: 2, t: 'f64', lo: 8 } };
const STRUCTS: Layout = {
  k: 'a',
  n: null,
  st: 4,
  e: { k: 'o', sz: 4, f: [['a', 0, { k: 's', t: 'f32' }]] },
};

function entry(layout: Layout, s: string): ComputeEntry {
  const xs: EntryBinding = {
    name: 'xs',
    group: 0,
    binding: 0,
    space: 'storage',
    writes: false,
    layout,
    s,
  };
  return {
    name: 'k',
    fn: 'k',
    wgsl: '',
    wg: [1, 1, 1],
    params: [],
    bindings: [xs],
    workgroupZero: {},
  };
}

/** `a` behind a `Proxy` that counts each read of an element. */
function counted<T extends object>(a: T): { value: T; reads: () => number } {
  let n = 0;
  const value = new Proxy(a, {
    get(t, k) {
      if (typeof k === 'string' && /^\d+$/.test(k)) n++;
      const v: unknown = Reflect.get(t, k, t);
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
  return { value, reads: () => n };
}

/** A `Resident` handle whose host copy is `host`, as `resident()` makes one. */
function residentOf(host: unknown): object {
  const handle = {};
  adopt(handle, new ResidentArrayState(host));
  return handle;
}

/** The message `checkEntryCall` throws for `xs`, or undefined when it takes it. */
function refusal(e: ComputeEntry, xs: unknown): string | undefined {
  try {
    checkEntryCall(e, 2, { xs }, 1);
    return undefined;
  } catch (err) {
    return (err as Error).message;
  }
}

describe('the check of a call reads no element of a Resident of numbers (#717)', () => {
  it('reads none of a large Resident<Float64Array>, and every element of a plain one', () => {
    const e = entry(F64, 'array<f64>');
    const big = counted(new Float64Array(100_000).fill(1.5));
    const checked = checkEntryCall(e, 2, { xs: residentOf(big.value) }, 1);
    expect(big.reads()).toBe(0);
    expect(checked.states.size).toBe(1);
    // A value that is no Resident is still dry-packed: every element is read once.
    const plain = counted(new Float64Array(1000));
    checkEntryCall(e, 2, { xs: plain.value }, 1);
    expect(plain.reads()).toBe(1000);
  });

  it('reads none of a Resident of f64 vectors', () => {
    const e = entry(VEC2F64, 'array<vec2<f64>>');
    const v = counted(new Float64Array(2 * 5000));
    checkEntryCall(e, 2, { xs: residentOf(v.value) }, 1);
    expect(v.reads()).toBe(0);
  });

  it('refuses a Resident of the wrong type or length with the message a plain value gets', () => {
    const f64 = entry(F64, 'array<f64>');
    const wrongType = refusal(f64, residentOf(new Float32Array(4)));
    expect(wrongType).toBe(
      'k(): binding "xs" (array<f64>): got a Float32Array, not a Float64Array.',
    );
    expect(refusal(f64, new Float32Array(4))).toBe(wrongType);
    const vec = entry(VEC2F64, 'array<vec2<f64>>');
    const wrongLength = refusal(vec, residentOf(new Float64Array(3)));
    expect(wrongLength).toBe(
      'k(): binding "xs" (array<vec2<f64>>): got 3 numbers, which is not a whole number of 2-component elements.',
    );
    expect(refusal(vec, new Float64Array(3))).toBe(wrongLength);
    expect(refusal(f64, residentOf(new Float64Array(0)))).toBe(
      'k(): binding "xs" (array<f64>): got an empty array, which WebGPU cannot bind.',
    );
  });

  it('still dry-packs a Resident of structs, whose fields can misfit', () => {
    const e = entry(STRUCTS, 'array<S>');
    expect(refusal(e, residentOf([{ a: 1 }, { b: 2 }]))).toBe(
      'k(): binding "xs" (array<S>): at [1].a, the field is missing.',
    );
    expect(refusal(e, residentOf([{ a: 1 }, { a: 2 }]))).toBeUndefined();
  });
});
