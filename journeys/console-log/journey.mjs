// The host half of the console journey: 100 values, a kernel that doubles them, and the lines
// it logs on the way, computed here in plain JavaScript with f32 rounding where the GPU has it.
// The harness loads the kernel's recorded variant on `typeshade/runtime`, which binds the console
// buffer and hands its sink the decoded lines, and holds them equal to these and to the CPU run's.

const N = 100;
const f = Math.fround;
const xs = Array.from({ length: N }, (_, i) => f(i * 0.137));

export default {
  title: 'console.log from a compute kernel, read back from WebGPU',
  runs: [
    {
      kind: 'compute',
      shader: 'scale.shade.ts',
      entry: 'main',
      workgroups: [2, 1, 1],
      bindings: {
        xs: xs,
        out: new Array(128).fill(0),
      },
      read: 'out',
      expected: () => xs.map((x) => f(x * 2)),
      tolerance: 0,
      console: {
        capacity: 4096,
        expected: () =>
          xs.flatMap((x, i) => {
            const lines = [
              {
                method: 'log',
                args: ['i =', i, { value: x, scaled: [x, f(x * 0.5)] }, x > 1],
                invocation: [i, 0, 0],
              },
            ];
            const s = f(x * 2);
            if (s > 10)
              lines.push({ method: 'warn', args: ['large value', s], invocation: [i, 0, 0] });
            return lines;
          }),
      },
    },
  ],
};
