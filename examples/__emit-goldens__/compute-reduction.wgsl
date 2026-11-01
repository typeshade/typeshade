@group(0) @binding(0) var<storage, read> input: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;
@group(0) @binding(2) var<uniform> params: vec4<u32>;

@compute @workgroup_size(64)
fn reduce_windows(@builtin(global_invocation_id) gid: vec3<u32>) {
  let _licm0 = (gid.x * 8u);
  if ((gid.x >= params.x)) {
    return;
  }
  let _v0_1 = input[_licm0];
  let _v0_2 = (_v0_1 + input[(_licm0 + 1u)]);
  let _v0_3 = (_v0_2 + input[(_licm0 + 2u)]);
  let _v0_4 = (_v0_3 + input[(_licm0 + 3u)]);
  let _v0_5 = (_v0_4 + input[(_licm0 + 4u)]);
  let _v0_6 = (_v0_5 + input[(_licm0 + 5u)]);
  let _v0_7 = (_v0_6 + input[(_licm0 + 6u)]);
  let _v0_8 = (_v0_7 + input[(_licm0 + 7u)]);
  output[gid.x] = _v0_8;
}
