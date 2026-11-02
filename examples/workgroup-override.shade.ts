"use typeshade";

/* @example
{
  "title": "Workgroup size override",
  "blurb": "One `override<u32>` sets the compute entry's workgroup size and the outer length of its shared scratch array. The host selects 64 or 256 from the input length when it creates the pipeline.",
  "renderable": false,
  "reason": "missing capabilities: storageBuffer, compute"
}
*/

const WG_SIZE: override<u32> = 64;

declare const src: storage<array<f32>>;
declare const dst: storage<array<f32>, "read_write">;

let tile: workgroup<array<f32, WG_SIZE>>;

export const copy = compute([WG_SIZE], function copy(
  gid: builtin<"global_invocation_id", vec3u>,
  lid: builtin<"local_invocation_id", vec3u>,
): void {
  if (gid.x < src.length) {
    tile[lid.x] = src[gid.x];
  }
  workgroupBarrier();
  if (gid.x < src.length) {
    dst[gid.x] = tile[lid.x];
  }
});
