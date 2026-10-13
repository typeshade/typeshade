// The host half of the depth-stencil journey (surface §69). Each run draws one frame into a depth
// target of the format it names, cleared to the runtime's default, 1, and reads the colour back.
// The stencil aspect is not read: it has no typed spelling. The run holds the frame to validate,
// which WebGPU refuses for a depth attachment with a stencil aspect that names no stencil load and
// store op, and the colour to the reference. `depth24plus`, a depth-only format, is the control.
// The reference is plain JavaScript.

const SIZE = 16;

/** What the fragment entry writes at column `x` and row `y`. */
const colour = (x, y) => [x / 16, y / 16, 0.5, 1];

/** A run over one depth format, the same shader and reference for each. */
const drawnInto = (depth) => ({
  kind: 'render',
  shader: 'depth.shade.ts',
  vertex: 'vs',
  fragment: 'fs',
  size: [SIZE, SIZE],
  depth,
  bindings: {},
  // The oracle runs the fragment entry alone, so it is handed what the rasteriser gives it.
  fragmentArgs: (x, y) => [{ pos: [x + 0.5, y + 0.5, 0.5, 1] }],
  fragmentColor: (result) => result.color,
  expected: colour,
  // One rounding step of an 8-bit channel.
  tolerance: 1.5 / 255,
});

export default {
  title: 'A frame drawn into a depth24plus target and into a depth24plus-stencil8 target',
  runs: [drawnInto('depth24plus'), drawnInto('depth24plus-stencil8')],
};
