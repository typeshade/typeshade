"use typeshade";

// A shader module that imports from a package npm installed, by the package's name (change
// 0024): `contour` through the package's `typeshade` condition, `bands` through its `./*`
// pattern, and `height` from a file of this project by a relative path.

import { contour } from "shade-contour";
import { bands } from "shade-contour/bands";
import { height } from "./terrain.shade.ts";

export function relief(p: vec2, k: vec4): f32 {
  return contour(height(p, k), 0.5) + bands(p.x, 0.37) * 0.25;
}
