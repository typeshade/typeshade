"use typeshade";

// Step 2. The position builtin and the canvas size give each pixel a coordinate from 0 to 1.
interface Frame {
  size: vec2;
}

declare const frame: uniform<Frame>;

@fragment
export function fs(p: builtin<"position">): vec4 {
  const uv = p.xy / frame.size;
  return vec4(uv.x, uv.y, 0.5, 1.0);
}
