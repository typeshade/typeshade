"use typeshade";

/* @example
{
  "title": "Mandelbrot set",
  "blurb": "Step 6 of the learning path. Each pixel is a point `c` of the plane. A loop squares a complex number again and again, and `break` leaves it as soon as the number is far from the origin. The count of rounds the pixel lasted gives its colour.",
  "renderable": false,
  "reason": "no entry point"
}
*/

// Step 6. A loop with an early exit: break leaves the loop as soon as the point has escaped.
interface Frame {
  size: vec2;
}

declare const frame: uniform<Frame>;

function rounds(c: vec2): f32 {
  let z = vec2(0.0, 0.0);
  let count = 0.0;
  for (let i = 0; i < 32; i++) {
    if (length(z) > 2.0) {
      break;
    }
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    count += 1.0;
  }
  return count / 32.0;
}

@fragment
export function fs(p: builtin<"position">): vec4 {
  const uv = (2.0 * p.xy - frame.size) / frame.size.y;
  const t = rounds(1.3 * uv - vec2(0.6, 0.0));
  return vec4(t, sqrt(t) * 0.8, 1.0 - t, 1.0);
}
