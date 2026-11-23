"use typeshade";

// Step 12. One invocation doubles one number. The entry checks its own bound, because the host dispatches whole workgroups.
declare const numbers: storage<array<f32>, "read_write">;

@compute([64])
export function doubled(gid: builtin<"global_invocation_id">) {
  if (gid.x >= numbers.length) {
    return;
  }
  numbers[gid.x] = numbers[gid.x] * 2.0;
}
