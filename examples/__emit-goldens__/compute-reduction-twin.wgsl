@group(0) @binding(0) var<storage, read> input: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;
@group(0) @binding(2) var<uniform> params: vec4<u32>;

@compute @workgroup_size(64)
fn reduce_windows(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if ((idx >= params.x)) {
    return;
  }
  let base = (idx * 8u);
  var sum: f32 = 0.0;
  for (var j: u32 = 0u; (j < 8u); j = (j + 1u)) {
    sum = (sum + input[(base + j)]);
  }
  output[idx] = sum;
}
