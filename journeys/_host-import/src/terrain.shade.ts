"use typeshade";

// A height field and its surface normal, called from host code (change 0009): `app.ts` imports
// this file and calls `height` and `normal` on the CPU tier, with no device and no buffer.

export const EPS: f32 = 0.001;

export function height(p: vec2, k: vec4): f32 {
  return k.x * sin(p.x * k.y) + k.z * cos(p.y * k.w);
}

export function normal(p: vec2, k: vec4): vec3 {
  const dx = height(p + vec2(EPS, 0.), k) - height(p - vec2(EPS, 0.), k);
  const dy = height(p + vec2(0., EPS), k) - height(p - vec2(0., EPS), k);
  return normalize(vec3(-dx, 2. * EPS, -dy));
}

@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  return vec4(normal(p.xy * 0.01, vec4(1., 0.5, 2., 0.25)) * 0.5 + 0.5, 1.);
}
