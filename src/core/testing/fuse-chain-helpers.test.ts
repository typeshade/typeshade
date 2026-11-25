import { describe, expect, it } from 'vitest';
import {
  contractAgainstFacts,
  foldLevels,
  fuseGroup,
  groupCallsOf,
  inputsOf,
  limitChain,
  localChain,
  localsStartingAtOne,
  lowerChain,
  modelGroups,
  planChain,
  runGrouped,
  scratchFates,
  shapeOf,
  stencilChain,
  tripsOf,
  type ModelGroup,
  type ScalarOf,
} from './fuse-chain.js';
import type { ChainAccess, ChainCall, ChainCorpus } from './random-ir.js';

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

  it('the planner and the model count the partials binding of a reduction against the limit', () => {
    const c = limitChain();
    const lows = lowerChain(c);
    if ('none' in lows) throw new Error(lows.none);
    const s = { n: 70, m: 33 };
    const calls = groupCallsOf(c, lows, inputsOf(c, s, 0, zeroScalar));
    expect(shapeOf(modelGroups(c, s, 8))).toEqual([[0, 1, 2, 3], [4]]);
    expect(shapeOf(planChain(c, calls, 8))).toEqual([[0, 1, 2, 3], [4]]);
    expect(shapeOf(modelGroups(c, s, 9))).toEqual([[0, 1, 2, 3, 4]]);
    expect(shapeOf(planChain(c, calls, 9))).toEqual([[0, 1, 2, 3, 4]]);
  });

  it('a scratch array written and read at i by two calls is a local of their fused group', () => {
    const c = localChain();
    const lows = lowerChain(c);
    if ('none' in lows) throw new Error(lows.none);
    const s = { n: 4, m: 2 };
    const calls = groupCallsOf(c, lows, inputsOf(c, s, 0, zeroScalar));
    const groups = planChain(c, calls, 8);
    expect(shapeOf(groups)).toEqual([[0, 1]]);
    expect(groups[0]!.contracted.map((a) => (a as { id: string }).id)).toEqual(['x0']);
    const built = fuseGroup(lows, calls, [0, 1], groups[0]!.contracted);
    if ('none' in built) throw new Error(built.none);
    const wgsl = built.fused.entry.wgsl;
    expect(wgsl.match(/var _fs\d+: f32;/g)).toHaveLength(1);
    expect(localsStartingAtOne(wgsl, 1)).toMatch(/var _fs\d+: f32 = 1\.0;/);
  });

  it('inputsOf draws boundary values in odd variants only, and a scratch array starts at zero', () => {
    const c = localChain();
    const s = { n: 8, m: 2 };
    const pool: ScalarOf = (_kind, _rnd, boundary) => (boundary ? -0 : 5);
    const flat = (v: number) =>
      [...inputsOf(c, s, v, pool).arrays].flatMap(([id, a]) => a.map((x) => [id, x] as const));
    expect(flat(1).some(([, x]) => Object.is(x, -0))).toBe(true);
    expect(flat(0).some(([, x]) => Object.is(x, -0))).toBe(false);
    expect(
      flat(0)
        .filter(([id]) => id === 'x1')
        .every(([, x]) => x === 5),
    ).toBe(true);
    expect(
      flat(1)
        .filter(([id]) => id === 'x0')
        .every(([, x]) => Object.is(x, 0)),
    ).toBe(true);
  });
});

const access = (
  array: string,
  reads: ChainAccess['reads'],
  writes: ChainAccess['writes'],
  measures = false,
): ChainAccess => ({ param: 't', array, reads, writes, conditional: false, measures });

const scratchPair = (first: ChainAccess, second: ChainAccess): ChainCorpus => {
  const base = localChain();
  return {
    ...base,
    calls: [
      { ...base.calls[0]!, access: [first] },
      { ...base.calls[1]!, access: [second] },
    ],
  };
};

const together: ModelGroup[] = [{ calls: [0, 1], contracted: [] }];

describe('the fate of a scratch array', () => {
  const fate = (c: ChainCorpus, groups: readonly ModelGroup[] = together) =>
    scratchFates(c, groups).get('x0');

  it('is outside when no group holds every call that names it', () => {
    const c = scratchPair(access('x0', 'none', 'i'), access('x0', 'i', 'none'));
    expect(
      fate(c, [
        { calls: [0], contracted: [] },
        { calls: [1], contracted: [] },
      ]),
    ).toBe('outside');
  });

  it('is local when the group holds it as a local', () => {
    const c = scratchPair(access('x0', 'none', 'i'), access('x0', 'i', 'none'));
    expect(fate(c, [{ calls: [0, 1], contracted: ['x0'] }])).toBe('local');
  });

  it('is writers, offset or measured by the first clause of Rule 11.13 that keeps a buffer', () => {
    const w = access('x0', 'none', 'i');
    const r = access('x0', 'i', 'none');
    expect(fate(scratchPair(w, access('x0', 'none', 'i')))).toBe('writers');
    expect(fate(scratchPair(w, access('x0', 'shifted', 'none')))).toBe('offset');
    expect(fate(scratchPair(w, access('x0', 'i', 'none', true)))).toBe('measured');
    expect(fate(scratchPair(w, access('x0', 'shifted', 'i')))).toBe('writers');
    expect(fate(scratchPair(access('x0', 'none', 'i', true), r))).toBe('measured');
    expect(fate(scratchPair(w, access('x0', 'shifted', 'none', true)))).toBe('offset');
  });
});

describe('contractAgainstFacts', () => {
  it('runs the pair as one group and leaves the calls after the second one apart', () => {
    const array = localChain().arrays[0]!;
    const groups = [{ calls: [0] }, { calls: [1, 2, 3] }, { calls: [4] }];
    expect(contractAgainstFacts(groups, { at: 1, array })).toEqual([
      { calls: [0, 1], contracted: [array] },
      { calls: [2] },
      { calls: [3] },
      { calls: [4] },
    ]);
  });
});
