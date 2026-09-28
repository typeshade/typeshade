// The host half of the fragment console journey. It draws a fullscreen triangle into a 32x24
// texture with the console recorded (surface §66) and holds the lines WebGPU records to the
// ones computed here in plain JavaScript, and to the CPU oracle's:
//
// - the whole frame: one line per pixel, in the order the CPU runs them, row by row;
// - a scissor rectangle of one pixel: that pixel's line and no other, which is how a debugger
//   asks the GPU about the pixel under the cursor;
// - a buffer with room for ten lines: ten whole lines kept, the rest counted as dropped;
// - the same one-pixel scissor on a fragment that takes `fwidth`: the helper invocations the
//   GPU runs beside the pixel for the derivative write nothing.
//
// `pos` is the pixel's centre, exact on both sides. `uv` is interpolated by the rasteriser on
// WebGPU and computed here from the pixel's centre, so the two may differ in the last bit of an
// f32: the console tolerance is two units in the last place.

const W = 32;
const H = 24;
const f = Math.fround;

/** The line pixel (x, y) logs. */
const line = (x, y) => ({
  method: 'log',
  args: ['pixel', x + 0.5, y + 0.5, [f((x + 0.5) / W), f((y + 0.5) / H)]],
  invocation: [x, y, 0],
});

/** What the fragment entry writes at (x, y). */
const color = (x, y) => [(x + 0.5) / W, (y + 0.5) / H, 0, 1];

/** A fragment entry's arguments at (x, y): the struct the vertex entry's outputs become. */
const fragmentArgs = (x, y) => [
  { pos: [x + 0.5, y + 0.5, 0, 1], uv: [f((x + 0.5) / W), f((y + 0.5) / H)] },
];

const every = () => {
  const out = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out.push(line(x, y));
  return out;
};

const base = {
  kind: 'render',
  shader: 'pixels.shade.ts',
  vertex: 'vs',
  fragment: 'fs',
  size: [W, H],
  bindings: {},
  fragmentArgs,
  fragmentColor: (result) => result.color,
  expected: color,
  // An rgba8unorm target: one step of 1/255 either way is rounding, not a wrong program.
  tolerance: 1.5 / 255,
};

export default {
  title: 'console.log from a fragment shader, read back from WebGPU',
  runs: [
    { ...base, console: { capacity: W * H * 8, tolerance: 2 ** -22, expected: every } },
    {
      ...base,
      scissor: [5, 7, 1, 1],
      console: { capacity: 64, tolerance: 2 ** -22, expected: () => [line(5, 7)] },
    },
    {
      ...base,
      // Eight words a line (the call's index, the invocation's three, `pos.x`, `pos.y` and the
      // two of `uv`): room for ten. Which ten is the GPU's order, so each is held to its pixel's.
      console: {
        capacity: 80,
        tolerance: 2 ** -22,
        expected: every,
        kept: 10,
      },
    },
    {
      ...base,
      shader: 'edge.shade.ts',
      fragment: 'edge',
      // `fwidth` has no CPU value: the oracle stands in 0 for it, which discards nothing.
      gpuStubs: true,
      scissor: [0, 0, 1, 1],
      console: { capacity: 64, tolerance: 2 ** -22, expected: () => [line(0, 0)] },
    },
  ],
};
