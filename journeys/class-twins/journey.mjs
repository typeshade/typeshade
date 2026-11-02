// The host half of the class-twins journey (change 0110), as its author would write it: a bank
// of filters stepped through a block in an entry and in a kernel function, and a bank of
// wavetable voices played in an entry, each computed again in plain JavaScript, with `f32`
// rounding where the shader has it. The classes of `units.shade.ts` are also the corpus of the
// class arm of the differential gate (`scripts/class-arm.ts`), which holds each member a host
// could call to one result on every tier and on the oracle.

const f = Math.fround;
const BLOCK = 16;

/** A deterministic generator, so a failure names a reproducible input. */
function generator(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

/** A multiple of 1/8 in [lo, hi]: exact in `f32`. */
const dyadic = (rnd, lo, hi) => Math.round((lo + rnd() * (hi - lo)) * 8) / 8;

// ─── the filters ─────────────────────────────────────────────────────────────────────────────

const FILTERS = 48;
const rnd = generator(110);
const filters = Array.from({ length: FILTERS }, () => ({
  z: 0,
  k: Math.round(1 + rnd() * 6) / 8,
  gain: dyadic(rnd, -2, 2),
}));
const xs = Array.from({ length: FILTERS * BLOCK }, () => dyadic(rnd, -2, 2));

/** `OnePole.tick` in JavaScript: the state moves the fraction `k` of the way to `x`. */
function tick(p, x) {
  p.z = f(p.z + f(p.k * f(x - p.z)));
  return p.z;
}

/** Every filter through its block, each sample scaled by the filter's gain when `gain` is set. */
function filtered(gain) {
  const bank = filters.map((p) => ({ ...p }));
  const out = [];
  bank.forEach((p, i) => {
    for (let n = 0; n < BLOCK; n++) {
      const z = tick(p, xs[i * BLOCK + n]);
      out.push(gain ? f(z * p.gain) : z);
    }
  });
  return out;
}

// ─── the voices ──────────────────────────────────────────────────────────────────────────────

const VOICES = 40;
const tableRnd = generator(37);
const table = Array.from({ length: 37 }, () => dyadic(tableRnd, -1, 1));
const voices = Array.from({ length: VOICES }, (_, v) => ({ at: (v * 5) % 50 }));

/** Each voice reads its block of the table from where it starts, wrapping at the table's end. */
function played() {
  return voices.flatMap((v) =>
    Array.from({ length: BLOCK }, (_, n) => table[(v.at + n) % table.length]),
  );
}

export default {
  title: 'A bank of audio units written as classes, stepped by an entry and a kernel function',
  runs: [
    {
      kind: 'compute',
      shader: 'units.shade.ts',
      entry: 'bank',
      workgroups: [1, 1, 1],
      bindings: {
        poles: filters.map((p) => ({ ...p })),
        input: xs,
        output: new Array(FILTERS * BLOCK).fill(0),
      },
      read: 'output',
      expected: () => filtered(true),
      tolerance: 1e-5,
    },
    {
      kind: 'compute',
      shader: 'units.shade.ts',
      entry: 'play',
      workgroups: [1, 1, 1],
      bindings: {
        table,
        voices: voices.map((v) => ({ ...v })),
        played: new Array(VOICES * BLOCK).fill(0),
      },
      read: 'played',
      expected: played,
      tolerance: 0,
    },
    {
      kind: 'kernel',
      shader: 'units.shade.ts',
      fn: 'run',
      // The kernel function's arguments, in its parameters' order.
      args: {
        out: new Array(FILTERS * BLOCK).fill(0),
        xs,
        filters: filters.map(({ z, k }) => ({ z, k })),
        block: BLOCK,
      },
      read: 'out',
      flatten: (out) => Array.from(out),
      expected: () => filtered(false),
      tolerance: 1e-5,
    },
  ],
};
