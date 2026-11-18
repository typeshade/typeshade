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
  var _gv0: _opt_f32_;
  root_into(&_gv0, x);
  let _i5ret = select(_gv0.value, 0.0, (_gv0.present == false));
  let _i6a0 = v.uv.x;
  let _i6ret = select((_i6a0 * 0.5), 0.0, (true == false));
  let r = (_i5ret + _i6ret);
  let _i1a0 = v.uv.y;
  var _i1ret: _opt_f32_;
  if ((_i1a0 <= 0.0)) {
    _i1ret = _cse0;
  } else {
    _i1ret = _opt_f32_((_i1a0 * 0.5), true);
  }
  var _i2ret: f32;
  if ((_gv0.present && _i1ret.present)) {
    _i2ret = min(_gv0.value, _i1ret.value);
  } else {
    var _sel0: _opt_f32_;
    if (_gv0.present) {
      _sel0 = _gv0;
    } else {
      _sel0 = _i1ret;
    }
    var _i2_opt: _opt_f32_ = _sel0;
    _i2ret = select(1000.0, _i2_opt.value, _i2_opt.present);
  }
  let g = (_i2ret * select(0.25, shade.value, shade.present));
  let o = ((v.uv * 2.0) - vec2<f32>(1.0, 1.0));
  let _i3a0 = (o - vec2<f32>(0.0, 2.0));
  let _i3a1 = vec2<f32>(0.0, 1.0);
  var _i3ret: _opt_Hit_;
  let _i3_b = dot(_i3a0, _i3a1);
  let _i3_c = (dot(_i3a0, _i3a0) - 0.25);
  let _i3_disc = ((_i3_b * _i3_b) - _i3_c);
  let _cse3 = vec2<f32>(0.0, 0.0);
  var _cse2: Hit = Hit(0.0, _cse3);
  var _cse1: _opt_Hit_ = _opt_Hit_(_cse2, false);
  if ((_i3_disc < 0.0)) {
    _i3ret = _cse1;
  } else {
    let _i3_t = ((-_i3_b) - sqrt(_i3_disc));
    if ((_i3_t < 0.0)) {
      _i3ret = _cse1;
    } else {
      var _i3_h: Hit = _cse2;
      _i3_h.t = _i3_t;
      _i3_h.normal = normalize((_i3a0 + (_i3a1 * _i3_t)));
      _i3ret = _opt_Hit_(_i3_h, true);
    }
  }
  var hit: _opt_Hit_ = _i3ret;
  let _i4ret = select(0.0, hit.value.t, hit.present);
  let n = select(_cse3, hit.value.normal, hit.present);
  return Color(vec4<f32>(r, g, ((_i4ret * 0.5) + (n.x * 0.25)), 1.0));
}
