// The host half of the light-list journey, as its author would write it: pack each light the way
// WGSL lays out the struct (a vec2 and two f32, 16 bytes), hand the kernel three floats per
// point of a 16x16 grid, and light the same grid in plain JavaScript, with f32 rounding where
// the GPU has it.

const POINTS = 256;
// No point of the grid lies within 0.0027 of a light's radius or of twice it, so f32 rounding
// cannot move a point across one.
const lights = [
  { pos: [-0.43, -0.29], radius: 0.27, power: 1.5 },
  { pos: [0.52, 0.17], radius: 0.27, power: 0.8 },
  { pos: [0.07, 0.61], radius: 0.31, power: 1.1 },
];

const f = Math.fround;
const distance = (a, b) => f(Math.hypot(f(a[0] - b[0]), f(a[1] - b[1])));

/** What reaches `q` from every light, summed in the order the kernel sums it. */
function glowAt(q) {
  let sum = 0;
  for (const l of lights) {
    const dx = f(l.pos[0] - q[0]);
    const dy = f(l.pos[1] - q[1]);
    sum = f(sum + f(l.power / f(1 + f(16 * f(f(dx * dx) + f(dy * dy))))));
  }
  return sum;
}

/** Each point's averaged light, whether a light covers it, and whether it is clear of them all. */
function lightAll() {
  const out = [];
  for (let id = 0; id < POINTS; id++) {
    const p = [f(f((id % 16) / 8) - 1), f(f(Math.floor(id / 16) / 8) - 1)];
    const offsets = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
    let total = 0;
    for (const o of offsets) total = f(total + glowAt([f(p[0] + o[0] / 32), f(p[1] + o[1] / 32)]));
    out.push(
      f(total / 4),
      lights.some((l) => distance(l.pos, p) < l.radius) ? 1 : 0,
      lights.every((l) => distance(l.pos, p) > 2 * l.radius) ? 1 : 0,
    );
  }
  return out;
}

export default {
  title: "A grid lit from a list of lights, with an array's methods",
  runs: [
    {
      kind: 'compute',
      shader: 'lights.shade.ts',
      entry: 'shade',
      workgroups: [POINTS / 64, 1, 1],
      bindings: {
        lights: {
          gpu: new Float32Array(lights.flatMap((l) => [...l.pos, l.radius, l.power])),
          cpu: lights,
        },
        out: { gpu: new Float32Array(POINTS * 3), cpu: new Array(POINTS * 3).fill(0) },
      },
      read: 'out',
      expected: lightAll,
      tolerance: 1e-5,
    },
  ],
};
