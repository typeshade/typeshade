// The host half of the declared-names journey: hand the kernel a buffer of four floats per
// invocation and compute the same four in plain JavaScript, each as the file's own function or the
// builtin its call reaches.

const N = 64;

/** What each invocation writes, in f32. */
function expected() {
  const f = Math.fround;
  const out = [];
  for (let id = 0; id < N; id++) {
    const x = f(f(id) * f(0.25));
    out.push(
      // The author's `fract`, not the builtin's fractional part.
      f(x + 100),
      // The author's one-operand `pow`, and the builtin the `Math.pow` reaches.
      f(f(x * x) + f(Math.pow(x, 3))),
      // The author's `mix`, a midpoint.
      f(f(x + 1) * 0.5),
      // `random(x)`, the builtin `fract` of a hash: below 1.
      1,
    );
  }
  return out;
}

export default {
  title:
    'Helpers named like builtins: the calls an author writes reach them, the calls the compiler writes reach the builtins',
  runs: [
    {
      kind: 'compute',
      shader: 'declared.shade.ts',
      entry: 'main',
      workgroups: [1, 1, 1],
      bindings: { out: new Array(N * 4).fill(0) },
      read: 'out',
      expected,
      tolerance: 1e-4,
    },
  ],
};
