"use typeshade";

/* @example
{
  "title": "Two-dimensional workgroup",
  "blurb": "`@compute([8, 8])` is WGSL's `@workgroup_size(8, 8)`: one invocation per pixel of an 8x8 tile, which loads the tile into workgroup memory, waits at a barrier, and blurs each pixel with its four neighbours inside the tile (§3, §24, §25). WGSL-only: WebGL2 has no compute stage.",
  "renderable": false,
  "reason": "missing capabilities: storageBuffer, compute"
}
*/

// A two-dimensional workgroup (§3). `@compute([8, 8])` gives each workgroup an 8x8 grid of
// invocations, emitted as `@workgroup_size(8, 8)`, so `global_invocation_id.xy` is the pixel
// and `local_invocation_id.xy` its place in the tile. The host dispatches
// `ceil(width / 8) x ceil(height / 8)` workgroups, the extents `reflect()` reports as
// `workgroupShape: [8, 8, 1]`.
//
// The kernel is the shape an image filter takes: load the tile into workgroup memory, wait for
// every invocation of the tile at the barrier, then read the neighbours' slots. The barrier
// sits in uniform control flow, so a pixel past the image edge is clamped rather than
// returned from, and only the final store is guarded.
//
// GLSL ES 3.00 has no compute stage and no workgroup memory, so like `workgroup-scratch` this
// module is WGSL-only.

declare const size: uniform<vec2u>;
declare const src: storage<array<f32>>;
declare const dst: storage<array<f32>, "read_write">;

let tile: workgroup<array<f32, 64>>;

@compute([8, 8])
export function blur(
  @builtin("global_invocation_id") gid: vec3u,
  @builtin("local_invocation_id") lid: vec3u,
  @builtin("local_invocation_index") li: u32,
): void {
  const x: u32 = min(gid.x, size.x - 1);
  const y: u32 = min(gid.y, size.y - 1);
  tile[li] = src[y * size.x + x];
  workgroupBarrier();

  const left: u32 = max(lid.x, 1) - 1;
  const right: u32 = min(lid.x + 1, 7);
  const up: u32 = max(lid.y, 1) - 1;
  const down: u32 = min(lid.y + 1, 7);
  const sum =
    tile[li] +
    tile[lid.y * 8 + left] +
    tile[lid.y * 8 + right] +
    tile[up * 8 + lid.x] +
    tile[down * 8 + lid.x];
  if (gid.x < size.x && gid.y < size.y) {
    dst[gid.y * size.x + gid.x] = sum / 5.;
  }
}
