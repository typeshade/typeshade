@group(0) @binding(0) var<uniform> k: f32;
@group(0) @binding(1) var<storage, read> xs: array<f32>;
@group(0) @binding(2) var<storage, read_write> ys: array<f32>;

@compute @workgroup_size(64)
fn scale(@builtin(global_invocation_id) gid: vec3<u32>) {
  if ((gid.x >= arrayLength(&xs))) {
    return;
  }
  ys[gid.x] = (xs[gid.x] * k);
}
