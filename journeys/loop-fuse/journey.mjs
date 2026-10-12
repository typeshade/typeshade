// The loop-fuse journey (change 0058): `add`, `mul` and `relu`, three kernel functions, called
// over `Resident` arrays inside one `fuse` scope (`host.mjs`). On WebGPU the three dispatches
// reach the queue in one submission, which the harness checks against the device itself; on
// WebGL2 each loop draws, and on the CPU tier nothing is dispatched. The result is held to the
// plain-JavaScript reference below on every tier.
//
// The inputs are small dyadic numbers, so every step is exact in `f32` and the tolerance is 0.

const N = 1000;
const a = Array.from({ length: N }, (_, i) => (i % 7) - 3);
const b = Array.from({ length: N }, (_, i) => ((i % 5) - 2) * 0.5);
const c = Array.from({ length: N }, (_, i) => ((i % 3) - 1) * 0.25);

export default {
  title: 'A chain of three kernel calls in one fuse scope',
  runs: [
    {
      kind: 'fuse',
      host: 'host.mjs',
      inputs: { a, b, c },
      // relu((a + b) * c)
      expected: () => a.map((x, i) => Math.max((x + b[i]) * c[i], 0)),
      tolerance: 0,
      // The calls the report names, in the order the host made them.
      calls: ['add', 'mul', 'relu'],
      // On WebGPU: one dispatch for each call, in one submission, and the host's one `read()` is a
      // submission of its own that the device sees and the report does not count.
      dispatches: 3,
      submissions: 1,
      reads: 1,
    },
  ],
};
