"use typeshade";

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
    out[i] = last.has(keys[i]) ? last.get(keys[i])! : -1;
  }
}
