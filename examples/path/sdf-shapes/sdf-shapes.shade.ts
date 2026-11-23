"use typeshade";

// Step 4. A function returns the distance from a point to a shape: negative inside, positive outside.
interface Frame {
  size: vec2;
}

declare const frame: uniform<Frame>;

function circle(p: vec2, radius: f32): f32 {
  return length(p) - radius;
}

function box(p: vec2, half: vec2): f32 {
  return max(abs(p.x) - half.x, abs(p.y) - half.y);
}

function edge(distance: f32): f32 {
  return 1.0 - smoothstep(0.0, 0.01, distance);
}

@fragment
export function fs(p: builtin<"position">): vec4 {
  const uv = (2.0 * p.xy - frame.size) / frame.size.y;
  const disc = edge(circle(uv - vec2(-0.5, 0.0), 0.3));
  const panel = edge(box(uv - vec2(0.5, 0.0), vec2(0.3, 0.2)));
  return vec4(0.1 + 0.8 * disc, 0.1 + 0.4 * disc + 0.3 * panel, 0.15 + 0.8 * panel, 1.0);
}
