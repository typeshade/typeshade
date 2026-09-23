"use typeshade";

/* @example
{
  "title": "Atomic histogram",
  "blurb": "Many invocations count into one bin at once with `atomicAdd(bins[bin], 1)`, one indivisible step each; a storage struct field and a bare `storage<atomic<u32>>` binding show the other two shapes of location, and the value an atomic returns is what it held before. WGSL-only: GLSL ES 3.00 has no storage buffers and no atomics.",
  "renderable": false,
  "reason": "missing capabilities: storageBuffer, compute"
}
*/

// A histogram, the kernel atomics exist for (roadmap 0.2 item 4). Many invocations land in
// one bin at once, so `bins[bin] = bins[bin] + 1` would lose counts; `atomicAdd(bins[bin], 1)`
// is one indivisible step per invocation, and the value it returns is what the location held
// before. `atomic<u32>` is a LOCATION in storage memory: this surface writes it as the plain
// expression and the WGSL writer spells the pointer, `atomicAdd(&bins[bin], 1u)`. A plain read
// or assignment of `bins[bin]` is refused with the builtin to use instead.
//
// Three shapes of location, so the compile gate sees each on Tint: an array element, a field
// of a storage struct, and a bare atomic binding. GLSL ES 3.00 has no storage buffers and no
// atomics, so like `array-length` this module is WGSL-only. The CPU oracle runs invocations
// one after another, so its atomics are plain reads and writes in that order.

class Summary {
  count: atomic<u32>;
  maxBin: atomic<i32>;
}

declare const src: storage<array<f32>>;
declare let bins: storage<array<atomic<u32>>>;
declare let summary: storage<Summary>;
declare let firstValue: storage<atomic<u32>>;

const BINS: f32 = 8.;

@compute([64, 1, 1])
export function histogram(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= arrayLength(src)) {
    return;
  }
  // A value in [0, 1) lands in one of eight bins; anything else is clamped to the edges.
  const bin = u32(clamp(src[gid.x], 0., 0.999) * BINS);
  atomicAdd(bins[bin], 1);
  // The count before this invocation's own: 0 exactly once, for whichever invocation gets
  // there first. That one records the bits of its value.
  const before = atomicAdd(summary.count, 1);
  if (before === 0) {
    atomicStore(firstValue, u32(src[gid.x] * 1000.));
  }
  atomicMax(summary.maxBin, i32(bin));
}
