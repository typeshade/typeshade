struct Size {
  width: u32,
  height: u32,
}

@group(0) @binding(0) var<uniform> size: Size;
@group(0) @binding(1) var<storage, read> source: array<f32>;
@group(0) @binding(2) var<storage, read_write> blurred: array<f32>;

@compute @workgroup_size(8, 8)
fn blur(@builtin(global_invocation_id) gid: vec3<u32>) {
  let _licm0 = i32(gid.x);
  let _licm1 = (i32(size.width) - 1);
  let _licm2 = i32(gid.y);
  let _licm3 = (i32(size.height) - 1);
  let _licm4 = size.width;
  if (((gid.x >= _licm4) || (gid.y >= size.height))) {
    return;
  }
  var total: f32 = 0.0;
  for (var dy: i32 = -1; (dy <= 1); dy = (dy + 1)) {
    for (var dx: i32 = -1; (dx <= 1); dx = (dx + 1)) {
      let x = clamp((_licm0 + dx), 0, _licm1);
      let y = clamp((_licm2 + dy), 0, _licm3);
      total += source[((u32(y) * _licm4) + u32(x))];
    }
  }
  blurred[((gid.y * _licm4) + gid.x)] = (total / 9.0);
}
