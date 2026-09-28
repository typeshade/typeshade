fn height(p: vec2<f32>, k: vec4<f32>) -> f32 {
  return ((k.x * sin((p.x * k.y))) + (k.z * cos((p.y * k.w))));
}
