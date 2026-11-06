// Four adjacent invocations and several workgroups collide in the same cells. The final untouched cell and nonidentity
// initial values also check that the scatter preserves the caller's existing storage.
const N = 1031;
const keys = Array.from({ length: N }, (_, i) => (Math.floor(i / 4) * 7) % 31);
const unsigned = Array.from({ length: N }, (_, i) => (Math.imul(i + 1, 2654435761) + 19) >>> 0);
const signed = unsigned.map((x) => x | 0);

export default {
  title: 'Integer min/max scatters with colliding cell keys',
  runs: [
    ['unsignedMin', unsigned, 'min', 0xffffff00],
    ['unsignedMax', unsigned, 'max', 17],
    ['signedMin', signed, 'min', 2147483600],
    ['signedMax', signed, 'max', -2147483600],
  ].map(([fn, values, op, initial]) => ({
    kind: 'kernel',
    shader: 'extremes.shade.ts',
    fn,
    args: { best: new Array(32).fill(initial), keys, values },
    read: 'best',
    flatten: (best) => Array.from(best),
    expected: () => {
      const best = new Array(32).fill(initial);
      for (let i = 0; i < N; i++) best[keys[i]] = Math[op](best[keys[i]], values[i]);
      return best;
    },
    tolerance: 0,
  })),
};
