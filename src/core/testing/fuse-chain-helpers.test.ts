import { describe, expect, it } from 'vitest';
import {
  foldLevels,
  groupCallsOf,
  inputsOf,
  localChain,
  localsStartingAtOne,
  lowerChain,
  runGrouped,
  stencilChain,
  tripsOf,
  type ScalarOf,
} from './fuse-chain.js';
import type { ChainCall } from './random-ir.js';

const zeroScalar: ScalarOf = () => 0;

const callOf = (over: 'n' | 'm', start: number, step: number): ChainCall => ({
  ...stencilChain().calls[0]!,
  over,
  start,
  step,
});

describe('the helpers of the generated chains', () => {
  it('foldLevels counts one dispatch for each level of 256 partials past the first', () => {
    expect(foldLevels(0)).toBe(0);
    expect(foldLevels(256)).toBe(0);
    expect(foldLevels(257)).toBe(1);
    expect(foldLevels(65536)).toBe(1);
    expect(foldLevels(65537)).toBe(2);
  });

  it('tripsOf counts the iterations from the start by the step below the bounding length', () => {
    const s = { n: 10, m: 3 };
    expect(tripsOf(callOf('n', 0, 1), s)).toBe(10);
    expect(tripsOf(callOf('n', 0, 3), s)).toBe(4);
    expect(tripsOf(callOf('n', 4, 3), s)).toBe(2);
    expect(tripsOf(callOf('n', 10, 1), s)).toBe(0);
    expect(tripsOf(callOf('m', 3, 1), s)).toBe(0);
    expect(tripsOf(callOf('m', 5, 1), s)).toBe(0);
    expect(tripsOf(callOf('m', 2, 5), s)).toBe(1);
  });

  it('localsStartingAtOne gives each scratch local the value one and refuses another count', () => {
    const wgsl = 'var _fs0: f32;\nvar _fs1: f32;\nvar other: f32;';
    expect(localsStartingAtOne(wgsl, 2)).toBe(
      'var _fs0: f32 = 1.0;\nvar _fs1: f32 = 1.0;\nvar other: f32;',
    );
    expect(() => localsStartingAtOne(wgsl, 1)).toThrow(/declares 2 scratch locals/);
    expect(() => localsStartingAtOne(wgsl, 3)).toThrow(/holds 3/);
  });

  it('runGrouped refuses a call that runs apart and names an array a group holds as a local', () => {
    const c = localChain();
    const lows = lowerChain(c);
    if ('none' in lows) throw new Error(lows.none);
    const s = { n: 4, m: 2 };
    const inputs = inputsOf(c, s, 0, zeroScalar);
    const calls = groupCallsOf(c, lows, inputs);
    const scratch = c.arrays[0]!;
    expect(() =>
      runGrouped(
        c,
        lows,
        calls,
        [{ calls: [0, 1], contracted: [scratch] }, { calls: [0] }],
        inputs,
      ),
    ).toThrow(/names x0, which a group holds as a local/);
  });
});
