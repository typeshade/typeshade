requires readonly_and_readwrite_storage_textures;

var<workgroup> leader: u32;
var<workgroup> tile: array<u32, 64>;

@group(0) @binding(0) var<storage, read_write> claimed: atomic<u32>;
@group(0) @binding(1) var<storage, read_write> out: array<u32>;

@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
  tile[lid.x] = out[gid.x];
  workgroupBarrier();
  let claim = atomicCompareExchangeWeak(&claimed, 0u, (gid.x + 1u));
  if (claim.exchanged) {
    leader = lid.x;
  }
  workgroupBarrier();
  let agreed = workgroupUniformLoad(&leader);
  textureBarrier();
  out[gid.x] = ((tile[lid.x] + agreed) + claim.old_value);
}
