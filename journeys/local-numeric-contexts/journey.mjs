// This reference uses JavaScript number arithmetic with explicit integer truncation/wrapping.
export default {
  title: 'Local integer literals take declared constructor, method and assignment types',
  runs: [
    {
      kind: 'compute',
      shader: 'contexts.shade.ts',
      entry: 'main',
      workgroups: [1, 1, 1],
      bindings: { out: new Array(6).fill(0) },
      read: 'out',
      expected: () => [Math.trunc(-3 / 2), (4294967295 + 1) >>> 0, 4, -5, -7, -9],
      tolerance: 0,
    },
  ],
};
