"use typeshade";

// Step 3. The same uniform as step 2, with one more field: the time in seconds.
interface Frame {
  size: vec2;
  time: f32;
}

declare const frame: uniform<Frame>;

@fragment
export function fs(p: builtin<"position">): vec4 {
  const uv = p.xy / frame.size;
  const wave = 0.5 + 0.5 * sin(12.0 * uv.x + 3.0 * frame.time);
  return vec4(uv.y, 0.5 * wave, wave, 1.0);
}
