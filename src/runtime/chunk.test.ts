// ═══ The arithmetic of the chunks of a long kernel (change 0074) ═══
//
// What is pinned here: the units of the next chunk (`fitChunk`) and the rate a device learns of a
// key (`learnRate`), the cases typecv's `tests/typeshade/plan-steps.test.mjs` held at typecv
// `f253716`, moved here with the scheduler. The first chunk is `min` capped at `max`; a chunk grows
// at most fourfold; a chunk past the budget shrinks to what fits; the rate is the mean of the
// previous rate and the measured one; `max` and `min` bound the fit and a chunk is at least one
// unit; `max` wins over `min` (D7, a difference from typecv); a chunk of no time and no units counts
// one microsecond and one unit.
//
// Verifies: Rule 11.8 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { fitChunk, learnRate, type ChunkRate } from './chunk.js';

describe('fitChunk and learnRate (change 0074)', () => {
  it('makes the first chunk of a key min, capped at max', () => {
    expect(fitChunk(undefined, 250, 160)).toBe(1);
    expect(fitChunk(undefined, 250, 160, 4)).toBe(4);
    expect(fitChunk(undefined, 250, 2, 4)).toBe(2);
  });

  it('grows a chunk at most fourfold, and shrinks one past the budget to what fits', () => {
    // A chunk of one unit that took 10 ms: 20 units fit 200 ms, but the next chunk grows at most
    // fourfold.
    const first = learnRate(undefined, 1, 10);
    expect(first).toEqual({ msPerUnit: 10, chunks: 1, longestMs: 10, lastUnits: 1 });
    expect(fitChunk(first, 250, 160)).toBe(4);
    // Four units in 20 ms: the rate is the mean of 10 and 5, 7.5 ms, so 26 units fit, and the
    // chunk may grow to 16.
    const second = learnRate(first, 4, 20);
    expect(second).toEqual({ msPerUnit: 7.5, chunks: 2, longestMs: 20, lastUnits: 4 });
    expect(fitChunk(second, 250, 160)).toBe(16);
    // Sixteen units in 400 ms, past the budget: the rate rises to the mean of 7.5 and 25, and the
    // next chunk shrinks to the 12 units that fit 200 ms.
    const third = learnRate(second, 16, 400);
    expect(third).toEqual({ msPerUnit: 16.25, chunks: 3, longestMs: 400, lastUnits: 16 });
    expect(fitChunk(third, 250, 160)).toBe(12);
    // The longest chunk is kept when a later one is shorter.
    expect(learnRate(third, 12, 100).longestMs).toBe(400);
  });

  it('bounds the fit by max and min, and makes a chunk at least one unit', () => {
    const third: ChunkRate = { msPerUnit: 16.25, chunks: 3, longestMs: 400, lastUnits: 16 };
    expect(fitChunk(third, 250, 8)).toBe(8);
    expect(fitChunk(third, 250, 160, 20)).toBe(20);
    // A unit that takes four times the budget still makes a chunk of one.
    expect(fitChunk({ msPerUnit: 1000, chunks: 1, longestMs: 1000, lastUnits: 1 }, 250, 160)).toBe(
      1,
    );
  });

  it('lets max win over min, so a chunk never holds more than remains (D7)', () => {
    const third: ChunkRate = { msPerUnit: 16.25, chunks: 3, longestMs: 400, lastUnits: 16 };
    // typecv's fitChunk returned min, 20, here.
    expect(fitChunk(third, 250, 8, 20)).toBe(8);
    expect(fitChunk(undefined, 250, 3, 20)).toBe(3);
    // A slow rate and a min above max: max still.
    expect(fitChunk({ msPerUnit: 1000, chunks: 1, longestMs: 1000, lastUnits: 1 }, 250, 5, 9)).toBe(
      5,
    );
  });

  it('counts a chunk of no time and no units as one microsecond and one unit', () => {
    expect(learnRate(undefined, 0, 0)).toEqual({
      msPerUnit: 1e-3,
      chunks: 1,
      longestMs: 0,
      lastUnits: 1,
    });
  });

  it('returns a frozen rate', () => {
    expect(Object.isFrozen(learnRate(undefined, 2, 5))).toBe(true);
  });
});
