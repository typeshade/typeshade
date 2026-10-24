struct Sample {
  value: f32,
  scaled: vec2<f32>,
}

@group(0) @binding(0) var<storage, read> xs: array<f32>;
@group(0) @binding(1) var<storage, read_write> out: array<f32>;

fn doubled(v: f32) -> f32 {
  let s = (v * 2.0);
  if ((s > 10.0)) {
    /* typeshade console.warn */;
  }
  return s;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if ((gid.x >= arrayLength(&xs))) {
    return;
  }
  let x = xs[gid.x];
  let sample = Sample(x, vec2<f32>(x, (x * 0.5)));
  let _cse0 = vec2<f32>(1.0, 0.0);
  /* typeshade console.log */;
  /* typeshade console.table */;
  out[gid.x] = doubled(x);
}
