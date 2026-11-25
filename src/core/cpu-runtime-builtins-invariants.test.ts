import { describe, expect, it } from 'vitest';
import {
  BUILTINS,
  COMPONENTWISE,
  GPU_STUBS,
  LIBM,
  TYPED_BIT_BUILTINS,
  bitBuiltin,
  compareValues,
  comparesAsF32,
  wrapValue,
  type CpuValue,
} from './cpu-runtime.js';

const call = (name: string, ...args: unknown[]): CpuValue => {
  const f = BUILTINS[name];
  if (f === undefined) throw new Error(`no builtin ${name}`);
  return f(...(args as CpuValue[]));
};
const stub = (name: string, ...args: unknown[]): CpuValue => {
  const f = GPU_STUBS[name];
  if (f === undefined) throw new Error(`no stub ${name}`);
  return f(...(args as CpuValue[]));
};
const close = (got: CpuValue, want: number[]): void => {
  const g = got as number[];
  expect(g).toHaveLength(want.length);
  want.forEach((w, i) => expect(g[i]).toBeCloseTo(w, 12));
};

describe('component-wise builtins', () => {
  it('mod is floor-mod and a scalar divisor broadcasts', () => {
    expect(call('mod', -1, 3)).toBe(2);
    expect(call('mod', [-1, 5], 3)).toEqual([2, 2]);
    expect(call('mod', [5, -1], [3, 4])).toEqual([2, 3]);
  });
  it('atan2, step and smoothstep take a scalar broadcast beside a vector', () => {
    close(call('atan2', [1, -1], 2), [Math.atan2(1, 2), Math.atan2(-1, 2)]);
    expect(call('step', 0.5, [0.2, 0.5, 0.9])).toEqual([0, 1, 1]);
    expect(call('step', [0.5, 0.1], [0.2, 0.2])).toEqual([0, 1]);
    expect(call('smoothstep', 0, 2, [0, 1, 2])).toEqual([0, 0.5, 1]);
    expect(call('smoothstep', [0, 0], [1, 2], [0.5, 1])).toEqual([0.5, 0.5]);
  });
  it('clamp returns the low bound for a NaN and broadcasts scalar bounds', () => {
    expect(call('clamp', Number.NaN, 0, 1)).toBe(0);
    expect(call('clamp', [5, -5, 0.5], -1, 2)).toEqual([2, -1, 0.5]);
    expect(call('clamp', [2, 2], [0, 3], [1, 4])).toEqual([1, 3]);
    expect(call('saturate', [2, -1, 0.5])).toEqual([1, 0, 0.5]);
  });
  it('min and max return the other operand for a NaN and accept either side as the vector', () => {
    expect(call('min', Number.NaN, 2)).toBe(2);
    expect(call('max', 2, Number.NaN)).toBe(2);
    expect(call('min', [1, 5], 3)).toEqual([1, 3]);
    expect(call('max', 3, [1, 5])).toEqual([3, 5]);
    expect(call('max', [1, 5], [2, 4])).toEqual([2, 5]);
  });
  it('mix takes a vector interpolant and scalar ends', () => {
    expect(call('mix', 0, 10, [0, 0.5, 1])).toEqual([0, 5, 10]);
    expect(call('mix', [0, 0], [10, 20], 0.5)).toEqual([5, 10]);
  });
  it('fma is component-wise and rounds once to f32', () => {
    expect(call('fma', [1, 2], [3, 4], [5, 6])).toEqual([8, 14]);
    expect(call('fma', 0.1, 1, 0)).toBe(Math.fround(0.1));
  });
  it('round ties to even and fract is exact for a negative', () => {
    expect(call('round', [0.5, 1.5, 2.5])).toEqual([0, 2, 2]);
    expect(call('fract', -0.25)).toBe(0.75);
  });
  it('length and distance accept a scalar as abs', () => {
    expect(call('length', -1.5)).toBe(1.5);
    expect(call('distance', 3, 5)).toBe(2);
    expect(call('length', [3, 4])).toBe(5);
    expect(call('distance', [0, 0], [3, 4])).toBe(5);
  });
  it('geometry builtins', () => {
    expect(call('reflect', [1, -1], [0, 1])).toEqual([1, 1]);
    expect(call('refract', [1, 0], [0, 1], 1.5)).toEqual([0, 0]);
    expect(call('refract', [0, -1], [0, 1], 1)).toEqual([0, -1]);
    expect(call('faceForward', [0, 1], [0, -1], [0, 1])).toEqual([0, 1]);
    expect(call('faceForward', [0, 1], [0, 1], [0, 1])).toEqual([-0, -1]);
    expect(call('cross', [1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    close(call('normalize', [3, 4]), [0.6, 0.8]);
  });
  it('determinant expands by cofactors for 2, 3 and 4 columns', () => {
    expect(call('determinant', [1, 2, 3, 4])).toBe(-2);
    expect(call('determinant', [1, 2, 3, 4, 5, 6, 7, 8, 10])).toBe(-3);
    expect(call('determinant', [1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4])).toBe(24);
  });
  it('entries and lanes come from the libm', () => {
    expect(COMPONENTWISE.sin.lane(1)).toBe(LIBM.sinF64(1));
    expect(call('sin', 1)).toBe(LIBM.sinF64(1));
    expect(call('exp', [1, 2])).toEqual([LIBM.expF64(1), LIBM.expF64(2)]);
  });
  it('pow follows ECMAScript for the special values', () => {
    expect(call('pow', 1, Number.NaN)).toBeNaN();
    expect(call('pow', 0, 0)).toBe(1);
    expect(call('pow', [2, 3], 3)).toEqual([8, 27]);
  });
  it('ldexp scales once, exactly, into the subnormal range', () => {
    expect(call('ldexp', 1, -1074)).toBe(5e-324);
    expect(call('ldexp', 3, -1075)).toBe(1e-323);
    expect(call('ldexp', [1, 2], 3)).toEqual([8, 16]);
  });
  it('conversions and wraps', () => {
    expect(call('i32', 4294967295)).toBe(-1);
    expect(call('u32', -1)).toBe(4294967295);
    expect(call('i32', -3.9)).toBe(-3);
    expect(call('f32', '1.5')).toBe(1.5);
    expect(call('f64', 0.1)).toBe(0.1);
    expect(call('f64Guard')).toBe(1);
    expect(call('__fround', [0.1, 1])).toEqual([Math.fround(0.1), 1]);
    expect(call('f64FromParts', 1, 0.5)).toBe(1.5);
    const parts = call('f64Parts', 0.1) as number[];
    expect(parts[0]).toBe(Math.fround(0.1));
    expect(parts[1]).toBe(Math.fround(0.1 - Math.fround(0.1)));
  });
  it('abs of the least i32 is 2^31 and wrapValue brings it back by type', () => {
    expect(call('abs', -2147483648)).toBe(2147483648);
    expect(wrapValue(2147483648, 'i32')).toBe(-2147483648);
    expect(wrapValue([2147483648, 1], 'i32')).toEqual([-2147483648, 1]);
    expect(wrapValue(-1, 'u32')).toBe(4294967295);
    const v = [1.5];
    expect(wrapValue(v, 'f32')).toBe(v);
  });
});

describe('comparisons', () => {
  it('== and != round to f32 first; the ordering ops keep f64', () => {
    expect(compareValues('==', 0.1, Math.fround(0.1), true)).toBe(true);
    expect(compareValues('==', 0.1, Math.fround(0.1), false)).toBe(false);
    expect(compareValues('!=', 0.1, Math.fround(0.1), true)).toBe(false);
    expect(compareValues('<', 1, 1 + 2 ** -30, true)).toBe(true);
    expect(compareValues('>=', 1, 1 + 2 ** -30, true)).toBe(false);
    expect(compareValues('<=', 1, 1, true)).toBe(true);
    expect(compareValues('>', 2, 1, true)).toBe(true);
  });
  it('two vectors compare to a vector of bools', () => {
    expect(compareValues('<', [1, 3], [2, 2], true)).toEqual([true, false]);
  });
  it('only f32 scalars and f32 vectors compare as f32', () => {
    expect(comparesAsF32({ kind: 'scalar', scalar: 'f32' })).toBe(true);
    expect(comparesAsF32({ kind: 'vec', n: 2, elem: 'f32' })).toBe(true);
    expect(comparesAsF32({ kind: 'scalar', scalar: 'i32' })).toBe(false);
    expect(comparesAsF32({ kind: 'vec', n: 2, elem: 'u32' })).toBe(false);
    expect(comparesAsF32({ kind: 'f64' })).toBe(false);
  });
});

describe('32-bit integer builtins', () => {
  it('the kind-dependent names are the typed set and the table holds their u32 forms', () => {
    expect([...TYPED_BIT_BUILTINS].sort()).toEqual(
      [
        'extractBits',
        'firstLeadingBit',
        'firstTrailingBit',
        'insertBits',
        'reverseBits',
        '~',
      ].sort(),
    );
    expect(call('reverseBits', 1)).toBe(2147483648);
    expect(call('~', 5)).toBe(4294967290);
  });
  it('~ reads as -6 on an i32 and 4294967290 on a u32', () => {
    expect(bitBuiltin('~', [5], 'i32')).toBe(-6);
    expect(bitBuiltin('~', [5], 'u32')).toBe(4294967290);
  });
  it('reverseBits keeps the kind of the argument', () => {
    expect(bitBuiltin('reverseBits', [1], 'u32')).toBe(2147483648);
    expect(bitBuiltin('reverseBits', [1], 'i32')).toBe(-2147483648);
  });
  it('firstLeadingBit and firstTrailingBit say none by kind', () => {
    expect(bitBuiltin('firstLeadingBit', [0], 'u32')).toBe(0xffffffff);
    expect(bitBuiltin('firstLeadingBit', [0], 'i32')).toBe(-1);
    expect(bitBuiltin('firstLeadingBit', [-1], 'i32')).toBe(-1);
    expect(bitBuiltin('firstLeadingBit', [-2], 'i32')).toBe(0);
    expect(bitBuiltin('firstLeadingBit', [0x80000000], 'u32')).toBe(31);
    expect(bitBuiltin('firstTrailingBit', [0], 'u32')).toBe(0xffffffff);
    expect(bitBuiltin('firstTrailingBit', [0], 'i32')).toBe(-1);
    expect(bitBuiltin('firstTrailingBit', [8], 'u32')).toBe(3);
  });
  it('extractBits sign-extends an i32 field and clamps offset and count', () => {
    expect(bitBuiltin('extractBits', [0xf0, 4, 4], 'u32')).toBe(15);
    expect(bitBuiltin('extractBits', [0xf0, 4, 4], 'i32')).toBe(-1);
    expect(bitBuiltin('extractBits', [0xf0, 4, 0], 'u32')).toBe(0);
    expect(bitBuiltin('extractBits', [0xffffffff, 40, 5], 'u32')).toBe(0);
    expect(bitBuiltin('extractBits', [0xffffffff, 0, 32], 'u32')).toBe(0xffffffff);
  });
  it('insertBits writes the field and leaves the value for a zero count', () => {
    expect(bitBuiltin('insertBits', [0, 0xf, 4, 4], 'u32')).toBe(0xf0);
    expect(bitBuiltin('insertBits', [7, 1, 0, 0], 'u32')).toBe(7);
    expect(bitBuiltin('insertBits', [0, 1, 31, 1], 'i32')).toBe(-2147483648);
  });
  it('a vector argument takes scalar or vector extra arguments', () => {
    expect(bitBuiltin('extractBits', [[0xf0, 0x0f], 4, 4], 'u32')).toEqual([15, 0]);
    expect(bitBuiltin('extractBits', [[0xf0, 0xf00], [4, 8], 4], 'u32')).toEqual([15, 15]);
  });
  it('counts agree for u32 and i32', () => {
    expect(call('countOneBits', -1)).toBe(32);
    expect(call('countLeadingZeros', 0)).toBe(32);
    expect(call('countTrailingZeros', 0)).toBe(32);
    expect(call('countTrailingZeros', [8, 1])).toEqual([3, 0]);
  });
  it('dotI and dotU wrap every multiply and add at 32 bits', () => {
    expect(call('dotI', [2147483647, 1], [2147483647, 1])).toBe(2);
    expect(call('dotU', [2147483647, 1], [2147483647, 1])).toBe(2);
    expect(call('dotI', [2147483647, 2147483647], [1, 1])).toBe(-2);
    expect(call('dotU', [2147483647, 2147483647], [1, 1])).toBe(4294967294);
    expect(call('absU', 7)).toBe(7);
  });
});

describe('subgroup of one invocation', () => {
  it('folds are the value, scans start at the identity, votes are the lane', () => {
    expect(call('subgroupAdd', 3)).toBe(3);
    expect(call('subgroupInclusiveMul', 3)).toBe(3);
    expect(call('subgroupExclusiveAdd', 3)).toBe(0);
    expect(call('subgroupExclusiveAdd', [3, 4])).toEqual([0, 0]);
    expect(call('subgroupExclusiveMul', 3)).toBe(1);
    expect(call('subgroupExclusiveMul', [3, 4])).toEqual([1, 1]);
    expect(call('subgroupAll', true)).toBe(true);
    expect(call('subgroupAny', false)).toBe(false);
    expect(call('subgroupBallot', true)).toEqual([1, 0, 0, 0]);
    expect(call('subgroupBallot', false)).toEqual([0, 0, 0, 0]);
    expect(call('subgroupElect')).toBe(true);
    expect(call('subgroupShuffleXor', 9, 1)).toBe(9);
    expect(call('subgroupBroadcastFirst', 9)).toBe(9);
    expect(call('workgroupUniformLoad', 5)).toBe(5);
  });
});

describe('GPU stubs', () => {
  it('a derivative keeps the shape of its argument', () => {
    for (const name of ['fwidth', 'dpdx', 'dpdy', 'fwidthCoarse', 'dpdxFine', 'dpdyCoarse']) {
      expect(stub(name, [1, 2])).toEqual([0, 0]);
      expect(stub(name, [1, 2, 3])).toEqual([0, 0, 0]);
      expect(stub(name, 3)).toBe(0);
    }
  });
  it('a texel read is opaque black and a depth read is the far plane', () => {
    for (const name of [
      'textureSample',
      'textureLoad',
      'textureLoadU',
      'textureGather',
      'textureLoadMs',
    ]) {
      expect(stub(name)).toEqual([0, 0, 0, 1]);
    }
    expect(stub('textureGatherDepth')).toEqual([1, 1, 1, 1]);
    expect(stub('textureLoadDepthMs')).toBe(1);
  });
  it('a comparison passes in full and a size is one texel', () => {
    for (const name of ['textureSampleCompare', 'textureSampleCompareLevelCubeArray']) {
      expect(stub(name)).toBe(1);
    }
    expect(stub('textureGatherCompare')).toEqual([1, 1, 1, 1]);
    expect(stub('textureDimensions')).toEqual([1, 1]);
    expect(stub('textureDimensions3d')).toEqual([1, 1, 1]);
    expect(stub('textureDimensions1d')).toBe(1);
    expect(stub('textureNumLayers')).toBe(1);
    expect(stub('textureNumSamples')).toBe(1);
    expect(stub('textureStore')).toBe(0);
  });
});
