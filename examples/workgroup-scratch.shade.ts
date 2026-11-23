"use typeshade";

/* @example
{
  "title": "Workgroup scratch memory",
  "blurb": "`let tile: workgroup<array<f32, 64>>` is WGSL's `var<workgroup>`, one copy per workgroup its invocations share, here as scratch each invocation owns a slot of, beside a workgroup array of atomics and a per-invocation counter (§24). `compile()` emits WGSL and no GLSL text for it; on WebGL2 the entry runs as a pass program, with its workgroup memory as words (Rule 11.8).",
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
// GLSL ES 3.00 has no compute stage, so `compile()` emits WGSL and no GLSL text for this
// module. The WebGL2 tier still runs the entry, as a pass program with its workgroup memory as
// words (Rule 11.8, change 0054).

declare const src: storage<array<f32>>;
declare const dst: storage<array<f32>, "read_write">;
declare const counts: storage<array<u32>, "read_write">;

let tile: workgroup<array<f32, 64>>;
let seen: workgroup<array<atomic<u32>, 2>>;
let calls: u32;

function tally(x: f32): void {
  calls = calls + 1;
  const bin: u32 = x < 0 ? 0 : 1;
  atomicAdd(seen[bin], 1);
}

@compute([64, 1, 1])
export function scratch(
  gid: builtin<"global_invocation_id">,
  lid: builtin<"local_invocation_id">,
): void {
  if (gid.x >= src.length) {
    return;
  }
  tile[lid.x] = src[gid.x] * src[gid.x];
  tally(src[gid.x]);
  tally(tile[lid.x] - 1);
  dst[gid.x] = tile[lid.x];
  counts[gid.x] = calls;
}
