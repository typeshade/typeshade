// The reference uses JavaScript numbers and Math, independently of TypeShade's constant folder.
// The earlier f32 builtin keeps its recorded double value until WIDE_SINE rounds it.
// NARROW_SINE instead rounds the input and output at the new f32 call's boundaries.
const f = Math.fround;
const coefficients = [
  0.1,
  1 / 3,
  2 * Math.PI,
  Math.PI,
  Math.sqrt(2),
  f(0.1),
  f(0.1),
  f(Math.sin(0.1)),
  f(Math.sin(f(0.1))),
  f(f(f(16777216) + f(1)) - f(16777216)),
  -1 / 3,
  -0.125,
];

const gain = 1 + 2 ** -30;
const values = Array.from({ length: 151 }, (_, i) => 1 + (i % 17) / 16);
const outputLength = 192;
const expected = () => [
  ...values.map((x, i) => x * gain + coefficients[i % coefficients.length]),
  ...new Array(outputLength - values.length).fill(0),
];

export default {
  title: 'Scalar f64 module constants preserve declared precision boundaries',
  runs: ['float', 'integer'].map((fp64Flavor) => ({
    kind: 'compute',
    shader: 'constants.shade.ts',
    entry: 'evaluate',
    // Float is the default; an explicit option must exercise a different emitted program.
    ...(fp64Flavor === 'integer' ? { emit: { fp64Flavor } } : {}),
    workgroups: [3, 1, 1],
    bindings: { src: values, dst: new Array(outputLength).fill(0) },
    read: 'dst',
    expected,
    // All inputs are normal-range values. This tolerance distinguishes the double constants
    // from f32-rounded values without promising exact binary64 GPU arithmetic.
    tolerance: 1e-12,
    webgl2Must: true,
  })),
};
