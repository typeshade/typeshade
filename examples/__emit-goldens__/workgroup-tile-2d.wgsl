var<workgroup> tile: array<f32, 64>;

@group(0) @binding(0) var<uniform> size: vec2<u32>;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read_write> dst: array<f32>;

@compute @workgroup_size(8, 8)
fn blur(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let x = min(gid.x, (size.x - 1u));
  let y = min(gid.y, (size.y - 1u));
  tile[li] = src[((y * size.x) + x)];
  workgroupBarrier();
  let left = (max(lid.x, 1u) - 1u);
  let right = min((lid.x + 1u), 7u);
  let up = (max(lid.y, 1u) - 1u);
  let down = min((lid.y + 1u), 7u);
  let sum = ((((tile[li] + tile[((lid.y * 8u) + left)]) + tile[((lid.y * 8u) + right)]) + tile[((up * 8u) + lid.x)]) + tile[((down * 8u) + lid.x)]);
  if (((gid.x < size.x) && (gid.y < size.y))) {
    dst[((gid.y * size.x) + gid.x)] = (sum / 5.0);
  }
}
