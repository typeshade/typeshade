var<workgroup> partial: array<f32, 64>;

@group(0) @binding(0) var<storage, read> numbers: array<f32>;
@group(0) @binding(1) var<storage, read_write> total: array<f32>;

@compute @workgroup_size(64)
fn sum(@builtin(local_invocation_id) lid: vec3<u32>) {
  var mine: f32 = 0.0;
  for (var i: u32 = lid.x; (i < arrayLength(&numbers)); i += 64u) {
    mine += numbers[i];
  }
  partial[lid.x] = mine;
  workgroupBarrier();
  for (var stride: u32 = 32u; (stride > 0u); stride /= 2u) {
    if ((lid.x < stride)) {
      partial[lid.x] = (partial[lid.x] + partial[(lid.x + stride)]);
    }
    workgroupBarrier();
  }
  if ((lid.x == 0u)) {
    total[0] = partial[0];
  }
}
