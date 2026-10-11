override WG_SIZE: u32 = 64u;

var<workgroup> tile: array<f32, WG_SIZE>;

@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read_write> dst: array<f32>;

@compute @workgroup_size(WG_SIZE)
fn copy(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
  if ((gid.x < arrayLength(&src))) {
    tile[lid.x] = src[gid.x];
  }
  workgroupBarrier();
  if ((gid.x < arrayLength(&src))) {
    dst[gid.x] = tile[lid.x];
  }
}
