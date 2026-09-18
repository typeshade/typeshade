"use typeshade"

// The workgroup reduction (roadmap 0.2 item 5, #82, §25): 64 invocations sum 64 values into
// one, sharing partial sums through workgroup memory and ordering the rounds with
// `workgroupBarrier()`. Each round halves the live half of the tile; the barrier after it is
// what lets an invocation read the slot another one wrote. The loop steps by `/= 2`, the
// counted-loop shape §17 accepts, so its bound is constant and the barrier inside it stands in
// uniform control flow, as WGSL requires.
//
// On the CPU this needs `dispatch(entry, workgroups)`: the oracle runs one invocation per call
// otherwise, and a barrier has no one to wait for there. `dispatch` runs each workgroup's
// invocations in lockstep at every barrier, and refuses a workgroup whose invocations do not
// all reach it. WGSL-only: WebGL2 has no compute stage.

declare const src: storage<array<f32>>
declare let sums: storage<array<f32>>

let tile: workgroup<array<f32, 64>>

@compute([64, 1, 1])
export function reduce(
  @builtin("global_invocation_id") gid: vec3u,
  @builtin("local_invocation_id") lid: vec3u,
  @builtin("workgroup_id") wid: vec3u,
): void {
  tile[lid.x] = src[gid.x]
  workgroupBarrier()
  for (let stride: u32 = 32; stride > 0; stride /= 2) {
    if (lid.x < stride) {
      tile[lid.x] = tile[lid.x] + tile[lid.x + stride]
    }
    workgroupBarrier()
  }
  if (lid.x === 0) {
    sums[wid.x] = tile[0]
  }
}
