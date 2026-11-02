"use typeshade";

const WG_SIZE: override<u32> = 64;

declare const src: storage<array<f32>>;
declare const dst: storage<array<f32>, "read_write">;

let tile: workgroup<array<f32, WG_SIZE>>;

@compute([WG_SIZE])
export function copy(
  @builtin("global_invocation_id") gid: vec3u,
  @builtin("local_invocation_id") lid: vec3u,
): void {
  if (gid.x < src.length) {
    tile[lid.x] = src[gid.x];
  }
  workgroupBarrier();
  if (gid.x < src.length) {
    dst[gid.x] = tile[lid.x];
  }
}
