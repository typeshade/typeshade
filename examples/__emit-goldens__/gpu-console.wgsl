struct Sample {
  value: f32,
  scaled: vec2<f32>,
}

@group(0) @binding(0) var<storage, read> xs: array<f32>;
@group(0) @binding(1) var<storage, read_write> out: array<f32>;

fn doubled(v: f32) -> f32 {
  let s = (v * 2.0);
  if ((s > 10.0)) {
  }
  return s;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if ((gid.x >= arrayLength(&xs))) {
    return;
  }
  let x = xs[gid.x];
  out[gid.x] = doubled(x);
}
