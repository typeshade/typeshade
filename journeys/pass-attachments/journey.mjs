// The host half of the pass-attachments journey (proposal 0064, PR-3). It draws the attachment
// fields the third PR adds, and holds the pixels that WebGPU and WebGL2 read back to a reference
// computed here, in plain JavaScript (no CPU oracle: the shader is one entry, and the frames are
// several passes):
//
// - the stencil discard and the depth discard, one aspect at a time and both together, against a
//   stale stencil write mask and a stale depth mask (discard-none to discard-both), the depth24plus
//   discard read through a later pass (discard-depth24), the colour discard under a partial colour
//   write mask (discard-colour), the integer colour discard (discard-uint), and the depth32float
//   discard read back (discard-depth32);
// - the stencil clear, the depth and the stencil cleared apart, and a clear with a load of 'load'
//   that is ignored (stencil-clear, stencil-apart-a, stencil-apart-b, stencil-clear-ignored);
// - the read-only aspects: a read-only depth with its control (readonly-depth, readonly-depth-writes),
//   the translucent pass (example-glass), and a read-only stencil with its control and an inherited
//   one (readonly-stencil, readonly-stencil-control, readonly-inherited).
//
// The draw items: `depth` merges into the run's depth state; `colorWrite: false` writes no colour;
// `writeMask` sets the colour write mask of the target; `pass` groups the draws into passes;
// `constants` sets the depth and the colour. `passes[n]` states the attachments of pass n whole.
// A read-out draws white where its test passes, so each cell reads one value of the attachment.

const WHITE = [1, 1, 1, 1];
const BLACK = [0, 0, 0, 0];
const RED = [1, 0, 0, 1];
const GREEN = [0, 1, 0, 1];
const PARITY = [1, 0, 1, 1];

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

/** A run of several passes, held to `expected` at every pixel. */
const several = (size, depth, draws, expected, extra = {}) => ({
  ...base,
  size,
  ...(depth !== undefined ? { depth } : {}),
  draws,
  expected,
  ...extra,
});

/** The read-out of a stencil cell: white where the stencil equals `reference`, in pass `pass`. */
const stencilReadOut = (x, reference, pass = 1) => ({
  scissor: [x, 0, 1, 1],
  constants: { pick: 3 },
  pass,
  depth: { compare: 'always', write: false, stencil: { compare: 'equal', reference } },
});

/** The read-out of a depth cell: white where the stored depth passes `compare` against `z`. */
const depthReadOut = (x, compare, z, pass = 1) => ({
  scissor: [x, 0, 1, 1],
  constants: { pick: 3, depth: z },
  pass,
  depth: { compare, write: false },
});

/** Pass 0 of the discard runs: a stencil of 0xA5 and a depth of 0.25, then a draw with a stale write mask. */
const discardSetup = [
  {
    colorWrite: false,
    constants: { depth: 0.25 },
    depth: { compare: 'always', write: true, stencil: { passOp: 'replace', reference: 0xa5 } },
  },
  {
    colorWrite: false,
    constants: { depth: 0.25 },
    depth: { compare: 'never', write: false, stencil: { writeMask: 0x0f } },
  },
];

/** The read-outs of the discard runs: the stencil at x = 0 and 1, and the depth at x = 2 and 3. */
const discardReadOuts = [
  stencilReadOut(0, 0),
  stencilReadOut(1, 0xa5),
  depthReadOut(2, 'greater', 0.1),
  depthReadOut(3, 'less', 0.1),
];

/** Pass 0 of the apart runs: a stencil of 5 and a depth of 0.25 at every pixel. */
const apartSetup = [
  {
    colorWrite: false,
    constants: { depth: 0.25 },
    depth: { compare: 'always', write: true, stencil: { passOp: 'replace', reference: 5 } },
  },
];

/** The read-outs of the apart runs: the stencil at x = 0 and 1, and the depth at 0.9 at x = 2 and 3. */
const apartReadOuts = (s0, s1) => [
  stencilReadOut(0, s0),
  stencilReadOut(1, s1),
  depthReadOut(2, 'greater', 0.9),
  depthReadOut(3, 'less', 0.9),
];

/** The draws of the read-only depth runs: pass 0 writes a red plane at depth 0.5; pass 1 tests a green
 *  plane at 0.25 (x = 2 and 3) and at 0.75 (x = 4 and 5), with `write` set by the run. */
const readOnlyDraws = (write) => [
  { constants: { depth: 0.5, pick: 1 }, depth: { compare: 'less', write: true } },
  { scissor: [2, 0, 2, 1], constants: { depth: 0.25, pick: 2 }, pass: 1, depth: { compare: 'less', write } },
  { scissor: [4, 0, 2, 1], constants: { depth: 0.75, pick: 2 }, pass: 1, depth: { compare: 'less', write } },
];

/** The colour of the read-only depth runs: the green plane passes at x = 2 and 3 only. */
const READ_ONLY_COLOUR = [RED, RED, GREEN, GREEN, RED, RED];

/** Pass 0 of the read-only stencil runs: a stencil of 1 at x = 0 and 1, with no colour. */
const roStencilWrite = {
  scissor: [0, 0, 2, 1],
  colorWrite: false,
  depth: { compare: 'always', write: false, stencil: { passOp: 'replace', reference: 1 } },
};

/** The white draw of the read-only stencil runs, in pass 1: it draws where the stencil equals 1. */
const roStencilTest = {
  constants: { pick: 3 },
  pass: 1,
  depth: { compare: 'always', write: false, stencil: { compare: 'equal', reference: 1 } },
};

/** The uint run: one full-screen draw of the integer shader into an rgba8uint target, held to its texels. */
const uintRun = (passes, expected) => ({
  ...base,
  shader: 'uint.shade.ts',
  target: 'rgba8uint',
  size: [2, 1],
  draws: [{}],
  integer: true,
  tolerance: 0,
  webgl2Must: true,
  expected,
  ...(passes !== undefined ? { passes } : {}),
});

/** The depth readback of a depth32float run: a green plane at depth 0.25 that the discard may clear. */
const depthRun = (passes, expectedDepth) => ({
  ...several(
    [2, 1],
    'depth32float',
    [
      { constants: { depth: 0.25, pick: 2 }, depth: { compare: 'less', write: true } },
      { colorWrite: false, constants: { depth: 0.25 }, depth: { compare: 'never', write: false } },
    ],
    () => GREEN,
  ),
  readDepth: true,
  expectedDepth,
  ...(passes !== undefined ? { passes } : {}),
});

export default {
  title: 'pass attachments: store, readOnly and the stencil object, on WebGPU and WebGL2',
  runs: [
    // The stencil discard and the depth discard, each alone and both together (example-discard is
    // discard-both, the proposal's example of a discarded depth and stencil).
    // discard-none: the control, with no discard.
    several([4, 1], 'depth24plus-stencil8', [...discardSetup, ...discardReadOuts], (x) => [BLACK, WHITE, BLACK, WHITE][x]),
    // discard-stencil-only: the stencil is discarded, the depth kept.
    several(
      [4, 1],
      'depth24plus-stencil8',
      [...discardSetup, ...discardReadOuts],
      (x) => [WHITE, BLACK, BLACK, WHITE][x],
      { passes: [{ depth: { stencil: { store: 'discard' } } }] },
    ),
    // discard-depth-only: the depth is discarded, the stencil kept.
    several(
      [4, 1],
      'depth24plus-stencil8',
      [...discardSetup, ...discardReadOuts],
      (x) => [BLACK, WHITE, WHITE, BLACK][x],
      { passes: [{ depth: { store: 'discard', stencil: { store: 'store' } } }] },
    ),
    // discard-both: the depth and the stencil are discarded.
    several(
      [4, 1],
      'depth24plus-stencil8',
      [...discardSetup, ...discardReadOuts],
      (x) => [WHITE, BLACK, WHITE, BLACK][x],
      { passes: [{ depth: { store: 'discard' } }] },
    ),
    // discard-depth24: the depth24plus discard, read through a later pass, and its control.
    several(
      [2, 1],
      'depth24plus',
      [
        { colorWrite: false, constants: { depth: 0.25 }, depth: { compare: 'always', write: true } },
        { colorWrite: false, constants: { depth: 0.25 }, depth: { compare: 'never', write: false } },
        depthReadOut(0, 'greater', 0.1),
        depthReadOut(1, 'less', 0.1),
      ],
      (x) => [WHITE, BLACK][x],
      { passes: [{ depth: { store: 'discard' } }] },
    ),
    several(
      [2, 1],
      'depth24plus',
      [
        { colorWrite: false, constants: { depth: 0.25 }, depth: { compare: 'always', write: true } },
        { colorWrite: false, constants: { depth: 0.25 }, depth: { compare: 'never', write: false } },
        depthReadOut(0, 'greater', 0.1),
        depthReadOut(1, 'less', 0.1),
      ],
      (x) => [BLACK, WHITE][x],
    ),
    // discard-colour: a partial colour write mask, then the colour discarded to 0.
    several(
      [4, 4],
      undefined,
      [
        { constants: { pick: 3 } },
        { constants: { pick: 1 }, writeMask: 2 },
      ],
      () => BLACK,
      { passes: [{ color: { clear: [0, 0, 0, 0], store: 'discard' } }] },
    ),
    several(
      [4, 4],
      undefined,
      [
        { constants: { pick: 3 } },
        { constants: { pick: 1 }, writeMask: 2 },
      ],
      () => PARITY,
    ),
    // discard-uint: the integer colour discard (the unsigned clear); its WebGL2 leg must run.
    uintRun([{ color: { clear: [0, 0, 0, 0], store: 'discard' } }], () => [0, 0, 0, 0]),
    uintRun(undefined, () => [7, 8, 9, 10]),
    // discard-depth32: the depth read back after a discard, and its control.
    depthRun([{ depth: { store: 'discard' } }], () => 0),
    depthRun(undefined, () => 0.25),
    // stencil-clear: a stencil clear to 7, read at four values.
    several(
      [4, 1],
      'depth24plus-stencil8',
      [stencilReadOut(0, 7, 0), stencilReadOut(1, 0, 0), stencilReadOut(2, 8, 0), stencilReadOut(3, 255, 0)],
      (x) => [WHITE, BLACK, BLACK, BLACK][x],
      { passes: [{ depth: { stencil: { clear: 7 } } }] },
    ),
    // stencil-apart-a: the depth loads and the stencil clears to 9; the depth is kept at 0.25.
    several([4, 1], 'depth24plus-stencil8', [...apartSetup, ...apartReadOuts(9, 5)], (x) => [WHITE, BLACK, WHITE, BLACK][x], {
      passes: [{}, { depth: { load: 'load', stencil: { load: 'clear', clear: 9 } } }],
    }),
    // stencil-apart-b: the stencil loads and the depth clears to 1; the stencil is kept at 5.
    several([4, 1], 'depth24plus-stencil8', [...apartSetup, ...apartReadOuts(5, 9)], (x) => [WHITE, BLACK, BLACK, WHITE][x], {
      passes: [{}, { depth: { load: 'clear', stencil: { load: 'load' } } }],
    }),
    // stencil-clear-ignored: a stencil clear under a depth load of 'load' is ignored (R35).
    several([2, 1], 'depth24plus-stencil8', [...apartSetup, stencilReadOut(0, 9), stencilReadOut(1, 5)], (x) => [BLACK, WHITE][x], {
      passes: [{}, { depth: { load: 'load', stencil: { load: 'load', clear: 9 } } }],
    }),
    // readonly-depth: a read-only depth in pass 1 keeps the depth, and the pass tests against it.
    several([6, 1], 'depth32float', readOnlyDraws(false), (x) => READ_ONLY_COLOUR[x], {
      passes: [{}, { color: { load: 'load' }, depth: { readOnly: true } }],
      readDepth: true,
      expectedDepth: () => 0.5,
    }),
    // readonly-depth-writes: the control of the readback: the same pass with a writable depth.
    several([6, 1], 'depth32float', readOnlyDraws(true), (x) => READ_ONLY_COLOUR[x], {
      passes: [{}, { color: { load: 'load' }, depth: { load: 'load' } }],
      readDepth: true,
      expectedDepth: (x) => (x === 2 || x === 3 ? 0.25 : 0.5),
    }),
    // example-glass: the translucent pass, depth-tested against the opaque depth and not written.
    several([6, 1], 'depth24plus', readOnlyDraws(false), (x) => READ_ONLY_COLOUR[x], {
      passes: [{}, { color: { load: 'load' }, depth: { readOnly: true } }],
    }),
    // readonly-stencil: a read-only stencil keeps the stencil that pass 0 wrote.
    several([4, 1], 'depth24plus-stencil8', [roStencilWrite, roStencilTest], (x) => [WHITE, WHITE, BLACK, BLACK][x], {
      passes: [{}, { color: { load: 'load' }, depth: { load: 'load', stencil: { readOnly: true } } }],
    }),
    // readonly-stencil-control: the same pass with the stencil cleared, so the test draws nowhere.
    several([4, 1], 'depth24plus-stencil8', [roStencilWrite, roStencilTest], () => BLACK, {
      passes: [{}, { color: { load: 'load' }, depth: { load: 'load', stencil: { readOnly: false, load: 'clear' } } }],
    }),
    // readonly-inherited: a read-only depth makes the stencil read-only too, with no field given.
    several([4, 1], 'depth24plus-stencil8', [roStencilWrite, roStencilTest], (x) => [WHITE, WHITE, BLACK, BLACK][x], {
      passes: [{}, { color: { load: 'load' }, depth: { readOnly: true } }],
    }),
  ],
};
