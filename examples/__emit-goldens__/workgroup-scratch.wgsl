var<workgroup> tile: array<f32, 64>;
var<workgroup> seen: array<atomic<u32>, 2>;
var<private> calls: u32;

@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read_write> dst: array<f32>;
@group(0) @binding(2) var<storage, read_write> counts: array<u32>;

fn tally(x: f32) {
  calls = (calls + 1u);
  let bin = select(1u, 0u, (x < 0.0));
  _ = atomicAdd(&seen[bin], 1u);
}

@compute @workgroup_size(64)
fn scratch(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
  if ((gid.x >= arrayLength(&src))) {
    return;
  }
  tile[lid.x] = (src[gid.x] * src[gid.x]);
  tally(src[gid.x]);
  tally((tile[lid.x] - 1.0));
  dst[gid.x] = tile[lid.x];
  counts[gid.x] = calls;
}
