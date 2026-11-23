"use typeshade";

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
