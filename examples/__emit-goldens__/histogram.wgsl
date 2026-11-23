@group(0) @binding(0) var<storage, read> values: array<f32>;
@group(0) @binding(1) var<storage, read_write> bins: array<atomic<u32>>;

@compute @workgroup_size(64)
fn histogram(@builtin(global_invocation_id) gid: vec3<u32>) {
  if ((gid.x >= arrayLength(&values))) {
    return;
  }
  let bin = u32((clamp(values[gid.x], 0.0, 0.999) * 8.0));
  _ = atomicAdd(&bins[bin], 1u);
}
