// The host half of the HDR target journey (change 0028, Rule 11.11, surface §69): a fragment entry
// draws values an 8-bit target cannot hold, above 1 and below 0, into an `rgba16float` target on
// WebGPU through `typeshade/runtime`, and the target is read back with `readFloats()`, the numbers
// of its texels in the order of its channels. The reference is plain JavaScript.
//
// Every value is a small dyadic number, exactly the half float the target stores, and the shader
// computes each in f32 with no rounding, so the harness holds the readback to the reference with a
// tolerance far under one step of the half float's significand (2^-10 of a value): a readback that
// decodes the exponent or one bit of the significand wrongly fails here. The harness starts the
// read while the frame is still pending, then draws a later frame that clears the target to -1,
// and holds the read to the first frame and the target afterwards to the clear: a read reads what
// was submitted before the call, and the frame submitted after it runs after its copy.

const SIZE = 16;

/** What the fragment entry writes at column `x` and row `y`. */
const color = (x, y) => [x * 4 + 0.25, (y - 8) * 0.375, x * y * 8, 1];

export default {
  title: 'An rgba16float target drawn with values above 1 and below 0, read back with readFloats()',
  runs: [
    {
      kind: 'render',
      shader: 'hdr.shade.ts',
      vertex: 'vs',
      fragment: 'fs',
      size: [SIZE, SIZE],
      // The target the harness makes and reads back with readFloats(): its values are not clamped.
      target: 'rgba16float',
      bindings: {},
      // The oracle runs the fragment entry alone, so it is handed what the rasteriser gives it.
      fragmentArgs: (x, y) => [{ pos: [x + 0.5, y + 0.5, 0, 1] }],
      fragmentColor: (result) => result.color,
      expected: color,
      tolerance: 1e-6,
    },
  ],
};
