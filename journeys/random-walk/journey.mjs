// The host half of the random-walk journey, as its author would write it: pack the uniform the
// way WGSL lays it out (two f32, padded to 16 bytes), hand the kernel a buffer of three floats
// per walker, and walk the same walkers in plain JavaScript, with the u32 generator's wrapping
// multiply and f32 rounding where the GPU has them.

const WALKERS = 128;
const params = { stride: 0.5, bias: 0.02 };

/** Where each walker ends, and how far that is from where it started. */
function walkAll() {
  const f = Math.fround;
  const out = [];
  for (let id = 0; id < WALKERS; id++) {
    let seed = (id + 1) >>> 0;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return f((seed >>> 8) / 16777216);
    };
    const draw = (scale) => f(f(next() - 0.5) * f(scale));
    let x = 0;
    let y = 0;
    for (let i = 0; i < 16; i++) {
      x = f(x + f(draw(params.stride) + f(params.bias)));
      y = f(y + f(draw(params.stride) * (i % 2)));
    }
    out.push(x, y, f(Math.sqrt(f(f(x * x) + f(y * y)))));
  }
  return out;
}

export default {
  title: 'A random walk from a class-based generator',
  runs: [
    {
      kind: 'compute',
      shader: 'random-walk.shade.ts',
      entry: 'walk',
      workgroups: [WALKERS / 64, 1, 1],
      bindings: {
        params: { gpu: new Float32Array([params.stride, params.bias, 0, 0]), cpu: params },
        out: { gpu: new Float32Array(WALKERS * 3), cpu: new Array(WALKERS * 3).fill(0) },
      },
      read: 'out',
      expected: walkAll,
      tolerance: 1e-5,
    },
  ],
};
