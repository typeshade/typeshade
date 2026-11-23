"use typeshade";

// Step 7. A module constant holds an array of colours, and an index picks an element of it.
interface Frame {
  size: vec2;
}

declare const frame: uniform<Frame>;

const PALETTE: array<vec3, 4> = [
  vec3(0.1, 0.1, 0.35),
  vec3(0.8, 0.2, 0.4),
  vec3(0.98, 0.65, 0.2),
  vec3(1.0, 0.95, 0.7),
];

function ramp(t: f32): vec3 {
  const scaled = clamp(t, 0.0, 0.999) * 3.0;
  const i = i32(scaled);
  return mix(PALETTE[i], PALETTE[i + 1], fract(scaled));
}

@fragment
export function fs(p: builtin<"position">): vec4 {
  const uv = p.xy / frame.size;
  const wavy = uv.x + 0.1 * sin(10.0 * uv.y);
  return vec4(ramp(wavy), 1.0);
}
