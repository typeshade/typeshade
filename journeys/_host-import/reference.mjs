// What `app.ts` should print, computed in plain JavaScript without TypeShade: the same height
// field and its central-difference normal. The shader runs in f32 and this in f64, so the
// journey compares within a tolerance.
const k = [1, 0.5, 2, 0.25];
const EPS = Math.fround(0.001);
const height = ([x, y]) => k[0] * Math.sin(x * k[1]) + k[2] * Math.cos(y * k[3]);
const normal = ([x, y]) => {
  const dx = height([x + EPS, y]) - height([x - EPS, y]);
  const dy = height([x, y + EPS]) - height([x, y - EPS]);
  const v = [-dx, 2 * EPS, -dy];
  const n = Math.hypot(...v);
  return v.map((c) => c / n);
};
const points = [
  [0, 0],
  [0.5, 0.5],
  [1.25, -3.5],
  [10, 7.75],
];
export default {
  eps: EPS,
  heights: points.map(height),
  normals: points.map(normal),
};

/** What `src/gpu.ts` should return: the same map and block sums, in f32 as the GPU computes. */
export function gpuReference() {
  const f = Math.fround;
  const xs = Array.from({ length: 256 }, (_, i) => f(Math.sin(i * 0.37) * 4));
  const ys = xs.map((x) => f(x * f(2.5)));
  const sums = [0, 1, 2, 3].map((w) => {
    let s = 0;
    for (let i = 0; i < 64; i++) s = f(s + xs[w * 64 + i]);
    return s;
  });
  return { ys, sums };
}
