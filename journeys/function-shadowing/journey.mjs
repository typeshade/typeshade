export default {
  title: 'Function locals and parameters shadow module values with lexical captures',
  runs: [
    {
      kind: 'compute',
      shader: 'shadow.shade.ts',
      entry: 'main',
      workgroups: [1, 1, 1],
      bindings: { u: { value: 5 }, out: new Array(4).fill(0) },
      read: 'out',
      expected: () => {
        const local = [3, 4];
        let captured = 3;
        captured += 1;
        captured += 2;
        return [local[0] + local[1], 2 + 1, captured + captured, 5 + 50];
      },
      tolerance: 0,
    },
  ],
};
