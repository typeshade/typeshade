"use typeshade";
const WIDTH: override<u32> = 32;
const GAIN: override<f32> = 2.;
declare const src: storage<array<f32>>;
declare const dst: storage<array<f32>, "read_write">;
let tile: workgroup<array<array<f32, 2>, WIDTH>>;
export const overrideCopy = compute([WIDTH], function overrideCopy(gid: builtin<"global_invocation_id", vec3u>, lid: builtin<"local_invocation_id", vec3u>) {
  if (gid.x < src.length) tile[lid.x][1] = src[gid.x] * GAIN;
  workgroupBarrier();
  if (gid.x < src.length) dst[gid.x] = tile[lid.x][0] + tile[lid.x][1];
});
export const overrideMark = compute([WIDTH], function overrideMark(gid: builtin<"global_invocation_id", vec3u>, li: builtin<"local_invocation_index", u32>) {
  if (gid.x < src.length) dst[gid.x] = src[gid.x] * GAIN + f32(li);
});
