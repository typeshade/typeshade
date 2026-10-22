// #740: each specialization must size the lowered fp64 scratch for every invocation.
function run(size, fp64Flavor) {
  const values = Array.from({ length: 2 * size + 7 }, (_, i) => (i % 31) - 15);
  return {
    kind: 'compute',
    shader: 'copy.shade.ts',
    entry: 'copy',
    constants: { WG_SIZE: size },
    ...(fp64Flavor === 'integer' ? { emit: { fp64Flavor } } : {}),
    workgroups: [Math.ceil(values.length / size), 1, 1],
    bindings: { src: values, dst: new Array(values.length).fill(0) },
    read: 'dst',
    expected: () => values.map((v) => 2 * v),
    tolerance: 0,
  };
}

export default {
  title: 'Preserve fp64 workgroup-array override lengths',
  runs: ['float', 'integer'].flatMap((flavor) => [32, 64, 128].map((size) => run(size, flavor))),
};
