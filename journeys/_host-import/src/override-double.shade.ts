"use typeshade";
const WIDTH: override<u32> = 32;
declare const gain: uniform<f64>;
declare const src: storage<array<f64>>;
declare const dst: storage<array<f64>, "read_write">;
let tile: workgroup<array<array<f64, 2>, WIDTH>>;
@compute([WIDTH])
export function overrideDouble(@builtin("global_invocation_id") gid: vec3u, @builtin("local_invocation_id") lid: vec3u) {
  if (gid.x < src.length) tile[lid.x][1] = src[gid.x] * gain;
  workgroupBarrier();
  if (gid.x < src.length) dst[gid.x] = tile[lid.x][0] + tile[lid.x][1];
}
