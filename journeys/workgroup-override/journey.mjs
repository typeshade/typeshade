function run(values) {
  const selected = values.length >= 256 ? 256 : 64;
  return {
    kind: 'compute',
    shader: 'copy.shade.ts',
    entry: 'copy',
    constants: { WG_SIZE: selected },
    workgroups: [Math.ceil(values.length / selected), 1, 1],
    bindings: { src: values, dst: new Array(values.length).fill(0) },
    read: 'dst',
    expected: () => values,
    tolerance: 0,
    ...(selected === 64
      ? {}
      : { webgl2Unsupported: 'WebGL2 supports only the declared default [64, 1, 1].' }),
  };
}

export default {
  title: 'Select a workgroup size from the input length',
  runs: [
    run(Array.from({ length: 191 }, (_, i) => i % 127)),
    run(Array.from({ length: 513 }, (_, i) => (i % 31) - 15)),
  ],
};
