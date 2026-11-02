enable subgroups;

@group(0) @binding(0) var<storage, read> src: array<u32>;
@group(0) @binding(1) var<storage, read_write> bins: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> seen: array<u32>;

@compute @workgroup_size(64)
fn histogram(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(subgroup_id) subgroup: u32, @builtin(num_subgroups) subgroups: u32) {
  var x: u32 = 0u;
  if ((gid.x < arrayLength(&src))) {
    x = src[gid.x];
  }
  let total = subgroupAdd(x);
  if (subgroupElect()) {
    _ = atomicAdd(&bins[0], total);
  }
  if ((gid.x < subgroups)) {
    seen[gid.x] = subgroup;
  }
}
