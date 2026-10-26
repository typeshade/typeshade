// Optional values (change 0088): a result that may be absent, its test, its fallback, a callback
// that returns one, an inferred `T | undefined`, `?.` on an optional struct and a narrowed local,
// held to a plain-JavaScript reference on WebGPU and on the CPU oracle.
const xs = Array.from({ length: 64 }, (_, i) => i * 0.25 - 2);

const root = (x) => (x < 0 ? undefined : Math.sqrt(x));
const halfOf = (x) => (x <= 0 ? undefined : x * 0.5);
const sampleOr = (f, x, fallback) => {
  const v = f(x);
  return v === undefined ? fallback : v;
};
const plain = (x) => x + 100;
const hitOf = (x) => (x < 1 ? undefined : { t: x - 1, side: x >= 4 ? 1 : -1 });
const nearest = (a, b) => {
  if (a !== undefined && b !== undefined) return Math.min(a, b);
  return a ?? b ?? -1;
};

const reference = (x) => {
  const bonus = x > 2 ? 10 : undefined;
  const h = hitOf(x);
  const r = root(x) ?? -100;
  const s = sampleOr(root, x - 1, 0.5) + sampleOr(plain, x, 0);
  const n = nearest(halfOf(x), root(x - 3));
  const side = h?.side ?? 0;
  const t = h?.t ?? 1000;
  return r + s + n + side * 0.125 + t * 0.001 + (bonus ?? 0) + (h === undefined ? 0.5 : 0);
};

export default {
  title: 'Optional values carry whether the value is there',
  runs: [
    {
      kind: 'compute',
      shader: 'optional.shade.ts',
      entry: 'main',
      workgroups: [1, 1, 1],
      bindings: {
        xs,
        out: new Array(64).fill(0),
      },
      read: 'out',
      expected: () => xs.map(reference),
      tolerance: 1e-5,
    },
  ],
};
