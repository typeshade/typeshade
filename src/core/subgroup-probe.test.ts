// The subgroup probe (change 0119, Rule 11.23): the known answers of its folds, what its words
// say of a device, and the texts of the probe itself.

import { describe, expect, it } from 'vitest';
import {
  PROBE_LANES,
  PROBE_WORDS,
  SUBGROUP_PROBE_WGSL,
  probeExpectation,
  probeValue,
  readSubgroupProbe,
} from './subgroup-probe.js';

/** The words a device of subgroup size `size` writes when it folds right, lanes consecutive. */
function wordsOf(size: number, consecutive = true): Uint32Array {
  const words = new Uint32Array(PROBE_WORDS);
  const numSubgroups = Math.ceil(PROBE_LANES / size);
  for (let lane = 0; lane < PROBE_LANES; lane++) {
    // A device that assigns lanes round-robin: lane `i` is lane `i / numSubgroups` of subgroup
    // `i % numSubgroups`.
    words[lane] = consecutive ? Math.floor(lane / size) : lane % numSubgroups;
    words[PROBE_LANES + lane] = consecutive ? lane % size : Math.floor(lane / numSubgroups);
  }
  const { sum, bins } = probeExpectation();
  words[PROBE_LANES * 2] = size;
  words[PROBE_LANES * 2 + 1] = numSubgroups;
  words[PROBE_LANES * 2 + 2] = sum;
  bins.forEach((b, i) => (words[PROBE_LANES * 2 + 3 + i] = b));
  return words;
}

describe('the subgroup probe', () => {
  it('has known answers that a wrong fold is unlikely to meet', () => {
    const { sum, bins } = probeExpectation();
    expect(sum).toBe(
      Array.from({ length: PROBE_LANES }, (_, i) => probeValue(i)).reduce(
        (a, b) => (a + b) >>> 0,
        0,
      ),
    );
    expect(bins.reduce((a, b) => a + b, 0)).toBe((PROBE_LANES * (PROBE_LANES - 1)) / 2);
    expect(new Set(bins).size).toBeGreaterThan(1);
    expect(probeValue(0)).toBe(0);
    expect(probeValue(1)).toBe(2654435761 >>> 20);
  });
  it('reads a passing probe into the observation, with the lanes consecutive or not', () => {
    expect(readSubgroupProbe(wordsOf(4), { subgroupMinSize: 4, subgroupMaxSize: 4 })).toEqual({
      minSize: 4,
      maxSize: 4,
      size: 4,
      numSubgroups: 64,
      consecutive: true,
    });
    expect(readSubgroupProbe(wordsOf(32))).toEqual({
      minSize: null,
      maxSize: null,
      size: 32,
      numSubgroups: 8,
      consecutive: true,
    });
    expect(readSubgroupProbe(wordsOf(8, false))?.consecutive).toBe(false);
  });
  it('refuses a probe whose folds are not their answers, or whose size is not one', () => {
    const wrongSum = wordsOf(4);
    wrongSum[PROBE_LANES * 2 + 2]! += 1;
    expect(readSubgroupProbe(wrongSum)).toBeNull();
    const wrongBin = wordsOf(4);
    wrongBin[PROBE_LANES * 2 + 3 + 5]! ^= 1;
    expect(readSubgroupProbe(wrongBin)).toBeNull();
    const zeros = new Uint32Array(PROBE_WORDS);
    expect(readSubgroupProbe(zeros)).toBeNull();
    const short = wordsOf(4).subarray(0, PROBE_WORDS - 1);
    expect(readSubgroupProbe(short)).toBeNull();
    const tooFew = wordsOf(4);
    tooFew[PROBE_LANES * 2 + 1] = 2;
    expect(readSubgroupProbe(tooFew)).toBeNull();
  });
  it('is the shape the variant emits, with the uniformity rule off for the scatter fold', () => {
    expect(SUBGROUP_PROBE_WGSL).toContain('enable subgroups;');
    expect(SUBGROUP_PROBE_WGSL).toContain(
      '@compute @workgroup_size(256) @diagnostic(off, subgroup_uniformity)',
    );
    expect(SUBGROUP_PROBE_WGSL).toContain('let f = subgroupAdd(v);');
    expect(SUBGROUP_PROBE_WGSL).toContain('let key = subgroupMin(select(4294967295u, k, p));');
    expect(SUBGROUP_PROBE_WGSL).toContain('if (subgroupElect()) {');
    expect(SUBGROUP_PROBE_WGSL).toContain('p = select(p, false, m);');
    expect(SUBGROUP_PROBE_WGSL.match(/workgroupBarrier\(\);/g)).toHaveLength(1);
  });
});
