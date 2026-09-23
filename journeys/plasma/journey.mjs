// The host half of the plasma journey, as its author would write it: pack the uniform the way
// WGSL lays it out (two f32 at offsets 0 and 4, padded to 16 bytes), draw one fullscreen
// triangle into a 64x64 texture, and compute in plain JavaScript what each pixel should be.

const time = 1.25;
const scale = 0.09;

/** What the fragment shader computes, in JavaScript: the colour of the pixel at (x, y). */
function pixel(x, y) {
  const u = (x + 0.5) * scale;
  const w = (y + 0.5) * scale;
  let v = 0;
  for (let i = 0; i < 4; i++) {
    const k = i + 1;
    v += (Math.sin(u * k + time) * Math.cos(w * k - time)) / k;
  }
  const c = v * 0.5 + 0.5;
  return [c, c * c, 1 - c, 1];
}

export default {
  title: 'A fullscreen fragment effect',
  runs: [
    {
      kind: 'render',
      shader: 'plasma.shade.ts',
      vertex: 'vs',
      fragment: 'fs',
      size: [64, 64],
      bindings: {
        frame: { gpu: new Float32Array([time, scale, 0, 0]), cpu: { time, scale } },
      },
      // The fragment entry takes the pixel's position; its centre is at +0.5.
      fragmentArgs: (x, y) => [[x + 0.5, y + 0.5, 0, 1]],
      fragmentColor: (result) => result.color,
      expected: pixel,
      // An rgba8unorm target: one step of 1/255 either way is rounding, not a wrong program.
      tolerance: 1.5 / 255,
    },
  ],
};
