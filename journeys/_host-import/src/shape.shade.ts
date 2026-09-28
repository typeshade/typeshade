"use typeshade";

// A shader library `terrain.shade.ts` imports (change 0022): no host file imports it, and its
// function reaches host code through `ridged`, which the file that imports it exports.

export function ridge(h: f32): f32 {
  return 1. - abs(h);
}
