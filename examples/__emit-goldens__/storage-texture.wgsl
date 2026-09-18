@group(0) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(1) var acc: texture_storage_2d<r32float, read_write>;
@group(0) @binding(2) var ids: texture_storage_2d<rgba8uint, write>;

@compute @workgroup_size(64)
fn paint(@builtin(global_invocation_id) gid: vec3<u32>) {
  let size = textureDimensions(dst);
  let width = size.x;
  let x = (gid.x % width);
  let y = (gid.x / width);
  if ((y >= size.y)) {
    return;
  }
  let at = vec2<i32>(i32(x), i32(y));
  let uv = vec2<f32>((f32(x) / f32(size.x)), (f32(y) / f32(size.y)));
  let seen = textureLoad(acc, at);
  let weight = (seen.x + length((uv - vec2<f32>(0.5, 0.5))));
  textureStore(acc, at, vec4<f32>(weight, 0.0, 0.0, 0.0));
  let shade = smoothstep(0.0, 1.0, (weight * 0.5));
  textureStore(dst, at, vec4<f32>(uv.x, uv.y, shade, 1.0));
  textureStore(ids, at, vec4<u32>((x % 256u), (y % 256u), 1u, 255u));
}
