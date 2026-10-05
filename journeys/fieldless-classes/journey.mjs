const xs = Array.from({ length: 64 }, (_, i) => i * 0.25);

export default {
  title: 'Fieldless classes construct and dispatch inherited methods',
  runs: [
    {
      kind: 'compute',
      shader: 'classes.shade.ts',
      entry: 'main',
      workgroups: [1, 1, 1],
      bindings: {
        xs,
        out: new Array(64).fill(0),
        samples: { before: 2, empty: {}, entries: [{}, {}], after: 4 },
      },
      read: 'out',
      expected: () => xs.map((x) => x * 2 + 7),
      tolerance: 0,
    },
  ],
};
