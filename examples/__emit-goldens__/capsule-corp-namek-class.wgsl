const AA: i32 = 1;
const PI: f32 = 3.14159265;
const TAU: f32 = 6.28318531;
const GROUND: f32 = -1.04;
const BAND_TOP: f32 = 0.08;
const BAND_BOT: f32 = -0.52;
const WIN_N: f32 = 12.0;
const WIN_Y: f32 = -0.22;
const WIN_A: f32 = 0.1;
const WIN_BULGE: f32 = 0.06;
const RING_Y: f32 = 0.71;
const RING_H: f32 = 0.04;
const DOOR_HW: f32 = 0.17;
const DOOR_Y0: f32 = -0.6;
const DOOR_Y1: f32 = 0.21;
const DOOR_T: f32 = 0.005;
const LEG_LON: f32 = 0.7854;
const FLAP_Y: f32 = -0.6;
const FLAP_LEN: f32 = 0.36;
const FLAP_HW: f32 = 0.125;
const FLAP_TIP_HW: f32 = 0.08;
const FLAP_T: f32 = 0.03;
const FLAP_OPEN: f32 = 2.2;
const BAY_DEPTH: f32 = 0.03;
const LEG_R: f32 = 0.99;
const SHOCK_Y: f32 = -0.92;
const BELLY_R: f32 = 0.26;
const BELLY_Y: f32 = (-sqrt((1.0 - (BELLY_R * BELLY_R))));
const BELLY_EXT: f32 = 0.06;
const SHAFT_R: f32 = 0.1;
const CAPS_LON: f32 = 0.08;
const CAPS_LAT: f32 = 0.547;
const CAPS_H: f32 = 0.25;
const CORP_LON: f32 = 0.02;
const CORP_LAT: f32 = 0.284;
const CORP_H: f32 = 0.1;
const ADV: f32 = 0.78;
const COAST_R: f32 = 10.0;
const MESA_R: f32 = 18.0;
const SW: f32 = 0.085;
const SHEEN_R: f32 = 0.99;
const HATCH_W: f32 = 0.02;
const HATCH_L: f32 = 0.09;
const HATCH_D: f32 = 0.09;
const SCUFFS: f32 = 10.0;
const DIRT_GRAIN: vec2<f32> = vec2<f32>(0.7, 0.0);
const DIRT_TILT: f32 = 0.3;
const INK: vec3<f32> = vec3<f32>(0.05, 0.07, 0.09);
const HULL: vec3<f32> = vec3<f32>(0.92, 0.95, 0.91);
const BLACK: vec3<f32> = vec3<f32>(0.07, 0.11, 0.14);
const BLACK_HI: vec3<f32> = vec3<f32>(0.47, 0.68, 0.68);
const METAL: vec3<f32> = vec3<f32>(0.74, 0.76, 0.78);
const GLASS_LO: vec3<f32> = vec3<f32>(0.36, 0.7, 0.8);
const GLASS_HI: vec3<f32> = vec3<f32>(0.06, 0.33, 0.5);
const SHADE: vec3<f32> = vec3<f32>(0.64, 0.76, 0.86);
const SKY_TOP: vec3<f32> = vec3<f32>(0.3, 0.67, 0.37);
const SKY_MID: vec3<f32> = vec3<f32>(0.58, 0.78, 0.5);
const SKY_HZ: vec3<f32> = vec3<f32>(0.74, 0.87, 0.7);
const CLOUD: vec3<f32> = vec3<f32>(0.84, 0.93, 0.77);
const HAZE: vec3<f32> = vec3<f32>(0.62, 0.8, 0.74);
const GRASS: vec3<f32> = vec3<f32>(0.2, 0.57, 0.58);
const GRASS_DK: vec3<f32> = vec3<f32>(0.15, 0.45, 0.5);
const SAND: vec3<f32> = vec3<f32>(0.86, 0.8, 0.62);
const SAND_RIM: vec3<f32> = vec3<f32>(0.8, 0.5, 0.38);
const DIRT_DK: vec3<f32> = vec3<f32>(0.6, 0.43, 0.28);
const SEA: vec3<f32> = vec3<f32>(0.435, 0.663, 0.494);
const SEA_SHOAL: vec3<f32> = vec3<f32>(0.55, 0.77, 0.62);
const SEA_HI: vec3<f32> = vec3<f32>(0.8, 0.91, 0.8);
const MESA_TOP: vec3<f32> = vec3<f32>(0.3, 0.62, 0.55);
const CLIFF_A: vec3<f32> = vec3<f32>(0.86, 0.58, 0.48);
const CLIFF_B: vec3<f32> = vec3<f32>(0.95, 0.8, 0.66);
const CLIFF_C: vec3<f32> = vec3<f32>(0.66, 0.38, 0.36);
const LEAF: vec3<f32> = vec3<f32>(0.13, 0.48, 0.6);
const LEAF_HI: vec3<f32> = vec3<f32>(0.38, 0.72, 0.78);
const TRUNK: vec3<f32> = vec3<f32>(0.86, 0.88, 0.78);
const LIG: vec3<f32> = normalize(vec3<f32>((-0.59), 0.36, 0.73));
const CROSS: array<vec2<f32>, 4> = array<vec2<f32>, 4>(vec2<f32>((-1.0), 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, (-1.0)), vec2<f32>(0.0, 1.0));
const TET: array<vec3<f32>, 4> = array<vec3<f32>, 4>(vec3<f32>(1.0, (-1.0), (-1.0)), vec3<f32>((-1.0), (-1.0), 1.0), vec3<f32>((-1.0), 1.0, (-1.0)), vec3<f32>(1.0));

struct Uniforms {
  time: f32,
  resolution: vec2<f32>,
  mouse: vec2<f32>,
}

struct PolarResult {
  point: vec3<f32>,
  index: f32,
}

struct MarchResult {
  hit: vec2<f32>,
  edge: f32,
  winEdge: f32,
  tEdge: f32,
}

struct Ship {
  legCount: f32,
}

struct NamekTree {
  position: vec2<f32>,
  height: f32,
  radius: f32,
}

struct NamekTrees {
  first: NamekTree,
  second: NamekTree,
}

struct ShipDetails {
  ship: Ship,
  trees: NamekTrees,
}

struct Lettering {
  strokeWidth: f32,
}

struct NamekScene {
  ship: Ship,
  trees: NamekTrees,
  details: ShipDetails,
  lettering: Lettering,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct _spec1_result {
  point: vec3<f32>,
}

struct _spec4_result {
  position: vec2<f32>,
  height: f32,
}

@group(0) @binding(0) var<uniform> u: Uniforms;

fn _mod_f32(x: f32, y: f32) -> f32 {
  return (x - y * floor(x / y));
}

fn Noise_hash12(p: vec2<f32>) -> f32 {
  var p3: vec3<f32> = fract((vec3<f32>(p.xyx) * 0.1031));
  p3 += dot(p3, (p3.yzx + 33.33));
  return fract(((p3.x + p3.y) * p3.z));
}

fn Noise_value(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let q = ((f * f) * (3.0 - (2.0 * f)));
  return mix(mix(Noise_hash12(i), Noise_hash12((i + vec2<f32>(1.0, 0.0))), q.x), mix(Noise_hash12((i + vec2<f32>(0.0, 1.0))), Noise_hash12((i + vec2<f32>(1.0, 1.0))), q.x), q.y);
}

fn Noise_fbm(p: vec2<f32>) -> f32 {
  let rotation = mat2x2<f32>(vec2<f32>(1.6, 1.2), vec2<f32>(-1.2, 1.6));
  let sum_1 = (0.5 * Noise_value(p));
  let q_1 = (rotation * p);
  let sum_2 = (sum_1 + (0.25 * Noise_value(q_1)));
  let q_2 = (rotation * q_1);
  let sum_3 = (sum_2 + (0.125 * Noise_value(q_2)));
  let q_3 = (rotation * q_2);
  let sum_4 = (sum_3 + (0.0625 * Noise_value(q_3)));
  return (sum_4 / 0.9375);
}

fn Noise_mod(x: f32, y: f32) -> f32 {
  return (x - (y * floor((x / y))));
}

fn Noise_fbmWrapX(p: vec2<f32>, n: f32) -> f32 {
  let _licm0 = vec2<f32>(0.0, 5.3);
  var q: vec2<f32> = p;
  var period: f32 = n;
  var sum: f32 = 0.0;
  var amplitude: f32 = 0.5;
  for (var i: i32 = 0; (i < 4); i = (i + 1)) {
    let _i0_i = floor(q);
    let _i0_f = fract(q);
    let _i0_q = ((_i0_f * _i0_f) * (3.0 - (2.0 * _i0_f)));
    let _i0_i0 = Noise_mod(_i0_i.x, period);
    let _i0_i1 = Noise_mod((_i0_i.x + 1.0), period);
    let _lc0 = (_i0_i.y + 1.0);
    let _i0ret = mix(mix(Noise_hash12(vec2<f32>(_i0_i0, _i0_i.y)), Noise_hash12(vec2<f32>(_i0_i1, _i0_i.y)), _i0_q.x), mix(Noise_hash12(vec2<f32>(_i0_i0, _lc0)), Noise_hash12(vec2<f32>(_i0_i1, _lc0)), _i0_q.x), _i0_q.y);
    sum += (amplitude * _i0ret);
    q = ((2.0 * q) + _licm0);
    period *= 2.0;
    amplitude *= 0.5;
  }
  return (sum / 0.9375);
}

fn SDF_union(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return select(b, a, (a.x < b.x));
}

fn SDF_segment(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
  let pa = (p - a);
  let ba = (b - a);
  return length((pa - (ba * clamp((dot(pa, ba) / dot(ba, ba)), 0.0, 1.0))));
}

fn SDF_cylinderY(p: vec3<f32>, radius: f32, y0: f32, y1: f32) -> f32 {
  let d = vec2<f32>((length(p.xz) - radius), (abs((p.y - (0.5 * (y0 + y1)))) - (0.5 * (y1 - y0))));
  return (min(max(d.x, d.y), 0.0) + length(max(d, vec2<f32>(0.0))));
}

fn SDF_capsule(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, radius: f32) -> f32 {
  let pa = (p - a);
  let ba = (b - a);
  return (length((pa - (ba * clamp((dot(pa, ba) / dot(ba, ba)), 0.0, 1.0)))) - radius);
}

fn SDF_rotate(p: vec2<f32>, angle: f32) -> vec2<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return (mat2x2<f32>(vec2<f32>(c, s), vec2<f32>((-s), c)) * p);
}

fn SDF_arch(p: vec2<f32>, halfWidth: f32, y0: f32, y1: f32) -> f32 {
  let d = (length(vec2<f32>(p.x, (p.y - clamp(p.y, (y0 - halfWidth), (y1 - halfWidth))))) - halfWidth);
  return max(d, (y0 - p.y));
}

fn SDF_polarY_into(_dst: ptr<function, PolarResult>, angle: f32, radius: f32, y: f32, count: f32, offset: f32) {
  let sector = (TAU / count);
  let shifted = (angle - offset);
  let index = floor(((shifted / sector) + 0.5));
  let localAngle = (shifted - (index * sector));
  (*_dst) = PolarResult(vec3<f32>((radius * sin(localAngle)), y, (radius * cos(localAngle))), index);
}

fn Ship_flapOutline_function(self_: ptr<function, Ship>, s: vec3<f32>) -> f32 {
  let angle = (asin(FLAP_Y) - atan2(s.y, length(s.xz)));
  let _cse0 = (0.5 * FLAP_LEN);
  let _gv0 = (angle - _cse0);
  let _i3a1 = (FLAP_HW - 0.06);
  let _i3a2 = (FLAP_TIP_HW - 0.06);
  let _i3a3 = (_cse0 - 0.06);
  let _i3_k1 = vec2<f32>(_i3a2, _i3a3);
  let _i3_k2 = vec2<f32>((_i3a2 - _i3a1), (2.0 * _i3a3));
  let _i3_qx = abs(s.x);
  let _i3_q = vec2<f32>(_i3_qx, _gv0);
  let _i3_ca = vec2<f32>((_i3_qx - min(_i3_qx, select(_i3a2, _i3a1, (_gv0 < 0.0)))), (abs(_gv0) - _i3a3));
  let _i3_cb = _flow3_shared(_i3_q, _i3_k1, _i3_k2);
  let _i3_sign = select(1.0, -1.0, ((_i3_cb.x < 0.0) && (_i3_ca.y < 0.0)));
  let _i3ret = (_i3_sign * sqrt(min(dot(_i3_ca, _i3_ca), dot(_i3_cb, _i3_cb))));
  return (_i3ret - 0.06);
}

fn Ship_flapOutline_value(self_: Ship, s: vec3<f32>) -> f32 {
  let angle = (asin(FLAP_Y) - atan2(s.y, length(s.xz)));
  let _cse0 = (0.5 * FLAP_LEN);
  let _gv0 = (angle - _cse0);
  let _i3a1 = (FLAP_HW - 0.06);
  let _i3a2 = (FLAP_TIP_HW - 0.06);
  let _i3a3 = (_cse0 - 0.06);
  let _i3_k1 = vec2<f32>(_i3a2, _i3a3);
  let _i3_k2 = vec2<f32>((_i3a2 - _i3a1), (2.0 * _i3a3));
  let _i3_qx = abs(s.x);
  let _i3_q = vec2<f32>(_i3_qx, _gv0);
  let _i3_ca = vec2<f32>((_i3_qx - min(_i3_qx, select(_i3a2, _i3a1, (_gv0 < 0.0)))), (abs(_gv0) - _i3a3));
  let _i3_cb = _flow3_shared(_i3_q, _i3_k1, _i3_k2);
  let _i3_sign = select(1.0, -1.0, ((_i3_cb.x < 0.0) && (_i3_ca.y < 0.0)));
  let _i3ret = (_i3_sign * sqrt(min(dot(_i3_ca, _i3_ca), dot(_i3_cb, _i3_cb))));
  return (_i3ret - 0.06);
}

fn Ship_flapHome_function(self_: ptr<function, Ship>, l: vec3<f32>) -> vec3<f32> {
  let hinge = vec2<f32>(sqrt((1.0 - (FLAP_Y * FLAP_Y))), FLAP_Y);
  let q = (hinge + SDF_rotate((l.zy - hinge), (-FLAP_OPEN)));
  return vec3<f32>(l.x, q.y, q.x);
}

fn Ship_flapHome_value(self_: Ship, l: vec3<f32>) -> vec3<f32> {
  let hinge = vec2<f32>(sqrt((1.0 - (FLAP_Y * FLAP_Y))), FLAP_Y);
  let q = (hinge + SDF_rotate((l.zy - hinge), (-FLAP_OPEN)));
  return vec3<f32>(l.x, q.y, q.x);
}

fn Ship_map_function(self_: ptr<function, Ship>, p: vec3<f32>) -> vec2<f32> {
  let bound = (length((p - vec3<f32>(0.0, -0.3, 0.0))) - 1.6);
  if ((bound > 0.25)) {
    return vec2<f32>(bound, 0.0);
  }
  let radius = length(p);
  let longitude = atan2(p.x, p.z);
  let horizontalRadius = length(p.xz);
  var legFrame: _spec1_result;
  _spec0_SDF_polarY_into(&legFrame, longitude, horizontalRadius, p.y, (*self_).legCount, LEG_LON);
  let l = legFrame.point;
  let bay = max(Ship_flapOutline_function(self_, l), (((1.0 - FLAP_T) - BAY_DEPTH) - radius));
  var result: vec2<f32> = select(vec2<f32>((-bay), 11.0), vec2<f32>((radius - 1.0), 0.0), ((radius - 1.0) > (-bay)));
  let _cse0 = (BELLY_Y - p.y);
  result = select(result, vec2<f32>(_cse0, 12.0), (_cse0 > result.x));
  result = SDF_union(result, vec2<f32>(max((radius - 1.022), (abs((p.y - RING_Y)) - RING_H)), 1.0));
  let door = SDF_arch(vec2<f32>((longitude * horizontalRadius), p.y), DOOR_HW, DOOR_Y0, DOOR_Y1);
  result = SDF_union(result, vec2<f32>(max(((radius - 1.0) - DOOR_T), door), 4.0));
  var windowFrame: PolarResult;
  SDF_polarY_into(&windowFrame, longitude, horizontalRadius, p.y, WIN_N, 0.0);
  if ((abs(windowFrame.index) > 0.5)) {
    let center = vec3<f32>(0.0, WIN_Y, sqrt((1.0 - (WIN_Y * WIN_Y))));
    let w = (windowFrame.point - center);
    let h = dot(w, center);
    let glassRadius = (((WIN_A * WIN_A) + (WIN_BULGE * WIN_BULGE)) / (2.0 * WIN_BULGE));
    result = SDF_union(result, vec2<f32>((length((windowFrame.point - (center * ((1.0 + WIN_BULGE) - glassRadius)))) - glassRadius), 2.0));
    result = SDF_union(result, vec2<f32>((length(vec2<f32>((length((w - (h * center))) - 0.114), h)) - 0.017), 3.0));
  }
  let _i8a2 = result.x;
  var _i8ret: vec2<f32>;
  var _i8_y: f32 = -0.73;
  let _i8_hinge = vec2<f32>(sqrt((1.0 - (FLAP_Y * FLAP_Y))), FLAP_Y);
  let _i8_tipLat = (asin(FLAP_Y) - FLAP_LEN);
  let _i8_tip = (_i8_hinge + SDF_rotate((vec2<f32>(cos(_i8_tipLat), sin(_i8_tipLat)) - _i8_hinge), FLAP_OPEN));
  var _i8_bounds: f32 = max(((SDF_segment(l.zy, _i8_hinge, _i8_tip) - FLAP_T) - FLAP_HW), (abs(l.x) - FLAP_HW));
  let _i8_lo = vec3<f32>(-0.1, GROUND, 0.0);
  let _gv0 = (_i8_y + 0.02);
  let _i8_hi = vec3<f32>(0.1, (_gv0 + 0.02), (LEG_R + 0.1));
  let _i8_a0 = (l - (0.5 * (_i8_lo + _i8_hi)));
  let _i8_a1 = (0.5 * (_i8_hi - _i8_lo));
  let _i8_q = (abs(_i8_a0) - _i8_a1);
  let _i8_ret = (length(max(_i8_q, vec3<f32>(0.0))) + min(max(_i8_q.x, max(_i8_q.y, _i8_q.z)), 0.0));
  _i8_bounds = min(_i8_bounds, _i8_ret);
  if ((_i8_bounds > min(_i8a2, 0.1))) {
    _i8ret = vec2<f32>(_i8_bounds, 5.0);
  } else {
    let _i8_c = (l - vec3<f32>(0.0, 0.0, LEG_R));
    var _i8_leg: f32 = (SDF_cylinderY(_i8_c, 0.05, (SHOCK_Y + 0.01), -0.72) - 0.01);
    _i8_leg = min(_i8_leg, SDF_cylinderY(_i8_c, 0.025, (GROUND + 0.05), SHOCK_Y));
    _i8_leg = min(_i8_leg, SDF_capsule(l, vec3<f32>(0.0, _gv0, 0.6), vec3<f32>(0.0, _i8_y, LEG_R), 0.018));
    let _i8_joint = (LEG_R - 0.2);
    let _gv1 = (_i8_y - 0.09);
    _i8_leg = min(_i8_leg, SDF_capsule(l, vec3<f32>(-0.05, _i8_y, 0.6), vec3<f32>(-0.05, _gv1, _i8_joint), 0.018));
    _i8_leg = min(_i8_leg, SDF_capsule(l, vec3<f32>(0.05, _i8_y, 0.6), vec3<f32>(0.05, _gv1, _i8_joint), 0.018));
    _i8_y -= 0.09;
    let _gv6 = (_i8_y + 0.02);
    let _i8_a1_ = vec3<f32>(-0.07, _gv6, _i8_joint);
    let _i8_a2 = vec3<f32>(0.07, _gv6, _i8_joint);
    let _i8_pa = (l - _i8_a1_);
    let _i8_ba = (_i8_a2 - _i8_a1_);
    let _i8_lengthAB = length(_i8_ba);
    let _i8_h = (dot(_i8_pa, _i8_ba) / _i8_lengthAB);
    let _lc0 = (0.5 * _i8_lengthAB);
    let _i8_d = vec2<f32>((length((_i8_pa - (_i8_ba * (_i8_h / _i8_lengthAB)))) - 0.05), (abs((_i8_h - _lc0)) - _lc0));
    let _i8_ret_ = (min(max(_i8_d.x, _i8_d.y), 0.0) + length(max(_i8_d, vec2<f32>(0.0))));
    _i8_leg = min(_i8_leg, _i8_ret_);
    let _gv2 = vec3<f32>(0.05, _gv6, _i8_joint);
    _i8_leg = min(_i8_leg, SDF_capsule(l, _gv2, vec3<f32>(0.05, _i8_y, LEG_R), 0.012));
    let _gv3 = vec3<f32>(-0.05, _gv6, _i8_joint);
    _i8_leg = min(_i8_leg, SDF_capsule(l, _gv3, vec3<f32>(-0.05, _i8_y, LEG_R), 0.012));
    _i8_leg = min(_i8_leg, SDF_capsule(l, _gv2, vec3<f32>(0.05, _i8_y, 0.2), 0.012));
    _i8_leg = min(_i8_leg, SDF_capsule(l, _gv3, vec3<f32>(-0.05, _i8_y, 0.2), 0.012));
    var _i8_result: vec2<f32> = vec2<f32>(_i8_leg, 5.0);
    let _i8_a3 = (GROUND + 0.006);
    let _i8_a4 = (GROUND + 0.064);
    let _i8_halfHeight = (0.5 * (_i8_a4 - _i8_a3));
    let _gv4 = ((_i8_c.y - _i8_a3) - _i8_halfHeight);
    let _i8_q_ = vec2<f32>(length(_i8_c.xz), _gv4);
    let _i8_k1 = vec2<f32>(0.024, _i8_halfHeight);
    let _i8_k2 = vec2<f32>(-0.07, (2.0 * _i8_halfHeight));
    let _i8_ca = vec2<f32>((_i8_q_.x - min(_i8_q_.x, select(0.024, 0.094, (_gv4 < 0.0)))), (abs(_gv4) - _i8_halfHeight));
    let _i8_cb = _flow3_shared(_i8_q_, _i8_k1, _i8_k2);
    let _i8_sign = select(1.0, -1.0, ((_i8_cb.x < 0.0) && (_i8_ca.y < 0.0)));
    let _i8_ret__ = (_i8_sign * sqrt(min(dot(_i8_ca, _i8_ca), dot(_i8_cb, _i8_cb))));
    _i8_result = SDF_union(_i8_result, vec2<f32>((_i8_ret__ - 0.006), 6.0));
    let _i8_home = Ship_flapHome_function(self_, l);
    let _cse1 = (0.5 * FLAP_T);
    let _i8_ret___ = max((abs(((length(_i8_home) - 1.0) + _cse1)) - _cse1), Ship_flapOutline_function(self_, _i8_home));
    _i8_result = SDF_union(_i8_result, vec2<f32>(_i8_ret___, 10.0));
    _i8ret = _i8_result;
  }
  result = SDF_union(result, _i8ret);
  let bellyPoint = (p + vec3<f32>(0.0, BELLY_EXT, 0.0));
  let _i5_width = sqrt((1.0 - (BELLY_Y * BELLY_Y)));
  let _gv5 = (-bellyPoint.y);
  let _i5_q = vec2<f32>(length(bellyPoint.xz), _gv5);
  let _i5_h = (-BELLY_Y);
  let _i5_s = max(((((_i5_h - 1.0) * _i5_q.x) * _i5_q.x) + ((_i5_width * _i5_width) * ((_i5_h + 1.0) - (2.0 * _gv5)))), ((_i5_h * _i5_q.x) - (_i5_width * _gv5)));
  let _i5ret = select(select(length((_i5_q - vec2<f32>(_i5_width, _i5_h))), (_i5_h + bellyPoint.y), (_i5_q.x < _i5_width)), (length(_i5_q) - 1.0), (_i5_s < 0.0));
  result = SDF_union(result, vec2<f32>(_i5ret, select(0.0, 12.0, ((bellyPoint.y - BELLY_Y) > (length(bellyPoint) - 1.0)))));
  result = SDF_union(result, vec2<f32>(SDF_cylinderY(p, SHAFT_R, ((BELLY_Y - BELLY_EXT) - 0.01), (BELLY_Y + 0.05)), 7.0));
  return result;
}

fn Ship_map_value(self_: Ship, p: vec3<f32>) -> vec2<f32> {
  let bound = (length((p - vec3<f32>(0.0, -0.3, 0.0))) - 1.6);
  if ((bound > 0.25)) {
    return vec2<f32>(bound, 0.0);
  }
  let radius = length(p);
  let longitude = atan2(p.x, p.z);
  let horizontalRadius = length(p.xz);
  var legFrame: _spec1_result;
  _spec0_SDF_polarY_into(&legFrame, longitude, horizontalRadius, p.y, self_.legCount, LEG_LON);
  let l = legFrame.point;
  let bay = max(Ship_flapOutline_value(self_, l), (((1.0 - FLAP_T) - BAY_DEPTH) - radius));
  var result: vec2<f32> = select(vec2<f32>((-bay), 11.0), vec2<f32>((radius - 1.0), 0.0), ((radius - 1.0) > (-bay)));
  let _cse0 = (BELLY_Y - p.y);
  result = select(result, vec2<f32>(_cse0, 12.0), (_cse0 > result.x));
  result = SDF_union(result, vec2<f32>(max((radius - 1.022), (abs((p.y - RING_Y)) - RING_H)), 1.0));
  let door = SDF_arch(vec2<f32>((longitude * horizontalRadius), p.y), DOOR_HW, DOOR_Y0, DOOR_Y1);
  result = SDF_union(result, vec2<f32>(max(((radius - 1.0) - DOOR_T), door), 4.0));
  var windowFrame: PolarResult;
  SDF_polarY_into(&windowFrame, longitude, horizontalRadius, p.y, WIN_N, 0.0);
  if ((abs(windowFrame.index) > 0.5)) {
    let center = vec3<f32>(0.0, WIN_Y, sqrt((1.0 - (WIN_Y * WIN_Y))));
    let w = (windowFrame.point - center);
    let h = dot(w, center);
    let glassRadius = (((WIN_A * WIN_A) + (WIN_BULGE * WIN_BULGE)) / (2.0 * WIN_BULGE));
    result = SDF_union(result, vec2<f32>((length((windowFrame.point - (center * ((1.0 + WIN_BULGE) - glassRadius)))) - glassRadius), 2.0));
    result = SDF_union(result, vec2<f32>((length(vec2<f32>((length((w - (h * center))) - 0.114), h)) - 0.017), 3.0));
  }
  let _i8a2 = result.x;
  var _i8ret: vec2<f32>;
  var _i8_y: f32 = -0.73;
  let _i8_hinge = vec2<f32>(sqrt((1.0 - (FLAP_Y * FLAP_Y))), FLAP_Y);
  let _i8_tipLat = (asin(FLAP_Y) - FLAP_LEN);
  let _i8_tip = (_i8_hinge + SDF_rotate((vec2<f32>(cos(_i8_tipLat), sin(_i8_tipLat)) - _i8_hinge), FLAP_OPEN));
  var _i8_bounds: f32 = max(((SDF_segment(l.zy, _i8_hinge, _i8_tip) - FLAP_T) - FLAP_HW), (abs(l.x) - FLAP_HW));
  let _i8_lo = vec3<f32>(-0.1, GROUND, 0.0);
  let _gv0 = (_i8_y + 0.02);
  let _i8_hi = vec3<f32>(0.1, (_gv0 + 0.02), (LEG_R + 0.1));
  let _i8_a0 = (l - (0.5 * (_i8_lo + _i8_hi)));
  let _i8_a1 = (0.5 * (_i8_hi - _i8_lo));
  let _i8_q = (abs(_i8_a0) - _i8_a1);
  let _i8_ret = (length(max(_i8_q, vec3<f32>(0.0))) + min(max(_i8_q.x, max(_i8_q.y, _i8_q.z)), 0.0));
  _i8_bounds = min(_i8_bounds, _i8_ret);
  if ((_i8_bounds > min(_i8a2, 0.1))) {
    _i8ret = vec2<f32>(_i8_bounds, 5.0);
  } else {
    let _i8_c = (l - vec3<f32>(0.0, 0.0, LEG_R));
    var _i8_leg: f32 = (SDF_cylinderY(_i8_c, 0.05, (SHOCK_Y + 0.01), -0.72) - 0.01);
    _i8_leg = min(_i8_leg, SDF_cylinderY(_i8_c, 0.025, (GROUND + 0.05), SHOCK_Y));
    _i8_leg = min(_i8_leg, SDF_capsule(l, vec3<f32>(0.0, _gv0, 0.6), vec3<f32>(0.0, _i8_y, LEG_R), 0.018));
    let _i8_joint = (LEG_R - 0.2);
    let _gv1 = (_i8_y - 0.09);
    _i8_leg = min(_i8_leg, SDF_capsule(l, vec3<f32>(-0.05, _i8_y, 0.6), vec3<f32>(-0.05, _gv1, _i8_joint), 0.018));
    _i8_leg = min(_i8_leg, SDF_capsule(l, vec3<f32>(0.05, _i8_y, 0.6), vec3<f32>(0.05, _gv1, _i8_joint), 0.018));
    _i8_y -= 0.09;
    let _gv6 = (_i8_y + 0.02);
    let _i8_a1_ = vec3<f32>(-0.07, _gv6, _i8_joint);
    let _i8_a2 = vec3<f32>(0.07, _gv6, _i8_joint);
    let _i8_pa = (l - _i8_a1_);
    let _i8_ba = (_i8_a2 - _i8_a1_);
    let _i8_lengthAB = length(_i8_ba);
    let _i8_h = (dot(_i8_pa, _i8_ba) / _i8_lengthAB);
    let _lc0 = (0.5 * _i8_lengthAB);
    let _i8_d = vec2<f32>((length((_i8_pa - (_i8_ba * (_i8_h / _i8_lengthAB)))) - 0.05), (abs((_i8_h - _lc0)) - _lc0));
    let _i8_ret_ = (min(max(_i8_d.x, _i8_d.y), 0.0) + length(max(_i8_d, vec2<f32>(0.0))));
    _i8_leg = min(_i8_leg, _i8_ret_);
    let _gv2 = vec3<f32>(0.05, _gv6, _i8_joint);
    _i8_leg = min(_i8_leg, SDF_capsule(l, _gv2, vec3<f32>(0.05, _i8_y, LEG_R), 0.012));
    let _gv3 = vec3<f32>(-0.05, _gv6, _i8_joint);
    _i8_leg = min(_i8_leg, SDF_capsule(l, _gv3, vec3<f32>(-0.05, _i8_y, LEG_R), 0.012));
    _i8_leg = min(_i8_leg, SDF_capsule(l, _gv2, vec3<f32>(0.05, _i8_y, 0.2), 0.012));
    _i8_leg = min(_i8_leg, SDF_capsule(l, _gv3, vec3<f32>(-0.05, _i8_y, 0.2), 0.012));
    var _i8_result: vec2<f32> = vec2<f32>(_i8_leg, 5.0);
    let _i8_a3 = (GROUND + 0.006);
    let _i8_a4 = (GROUND + 0.064);
    let _i8_halfHeight = (0.5 * (_i8_a4 - _i8_a3));
    let _gv4 = ((_i8_c.y - _i8_a3) - _i8_halfHeight);
    let _i8_q_ = vec2<f32>(length(_i8_c.xz), _gv4);
    let _i8_k1 = vec2<f32>(0.024, _i8_halfHeight);
    let _i8_k2 = vec2<f32>(-0.07, (2.0 * _i8_halfHeight));
    let _i8_ca = vec2<f32>((_i8_q_.x - min(_i8_q_.x, select(0.024, 0.094, (_gv4 < 0.0)))), (abs(_gv4) - _i8_halfHeight));
    let _i8_cb = _flow3_shared(_i8_q_, _i8_k1, _i8_k2);
    let _i8_sign = select(1.0, -1.0, ((_i8_cb.x < 0.0) && (_i8_ca.y < 0.0)));
    let _i8_ret__ = (_i8_sign * sqrt(min(dot(_i8_ca, _i8_ca), dot(_i8_cb, _i8_cb))));
    _i8_result = SDF_union(_i8_result, vec2<f32>((_i8_ret__ - 0.006), 6.0));
    let _i8_home = Ship_flapHome_value(self_, l);
    let _cse1 = (0.5 * FLAP_T);
    let _i8_ret___ = max((abs(((length(_i8_home) - 1.0) + _cse1)) - _cse1), Ship_flapOutline_value(self_, _i8_home));
    _i8_result = SDF_union(_i8_result, vec2<f32>(_i8_ret___, 10.0));
    _i8ret = _i8_result;
  }
  result = SDF_union(result, _i8ret);
  let bellyPoint = (p + vec3<f32>(0.0, BELLY_EXT, 0.0));
  let _i5_width = sqrt((1.0 - (BELLY_Y * BELLY_Y)));
  let _gv5 = (-bellyPoint.y);
  let _i5_q = vec2<f32>(length(bellyPoint.xz), _gv5);
  let _i5_h = (-BELLY_Y);
  let _i5_s = max(((((_i5_h - 1.0) * _i5_q.x) * _i5_q.x) + ((_i5_width * _i5_width) * ((_i5_h + 1.0) - (2.0 * _gv5)))), ((_i5_h * _i5_q.x) - (_i5_width * _gv5)));
  let _i5ret = select(select(length((_i5_q - vec2<f32>(_i5_width, _i5_h))), (_i5_h + bellyPoint.y), (_i5_q.x < _i5_width)), (length(_i5_q) - 1.0), (_i5_s < 0.0));
  result = SDF_union(result, vec2<f32>(_i5ret, select(0.0, 12.0, ((bellyPoint.y - BELLY_Y) > (length(bellyPoint) - 1.0)))));
  result = SDF_union(result, vec2<f32>(SDF_cylinderY(p, SHAFT_R, ((BELLY_Y - BELLY_EXT) - 0.01), (BELLY_Y + 0.05)), 7.0));
  return result;
}

fn NamekTree_map_function(self_: ptr<function, NamekTree>, p: vec3<f32>) -> vec2<f32> {
  let q = (p - vec3<f32>((*self_).position.x, GROUND, (*self_).position.y));
  let _cse0 = (0.5 * (*self_).height);
  let bound = (((length((q - vec3<f32>(0.0, _cse0, 0.0))) - _cse0) - (*self_).radius) - 0.1);
  if ((bound > 0.2)) {
    return vec2<f32>(bound, 8.0);
  }
  let taper = mix(0.018, 0.012, clamp((q.y / (*self_).height), 0.0, 1.0));
  let trunk = (length(vec2<f32>(length(q.xz), (q.y - clamp(q.y, -0.2, (*self_).height)))) - taper);
  let canopyCenter = (q - vec3<f32>(0.0, (*self_).height, 0.0));
  let _gv0 = length(canopyCenter);
  let normal = (canopyCenter / (_gv0 + 0.0001));
  let bump = ((sin(((9.0 * normal.x) + 1.0)) * sin(((9.0 * normal.y) + 2.0))) * sin(((9.0 * normal.z) + 3.0)));
  let leaves = ((_gv0 - ((*self_).radius * (1.0 + (0.07 * bump)))) * 0.8);
  return SDF_union(vec2<f32>(trunk, 8.0), vec2<f32>(leaves, 9.0));
}

fn NamekTree_map_value(self_: NamekTree, p: vec3<f32>) -> vec2<f32> {
  let q = (p - vec3<f32>(self_.position.x, GROUND, self_.position.y));
  let _cse0 = (0.5 * self_.height);
  let bound = (((length((q - vec3<f32>(0.0, _cse0, 0.0))) - _cse0) - self_.radius) - 0.1);
  if ((bound > 0.2)) {
    return vec2<f32>(bound, 8.0);
  }
  let taper = mix(0.018, 0.012, clamp((q.y / self_.height), 0.0, 1.0));
  let trunk = (length(vec2<f32>(length(q.xz), (q.y - clamp(q.y, -0.2, self_.height)))) - taper);
  let canopyCenter = (q - vec3<f32>(0.0, self_.height, 0.0));
  let _gv0 = length(canopyCenter);
  let normal = (canopyCenter / (_gv0 + 0.0001));
  let bump = ((sin(((9.0 * normal.x) + 1.0)) * sin(((9.0 * normal.y) + 2.0))) * sin(((9.0 * normal.z) + 3.0)));
  let leaves = ((_gv0 - (self_.radius * (1.0 + (0.07 * bump)))) * 0.8);
  return SDF_union(vec2<f32>(trunk, 8.0), vec2<f32>(leaves, 9.0));
}

fn NamekTree_shadowRadius_function(self_: ptr<function, NamekTree>) -> f32 {
  return (((0.5 * (*self_).height) + (*self_).radius) + 0.1);
}

fn NamekTree_shadowRadius_value(self_: NamekTree) -> f32 {
  return (((0.5 * self_.height) + self_.radius) + 0.1);
}

fn NamekTree_shadowCenter_function(self_: ptr<function, NamekTree>) -> vec3<f32> {
  return vec3<f32>((*self_).position.x, (GROUND + (0.5 * (*self_).height)), (*self_).position.y);
}

fn NamekTree_shadowCenter_value(self_: NamekTree) -> vec3<f32> {
  return vec3<f32>(self_.position.x, (GROUND + (0.5 * self_.height)), self_.position.y);
}

fn NamekTrees_map_function(self_: ptr<function, NamekTrees>, p: vec3<f32>) -> vec2<f32> {
  var result: vec2<f32> = NamekTree_map_function(&(*self_).first, p);
  result = SDF_union(result, NamekTree_map_function(&(*self_).second, p));
  return result;
}

fn NamekTrees_map_value(self_: NamekTrees, p: vec3<f32>) -> vec2<f32> {
  var result: vec2<f32> = NamekTree_map_value(self_.first, p);
  result = SDF_union(result, NamekTree_map_value(self_.second, p));
  return result;
}

fn NamekTrees_sphereExit_function(self_: ptr<function, NamekTrees>, ro: vec3<f32>, rd: vec3<f32>, center: vec3<f32>, radius: f32) -> f32 {
  let oc = (ro - center);
  let b = dot(oc, rd);
  let h = (((b * b) - dot(oc, oc)) + (radius * radius));
  return select(0.0, ((-b) + sqrt(h)), (h > 0.0));
}

fn NamekTrees_sphereExit_value(self_: NamekTrees, ro: vec3<f32>, rd: vec3<f32>, center: vec3<f32>, radius: f32) -> f32 {
  let oc = (ro - center);
  let b = dot(oc, rd);
  let h = (((b * b) - dot(oc, oc)) + (radius * radius));
  return select(0.0, ((-b) + sqrt(h)), (h > 0.0));
}

fn ShipDetails_tickRow(self_: ptr<function, ShipDetails>, q: vec2<f32>, seed: vec2<f32>, n: i32, gap: f32, len: f32, bend: f32, curl: f32, spread: f32, lw: f32) -> f32 {
  let _licm0 = max((-bend), 0.0);
  let _licm1 = (0.4 * gap);
  let _licm2 = (0.35 * len);
  let mid = (0.5 * f32((n - 1)));
  let radius = (((2.0 * mid) * gap) / PI);
  let bendSign = select(1.0, -1.0, (bend < 0.0));
  var distance: f32 = 1000000000.0;
  for (var k: i32 = 0; (k < 9); k = (k + 1)) {
    if ((k >= n)) {
      break;
    }
    let _gv1 = f32(k);
    let _gv0 = (_gv1 - mid);
    let fk = (_gv0 / mid);
    let h = vec4<f32>(Noise_hash12(((seed + (_gv1 * 3.1)) + 51.0)), Noise_hash12(((seed + (_gv1 * 5.7)) + 63.0)), Noise_hash12(((seed + (_gv1 * 2.3)) + 77.0)), Noise_hash12(((seed + (_gv1 * 4.9)) + 89.0)));
    var base: vec2<f32> = vec2<f32>((gap * _gv0), (((bend * fk) * fk) + _licm0));
    base = _flow9_shared(base, radius, fk, bendSign, curl);
    base += vec2<f32>((_licm1 * (h.x - 0.5)), (_licm2 * h.y));
    let bladeLength = (len * (1.0 - (spread * Noise_hash12(((seed + (_gv1 * 6.1)) + 97.0)))));
    let angle = (0.5 * (h.z - 0.5));
    distance = min(distance, (SDF_segment(q, base, (base + (bladeLength * vec2<f32>(sin(angle), cos(angle))))) - ((0.5 + h.w) * lw)));
  }
  return distance;
}

fn ShipDetails_scuffInk(self_: ptr<function, ShipDetails>, p: vec3<f32>, t: f32, lineA: f32, aa: f32) -> f32 {
  let cellA = max(sqrt((0.6 / SCUFFS)), 0.12);
  let fill = ((SCUFFS * cellA) * cellA);
  let normal = normalize(p);
  let lat = asin(clamp(normal.y, -1.0, 1.0));
  let lon = atan2(normal.x, normal.z);
  let lw = ((0.2 * lineA) * t);
  var distance: f32 = 1000000000.0;
  for (var j: i32 = -1; (j <= 1); j = (j + 1)) {
    let ring = (floor((lat / cellA)) + f32(j));
    let ringCells = max(1.0, floor(((TAU * cos(((ring + 0.5) * cellA))) / cellA)));
    let deltaAngle = (TAU / ringCells);
    for (var i: i32 = -1; (i <= 1); i = (i + 1)) {
      let cell = vec2<f32>(_mod_f32((floor((lon / deltaAngle)) + f32(i)), ringCells), ring);
      if ((Noise_hash12(((cell * 1.17) + 3.9)) > fill)) {
        continue;
      }
      let g = vec4<f32>(Noise_hash12((cell + 7.3)), Noise_hash12((cell + 19.1)), Noise_hash12((cell + 23.9)), Noise_hash12((cell + 37.3)));
      let cellLat = (((ring + 0.25) + (0.5 * g.x)) * cellA);
      let cellLon = (((cell.x + 0.25) + (0.5 * g.y)) * deltaAngle);
      let _lc0 = cos(cellLat);
      let _gv0 = sin(cellLon);
      let _gv1 = cos(cellLon);
      let _gv2 = (_lc0 * _gv0);
      let _gv3 = (_lc0 * _gv1);
      let center = vec3<f32>(_gv2, sin(cellLat), _gv3);
      let east = vec3<f32>(_gv1, 0.0, (-_gv0));
      let _lc1 = (normal - center);
      let local = SDF_rotate(vec2<f32>(dot(_lc1, east), dot(_lc1, cross(center, east))), (2.4 * (g.z - 0.5)));
      if ((dot(local, local) > 0.0225)) {
        continue;
      }
      let hatchTest = SDF_arch(vec2<f32>((atan2(_gv2, _gv3) * length(center.xz)), center.y), DOOR_HW, DOOR_Y0, DOOR_Y1);
      if ((hatchTest < 0.15)) {
        continue;
      }
      let h = vec4<f32>(Noise_hash12((cell + 41.7)), Noise_hash12((cell + 53.3)), Noise_hash12((cell + 67.1)), Noise_hash12((cell + 79.9)));
      let count = (2 + i32((7.0 * g.w)));
      let gap = (0.016 * (0.75 + (0.5 * h.x)));
      let len = (0.001 + ((0.044 * h.y) * h.y));
      let bend = ((((0.6 * gap) * 0.5) * f32((count - 1))) * ((2.0 * h.z) - 1.0));
      let curl = step(0.85, h.w);
      distance = min(distance, ShipDetails_tickRow(self_, local, (cell + 101.0), count, gap, len, bend, curl, 0.7, lw));
    }
  }
  return (1.0 - smoothstep((-aa), aa, distance));
}

fn Lettering_rect(self_: ptr<function, Lettering>, p: vec2<f32>, x0: f32, y0: f32, x1: f32, y1: f32) -> f32 {
  let _i2a0 = (p - (0.5 * vec2<f32>((x0 + x1), (y0 + y1))));
  let _i2a1 = (0.5 * vec2<f32>((x1 - x0), (y1 - y0)));
  let _i2_q = (abs(_i2a0) - _i2a1);
  let _i2ret = (length(max(_i2_q, vec2<f32>(0.0))) + min(max(_i2_q.x, _i2_q.y), 0.0));
  return _i2ret;
}

fn Lettering_arc(self_: ptr<function, Lettering>, p: vec2<f32>, center: vec2<f32>, radius: f32, start: f32, end: f32) -> f32 {
  let q = (p - center);
  if ((_mod_f32((atan2(q.y, q.x) - start), TAU) < (end - start))) {
    return (abs((length(q) - radius)) - (*self_).strokeWidth);
  }
  return (min(length((q - (radius * vec2<f32>(cos(start), sin(start))))), length((q - (radius * vec2<f32>(cos(end), sin(end)))))) - (*self_).strokeWidth);
}

fn Lettering_glyph(self_: ptr<function, Lettering>, p: vec2<f32>, glyphId: i32) -> f32 {
  var d: f32 = 0.0;
  let _cse0 = (glyphId == 8);
  if ((glyphId == 0)) {
    d = min(Lettering_arc(self_, p, vec2<f32>(0.0, 0.2), 0.215, 0.5, PI), Lettering_arc(self_, p, vec2<f32>(0.0, -0.2), 0.215, PI, (TAU - 0.5)));
    d = min(d, Lettering_rect(self_, p, -0.3, -0.2, -0.13, 0.2));
  } else if ((glyphId == 1)) {
    d = min((SDF_segment(p, vec2<f32>(-0.245, -0.6), vec2<f32>(-0.01, 0.6)) - (*self_).strokeWidth), (SDF_segment(p, vec2<f32>(0.245, -0.6), vec2<f32>(0.01, 0.6)) - (*self_).strokeWidth));
    d = min(d, Lettering_rect(self_, p, -0.16, -0.22, 0.16, -0.06));
  } else if (((glyphId == 2) || _cse0)) {
    d = min(Lettering_rect(self_, p, -0.28, -0.5, -0.11, 0.5), Lettering_rect(self_, p, -0.28, 0.33, 0.0, 0.5));
    d = min(d, Lettering_rect(self_, p, -0.28, -0.08, 0.0, 0.09));
    d = min(d, Lettering_arc(self_, p, vec2<f32>(0.0, 0.205), 0.21, (-0.5 * PI), (0.5 * PI)));
    if (_cse0) {
      d = min(d, (SDF_segment(p, vec2<f32>(0.0, 0.0), vec2<f32>(0.24, -0.6)) - (*self_).strokeWidth));
    }
  } else if ((glyphId == 3)) {
    d = min(Lettering_arc(self_, p, vec2<f32>(0.0, 0.2075), 0.2075, 0.4, (1.5 * PI)), Lettering_arc(self_, p, vec2<f32>(0.0, -0.2075), 0.2075, (PI + 0.4), (2.5 * PI)));
  } else if ((glyphId == 4)) {
    d = min(Lettering_rect(self_, p, -0.3, -0.2, -0.13, 0.5), Lettering_rect(self_, p, 0.13, -0.2, 0.3, 0.5));
    d = min(d, Lettering_arc(self_, p, vec2<f32>(0.0, -0.2), 0.215, PI, TAU));
  } else if ((glyphId == 5)) {
    d = min(Lettering_rect(self_, p, -0.27, -0.5, -0.1, 0.5), Lettering_rect(self_, p, -0.27, -0.5, 0.26, -0.33));
  } else if ((glyphId == 6)) {
    d = min(Lettering_rect(self_, p, -0.27, -0.5, -0.1, 0.5), Lettering_rect(self_, p, -0.27, 0.33, 0.26, 0.5));
    d = min(d, min(Lettering_rect(self_, p, -0.27, -0.085, 0.2, 0.085), Lettering_rect(self_, p, -0.27, -0.5, 0.26, -0.33)));
  } else if ((glyphId == 7)) {
    d = (abs((length(vec2<f32>(p.x, (p.y - clamp(p.y, -0.2, 0.2)))) - 0.215)) - (*self_).strokeWidth);
  } else {
    d = (length((p - vec2<f32>(-0.26, -0.4))) - 0.1);
  }
  return max(d, (abs(p.y) - 0.5));
}

fn ShipMaterial_celShadow_function_function(ro: vec3<f32>, rd: vec3<f32>, ship: ptr<function, Ship>, trees: ptr<function, NamekTrees>) -> f32 {
  let _i17a2 = vec3<f32>(0.0, -0.3, 0.0);
  let _i17_oc = (ro - _i17a2);
  let _i17_b = dot(_i17_oc, rd);
  let _i17_h = (((_i17_b * _i17_b) - dot(_i17_oc, _i17_oc)) + 4.0);
  let _i17ret = select(0.0, ((-_i17_b) + sqrt(_i17_h)), (_i17_h > 0.0));
  var tmax: f32 = _i17ret;
  let _i10_firstExit = NamekTrees_sphereExit_function(trees, ro, rd, NamekTree_shadowCenter_function(&(*trees).first), NamekTree_shadowRadius_function(&(*trees).first));
  let _i10_secondExit = NamekTrees_sphereExit_function(trees, ro, rd, NamekTree_shadowCenter_function(&(*trees).second), NamekTree_shadowRadius_function(&(*trees).second));
  let _i10ret = max(tmax, max(_i10_firstExit, _i10_secondExit));
  tmax = _i10ret;
  tmax = min(tmax, 9.0);
  if ((tmax < 0.02)) {
    return 1.0;
  }
  var result: f32 = 1.0;
  var t: f32 = 0.02;
  for (var i: i32 = 0; (i < 64); i = (i + 1)) {
    let _i18a0 = (ro + (rd * t));
    var _i18_result: vec2<f32> = Ship_map_function(ship, _i18a0);
    _i18_result = SDF_union(_i18_result, NamekTrees_map_function(trees, _i18a0));
    let h = _i18_result.x;
    result = min(result, ((10.0 * h) / t));
    t += clamp(h, 0.01, 0.3);
    if (((result < 0.0) || (t > tmax))) {
      break;
    }
  }
  return smoothstep(0.25, 0.4, result);
}

fn ShipMaterial_celShadow_value_value(ro: vec3<f32>, rd: vec3<f32>, ship: Ship, trees: NamekTrees) -> f32 {
  let _i17a2 = vec3<f32>(0.0, -0.3, 0.0);
  let _i17_oc = (ro - _i17a2);
  let _i17_b = dot(_i17_oc, rd);
  let _i17_h = (((_i17_b * _i17_b) - dot(_i17_oc, _i17_oc)) + 4.0);
  let _i17ret = select(0.0, ((-_i17_b) + sqrt(_i17_h)), (_i17_h > 0.0));
  var tmax: f32 = _i17ret;
  let _i10_firstExit = NamekTrees_sphereExit_value(trees, ro, rd, NamekTree_shadowCenter_value(trees.first), NamekTree_shadowRadius_value(trees.first));
  let _i10_secondExit = NamekTrees_sphereExit_value(trees, ro, rd, NamekTree_shadowCenter_value(trees.second), NamekTree_shadowRadius_value(trees.second));
  let _i10ret = max(tmax, max(_i10_firstExit, _i10_secondExit));
  tmax = _i10ret;
  tmax = min(tmax, 9.0);
  if ((tmax < 0.02)) {
    return 1.0;
  }
  var result: f32 = 1.0;
  var t: f32 = 0.02;
  for (var i: i32 = 0; (i < 64); i = (i + 1)) {
    let _i18a0 = (ro + (rd * t));
    var _i18_result: vec2<f32> = Ship_map_value(ship, _i18a0);
    _i18_result = SDF_union(_i18_result, NamekTrees_map_value(trees, _i18a0));
    let h = _i18_result.x;
    result = min(result, ((10.0 * h) / t));
    t += clamp(h, 0.01, 0.3);
    if (((result < 0.0) || (t > tmax))) {
      break;
    }
  }
  return smoothstep(0.25, 0.4, result);
}

fn Terrain_coast(x: vec2<f32>) -> f32 {
  return ((length(x) - COAST_R) - (7.0 * (Noise_fbm(((x * 0.09) + 7.0)) - 0.5)));
}

fn Terrain_mesaField(x: vec2<f32>) -> f32 {
  var field: f32 = (Noise_fbm(((x * 0.05) + vec2<f32>(4.3, -2.1))) + (0.04 * Noise_value((x * 0.8))));
  field -= (0.4 * (1.0 - smoothstep(MESA_R, 30.0, length(x))));
  field += (0.25 * (1.0 - smoothstep(3.0, 9.0, length((x - vec2<f32>(-21.0, -22.0))))));
  return field;
}

fn Terrain_heightAt(x: vec2<f32>) -> f32 {
  let field = Terrain_mesaField(x);
  return ((GROUND + (1.3 * smoothstep(0.63, 0.64, field))) + (0.55 * smoothstep(0.71, 0.72, field)));
}

fn Terrain_normal(x: vec2<f32>, t: f32) -> vec3<f32> {
  let stepSize = (0.02 + (0.002 * t));
  let gradient = vec2<f32>(0.0);
  let gradient_1 = (gradient - (CROSS[0] * Terrain_heightAt((x + (stepSize * CROSS[0])))));
  let gradient_2 = (gradient_1 - (CROSS[1] * Terrain_heightAt((x + (stepSize * CROSS[1])))));
  let gradient_3 = (gradient_2 - (CROSS[2] * Terrain_heightAt((x + (stepSize * CROSS[2])))));
  let gradient_4 = (gradient_3 - (CROSS[3] * Terrain_heightAt((x + (stepSize * CROSS[3])))));
  return normalize(vec3<f32>(gradient_4.x, (2.0 * stepSize), gradient_4.y));
}

fn Terrain_march(ro: vec3<f32>, rd: vec3<f32>, tmax: f32) -> f32 {
  let _licm0 = (rd.y > 0.0);
  let ceil = (GROUND + 1.9);
  let planeT = select(10000000000.0, ((GROUND - ro.y) / rd.y), (rd.y < 0.0));
  let a = max(dot(rd.xz, rd.xz), 0.000001);
  let b = dot(ro.xz, rd.xz);
  let c = (dot(ro.xz, ro.xz) - (MESA_R * MESA_R));
  var t: f32 = (((-b) + sqrt(max(((b * b) - (a * c)), 0.0))) / a);
  let end = min(planeT, tmax);
  var previousT: f32 = t;
  for (var i: i32 = 0; (i < 200); i = (i + 1)) {
    if ((t > end)) {
      break;
    }
    let p = (ro + (rd * t));
    if (((p.y > ceil) && _licm0)) {
      break;
    }
    let clearance = (p.y - Terrain_heightAt(p.xz));
    if ((clearance < 0.0)) {
      for (var j: i32 = 0; (j < 6); j = (j + 1)) {
        let middle = (0.5 * (previousT + t));
        let q = (ro + (rd * middle));
        let _ifc0 = (q.y < Terrain_heightAt(q.xz));
        t = select(t, middle, _ifc0);
        previousT = select(middle, previousT, _ifc0);
      }
      return (0.5 * (previousT + t));
    }
    previousT = t;
    t += max((0.3 * clearance), (0.02 + (0.015 * t)));
  }
  return select(-1.0, planeT, (planeT < tmax));
}

fn Terrain_groundWarp(x: vec2<f32>) -> vec2<f32> {
  let _cse0 = (x * 0.8);
  let q = vec2<f32>(Noise_fbm((_cse0 + 2.0)), Noise_fbm((_cse0 + 8.3)));
  let _cse1 = (x * 1.6);
  let _lc0 = (_cse1 + (3.0 * q));
  return (x + (1.2 * (vec2<f32>(Noise_fbm((_lc0 + 1.7)), Noise_fbm((_lc0 + 9.2))) - 0.5)));
}

fn Terrain_dirtField(xw: vec2<f32>) -> f32 {
  return (Noise_fbm(((xw * 0.7) + vec2<f32>(-13.7, 31.9))) - 0.62);
}

fn Terrain_grassInk(x: vec2<f32>, ro: vec3<f32>, t: f32, pixA: f32, lineA: f32) -> f32 {
  let _licm0 = ro.xz;
  let _licm1 = (0.14 * lineA);
  let _licm2 = (0.7 * pixA);
  if ((t > 12.0)) {
    return 0.0;
  }
  let eye = (ro.y - GROUND);
  let view = (x - _licm0);
  let distanceToPoint = length(view);
  let forward = (view / distanceToPoint);
  let side = vec2<f32>((-forward.y), forward.x);
  let reach = (((distanceToPoint * 2.2) * 0.015) / eye);
  let centerCell = floor(((x - ((0.5 * reach) * forward)) / 0.4));
  var ink: f32 = 0.0;
  for (var j: i32 = -1; (j <= 1); j = (j + 1)) {
    for (var i: i32 = -1; (i <= 1); i = (i + 1)) {
      let cell = (centerCell + vec2<f32>(f32(i), f32(j)));
      if ((Noise_hash12(((cell * 1.31) + 5.7)) > 0.55)) {
        continue;
      }
      let center = (((cell + 0.2) + (0.6 * vec2<f32>(Noise_hash12((cell + 7.3)), Noise_hash12((cell + 19.1))))) * 0.4);
      let alongRay = dot((center - _licm0), forward);
      if (((alongRay > distanceToPoint) || (alongRay < (distanceToPoint - reach)))) {
        continue;
      }
      let local = vec2<f32>(dot((_licm0 - center), side), (eye * (1.0 - (alongRay / distanceToPoint))));
      if ((abs(local.x) > 0.1)) {
        continue;
      }
      if (((Terrain_dirtField(Terrain_groundWarp(center)) > -0.04) || (Terrain_coast(center) > -0.8))) {
        continue;
      }
      let count = (3 + i32((5.0 * Noise_hash12((cell + 31.7)))));
      let bend = (0.010499999999999999 * ((2.0 * Noise_hash12((cell + 43.1))) - 1.0));
      let rowT = ((t * alongRay) / distanceToPoint);
      let lw = (_licm1 * rowT);
      let aa = (_licm2 * rowT);
      let distance = Terrain_tickRow(local, cell, count, 0.02, 0.015, bend, 0.0, 0.0, lw);
      ink = max(ink, (1.0 - smoothstep((-aa), aa, distance)));
    }
  }
  return (ink * (1.0 - smoothstep(8.0, 12.0, t)));
}

fn Terrain_tickRow(q: vec2<f32>, seed: vec2<f32>, n: i32, gap: f32, len: f32, bend: f32, curl: f32, spread: f32, lw: f32) -> f32 {
  let _licm0 = max((-bend), 0.0);
  let _licm1 = (0.4 * gap);
  let _licm2 = (0.35 * len);
  let mid = (0.5 * f32((n - 1)));
  let radius = (((2.0 * mid) * gap) / PI);
  let signBend = select(1.0, -1.0, (bend < 0.0));
  var distance: f32 = 1000000000.0;
  for (var k: i32 = 0; (k < 9); k = (k + 1)) {
    if ((k >= n)) {
      break;
    }
    let _gv1 = f32(k);
    let _gv0 = (_gv1 - mid);
    let fk = (_gv0 / mid);
    let h = vec4<f32>(Noise_hash12(((seed + (_gv1 * 3.1)) + 51.0)), Noise_hash12(((seed + (_gv1 * 5.7)) + 63.0)), Noise_hash12(((seed + (_gv1 * 2.3)) + 77.0)), Noise_hash12(((seed + (_gv1 * 4.9)) + 89.0)));
    var base: vec2<f32> = vec2<f32>((gap * _gv0), (((bend * fk) * fk) + _licm0));
    base = _flow9_shared(base, radius, fk, signBend, curl);
    base += vec2<f32>((_licm1 * (h.x - 0.5)), (_licm2 * h.y));
    let bladeLength = (len * (1.0 - (spread * Noise_hash12(((seed + (_gv1 * 6.1)) + 97.0)))));
    let angle = (0.5 * (h.z - 0.5));
    distance = min(distance, (SDF_segment(q, base, (base + (bladeLength * vec2<f32>(sin(angle), cos(angle))))) - ((0.5 + h.w) * lw)));
  }
  return distance;
}

fn Terrain_brush(a: vec2<f32>, m: vec2<f32>, b: vec2<f32>, width: f32, taper: f32) -> f32 {
  let ma = (m - a);
  let bm = (b - m);
  let h1 = clamp(((-dot(a, ma)) / max(dot(ma, ma), 0.000001)), 0.0, 1.0);
  let h2 = clamp(((-dot(m, bm)) / max(dot(bm, bm), 0.000001)), 0.0, 1.0);
  let d1 = length((a + (ma * h1)));
  let d2 = length((m + (bm * h2)));
  let along = select((0.5 + (0.5 * h2)), (0.5 * h1), (d1 < d2));
  return (min(d1, d2) - (width * mix(1.0, (0.3 + (0.7 * sqrt(sin((PI * along))))), taper)));
}

fn Terrain_dirtStrokes(x: vec2<f32>, eye: vec2<f32>, jacobian: mat2x2<f32>, lw: f32) -> f32 {
  let _licm0 = (3.2 * lw);
  let _licm1 = (2.0 * lw);
  let _licm2 = (0.95 * lw);
  let centerCell = floor((x * 2.0));
  var distance: f32 = 1000000000.0;
  for (var j: i32 = -1; (j <= 1); j = (j + 1)) {
    for (var i: i32 = -1; (i <= 1); i = (i + 1)) {
      let cell = (centerCell + vec2<f32>(f32(i), f32(j)));
      if ((Noise_hash12(((cell * 1.71) + 2.3)) > 0.35)) {
        continue;
      }
      let g = vec4<f32>(Noise_hash12((cell + 11.3)), Noise_hash12((cell + 23.7)), Noise_hash12((cell + 31.1)), 0.0);
      let h = vec4<f32>(Noise_hash12((cell + 53.1)), Noise_hash12((cell + 61.9)), Noise_hash12((cell + 71.3)), Noise_hash12((cell + 83.7)));
      let center = (((cell + 0.25) + (0.5 * g.xy)) * 0.5);
      let view = normalize((center - eye));
      let direction = SDF_rotate(vec2<f32>((-view.y), view.x), (DIRT_TILT + (0.35 * (g.z - 0.5))));
      let centerPixels = (jacobian * (center - x));
      let directionPixels = (jacobian * direction);
      let directionLength = length(directionPixels);
      let perpendicular = (vec2<f32>((-directionPixels.y), directionPixels.x) / directionLength);
      let spacing = (0.12 + (0.025 * h.z));
      let screenSpacing = max((spacing * abs(dot((jacobian * vec2<f32>((-direction.y), direction.x)), perpendicular))), _licm0);
      if ((length(centerPixels) > (((0.35 * directionLength) + (2.0 * screenSpacing)) + _licm1))) {
        continue;
      }
      if (((Terrain_dirtField(Terrain_groundWarp(center)) < 0.015) || (Terrain_coast(center) > -1.5))) {
        continue;
      }
      let count = (2 + i32(((2.2 * h.y) * h.y)));
      let shift = (0.06 * (h.w - 0.5));
      let bow = (0.2 * (h.x - 0.5));
      for (var k: i32 = 0; (k < 4); k = (k + 1)) {
        if ((k >= count)) {
          break;
        }
        let _gv0 = f32(k);
        let offset = (_gv0 - (0.5 * f32((count - 1))));
        let halfLength = (0.18 * (0.3 + (0.7 * Noise_hash12(((cell + (_gv0 * 7.3)) + 91.0)))));
        let position = ((centerPixels + ((perpendicular * offset) * screenSpacing)) + (directionPixels * ((offset * shift) + (0.06 * (Noise_hash12(((cell + (_gv0 * 5.1)) + 97.0)) - 0.5)))));
        let _lc0 = (directionPixels * halfLength);
        distance = min(distance, Terrain_brush((position - _lc0), (position + (((perpendicular * bow) * halfLength) * directionLength)), (position + _lc0), _licm2, 1.0));
      }
    }
  }
  return distance;
}

fn Terrain_dirtDots(x: vec2<f32>, eye: vec2<f32>, jacobian: mat2x2<f32>, lw: f32) -> f32 {
  let _licm0 = ((16.0 * lw) * lw);
  let centerCell = floor((x / 0.16));
  let crowd = min(1.0, ((0.0256 * abs(determinant(jacobian))) / ((60.0 * lw) * lw)));
  var distance: f32 = 1000000000.0;
  for (var j: i32 = -1; (j <= 1); j = (j + 1)) {
    for (var i: i32 = -1; (i <= 1); i = (i + 1)) {
      let cell = (centerCell + vec2<f32>(f32(i), f32(j)));
      let g = vec4<f32>(Noise_hash12((cell + 5.9)), Noise_hash12((cell + 17.3)), Noise_hash12((cell + 29.5)), Noise_hash12((cell + 43.1)));
      let center = (((cell + 0.1) + (0.8 * g.xy)) * 0.16);
      let probability = (0.03 + (0.7 * smoothstep(0.5, 0.72, Noise_value(((center * 2.2) + 71.0)))));
      if ((Noise_hash12(((cell * 1.37) + 9.1)) > (probability * crowd))) {
        continue;
      }
      let centerPixels = (jacobian * (center - x));
      if ((dot(centerPixels, centerPixels) > _licm0)) {
        continue;
      }
      if (((Terrain_dirtField(Terrain_groundWarp(center)) < 0.03) || (Terrain_coast(center) > -1.0))) {
        continue;
      }
      let view = normalize((center - eye));
      let direction = normalize((jacobian * SDF_rotate(vec2<f32>((-view.y), view.x), (DIRT_TILT + (0.6 * (g.z - 0.5))))));
      let halfLength = ((0.3 + ((1.5 * g.w) * g.w)) * lw);
      let edge = (halfLength * direction);
      distance = min(distance, Terrain_brush((centerPixels - edge), centerPixels, (centerPixels + edge), ((1.0 + (0.35 * Noise_hash12((cell + 57.7)))) * lw), 0.0));
    }
  }
  return distance;
}

fn Terrain_dirtInk(x: vec2<f32>, eye: vec2<f32>, t: f32, jacobian: mat2x2<f32>, lw: f32) -> f32 {
  if ((t > 14.0)) {
    return 0.0;
  }
  let distance = min(Terrain_dirtStrokes(x, eye, jacobian, lw), Terrain_dirtDots(x, eye, jacobian, lw));
  return ((1.0 - smoothstep(-0.5, 0.5, distance)) * (1.0 - smoothstep(10.0, 14.0, t)));
}

fn Terrain_shade(p: vec3<f32>, ro: vec3<f32>, t: f32, pixA: f32, lineA: f32, ship: Ship, trees: NamekTrees) -> vec3<f32> {
  var _sel0: vec3<f32>;
  if ((length(p.xz) > MESA_R)) {
    _sel0 = Terrain_normal(p.xz, t);
  } else {
    _sel0 = vec3<f32>(0.0, 1.0, 0.0);
  }
  let normal = _sel0;
  let x = p.xz;
  let radius = length(x);
  let height = (p.y - GROUND);
  let warped = Terrain_groundWarp(x);
  var col: vec3<f32> = mix(GRASS, GRASS_DK, (0.6 * smoothstep(0.55, 0.56, Noise_fbm(((warped * 1.1) + 3.0)))));
  var dirt: f32 = Terrain_dirtField(warped);
  let dirtGradient = vec2<f32>(dpdx(dirt), dpdy(dirt));
  let recede = smoothstep(0.25, 0.6, (abs(dirtGradient.x) / max(length(dirtGradient), 0.000001)));
  dirt += _flow12_shared(Noise_value((x * 5.0)), Noise_value(((x * 11.0) + 7.0)));
  let fieldWidth = max(length(vec2<f32>(dpdx(dirt), dpdy(dirt))), 0.00001);
  let dx = dpdx(x);
  let dy = dpdy(x);
  let jacobian = mat2x2<f32>(dx, dy);
  let inverseJacobian = inverseMat2(dx.x, dx.y, dy.x, dy.y);
  let lw = ((0.5 * lineA) / pixA);
  var grain: vec2<f32> = vec2<f32>(dot(x, DIRT_GRAIN), dot(x, vec2<f32>((-DIRT_GRAIN.y), DIRT_GRAIN.x)));
  let _gv0 = (x * 0.25);
  grain.y += ((0.8 * Noise_fbm((_gv0 + 5.0))) + (0.12 * Noise_value(((x * 1.9) + 2.0))));
  let _gv1 = (x * 0.6);
  let pattern = _flow17_shared(Noise_fbm((vec2<f32>((0.45 * grain.x), (3.0 * grain.y)) + 27.0)), Noise_value((_gv1 + 31.0)), Noise_value((vec2<f32>((1.2 * grain.x), (11.0 * grain.y)) + 41.0)), Noise_value((vec2<f32>((0.7 * grain.x), (1.5 * grain.y)) + 13.0)));
  let dirtColor = mix(SAND, DIRT_DK, mix(0.36, 0.6, smoothstep(0.25, 0.75, pattern)));
  col = mix(col, dirtColor, smoothstep((-fieldWidth), fieldWidth, dirt));
  if (((dirt > ((3.0 * fieldWidth) * lw)) && (abs(determinant(jacobian)) > 1e-12))) {
    col = mix(col, INK, (smoothstep(3.0, 5.0, ((dirt / fieldWidth) / lw)) * Terrain_dirtInk(x, ro.xz, t, inverseJacobian, lw)));
  }
  let outline = (1.0 - smoothstep((lw - 0.5), (lw + 0.5), (abs(dirt) / fieldWidth)));
  let dash = smoothstep(0.45, 0.5, Noise_value(((x * 16.0) + 5.0)));
  col = mix(col, INK, (outline * mix(1.0, dash, recede)));
  let shoreDistance = Terrain_coast(x);
  col = mix(col, SAND_RIM, smoothstep(-0.75, -0.7, shoreDistance));
  col = mix(col, SAND, smoothstep(-0.6, -0.55, shoreDistance));
  let fade = (1.0 - smoothstep(20.0, 45.0, t));
  let lap = (0.5 + (0.5 * sin(((1.3 * u.time) - (6.0 * Noise_value((x * 0.4)))))));
  var sea: vec3<f32> = mix(SEA_SHOAL, SEA, smoothstep(0.9, 1.0, shoreDistance));
  let shore = (-0.35 * lap);
  var foam: f32 = (1.0 - smoothstep((shore + 0.15), (shore + 0.2), shoreDistance));
  let mesa = Terrain_mesaField(x);
  foam = _flow21_shared(foam, lap, mesa);
  let wave = (Noise_value(vec2<f32>((((3.0 * radius) + (3.0 * Noise_value(_gv0))) + (1.2 * u.time)), 0.5)) * Noise_value((_gv1 + 2.0)));
  foam = max(foam, (fade * smoothstep(0.5, 0.53, wave)));
  sea = mix(sea, SEA_HI, foam);
  col = mix(col, sea, (smoothstep((shore - 0.05), shore, shoreDistance) * (1.0 - step(0.02, height))));
  col = mix(col, INK, Terrain_grassInk(x, ro, t, pixA, lineA));
  col = mix(col, MESA_TOP, smoothstep(0.5, 1.2, height));
  let strataValue = fract(((height * 1.3) + (0.35 * Noise_value((x * 0.5)))));
  var strata: vec3<f32> = select(select(CLIFF_C, CLIFF_B, (strataValue < 0.75)), CLIFF_A, (strataValue < 0.45));
  strata *= (0.8 + (0.2 * Noise_value(vec2<f32>((dot(x, vec2<f32>(2.0, 1.3)) * 3.0), (height * 0.5)))));
  col = mix(col, strata, smoothstep(0.35, 0.55, (1.0 - normal.y)));
  var lightAmount: f32 = smoothstep(-0.05, 0.2, dot(normal, LIG));
  if ((radius < 12.0)) {
    lightAmount *= ShipMaterial_celShadow_value_value((p + (normal * 0.02)), LIG, ship, trees);
  }
  col *= mix((SHADE * 0.95), vec3<f32>(1.0), lightAmount);
  return mix(col, HAZE, (1.0 - exp((-0.012 * t))));
}

fn NamekScene_mapCel(self_: ptr<function, NamekScene>, p: vec3<f32>) -> vec2<f32> {
  var result: vec2<f32> = Ship_map_function(&(*self_).ship, p);
  result = SDF_union(result, NamekTrees_map_function(&(*self_).trees, p));
  return result;
}

fn NamekScene_calcNormal(self_: ptr<function, NamekScene>, p: vec3<f32>) -> vec3<f32> {
  let normal = vec3<f32>(0.0);
  let normal_1 = (normal + (TET[0] * NamekScene_mapCel(self_, (p + (0.0007 * TET[0]))).x));
  let normal_2 = (normal_1 + (TET[1] * NamekScene_mapCel(self_, (p + (0.0007 * TET[1]))).x));
  let normal_3 = (normal_2 + (TET[2] * NamekScene_mapCel(self_, (p + (0.0007 * TET[2]))).x));
  let normal_4 = (normal_3 + (TET[3] * NamekScene_mapCel(self_, (p + (0.0007 * TET[3]))).x));
  return normalize(normal_4);
}

fn NamekScene_marchCel_into(_dst: ptr<function, MarchResult>, self_: ptr<function, NamekScene>, ro: vec3<f32>, rd: vec3<f32>, lineA: f32, pixA: f32) {
  var edge: f32 = 0.0;
  var windowEdge: f32 = 0.0;
  var edgeT: f32 = 10000000000.0;
  var t: f32 = 0.5;
  var previous: vec2<f32> = vec2<f32>(10000000000.0, -1.0);
  for (var i: i32 = 0; (i < 180); i = (i + 1)) {
    let hit = NamekScene_mapCel(self_, (ro + (rd * t)));
    if ((hit.x < (0.0003 * t))) {
      (*_dst) = MarchResult(vec2<f32>(t, hit.y), edge, windowEdge, edgeT);
      return;
    }
    let width = (lineA * t);
    if (((hit.x > previous.x) && (previous.x < width))) {
      let contour = clamp(((width - previous.x) / (pixA * t)), 0.0, 1.0);
      let _ifc0 = (abs((previous.y - 2.5)) < 1.0);
      windowEdge = select(windowEdge, max(windowEdge, contour), _ifc0);
      edge = select(max(edge, contour), edge, _ifc0);
      edgeT = min(edgeT, t);
    }
    previous = hit;
    t += hit.x;
    if ((t > 24.0)) {
      break;
    }
  }
  (*_dst) = MarchResult(vec2<f32>(t, -1.0), edge, windowEdge, edgeT);
}

fn NamekScene_render(self_: ptr<function, NamekScene>, ro: vec3<f32>, rd: vec3<f32>, pixA: f32, lineA: f32) -> vec3<f32> {
  var march: MarchResult;
  NamekScene_marchCel_into(&march, self_, ro, rd, lineA, pixA);
  var edge: f32 = march.edge;
  edge = select(edge, max(edge, march.winEdge), (abs((march.hit.y - 2.5)) > 1.0));
  let shipHit = (march.hit.y >= 0.0);
  let terrainT = Terrain_march(ro, rd, select(400.0, march.hit.x, shipHit));
  let _cse0 = vec3<f32>(0.0);
  var col: vec3<f32> = _cse0;
  var frontT: f32 = 10000000000.0;
  let _gv0 = (ro + (rd * terrainT));
  let x_h1 = _gv0.xz;
  let warped_h2 = Terrain_groundWarp(x_h1);
  var dirt_h3: f32 = Terrain_dirtField(warped_h2);
  let hoist_d_h4 = dpdx(dirt_h3);
  let hoist_d_h5 = dpdy(dirt_h3);
  dirt_h3 += _flow12_shared(Noise_value((x_h1 * 5.0)), Noise_value(((x_h1 * 11.0) + 7.0)));
  let hoist_d_h6 = dpdx(dirt_h3);
  let hoist_d_h7 = dpdy(dirt_h3);
  let hoist_d_h8 = dpdx(x_h1);
  let hoist_d_h9 = dpdy(x_h1);
  if ((shipHit && (terrainT < 0.0))) {
    let p = (ro + (rd * march.hit.x));
    let _i16a1 = NamekScene_calcNormal(self_, p);
    let _i16a3 = march.hit.y;
    let _i16a4 = march.hit.x;
    let _i16_aa = (((0.7 * pixA) * _i16a4) / max(dot(_i16a1, (-rd)), 0.3));
    let _i16_lw = ((0.5 * lineA) * _i16a4);
    var _i16_lightAmount: f32 = smoothstep(-0.02, 0.02, dot(_i16a1, LIG));
    if ((_i16_lightAmount > 0.0)) {
      _i16_lightAmount *= ShipMaterial_celShadow_function_function((p + (_i16a1 * 0.004)), LIG, &(*self_).ship, &(*self_).trees);
    }
    let _cse1 = vec3<f32>(1.0);
    let _i16_lit = mix(SHADE, _cse1, _i16_lightAmount);
    var _i16_col: vec3<f32> = _cse0;
    if ((_i16a3 < 0.5)) {
      let _gv1 = (-_i16_aa);
      let _i16_cap = smoothstep(_gv1, _i16_aa, (p.y - (RING_Y + RING_H)));
      let _i16_band = (smoothstep(_gv1, _i16_aa, (p.y - BAND_BOT)) - smoothstep(_gv1, _i16_aa, (p.y - BAND_TOP)));
      let _i16_viewDirection = normalize(((_i16a4 * rd) - p));
      let _i16_viewRight = normalize(cross(_i16_viewDirection, vec3<f32>(0.0, 1.0, 0.0)));
      let _i16_a3 = cross(_i16_viewRight, _i16_viewDirection);
      let _i16_sheenCenter = ((0.6 * _i16_a3) - (0.8 * _i16_viewRight));
      let _i16_c0 = cos((SHEEN_R + (0.1 * (Noise_value((7.0 * vec2<f32>(dot(_i16a1, _i16_viewRight), dot(_i16a1, _i16_a3)))) - 0.5))));
      let _i16_rho = max(length(_i16a1.xz), 0.0001);
      let _i16_hH = length(_i16_sheenCenter.xz);
      let _i16_m = (_i16a1.y * _i16_sheenCenter.y);
      let _i16_w = (_i16_rho * _i16_hH);
      let _i16_angle = acos(clamp((dot(_i16a1.xz, _i16_sheenCenter.xz) / _i16_w), -1.0, 1.0));
      let _i16_q = ((_i16_c0 - _i16_m) / _i16_w);
      var _i16_e: f32 = 0.0;
      var _i16_de: f32 = 0.0;
      if ((abs(_i16_q) < 1.0)) {
        let _i16_lit_ = acos(_i16_q);
        let _gv2 = (_i16_lit_ - _i16_angle);
        _i16_e = (_i16_rho * _gv2);
        _i16_de = (((-_i16a1.y) * _gv2) - (((_i16_c0 * _i16a1.y) - _i16_sheenCenter.y) / (_i16_w * max(sqrt((1.0 - (_i16_q * _i16_q))), 0.05))));
      } else {
        let _gv3 = sign(_i16_q);
        let _i16_hm = (_i16_m + (_gv3 * _i16_w));
        let _i16_gap = (abs((_i16_c0 - _i16_hm)) / sqrt(max((1.0 - (_i16_hm * _i16_hm)), 0.0001)));
        let _i16_arc = select((PI - _i16_angle), _i16_angle, (_i16_q > 0.0));
        _i16_e = ((-_gv3) * (_i16_gap + (_i16_rho * _i16_arc)));
        _i16_de = ((_gv3 * _i16a1.y) * _i16_arc);
      }
      let _i16_s = (asin(clamp(_i16a1.y, -1.0, 1.0)) / HATCH_W);
      let _i16_c1 = floor((_i16_s + 0.5));
      let _i16_u1 = (_i16_s - _i16_c1);
      let _i16_c2 = floor(_i16_s);
      let _i16_u2 = ((_i16_s - _i16_c2) - 0.5);
      let _i16_fit = min(1.0, ((1.25 * _i16_rho) / max(HATCH_L, HATCH_D)));
      let _i16_lightLength = ((_i16_fit * HATCH_L) * (0.15 + (0.85 * Noise_hash12(vec2<f32>(_i16_c1, 3.1)))));
      let _i16_darkLength = ((_i16_fit * HATCH_D) * (0.15 + (0.85 * Noise_hash12(vec2<f32>(_i16_c2, 7.7)))));
      let _i16_z = ((_i16_e + (_i16_lightLength * (1.0 - (2.0 * abs(_i16_u1))))) - (_i16_darkLength * (1.0 - (2.0 * abs(_i16_u2)))));
      let _i16_dz = (_i16_de + ((2.0 * ((_i16_darkLength * sign(_i16_u2)) - (_i16_lightLength * sign(_i16_u1)))) / HATCH_W));
      let _i16_ret = smoothstep(_gv1, _i16_aa, (_i16_z / sqrt((1.0 + (_i16_dz * _i16_dz)))));
      let _i16_blackPaint = (mix(BLACK, BLACK_HI, _i16_ret) * mix(0.7, 1.0, _i16_lightAmount));
      let _i16_dark = max(_i16_cap, _i16_band);
      _i16_col = mix((HULL * _i16_lit), _i16_blackPaint, _i16_dark);
      let _i16_longitude = atan2(p.x, p.z);
      let _i16_latitude = asin(clamp((p.y / length(p)), -1.0, 1.0));
      var _i16_ink: f32 = 0.0;
      let _i16_caps = (vec2<f32>(((_i16_longitude - CAPS_LON) * cos(CAPS_LAT)), (_i16_latitude - CAPS_LAT)) / CAPS_H);
      var _i16_index: f32 = floor(((_i16_caps.x / ADV) + 3.5));
      if ((((abs(_i16_caps.y) < 0.6) && (_i16_index >= 0.0)) && (_i16_index < 7.0))) {
        _i16_ink = (1.0 - smoothstep(_gv1, _i16_aa, (CAPS_H * Lettering_glyph(&(*self_).lettering, vec2<f32>((_i16_caps.x - ((_i16_index - 3.0) * ADV)), _i16_caps.y), i32(_i16_index)))));
      }
      let _i16_corp = (vec2<f32>(((_i16_longitude - CORP_LON) * cos(CORP_LAT)), (_i16_latitude - CORP_LAT)) / CORP_H);
      _i16_index = floor(((_i16_corp.x / ADV) + 2.5));
      if ((((abs(_i16_corp.y) < 0.6) && (_i16_index >= 0.0)) && (_i16_index < 5.0))) {
        let _i16_glyphId = select(select(select(select(9, 2, (_i16_index < 3.5)), 8, (_i16_index < 2.5)), 7, (_i16_index < 1.5)), 0, (_i16_index < 0.5));
        _i16_ink = max(_i16_ink, (1.0 - smoothstep(_gv1, _i16_aa, (CORP_H * Lettering_glyph(&(*self_).lettering, vec2<f32>((_i16_corp.x - ((_i16_index - 2.0) * ADV)), _i16_corp.y), _i16_glyphId)))));
      }
      _i16_col = mix(_i16_col, INK, max(_i16_ink, ((1.0 - _i16_dark) * ShipDetails_scuffInk(&(*self_).details, p, _i16a4, lineA, _i16_aa))));
    } else if ((_i16a3 < 1.5)) {
      let _i16_dy = abs((p.y - RING_Y));
      _i16_col = (HULL * _i16_lit);
      let _lc1 = (0.6 * _i16_lw);
      var _i16_ink_: f32 = (1.0 - smoothstep((_lc1 - _i16_aa), (_lc1 + _i16_aa), _i16_dy));
      let _lc2 = (RING_H - (1.3 * _i16_lw));
      _i16_ink_ = max(_i16_ink_, smoothstep((_lc2 - _i16_aa), (_lc2 + _i16_aa), _i16_dy));
      _i16_col = mix(_i16_col, INK, _i16_ink_);
    } else if ((_i16a3 < 2.5)) {
      var _i16_windowFrame: _spec1_result;
      _spec0_SDF_polarY_into(&_i16_windowFrame, atan2(p.x, p.z), length(p.xz), p.y, WIN_N, 0.0);
      let _i16_q_ = _i16_windowFrame.point;
      let _i16_center = vec3<f32>(0.0, WIN_Y, sqrt((1.0 - (WIN_Y * WIN_Y))));
      let _i16_w_ = vec2<f32>(_i16_q_.x, dot((_i16_q_ - _i16_center), normalize((vec3<f32>(0.0, 1.0, 0.0) - (_i16_center * WIN_Y)))));
      let _i16_radius = length(_i16_w_);
      _i16_col = mix(GLASS_HI, GLASS_LO, smoothstep((0.1 - _i16_aa), (0.1 + _i16_aa), length((_i16_w_ - vec2<f32>(-0.035, 0.04)))));
      var _i16_streak: f32 = (abs((_i16_radius - 0.062)) - 0.011);
      _i16_streak = max(_i16_streak, ((abs((atan2(_i16_w_.y, _i16_q_.x) - 2.25)) * _i16_radius) - 0.035));
      _i16_col = mix(_i16_col, vec3<f32>(0.93, 0.98, 1.0), (1.0 - smoothstep((-_i16_aa), _i16_aa, _i16_streak)));
      _i16_col *= mix(0.8, 1.0, _i16_lightAmount);
    } else if ((_i16a3 < 3.5)) {
      _i16_col = (METAL * _i16_lit);
    } else if ((_i16a3 < 4.5)) {
      let _i16_doorDistance = SDF_arch(vec2<f32>((atan2(p.x, p.z) * length(p.xz)), p.y), DOOR_HW, DOOR_Y0, DOOR_Y1);
      let _i16_top = ((length(p) - 1.0) - DOOR_T);
      _i16_col = (HULL * _i16_lit);
      var _i16_ink_1: f32 = (1.0 - smoothstep((_i16_lw - _i16_aa), (_i16_lw + _i16_aa), length(vec2<f32>(_i16_doorDistance, _i16_top))));
      let _lc3 = (0.7 * _i16_lw);
      _i16_ink_1 = max(_i16_ink_1, (1.0 - smoothstep((_lc3 - _i16_aa), (_lc3 + _i16_aa), length(vec2<f32>(_i16_doorDistance, (_i16_top + DOOR_T))))));
      _i16_col = mix(_i16_col, INK, _i16_ink_1);
    } else if ((_i16a3 < 7.5)) {
      _i16_col = (METAL * mix(vec3<f32>(0.5, 0.6, 0.78), _cse1, _i16_lightAmount));
    } else if ((_i16a3 < 8.5)) {
      _i16_col = (TRUNK * _i16_lit);
    } else if ((_i16a3 < 9.5)) {
      let _i22_firstDistance = length((p.xz - (*self_).trees.first.position));
      let _i22_secondDistance = length((p.xz - (*self_).trees.second.position));
      var _sel1: NamekTree;
      if ((_i22_firstDistance < _i22_secondDistance)) {
        _sel1 = (*self_).trees.first;
      } else {
        _sel1 = (*self_).trees.second;
      }
      var _i22_spec5_returned: NamekTree = _sel1;
      let _i16_normal = normalize((p - vec3<f32>(_i22_spec5_returned.position.x, (GROUND + _i22_spec5_returned.height), _i22_spec5_returned.position.y)));
      let _i16_k = (dot(normalize((_i16_normal + (0.5 * _i16a1))), LIG) + (0.15 * (Noise_value(((_i16_normal.xy * 9.0) + (_i16_normal.z * 5.0))) - 0.5)));
      _i16_col = mix((LEAF * vec3<f32>(0.72, 0.78, 0.9)), LEAF, (smoothstep(0.0, 0.04, _i16_k) * ShipMaterial_celShadow_function_function((p + (_i16a1 * 0.01)), LIG, &(*self_).ship, &(*self_).trees)));
      _i16_col = mix(_i16_col, LEAF_HI, smoothstep(0.55, 0.59, _i16_k));
    } else if ((_i16a3 < 10.5)) {
      var _i16_legFrame: PolarResult;
      SDF_polarY_into(&_i16_legFrame, atan2(p.x, p.z), length(p.xz), p.y, 4.0, LEG_LON);
      let _i16_local = Ship_flapHome_function(&(*self_).ship, _i16_legFrame.point);
      let _i16_rotated = SDF_rotate(_i16_local.xz, ((-LEG_LON) - ((0.5 * PI) * _i16_legFrame.index)));
      _i16_col = mix((HULL * _i16_lit), INK, ShipDetails_scuffInk(&(*self_).details, vec3<f32>(_i16_rotated.x, _i16_local.y, _i16_rotated.y), _i16a4, lineA, _i16_aa));
    } else if ((_i16a3 < 11.5)) {
      _i16_col = mix(_cse0, (HULL * _i16_lit), smoothstep((-_i16_aa), _i16_aa, ((length(p) - 1.0) + FLAP_T)));
    } else {
      _i16_col = mix(_cse0, (HULL * _i16_lit), smoothstep((-_i16_aa), _i16_aa, ((length(p.xz) - BELLY_R) + FLAP_T)));
    }
    col = _i16_col;
    frontT = march.hit.x;
  } else if ((terrainT > 0.0)) {
    var _sel2: vec3<f32>;
    if ((length(_gv0.xz) > MESA_R)) {
      _sel2 = Terrain_normal(_gv0.xz, terrainT);
    } else {
      _sel2 = vec3<f32>(0.0, 1.0, 0.0);
    }
    let _i19_normal = _sel2;
    let _i19_x = _gv0.xz;
    let _i19_radius = length(_i19_x);
    let _i19_height = (_gv0.y - GROUND);
    let _i19_warped = Terrain_groundWarp(_i19_x);
    var _i19_col: vec3<f32> = mix(GRASS, GRASS_DK, (0.6 * smoothstep(0.55, 0.56, Noise_fbm(((_i19_warped * 1.1) + 3.0)))));
    var _i19_dirt: f32 = Terrain_dirtField(_i19_warped);
    let _i19_dirtGradient = vec2<f32>(hoist_d_h4, hoist_d_h5);
    let _i19_recede = smoothstep(0.25, 0.6, (abs(hoist_d_h4) / max(length(_i19_dirtGradient), 0.000001)));
    _i19_dirt += _flow12_shared(Noise_value((_i19_x * 5.0)), Noise_value(((_i19_x * 11.0) + 7.0)));
    let _i19_fieldWidth = max(length(vec2<f32>(hoist_d_h6, hoist_d_h7)), 0.00001);
    let _i19_jacobian = mat2x2<f32>(hoist_d_h8, hoist_d_h9);
    let _i19_inverseJacobian = inverseMat2(hoist_d_h8.x, hoist_d_h8.y, hoist_d_h9.x, hoist_d_h9.y);
    let _i19_lw = ((0.5 * lineA) / pixA);
    var _i19_grain: vec2<f32> = vec2<f32>(dot(_i19_x, DIRT_GRAIN), dot(_i19_x, vec2<f32>((-DIRT_GRAIN.y), DIRT_GRAIN.x)));
    let _gv4 = (_i19_x * 0.25);
    _i19_grain.y += ((0.8 * Noise_fbm((_gv4 + 5.0))) + (0.12 * Noise_value(((_i19_x * 1.9) + 2.0))));
    let _gv5 = (_i19_x * 0.6);
    let _i19_pattern = _flow17_shared(Noise_fbm((vec2<f32>((0.45 * _i19_grain.x), (3.0 * _i19_grain.y)) + 27.0)), Noise_value((_gv5 + 31.0)), Noise_value((vec2<f32>((1.2 * _i19_grain.x), (11.0 * _i19_grain.y)) + 41.0)), Noise_value((vec2<f32>((0.7 * _i19_grain.x), (1.5 * _i19_grain.y)) + 13.0)));
    let _i19_dirtColor = mix(SAND, DIRT_DK, mix(0.36, 0.6, smoothstep(0.25, 0.75, _i19_pattern)));
    _i19_col = mix(_i19_col, _i19_dirtColor, smoothstep((-_i19_fieldWidth), _i19_fieldWidth, _i19_dirt));
    if (((_i19_dirt > ((3.0 * _i19_fieldWidth) * _i19_lw)) && (abs(determinant(_i19_jacobian)) > 1e-12))) {
      _i19_col = mix(_i19_col, INK, (smoothstep(3.0, 5.0, ((_i19_dirt / _i19_fieldWidth) / _i19_lw)) * Terrain_dirtInk(_i19_x, ro.xz, terrainT, _i19_inverseJacobian, _i19_lw)));
    }
    let _i19_outline = (1.0 - smoothstep((_i19_lw - 0.5), (_i19_lw + 0.5), (abs(_i19_dirt) / _i19_fieldWidth)));
    let _i19_dash = smoothstep(0.45, 0.5, Noise_value(((_i19_x * 16.0) + 5.0)));
    _i19_col = mix(_i19_col, INK, (_i19_outline * mix(1.0, _i19_dash, _i19_recede)));
    let _i19_shoreDistance = Terrain_coast(_i19_x);
    _i19_col = mix(_i19_col, SAND_RIM, smoothstep(-0.75, -0.7, _i19_shoreDistance));
    _i19_col = mix(_i19_col, SAND, smoothstep(-0.6, -0.55, _i19_shoreDistance));
    let _i19_fade = (1.0 - smoothstep(20.0, 45.0, terrainT));
    let _i19_lap = (0.5 + (0.5 * sin(((1.3 * u.time) - (6.0 * Noise_value((_i19_x * 0.4)))))));
    var _i19_sea: vec3<f32> = mix(SEA_SHOAL, SEA, smoothstep(0.9, 1.0, _i19_shoreDistance));
    let _i19_shore = (-0.35 * _i19_lap);
    var _i19_foam: f32 = (1.0 - smoothstep((_i19_shore + 0.15), (_i19_shore + 0.2), _i19_shoreDistance));
    let _i19_mesa = Terrain_mesaField(_i19_x);
    _i19_foam = _flow21_shared(_i19_foam, _i19_lap, _i19_mesa);
    let _i19_wave = (Noise_value(vec2<f32>((((3.0 * _i19_radius) + (3.0 * Noise_value(_gv4))) + (1.2 * u.time)), 0.5)) * Noise_value((_gv5 + 2.0)));
    _i19_foam = max(_i19_foam, (_i19_fade * smoothstep(0.5, 0.53, _i19_wave)));
    _i19_sea = mix(_i19_sea, SEA_HI, _i19_foam);
    _i19_col = mix(_i19_col, _i19_sea, (smoothstep((_i19_shore - 0.05), _i19_shore, _i19_shoreDistance) * (1.0 - step(0.02, _i19_height))));
    _i19_col = mix(_i19_col, INK, Terrain_grassInk(_i19_x, ro, terrainT, pixA, lineA));
    _i19_col = mix(_i19_col, MESA_TOP, smoothstep(0.5, 1.2, _i19_height));
    let _i19_strataValue = fract(((_i19_height * 1.3) + (0.35 * Noise_value((_i19_x * 0.5)))));
    var _i19_strata: vec3<f32> = select(select(CLIFF_C, CLIFF_B, (_i19_strataValue < 0.75)), CLIFF_A, (_i19_strataValue < 0.45));
    _i19_strata *= (0.8 + (0.2 * Noise_value(vec2<f32>((dot(_i19_x, vec2<f32>(2.0, 1.3)) * 3.0), (_i19_height * 0.5)))));
    _i19_col = mix(_i19_col, _i19_strata, smoothstep(0.35, 0.55, (1.0 - _i19_normal.y)));
    var _i19_lightAmount: f32 = smoothstep(-0.05, 0.2, dot(_i19_normal, LIG));
    if ((_i19_radius < 12.0)) {
      _i19_lightAmount *= ShipMaterial_celShadow_function_function((_gv0 + (_i19_normal * 0.02)), LIG, &(*self_).ship, &(*self_).trees);
    }
    _i19_col *= mix((SHADE * 0.95), vec3<f32>(1.0), _i19_lightAmount);
    let _i19ret = mix(_i19_col, HAZE, (1.0 - exp((-0.012 * terrainT))));
    col = _i19ret;
    frontT = terrainT;
  } else {
    let _i20_y = max(rd.y, 0.0);
    var _i20_col: vec3<f32> = mix(SKY_HZ, SKY_MID, smoothstep(0.0, 0.12, _i20_y));
    _i20_col = mix(_i20_col, SKY_TOP, smoothstep(0.08, 0.35, _i20_y));
    let _i20_uv = vec2<f32>(((atan2(rd.x, rd.z) * (19.0 / TAU)) + (0.004 * u.time)), (_i20_y * 26.0));
    let _i20_clouds = Noise_fbmWrapX(((_i20_uv * vec2<f32>(1.0, 0.8)) + vec2<f32>(0.0, 3.0)), 19.0);
    let _i20_cloudMask = ((smoothstep(0.56, 0.6, _i20_clouds) * smoothstep(0.015, 0.05, _i20_y)) * (1.0 - smoothstep(0.18, 0.35, _i20_y)));
    _i20_col = mix(_i20_col, CLOUD, (0.75 * _i20_cloudMask));
    col = _i20_col;
  }
  col = select(col, mix(col, INK, edge), (march.tEdge < frontT));
  return col;
}

fn NamekScene_colorAt(self_: ptr<function, NamekScene>, uv: vec2<f32>) -> vec4<f32> {
  let resolution = u.resolution;
  let fragCoord = (uv * resolution);
  let pointer = (u.mouse - vec2<f32>(0.5));
  let azimuth = ((0.42 + ((TAU * u.time) / 60.0)) + (pointer.x * TAU));
  let elevation = clamp(((0.18 + (0.03 * sin((0.21 * u.time)))) + (pointer.y * 2.0)), 0.03, 1.1);
  let sceneTarget = vec3<f32>(0.0, -0.25, 0.0);
  let _lc0 = cos(elevation);
  let rayOrigin = (sceneTarget + (5.6 * vec3<f32>((sin(azimuth) * _lc0), sin(elevation), (cos(azimuth) * _lc0))));
  let cameraForward = normalize((sceneTarget - rayOrigin));
  let cameraRight = normalize(cross(cameraForward, vec3<f32>(0.0, 1.0, 0.0)));
  let cameraUp = cross(cameraRight, cameraForward);
  let pixA = (2.0 / (resolution.y * 3.4));
  let lineA = ((0.0055 + (1.2 / resolution.y)) / 3.4);
  let _cse0 = vec3<f32>(0.0);
  let _u1_u0_offset = (((vec2<f32>(0.0, 0.0) + 0.5) / f32(AA)) - 0.5);
  let _u1_u0_screenUV = (((2.0 * (fragCoord + _u1_u0_offset)) - resolution) / resolution.y);
  let _u1_u0_rd = normalize((((_u1_u0_screenUV.x * cameraRight) + (_u1_u0_screenUV.y * cameraUp)) + (3.4 * cameraForward)));
  let col_1 = (_cse0 + NamekScene_render(self_, rayOrigin, _u1_u0_rd, pixA, lineA));
  let col_2 = (col_1 / f32((AA * AA)));
  let q = (fragCoord / resolution);
  let col_3 = ((col_2 * vec3<f32>(0.94, 1.0, 0.96)) + vec3<f32>(0.025, 0.035, 0.03));
  let col_4 = (col_3 + (0.03 * (Noise_hash12((fragCoord + (61.7 * fract((u.time * 7.13))))) - 0.5)));
  let col_5 = (col_4 * (0.55 + (0.45 * pow(((((16.0 * q.x) * q.y) * (1.0 - q.x)) * (1.0 - q.y)), 0.12))));
  return vec4<f32>(clamp(col_5, _cse0, vec3<f32>(1.0)), 1.0);
}

fn inverseMat2(a: f32, b: f32, c: f32, d: f32) -> mat2x2<f32> {
  let determinant = ((a * d) - (b * c));
  return mat2x2<f32>(vec2<f32>((d / determinant), ((-b) / determinant)), vec2<f32>(((-c) / determinant), (a / determinant)));
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  let ndc = vec2<f32>(x, y);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), ((ndc * 0.5) + vec2<f32>(0.5)));
}

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  var _i21_self__: Ship = Ship(4.0);
  var _i21_self___: NamekTrees = NamekTrees(NamekTree(vec2<f32>(1.86, 0.83), 0.65, 0.15), NamekTree(vec2<f32>(-5.9, -4.4), 1.9, 0.38));
  var _cse0: NamekTree = NamekTree(vec2<f32>(0.0, 0.0), 0.0, 0.0);
  var _i21_self_: NamekScene = NamekScene(_i21_self__, _i21_self___, ShipDetails(Ship(0.0), NamekTrees(_cse0, _cse0)), Lettering(0.0));
  var _i21_self____: ShipDetails = ShipDetails(_i21_self_.ship, _i21_self_.trees);
  _i21_self_.details = _i21_self____;
  var _i21_self_____: Lettering = Lettering(SW);
  _i21_self_.lettering = _i21_self_____;
  var scene: NamekScene = _i21_self_;
  return NamekScene_colorAt(&scene, uv);
}

fn _spec0_SDF_polarY_into(_dst: ptr<function, _spec1_result>, angle: f32, radius: f32, y: f32, count: f32, offset: f32) {
  let sector = (TAU / count);
  let shifted = (angle - offset);
  let index = floor(((shifted / sector) + 0.5));
  let localAngle = (shifted - (index * sector));
  var _spec2_returned: PolarResult = PolarResult(vec3<f32>((radius * sin(localAngle)), y, (radius * cos(localAngle))), index);
  (*_dst) = _spec1_result(_spec2_returned.point);
}

fn _flow3_shared(_flow0_input: vec2<f32>, _flow1_input: vec2<f32>, _flow2_input: vec2<f32>) -> vec2<f32> {
  return ((_flow0_input - _flow1_input) + (_flow2_input * clamp((dot((_flow1_input - _flow0_input), _flow2_input) / dot(_flow2_input, _flow2_input)), 0.0, 1.0)));
}

fn _flow9_shared(_flow4_input: vec2<f32>, _flow5_input: f32, _flow6_input: f32, _flow7_input: f32, _flow8_input: f32) -> vec2<f32> {
  let _cse0 = ((0.5 * PI) * _flow6_input);
  return mix(_flow4_input, (_flow5_input * vec2<f32>(sin(_cse0), (_flow7_input * (1.0 - cos(_cse0))))), _flow8_input);
}

fn _flow12_shared(_flow10_input: f32, _flow11_input: f32) -> f32 {
  return (0.03 * ((abs((_flow10_input - 0.5)) + (0.5 * abs((_flow11_input - 0.5)))) - 0.35));
}

fn _flow17_shared(_flow13_input: f32, _flow14_input: f32, _flow15_input: f32, _flow16_input: f32) -> f32 {
  return ((0.5 + ((_flow13_input - 0.5) * (0.5 + _flow14_input))) + ((0.7 * (_flow15_input - 0.5)) * smoothstep(0.35, 0.75, _flow16_input)));
}

fn _flow21_shared(_flow18_input: f32, _flow19_input: f32, _flow20_input: f32) -> f32 {
  let _cse0 = (0.02 * _flow19_input);
  return max(_flow18_input, smoothstep((0.61 - _cse0), (0.615 - _cse0), _flow20_input));
}
