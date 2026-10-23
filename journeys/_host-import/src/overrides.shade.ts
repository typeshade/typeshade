"use typeshade";
const WIDTH: override<u32> = 32;
const GAIN: override<f32> = 2.;
declare const src: storage<array<f32>>;
declare const dst: storage<array<f32>, "read_write">;
let tile: workgroup<array<array<f32, 2>, WIDTH>>;
@compute([WIDTH])
export function overrideCopy(@builtin("global_invocation_id") gid: vec3u, @builtin("local_invocation_id") lid: vec3u) {
  if (gid.x < src.length) tile[lid.x][1] = src[gid.x] * GAIN;
  workgroupBarrier();
  if (gid.x < src.length) dst[gid.x] = tile[lid.x][0] + tile[lid.x][1];
}
@compute([WIDTH])
export function overrideMark(@builtin("global_invocation_id") gid: vec3u, @builtin("local_invocation_index") li: u32) {
  if (gid.x < src.length) dst[gid.x] = src[gid.x] * GAIN + f32(li);
}
