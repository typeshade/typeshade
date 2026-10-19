// The host half of the render-state journey (proposal 0064, PR-1). It sets the pass's own state
// around the draws and holds the pixels WebGPU and WebGL2 read back to a reference computed here,
// in plain JavaScript:
//
// - a scissor keeps the pixels inside its rectangle, with the y of a texture row (S0 to S3); a
//   rectangle wholly outside the target passes on with zero size and draws nothing (S3);
// - a viewport maps the triangle onto its rectangle, so the colour runs from its own corner (V1);
// - the depth range maps a fragment's depth into the range the pass sets (R0 and R1);
// - a blend constant is the pass value unless a pipeline declares one, and a draw restores the pass
//   value after a draw that declared one (B0 to B3);
// - a host's own pass state is the same at the end of a frame as at its start, and a kernel pass
//   run after the render pass still writes (O10, the `hostState` run).
//
// The pipeline depth and colour come from overrides of the one vertex and fragment entry: `depth`
// is the triangle's depth (0.5 when none is given), and `pick` the fragment's colour (0 is the
// colour of the position, 1 red, 2 green, 3 white).

const W = 16;
const H = 12;
const f = Math.fround;

/** The colour of the position: `uv` with 0.5 and 1, at the pixel's centre. */
const uvColour = (x, y) => [(x + 0.5) / W, (y + 0.5) / H, 0.5, 1];

/** A fragment entry's arguments at (x, y) for the whole target: the struct the vertex entry gives. */
const fragmentArgs = (x, y) => [
  { pos: [x + 0.5, y + 0.5, 0, 1], uv: [f((x + 0.5) / W), f((y + 0.5) / H)] },
];

/** The same, for a viewport at (3, 2) of 8 by 6: `uv` runs over the viewport. */
const viewportArgs = (x, y) => [
  { pos: [x + 0.5, y + 0.5, 0, 1], uv: [f((x - 3 + 0.5) / 8), f((y - 2 + 0.5) / 6)] },
];

const base = {
  kind: 'render',
  shader: 'frames.shade.ts',
  vertex: 'vs',
  fragment: 'fs',
  size: [W, H],
  bindings: {},
  fragmentArgs,
  fragmentColor: (result) => result.color,
  // An rgba8unorm target: one step of 1/255 either way is rounding, not a wrong program.
  tolerance: 1.5 / 255,
};

/** A run of several draws: each draw's pipeline is built from its own overrides, and the pixels
 *  are the expected function's, with no CPU oracle (it draws one entry, not several). */
const several = (draws, expected, extra = {}) => ({
  ...base,
  draws,
  expected,
  cpuOracle: false,
  ...extra,
});

const WHITE = { constants: { pick: 3 } };
const RED = { constants: { pick: 1 } };

export default {
  title: 'render state: scissor, viewport, depth range and blend constant, on WebGPU and WebGL2',
  runs: [
    // S0 is the control: no scissor, the whole frame coloured.
    { ...base, expected: uvColour },
    // S1: the rectangle is at x 3 to 11 and y 2 to 6, so a y flip would put it on rows 5 to 9.
    { ...base, scissor: [3, 2, 9, 5], expected: uvColour },
    // S2: a rectangle past the target's edge is clipped to it.
    { ...base, scissor: [10, 6, 20, 20], expected: uvColour },
    // S3: a rectangle wholly past the target is passed on with zero size, and nothing is drawn.
    { ...base, scissor: [20, 20, 4, 4], expected: () => [0, 0, 0, 0] },
    // V1: the viewport at (3, 2) of 8 by 6; pixels outside it keep the clear value.
    {
      ...base,
      viewport: [3, 2, 8, 6],
      fragmentArgs: viewportArgs,
      expected: (x, y) => [(x - 3 + 0.5) / 8, (y - 2 + 0.5) / 6, 0.5, 1],
    },
    // R1: the first draw writes depth 0.5 (red). The second draw is at depth 0.8, which maps to 0.4
    // under a range of 0 to 0.5, so it passes the test `less` and is green.
    several(
      [
        { ...RED, constants: { depth: 0.5, pick: 1 } },
        { constants: { depth: 0.8, pick: 2 }, viewport: [0, 0, W, H, 0, 0.5] },
      ],
      () => [0, 1, 0, 1],
      { depth: 'depth24plus' },
    ),
    // R0 is the control: the same draws with the default range, where 0.8 fails `less` against 0.5.
    several(
      [
        { constants: { depth: 0.5, pick: 1 } },
        { constants: { depth: 0.8, pick: 2 }, viewport: [0, 0, W, H] },
      ],
      () => [1, 0, 0, 1],
      { depth: 'depth24plus' },
    ),
    // B0 is the control: no pass constant and no pipeline constant, so the default is [0, 0, 0, 0].
    several([{ ...WHITE, blend: 'constant' }], () => [0, 0, 0, 0]),
    // B1: the pass constant, with which a blend of the white colour gives that colour.
    several([{ ...WHITE, blend: 'constant', passBlend: [0.25, 0.5, 0.75, 1] }], () => [
      0.25, 0.5, 0.75, 1,
    ]),
    // B2: the pipeline's own constant, the same colour as B1 without a pass constant.
    several([{ ...WHITE, blend: 'constant', pipelineBlend: [0.25, 0.5, 0.75, 1] }], () => [
      0.25, 0.5, 0.75, 1,
    ]),
    // B3: the first draw sets the pass constant and declares its own, which is red. The second draw
    // declares none, so it is given the pass constant again, which is green (R32).
    several(
      [
        {
          ...WHITE,
          blend: 'constant',
          scissor: [0, 0, 8, H],
          passBlend: [0, 1, 0, 1],
          pipelineBlend: [1, 0, 0, 1],
        },
        { ...WHITE, blend: 'constant', scissor: [8, 0, 8, H] },
      ],
      (x) => (x < 8 ? [1, 0, 0, 1] : [0, 1, 0, 1]),
    ),
    // O10: the host's own GL state is set before the frame and read after it, and a kernel pass
    // runs after the render pass. On WebGL2 only; the pixels are S1's.
    {
      ...base,
      scissor: [3, 2, 9, 5],
      expected: uvColour,
      hostState: true,
    },
  ],
};
