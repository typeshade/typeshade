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

fn array_map_fs_f(p: vec2<f32>, lights: ptr<function, array<Light, 3>>) -> array<f32, 3> {
  var out: array<f32, 3>;
  out[0] = distance((*lights)[0].pos, p);
  out[1] = distance((*lights)[1].pos, p);
  out[2] = distance((*lights)[2].pos, p);
  return out;
}

fn array_reduce_fs_f_1(d: ptr<function, array<f32, 3>>) -> f32 {
  let acc = (*d)[0];
  let acc_1 = min(acc, (*d)[1]);
  let acc_2 = min(acc_1, (*d)[2]);
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

fn array_some_fs_p(p: vec2<f32>, lights: ptr<function, array<Light, 3>>) -> bool {
  if ((distance((*lights)[0].pos, p) < (*lights)[0].radius)) {
    return true;
  }
  if ((distance((*lights)[1].pos, p) < (*lights)[1].radius)) {
    return true;
  }
  if ((distance((*lights)[2].pos, p) < (*lights)[2].radius)) {
    return true;
  }
  return false;
}

fn array_every_fs_p_1(d: ptr<function, array<f32, 3>>) -> bool {
  if ((((*d)[0] > 0.7) == false)) {
    return false;
  }
  if ((((*d)[1] > 0.7) == false)) {
    return false;
  }
  if ((((*d)[2] > 0.7) == false)) {
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
  let _ifc0 = array_some_fs_p(p, &lights);
  col = select(col, mix(col, vec3<f32>(1.0), 0.15), _ifc0);
  let _ifc1 = array_every_fs_p_1(&d);
  col = select(col, (col * 0.6), _ifc1);
  col += vec3<f32>((1.0 - smoothstep(0.0, 0.012, abs((nearest - 0.2)))));
  return FsOut(vec4<f32>(col, 1.0));
}
