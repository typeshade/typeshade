struct Weights {
  half: f32,
  rest: f32,
}

@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read_write> dst: array<f32>;

@compute @workgroup_size(64)
fn scale_all(@builtin(global_invocation_id) gid: vec3<u32>) {
  if ((gid.x >= arrayLength(&src))) {
    return;
  }
  let w = Weights(0.5, 1.5);
  dst[gid.x] = (src[gid.x] * (w.half + w.rest));
}
