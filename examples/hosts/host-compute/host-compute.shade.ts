"use typeshade";

/* @example
{
  "title": "Host: dispatch a compute entry",
  "blurb": "A `@compute` entry and its host: `run()` uses the authored defaults, while `runSpecialized()` passes `{ constants }` to a direct call and to an entry inside `device.fuse()`. `WIDTH` selects the workgroup size and `GAIN` scales the output. The host calculates the group count from the selected width, keeps the plan's arrays resident, reads the result and returns the dispatch report (Rule 8.24). WebGPU and the CPU tier use 32 lanes; WebGL2 keeps the default 64 lanes and still selects `GAIN`.",
  "renderable": false,
  "reason": "missing capabilities: storageBuffer, compute"
}
*/

const WIDTH: override<u32> = 64;
const GAIN: override<f32> = 1.;

declare const k: uniform<f32>;
declare const xs: storage<array<f32>>;
declare const ys: storage<array<f32>, "read_write">;

// One invocation for each element. The entry checks its own bound, as WGSL runs it: the host
// dispatches whole workgroups of WIDTH, including a partly occupied last group.
@compute([WIDTH])
export function scale(@builtin("global_invocation_id") gid: vec3u) {
  if (gid.x >= xs.length) {
    return;
  }
  ys[gid.x] = xs[gid.x] * k * GAIN;
}
