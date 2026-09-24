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
