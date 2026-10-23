// Independent JavaScript reference for the values the binding declarations read.
export default {
  title:
    'Fixed-array bindings: holes, copies, tuple contexts, nested getters, captures and effects',
  runs: [
    {
      kind: 'compute',
      shader: 'bindings.shade.ts',
      entry: 'main',
      workgroups: [1, 1, 1],
      bindings: { out: new Array(64 * 8).fill(0) },
      read: 'out',
      expected: () =>
        Array.from({ length: 64 }, (_, x) => [
          x,
          x + 2,
          x + 10,
          x + 2,
          x,
          2 * x + 1,
          x + 2,
          3,
        ]).flat(),
      tolerance: 0,
    },
  ],
};
