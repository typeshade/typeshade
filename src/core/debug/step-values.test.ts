import { describe, expect, it } from 'vitest';
import { steppedToEnd, steppedResult } from '../testing/stepped-run.js';

const SOURCE = `"use typeshade";
export function invert(x: i32): i32 { return ~x; }
export function invertUnsigned(x: u32): u32 { return ~x; }
export function leadingBit(x: i32): i32 { return firstLeadingBit(x); }
export function leadingBitUnsigned(x: u32): u32 { return firstLeadingBit(x); }
export function reversed(x: u32): u32 { return reverseBits(x); }
export function pickParts(a: vec2, b: vec2): vec2 { return select(a, b, vec2b(true, false)); }
interface Color {
  color: location<0, vec4>;
}
@fragment export function fs(p: builtin<"position">): Color {
  if (p.x > 0.5) {
    discard;
  }
  return { color: vec4(1., 2., 3., 4.) };
}
`;

describe('a stepped run reads the bit builtins at the static kind of their operand', () => {
  it('complements an i32 and a u32 differently', () => {
    expect(steppedResult(SOURCE, 'invert', [5])).toBe(-6);
    expect(steppedResult(SOURCE, 'invertUnsigned', [5])).toBe(4294967290);
  });

  it('finds the leading bit by the sign rule of an i32 and the plain rule of a u32', () => {
    expect(steppedResult(SOURCE, 'leadingBit', [-1])).toBe(-1);
    expect(steppedResult(SOURCE, 'leadingBitUnsigned', [4294967295])).toBe(31);
  });

  it('reverses the bits of a u32', () => {
    expect(steppedResult(SOURCE, 'reversed', [1])).toBe(2147483648);
  });
});

describe('a stepped run of a vector select', () => {
  it('chooses each component by its own condition', () => {
    expect(
      steppedResult(SOURCE, 'pickParts', [
        [1, 2],
        [3, 4],
      ]),
    ).toEqual([3, 2]);
  });
});

describe('a stepped fragment that discards', () => {
  it('ends discarded with no result', () => {
    const s = steppedToEnd(SOURCE, 'fs', [[1, 0, 0, 1]]);
    expect(s.discarded).toBe(true);
    expect(s.result).toBeUndefined();
  });

  it('ends with its result when it does not discard', () => {
    const s = steppedToEnd(SOURCE, 'fs', [[0, 0, 0, 1]]);
    expect(s.discarded).toBe(false);
    expect(s.result).toEqual({ color: [1, 2, 3, 4] });
  });
});
