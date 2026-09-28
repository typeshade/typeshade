"use typeshade";

// A subpath of the package, `shade-contour/bands`, through the `./*` pattern of its `exports`.

export function bands(x: f32, count: f32): f32 {
  return fract(x * count);
}
