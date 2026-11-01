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
  let sum_1 = input[base];
  let sum_2 = (sum_1 + input[(base + 1u)]);
  let sum_3 = (sum_2 + input[(base + 2u)]);
  let sum_4 = (sum_3 + input[(base + 3u)]);
  let sum_5 = (sum_4 + input[(base + 4u)]);
  let sum_6 = (sum_5 + input[(base + 5u)]);
  let sum_7 = (sum_6 + input[(base + 6u)]);
  let sum_8 = (sum_7 + input[(base + 7u)]);
  output[idx] = sum_8;
}
