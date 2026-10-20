// The host half of the pipeline-state journey (proposal 0064, PR-2). It draws the pipeline fields
// the second PR adds, and holds the pixels WebGPU and WebGL2 read back to a reference computed here,
// in plain JavaScript (no CPU oracle: the shader is one entry, and the frames are several draws):
//
// - the eight stencil operations against the eight compare functions, one operation at a time in
//   each of three places: passOp (matrix-pass), failOp (matrix-fail), depthFailOp (matrix-depth-fail);
// - the stencil masks (masks), the faces, the line and the point (faces), and the reference rules
//   of a pass (reference);
// - the depth bias: its sign at three window depths (bias-sign), a bias on depth24plus (bias-format),
//   a slope (bias-slope), the proposal's decal (example-decal), a biased draw then a plain one
//   (bias-mixed), the WebGL2 bound at five window depths (bias-bound), the slope threshold (bias-slope-bound),
//   the clamp of a bias (bias-clamp, which needs EXT_polygon_offset_clamp on WebGL2),
//   and a stencil draw, a stencil-tested draw and a plain draw (stencil-mixed);
// - the sample mask of one sample (sample-mask), and the proposal's stencil outline (example-outline).
//
// The draw items: `depth` merges into the run's depth state; `colorWrite: false` writes no colour;
// `pass` groups the draws into passes (the second and later load the colour and the depth);
// `passStencil` sets the pass value of the stencil reference before the draw.

const W = 16;
const H = 12;

const WHITE = [1, 1, 1, 1];
const BLACK = [0, 0, 0, 0];
const RED = [1, 0, 0, 1];
const GREEN = [0, 1, 0, 1];

const base = {
  kind: 'render',
  shader: 'frames.shade.ts',
  vertex: 'vs',
  fragment: 'fs',
  bindings: {},
  // An rgba8unorm target: one step of 1/255 either way is rounding, not a wrong program.
  tolerance: 1.5 / 255,
  cpuOracle: false,
};

/** A run of several draws, held to `expected` at every pixel. */
const several = (size, depth, draws, expected, extra = {}) => ({
  ...base,
  size,
  ...(depth !== undefined ? { depth } : {}),
  draws,
  expected,
  ...extra,
});

const CMPS = [
  'never',
  'less',
  'equal',
  'less-equal',
  'greater',
  'not-equal',
  'greater-equal',
  'always',
];
const OPS = [
  'keep',
  'zero',
  'replace',
  'invert',
  'increment-clamp',
  'decrement-clamp',
  'increment-wrap',
  'decrement-wrap',
];
const STORED = [0, 5, 9, 255];
const REF = 9;

/** The value a cell stores after the test draw. `role` is where the operation under test sits. */
const stored = (role, cmp, op, s) => {
  const holds = {
    never: false,
    less: REF < s,
    equal: REF === s,
    'less-equal': REF <= s,
    greater: REF > s,
    'not-equal': REF !== s,
    'greater-equal': REF >= s,
    always: true,
  }[cmp];
  const apply = {
    keep: s,
    zero: 0,
    replace: REF,
    invert: ~s & 255,
    'increment-clamp': Math.min(s + 1, 255),
    'decrement-clamp': Math.max(s - 1, 0),
    'increment-wrap': (s + 1) & 255,
    'decrement-wrap': (s - 1) & 255,
  };
  if (role === 'pass') return holds ? apply[op] : s;
  if (role === 'fail') return holds ? s : apply[op];
  return holds ? apply[op] : s;
};

/** The O2 frame of one role: the setup, the test draws, and the read-out of every cell. */
const matrix = (role) => {
  const draws = [];
  for (let y = 0; y < 32; y++)
    draws.push({
      scissor: [0, y, W, 1],
      colorWrite: false,
      depth: {
        compare: 'always',
        write: false,
        stencil: { passOp: 'replace', reference: STORED[y % 4] },
      },
    });
  CMPS.forEach((cmp, i) =>
    OPS.forEach((op, j) => {
      const scissor = [2 * i, 4 * j, 2, 4];
      const stencil =
        role === 'pass'
          ? { compare: cmp, passOp: op, reference: REF }
          : role === 'fail'
            ? { compare: cmp, failOp: op, reference: REF }
            : { compare: cmp, depthFailOp: op, reference: REF };
      const depth = { compare: role === 'depth-fail' ? 'never' : 'always', write: false, stencil };
      draws.push({ scissor, colorWrite: false, depth });
    }),
  );
  CMPS.forEach((cmp, i) =>
    OPS.forEach((op, j) =>
      STORED.forEach((s, k) => {
        const want = stored(role, cmp, op, s);
        const readOut = (x, reference) => ({
          scissor: [x, 4 * j + k, 1, 1],
          constants: { pick: 3 },
          depth: { compare: 'always', write: false, stencil: { compare: 'equal', reference } },
        });
        draws.push(readOut(2 * i, want));
        draws.push(readOut(2 * i + 1, (want + 1) & 255));
      }),
    ),
  );
  return draws;
};

/** The white and black of each pixel of the matrix: the real arm is white, the control black. */
const parity = (x) => (x % 2 === 0 ? WHITE : BLACK);

const WHITE_CONSTANT = { constants: { pick: 3 } };

/** The faces: each cell is one primitive that writes the stencil on one face, then a read-out. A
 *  counter-clockwise triangle is front, a clockwise one back; a line and a point use the front face
 *  (proposal 0064, E2). The point of cell c is the centre of pixel c. */
const faceCells = () => {
  const cells = [
    { prim: 1, face: 'front' },
    { prim: 1, face: 'back' },
    { prim: 0, face: 'front' },
    { prim: 0, face: 'back' },
    { prim: 2, face: 'front', topology: 'line-list', count: 2 },
    { prim: 2, face: 'back', topology: 'line-list', count: 2 },
    { prim: 3, face: 'front', topology: 'point-list', count: 1, point: true },
    { prim: 3, face: 'back', topology: 'point-list', count: 1, point: true },
  ];
  return cells.flatMap((cell, c) => {
    const stencil = { [cell.face]: { passOp: 'replace' }, reference: 1 };
    const constants = { prim: cell.prim, ...(cell.point ? { px: -1 + (2 * c + 1) / 8 } : {}) };
    const topology =
      cell.topology === undefined ? {} : { topology: cell.topology, count: cell.count };
    return [
      {
        scissor: [c, 0, 1, 1],
        colorWrite: false,
        constants,
        ...topology,
        depth: { compare: 'always', write: false, stencil },
      },
      {
        scissor: [c, 0, 1, 1],
        constants: WHITE_CONSTANT.constants,
        depth: { compare: 'always', write: false, stencil: { compare: 'equal', reference: 1 } },
      },
    ];
  });
};

/** The reference: a declared one wins, an undeclared draw takes the pass value, the pass value is set
 *  by `passStencil`, and it is 0 at a pass start while the stencil survives a second pass (R22). */
const referenceDraws = () => {
  const declared = (reference) => ({ compare: 'always', passOp: 'replace', reference });
  const undeclared = { compare: 'always', passOp: 'replace' };
  const write = (x, stencil, extra = {}) => ({
    scissor: [x, 0, 1, 1],
    colorWrite: false,
    depth: { compare: 'always', write: false, stencil },
    ...extra,
  });
  const read = (x, reference, pass = 0) => ({
    scissor: [x, 0, 1, 1],
    constants: { pick: 3 },
    pass,
    depth: { compare: 'always', write: false, stencil: { compare: 'equal', reference } },
  });
  return [
    write(0, declared(1), { passStencil: 3 }),
    write(1, undeclared),
    write(2, undeclared, { passStencil: 5 }),
    write(3, declared(7)),
    write(4, declared(9)),
    write(6, declared(11)),
    read(0, 1),
    read(1, 3),
    read(2, 5),
    read(3, 7),
    read(5, 1),
    write(4, undeclared, { pass: 1 }),
    read(4, 0, 1),
    read(6, 11, 1),
  ];
};

/** bias-sign: a biased draw at three window depths. Each cell is red, then green with its bias. */
const biasSignDraws = () => {
  const Z = [0.25, 0.5, 0.75];
  const B = [-1000, -2, -1, 0, 1, 1000];
  return B.flatMap((b, x) =>
    Z.flatMap((z, y) => [
      {
        scissor: [x, y, 1, 1],
        constants: { depth: z, pick: 1 },
        depth: { compare: 'less', write: true },
      },
      {
        scissor: [x, y, 1, 1],
        constants: { depth: z, pick: 2 },
        depth: { compare: 'less', write: true, bias: { constant: b } },
      },
    ]),
  );
};

/** bias-format: a constant bias on depth24plus at z = 0.5. Cell 0 has bias -1; cell 1 has none. */
const biasFormatDraws = () =>
  [0, 1].flatMap((x) => [
    {
      scissor: [x, 0, 1, 1],
      constants: { depth: 0.5, pick: 1 },
      depth: { compare: 'less', write: true },
    },
    {
      scissor: [x, 0, 1, 1],
      constants: { depth: 0.5, pick: 2 },
      depth: { compare: 'less', write: true, bias: { constant: x === 0 ? -1 : 0 } },
    },
  ]);

/** bias-bound: per window depth, a cell with the measured WebGPU constant bias T (green) and one with
 *  the largest bias below the WebGL2 bound (red). Each cell draws a red plane, then a green plane
 *  `DELTA` nearer, with its bias. The constants are measured (proposal 0064, A1, record O3): WebGPU
 *  needs T, and WebGL2 needs T' with T / R <= T' <= T, where R is the bound at that depth. The red
 *  cell is `ceil(T / R) - 1`, so the cell passes only when T' is in [ceil(T / R), T]. */
const BOUND = [
  // window depth, WebGPU T, the bound R on the ratio T / T' (8 measured at 0.0625, 4 at 0.125, 2 from 0.25).
  { z: 0.0625, t: 32769, r: 8 },
  { z: 0.125, t: 16385, r: 4 },
  { z: 0.25, t: 8193, r: 2 },
  { z: 0.5, t: 4097, r: 1 },
  { z: 0.75, t: 4097, r: 1 },
];
/** The separation of the two planes: 2^-12, one of the two distances O3 measured. */
const DELTA = 2 ** -12;

/** bias-bound: a cell per bound and depth, green at -T and red at -(ceil(T / R) - 1). */
const boundDraws = () =>
  BOUND.flatMap(({ z, t, r }, i) =>
    [-t, -(Math.ceil(t / r) - 1)].flatMap((bias, j) => {
      const x = 2 * i + j;
      return [
        {
          scissor: [x, 0, 1, 1],
          constants: { depth: z, pick: 1 },
          depth: { compare: 'less', write: true },
        },
        {
          scissor: [x, 0, 1, 1],
          constants: { depth: z + DELTA, pick: 2 },
          depth: { compare: 'less', write: true, bias: { constant: bias } },
        },
      ];
    }),
  );

/** bias-slope-bound: a plane with slope 1/8 at window depth 0.5, a red draw, then a green one nearer by
 *  2^-8 with slope scale s. The measured smallest passing s is -0.3125 on both tiers (record O3): -0.25
 *  stays red and -0.3125 turns green, at pixels (8, 8) and (9, 8). */
const slopeBoundDraws = () =>
  [-0.25, -0.3125]
    .map((s, j) => [
      {
        scissor: [8 + j, 8, 1, 1],
        constants: { depth: 0.5, slope: 0.125, pick: 1 },
        depth: { compare: 'less', write: true },
      },
      {
        scissor: [8 + j, 8, 1, 1],
        constants: { depth: 0.5 + 2 ** -8, slope: 0.125, pick: 2 },
        depth: { compare: 'less', write: true, bias: { slopeScale: s } },
      },
    ])
    .flat();

/** bias-slope: a sloped plane, and a draw of the same plane with slope scale -1, 0 and 1 by cell. */
const biasSlopeDraws = () =>
  [0, 1, 2].flatMap((x) => {
    const slopeScale = [-1, 0, 1][x];
    return [
      {
        scissor: [x, 0, 1, 1],
        constants: { depth: 0.5, slope: 0.125, pick: 1 },
        depth: { compare: 'less', write: true },
      },
      {
        scissor: [x, 0, 1, 1],
        constants: { depth: 0.5, slope: 0.125, pick: 2 },
        depth: { compare: 'less', write: true, bias: { slopeScale } },
      },
    ];
  });

/** bias-clamp: a constant bias of -1000000 on depth24plus, against a red plane at window depth 0.5
 *  and a green plane behind it by 2^-12. Cell 0 clamps the bias to -1e-6 (EXT_polygon_offset_clamp):
 *  the offset is limited, the green plane stays behind the red one, and the cell stays red. Cell 1
 *  has no clamp, so its offset carries the green plane in front: green. */
const biasClampDraws = () =>
  [0, 1].flatMap((x) => [
    {
      scissor: [x, 0, 1, 1],
      constants: { depth: 0.5, pick: 1 },
      depth: { compare: 'less', write: true },
    },
    {
      scissor: [x, 0, 1, 1],
      constants: { depth: 0.5 + 2 ** -12, pick: 2 },
      depth: {
        compare: 'less',
        write: true,
        bias: { constant: -1000000, ...(x === 0 ? { clamp: -1e-6 } : {}) },
      },
    },
  ]);

export default {
  title: 'pipeline state: stencil, depth bias and sample mask, on WebGPU and WebGL2',
  runs: [
    // O2: the stencil operations, each in one place, against the compare functions.
    several([W, 32], 'depth24plus-stencil8', matrix('pass'), parity),
    several([W, 32], 'depth24plus-stencil8', matrix('fail'), parity),
    several([W, 32], 'depth24plus-stencil8', matrix('depth-fail'), parity),
    // The masks, one cell per pixel. The test of x = 1 reads five bits; x = 2 reads all eight.
    several(
      [8, 1],
      'depth24plus-stencil8',
      [
        {
          scissor: [0, 0, 1, 1],
          colorWrite: false,
          depth: { compare: 'always', write: false, stencil: { passOp: 'replace', reference: 16 } },
        },
        {
          scissor: [0, 0, 1, 1],
          ...WHITE_CONSTANT,
          depth: {
            compare: 'always',
            write: false,
            stencil: { compare: 'equal', reference: 0, readMask: 0x0f },
          },
        },
        {
          scissor: [1, 0, 1, 1],
          colorWrite: false,
          depth: { compare: 'always', write: false, stencil: { passOp: 'replace', reference: 16 } },
        },
        {
          scissor: [1, 0, 1, 1],
          ...WHITE_CONSTANT,
          depth: {
            compare: 'always',
            write: false,
            stencil: { compare: 'equal', reference: 0, readMask: 0x105 },
          },
        },
        {
          scissor: [2, 0, 1, 1],
          colorWrite: false,
          depth: { compare: 'always', write: false, stencil: { passOp: 'replace', reference: 16 } },
        },
        {
          scissor: [2, 0, 1, 1],
          ...WHITE_CONSTANT,
          depth: {
            compare: 'always',
            write: false,
            stencil: { compare: 'equal', reference: 0, readMask: 0xff },
          },
        },
        {
          scissor: [3, 0, 1, 1],
          colorWrite: false,
          depth: {
            compare: 'always',
            write: false,
            stencil: { passOp: 'replace', reference: 255, writeMask: 0x105 },
          },
        },
        {
          scissor: [3, 0, 1, 1],
          ...WHITE_CONSTANT,
          depth: { compare: 'always', write: false, stencil: { compare: 'equal', reference: 5 } },
        },
        {
          scissor: [4, 0, 1, 1],
          ...WHITE_CONSTANT,
          depth: { compare: 'always', write: false, stencil: { compare: 'equal', reference: 255 } },
        },
        {
          scissor: [5, 0, 1, 1],
          colorWrite: false,
          depth: {
            compare: 'always',
            write: false,
            stencil: { passOp: 'replace', reference: 255, writeMask: 0 },
          },
        },
        {
          scissor: [5, 0, 1, 1],
          ...WHITE_CONSTANT,
          depth: { compare: 'always', write: false, stencil: { compare: 'equal', reference: 0 } },
        },
        {
          scissor: [6, 0, 1, 1],
          colorWrite: false,
          depth: {
            compare: 'always',
            write: false,
            stencil: { passOp: 'replace', reference: 255, writeMask: 0xffffffff },
          },
        },
        {
          scissor: [6, 0, 1, 1],
          ...WHITE_CONSTANT,
          depth: { compare: 'always', write: false, stencil: { compare: 'equal', reference: 255 } },
        },
      ],
      (x) => ([0, 1, 3, 5, 6].includes(x) ? WHITE : BLACK),
    ),
    // faces: a counter-clockwise triangle, a clockwise one, a line and a point, each with a stencil
    // operation on one face. The cell is white when its face is the one the operation names.
    several([8, 1], 'depth24plus-stencil8', faceCells(), (x) =>
      x === 0 || x === 3 || x === 4 || x === 6 ? WHITE : BLACK,
    ),
    // reference: the pass value, the declared reference, and the pass value at a pass start.
    several([8, 1], 'depth24plus-stencil8', referenceDraws(), (x) =>
      [0, 1, 2, 3, 4, 6].includes(x) ? WHITE : BLACK,
    ),
    // bias-sign: a biased draw at three window depths, the bias negative (green) or not (red).
    several([6, 3], 'depth32float', biasSignDraws(), (x) => (x < 3 ? GREEN : RED)),
    // bias-format: a constant bias on depth24plus, on both tiers (A1).
    several([2, 1], 'depth24plus', biasFormatDraws(), (x) => (x === 0 ? GREEN : RED)),
    // bias-slope: a slope scale on depth32float, on both tiers (A1).
    several([3, 1], 'depth32float', biasSlopeDraws(), (x) => (x === 0 ? GREEN : RED)),
    // bias-bound: the WebGL2 constant bias lies within the bound of A1 (F4), on the three formats the
    // tiers take a bias on. Cell 2i is green and cell 2i + 1 is red, at BOUND[i].z.
    ...['depth24plus', 'depth32float', 'depth24plus-stencil8'].map((format) =>
      several([10, 1], format, boundDraws(), (x) => (x % 2 === 0 ? GREEN : RED)),
    ),
    // bias-slope-bound: the slope threshold is -0.3125 on both tiers (A1, F4).
    several([16, 16], 'depth32float', slopeBoundDraws(), (x, y) =>
      y === 8 && x === 9 ? GREEN : y === 8 && x >= 8 && x <= 9 ? RED : BLACK,
    ),
    // sample-mask: a mask of one sample keeps the draw when bit 0 is set, and drops it otherwise.
    several(
      [5, 1],
      undefined,
      [
        { scissor: [0, 0, 1, 1], constants: { pick: 3 }, mask: 0 },
        { scissor: [1, 0, 1, 1], constants: { pick: 3 }, mask: 1 },
        { scissor: [2, 0, 1, 1], constants: { pick: 3 }, mask: 2 },
        { scissor: [3, 0, 1, 1], constants: { pick: 3 }, mask: 0xffffffff },
        { scissor: [4, 0, 1, 1], constants: { pick: 3 } },
      ],
      (x) => ([1, 3, 4].includes(x) ? WHITE : BLACK),
    ),
    // bias-clamp: a non-zero clamp on WebGL2 is EXT_polygon_offset_clamp. The run needs the extension
    // there, and reports that it did not run when the context lacks it (A1, F4).
    several([2, 1], 'depth24plus', biasClampDraws(), (x) => (x === 0 ? RED : GREEN), {
      webgl2Requires: 'EXT_polygon_offset_clamp',
    }),
    // example-decal: the proposal's decal. A coplanar biased draw wins a `less` test.
    several(
      [4, 4],
      'depth32float',
      [
        { constants: { pick: 1 }, depth: { compare: 'less', write: true } },
        { constants: { pick: 2 }, depth: { bias: { constant: -2 } } },
      ],
      () => GREEN,
    ),
    // example-outline: the proposal's stencil outline, the mark in pass 0 and the outline in pass 1.
    several(
      [W, H],
      'depth24plus-stencil8',
      [
        {
          pass: 0,
          constants: { pick: 1 },
          scissor: [4, 3, 8, 6],
          depth: { compare: 'always', write: false, stencil: { passOp: 'replace', reference: 1 } },
        },
        {
          pass: 1,
          constants: { pick: 2 },
          depth: { write: false, stencil: { compare: 'not-equal', reference: 1 } },
        },
      ],
      (x, y) => (x >= 4 && x < 12 && y >= 3 && y < 9 ? RED : GREEN),
    ),
    // bias-mixed: a biased draw, then a plain one. The plain draw is coplanar and fails `less`.
    several(
      [2, 1],
      'depth32float',
      [
        { scissor: [0, 0, 1, 1], constants: { pick: 1 }, depth: { compare: 'less', write: true } },
        { scissor: [0, 0, 1, 1], constants: { pick: 2 }, depth: { bias: { constant: -2 } } },
        { scissor: [1, 0, 1, 1], constants: { pick: 1 }, depth: { compare: 'less', write: true } },
        { scissor: [1, 0, 1, 1], constants: { pick: 2 }, depth: { compare: 'less', write: true } },
      ],
      (x) => (x === 0 ? GREEN : RED),
    ),
    // stencil-mixed: a stencil draw, a stencil-tested draw and a plain draw with no stencil.
    several(
      [3, 1],
      'depth24plus-stencil8',
      [
        {
          scissor: [0, 0, 1, 1],
          colorWrite: false,
          depth: { compare: 'always', write: false, stencil: { passOp: 'replace', reference: 1 } },
        },
        {
          scissor: [0, 0, 2, 1],
          constants: { pick: 3 },
          depth: { compare: 'always', write: false, stencil: { compare: 'equal', reference: 1 } },
        },
        {
          scissor: [2, 0, 1, 1],
          constants: { pick: 1 },
          depth: { compare: 'always', write: false },
        },
      ],
      (x) => [WHITE, BLACK, RED][x],
    ),
  ],
};
