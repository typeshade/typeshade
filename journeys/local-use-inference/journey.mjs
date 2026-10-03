// Integer division truncates toward zero, and unsigned addition wraps at 2^32.
// This reference computes both without TypeShade and exercises a shadow and a closure.
export default {
  title: 'Local integer literals take the type their declared calls require',
  runs: [
    {
      kind: 'compute',
      shader: 'inference.shade.ts',
      entry: 'main',
      workgroups: [1, 1, 1],
      bindings: { out: new Array(4).fill(0) },
      read: 'out',
      expected: () => [
        Math.trunc(-3 / 2),
        (4294967295 + 1) >>> 0,
        Math.trunc(6 / 2),
        Math.trunc(-3 / 2),
      ],
      tolerance: 0,
    },
  ],
};
