// The host half of the overrides journey: two programs whose look is fixed when their pipeline is
// made, each run on WebGPU through `typeshade/runtime` with the values the host names for its
// pipeline (surface §69): none, so each override takes the default its declaration states, and
// some or all of them. The reference is plain JavaScript with f32 rounding where the GPU has it.
// The harness holds each result to it, and to the CPU oracle's run of the module with each named
// value as its override's default, since the oracle has no pipeline to set an override on.
//
// `blur.shade.ts` is a compute entry that reads all three of its overrides. `tint.shade.ts` is a
// render pair: its vertex entry reads one override and its fragment entry the other three, and
// the runtime creates each stage with every value the host gives.

const f = Math.fround;
const N = 96;
const input = Array.from({ length: N }, (_, i) => f(Math.sin(i * 0.3) * 2 + (i % 7) * 0.25));

/** The blur under the given overrides, each at the default `blur.shade.ts` declares when absent. */
function blur({ radius = 1, gain = 1, clamped = false } = {}) {
  return input.map((_, i) => {
    let sum = 0;
    for (let k = -radius; k <= radius; k++)
      sum = f(sum + input[Math.min(Math.max(i + k, 0), N - 1)]);
    const v = f(f(gain * sum) / (2 * radius + 1));
    return clamped ? Math.min(v, 1) : v;
  });
}

/** A run of the blur, with `constants` set by name on its pipeline when given. */
const blurRun = (constants) => ({
  kind: 'compute',
  shader: 'blur.shade.ts',
  entry: 'blur',
  workgroups: [2, 1, 1],
  bindings: { input, output: new Array(128).fill(0) },
  read: 'output',
  ...(constants !== undefined ? { constants } : {}),
  expected: () => blur(constants),
  tolerance: 1e-5,
});

/** The colour of the column `x` under the given overrides, each at the default `tint.shade.ts`
 *  declares when absent: bands of 8 columns, numbered from 0 and counted to `bands`. */
function stripe(x, { sheen = 0, tint = 1, bands = 2, inverted = false } = {}) {
  const band = (Math.floor(x / 8) % bands) / bands;
  return [band * tint, sheen, inverted ? 1 - band : band, 1];
}

/** A run of the tinted effect, with `constants` set by name on its pipeline when given. */
const tintRun = (constants) => ({
  kind: 'render',
  shader: 'tint.shade.ts',
  vertex: 'vs',
  fragment: 'fs',
  size: [32, 32],
  bindings: {},
  ...(constants !== undefined ? { constants } : {}),
  // The oracle runs the fragment entry alone, so it is handed the varying the vertex entry sets.
  fragmentArgs: (x, y) => [{ pos: [x + 0.5, y + 0.5, 0, 1], glow: constants?.sheen ?? 0 }],
  fragmentColor: (result) => result.color,
  expected: (x) => stripe(x, constants),
  // An rgba8unorm target: one step of 1/255 either way is rounding, not a wrong program.
  tolerance: 1.5 / 255,
});

export default {
  title: 'Overrides set by name for each pipeline: a blur and a tinted fullscreen effect',
  runs: [
    // Each override at its default, then all of them, then one, so the others keep theirs.
    blurRun(undefined),
    blurRun({ radius: 3, gain: 2, clamped: true }),
    blurRun({ gain: 0.5 }),
    tintRun(undefined),
    tintRun({ sheen: 0.5, tint: 0.5, bands: 4, inverted: true }),
    tintRun({ bands: 3 }),
  ],
};
