"use typeshade";

// Step 1. A fragment entry returns one colour for every pixel.
@fragment
export function fs(): vec4 {
  return vec4(0.2, 0.6, 1.0, 1.0);
}
