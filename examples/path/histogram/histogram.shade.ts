"use typeshade";

/* @example
{
  "title": "Histogram",
  "blurb": "Step 15 of the learning path. Many invocations count into the same bin at once. `bins[bin] = bins[bin] + 1` would lose counts, because two invocations read the same old value. `atomicAdd` is one indivisible step, so no count is lost. The host reads eight counts, and each count is the height of one bar. Atomics need a storage buffer, so this step lists WebGPU and the CPU tier.",
  "renderable": false,
  "reason": "missing capabilities: storageBuffer, compute"
}
*/

// Step 15. A value from 0 to 1 lands in one of eight bins. The atomic add counts it without a lost update.
declare const values: storage<array<f32>>;
declare const bins: storage<array<atomic<u32>>, "read_write">;

@compute([64])
export function histogram(gid: builtin<"global_invocation_id">) {
  if (gid.x >= values.length) {
    return;
  }
  const bin = u32(clamp(values[gid.x], 0.0, 0.999) * 8.0);
  atomicAdd(bins[bin], 1);
}
