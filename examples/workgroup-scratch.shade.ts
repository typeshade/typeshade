"use typeshade";

/* @example
{
  "title": "Workgroup scratch memory",
  "blurb": "`let tile: workgroup<array<f32, 64>>` is WGSL's `var<workgroup>`, one copy per workgroup its invocations share, here as scratch each invocation owns a slot of, beside a workgroup array of atomics and a per-invocation counter (§24). WGSL-only: WebGL2 has no compute stage and no workgroup memory.",
  "renderable": false,
  "reason": "missing capabilities: storageBuffer, compute"
}
*/

// Workgroup memory (roadmap 0.2 item 5, §24): `let tile: workgroup<array<f32, 64>>` is WGSL's
// `var<workgroup>`, one copy per workgroup that its 64 invocations share, zero when the
// workgroup starts. This kernel uses it as scratch each invocation owns a slot of, and a
// workgroup array of atomics as the workgroup's own counters, so the compile gate sees both
// forms of workgroup memory on Tint. A barrier, which is what lets one invocation read
// another's slot, is the next step of #82; without one each invocation touches only its own
// slot.
//
// GLSL ES 3.00 has no workgroup memory (WebGL2 has no compute stage), so like `array-length`
// this module is WGSL-only.

declare const src: storage<array<f32>>;
declare let dst: storage<array<f32>>;
declare let counts: storage<array<u32>>;

let tile: workgroup<array<f32, 64>>;
let seen: workgroup<array<atomic<u32>, 2>>;
let calls: u32;

function tally(x: f32): void {
  calls = calls + 1;
  const bin: u32 = x < 0. ? 0 : 1;
  atomicAdd(seen[bin], 1);
}

@compute([64, 1, 1])
export function scratch(
  @builtin("global_invocation_id") gid: vec3u,
  @builtin("local_invocation_id") lid: vec3u,
): void {
  if (gid.x >= arrayLength(src)) {
    return;
  }
  tile[lid.x] = src[gid.x] * src[gid.x];
  tally(src[gid.x]);
  tally(tile[lid.x] - 1.);
  dst[gid.x] = tile[lid.x];
  counts[gid.x] = calls;
}
