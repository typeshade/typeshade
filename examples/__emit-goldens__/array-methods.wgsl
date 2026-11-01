struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct FsOut {
  @location(0) color: vec4<f32>,
}

struct Light {
  pos: vec2<f32>,
  radius: f32,
  color: vec3<f32>,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(x, y));
}

fn fs_f(p: vec2<f32>, l: ptr<function, Light>) -> f32 {
  return distance((*l).pos, p);
}

fn array_map_fs_f(p: vec2<f32>, lights: ptr<function, array<Light, 3>>) -> array<f32, 3> {
  var out: array<f32, 3>;
  out[0] = fs_f(p, &(*lights)[0]);
  out[1] = fs_f(p, &(*lights)[1]);
  out[2] = fs_f(p, &(*lights)[2]);
  return out;
}

fn fs_f_1(a: f32, b: f32) -> f32 {
  return min(a, b);
}

fn array_reduce_fs_f_1(d: ptr<function, array<f32, 3>>) -> f32 {
  let acc = (*d)[0];
  let acc_1 = fs_f_1(acc, (*d)[1]);
  let acc_2 = fs_f_1(acc_1, (*d)[2]);
  return acc_2;
}

fn fs_f_2(col: ptr<function, vec3<f32>>, d: ptr<function, array<f32, 3>>, l: ptr<function, Light>, i: i32) {
  (*col) += ((*l).color * (0.02 / (0.02 + ((*d)[i] * (*d)[i]))));
}

fn array_forEach_fs_f_2(col: ptr<function, vec3<f32>>, d: ptr<function, array<f32, 3>>, lights: ptr<function, array<Light, 3>>) {
  fs_f_2(col, d, &(*lights)[0], 0);
  fs_f_2(col, d, &(*lights)[1], 1);
  fs_f_2(col, d, &(*lights)[2], 2);
}

fn fs_p(p: vec2<f32>, l: ptr<function, Light>) -> bool {
  return (distance((*l).pos, p) < (*l).radius);
}

fn array_some_fs_p(p: vec2<f32>, lights: ptr<function, array<Light, 3>>) -> bool {
  if (fs_p(p, &(*lights)[0])) {
    return true;
  }
  if (fs_p(p, &(*lights)[1])) {
    return true;
  }
  if (fs_p(p, &(*lights)[2])) {
    return true;
  }
  return false;
}

fn fs_p_1(x: f32) -> bool {
  return (x > 0.7);
}

fn array_every_fs_p_1(d: ptr<function, array<f32, 3>>) -> bool {
  if ((fs_p_1((*d)[0]) == false)) {
    return false;
  }
  if ((fs_p_1((*d)[1]) == false)) {
    return false;
  }
  if ((fs_p_1((*d)[2]) == false)) {
    return false;
  }
  return true;
}

@fragment
fn fs(v: VsOut) -> FsOut {
  let p = v.uv;
  var lights: array<Light, 3> = array<Light, 3>(Light(vec2<f32>(-0.5, -0.3), 0.35, vec3<f32>(1.0, 0.45, 0.2)), Light(vec2<f32>(0.45, -0.1), 0.3, vec3<f32>(0.2, 0.6, 1.0)), Light(vec2<f32>(0.0, 0.5), 0.25, vec3<f32>(0.4, 1.0, 0.5)));
  var d: array<f32, 3> = array_map_fs_f(p, &lights);
  let nearest = array_reduce_fs_f_1(&d);
  var col: vec3<f32> = vec3<f32>(0.02, 0.02, 0.05);
  array_forEach_fs_f_2(&col, &d, &lights);
  if (array_some_fs_p(p, &lights)) {
    col = mix(col, vec3<f32>(1.0), 0.15);
  }
  if (array_every_fs_p_1(&d)) {
    col *= 0.6;
  }
  col += vec3<f32>((1.0 - smoothstep(0.0, 0.012, abs((nearest - 0.2)))));
  return FsOut(vec4<f32>(col, 1.0));
}
