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
  ridges: points.map((p) => 1 - Math.abs(height(p))),
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

/** What `draws()` in `src/gpu.ts` should read back, RGBA, top row first: the plasma at each
 *  pixel's centre, and the 8x8 image repeated. The GPU runs in f32 and writes 8 bits a channel,
 *  so the journey compares the plasma within two steps of 1/255. */
export function drawReference(size = 32) {
  const time = 1.25;
  const scale = 0.09;
  const plasma = [];
  const tiled = [];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * scale;
      const w = (y + 0.5) * scale;
      let v = 0;
      for (let i = 0; i < 4; i++) {
        const k = i + 1;
        v += (Math.sin(u * k + time) * Math.cos(w * k - time)) / k;
      }
      const c = v * 0.5 + 0.5;
      // A colour channel is written to 8 bits, clamped to [0, 1] first.
      plasma.push(...[c, c * c, 1 - c, 1].map((x) => Math.min(1, Math.max(0, x)) * 255));
      const i = x % 8;
      const j = y % 8;
      tiled.push(i * 32, j * 32, (i + j) * 16, 255);
    }
  return { plasma, tiled };
}

/** What `loops()` in `src/gpu.ts` should read back, in f32 as the GPU computes it. */
export function loopReference() {
  const f = Math.fround;
  const k = [1, 0.5, 2, 0.25];
  const render = [];
  for (let i = 0; i < 64 * 64; i++) {
    const p = [f(f(i % 64) / 64), f(f(Math.floor(i / 64)) / 64)];
    render.push(f(k[0] * Math.sin(p[0] * k[1]) + k[2] * Math.cos(p[1] * k[3])));
  }
  const drift = [];
  for (let i = 0; i < 100; i++) {
    const vel = [1, f(-9.8 * 0.25), -1, 0];
    drift.push(f(i + vel[0] * 0.25), f(10 + vel[1] * 0.25), f(vel[2] * 0.25), 1, ...vel);
  }
  const odds = new Array(30).fill(0);
  for (let i = 9; i >= 0; i--) if (i % 2 === 1) odds.splice(i * 3, 3, 1, 2, i);
  // The tree order (Rule 7.2): each iteration from the identity, blocks of 256 folded at
  // stride 128 down to 1, the last block padded with the identity, then the partials the same
  // way until one is left; the variable is combined with that last.
  const tree = (values, op, id) => {
    const level = (vs) => {
      const out = [];
      for (let b = 0; b < vs.length; b += 256) {
        const w = Array.from({ length: 256 }, (_, t) => (b + t < vs.length ? vs[b + t] : id));
        for (let s = 128; s > 0; s >>= 1) for (let t = 0; t < s; t++) w[t] = op(w[t], w[t + s]);
        out.push(w[0]);
      }
      return out;
    };
    let l = level(values);
    while (l.length > 1) l = level(l);
    return l[0];
  };
  const xs = Array.from({ length: 300000 }, (_, i) => f(Math.sin(i) * 1000.123));
  const sum = f(
    0 +
      tree(
        xs.map((x) => f(-0 + x)),
        (a, b) => f(a + b),
        -0,
      ),
  );
  const top = Math.max(-1e30, tree(xs, Math.max, -3.4028234663852886e38));
  const stats = [sum, f(top), f(sum / xs.length)];
  const scaled = xs.slice(0, 256).map((x) => f(x * 0.5));
  let tally = 0;
  for (let i = 0; i < 70000; i++) tally += (i % 7) - 3;
  // The histogram, in f32: each iteration's bin, counted.
  const histogram = new Array(64).fill(0);
  const lo = f(-1000.123);
  const scale = f(64 / 2000.246);
  for (const x of xs) histogram[Math.min(Math.trunc(Math.max(f(f(x - lo) * scale), 0)), 63)]++;
  return {
    render,
    drift,
    odds,
    stats,
    scaled,
    tally: [tally],
    histogram,
    residentRender: render,
    residentStats: stats,
    residentScaled: scaled,
    glRender: render,
    glSkip: Array.from({ length: 512 }, (_, i) => {
      const x = f(Math.sin(i) * 10);
      return x < 0 ? -1 : f(x * 0.5);
    }),
  };
}
