"use typeshade";

/* @example
{
  "title": "String keys and Record",
  "blurb": "A closed set of channel names becomes u32 ids, and a Record becomes an array in id order (change 0081). A key-type parameter selects the gain in a kernel function called by the host. The fragment entry chooses a channel from the pixel position and reads the same table. The host passes a channel string to the kernel and an object to the helper, with identical values on WebGPU, WebGL2 and the CPU tier.",
  "renderable": true
}
*/

type Channel = "r" | "g" | "b";
const GAIN: Record<Channel, f32> = { r: 1.5, g: 1.0, b: 0.5 };

export function gain(c: Channel, x: f32, by: Record<Channel, f32>): f32 {
  switch (c) {
    case "r":
      return x * GAIN[c] * by[c];
    case "g":
      return x * GAIN[c] * by[c];
    default:
      return x * GAIN[c] * by[c];
  }
}

export function boost(pixels: array<f32>, c: Channel, scale: f32) {
  for (let i: u32 = 0; i < pixels.length; i++) {
    const by: Record<Channel, f32> = { r: scale, g: scale, b: scale };
    pixels[i] = gain(c, pixels[i], by);
  }
}

class Clip {
  @builtin("position") pos: vec4;
}

class Color {
  @location(0) color: vec4;
}

@vertex
export function vs(@builtin("vertex_index") i: u32): Clip {
  let p = vec2(-1., -1.);
  if (i === 1) { p = vec2(3., -1.); }
  if (i === 2) { p = vec2(-1., 3.); }
  return { pos: vec4(p, 0., 1.) };
}

@fragment
export function fs(@builtin("position") p: vec4): Color {
  const c: Channel = p.x < 16. ? "r" : p.x < 32. ? "g" : "b";
  const by: Record<Channel, f32> = { b: 0.5, r: 0.5, g: 0.5 };
  return { color: vec4(gain(c, 1., by), 0.25, 0.5, 1.) };
}
