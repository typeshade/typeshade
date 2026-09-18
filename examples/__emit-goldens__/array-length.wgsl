@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read_write> dst: array<f32>;

@compute @workgroup_size(64)
fn scale_all(@builtin(global_invocation_id) gid: vec3<u32>) {
  if ((gid.x >= arrayLength(&src))) {
    return;
  }
  dst[gid.x] = (src[gid.x] * 2.0);
}
