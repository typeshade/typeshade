// Host values and a plain-JavaScript reference. No compiler or emitted shader is read here.
export const uniforms = [
  { name: 'scalarFloat', type: 'f32', kind: 'float', lanes: 1 },
  { name: 'scalarInt', type: 'i32', kind: 'int', lanes: 1 },
  { name: 'scalarUint', type: 'u32', kind: 'uint', lanes: 1 },
  ...[2, 3, 4].flatMap((lanes) => [
    { name: `vectorFloat${lanes}`, type: `vec${lanes}`, kind: 'float', lanes },
    { name: `vectorInt${lanes}`, type: `vec${lanes}i`, kind: 'int', lanes },
    { name: `vectorUint${lanes}`, type: `vec${lanes}u`, kind: 'uint', lanes },
  ]),
  ...[2, 3, 4].flatMap((columns) =>
    [3, 4].map((rows) => ({
      name: `matrix${columns}x${rows}`,
      type: `mat${columns}x${rows}`,
      kind: 'matrix',
      lanes: columns * rows,
    })),
  ),
  { name: 'deadBare', type: 'f32', kind: 'float', lanes: 1, dead: true },
  { name: 'deadStruct', type: 'f32', kind: 'float', lanes: 1, dead: true, wrapped: true },
  ...[1, 2, 3, 4].map((lanes) => ({
    name: `double${lanes}`,
    type: lanes === 1 ? 'f64' : `vec${lanes}f64`,
    kind: 'double',
    lanes,
  })),
];

export function valueOf(spec, changed = false) {
  const values = Array.from({ length: spec.lanes }, (_, i) => {
    if (spec.kind === 'double') return 1 + ((i + 1) * (changed ? 2 : 1)) / 2 ** 30;
    const value =
      spec.kind === 'int'
        ? spec.lanes === 1
          ? -3
          : (i + 1) * (i % 2 === 0 ? -1 : 1)
        : spec.kind === 'uint'
          ? spec.lanes === 1
            ? 7
            : i + 1
          : spec.lanes === 1
            ? 0.25
            : (i + 1) / 16;
    // Integers stay integral; shifting every lane probes every upload, including signed values.
    return changed ? (spec.kind === 'int' || spec.kind === 'uint' ? value + 1 : value / 2) : value;
  });
  return spec.wrapped ? { value: values[0] } : spec.lanes === 1 ? values[0] : values;
}

export function expectedOf(spec, changed = false) {
  if (spec.dead) return [0.25, 0.25, 0.75, 1];
  const value = valueOf(spec, changed);
  const values = Array.isArray(value) ? value : [value];
  const weighted = values.reduce(
    (sum, x, i) =>
      sum +
      (spec.kind === 'double'
        ? spec.lanes === 1
          ? (x + 0.1 - 0.1 - 1) * 2 ** 30
          : (x - 1) * 2 ** 30
        : x) *
        (i + 1),
    0,
  );
  const divisor =
    spec.kind === 'matrix'
      ? 128
      : spec.kind === 'double'
        ? spec.lanes === 1
          ? 8
          : 64
        : spec.kind === 'int' || spec.kind === 'uint'
          ? spec.lanes === 1
            ? 16
            : 64
          : spec.lanes === 1
            ? 1
            : 4;
  const red = weighted / divisor + (spec.kind === 'int' ? 0.5 : 0);
  return [red, 0.25, 0.75, 1];
}
