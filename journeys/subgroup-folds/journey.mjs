// The host half of the subgroup-folds journey (change 0119): a sum, a histogram and a min/max
// pair over 1000 integers, each computed again in plain JavaScript. The kernel functions name
// no subgroup; on a device that has the feature and passed the runtime's probe, their loops
// run as the subgroup variant, and the values are the same bits either way.

/** A deterministic generator, so a failure names a reproducible input. */
function generator(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0);
}

const N = 1000;
const rnd = generator(119);
const xs = Array.from({ length: N }, () => rnd() % 1000);
const signed = Array.from({ length: N }, () => (rnd() % 2001) - 1000);
const THRESHOLD = 500;

const total = () => [xs.reduce((a, b) => (a + b) >>> 0, 0)];
const histogram = () => {
  const bins = new Array(16).fill(0);
  for (const x of xs) {
    bins[x & 7] += 1;
    if (x > THRESHOLD) bins[8 + (x & 7)] += x;
  }
  return bins;
};
const extremes = () => [Math.min(...signed), Math.max(...signed)];

export default {
  title: 'Integer folds a subgroup takes first, where the device has one',
  runs: [
    {
      kind: 'kernel',
      shader: 'folds.shade.ts',
      fn: 'total',
      args: { xs, out: [0] },
      read: 'out',
      flatten: (out) => Array.from(out),
      expected: total,
      tolerance: 0,
    },
    {
      kind: 'kernel',
      shader: 'folds.shade.ts',
      fn: 'histogram',
      args: { xs, bins: new Array(16).fill(0), threshold: THRESHOLD },
      read: 'bins',
      flatten: (bins) => Array.from(bins),
      expected: histogram,
      tolerance: 0,
    },
    {
      kind: 'kernel',
      shader: 'folds.shade.ts',
      fn: 'extremes',
      args: { xs: signed, out: [0, 0] },
      read: 'out',
      flatten: (out) => Array.from(out),
      expected: extremes,
      tolerance: 0,
    },
  ],
};
