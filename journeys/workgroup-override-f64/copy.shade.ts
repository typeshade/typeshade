"use typeshade";

const WG_SIZE: override<u32> = 64;
declare const src: storage<array<f64>>;
declare const dst: storage<array<f64>, "read_write">;
let tile: workgroup<array<array<f64, 3>, WG_SIZE>>;

@compute([WG_SIZE])
export function copy(
  gid: builtin<"global_invocation_id">,
  lid: builtin<"local_invocation_id">,
): void {
  if (gid.x < src.length) {
    tile[lid.x][0] = src[gid.x];
    tile[lid.x][1] = src[gid.x] * f64(2);
    tile[lid.x][2] = -src[gid.x];
  }
  workgroupBarrier();
  if (gid.x < src.length)
    dst[gid.x] = tile[lid.x][0] + tile[lid.x][1] + tile[lid.x][2];
}
