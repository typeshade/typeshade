struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct Color {
  @location(0) color: vec4<f32>,
}

struct Hit {
  t: f32,
  normal: vec2<f32>,
}

struct _opt_f32_ {
  value: f32,
  present: bool,
}

struct _opt_Hit_ {
  value: Hit,
  present: bool,
}

struct _opt_vec2_f32_ {
  value: vec2<f32>,
  present: bool,
}

fn root_into(_dst: ptr<function, _opt_f32_>, x: f32) {
  if ((x < 0.0)) {
    (*_dst) = _opt_f32_(0.0, false);
    return;
  }
  (*_dst) = _opt_f32_(sqrt(x), true);
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
  let x = ((v.uv.x * 2.0) - 1.0);
  var _cse0: _opt_f32_ = _opt_f32_(0.0, false);
  var shade: _opt_f32_;
  if ((v.uv.y > 0.5)) {
    shade = _opt_f32_(v.uv.y, true);
  } else {
    shade = _cse0;
  }
  var _sm5_ret: f32;
  var _gv0: _opt_f32_;
  root_into(&_gv0, x);
  if ((_gv0.present == false)) {
    _sm5_ret = 0.0;
  } else {
    _sm5_ret = _gv0.value;
  }
  let _sm6_a0 = v.uv.x;
  var _sm6_ret: f32;
  let _gv1 = (_sm6_a0 * 0.5);
  if ((true == false)) {
    _sm6_ret = 0.0;
  } else {
    _sm6_ret = _gv1;
  }
  let r = (_sm5_ret + _sm6_ret);
  let _sm1_a0 = v.uv.y;
  var _sm1_ret: _opt_f32_;
  if ((_sm1_a0 <= 0.0)) {
    _sm1_ret = _cse0;
  } else {
    _sm1_ret = _opt_f32_((_sm1_a0 * 0.5), true);
  }
  var _sm2_ret: f32;
  if ((_gv0.present && _sm1_ret.present)) {
    _sm2_ret = min(_gv0.value, _sm1_ret.value);
  } else {
    var _sel0: _opt_f32_;
    if (_gv0.present) {
      _sel0 = _gv0;
    } else {
      _sel0 = _sm1_ret;
    }
    var _sm2_l_opt: _opt_f32_ = _sel0;
    _sm2_ret = select(1000.0, _sm2_l_opt.value, _sm2_l_opt.present);
  }
  let g = (_sm2_ret * select(0.25, shade.value, shade.present));
  let o = ((v.uv * 2.0) - vec2<f32>(1.0, 1.0));
  let _sm3_a0 = (o - vec2<f32>(0.0, 2.0));
  let _sm3_a1 = vec2<f32>(0.0, 1.0);
  var _sm3_ret: _opt_Hit_;
  let _sm3_l_b = dot(_sm3_a0, _sm3_a1);
  let _sm3_l_c = (dot(_sm3_a0, _sm3_a0) - 0.25);
  let _sm3_l_disc = ((_sm3_l_b * _sm3_l_b) - _sm3_l_c);
  let _cse3 = vec2<f32>(0.0, 0.0);
  var _cse2: Hit = Hit(0.0, _cse3);
  var _cse1: _opt_Hit_ = _opt_Hit_(_cse2, false);
  if ((_sm3_l_disc < 0.0)) {
    _sm3_ret = _cse1;
  } else {
    let _sm3_l_t = ((-_sm3_l_b) - sqrt(_sm3_l_disc));
    if ((_sm3_l_t < 0.0)) {
      _sm3_ret = _cse1;
    } else {
      var _sm3_l_h: Hit = _cse2;
      _sm3_l_h.t = _sm3_l_t;
      _sm3_l_h.normal = normalize((_sm3_a0 + (_sm3_a1 * _sm3_l_t)));
      _sm3_ret = _opt_Hit_(_sm3_l_h, true);
    }
  }
  var hit: _opt_Hit_ = _sm3_ret;
  let _sm4_ret = select(0.0, hit.value.t, hit.present);
  let n = select(_cse3, hit.value.normal, hit.present);
  return Color(vec4<f32>(r, g, ((_sm4_ret * 0.5) + (n.x * 0.25)), 1.0));
}
