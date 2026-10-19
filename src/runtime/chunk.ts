// ═══ The arithmetic of the chunks of a long kernel under a time budget (change 0074) ═══
//
// A kernel that iterates inside one dispatch (RANSAC trials, Jacobi sweeps, solver iterations)
// can run long enough in one submission for a GPU watchdog to reset the device. The application
// cuts such a kernel's loop into chunks, and the device owner (`runtime/device.ts`) sizes each
// chunk from the time the earlier chunks of the same key took. This file is that arithmetic: the
// rate a device learns of a key (`learnRate`) and the units of the next chunk (`fitChunk`). It
// is the arithmetic of typecv's `ShadeDevice` (typecv `f253716`, `src/gpu/device.ts`), with one
// difference: `max` wins over `min` (change 0074, D7).
//
// The package does not export this file. `ChunkRate` reaches a host through `typeshade/runtime`
// and the package root.

/**
 * What a device measured of one chunk key (change 0074): the time one unit takes, as the device
 * learned it from the chunks so far, how many chunks it ran, the longest of them and the units of
 * the last one. `device.chunkRates` holds one for each key a chunked plan named.
 *
 * Exported from `typeshade` and `typeshade/runtime`.
 */
export interface ChunkRate {
  /** The milliseconds one unit takes: the first chunk's measured rate, then the mean of the
   *  previous rate and the measured one. */
  readonly msPerUnit: number;
  /** How many chunks of the key the device ran. */
  readonly chunks: number;
  /** The longest time one chunk of the key took, in milliseconds. */
  readonly longestMs: number;
  /** The units of the last chunk, at least 1. */
  readonly lastUnits: number;
}

/** The share of the budget a chunk is sized to fill. */
const FILL = 0.8;
/** The most a chunk grows over the last chunk of its key. */
const GROWTH = 4;
/** The least time a chunk counts, in milliseconds: one microsecond. */
const LEAST_MS = 1e-3;

/**
 * The units of the next chunk at `rate`: as many as fit eight tenths of `budgetMs`, at most four
 * times the last chunk, at least `min` and at least 1, and at most `max` in every case (D7).
 * Without a rate, the first chunk is `min`, capped at `max`: the rate is learned from it.
 *
 * `max` and `min` are whole numbers of 1 or more; the device checks them before it calls this.
 */
export function fitChunk(
  rate: ChunkRate | undefined,
  budgetMs: number,
  max: number,
  min = 1,
): number {
  if (rate === undefined) return Math.max(1, Math.min(max, min));
  const fit = Math.floor((budgetMs * FILL) / rate.msPerUnit);
  return Math.min(max, Math.max(1, min, Math.min(fit, rate.lastUnits * GROWTH)));
}

/**
 * The rate of a chunk key after one more chunk of `units` took `elapsedMs`: the time per unit is
 * the mean of the previous rate and the measured one (the first chunk sets it), the longest chunk
 * is kept, and a chunk counts at least one unit and at least one microsecond.
 */
export function learnRate(
  previous: ChunkRate | undefined,
  units: number,
  elapsedMs: number,
): ChunkRate {
  const counted = Math.max(1, units);
  const measured = Math.max(LEAST_MS, elapsedMs) / counted;
  return Object.freeze({
    msPerUnit: previous === undefined ? measured : 0.5 * previous.msPerUnit + 0.5 * measured,
    chunks: (previous?.chunks ?? 0) + 1,
    longestMs: Math.max(previous?.longestMs ?? 0, elapsedMs),
    lastUnits: counted,
  });
}
