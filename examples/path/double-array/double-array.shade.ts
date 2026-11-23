"use typeshade";

/* @example
{
  "title": "Double an array",
  "blurb": "Step 12 of the learning path. The first compute kernel. A `@compute` entry runs once for each invocation, and `global_invocation_id` says which one. The storage binding `numbers` is the array the host passes by name. The host calls `doubled({ numbers }, workgroups)`, waits, and reads the doubled numbers from the array it passed.",
  "renderable": false,
  "reason": "missing capabilities: storageBuffer, compute"
}
*/

// Step 12. One invocation doubles one number. The entry checks its own bound, because the host dispatches whole workgroups.
declare const numbers: storage<array<f32>, "read_write">;

@compute([64])
export function doubled(gid: builtin<"global_invocation_id">) {
  if (gid.x >= numbers.length) {
    return;
  }
  numbers[gid.x] = numbers[gid.x] * 2.0;
}
