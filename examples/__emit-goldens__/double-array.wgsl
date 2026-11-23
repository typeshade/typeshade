@group(0) @binding(0) var<storage, read_write> numbers: array<f32>;

@compute @workgroup_size(64)
fn doubled(@builtin(global_invocation_id) gid: vec3<u32>) {
  if ((gid.x >= arrayLength(&numbers))) {
    return;
  }
  numbers[gid.x] = (numbers[gid.x] * 2.0);
}
