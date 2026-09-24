"use typeshade";

// Three compute entries a host file calls through the import (change 0016): a map, a block sum
// through a scratch buffer and a barrier, and a report that logs. A barrier has no CPU tier, so
// `blockSum` answers only where WebGPU ran it; `report`'s console calls print from WebGPU in
// `vite dev`, and a production build records none.

declare const k: uniform<f32>;
declare const xs: storage<array<f32>>;
declare const ys: storage<array<f32>, "read_write">;
declare const sums: storage<array<f32>, "read_write">;
declare const scratch: storage<array<f32>, "read_write">;

@compute([64])
export function scale(@builtin("global_invocation_id") gid: vec3u) {
  if (gid.x >= xs.length) {
    return;
  }
  ys[gid.x] = xs[gid.x] * k;
}

@compute([64])
export function blockSum(
  @builtin("global_invocation_id") gid: vec3u,
  @builtin("local_invocation_id") lid: vec3u,
  @builtin("workgroup_id") wid: vec3u,
) {
  scratch[gid.x] = xs[gid.x];
  storageBarrier();
  if (lid.x === 0) {
    let s = 0.;
    for (let i = 0; i < 64; i++) {
      s += scratch[wid.x * 64 + u32(i)];
    }
    sums[wid.x] = s;
  }
}

@compute([4])
export function report(@builtin("global_invocation_id") gid: vec3u) {
  console.log("x", gid.x, xs[gid.x]);
}
