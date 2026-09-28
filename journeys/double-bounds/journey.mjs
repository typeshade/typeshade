// The host half of the double-bounds journey, as its author would write it. On the GPU a vec3f64
// is two vec3<f32> planes, the high word of each component and then the low word, 32 bytes in
// all. The host passes plain doubles: the runtime splits each into its two words and lays them
// out (Rule 8.21), and the journey tests the same points against the same box in plain
// JavaScript, whose numbers are doubles.

// Near 1e7 the f32 grid is 1 wide, so an f32 reads both corners' x as 1e7 and 1e7 + 1 and every
// point below as inside in x; y is the same near -1e7. Only the double sees the margins.
const box = {
  lo: [1e7 + 0.25, -1e7 + 0.25, 0.25],
  hi: [1e7 + 0.75, -1e7 + 0.75, 0.75],
};

// A grid across the box's faces: eighth-unit steps in x, quarter-unit steps in y and z.
const points = [];
for (let z = 0; z <= 4; z++)
  for (let y = 0; y <= 4; y++)
    for (let x = 0; x <= 8; x++) points.push([1e7 + x / 8, -1e7 + y / 4, z / 4]);

/** 1 for a point inside the box, faces included, and 0 for one outside. */
const insideAll = () =>
  points.map((p) => (p.every((c, k) => box.lo[k] <= c && c <= box.hi[k]) ? 1 : 0));

export default {
  title: 'Points inside a box, in double precision',
  runs: [
    {
      kind: 'compute',
      shader: 'bounds.shade.ts',
      entry: 'test',
      workgroups: [Math.ceil(points.length / 64), 1, 1],
      bindings: {
        box: box,
        points: points,
        inside: new Array(points.length).fill(0),
      },
      read: 'inside',
      expected: insideAll,
      tolerance: 0,
    },
  ],
};
