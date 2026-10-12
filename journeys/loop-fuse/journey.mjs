// The loop-fuse journey (change 0058): `add`, `mul` and `relu`, three kernel functions, called
// over `Resident` arrays inside one `fuse` scope (`host.mjs`), the two intermediates scratch
// arrays of the scope. On WebGPU the three calls are one dispatch in one submission, and the
// scratch arrays are locals of its entry, so no buffer is made for them: the harness checks both
// against the device itself. On WebGL2 each loop draws, and on the CPU tier nothing is
// dispatched. The result is held to the plain-JavaScript reference below on every tier. A second
// run (`stencil.mjs`) puts a call between that reads an element another invocation writes: the
// plan makes two dispatches, one for each side of it, says in the author's words why it did not
// make one, and keeps the one scratch array both sides use as a buffer.
//
// The inputs are small dyadic numbers, so every step is exact in `f32` and the tolerance is 0.

import { readFileSync } from 'node:fs';

const N = 1000;
/** The byte size of one array: the buffers of this size are the arrays the device was asked for. */
const BYTES = N * 4;
const a = Array.from({ length: N }, (_, i) => (i % 7) - 3);
const b = Array.from({ length: N }, (_, i) => ((i % 5) - 2) * 0.5);
const c = Array.from({ length: N }, (_, i) => ((i % 3) - 1) * 0.25);

/** The line of `ops.shade.ts` that `pairsum` reads `t[i ^ 1]` on, which the report names. */
const line =
  readFileSync(new URL('./ops.shade.ts', import.meta.url), 'utf8')
    .split('\n')
    .findIndex((l) => l.includes('out[i] = t[i] + t[i ^ 1];')) + 1;

export default {
  title: 'Kernel calls in one fuse scope',
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
      arrayBytes: BYTES,
      // On WebGPU the three calls are one group, one dispatch, and the host's one `read()` is a
      // submission of its own that the device sees and the report does not count. `t` and `u` are
      // locals of the entry: the buffers of an array's size are the host's four residents (`a`,
      // `b`, `c` and `out`) and the staging buffer of its one `read()`, and none is a scratch array's.
      webgpu: { groups: [['add', 'mul', 'relu']], dispatches: 1, submissions: 1, buffers: 5 },
      // On WebGL2 each loop is a draw.
      webgl2: { dispatches: 3 },
      reads: 1,
    },
    {
      kind: 'fuse',
      host: 'stencil.mjs',
      inputs: { a, b, c },
      // relu((u[i] + u[i ^ 1])) with u = (a + b) * c
      expected: () => {
        const u = a.map((x, i) => (x + b[i]) * c[i]);
        return u.map((x, i) => Math.max(x + u[i ^ 1], 0));
      },
      tolerance: 0,
      calls: ['add', 'mul', 'pairsum', 'relu'],
      arrayBytes: BYTES,
      // `add` and `mul` are one dispatch. `pairsum` reads what `mul` wrote at another index, so it
      // starts a group, and `relu` joins it. `t` is private to the first group and `v` to the
      // second: locals. `u` is written by the first and read by the second, so it stays a buffer,
      // a zeroed one the plan makes and frees: the four residents, `u`, and the staging buffer.
      webgpu: {
        groups: [
          ['add', 'mul'],
          ['pairsum', 'relu'],
        ],
        why: [
          undefined,
          `mul and pairsum run as two dispatches because pairsum reads \`t[i ^ 1]\` (line ${line})`,
        ],
        dispatches: 2,
        submissions: 1,
        buffers: 6,
      },
      webgl2: { dispatches: 4 },
      reads: 1,
    },
  ],
};
