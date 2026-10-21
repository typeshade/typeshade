"use typeshade";

/* @example
{
  "title": "Host: collect into a Set and a Map",
  "blurb": "Two kernel functions that take JavaScript's own `Set` and `Map` (change 0080), and the host that calls them. `labels` adds each nonzero label once, and `latest` keeps the last value set for each key. The host passes `new Set()` and `new Map()`, and when each promise resolves they hold the entries a sequential run leaves: each key once, in the order first added, the value set last. In this version the two run on the CPU tier.",
  "renderable": false,
  "reason": "no entry point"
}
*/

// Each nonzero label once, in the order first seen. The function returns how many there are.
export function labels(pixels: array<u32>, seen: Set<u32>): u32 {
  for (let i: u32 = 0; i < pixels.length; i++) {
    if (pixels[i] !== 0) {
      seen.add(pixels[i]);
    }
  }
  return seen.size;
}

// The last value set for each key, in the place of the key's first set.
export function latest(keys: array<u32>, values: array<f32>, last: Map<u32, f32>) {
  for (let i: u32 = 0; i < keys.length; i++) {
    last.set(keys[i], values[i]);
  }
}
