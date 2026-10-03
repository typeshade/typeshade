const xs = Array.from({ length: 64 }, (_, i) => i * 0.25);

export default {
  title: 'TypeScript variable names receive safe backend spellings',
  runs: [
    {
      kind: 'compute',
      shader: 'names.shade.ts',
      entry: 'main',
      workgroups: [1, 1, 1],
      bindings: { xs, out: new Array(64).fill(0) },
      read: 'out',
      expected: () => xs.map((x) => x * 3 + 7),
      tolerance: 0,
    },
  ],
};
