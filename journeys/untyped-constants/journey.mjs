// The reference computes with JavaScript's own integers and doubles, without TypeShade.
// Each expected value differs from the one the f32 rounding of the constant gave before
// change 0134: Math.fround(2654435761) is 2654435840, Math.fround(16777217) is 16777216,
// Math.fround(-16777219) is -16777220, and Math.fround(0.1) is not 0.1.
const inputs = Array.from({ length: 16 }, (_, i) => (Math.imul(i + 1, 40503) + 7) >>> 0);
const integers = () =>
  inputs.flatMap((v) => [
    Math.imul(v, 2654435761) >>> 0,
    (v + 16777217) >>> 0,
    ((v | 0) + -16777219) >>> 0,
    (Math.imul(v, 16777217) + 16777217) >>> 0,
  ]);

const values = Array.from({ length: 96 }, (_, i) => 1 + (i % 13) / 8);
const outputLength = 128;
const doubles = () => [
  ...values.map((x, i) => (i % 3 === 0 ? x * 0.1 : x * (7 / 3))),
  ...new Array(outputLength - values.length).fill(0),
];

export default {
  title: 'A constant of a written number is read at the type and the exact value of each read',
  runs: [
    {
      kind: 'compute',
      shader: 'integers.shade.ts',
      entry: 'main',
      workgroups: [1, 1, 1],
      bindings: { src: inputs, dst: new Array(64).fill(0) },
      read: 'dst',
      expected: integers,
      tolerance: 0,
    },
    {
      kind: 'compute',
      shader: 'doubles.shade.ts',
      entry: 'evaluate',
      workgroups: [2, 1, 1],
      bindings: { src: values, dst: new Array(outputLength).fill(0) },
      read: 'dst',
      expected: doubles,
      // Distinguishes the double constants from their f32 roundings (a relative 1.5e-8)
      // without promising exact binary64 arithmetic on the device.
      tolerance: 1e-12,
      webgl2Must: true,
    },
  ],
};
