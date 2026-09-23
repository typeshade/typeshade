// The host half of the tree journey: 1000 values as a binary heap, sixteen roots, the uniform
// packed as two u32 in a 16-byte block, and both entries computed in plain JavaScript.

const COUNT = 1000;
const ROOTS = 16;
let seed = 99;
const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
const values = Array.from({ length: COUNT }, () => Math.fround(rnd() * 10));

function subtreeSums() {
  return Array.from({ length: ROOTS }, (_, root) => {
    let s = 0;
    const stack = [root];
    while (stack.length > 0) {
      const n = stack.pop();
      s += values[n];
      if (2 * n + 1 < COUNT) stack.push(2 * n + 1);
      if (2 * n + 2 < COUNT) stack.push(2 * n + 2);
    }
    return Math.sqrt(s);
  });
}

function stridedSums() {
  return Array.from({ length: 64 }, (_, lid) => {
    let s = 0;
    for (let i = lid; i < COUNT; i += 64) s += values[i];
    return s;
  });
}

const bindings = () => ({
  params: { gpu: new Uint32Array([COUNT, ROOTS, 0, 0]), cpu: { count: COUNT, roots: ROOTS } },
  values: { gpu: new Float32Array(values), cpu: values },
  sums: { gpu: new Float32Array(ROOTS), cpu: new Array(ROOTS).fill(0) },
  partial: { gpu: new Float32Array(64), cpu: new Array(64).fill(0) },
});

export default {
  title: 'A tree walked with a stack, and a strided sum',
  runs: [
    {
      kind: 'compute',
      shader: 'tree.shade.ts',
      entry: 'subtree',
      workgroups: [1, 1, 1],
      bindings: bindings(),
      read: 'sums',
      expected: subtreeSums,
      tolerance: 1e-4,
    },
    {
      kind: 'compute',
      shader: 'tree.shade.ts',
      entry: 'strided',
      workgroups: [1, 1, 1],
      bindings: bindings(),
      read: 'partial',
      expected: stridedSums,
      tolerance: 1e-4,
    },
  ],
};
