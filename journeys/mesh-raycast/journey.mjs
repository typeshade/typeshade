// The host half of the ray-cast journey: a random mesh of 700 triangles and 300 rays from the
// origin, packed as WGSL lays them out (a vec4 per vertex, two vec4 per ray), and the same test
// in plain JavaScript (Möller–Trumbore) for the reference.

const TRIS = 700;
const RAYS = 300;
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;

const verts = [];
for (let t = 0; t < TRIS; t++) {
  const cx = rnd() * 20 - 10;
  const cy = rnd() * 20 - 10;
  const cz = rnd() * 20 + 5;
  for (let k = 0; k < 3; k++) {
    verts.push([cx + rnd() * 2 - 1, cy + rnd() * 2 - 1, cz + rnd() * 2 - 1, 1]);
  }
}
const rays = [];
for (let i = 0; i < RAYS; i++) {
  const dx = rnd() * 1.2 - 0.6;
  const dy = rnd() * 1.2 - 0.6;
  const l = Math.hypot(dx, dy, 1);
  rays.push({ origin: [0, 0, 0, 1], dir: [dx / l, dy / l, 1 / l, 0] });
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function intersect(o, d, a, b, c) {
  const e1 = sub(b, a);
  const e2 = sub(c, a);
  const p = cross(d, e2);
  const det = dot(e1, p);
  if (Math.abs(det) < 1e-6) return -1;
  const inv = 1 / det;
  const s = sub(o, a);
  const u = dot(s, p) * inv;
  if (u < 0 || u > 1) return -1;
  const q = cross(s, e1);
  const v = dot(d, q) * inv;
  if (v < 0 || u + v > 1) return -1;
  return dot(e2, q) * inv;
}
function nearestHits() {
  return rays.map((r) => {
    let n = 1e30;
    for (let t = 0; t < TRIS; t++) {
      const d = intersect(r.origin, r.dir, verts[t * 3], verts[t * 3 + 1], verts[t * 3 + 2]);
      if (d > 0 && d < n) n = d;
    }
    return n < 1e30 ? n : -1;
  });
}

export default {
  title: 'A ray cast over a mesh the host sizes',
  runs: [
    {
      kind: 'compute',
      shader: 'raycast.shade.ts',
      entry: 'trace',
      workgroups: [Math.ceil(RAYS / 64), 1, 1],
      bindings: {
        verts: { gpu: new Float32Array(verts.flat()), cpu: verts },
        rays: { gpu: new Float32Array(rays.flatMap((r) => [...r.origin, ...r.dir])), cpu: rays },
        hits: { gpu: new Float32Array(RAYS), cpu: new Array(RAYS).fill(0) },
      },
      read: 'hits',
      expected: nearestHits,
      tolerance: 1e-4,
    },
  ],
};
