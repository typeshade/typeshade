"use typeshade";

/* @example
{
  "title": "A kernel that collects unique labels in a Set",
  "blurb": "`labels` adds each nonzero pixel's label to a `Set<u32>` with `seen.add(...)` (change 0080), and `latest` keeps the last value set for each key in a `Map<u32, f32>`. The host passes JavaScript's own `Set` and `Map` by reference, and reads back the entries a sequential run leaves: each key once, in the order first added, the value set last. `lookup` reads the map in a later loop, where `last.has(k)` guards `last.get(k)!`. In this version the functions run on the CPU tier.",
  "renderable": false,
  "reason": "no entry point"
}
*/

// The host passes its own Set: `const seen = new Set<number>(); const n = await labels(px, seen)`,
// and `seen` holds each label once, in the order first seen.

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

// A later loop reads the map: a key it does not hold reads as -1.
export function lookup(keys: array<u32>, last: Map<u32, f32>, out: array<f32>) {
  for (let i: u32 = 0; i < keys.length; i++) {
    out[i] = last.has(keys[i]) ? last.get(keys[i])! : -1.;
  }
}
