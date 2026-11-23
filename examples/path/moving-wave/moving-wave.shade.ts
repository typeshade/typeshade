"use typeshade";

/* @example
{
  "title": "Moving wave",
  "blurb": "Step 3 of the learning path. The uniform of step 2 gains one field, `time`, and the colour depends on it. `run(canvas, time)` draws one frame. `animate(canvas)` calls `run` once a frame, so the Playground shows the wave move.",
  "renderable": false,
  "reason": "no entry point"
}
*/

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
