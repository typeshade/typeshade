"use typeshade";

/* @example
{
  "title": "Host: dispatch a compute entry",
  "blurb": "A `@compute` entry and the host that dispatches it. The host imports `scale` and calls `await scale({ k, xs, ys }, 4)`: the bindings are plain values, a number and two `Float32Array`s, and when the promise resolves `ys` holds what the GPU wrote (Rule 8.24). Where there is no WebGPU it runs on WebGL2 or on the CPU tier.",
  "renderable": false,
  "reason": "missing capabilities: storageBuffer, compute"
}
*/

declare const k: uniform<f32>;
declare const xs: storage<array<f32>>;
declare const ys: storage<array<f32>, "read_write">;

// One invocation for each element. The entry checks its own bound, as WGSL runs it: the host
// dispatches whole workgroups of 64.
@compute([64])
export function scale(@builtin("global_invocation_id") gid: vec3u) {
  if (gid.x >= xs.length) {
    return;
  }
  ys[gid.x] = xs[gid.x] * k;
}
