struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct Color {
  @location(0) color: vec4<f32>,
}

struct _opt_vec2_f32_ {
  value: vec2<f32>,
  present: bool,
}

struct _opt_f32_ {
  value: f32,
  present: bool,
}

struct Hit {
  t: f32,
  normal: _opt_vec2_f32_,
  radius: _opt_f32_,
}

fn shadeOf(h: ptr<function, Hit>, light: vec2<f32>) -> f32 {
  let _cse0 = select(0.0, (*h).radius.value, (*h).radius.present);
  if ((*h).normal.present) {
    return (max(dot((*h).normal.value, light), 0.0) + (_cse0 * 0.1));
  }
  return (((*h).t * 0.5) + _cse0);
}

fn clampTo_function(x: f32, limit: ptr<function, _opt_f32_>) -> f32 {
  if (((*limit).present == false)) {
    return x;
  }
  return min(x, (*limit).value);
}

fn clampTo_value(x: f32, limit: _opt_f32_) -> f32 {
  if ((limit.present == false)) {
    return x;
  }
  return min(x, limit.value);
}

fn sampleAll(samples: ptr<function, array<_opt_f32_, 4>>) -> f32 {
  let s_1 = select(0.0, (*samples)[0].value, (*samples)[0].present);
  let s_2 = (s_1 + select(0.0, (*samples)[1].value, (*samples)[1].present));
  let s_3 = (s_2 + select(0.0, (*samples)[2].value, (*samples)[2].present));
  let s_4 = (s_3 + select(0.0, (*samples)[3].value, (*samples)[3].present));
  return s_4;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  var xs: array<f32, 3> = array<f32, 3>(-1.0, 3.0, -1.0);
  var ys: array<f32, 3> = array<f32, 3>(-1.0, -1.0, 3.0);
  let i = i32(vi);
  let p = vec2<f32>(xs[i], ys[i]);
  return VsOut(vec4<f32>(p, 0.0, 1.0), ((p * 0.5) + vec2<f32>(0.5, 0.5)));
}

@fragment
fn fs(v: VsOut) -> Color {
  let o = ((v.uv * 2.0) - vec2<f32>(1.0, 1.0));
  let _i1a0 = (o - vec2<f32>(0.0, 2.0));
  let _cse0 = vec2<f32>(0.0, 1.0);
  var _i1ret: Hit;
  let _i1_b = dot(_i1a0, _cse0);
  let _i1_c = (dot(_i1a0, _i1a0) - 0.25);
  let _i1_disc = ((_i1_b * _i1_b) - _i1_c);
  var _cse1: _opt_vec2_f32_ = _opt_vec2_f32_(vec2<f32>(0.0, 0.0), false);
  var _i1_h: Hit = Hit(1000.0, _cse1, _opt_f32_(0.5, true));
  if ((_i1_disc < 0.0)) {
    _i1ret = _i1_h;
  } else {
    let _i1_t = ((-_i1_b) - sqrt(_i1_disc));
    if ((_i1_t < 0.0)) {
      _i1_h.t = 0.0;
      _i1ret = _i1_h;
    } else {
      _i1_h.t = _i1_t;
      _i1_h.normal = _opt_vec2_f32_(normalize((_i1a0 + (_cse0 * _i1_t))), true);
      _i1ret = _i1_h;
    }
  }
  var hit: Hit = _i1ret;
  var _cse2: _opt_f32_ = _opt_f32_(0.0, false);
  var flat: Hit = Hit(v.uv.x, _cse1, _cse2);
  let r = shadeOf(&hit, normalize(vec2<f32>(0.3, 1.0)));
  let g = shadeOf(&flat, _cse0);
  var samples: array<_opt_f32_, 4> = array<_opt_f32_, 4>(_opt_f32_(v.uv.x, true), _cse2, _opt_f32_(v.uv.y, true), _cse2);
  let b = (clampTo_value(sampleAll(&samples), _opt_f32_(0.75, true)) + clampTo_function((v.uv.x * 0.1), &_cse2));
  return Color(vec4<f32>(r, g, b, 1.0));
}
