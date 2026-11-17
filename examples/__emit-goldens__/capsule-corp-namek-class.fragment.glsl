#version 300 es
precision highp float;
precision highp int;

struct PolarResult {
  vec3 point;
  float index;
};

struct MarchResult {
  vec2 hit;
  float edge;
  float winEdge;
  float tEdge;
};

struct Ship {
  float legCount;
};

struct NamekTree {
  vec2 position;
  float height;
  float radius;
};

struct NamekTrees {
  NamekTree first;
  NamekTree second;
};

struct ShipDetails {
  Ship ship;
  NamekTrees trees;
};

struct Lettering {
  float strokeWidth;
};

struct NamekScene {
  Ship ship;
  NamekTrees trees;
  ShipDetails details;
  Lettering lettering;
};

struct _spec1_result {
  vec3 point;
};

struct _spec4_result {
  vec2 position;
  float height;
};
const int AA = 1;
const float PI = 3.14159265;
const float TAU = 6.28318531;
const float GROUND = -1.04;
const float BAND_TOP = 0.08;
const float BAND_BOT = -0.52;
const float WIN_N = 12.0;
const float WIN_Y = -0.22;
const float WIN_A = 0.1;
const float WIN_BULGE = 0.06;
const float RING_Y = 0.71;
const float RING_H = 0.04;
const float DOOR_HW = 0.17;
const float DOOR_Y0 = -0.6;
const float DOOR_Y1 = 0.21;
const float DOOR_T = 0.005;
const float LEG_LON = 0.7854;
const float FLAP_Y = -0.6;
const float FLAP_LEN = 0.36;
const float FLAP_HW = 0.125;
const float FLAP_TIP_HW = 0.08;
const float FLAP_T = 0.03;
const float FLAP_OPEN = 2.2;
const float BAY_DEPTH = 0.03;
const float LEG_R = 0.99;
const float SHOCK_Y = -0.92;
const float BELLY_R = 0.26;
const float BELLY_Y = (-sqrt((1.0 - (BELLY_R * BELLY_R))));
const float BELLY_EXT = 0.06;
const float SHAFT_R = 0.1;
const float CAPS_LON = 0.08;
const float CAPS_LAT = 0.547;
const float CAPS_H = 0.25;
const float CORP_LON = 0.02;
const float CORP_LAT = 0.284;
const float CORP_H = 0.1;
const float ADV = 0.78;
const float COAST_R = 10.0;
const float MESA_R = 18.0;
const float SW = 0.085;
const float SHEEN_R = 0.99;
const float HATCH_W = 0.02;
const float HATCH_L = 0.09;
const float HATCH_D = 0.09;
const float SCUFFS = 10.0;
const vec2 DIRT_GRAIN = vec2(0.7, 0.0);
const float DIRT_TILT = 0.3;
const vec3 INK = vec3(0.05, 0.07, 0.09);
const vec3 HULL = vec3(0.92, 0.95, 0.91);
const vec3 BLACK = vec3(0.07, 0.11, 0.14);
const vec3 BLACK_HI = vec3(0.47, 0.68, 0.68);
const vec3 METAL = vec3(0.74, 0.76, 0.78);
const vec3 GLASS_LO = vec3(0.36, 0.7, 0.8);
const vec3 GLASS_HI = vec3(0.06, 0.33, 0.5);
const vec3 SHADE = vec3(0.64, 0.76, 0.86);
const vec3 SKY_TOP = vec3(0.3, 0.67, 0.37);
const vec3 SKY_MID = vec3(0.58, 0.78, 0.5);
const vec3 SKY_HZ = vec3(0.74, 0.87, 0.7);
const vec3 CLOUD = vec3(0.84, 0.93, 0.77);
const vec3 HAZE = vec3(0.62, 0.8, 0.74);
const vec3 GRASS = vec3(0.2, 0.57, 0.58);
const vec3 GRASS_DK = vec3(0.15, 0.45, 0.5);
const vec3 SAND = vec3(0.86, 0.8, 0.62);
const vec3 SAND_RIM = vec3(0.8, 0.5, 0.38);
const vec3 DIRT_DK = vec3(0.6, 0.43, 0.28);
const vec3 SEA = vec3(0.435, 0.663, 0.494);
const vec3 SEA_SHOAL = vec3(0.55, 0.77, 0.62);
const vec3 SEA_HI = vec3(0.8, 0.91, 0.8);
const vec3 MESA_TOP = vec3(0.3, 0.62, 0.55);
const vec3 CLIFF_A = vec3(0.86, 0.58, 0.48);
const vec3 CLIFF_B = vec3(0.95, 0.8, 0.66);
const vec3 CLIFF_C = vec3(0.66, 0.38, 0.36);
const vec3 LEAF = vec3(0.13, 0.48, 0.6);
const vec3 LEAF_HI = vec3(0.38, 0.72, 0.78);
const vec3 TRUNK = vec3(0.86, 0.88, 0.78);
const vec3 LIG = normalize(vec3((-0.59), 0.36, 0.73));
const vec2[4] CROSS = vec2[4](vec2((-1.0), 0.0), vec2(1.0, 0.0), vec2(0.0, (-1.0)), vec2(0.0, 1.0));
const vec3[4] TET = vec3[4](vec3(1.0, (-1.0), (-1.0)), vec3((-1.0), (-1.0), 1.0), vec3((-1.0), 1.0, (-1.0)), vec3(1.0));
layout(std140) uniform Uniforms {
  float time;
  vec2 resolution;
  vec2 mouse;
} u;
int _f2i(float x) {
  return int(mix(clamp(x, -2147483648.0, 2147483520.0), 0.0, isnan(x)));
}
PolarResult PolarResult_new(vec3 point, float index) {
  PolarResult self_ = PolarResult(vec3(0.0, 0.0, 0.0), 0.0);
  self_.point = point;
  self_.index = index;
  return self_;
}

MarchResult MarchResult_new(vec2 hit, float edge, float winEdge, float tEdge) {
  MarchResult self_ = MarchResult(vec2(0.0, 0.0), 0.0, 0.0, 0.0);
  self_.hit = hit;
  self_.edge = edge;
  self_.winEdge = winEdge;
  self_.tEdge = tEdge;
  return self_;
}

float Noise_hash12(vec2 p) {
  vec3 p3 = fract((vec3(p.xyx) * 0.1031));
  p3 += dot(p3, (p3.yzx + 33.33));
  return fract(((p3.x + p3.y) * p3.z));
}

float Noise_value(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 q = ((f * f) * (3.0 - (2.0 * f)));
  return mix(mix(Noise_hash12(i), Noise_hash12((i + vec2(1.0, 0.0))), q.x), mix(Noise_hash12((i + vec2(0.0, 1.0))), Noise_hash12((i + vec2(1.0, 1.0))), q.x), q.y);
}

float Noise_fbm(vec2 p) {
  mat2 rotation = mat2(vec2(1.6, 1.2), vec2(-1.2, 1.6));
  float sum_1 = (0.5 * Noise_value(p));
  vec2 q_1 = (rotation * p);
  float sum_2 = (sum_1 + (0.25 * Noise_value(q_1)));
  vec2 q_2 = (rotation * q_1);
  float sum_3 = (sum_2 + (0.125 * Noise_value(q_2)));
  vec2 q_3 = (rotation * q_2);
  float sum_4 = (sum_3 + (0.0625 * Noise_value(q_3)));
  return (sum_4 / 0.9375);
}

float Noise_mod(float x, float y) {
  return (x - (y * floor((x / y))));
}

float Noise_fbmWrapX(vec2 p, float n) {
  vec2 _licm0 = vec2(0.0, 5.3);
  vec2 q = p;
  float period = n;
  float sum = 0.0;
  float amplitude = 0.5;
  for (int i = 0; (i < 4); i = (i + 1)) {
    vec2 _sm0_l_i = floor(q);
    vec2 _sm0_l_f = fract(q);
    vec2 _sm0_l_q = ((_sm0_l_f * _sm0_l_f) * (3.0 - (2.0 * _sm0_l_f)));
    float _sm0_l_i0 = Noise_mod(_sm0_l_i.x, period);
    float _sm0_l_i1 = Noise_mod((_sm0_l_i.x + 1.0), period);
    float _lc0 = (_sm0_l_i.y + 1.0);
    float _sm0_ret = mix(mix(Noise_hash12(vec2(_sm0_l_i0, _sm0_l_i.y)), Noise_hash12(vec2(_sm0_l_i1, _sm0_l_i.y)), _sm0_l_q.x), mix(Noise_hash12(vec2(_sm0_l_i0, _lc0)), Noise_hash12(vec2(_sm0_l_i1, _lc0)), _sm0_l_q.x), _sm0_l_q.y);
    sum += (amplitude * _sm0_ret);
    q = ((2.0 * q) + _licm0);
    period *= 2.0;
    amplitude *= 0.5;
  }
  return (sum / 0.9375);
}

vec2 SDF_union(vec2 a, vec2 b) {
  return ((a.x < b.x) ? a : b);
}

float SDF_segment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = (p - a);
  vec2 ba = (b - a);
  return length((pa - (ba * clamp((dot(pa, ba) / dot(ba, ba)), 0.0, 1.0))));
}

float SDF_cylinderY(vec3 p, float radius, float y0, float y1) {
  vec2 d = vec2((length(p.xz) - radius), (abs((p.y - (0.5 * (y0 + y1)))) - (0.5 * (y1 - y0))));
  return (min(max(d.x, d.y), 0.0) + length(max(d, vec2(0.0))));
}

float SDF_capsule(vec3 p, vec3 a, vec3 b, float radius) {
  vec3 pa = (p - a);
  vec3 ba = (b - a);
  return (length((pa - (ba * clamp((dot(pa, ba) / dot(ba, ba)), 0.0, 1.0)))) - radius);
}

vec2 SDF_rotate(vec2 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return (mat2(vec2(c, s), vec2((-s), c)) * p);
}

float SDF_arch(vec2 p, float halfWidth, float y0, float y1) {
  float d = (length(vec2(p.x, (p.y - clamp(p.y, (y0 - halfWidth), (y1 - halfWidth))))) - halfWidth);
  return max(d, (y0 - p.y));
}

PolarResult SDF_polarY(float angle, float radius, float y, float count, float offset) {
  float sector = (TAU / count);
  float shifted = (angle - offset);
  float index = floor(((shifted / sector) + 0.5));
  float localAngle = (shifted - (index * sector));
  return PolarResult_new(vec3((radius * sin(localAngle)), y, (radius * cos(localAngle))), index);
}

vec2 _flow3_shared(vec2 _flow0_input, vec2 _flow1_input, vec2 _flow2_input) {
  return ((_flow0_input - _flow1_input) + (_flow2_input * clamp((dot((_flow1_input - _flow0_input), _flow2_input) / dot(_flow2_input, _flow2_input)), 0.0, 1.0)));
}

float Ship_flapOutline(Ship self_, vec3 s) {
  float angle = (asin(FLAP_Y) - atan(s.y, length(s.xz)));
  float _cse0 = (0.5 * FLAP_LEN);
  float _gv0 = (angle - _cse0);
  float _sm3_a1 = (FLAP_HW - 0.06);
  float _sm3_a2 = (FLAP_TIP_HW - 0.06);
  float _sm3_a3 = (_cse0 - 0.06);
  vec2 _sm3_l_k1 = vec2(_sm3_a2, _sm3_a3);
  vec2 _sm3_l_k2 = vec2((_sm3_a2 - _sm3_a1), (2.0 * _sm3_a3));
  float _sm3_l_qx = abs(s.x);
  vec2 _sm3_l_q = vec2(_sm3_l_qx, _gv0);
  vec2 _sm3_l_ca = vec2((_sm3_l_qx - min(_sm3_l_qx, ((_gv0 < 0.0) ? _sm3_a1 : _sm3_a2))), (abs(_gv0) - _sm3_a3));
  vec2 _sm3_l_cb = _flow3_shared(_sm3_l_q, _sm3_l_k1, _sm3_l_k2);
  float _sm3_l_sign = (((_sm3_l_cb.x < 0.0) && (_sm3_l_ca.y < 0.0)) ? -1.0 : 1.0);
  float _sm3_ret = (_sm3_l_sign * sqrt(min(dot(_sm3_l_ca, _sm3_l_ca), dot(_sm3_l_cb, _sm3_l_cb))));
  return (_sm3_ret - 0.06);
}

vec3 Ship_flapHome(Ship self_, vec3 l) {
  vec2 hinge = vec2(sqrt((1.0 - (FLAP_Y * FLAP_Y))), FLAP_Y);
  vec2 q = (hinge + SDF_rotate((l.zy - hinge), (-FLAP_OPEN)));
  return vec3(l.x, q.y, q.x);
}

_spec1_result _spec0_SDF_polarY(float angle, float radius, float y, float count, float offset) {
  float sector = (TAU / count);
  float shifted = (angle - offset);
  float index = floor(((shifted / sector) + 0.5));
  float localAngle = (shifted - (index * sector));
  PolarResult _spec2_returned = PolarResult_new(vec3((radius * sin(localAngle)), y, (radius * cos(localAngle))), index);
  return _spec1_result(_spec2_returned.point);
}

vec2 Ship_map(Ship self_, vec3 p) {
  float bound = (length((p - vec3(0.0, -0.3, 0.0))) - 1.6);
  if ((bound > 0.25)) {
    return vec2(bound, 0.0);
  }
  float radius = length(p);
  float longitude = atan(p.x, p.z);
  float horizontalRadius = length(p.xz);
  _spec1_result legFrame = _spec0_SDF_polarY(longitude, horizontalRadius, p.y, self_.legCount, LEG_LON);
  vec3 l = legFrame.point;
  float bay = max(Ship_flapOutline(self_, l), (((1.0 - FLAP_T) - BAY_DEPTH) - radius));
  vec2 result = (((radius - 1.0) > (-bay)) ? vec2((radius - 1.0), 0.0) : vec2((-bay), 11.0));
  float _cse0 = (BELLY_Y - p.y);
  if ((_cse0 > result.x)) {
    result = vec2(_cse0, 12.0);
  }
  result = SDF_union(result, vec2(max((radius - 1.022), (abs((p.y - RING_Y)) - RING_H)), 1.0));
  float door = SDF_arch(vec2((longitude * horizontalRadius), p.y), DOOR_HW, DOOR_Y0, DOOR_Y1);
  result = SDF_union(result, vec2(max(((radius - 1.0) - DOOR_T), door), 4.0));
  PolarResult windowFrame = SDF_polarY(longitude, horizontalRadius, p.y, WIN_N, 0.0);
  if ((abs(windowFrame.index) > 0.5)) {
    vec3 center = vec3(0.0, WIN_Y, sqrt((1.0 - (WIN_Y * WIN_Y))));
    vec3 w = (windowFrame.point - center);
    float h = dot(w, center);
    float glassRadius = (((WIN_A * WIN_A) + (WIN_BULGE * WIN_BULGE)) / (2.0 * WIN_BULGE));
    result = SDF_union(result, vec2((length((windowFrame.point - (center * ((1.0 + WIN_BULGE) - glassRadius)))) - glassRadius), 2.0));
    result = SDF_union(result, vec2((length(vec2((length((w - (h * center))) - 0.114), h)) - 0.017), 3.0));
  }
  float _sm8_a2 = result.x;
  vec2 _sm8_ret = vec2(0.0);
  float _sm8_l_y = -0.73;
  vec2 _sm8_l_hinge = vec2(sqrt((1.0 - (FLAP_Y * FLAP_Y))), FLAP_Y);
  float _sm8_l_tipLat = (asin(FLAP_Y) - FLAP_LEN);
  vec2 _sm8_l_tip = (_sm8_l_hinge + SDF_rotate((vec2(cos(_sm8_l_tipLat), sin(_sm8_l_tipLat)) - _sm8_l_hinge), FLAP_OPEN));
  float _sm8_l_bounds = max(((SDF_segment(l.zy, _sm8_l_hinge, _sm8_l_tip) - FLAP_T) - FLAP_HW), (abs(l.x) - FLAP_HW));
  vec3 _sm8_l_lo = vec3(-0.1, GROUND, 0.0);
  float _gv0 = (_sm8_l_y + 0.02);
  vec3 _sm8_l_hi = vec3(0.1, (_gv0 + 0.02), (LEG_R + 0.1));
  vec3 _sm8_l_sm1_a0 = (l - (0.5 * (_sm8_l_lo + _sm8_l_hi)));
  vec3 _sm8_l_sm1_a1 = (0.5 * (_sm8_l_hi - _sm8_l_lo));
  vec3 _sm8_l_sm1_l_q = (abs(_sm8_l_sm1_a0) - _sm8_l_sm1_a1);
  float _sm8_l_sm1_ret = (length(max(_sm8_l_sm1_l_q, vec3(0.0))) + min(max(_sm8_l_sm1_l_q.x, max(_sm8_l_sm1_l_q.y, _sm8_l_sm1_l_q.z)), 0.0));
  _sm8_l_bounds = min(_sm8_l_bounds, _sm8_l_sm1_ret);
  if ((_sm8_l_bounds > min(_sm8_a2, 0.1))) {
    _sm8_ret = vec2(_sm8_l_bounds, 5.0);
  } else {
    vec3 _sm8_l_c = (l - vec3(0.0, 0.0, LEG_R));
    float _sm8_l_leg = (SDF_cylinderY(_sm8_l_c, 0.05, (SHOCK_Y + 0.01), -0.72) - 0.01);
    _sm8_l_leg = min(_sm8_l_leg, SDF_cylinderY(_sm8_l_c, 0.025, (GROUND + 0.05), SHOCK_Y));
    _sm8_l_leg = min(_sm8_l_leg, SDF_capsule(l, vec3(0.0, _gv0, 0.6), vec3(0.0, _sm8_l_y, LEG_R), 0.018));
    float _sm8_l_joint = (LEG_R - 0.2);
    float _gv1 = (_sm8_l_y - 0.09);
    _sm8_l_leg = min(_sm8_l_leg, SDF_capsule(l, vec3(-0.05, _sm8_l_y, 0.6), vec3(-0.05, _gv1, _sm8_l_joint), 0.018));
    _sm8_l_leg = min(_sm8_l_leg, SDF_capsule(l, vec3(0.05, _sm8_l_y, 0.6), vec3(0.05, _gv1, _sm8_l_joint), 0.018));
    _sm8_l_y -= 0.09;
    float _gv6 = (_sm8_l_y + 0.02);
    vec3 _sm8_l_sm6_a1 = vec3(-0.07, _gv6, _sm8_l_joint);
    vec3 _sm8_l_sm6_a2 = vec3(0.07, _gv6, _sm8_l_joint);
    vec3 _sm8_l_sm6_l_pa = (l - _sm8_l_sm6_a1);
    vec3 _sm8_l_sm6_l_ba = (_sm8_l_sm6_a2 - _sm8_l_sm6_a1);
    float _sm8_l_sm6_l_lengthAB = length(_sm8_l_sm6_l_ba);
    float _sm8_l_sm6_l_h = (dot(_sm8_l_sm6_l_pa, _sm8_l_sm6_l_ba) / _sm8_l_sm6_l_lengthAB);
    float _lc0 = (0.5 * _sm8_l_sm6_l_lengthAB);
    vec2 _sm8_l_sm6_l_d = vec2((length((_sm8_l_sm6_l_pa - (_sm8_l_sm6_l_ba * (_sm8_l_sm6_l_h / _sm8_l_sm6_l_lengthAB)))) - 0.05), (abs((_sm8_l_sm6_l_h - _lc0)) - _lc0));
    float _sm8_l_sm6_ret = (min(max(_sm8_l_sm6_l_d.x, _sm8_l_sm6_l_d.y), 0.0) + length(max(_sm8_l_sm6_l_d, vec2(0.0))));
    _sm8_l_leg = min(_sm8_l_leg, _sm8_l_sm6_ret);
    vec3 _gv2 = vec3(0.05, _gv6, _sm8_l_joint);
    _sm8_l_leg = min(_sm8_l_leg, SDF_capsule(l, _gv2, vec3(0.05, _sm8_l_y, LEG_R), 0.012));
    vec3 _gv3 = vec3(-0.05, _gv6, _sm8_l_joint);
    _sm8_l_leg = min(_sm8_l_leg, SDF_capsule(l, _gv3, vec3(-0.05, _sm8_l_y, LEG_R), 0.012));
    _sm8_l_leg = min(_sm8_l_leg, SDF_capsule(l, _gv2, vec3(0.05, _sm8_l_y, 0.2), 0.012));
    _sm8_l_leg = min(_sm8_l_leg, SDF_capsule(l, _gv3, vec3(-0.05, _sm8_l_y, 0.2), 0.012));
    vec2 _sm8_l_result = vec2(_sm8_l_leg, 5.0);
    float _sm8_l_sm4_a3 = (GROUND + 0.006);
    float _sm8_l_sm4_a4 = (GROUND + 0.064);
    float _sm8_l_sm4_l_halfHeight = (0.5 * (_sm8_l_sm4_a4 - _sm8_l_sm4_a3));
    float _gv4 = ((_sm8_l_c.y - _sm8_l_sm4_a3) - _sm8_l_sm4_l_halfHeight);
    vec2 _sm8_l_sm4_l_q = vec2(length(_sm8_l_c.xz), _gv4);
    vec2 _sm8_l_sm4_l_k1 = vec2(0.024, _sm8_l_sm4_l_halfHeight);
    vec2 _sm8_l_sm4_l_k2 = vec2(-0.07, (2.0 * _sm8_l_sm4_l_halfHeight));
    vec2 _sm8_l_sm4_l_ca = vec2((_sm8_l_sm4_l_q.x - min(_sm8_l_sm4_l_q.x, ((_gv4 < 0.0) ? 0.094 : 0.024))), (abs(_gv4) - _sm8_l_sm4_l_halfHeight));
    vec2 _sm8_l_sm4_l_cb = _flow3_shared(_sm8_l_sm4_l_q, _sm8_l_sm4_l_k1, _sm8_l_sm4_l_k2);
    float _sm8_l_sm4_l_sign = (((_sm8_l_sm4_l_cb.x < 0.0) && (_sm8_l_sm4_l_ca.y < 0.0)) ? -1.0 : 1.0);
    float _sm8_l_sm4_ret = (_sm8_l_sm4_l_sign * sqrt(min(dot(_sm8_l_sm4_l_ca, _sm8_l_sm4_l_ca), dot(_sm8_l_sm4_l_cb, _sm8_l_sm4_l_cb))));
    _sm8_l_result = SDF_union(_sm8_l_result, vec2((_sm8_l_sm4_ret - 0.006), 6.0));
    vec3 _sm8_l_sm7_l_home = Ship_flapHome(self_, l);
    float _cse1 = (0.5 * FLAP_T);
    float _sm8_l_sm7_ret = max((abs(((length(_sm8_l_sm7_l_home) - 1.0) + _cse1)) - _cse1), Ship_flapOutline(self_, _sm8_l_sm7_l_home));
    _sm8_l_result = SDF_union(_sm8_l_result, vec2(_sm8_l_sm7_ret, 10.0));
    _sm8_ret = _sm8_l_result;
  }
  result = SDF_union(result, _sm8_ret);
  vec3 bellyPoint = (p + vec3(0.0, BELLY_EXT, 0.0));
  float _sm5_l_width = sqrt((1.0 - (BELLY_Y * BELLY_Y)));
  float _gv5 = (-bellyPoint.y);
  vec2 _sm5_l_q = vec2(length(bellyPoint.xz), _gv5);
  float _sm5_l_h = (-BELLY_Y);
  float _sm5_l_s = max(((((_sm5_l_h - 1.0) * _sm5_l_q.x) * _sm5_l_q.x) + ((_sm5_l_width * _sm5_l_width) * ((_sm5_l_h + 1.0) - (2.0 * _gv5)))), ((_sm5_l_h * _sm5_l_q.x) - (_sm5_l_width * _gv5)));
  float _sm5_ret = ((_sm5_l_s < 0.0) ? (length(_sm5_l_q) - 1.0) : ((_sm5_l_q.x < _sm5_l_width) ? (_sm5_l_h + bellyPoint.y) : length((_sm5_l_q - vec2(_sm5_l_width, _sm5_l_h)))));
  result = SDF_union(result, vec2(_sm5_ret, (((bellyPoint.y - BELLY_Y) > (length(bellyPoint) - 1.0)) ? 12.0 : 0.0)));
  result = SDF_union(result, vec2(SDF_cylinderY(p, SHAFT_R, ((BELLY_Y - BELLY_EXT) - 0.01), (BELLY_Y + 0.05)), 7.0));
  return result;
}

vec2 NamekTree_map(NamekTree self_, vec3 p) {
  vec3 q = (p - vec3(self_.position.x, GROUND, self_.position.y));
  float _cse0 = (0.5 * self_.height);
  float bound = (((length((q - vec3(0.0, _cse0, 0.0))) - _cse0) - self_.radius) - 0.1);
  if ((bound > 0.2)) {
    return vec2(bound, 8.0);
  }
  float taper = mix(0.018, 0.012, clamp((q.y / self_.height), 0.0, 1.0));
  float trunk = (length(vec2(length(q.xz), (q.y - clamp(q.y, -0.2, self_.height)))) - taper);
  vec3 canopyCenter = (q - vec3(0.0, self_.height, 0.0));
  float _gv0 = length(canopyCenter);
  vec3 normal = (canopyCenter / (_gv0 + 0.0001));
  float bump = ((sin(((9.0 * normal.x) + 1.0)) * sin(((9.0 * normal.y) + 2.0))) * sin(((9.0 * normal.z) + 3.0)));
  float leaves = ((_gv0 - (self_.radius * (1.0 + (0.07 * bump)))) * 0.8);
  return SDF_union(vec2(trunk, 8.0), vec2(leaves, 9.0));
}

float NamekTree_shadowRadius(NamekTree self_) {
  return (((0.5 * self_.height) + self_.radius) + 0.1);
}

vec3 NamekTree_shadowCenter(NamekTree self_) {
  return vec3(self_.position.x, (GROUND + (0.5 * self_.height)), self_.position.y);
}

NamekTree NamekTree_new(vec2 position, float height, float radius) {
  NamekTree self_ = NamekTree(vec2(0.0, 0.0), 0.0, 0.0);
  self_.position = position;
  self_.height = height;
  self_.radius = radius;
  return self_;
}

vec2 NamekTrees_map(NamekTrees self_, vec3 p) {
  vec2 result = NamekTree_map(self_.first, p);
  result = SDF_union(result, NamekTree_map(self_.second, p));
  return result;
}

float NamekTrees_sphereExit(NamekTrees self_, vec3 ro, vec3 rd, vec3 center, float radius) {
  vec3 oc = (ro - center);
  float b = dot(oc, rd);
  float h = (((b * b) - dot(oc, oc)) + (radius * radius));
  return ((h > 0.0) ? ((-b) + sqrt(h)) : 0.0);
}

vec2 _flow9_shared(vec2 _flow4_input, float _flow5_input, float _flow6_input, float _flow7_input, float _flow8_input) {
  float _cse0 = ((0.5 * PI) * _flow6_input);
  return mix(_flow4_input, (_flow5_input * vec2(sin(_cse0), (_flow7_input * (1.0 - cos(_cse0))))), _flow8_input);
}

float ShipDetails_tickRow(ShipDetails self_, vec2 q, vec2 seed, int n, float gap, float len, float bend, float curl, float spread, float lw) {
  float _licm0 = max((-bend), 0.0);
  float _licm1 = (0.4 * gap);
  float _licm2 = (0.35 * len);
  float mid = (0.5 * float((n - 1)));
  float radius = (((2.0 * mid) * gap) / PI);
  float bendSign = ((bend < 0.0) ? -1.0 : 1.0);
  float distance = 1000000000.0;
  for (int k = 0; (k < 9); k = (k + 1)) {
    if ((k >= n)) {
      break;
    }
    float _gv1 = float(k);
    float _gv0 = (_gv1 - mid);
    float fk = (_gv0 / mid);
    vec4 h = vec4(Noise_hash12(((seed + (_gv1 * 3.1)) + 51.0)), Noise_hash12(((seed + (_gv1 * 5.7)) + 63.0)), Noise_hash12(((seed + (_gv1 * 2.3)) + 77.0)), Noise_hash12(((seed + (_gv1 * 4.9)) + 89.0)));
    vec2 base = vec2((gap * _gv0), (((bend * fk) * fk) + _licm0));
    base = _flow9_shared(base, radius, fk, bendSign, curl);
    base += vec2((_licm1 * (h.x - 0.5)), (_licm2 * h.y));
    float bladeLength = (len * (1.0 - (spread * Noise_hash12(((seed + (_gv1 * 6.1)) + 97.0)))));
    float angle = (0.5 * (h.z - 0.5));
    distance = min(distance, (SDF_segment(q, base, (base + (bladeLength * vec2(sin(angle), cos(angle))))) - ((0.5 + h.w) * lw)));
  }
  return distance;
}

float ShipDetails_scuffInk(ShipDetails self_, vec3 p, float t, float lineA, float aa) {
  float cellA = max(sqrt((0.6 / SCUFFS)), 0.12);
  float fill = ((SCUFFS * cellA) * cellA);
  vec3 normal = normalize(p);
  float lat = asin(clamp(normal.y, -1.0, 1.0));
  float lon = atan(normal.x, normal.z);
  float lw = ((0.2 * lineA) * t);
  float distance = 1000000000.0;
  for (int j = -1; (j <= 1); j = (j + 1)) {
    float ring = (floor((lat / cellA)) + float(j));
    float ringCells = max(1.0, floor(((TAU * cos(((ring + 0.5) * cellA))) / cellA)));
    float deltaAngle = (TAU / ringCells);
    for (int i = -1; (i <= 1); i = (i + 1)) {
      vec2 cell = vec2(mod((floor((lon / deltaAngle)) + float(i)), ringCells), ring);
      if ((Noise_hash12(((cell * 1.17) + 3.9)) > fill)) {
        continue;
      }
      vec4 g = vec4(Noise_hash12((cell + 7.3)), Noise_hash12((cell + 19.1)), Noise_hash12((cell + 23.9)), Noise_hash12((cell + 37.3)));
      float cellLat = (((ring + 0.25) + (0.5 * g.x)) * cellA);
      float cellLon = (((cell.x + 0.25) + (0.5 * g.y)) * deltaAngle);
      float _lc0 = cos(cellLat);
      float _gv0 = sin(cellLon);
      float _gv1 = cos(cellLon);
      float _gv2 = (_lc0 * _gv0);
      float _gv3 = (_lc0 * _gv1);
      vec3 center = vec3(_gv2, sin(cellLat), _gv3);
      vec3 east = vec3(_gv1, 0.0, (-_gv0));
      vec3 _lc1 = (normal - center);
      vec2 local = SDF_rotate(vec2(dot(_lc1, east), dot(_lc1, cross(center, east))), (2.4 * (g.z - 0.5)));
      if ((dot(local, local) > 0.0225)) {
        continue;
      }
      float hatchTest = SDF_arch(vec2((atan(_gv2, _gv3) * length(center.xz)), center.y), DOOR_HW, DOOR_Y0, DOOR_Y1);
      if ((hatchTest < 0.15)) {
        continue;
      }
      vec4 h = vec4(Noise_hash12((cell + 41.7)), Noise_hash12((cell + 53.3)), Noise_hash12((cell + 67.1)), Noise_hash12((cell + 79.9)));
      int count = (2 + _f2i((7.0 * g.w)));
      float gap = (0.016 * (0.75 + (0.5 * h.x)));
      float len = (0.001 + ((0.044 * h.y) * h.y));
      float bend = ((((0.6 * gap) * 0.5) * float((count - 1))) * ((2.0 * h.z) - 1.0));
      float curl = step(0.85, h.w);
      distance = min(distance, ShipDetails_tickRow(self_, local, (cell + 101.0), count, gap, len, bend, curl, 0.7, lw));
    }
  }
  return (1.0 - smoothstep((-aa), aa, distance));
}

float Lettering_rect(Lettering self_, vec2 p, float x0, float y0, float x1, float y1) {
  vec2 _sm2_a0 = (p - (0.5 * vec2((x0 + x1), (y0 + y1))));
  vec2 _sm2_a1 = (0.5 * vec2((x1 - x0), (y1 - y0)));
  vec2 _sm2_l_q = (abs(_sm2_a0) - _sm2_a1);
  float _sm2_ret = (length(max(_sm2_l_q, vec2(0.0))) + min(max(_sm2_l_q.x, _sm2_l_q.y), 0.0));
  return _sm2_ret;
}

float Lettering_arc(Lettering self_, vec2 p, vec2 center, float radius, float start, float end) {
  vec2 q = (p - center);
  if ((mod((atan(q.y, q.x) - start), TAU) < (end - start))) {
    return (abs((length(q) - radius)) - self_.strokeWidth);
  }
  return (min(length((q - (radius * vec2(cos(start), sin(start))))), length((q - (radius * vec2(cos(end), sin(end)))))) - self_.strokeWidth);
}

float Lettering_glyph(Lettering self_, vec2 p, int glyphId) {
  float d = 0.0;
  bool _cse0 = (glyphId == 8);
  if ((glyphId == 0)) {
    d = min(Lettering_arc(self_, p, vec2(0.0, 0.2), 0.215, 0.5, PI), Lettering_arc(self_, p, vec2(0.0, -0.2), 0.215, PI, (TAU - 0.5)));
    d = min(d, Lettering_rect(self_, p, -0.3, -0.2, -0.13, 0.2));
  } else if ((glyphId == 1)) {
    d = min((SDF_segment(p, vec2(-0.245, -0.6), vec2(-0.01, 0.6)) - self_.strokeWidth), (SDF_segment(p, vec2(0.245, -0.6), vec2(0.01, 0.6)) - self_.strokeWidth));
    d = min(d, Lettering_rect(self_, p, -0.16, -0.22, 0.16, -0.06));
  } else if (((glyphId == 2) || _cse0)) {
    d = min(Lettering_rect(self_, p, -0.28, -0.5, -0.11, 0.5), Lettering_rect(self_, p, -0.28, 0.33, 0.0, 0.5));
    d = min(d, Lettering_rect(self_, p, -0.28, -0.08, 0.0, 0.09));
    d = min(d, Lettering_arc(self_, p, vec2(0.0, 0.205), 0.21, (-0.5 * PI), (0.5 * PI)));
    if (_cse0) {
      d = min(d, (SDF_segment(p, vec2(0.0, 0.0), vec2(0.24, -0.6)) - self_.strokeWidth));
    }
  } else if ((glyphId == 3)) {
    d = min(Lettering_arc(self_, p, vec2(0.0, 0.2075), 0.2075, 0.4, (1.5 * PI)), Lettering_arc(self_, p, vec2(0.0, -0.2075), 0.2075, (PI + 0.4), (2.5 * PI)));
  } else if ((glyphId == 4)) {
    d = min(Lettering_rect(self_, p, -0.3, -0.2, -0.13, 0.5), Lettering_rect(self_, p, 0.13, -0.2, 0.3, 0.5));
    d = min(d, Lettering_arc(self_, p, vec2(0.0, -0.2), 0.215, PI, TAU));
  } else if ((glyphId == 5)) {
    d = min(Lettering_rect(self_, p, -0.27, -0.5, -0.1, 0.5), Lettering_rect(self_, p, -0.27, -0.5, 0.26, -0.33));
  } else if ((glyphId == 6)) {
    d = min(Lettering_rect(self_, p, -0.27, -0.5, -0.1, 0.5), Lettering_rect(self_, p, -0.27, 0.33, 0.26, 0.5));
    d = min(d, min(Lettering_rect(self_, p, -0.27, -0.085, 0.2, 0.085), Lettering_rect(self_, p, -0.27, -0.5, 0.26, -0.33)));
  } else if ((glyphId == 7)) {
    d = (abs((length(vec2(p.x, (p.y - clamp(p.y, -0.2, 0.2)))) - 0.215)) - self_.strokeWidth);
  } else {
    d = (length((p - vec2(-0.26, -0.4))) - 0.1);
  }
  return max(d, (abs(p.y) - 0.5));
}

float ShipMaterial_celShadow(vec3 ro, vec3 rd, Ship ship, NamekTrees trees) {
  vec3 _sm17_a2 = vec3(0.0, -0.3, 0.0);
  vec3 _sm17_l_oc = (ro - _sm17_a2);
  float _sm17_l_b = dot(_sm17_l_oc, rd);
  float _sm17_l_h = (((_sm17_l_b * _sm17_l_b) - dot(_sm17_l_oc, _sm17_l_oc)) + 4.0);
  float _sm17_ret = ((_sm17_l_h > 0.0) ? ((-_sm17_l_b) + sqrt(_sm17_l_h)) : 0.0);
  float tmax = _sm17_ret;
  float _sm10_l_firstExit = NamekTrees_sphereExit(trees, ro, rd, NamekTree_shadowCenter(trees.first), NamekTree_shadowRadius(trees.first));
  float _sm10_l_secondExit = NamekTrees_sphereExit(trees, ro, rd, NamekTree_shadowCenter(trees.second), NamekTree_shadowRadius(trees.second));
  float _sm10_ret = max(tmax, max(_sm10_l_firstExit, _sm10_l_secondExit));
  tmax = _sm10_ret;
  tmax = min(tmax, 9.0);
  if ((tmax < 0.02)) {
    return 1.0;
  }
  float result = 1.0;
  float t = 0.02;
  for (int i = 0; (i < 64); i = (i + 1)) {
    vec3 _sm18_a0 = (ro + (rd * t));
    vec2 _sm18_l_result = Ship_map(ship, _sm18_a0);
    _sm18_l_result = SDF_union(_sm18_l_result, NamekTrees_map(trees, _sm18_a0));
    float h = _sm18_l_result.x;
    result = min(result, ((10.0 * h) / t));
    t += clamp(h, 0.01, 0.3);
    if (((result < 0.0) || (t > tmax))) {
      break;
    }
  }
  return smoothstep(0.25, 0.4, result);
}

float Terrain_coast(vec2 x) {
  return ((length(x) - COAST_R) - (7.0 * (Noise_fbm(((x * 0.09) + 7.0)) - 0.5)));
}

float Terrain_mesaField(vec2 x) {
  float field = (Noise_fbm(((x * 0.05) + vec2(4.3, -2.1))) + (0.04 * Noise_value((x * 0.8))));
  field -= (0.4 * (1.0 - smoothstep(MESA_R, 30.0, length(x))));
  field += (0.25 * (1.0 - smoothstep(3.0, 9.0, length((x - vec2(-21.0, -22.0))))));
  return field;
}

float Terrain_heightAt(vec2 x) {
  float field = Terrain_mesaField(x);
  return ((GROUND + (1.3 * smoothstep(0.63, 0.64, field))) + (0.55 * smoothstep(0.71, 0.72, field)));
}

vec3 Terrain_normal(vec2 x, float t) {
  float stepSize = (0.02 + (0.002 * t));
  vec2 gradient = vec2(0.0);
  vec2 gradient_1 = (gradient - (CROSS[0] * Terrain_heightAt((x + (stepSize * CROSS[0])))));
  vec2 gradient_2 = (gradient_1 - (CROSS[1] * Terrain_heightAt((x + (stepSize * CROSS[1])))));
  vec2 gradient_3 = (gradient_2 - (CROSS[2] * Terrain_heightAt((x + (stepSize * CROSS[2])))));
  vec2 gradient_4 = (gradient_3 - (CROSS[3] * Terrain_heightAt((x + (stepSize * CROSS[3])))));
  return normalize(vec3(gradient_4.x, (2.0 * stepSize), gradient_4.y));
}

float Terrain_march(vec3 ro, vec3 rd, float tmax) {
  bool _licm0 = (rd.y > 0.0);
  float ceil = (GROUND + 1.9);
  float planeT = ((rd.y < 0.0) ? ((GROUND - ro.y) / rd.y) : 10000000000.0);
  float a = max(dot(rd.xz, rd.xz), 0.000001);
  float b = dot(ro.xz, rd.xz);
  float c = (dot(ro.xz, ro.xz) - (MESA_R * MESA_R));
  float t = (((-b) + sqrt(max(((b * b) - (a * c)), 0.0))) / a);
  float end = min(planeT, tmax);
  float previousT = t;
  for (int i = 0; (i < 200); i = (i + 1)) {
    if ((t > end)) {
      break;
    }
    vec3 p = (ro + (rd * t));
    if (((p.y > ceil) && _licm0)) {
      break;
    }
    float clearance = (p.y - Terrain_heightAt(p.xz));
    if ((clearance < 0.0)) {
      for (int j = 0; (j < 6); j = (j + 1)) {
        float middle = (0.5 * (previousT + t));
        vec3 q = (ro + (rd * middle));
        if ((q.y < Terrain_heightAt(q.xz))) {
          t = middle;
        } else {
          previousT = middle;
        }
      }
      return (0.5 * (previousT + t));
    }
    previousT = t;
    t += max((0.3 * clearance), (0.02 + (0.015 * t)));
  }
  return ((planeT < tmax) ? planeT : -1.0);
}

vec2 Terrain_groundWarp(vec2 x) {
  vec2 _cse0 = (x * 0.8);
  vec2 q = vec2(Noise_fbm((_cse0 + 2.0)), Noise_fbm((_cse0 + 8.3)));
  vec2 _cse1 = (x * 1.6);
  vec2 _lc0 = (_cse1 + (3.0 * q));
  return (x + (1.2 * (vec2(Noise_fbm((_lc0 + 1.7)), Noise_fbm((_lc0 + 9.2))) - 0.5)));
}

float Terrain_dirtField(vec2 xw) {
  return (Noise_fbm(((xw * 0.7) + vec2(-13.7, 31.9))) - 0.62);
}

float Terrain_tickRow(vec2 q, vec2 seed, int n, float gap, float len, float bend, float curl, float spread, float lw) {
  float _licm0 = max((-bend), 0.0);
  float _licm1 = (0.4 * gap);
  float _licm2 = (0.35 * len);
  float mid = (0.5 * float((n - 1)));
  float radius = (((2.0 * mid) * gap) / PI);
  float signBend = ((bend < 0.0) ? -1.0 : 1.0);
  float distance = 1000000000.0;
  for (int k = 0; (k < 9); k = (k + 1)) {
    if ((k >= n)) {
      break;
    }
    float _gv1 = float(k);
    float _gv0 = (_gv1 - mid);
    float fk = (_gv0 / mid);
    vec4 h = vec4(Noise_hash12(((seed + (_gv1 * 3.1)) + 51.0)), Noise_hash12(((seed + (_gv1 * 5.7)) + 63.0)), Noise_hash12(((seed + (_gv1 * 2.3)) + 77.0)), Noise_hash12(((seed + (_gv1 * 4.9)) + 89.0)));
    vec2 base = vec2((gap * _gv0), (((bend * fk) * fk) + _licm0));
    base = _flow9_shared(base, radius, fk, signBend, curl);
    base += vec2((_licm1 * (h.x - 0.5)), (_licm2 * h.y));
    float bladeLength = (len * (1.0 - (spread * Noise_hash12(((seed + (_gv1 * 6.1)) + 97.0)))));
    float angle = (0.5 * (h.z - 0.5));
    distance = min(distance, (SDF_segment(q, base, (base + (bladeLength * vec2(sin(angle), cos(angle))))) - ((0.5 + h.w) * lw)));
  }
  return distance;
}

float Terrain_grassInk(vec2 x, vec3 ro, float t, float pixA, float lineA) {
  vec2 _licm0 = ro.xz;
  float _licm1 = (0.14 * lineA);
  float _licm2 = (0.7 * pixA);
  if ((t > 12.0)) {
    return 0.0;
  }
  float eye = (ro.y - GROUND);
  vec2 view = (x - _licm0);
  float distanceToPoint = length(view);
  vec2 forward = (view / distanceToPoint);
  vec2 side = vec2((-forward.y), forward.x);
  float reach = (((distanceToPoint * 2.2) * 0.015) / eye);
  vec2 centerCell = floor(((x - ((0.5 * reach) * forward)) / 0.4));
  float ink = 0.0;
  for (int j = -1; (j <= 1); j = (j + 1)) {
    for (int i = -1; (i <= 1); i = (i + 1)) {
      vec2 cell = (centerCell + vec2(float(i), float(j)));
      if ((Noise_hash12(((cell * 1.31) + 5.7)) > 0.55)) {
        continue;
      }
      vec2 center = (((cell + 0.2) + (0.6 * vec2(Noise_hash12((cell + 7.3)), Noise_hash12((cell + 19.1))))) * 0.4);
      float alongRay = dot((center - _licm0), forward);
      if (((alongRay > distanceToPoint) || (alongRay < (distanceToPoint - reach)))) {
        continue;
      }
      vec2 local = vec2(dot((_licm0 - center), side), (eye * (1.0 - (alongRay / distanceToPoint))));
      if ((abs(local.x) > 0.1)) {
        continue;
      }
      if (((Terrain_dirtField(Terrain_groundWarp(center)) > -0.04) || (Terrain_coast(center) > -0.8))) {
        continue;
      }
      int count = (3 + _f2i((5.0 * Noise_hash12((cell + 31.7)))));
      float bend = (0.010499999999999999 * ((2.0 * Noise_hash12((cell + 43.1))) - 1.0));
      float rowT = ((t * alongRay) / distanceToPoint);
      float lw = (_licm1 * rowT);
      float aa = (_licm2 * rowT);
      float distance = Terrain_tickRow(local, cell, count, 0.02, 0.015, bend, 0.0, 0.0, lw);
      ink = max(ink, (1.0 - smoothstep((-aa), aa, distance)));
    }
  }
  return (ink * (1.0 - smoothstep(8.0, 12.0, t)));
}

float Terrain_brush(vec2 a, vec2 m, vec2 b, float width, float taper) {
  vec2 ma = (m - a);
  vec2 bm = (b - m);
  float h1 = clamp(((-dot(a, ma)) / max(dot(ma, ma), 0.000001)), 0.0, 1.0);
  float h2 = clamp(((-dot(m, bm)) / max(dot(bm, bm), 0.000001)), 0.0, 1.0);
  float d1 = length((a + (ma * h1)));
  float d2 = length((m + (bm * h2)));
  float along = ((d1 < d2) ? (0.5 * h1) : (0.5 + (0.5 * h2)));
  return (min(d1, d2) - (width * mix(1.0, (0.3 + (0.7 * sqrt(sin((PI * along))))), taper)));
}

float Terrain_dirtStrokes(vec2 x, vec2 eye, mat2 jacobian, float lw) {
  float _licm0 = (3.2 * lw);
  float _licm1 = (2.0 * lw);
  float _licm2 = (0.95 * lw);
  vec2 centerCell = floor((x * 2.0));
  float distance = 1000000000.0;
  for (int j = -1; (j <= 1); j = (j + 1)) {
    for (int i = -1; (i <= 1); i = (i + 1)) {
      vec2 cell = (centerCell + vec2(float(i), float(j)));
      if ((Noise_hash12(((cell * 1.71) + 2.3)) > 0.35)) {
        continue;
      }
      vec4 g = vec4(Noise_hash12((cell + 11.3)), Noise_hash12((cell + 23.7)), Noise_hash12((cell + 31.1)), 0.0);
      vec4 h = vec4(Noise_hash12((cell + 53.1)), Noise_hash12((cell + 61.9)), Noise_hash12((cell + 71.3)), Noise_hash12((cell + 83.7)));
      vec2 center = (((cell + 0.25) + (0.5 * g.xy)) * 0.5);
      vec2 view = normalize((center - eye));
      vec2 direction = SDF_rotate(vec2((-view.y), view.x), (DIRT_TILT + (0.35 * (g.z - 0.5))));
      vec2 centerPixels = (jacobian * (center - x));
      vec2 directionPixels = (jacobian * direction);
      float directionLength = length(directionPixels);
      vec2 perpendicular = (vec2((-directionPixels.y), directionPixels.x) / directionLength);
      float spacing = (0.12 + (0.025 * h.z));
      float screenSpacing = max((spacing * abs(dot((jacobian * vec2((-direction.y), direction.x)), perpendicular))), _licm0);
      if ((length(centerPixels) > (((0.35 * directionLength) + (2.0 * screenSpacing)) + _licm1))) {
        continue;
      }
      if (((Terrain_dirtField(Terrain_groundWarp(center)) < 0.015) || (Terrain_coast(center) > -1.5))) {
        continue;
      }
      int count = (2 + _f2i(((2.2 * h.y) * h.y)));
      float shift = (0.06 * (h.w - 0.5));
      float bow = (0.2 * (h.x - 0.5));
      for (int k = 0; (k < 4); k = (k + 1)) {
        if ((k >= count)) {
          break;
        }
        float _gv0 = float(k);
        float offset = (_gv0 - (0.5 * float((count - 1))));
        float halfLength = (0.18 * (0.3 + (0.7 * Noise_hash12(((cell + (_gv0 * 7.3)) + 91.0)))));
        vec2 position = ((centerPixels + ((perpendicular * offset) * screenSpacing)) + (directionPixels * ((offset * shift) + (0.06 * (Noise_hash12(((cell + (_gv0 * 5.1)) + 97.0)) - 0.5)))));
        vec2 _lc0 = (directionPixels * halfLength);
        distance = min(distance, Terrain_brush((position - _lc0), (position + (((perpendicular * bow) * halfLength) * directionLength)), (position + _lc0), _licm2, 1.0));
      }
    }
  }
  return distance;
}

float Terrain_dirtDots(vec2 x, vec2 eye, mat2 jacobian, float lw) {
  float _licm0 = ((16.0 * lw) * lw);
  vec2 centerCell = floor((x / 0.16));
  float crowd = min(1.0, ((0.0256 * abs(determinant(jacobian))) / ((60.0 * lw) * lw)));
  float distance = 1000000000.0;
  for (int j = -1; (j <= 1); j = (j + 1)) {
    for (int i = -1; (i <= 1); i = (i + 1)) {
      vec2 cell = (centerCell + vec2(float(i), float(j)));
      vec4 g = vec4(Noise_hash12((cell + 5.9)), Noise_hash12((cell + 17.3)), Noise_hash12((cell + 29.5)), Noise_hash12((cell + 43.1)));
      vec2 center = (((cell + 0.1) + (0.8 * g.xy)) * 0.16);
      float probability = (0.03 + (0.7 * smoothstep(0.5, 0.72, Noise_value(((center * 2.2) + 71.0)))));
      if ((Noise_hash12(((cell * 1.37) + 9.1)) > (probability * crowd))) {
        continue;
      }
      vec2 centerPixels = (jacobian * (center - x));
      if ((dot(centerPixels, centerPixels) > _licm0)) {
        continue;
      }
      if (((Terrain_dirtField(Terrain_groundWarp(center)) < 0.03) || (Terrain_coast(center) > -1.0))) {
        continue;
      }
      vec2 view = normalize((center - eye));
      vec2 direction = normalize((jacobian * SDF_rotate(vec2((-view.y), view.x), (DIRT_TILT + (0.6 * (g.z - 0.5))))));
      float halfLength = ((0.3 + ((1.5 * g.w) * g.w)) * lw);
      vec2 edge = (halfLength * direction);
      distance = min(distance, Terrain_brush((centerPixels - edge), centerPixels, (centerPixels + edge), ((1.0 + (0.35 * Noise_hash12((cell + 57.7)))) * lw), 0.0));
    }
  }
  return distance;
}

float Terrain_dirtInk(vec2 x, vec2 eye, float t, mat2 jacobian, float lw) {
  if ((t > 14.0)) {
    return 0.0;
  }
  float distance = min(Terrain_dirtStrokes(x, eye, jacobian, lw), Terrain_dirtDots(x, eye, jacobian, lw));
  return ((1.0 - smoothstep(-0.5, 0.5, distance)) * (1.0 - smoothstep(10.0, 14.0, t)));
}

vec2 NamekScene_mapCel(NamekScene self_, vec3 p) {
  vec2 result = Ship_map(self_.ship, p);
  result = SDF_union(result, NamekTrees_map(self_.trees, p));
  return result;
}

vec3 NamekScene_calcNormal(NamekScene self_, vec3 p) {
  vec3 normal = vec3(0.0);
  vec3 normal_1 = (normal + (TET[0] * NamekScene_mapCel(self_, (p + (0.0007 * TET[0]))).x));
  vec3 normal_2 = (normal_1 + (TET[1] * NamekScene_mapCel(self_, (p + (0.0007 * TET[1]))).x));
  vec3 normal_3 = (normal_2 + (TET[2] * NamekScene_mapCel(self_, (p + (0.0007 * TET[2]))).x));
  vec3 normal_4 = (normal_3 + (TET[3] * NamekScene_mapCel(self_, (p + (0.0007 * TET[3]))).x));
  return normalize(normal_4);
}

MarchResult NamekScene_marchCel(NamekScene self_, vec3 ro, vec3 rd, float lineA, float pixA) {
  float edge = 0.0;
  float windowEdge = 0.0;
  float edgeT = 10000000000.0;
  float t = 0.5;
  vec2 previous = vec2(10000000000.0, -1.0);
  for (int i = 0; (i < 180); i = (i + 1)) {
    vec2 hit = NamekScene_mapCel(self_, (ro + (rd * t)));
    if ((hit.x < (0.0003 * t))) {
      return MarchResult_new(vec2(t, hit.y), edge, windowEdge, edgeT);
    }
    float width = (lineA * t);
    if (((hit.x > previous.x) && (previous.x < width))) {
      float contour = clamp(((width - previous.x) / (pixA * t)), 0.0, 1.0);
      if ((abs((previous.y - 2.5)) < 1.0)) {
        windowEdge = max(windowEdge, contour);
      } else {
        edge = max(edge, contour);
      }
      edgeT = min(edgeT, t);
    }
    previous = hit;
    t += hit.x;
    if ((t > 24.0)) {
      break;
    }
  }
  return MarchResult_new(vec2(t, -1.0), edge, windowEdge, edgeT);
}

float _flow12_shared(float _flow10_input, float _flow11_input) {
  return (0.03 * ((abs((_flow10_input - 0.5)) + (0.5 * abs((_flow11_input - 0.5)))) - 0.35));
}

mat2 inverseMat2(float a, float b, float c, float d) {
  float determinant = ((a * d) - (b * c));
  return mat2(vec2((d / determinant), ((-b) / determinant)), vec2(((-c) / determinant), (a / determinant)));
}

float _flow17_shared(float _flow13_input, float _flow14_input, float _flow15_input, float _flow16_input) {
  return ((0.5 + ((_flow13_input - 0.5) * (0.5 + _flow14_input))) + ((0.7 * (_flow15_input - 0.5)) * smoothstep(0.35, 0.75, _flow16_input)));
}

float _flow21_shared(float _flow18_input, float _flow19_input, float _flow20_input) {
  float _cse0 = (0.02 * _flow19_input);
  return max(_flow18_input, smoothstep((0.61 - _cse0), (0.615 - _cse0), _flow20_input));
}

vec3 NamekScene_render(NamekScene self_, vec3 ro, vec3 rd, float pixA, float lineA) {
  MarchResult march = NamekScene_marchCel(self_, ro, rd, lineA, pixA);
  float edge = march.edge;
  if ((abs((march.hit.y - 2.5)) > 1.0)) {
    edge = max(edge, march.winEdge);
  }
  bool shipHit = (march.hit.y >= 0.0);
  float terrainT = Terrain_march(ro, rd, (shipHit ? march.hit.x : 400.0));
  vec3 _cse0 = vec3(0.0);
  vec3 col = _cse0;
  float frontT = 10000000000.0;
  vec3 _gv0 = (ro + (rd * terrainT));
  vec2 x_h1 = _gv0.xz;
  vec2 warped_h2 = Terrain_groundWarp(x_h1);
  float dirt_h3 = Terrain_dirtField(warped_h2);
  float hoist_d_h4 = dFdx(dirt_h3);
  float hoist_d_h5 = dFdy(dirt_h3);
  dirt_h3 += _flow12_shared(Noise_value((x_h1 * 5.0)), Noise_value(((x_h1 * 11.0) + 7.0)));
  float hoist_d_h6 = dFdx(dirt_h3);
  float hoist_d_h7 = dFdy(dirt_h3);
  vec2 hoist_d_h8 = dFdx(x_h1);
  vec2 hoist_d_h9 = dFdy(x_h1);
  if ((shipHit && (terrainT < 0.0))) {
    vec3 p = (ro + (rd * march.hit.x));
    vec3 _sm16_a1 = NamekScene_calcNormal(self_, p);
    float _sm16_a3 = march.hit.y;
    float _sm16_a4 = march.hit.x;
    Ship _sm16_a7 = self_.ship;
    NamekTrees _sm16_a8 = self_.trees;
    ShipDetails _sm16_a9 = self_.details;
    Lettering _sm16_a10 = self_.lettering;
    float _sm16_l_aa = (((0.7 * pixA) * _sm16_a4) / max(dot(_sm16_a1, (-rd)), 0.3));
    float _sm16_l_lw = ((0.5 * lineA) * _sm16_a4);
    float _sm16_l_lightAmount = smoothstep(-0.02, 0.02, dot(_sm16_a1, LIG));
    if ((_sm16_l_lightAmount > 0.0)) {
      _sm16_l_lightAmount *= ShipMaterial_celShadow((p + (_sm16_a1 * 0.004)), LIG, _sm16_a7, _sm16_a8);
    }
    vec3 _cse1 = vec3(1.0);
    vec3 _sm16_l_lit = mix(SHADE, _cse1, _sm16_l_lightAmount);
    vec3 _sm16_l_col = _cse0;
    if ((_sm16_a3 < 0.5)) {
      float _gv1 = (-_sm16_l_aa);
      float _sm16_l_cap = smoothstep(_gv1, _sm16_l_aa, (p.y - (RING_Y + RING_H)));
      float _sm16_l_band = (smoothstep(_gv1, _sm16_l_aa, (p.y - BAND_BOT)) - smoothstep(_gv1, _sm16_l_aa, (p.y - BAND_TOP)));
      vec3 _sm16_l_viewDirection = normalize(((_sm16_a4 * rd) - p));
      vec3 _sm16_l_viewRight = normalize(cross(_sm16_l_viewDirection, vec3(0.0, 1.0, 0.0)));
      vec3 _sm16_l_sm12_a3 = cross(_sm16_l_viewRight, _sm16_l_viewDirection);
      vec3 _sm16_l_sm12_l_sheenCenter = ((0.6 * _sm16_l_sm12_a3) - (0.8 * _sm16_l_viewRight));
      float _sm16_l_sm12_l_c0 = cos((SHEEN_R + (0.1 * (Noise_value((7.0 * vec2(dot(_sm16_a1, _sm16_l_viewRight), dot(_sm16_a1, _sm16_l_sm12_a3)))) - 0.5))));
      float _sm16_l_sm12_l_rho = max(length(_sm16_a1.xz), 0.0001);
      float _sm16_l_sm12_l_hH = length(_sm16_l_sm12_l_sheenCenter.xz);
      float _sm16_l_sm12_l_m = (_sm16_a1.y * _sm16_l_sm12_l_sheenCenter.y);
      float _sm16_l_sm12_l_w = (_sm16_l_sm12_l_rho * _sm16_l_sm12_l_hH);
      float _sm16_l_sm12_l_angle = acos(clamp((dot(_sm16_a1.xz, _sm16_l_sm12_l_sheenCenter.xz) / _sm16_l_sm12_l_w), -1.0, 1.0));
      float _sm16_l_sm12_l_q = ((_sm16_l_sm12_l_c0 - _sm16_l_sm12_l_m) / _sm16_l_sm12_l_w);
      float _sm16_l_sm12_l_e = 0.0;
      float _sm16_l_sm12_l_de = 0.0;
      if ((abs(_sm16_l_sm12_l_q) < 1.0)) {
        float _sm16_l_sm12_l_lit = acos(_sm16_l_sm12_l_q);
        float _gv2 = (_sm16_l_sm12_l_lit - _sm16_l_sm12_l_angle);
        _sm16_l_sm12_l_e = (_sm16_l_sm12_l_rho * _gv2);
        _sm16_l_sm12_l_de = (((-_sm16_a1.y) * _gv2) - (((_sm16_l_sm12_l_c0 * _sm16_a1.y) - _sm16_l_sm12_l_sheenCenter.y) / (_sm16_l_sm12_l_w * max(sqrt((1.0 - (_sm16_l_sm12_l_q * _sm16_l_sm12_l_q))), 0.05))));
      } else {
        float _gv3 = sign(_sm16_l_sm12_l_q);
        float _sm16_l_sm12_l_hm = (_sm16_l_sm12_l_m + (_gv3 * _sm16_l_sm12_l_w));
        float _sm16_l_sm12_l_gap = (abs((_sm16_l_sm12_l_c0 - _sm16_l_sm12_l_hm)) / sqrt(max((1.0 - (_sm16_l_sm12_l_hm * _sm16_l_sm12_l_hm)), 0.0001)));
        float _sm16_l_sm12_l_arc = ((_sm16_l_sm12_l_q > 0.0) ? _sm16_l_sm12_l_angle : (PI - _sm16_l_sm12_l_angle));
        _sm16_l_sm12_l_e = ((-_gv3) * (_sm16_l_sm12_l_gap + (_sm16_l_sm12_l_rho * _sm16_l_sm12_l_arc)));
        _sm16_l_sm12_l_de = ((_gv3 * _sm16_a1.y) * _sm16_l_sm12_l_arc);
      }
      float _sm16_l_sm12_l_s = (asin(clamp(_sm16_a1.y, -1.0, 1.0)) / HATCH_W);
      float _sm16_l_sm12_l_c1 = floor((_sm16_l_sm12_l_s + 0.5));
      float _sm16_l_sm12_l_u1 = (_sm16_l_sm12_l_s - _sm16_l_sm12_l_c1);
      float _sm16_l_sm12_l_c2 = floor(_sm16_l_sm12_l_s);
      float _sm16_l_sm12_l_u2 = ((_sm16_l_sm12_l_s - _sm16_l_sm12_l_c2) - 0.5);
      float _sm16_l_sm12_l_fit = min(1.0, ((1.25 * _sm16_l_sm12_l_rho) / max(HATCH_L, HATCH_D)));
      float _sm16_l_sm12_l_lightLength = ((_sm16_l_sm12_l_fit * HATCH_L) * (0.15 + (0.85 * Noise_hash12(vec2(_sm16_l_sm12_l_c1, 3.1)))));
      float _sm16_l_sm12_l_darkLength = ((_sm16_l_sm12_l_fit * HATCH_D) * (0.15 + (0.85 * Noise_hash12(vec2(_sm16_l_sm12_l_c2, 7.7)))));
      float _sm16_l_sm12_l_z = ((_sm16_l_sm12_l_e + (_sm16_l_sm12_l_lightLength * (1.0 - (2.0 * abs(_sm16_l_sm12_l_u1))))) - (_sm16_l_sm12_l_darkLength * (1.0 - (2.0 * abs(_sm16_l_sm12_l_u2)))));
      float _sm16_l_sm12_l_dz = (_sm16_l_sm12_l_de + ((2.0 * ((_sm16_l_sm12_l_darkLength * sign(_sm16_l_sm12_l_u2)) - (_sm16_l_sm12_l_lightLength * sign(_sm16_l_sm12_l_u1)))) / HATCH_W));
      float _sm16_l_sm12_ret = smoothstep(_gv1, _sm16_l_aa, (_sm16_l_sm12_l_z / sqrt((1.0 + (_sm16_l_sm12_l_dz * _sm16_l_sm12_l_dz)))));
      vec3 _sm16_l_blackPaint = (mix(BLACK, BLACK_HI, _sm16_l_sm12_ret) * mix(0.7, 1.0, _sm16_l_lightAmount));
      float _sm16_l_dark = max(_sm16_l_cap, _sm16_l_band);
      _sm16_l_col = mix((HULL * _sm16_l_lit), _sm16_l_blackPaint, _sm16_l_dark);
      float _sm16_l_sm14_l_longitude = atan(p.x, p.z);
      float _sm16_l_sm14_l_latitude = asin(clamp((p.y / length(p)), -1.0, 1.0));
      float _sm16_l_sm14_l_ink = 0.0;
      vec2 _sm16_l_sm14_l_caps = (vec2(((_sm16_l_sm14_l_longitude - CAPS_LON) * cos(CAPS_LAT)), (_sm16_l_sm14_l_latitude - CAPS_LAT)) / CAPS_H);
      float _sm16_l_sm14_l_index = floor(((_sm16_l_sm14_l_caps.x / ADV) + 3.5));
      if ((((abs(_sm16_l_sm14_l_caps.y) < 0.6) && (_sm16_l_sm14_l_index >= 0.0)) && (_sm16_l_sm14_l_index < 7.0))) {
        _sm16_l_sm14_l_ink = (1.0 - smoothstep(_gv1, _sm16_l_aa, (CAPS_H * Lettering_glyph(_sm16_a10, vec2((_sm16_l_sm14_l_caps.x - ((_sm16_l_sm14_l_index - 3.0) * ADV)), _sm16_l_sm14_l_caps.y), _f2i(_sm16_l_sm14_l_index)))));
      }
      vec2 _sm16_l_sm14_l_corp = (vec2(((_sm16_l_sm14_l_longitude - CORP_LON) * cos(CORP_LAT)), (_sm16_l_sm14_l_latitude - CORP_LAT)) / CORP_H);
      _sm16_l_sm14_l_index = floor(((_sm16_l_sm14_l_corp.x / ADV) + 2.5));
      if ((((abs(_sm16_l_sm14_l_corp.y) < 0.6) && (_sm16_l_sm14_l_index >= 0.0)) && (_sm16_l_sm14_l_index < 5.0))) {
        int _sm16_l_sm14_l_glyphId = ((_sm16_l_sm14_l_index < 0.5) ? 0 : ((_sm16_l_sm14_l_index < 1.5) ? 7 : ((_sm16_l_sm14_l_index < 2.5) ? 8 : ((_sm16_l_sm14_l_index < 3.5) ? 2 : 9))));
        _sm16_l_sm14_l_ink = max(_sm16_l_sm14_l_ink, (1.0 - smoothstep(_gv1, _sm16_l_aa, (CORP_H * Lettering_glyph(_sm16_a10, vec2((_sm16_l_sm14_l_corp.x - ((_sm16_l_sm14_l_index - 2.0) * ADV)), _sm16_l_sm14_l_corp.y), _sm16_l_sm14_l_glyphId)))));
      }
      _sm16_l_col = mix(_sm16_l_col, INK, max(_sm16_l_sm14_l_ink, ((1.0 - _sm16_l_dark) * ShipDetails_scuffInk(_sm16_a9, p, _sm16_a4, lineA, _sm16_l_aa))));
    } else if ((_sm16_a3 < 1.5)) {
      float _sm16_l_dy = abs((p.y - RING_Y));
      _sm16_l_col = (HULL * _sm16_l_lit);
      float _lc1 = (0.6 * _sm16_l_lw);
      float _sm16_l_ink = (1.0 - smoothstep((_lc1 - _sm16_l_aa), (_lc1 + _sm16_l_aa), _sm16_l_dy));
      float _lc2 = (RING_H - (1.3 * _sm16_l_lw));
      _sm16_l_ink = max(_sm16_l_ink, smoothstep((_lc2 - _sm16_l_aa), (_lc2 + _sm16_l_aa), _sm16_l_dy));
      _sm16_l_col = mix(_sm16_l_col, INK, _sm16_l_ink);
    } else if ((_sm16_a3 < 2.5)) {
      _spec1_result _sm16_l_windowFrame = _spec0_SDF_polarY(atan(p.x, p.z), length(p.xz), p.y, WIN_N, 0.0);
      vec3 _sm16_l_q = _sm16_l_windowFrame.point;
      vec3 _sm16_l_center = vec3(0.0, WIN_Y, sqrt((1.0 - (WIN_Y * WIN_Y))));
      vec2 _sm16_l_w = vec2(_sm16_l_q.x, dot((_sm16_l_q - _sm16_l_center), normalize((vec3(0.0, 1.0, 0.0) - (_sm16_l_center * WIN_Y)))));
      float _sm16_l_radius = length(_sm16_l_w);
      _sm16_l_col = mix(GLASS_HI, GLASS_LO, smoothstep((0.1 - _sm16_l_aa), (0.1 + _sm16_l_aa), length((_sm16_l_w - vec2(-0.035, 0.04)))));
      float _sm16_l_streak = (abs((_sm16_l_radius - 0.062)) - 0.011);
      _sm16_l_streak = max(_sm16_l_streak, ((abs((atan(_sm16_l_w.y, _sm16_l_q.x) - 2.25)) * _sm16_l_radius) - 0.035));
      _sm16_l_col = mix(_sm16_l_col, vec3(0.93, 0.98, 1.0), (1.0 - smoothstep((-_sm16_l_aa), _sm16_l_aa, _sm16_l_streak)));
      _sm16_l_col *= mix(0.8, 1.0, _sm16_l_lightAmount);
    } else if ((_sm16_a3 < 3.5)) {
      _sm16_l_col = (METAL * _sm16_l_lit);
    } else if ((_sm16_a3 < 4.5)) {
      float _sm16_l_doorDistance = SDF_arch(vec2((atan(p.x, p.z) * length(p.xz)), p.y), DOOR_HW, DOOR_Y0, DOOR_Y1);
      float _sm16_l_top = ((length(p) - 1.0) - DOOR_T);
      _sm16_l_col = (HULL * _sm16_l_lit);
      float _sm16_l_ink_1 = (1.0 - smoothstep((_sm16_l_lw - _sm16_l_aa), (_sm16_l_lw + _sm16_l_aa), length(vec2(_sm16_l_doorDistance, _sm16_l_top))));
      float _lc3 = (0.7 * _sm16_l_lw);
      _sm16_l_ink_1 = max(_sm16_l_ink_1, (1.0 - smoothstep((_lc3 - _sm16_l_aa), (_lc3 + _sm16_l_aa), length(vec2(_sm16_l_doorDistance, (_sm16_l_top + DOOR_T))))));
      _sm16_l_col = mix(_sm16_l_col, INK, _sm16_l_ink_1);
    } else if ((_sm16_a3 < 7.5)) {
      _sm16_l_col = (METAL * mix(vec3(0.5, 0.6, 0.78), _cse1, _sm16_l_lightAmount));
    } else if ((_sm16_a3 < 8.5)) {
      _sm16_l_col = (TRUNK * _sm16_l_lit);
    } else if ((_sm16_a3 < 9.5)) {
      float _sm22_l_firstDistance = length((p.xz - _sm16_a8.first.position));
      float _sm22_l_secondDistance = length((p.xz - _sm16_a8.second.position));
      NamekTree _sm22_l_spec5_returned;
      if ((_sm22_l_firstDistance < _sm22_l_secondDistance)) {
        _sm22_l_spec5_returned = _sm16_a8.first;
      } else {
        _sm22_l_spec5_returned = _sm16_a8.second;
      }
      _spec4_result _sm22_ret = _spec4_result(_sm22_l_spec5_returned.position, _sm22_l_spec5_returned.height);
      vec3 _sm16_l_normal = normalize((p - vec3(_sm22_ret.position.x, (GROUND + _sm22_ret.height), _sm22_ret.position.y)));
      float _sm16_l_k = (dot(normalize((_sm16_l_normal + (0.5 * _sm16_a1))), LIG) + (0.15 * (Noise_value(((_sm16_l_normal.xy * 9.0) + (_sm16_l_normal.z * 5.0))) - 0.5)));
      _sm16_l_col = mix((LEAF * vec3(0.72, 0.78, 0.9)), LEAF, (smoothstep(0.0, 0.04, _sm16_l_k) * ShipMaterial_celShadow((p + (_sm16_a1 * 0.01)), LIG, _sm16_a7, _sm16_a8)));
      _sm16_l_col = mix(_sm16_l_col, LEAF_HI, smoothstep(0.55, 0.59, _sm16_l_k));
    } else if ((_sm16_a3 < 10.5)) {
      PolarResult _sm16_l_legFrame = SDF_polarY(atan(p.x, p.z), length(p.xz), p.y, 4.0, LEG_LON);
      vec3 _sm16_l_local = Ship_flapHome(_sm16_a7, _sm16_l_legFrame.point);
      vec2 _sm16_l_rotated = SDF_rotate(_sm16_l_local.xz, ((-LEG_LON) - ((0.5 * PI) * _sm16_l_legFrame.index)));
      _sm16_l_col = mix((HULL * _sm16_l_lit), INK, ShipDetails_scuffInk(_sm16_a9, vec3(_sm16_l_rotated.x, _sm16_l_local.y, _sm16_l_rotated.y), _sm16_a4, lineA, _sm16_l_aa));
    } else if ((_sm16_a3 < 11.5)) {
      _sm16_l_col = mix(_cse0, (HULL * _sm16_l_lit), smoothstep((-_sm16_l_aa), _sm16_l_aa, ((length(p) - 1.0) + FLAP_T)));
    } else {
      _sm16_l_col = mix(_cse0, (HULL * _sm16_l_lit), smoothstep((-_sm16_l_aa), _sm16_l_aa, ((length(p.xz) - BELLY_R) + FLAP_T)));
    }
    col = _sm16_l_col;
    frontT = march.hit.x;
  } else if ((terrainT > 0.0)) {
    Ship _sm19_a5 = self_.ship;
    NamekTrees _sm19_a6 = self_.trees;
    vec3 _sel1;
    if ((length(_gv0.xz) > MESA_R)) {
      _sel1 = Terrain_normal(_gv0.xz, terrainT);
    } else {
      _sel1 = vec3(0.0, 1.0, 0.0);
    }
    vec3 _sm19_l_normal = _sel1;
    vec2 _sm19_l_x = _gv0.xz;
    float _sm19_l_radius = length(_sm19_l_x);
    float _sm19_l_height = (_gv0.y - GROUND);
    vec2 _sm19_l_warped = Terrain_groundWarp(_sm19_l_x);
    vec3 _sm19_l_col = mix(GRASS, GRASS_DK, (0.6 * smoothstep(0.55, 0.56, Noise_fbm(((_sm19_l_warped * 1.1) + 3.0)))));
    float _sm19_l_dirt = Terrain_dirtField(_sm19_l_warped);
    vec2 _sm19_l_dirtGradient = vec2(hoist_d_h4, hoist_d_h5);
    float _sm19_l_recede = smoothstep(0.25, 0.6, (abs(hoist_d_h4) / max(length(_sm19_l_dirtGradient), 0.000001)));
    _sm19_l_dirt += _flow12_shared(Noise_value((_sm19_l_x * 5.0)), Noise_value(((_sm19_l_x * 11.0) + 7.0)));
    float _sm19_l_fieldWidth = max(length(vec2(hoist_d_h6, hoist_d_h7)), 0.00001);
    mat2 _sm19_l_jacobian = mat2(hoist_d_h8, hoist_d_h9);
    mat2 _sm19_l_inverseJacobian = inverseMat2(hoist_d_h8.x, hoist_d_h8.y, hoist_d_h9.x, hoist_d_h9.y);
    float _sm19_l_lw = ((0.5 * lineA) / pixA);
    vec2 _sm19_l_grain = vec2(dot(_sm19_l_x, DIRT_GRAIN), dot(_sm19_l_x, vec2((-DIRT_GRAIN.y), DIRT_GRAIN.x)));
    vec2 _gv4 = (_sm19_l_x * 0.25);
    _sm19_l_grain.y += ((0.8 * Noise_fbm((_gv4 + 5.0))) + (0.12 * Noise_value(((_sm19_l_x * 1.9) + 2.0))));
    vec2 _gv5 = (_sm19_l_x * 0.6);
    float _sm19_l_pattern = _flow17_shared(Noise_fbm((vec2((0.45 * _sm19_l_grain.x), (3.0 * _sm19_l_grain.y)) + 27.0)), Noise_value((_gv5 + 31.0)), Noise_value((vec2((1.2 * _sm19_l_grain.x), (11.0 * _sm19_l_grain.y)) + 41.0)), Noise_value((vec2((0.7 * _sm19_l_grain.x), (1.5 * _sm19_l_grain.y)) + 13.0)));
    vec3 _sm19_l_dirtColor = mix(SAND, DIRT_DK, mix(0.36, 0.6, smoothstep(0.25, 0.75, _sm19_l_pattern)));
    _sm19_l_col = mix(_sm19_l_col, _sm19_l_dirtColor, smoothstep((-_sm19_l_fieldWidth), _sm19_l_fieldWidth, _sm19_l_dirt));
    if (((_sm19_l_dirt > ((3.0 * _sm19_l_fieldWidth) * _sm19_l_lw)) && (abs(determinant(_sm19_l_jacobian)) > 1e-12))) {
      _sm19_l_col = mix(_sm19_l_col, INK, (smoothstep(3.0, 5.0, ((_sm19_l_dirt / _sm19_l_fieldWidth) / _sm19_l_lw)) * Terrain_dirtInk(_sm19_l_x, ro.xz, terrainT, _sm19_l_inverseJacobian, _sm19_l_lw)));
    }
    float _sm19_l_outline = (1.0 - smoothstep((_sm19_l_lw - 0.5), (_sm19_l_lw + 0.5), (abs(_sm19_l_dirt) / _sm19_l_fieldWidth)));
    float _sm19_l_dash = smoothstep(0.45, 0.5, Noise_value(((_sm19_l_x * 16.0) + 5.0)));
    _sm19_l_col = mix(_sm19_l_col, INK, (_sm19_l_outline * mix(1.0, _sm19_l_dash, _sm19_l_recede)));
    float _sm19_l_shoreDistance = Terrain_coast(_sm19_l_x);
    _sm19_l_col = mix(_sm19_l_col, SAND_RIM, smoothstep(-0.75, -0.7, _sm19_l_shoreDistance));
    _sm19_l_col = mix(_sm19_l_col, SAND, smoothstep(-0.6, -0.55, _sm19_l_shoreDistance));
    float _sm19_l_fade = (1.0 - smoothstep(20.0, 45.0, terrainT));
    float _sm19_l_lap = (0.5 + (0.5 * sin(((1.3 * u.time) - (6.0 * Noise_value((_sm19_l_x * 0.4)))))));
    vec3 _sm19_l_sea = mix(SEA_SHOAL, SEA, smoothstep(0.9, 1.0, _sm19_l_shoreDistance));
    float _sm19_l_shore = (-0.35 * _sm19_l_lap);
    float _sm19_l_foam = (1.0 - smoothstep((_sm19_l_shore + 0.15), (_sm19_l_shore + 0.2), _sm19_l_shoreDistance));
    float _sm19_l_mesa = Terrain_mesaField(_sm19_l_x);
    _sm19_l_foam = _flow21_shared(_sm19_l_foam, _sm19_l_lap, _sm19_l_mesa);
    float _sm19_l_wave = (Noise_value(vec2((((3.0 * _sm19_l_radius) + (3.0 * Noise_value(_gv4))) + (1.2 * u.time)), 0.5)) * Noise_value((_gv5 + 2.0)));
    _sm19_l_foam = max(_sm19_l_foam, (_sm19_l_fade * smoothstep(0.5, 0.53, _sm19_l_wave)));
    _sm19_l_sea = mix(_sm19_l_sea, SEA_HI, _sm19_l_foam);
    _sm19_l_col = mix(_sm19_l_col, _sm19_l_sea, (smoothstep((_sm19_l_shore - 0.05), _sm19_l_shore, _sm19_l_shoreDistance) * (1.0 - step(0.02, _sm19_l_height))));
    _sm19_l_col = mix(_sm19_l_col, INK, Terrain_grassInk(_sm19_l_x, ro, terrainT, pixA, lineA));
    _sm19_l_col = mix(_sm19_l_col, MESA_TOP, smoothstep(0.5, 1.2, _sm19_l_height));
    float _sm19_l_strataValue = fract(((_sm19_l_height * 1.3) + (0.35 * Noise_value((_sm19_l_x * 0.5)))));
    vec3 _sm19_l_strata = ((_sm19_l_strataValue < 0.45) ? CLIFF_A : ((_sm19_l_strataValue < 0.75) ? CLIFF_B : CLIFF_C));
    _sm19_l_strata *= (0.8 + (0.2 * Noise_value(vec2((dot(_sm19_l_x, vec2(2.0, 1.3)) * 3.0), (_sm19_l_height * 0.5)))));
    _sm19_l_col = mix(_sm19_l_col, _sm19_l_strata, smoothstep(0.35, 0.55, (1.0 - _sm19_l_normal.y)));
    float _sm19_l_lightAmount = smoothstep(-0.05, 0.2, dot(_sm19_l_normal, LIG));
    if ((_sm19_l_radius < 12.0)) {
      _sm19_l_lightAmount *= ShipMaterial_celShadow((_gv0 + (_sm19_l_normal * 0.02)), LIG, _sm19_a5, _sm19_a6);
    }
    _sm19_l_col *= mix((SHADE * 0.95), vec3(1.0), _sm19_l_lightAmount);
    vec3 _sm19_ret = mix(_sm19_l_col, HAZE, (1.0 - exp((-0.012 * terrainT))));
    col = _sm19_ret;
    frontT = terrainT;
  } else {
    float _sm20_l_y = max(rd.y, 0.0);
    vec3 _sm20_l_col = mix(SKY_HZ, SKY_MID, smoothstep(0.0, 0.12, _sm20_l_y));
    _sm20_l_col = mix(_sm20_l_col, SKY_TOP, smoothstep(0.08, 0.35, _sm20_l_y));
    vec2 _sm20_l_uv = vec2(((atan(rd.x, rd.z) * (19.0 / TAU)) + (0.004 * u.time)), (_sm20_l_y * 26.0));
    float _sm20_l_clouds = Noise_fbmWrapX(((_sm20_l_uv * vec2(1.0, 0.8)) + vec2(0.0, 3.0)), 19.0);
    float _sm20_l_cloudMask = ((smoothstep(0.56, 0.6, _sm20_l_clouds) * smoothstep(0.015, 0.05, _sm20_l_y)) * (1.0 - smoothstep(0.18, 0.35, _sm20_l_y)));
    _sm20_l_col = mix(_sm20_l_col, CLOUD, (0.75 * _sm20_l_cloudMask));
    col = _sm20_l_col;
  }
  if ((march.tEdge < frontT)) {
    col = mix(col, INK, edge);
  }
  return col;
}

vec4 NamekScene_colorAt(NamekScene self_, vec2 uv) {
  vec2 resolution = u.resolution;
  vec2 fragCoord = (uv * resolution);
  vec2 pointer = (u.mouse - vec2(0.5));
  float azimuth = ((0.42 + ((TAU * u.time) / 60.0)) + (pointer.x * TAU));
  float elevation = clamp(((0.18 + (0.03 * sin((0.21 * u.time)))) + (pointer.y * 2.0)), 0.03, 1.1);
  vec3 sceneTarget = vec3(0.0, -0.25, 0.0);
  float _lc0 = cos(elevation);
  vec3 rayOrigin = (sceneTarget + (5.6 * vec3((sin(azimuth) * _lc0), sin(elevation), (cos(azimuth) * _lc0))));
  vec3 cameraForward = normalize((sceneTarget - rayOrigin));
  vec3 cameraRight = normalize(cross(cameraForward, vec3(0.0, 1.0, 0.0)));
  vec3 cameraUp = cross(cameraRight, cameraForward);
  float pixA = (2.0 / (resolution.y * 3.4));
  float lineA = ((0.0055 + (1.2 / resolution.y)) / 3.4);
  vec3 _cse0 = vec3(0.0);
  vec2 _u1_u0_offset = (((vec2(0.0, 0.0) + 0.5) / float(AA)) - 0.5);
  vec2 _u1_u0_screenUV = (((2.0 * (fragCoord + _u1_u0_offset)) - resolution) / resolution.y);
  vec3 _u1_u0_rd = normalize((((_u1_u0_screenUV.x * cameraRight) + (_u1_u0_screenUV.y * cameraUp)) + (3.4 * cameraForward)));
  vec3 col_1 = (_cse0 + NamekScene_render(self_, rayOrigin, _u1_u0_rd, pixA, lineA));
  vec3 col_2 = (col_1 / float((AA * AA)));
  vec2 q = (fragCoord / resolution);
  vec3 col_3 = ((col_2 * vec3(0.94, 1.0, 0.96)) + vec3(0.025, 0.035, 0.03));
  vec3 col_4 = (col_3 + (0.03 * (Noise_hash12((fragCoord + (61.7 * fract((u.time * 7.13))))) - 0.5)));
  vec3 col_5 = (col_4 * (0.55 + (0.45 * pow(((((16.0 * q.x) * q.y) * (1.0 - q.x)) * (1.0 - q.y)), 0.12))));
  return vec4(clamp(col_5, _cse0, vec3(1.0)), 1.0);
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  Ship _cse2 = Ship(0.0);
  NamekTree _cse4 = NamekTree(vec2(0.0, 0.0), 0.0, 0.0);
  NamekTrees _cse3 = NamekTrees(_cse4, _cse4);
  ShipDetails _cse0 = ShipDetails(_cse2, _cse3);
  Lettering _cse1 = Lettering(0.0);
  NamekScene _sm21_l_self_ = NamekScene(_cse2, _cse3, _cse0, _cse1);
  Ship _sm21_l_sm9_l_self_ = _cse2;
  _sm21_l_sm9_l_self_.legCount = 4.0;
  _sm21_l_self_.ship = _sm21_l_sm9_l_self_;
  NamekTrees _sm21_l_sm11_l_self_ = _cse3;
  _sm21_l_sm11_l_self_.first = NamekTree_new(vec2(1.86, 0.83), 0.65, 0.15);
  _sm21_l_sm11_l_self_.second = NamekTree_new(vec2(-5.9, -4.4), 1.9, 0.38);
  _sm21_l_self_.trees = _sm21_l_sm11_l_self_;
  Ship _sm21_l_sm13_a0 = _sm21_l_self_.ship;
  NamekTrees _sm21_l_sm13_a1 = _sm21_l_self_.trees;
  ShipDetails _sm21_l_sm13_l_self_ = _cse0;
  _sm21_l_sm13_l_self_.ship = _sm21_l_sm13_a0;
  _sm21_l_sm13_l_self_.trees = _sm21_l_sm13_a1;
  _sm21_l_self_.details = _sm21_l_sm13_l_self_;
  Lettering _sm21_l_sm15_l_self_ = _cse1;
  _sm21_l_sm15_l_self_.strokeWidth = SW;
  _sm21_l_self_.lettering = _sm21_l_sm15_l_self_;
  NamekScene scene = _sm21_l_self_;
  _ret = NamekScene_colorAt(scene, uv);
}
