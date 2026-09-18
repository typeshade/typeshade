var<workgroup> tile: array<f32, 64>;

@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read_write> sums: array<f32>;

@compute @workgroup_size(64)
fn reduce(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  tile[lid.x] = src[gid.x];
  workgroupBarrier();
  for (var stride: u32 = 32u; (stride > 0u); stride /= 2u) {
    if ((lid.x < stride)) {
      tile[lid.x] = (tile[lid.x] + tile[(lid.x + stride)]);
    }
    workgroupBarrier();
  }
  if ((lid.x == 0u)) {
    sums[wid.x] = tile[0];
  }
}
