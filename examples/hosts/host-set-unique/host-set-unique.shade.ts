"use typeshade";

/* @example
{
  "title": "Host: collect into a Set and a Map",
  "blurb": "Four kernel functions that take JavaScript's own `Set` and `Map` (change 0080), and the host that calls them. `labels` adds each nonzero label once, `latest` keeps the last value set for each key, `lookup` reads the map where `has` guards `get`, and `present` adds in one loop and reads in the next. The host passes `new Set()` and `new Map()`, and when each promise resolves they hold the entries a sequential run leaves: each key once, in the order first added, the value set last. On WebGPU each add or set pushes a record the call applies in order, and a lookup is a binary search of the keys the call uploads; WebGL2 runs none.",
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

// One call adds in its first loop and reads in its second: each probe is 1 when an earlier pixel
// of the image holds its label, 0 otherwise.
export function present(pixels: array<u32>, seen: Set<u32>, probes: array<u32>, out: array<u32>) {
  for (let i: u32 = 0; i < pixels.length; i++) {
    seen.add(pixels[i]);
  }
  for (let i: u32 = 0; i < probes.length; i++) {
    out[i] = seen.has(probes[i]) ? 1 : 0;
  }
}

// A later call reads the map: a key it does not hold reads as -1.
export function lookup(keys: array<u32>, last: Map<u32, f32>, out: array<f32>) {
  for (let i: u32 = 0; i < keys.length; i++) {
    out[i] = last.has(keys[i]) ? last.get(keys[i])! : -1.;
  }
}
