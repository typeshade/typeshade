"use typeshade";

// The distance from a height to the nearest contour line, the lines `step` apart. `wrap` is the
// package's own: a file that imports the package cannot name it.

function wrap(x: f32): f32 {
  return x - floor(x);
}

export function contour(h: f32, step: f32): f32 {
  const t = wrap(h / step);
  return min(t, 1. - t) * step;
}
