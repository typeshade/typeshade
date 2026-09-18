const BINS: f32 = 8.0;

struct Summary {
  count: atomic<u32>,
  maxBin: atomic<i32>,
}

@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read_write> bins: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> summary: Summary;
@group(0) @binding(3) var<storage, read_write> firstValue: atomic<u32>;

@compute @workgroup_size(64)
fn histogram(@builtin(global_invocation_id) gid: vec3<u32>) {
  if ((gid.x >= arrayLength(&src))) {
    return;
  }
  let bin = u32((clamp(src[gid.x], 0.0, 0.999) * BINS));
  _ = atomicAdd(&bins[bin], 1u);
  let before = atomicAdd(&summary.count, 1u);
  if ((before == 0u)) {
    atomicStore(&firstValue, u32((src[gid.x] * 1000.0)));
  }
  _ = atomicMax(&summary.maxBin, i32(bin));
}
