import { describe, it, expect } from 'vitest';
import { fromShader, toShader, type HostType } from './host-values.js';
import type { CpuValue } from './cpu-runtime.js';

const f32: HostType = { k: 'num', t: 'f32', s: 'f32' };
const u32: HostType = { k: 'num', t: 'u32', s: 'u32' };
const vec3: HostType = { k: 'vec', n: 3, e: 'f32', s: 'vec3' };
const refusal = (t: HostType, v: unknown): string => {
  try {
    toShader('f', 'p', t, v);
  } catch (e) {
    return (e as Error).message;
  }
  return 'accepted';
};

describe('the details of a refusal and of a range', () => {
  it('takes the largest u32 and refuses the next whole number', () => {
    expect(toShader('f', 'p', u32, 0xffffffff)).toBe(0xffffffff);
    expect(refusal(u32, 0x100000000)).toBe(
      'f(): parameter "p" (u32): got 4294967296, which is not a whole number in the u32 range.',
    );
  });

  it('names the class of a typed array that does not fit', () => {
    expect(refusal(u32, new Uint8Array(2))).toBe('f(): parameter "p" (u32): got a Uint8Array.');
    expect(refusal(u32, new Float64Array(2))).toBe('f(): parameter "p" (u32): got a Float64Array.');
  });

  it('names the length of a typed array of the wrong length, and of an array', () => {
    expect(refusal(vec3, new Float32Array(2))).toBe(
      'f(): parameter "p" (vec3): got a Float32Array of length 2.',
    );
    expect(refusal(vec3, [1, 2])).toBe('f(): parameter "p" (vec3): got an array of length 2.');
  });

  it('holds a private field of a struct under its name without the prefix', () => {
    const t: HostType = {
      k: 'struct',
      f: [
        ['#x', f32],
        ['y', f32],
      ],
      s: 'Cell',
    };
    expect(toShader('f', 'p', t, { '#x': 1, y: 2 })).toEqual({ x: 1, y: 2 });
    expect(fromShader(t, { x: 1, y: 2 } as unknown as CpuValue)).toEqual({ '#x': 1, y: 2 });
  });
});
