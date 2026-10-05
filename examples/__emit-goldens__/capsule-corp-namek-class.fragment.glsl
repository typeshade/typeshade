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
const vec3[4] TET = vec3[4](vec3(1.0, (-1.0), (-1.0)), vec3((-1.0), (-1.0), 1.0), vec3((-1.0), 1.0, (-1.0)), vec3(1.0, 1.0, 1.0));
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
  vec2 q = p;
  float sum = 0.0;
  float amplitude = 0.5;
  for (int i = 0; (i < 4); i = (i + 1)) {
    sum += (amplitude * Noise_value(q));
    q = (rotation * q);
    amplitude *= 0.5;
  }
  return (sum / 0.9375);
}

float Noise_mod(float x, float y) {
  return (x - (y * floor((x / y))));
}

float Noise_wrapX(vec2 p, float n) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 q = ((f * f) * (3.0 - (2.0 * f)));
  float i0 = Noise_mod(i.x, n);
  float i1 = Noise_mod((i.x + 1.0), n);
  float _lc0 = (i.y + 1.0);
  return mix(mix(Noise_hash12(vec2(i0, i.y)), Noise_hash12(vec2(i1, i.y)), q.x), mix(Noise_hash12(vec2(i0, _lc0)), Noise_hash12(vec2(i1, _lc0)), q.x), q.y);
}

float Noise_fbmWrapX(vec2 p, float n) {
  vec2 _licm0 = vec2(0.0, 5.3);
  vec2 q = p;
  float period = n;
  float sum = 0.0;
  float amplitude = 0.5;
  for (int i = 0; (i < 4); i = (i + 1)) {
    sum += (amplitude * Noise_wrapX(q, period));
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

float SDF_box(vec3 p, vec3 b) {
  vec3 q = (abs(p) - b);
  return (length(max(q, vec3(0.0, 0.0, 0.0))) + min(max(q.x, max(q.y, q.z)), 0.0));
}

float SDF_box2(vec2 p, vec2 b) {
  vec2 q = (abs(p) - b);
  return (length(max(q, vec2(0.0, 0.0))) + min(max(q.x, q.y), 0.0));
}

float SDF_trapezoid(vec2 p, float r1, float r2, float height) {
  vec2 k1 = vec2(r2, height);
  vec2 k2 = vec2((r2 - r1), (2.0 * height));
  float qx = abs(p.x);
  vec2 q = vec2(qx, p.y);
  vec2 ca = vec2((qx - min(qx, ((q.y < 0.0) ? r1 : r2))), (abs(q.y) - height));
  vec2 cb = ((q - k1) + (k2 * clamp((dot((k1 - q), k2) / dot(k2, k2)), 0.0, 1.0)));
  float sign = (((cb.x < 0.0) && (ca.y < 0.0)) ? -1.0 : 1.0);
  return (sign * sqrt(min(dot(ca, ca), dot(cb, cb))));
}

float SDF_cylinderY(vec3 p, float radius, float y0, float y1) {
  vec2 d = vec2((length(p.xz) - radius), (abs((p.y - (0.5 * (y0 + y1)))) - (0.5 * (y1 - y0))));
  return (min(max(d.x, d.y), 0.0) + length(max(d, vec2(0.0, 0.0))));
}

float SDF_coneY(vec3 p, float rb, float rt, float y0, float y1) {
  float halfHeight = (0.5 * (y1 - y0));
  vec2 q = vec2(length(p.xz), ((p.y - y0) - halfHeight));
  vec2 k1 = vec2(rt, halfHeight);
  vec2 k2 = vec2((rt - rb), (2.0 * halfHeight));
  vec2 ca = vec2((q.x - min(q.x, ((q.y < 0.0) ? rb : rt))), (abs(q.y) - halfHeight));
  vec2 cb = ((q - k1) + (k2 * clamp((dot((k1 - q), k2) / dot(k2, k2)), 0.0, 1.0)));
  float sign = (((cb.x < 0.0) && (ca.y < 0.0)) ? -1.0 : 1.0);
  return (sign * sqrt(min(dot(ca, ca), dot(cb, cb))));
}

float SDF_cutSphereBelow(vec3 p, float radius, float height) {
  float width = sqrt(((radius * radius) - (height * height)));
  vec2 q = vec2(length(p.xz), (-p.y));
  float h = (-height);
  float s = max(((((h - radius) * q.x) * q.x) + ((width * width) * ((h + radius) - (2.0 * q.y)))), ((h * q.x) - (width * q.y)));
  return ((s < 0.0) ? (length(q) - radius) : ((q.x < width) ? (h - q.y) : length((q - vec2(width, h)))));
}

float SDF_cylinderSegment(vec3 p, vec3 a, vec3 b, float radius) {
  vec3 pa = (p - a);
  vec3 ba = (b - a);
  float lengthAB = length(ba);
  float h = (dot(pa, ba) / lengthAB);
  float _lc0 = (0.5 * lengthAB);
  vec2 d = vec2((length((pa - (ba * (h / lengthAB)))) - radius), (abs((h - _lc0)) - _lc0));
  return (min(max(d.x, d.y), 0.0) + length(max(d, vec2(0.0, 0.0))));
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

float Ship_flapOutline(Ship self_, vec3 s) {
  float angle = (asin(FLAP_Y) - atan(s.y, length(s.xz)));
  float _cse0 = (0.5 * FLAP_LEN);
  return (SDF_trapezoid(vec2(s.x, (angle - _cse0)), (FLAP_HW - 0.06), (FLAP_TIP_HW - 0.06), (_cse0 - 0.06)) - 0.06);
}

vec3 Ship_flapHome(Ship self_, vec3 l) {
  vec2 hinge = vec2(sqrt((1.0 - (FLAP_Y * FLAP_Y))), FLAP_Y);
  vec2 q = (hinge + SDF_rotate((l.zy - hinge), (-FLAP_OPEN)));
  return vec3(l.x, q.y, q.x);
}

float Ship_flap(Ship self_, vec3 l) {
  vec3 home = Ship_flapHome(self_, l);
  float _cse0 = (0.5 * FLAP_T);
  return max((abs(((length(home) - 1.0) + _cse0)) - _cse0), Ship_flapOutline(self_, home));
}

vec2 Ship_mapLeg(Ship self_, vec3 l, float best) {
  float y = -0.73;
  vec2 hinge = vec2(sqrt((1.0 - (FLAP_Y * FLAP_Y))), FLAP_Y);
  float tipLat = (asin(FLAP_Y) - FLAP_LEN);
  vec2 tip = (hinge + SDF_rotate((vec2(cos(tipLat), sin(tipLat)) - hinge), FLAP_OPEN));
  float bounds = max(((SDF_segment(l.zy, hinge, tip) - FLAP_T) - FLAP_HW), (abs(l.x) - FLAP_HW));
  vec3 lo = vec3(-0.1, GROUND, 0.0);
  vec3 hi = vec3(0.1, ((y + 0.02) + 0.02), (LEG_R + 0.1));
  bounds = min(bounds, SDF_box((l - (0.5 * (lo + hi))), (0.5 * (hi - lo))));
  if ((bounds > min(best, 0.1))) {
    return vec2(bounds, 5.0);
  }
  vec3 c = (l - vec3(0.0, 0.0, LEG_R));
  float leg = (SDF_cylinderY(c, 0.05, (SHOCK_Y + 0.01), -0.72) - 0.01);
  leg = min(leg, SDF_cylinderY(c, 0.025, (GROUND + 0.05), SHOCK_Y));
  leg = min(leg, SDF_capsule(l, vec3(0.0, (y + 0.02), 0.6), vec3(0.0, y, LEG_R), 0.018));
  float joint = (LEG_R - 0.2);
  float _gv0 = (y - 0.09);
  leg = min(leg, SDF_capsule(l, vec3(-0.05, y, 0.6), vec3(-0.05, _gv0, joint), 0.018));
  leg = min(leg, SDF_capsule(l, vec3(0.05, y, 0.6), vec3(0.05, _gv0, joint), 0.018));
  y -= 0.09;
  float _lc0 = (y + 0.02);
  leg = min(leg, SDF_cylinderSegment(l, vec3(-0.07, _lc0, joint), vec3(0.07, _lc0, joint), 0.05));
  vec3 _gv1 = vec3(0.05, (y + 0.02), joint);
  leg = min(leg, SDF_capsule(l, _gv1, vec3(0.05, y, LEG_R), 0.012));
  vec3 _gv2 = vec3(-0.05, (y + 0.02), joint);
  leg = min(leg, SDF_capsule(l, _gv2, vec3(-0.05, y, LEG_R), 0.012));
  leg = min(leg, SDF_capsule(l, _gv1, vec3(0.05, y, 0.2), 0.012));
  leg = min(leg, SDF_capsule(l, _gv2, vec3(-0.05, y, 0.2), 0.012));
  vec2 result = vec2(leg, 5.0);
  result = SDF_union(result, vec2((SDF_coneY(c, 0.094, 0.024, (GROUND + 0.006), (GROUND + 0.064)) - 0.006), 6.0));
  result = SDF_union(result, vec2(Ship_flap(self_, l), 10.0));
  return result;
}

vec2 Ship_map(Ship self_, vec3 p) {
  float bound = (length((p - vec3(0.0, -0.3, 0.0))) - 1.6);
  if ((bound > 0.25)) {
    return vec2(bound, 0.0);
  }
  float radius = length(p);
  float longitude = atan(p.x, p.z);
  float horizontalRadius = length(p.xz);
  PolarResult legFrame = SDF_polarY(longitude, horizontalRadius, p.y, self_.legCount, LEG_LON);
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
  result = SDF_union(result, Ship_mapLeg(self_, l, result.x));
  vec3 bellyPoint = (p + vec3(0.0, BELLY_EXT, 0.0));
  result = SDF_union(result, vec2(SDF_cutSphereBelow(bellyPoint, 1.0, BELLY_Y), (((bellyPoint.y - BELLY_Y) > (length(bellyPoint) - 1.0)) ? 12.0 : 0.0)));
  result = SDF_union(result, vec2(SDF_cylinderY(p, SHAFT_R, ((BELLY_Y - BELLY_EXT) - 0.01), (BELLY_Y + 0.05)), 7.0));
  return result;
}

Ship Ship_new() {
  Ship self_ = Ship(0.0);
  self_.legCount = 4.0;
  return self_;
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

NamekTree NamekTrees_nearest(NamekTrees self_, vec3 p) {
  float firstDistance = length((p.xz - self_.first.position));
  float secondDistance = length((p.xz - self_.second.position));
  NamekTree _sel0 = NamekTree(vec2(0.0), 0.0, 0.0);
  if ((firstDistance < secondDistance)) {
    _sel0 = self_.first;
  } else {
    _sel0 = self_.second;
  }
  return _sel0;
}

float NamekTrees_sphereExit(NamekTrees self_, vec3 ro, vec3 rd, vec3 center, float radius) {
  vec3 oc = (ro - center);
  float b = dot(oc, rd);
  float h = (((b * b) - dot(oc, oc)) + (radius * radius));
  return ((h > 0.0) ? ((-b) + sqrt(h)) : 0.0);
}

float NamekTrees_casterExit(NamekTrees self_, vec3 ro, vec3 rd, float current) {
  float firstExit = NamekTrees_sphereExit(self_, ro, rd, NamekTree_shadowCenter(self_.first), NamekTree_shadowRadius(self_.first));
  float secondExit = NamekTrees_sphereExit(self_, ro, rd, NamekTree_shadowCenter(self_.second), NamekTree_shadowRadius(self_.second));
  return max(current, max(firstExit, secondExit));
}

NamekTrees NamekTrees_new() {
  NamekTree _cse0 = NamekTree(vec2(0.0, 0.0), 0.0, 0.0);
  NamekTrees self_ = NamekTrees(_cse0, _cse0);
  self_.first = NamekTree_new(vec2(1.86, 0.83), 0.65, 0.15);
  self_.second = NamekTree_new(vec2(-5.9, -4.4), 1.9, 0.38);
  return self_;
}

float ShipDetails_tickRow(ShipDetails self_, vec2 q, vec2 seed, int n, float gap, float len, float bend, float curl, float spread, float lw) {
  float _licm0 = max((-bend), 0.0);
  float _licm1 = (0.4 * gap);
  float _licm2 = (0.35 * len);
  float mid = (0.5 * float((n - 1)));
  float radius = (((2.0 * mid) * gap) / PI);
  float bendSign = ((bend < 0.0) ? -1.0 : 1.0);
  float distance = 1000000000.0;
  float _cse0 = (0.5 * PI);
  for (int k = 0; (k < 9); k = (k + 1)) {
    if ((k >= n)) {
      break;
    }
    float _gv1 = float(k);
    float _gv0 = (_gv1 - mid);
    float fk = (_gv0 / mid);
    vec4 h = vec4(Noise_hash12(((seed + (_gv1 * 3.1)) + 51.0)), Noise_hash12(((seed + (_gv1 * 5.7)) + 63.0)), Noise_hash12(((seed + (_gv1 * 2.3)) + 77.0)), Noise_hash12(((seed + (_gv1 * 4.9)) + 89.0)));
    vec2 base = vec2((gap * _gv0), (((bend * fk) * fk) + _licm0));
    float _lc1 = (_cse0 * fk);
    base = mix(base, (radius * vec2(sin(_lc1), (bendSign * (1.0 - cos(_lc1))))), curl);
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
      vec3 center = vec3((_lc0 * _gv0), sin(cellLat), (_lc0 * _gv1));
      vec3 east = vec3(_gv1, 0.0, (-_gv0));
      vec3 _lc1 = (normal - center);
      vec2 local = SDF_rotate(vec2(dot(_lc1, east), dot(_lc1, cross(center, east))), (2.4 * (g.z - 0.5)));
      if ((dot(local, local) > 0.0225)) {
        continue;
      }
      float hatchTest = SDF_arch(vec2((atan(center.x, center.z) * length(center.xz)), center.y), DOOR_HW, DOOR_Y0, DOOR_Y1);
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

float ShipDetails_hatchedSheen(ShipDetails self_, vec3 normal, vec3 viewRight, vec3 viewUp, float aa) {
  vec3 sheenCenter = ((0.6 * viewUp) - (0.8 * viewRight));
  float c0 = cos((SHEEN_R + (0.1 * (Noise_value((7.0 * vec2(dot(normal, viewRight), dot(normal, viewUp)))) - 0.5))));
  float rho = max(length(normal.xz), 0.0001);
  float hH = length(sheenCenter.xz);
  float m = (normal.y * sheenCenter.y);
  float w = (rho * hH);
  float angle = acos(clamp((dot(normal.xz, sheenCenter.xz) / w), -1.0, 1.0));
  float q = ((c0 - m) / w);
  float e = 0.0;
  float de = 0.0;
  if ((abs(q) < 1.0)) {
    float lit = acos(q);
    float _gv0 = (lit - angle);
    e = (rho * _gv0);
    de = (((-normal.y) * _gv0) - (((c0 * normal.y) - sheenCenter.y) / (w * max(sqrt((1.0 - (q * q))), 0.05))));
  } else {
    float _gv1 = sign(q);
    float hm = (m + (_gv1 * w));
    float gap = (abs((c0 - hm)) / sqrt(max((1.0 - (hm * hm)), 0.0001)));
    float arc = ((q > 0.0) ? angle : (PI - angle));
    e = ((-_gv1) * (gap + (rho * arc)));
    de = ((_gv1 * normal.y) * arc);
  }
  float s = (asin(clamp(normal.y, -1.0, 1.0)) / HATCH_W);
  float c1 = floor((s + 0.5));
  float u1 = (s - c1);
  float c2 = floor(s);
  float u2 = ((s - c2) - 0.5);
  float fit = min(1.0, ((1.25 * rho) / max(HATCH_L, HATCH_D)));
  float lightLength = ((fit * HATCH_L) * (0.15 + (0.85 * Noise_hash12(vec2(c1, 3.1)))));
  float darkLength = ((fit * HATCH_D) * (0.15 + (0.85 * Noise_hash12(vec2(c2, 7.7)))));
  float z = ((e + (lightLength * (1.0 - (2.0 * abs(u1))))) - (darkLength * (1.0 - (2.0 * abs(u2)))));
  float dz = (de + ((2.0 * ((darkLength * sign(u2)) - (lightLength * sign(u1)))) / HATCH_W));
  return smoothstep((-aa), aa, (z / sqrt((1.0 + (dz * dz)))));
}

ShipDetails ShipDetails_new(Ship ship, NamekTrees trees) {
  NamekTree _cse0 = NamekTree(vec2(0.0, 0.0), 0.0, 0.0);
  ShipDetails self_ = ShipDetails(Ship(0.0), NamekTrees(_cse0, _cse0));
  self_.ship = ship;
  self_.trees = trees;
  return self_;
}

float Lettering_rect(Lettering self_, vec2 p, float x0, float y0, float x1, float y1) {
  return SDF_box2((p - (0.5 * vec2((x0 + x1), (y0 + y1)))), (0.5 * vec2((x1 - x0), (y1 - y0))));
}

float Lettering_stroke(Lettering self_, vec2 p, vec2 a, vec2 b) {
  return (SDF_segment(p, a, b) - self_.strokeWidth);
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
  vec2 _cse0 = vec2(0.0, -0.2);
  bool _cse1 = (glyphId == 8);
  float _cse2 = Lettering_rect(self_, p, -0.27, -0.5, -0.1, 0.5);
  float _cse3 = Lettering_rect(self_, p, -0.27, -0.5, 0.26, -0.33);
  if ((glyphId == 0)) {
    d = min(Lettering_arc(self_, p, vec2(0.0, 0.2), 0.215, 0.5, PI), Lettering_arc(self_, p, _cse0, 0.215, PI, (TAU - 0.5)));
    d = min(d, Lettering_rect(self_, p, -0.3, -0.2, -0.13, 0.2));
  } else if ((glyphId == 1)) {
    d = min(Lettering_stroke(self_, p, vec2(-0.245, -0.6), vec2(-0.01, 0.6)), Lettering_stroke(self_, p, vec2(0.245, -0.6), vec2(0.01, 0.6)));
    d = min(d, Lettering_rect(self_, p, -0.16, -0.22, 0.16, -0.06));
  } else if (((glyphId == 2) || _cse1)) {
    d = min(Lettering_rect(self_, p, -0.28, -0.5, -0.11, 0.5), Lettering_rect(self_, p, -0.28, 0.33, 0.0, 0.5));
    d = min(d, Lettering_rect(self_, p, -0.28, -0.08, 0.0, 0.09));
    d = min(d, Lettering_arc(self_, p, vec2(0.0, 0.205), 0.21, (-0.5 * PI), (0.5 * PI)));
    if (_cse1) {
      d = min(d, Lettering_stroke(self_, p, vec2(0.0, 0.0), vec2(0.24, -0.6)));
    }
  } else if ((glyphId == 3)) {
    d = min(Lettering_arc(self_, p, vec2(0.0, 0.2075), 0.2075, 0.4, (1.5 * PI)), Lettering_arc(self_, p, vec2(0.0, -0.2075), 0.2075, (PI + 0.4), (2.5 * PI)));
  } else if ((glyphId == 4)) {
    d = min(Lettering_rect(self_, p, -0.3, -0.2, -0.13, 0.5), Lettering_rect(self_, p, 0.13, -0.2, 0.3, 0.5));
    d = min(d, Lettering_arc(self_, p, _cse0, 0.215, PI, TAU));
  } else if ((glyphId == 5)) {
    d = min(_cse2, _cse3);
  } else if ((glyphId == 6)) {
    d = min(_cse2, Lettering_rect(self_, p, -0.27, 0.33, 0.26, 0.5));
    d = min(d, min(Lettering_rect(self_, p, -0.27, -0.085, 0.2, 0.085), _cse3));
  } else if ((glyphId == 7)) {
    d = (abs((length(vec2(p.x, (p.y - clamp(p.y, -0.2, 0.2)))) - 0.215)) - self_.strokeWidth);
  } else {
    d = (length((p - vec2(-0.26, -0.4))) - 0.1);
  }
  return max(d, (abs(p.y) - 0.5));
}

float Lettering_render(Lettering self_, vec3 p, float aa) {
  float longitude = atan(p.x, p.z);
  float latitude = asin(clamp((p.y / length(p)), -1.0, 1.0));
  float ink = 0.0;
  vec2 caps = (vec2(((longitude - CAPS_LON) * cos(CAPS_LAT)), (latitude - CAPS_LAT)) / CAPS_H);
  float index = floor(((caps.x / ADV) + 3.5));
  float _cse0 = (-aa);
  if ((((abs(caps.y) < 0.6) && (index >= 0.0)) && (index < 7.0))) {
    ink = (1.0 - smoothstep(_cse0, aa, (CAPS_H * Lettering_glyph(self_, vec2((caps.x - ((index - 3.0) * ADV)), caps.y), _f2i(index)))));
  }
  vec2 corp = (vec2(((longitude - CORP_LON) * cos(CORP_LAT)), (latitude - CORP_LAT)) / CORP_H);
  index = floor(((corp.x / ADV) + 2.5));
  if ((((abs(corp.y) < 0.6) && (index >= 0.0)) && (index < 5.0))) {
    int glyphId = ((index < 0.5) ? 0 : ((index < 1.5) ? 7 : ((index < 2.5) ? 8 : ((index < 3.5) ? 2 : 9))));
    ink = max(ink, (1.0 - smoothstep(_cse0, aa, (CORP_H * Lettering_glyph(self_, vec2((corp.x - ((index - 2.0) * ADV)), corp.y), glyphId)))));
  }
  return ink;
}

Lettering Lettering_new() {
  Lettering self_ = Lettering(0.0);
  self_.strokeWidth = SW;
  return self_;
}

float ShipMaterial_sphereExit(vec3 ro, vec3 rd, vec3 center, float radius) {
  vec3 oc = (ro - center);
  float b = dot(oc, rd);
  float h = (((b * b) - dot(oc, oc)) + (radius * radius));
  return ((h > 0.0) ? ((-b) + sqrt(h)) : 0.0);
}

vec2 ShipMaterial_mapCel(vec3 p, Ship ship, NamekTrees trees) {
  vec2 result = Ship_map(ship, p);
  result = SDF_union(result, NamekTrees_map(trees, p));
  return result;
}

float ShipMaterial_celShadow(vec3 ro, vec3 rd, Ship ship, NamekTrees trees) {
  float tmax = ShipMaterial_sphereExit(ro, rd, vec3(0.0, -0.3, 0.0), 2.0);
  tmax = NamekTrees_casterExit(trees, ro, rd, tmax);
  tmax = min(tmax, 9.0);
  if ((tmax < 0.02)) {
    return 1.0;
  }
  float result = 1.0;
  float t = 0.02;
  for (int i = 0; (i < 64); i = (i + 1)) {
    float h = ShipMaterial_mapCel((ro + (rd * t)), ship, trees).x;
    result = min(result, ((10.0 * h) / t));
    t += clamp(h, 0.01, 0.3);
    if (((result < 0.0) || (t > tmax))) {
      break;
    }
  }
  return smoothstep(0.25, 0.4, result);
}

vec3 ShipMaterial_shade(vec3 p, vec3 n, vec3 rd, float id, float t, float pixA, float lineA, Ship ship, NamekTrees trees, ShipDetails details, Lettering lettering) {
  float aa = (((0.7 * pixA) * t) / max(dot(n, (-rd)), 0.3));
  float lw = ((0.5 * lineA) * t);
  float lightAmount = smoothstep(-0.02, 0.02, dot(n, LIG));
  if ((lightAmount > 0.0)) {
    lightAmount *= ShipMaterial_celShadow((p + (n * 0.004)), LIG, ship, trees);
  }
  vec3 _cse0 = vec3(1.0, 1.0, 1.0);
  vec3 lit = mix(SHADE, _cse0, lightAmount);
  vec3 _cse1 = vec3(0.0, 0.0, 0.0);
  vec3 col = _cse1;
  vec3 _cse2 = vec3(0.0, 1.0, 0.0);
  float _cse3 = atan(p.x, p.z);
  float _cse4 = length(p.xz);
  float _cse5 = (length(p) - 1.0);
  if ((id < 0.5)) {
    float _gv0 = (-aa);
    float cap = smoothstep(_gv0, aa, (p.y - (RING_Y + RING_H)));
    float band = (smoothstep(_gv0, aa, (p.y - BAND_BOT)) - smoothstep(_gv0, aa, (p.y - BAND_TOP)));
    vec3 viewDirection = normalize(((t * rd) - p));
    vec3 viewRight = normalize(cross(viewDirection, _cse2));
    float sheen = ShipDetails_hatchedSheen(details, n, viewRight, cross(viewRight, viewDirection), aa);
    vec3 blackPaint = (mix(BLACK, BLACK_HI, sheen) * mix(0.7, 1.0, lightAmount));
    float dark = max(cap, band);
    col = mix((HULL * lit), blackPaint, dark);
    col = mix(col, INK, max(Lettering_render(lettering, p, aa), ((1.0 - dark) * ShipDetails_scuffInk(details, p, t, lineA, aa))));
  } else if ((id < 1.5)) {
    float dy = abs((p.y - RING_Y));
    col = (HULL * lit);
    float _lc1 = (0.6 * lw);
    float ink = (1.0 - smoothstep((_lc1 - aa), (_lc1 + aa), dy));
    float _lc2 = (RING_H - (1.3 * lw));
    ink = max(ink, smoothstep((_lc2 - aa), (_lc2 + aa), dy));
    col = mix(col, INK, ink);
  } else if ((id < 2.5)) {
    PolarResult windowFrame = SDF_polarY(_cse3, _cse4, p.y, WIN_N, 0.0);
    vec3 q = windowFrame.point;
    vec3 center = vec3(0.0, WIN_Y, sqrt((1.0 - (WIN_Y * WIN_Y))));
    vec2 w = vec2(q.x, dot((q - center), normalize((_cse2 - (center * WIN_Y)))));
    float radius = length(w);
    col = mix(GLASS_HI, GLASS_LO, smoothstep((0.1 - aa), (0.1 + aa), length((w - vec2(-0.035, 0.04)))));
    float streak = (abs((radius - 0.062)) - 0.011);
    streak = max(streak, ((abs((atan(w.y, w.x) - 2.25)) * radius) - 0.035));
    col = mix(col, vec3(0.93, 0.98, 1.0), (1.0 - smoothstep((-aa), aa, streak)));
    col *= mix(0.8, 1.0, lightAmount);
  } else if ((id < 3.5)) {
    col = (METAL * lit);
  } else if ((id < 4.5)) {
    float doorDistance = SDF_arch(vec2((_cse3 * _cse4), p.y), DOOR_HW, DOOR_Y0, DOOR_Y1);
    float top = (_cse5 - DOOR_T);
    col = (HULL * lit);
    float ink_1 = (1.0 - smoothstep((lw - aa), (lw + aa), length(vec2(doorDistance, top))));
    float _lc3 = (0.7 * lw);
    ink_1 = max(ink_1, (1.0 - smoothstep((_lc3 - aa), (_lc3 + aa), length(vec2(doorDistance, (top + DOOR_T))))));
    col = mix(col, INK, ink_1);
  } else if ((id < 7.5)) {
    col = (METAL * mix(vec3(0.5, 0.6, 0.78), _cse0, lightAmount));
  } else if ((id < 8.5)) {
    col = (TRUNK * lit);
  } else if ((id < 9.5)) {
    NamekTree tree = NamekTrees_nearest(trees, p);
    vec3 normal = normalize((p - vec3(tree.position.x, (GROUND + tree.height), tree.position.y)));
    float k = (dot(normalize((normal + (0.5 * n))), LIG) + (0.15 * (Noise_value(((normal.xy * 9.0) + (normal.z * 5.0))) - 0.5)));
    col = mix((LEAF * vec3(0.72, 0.78, 0.9)), LEAF, (smoothstep(0.0, 0.04, k) * ShipMaterial_celShadow((p + (n * 0.01)), LIG, ship, trees)));
    col = mix(col, LEAF_HI, smoothstep(0.55, 0.59, k));
  } else if ((id < 10.5)) {
    PolarResult legFrame = SDF_polarY(_cse3, _cse4, p.y, 4.0, LEG_LON);
    vec3 local = Ship_flapHome(ship, legFrame.point);
    vec2 rotated = SDF_rotate(local.xz, ((-LEG_LON) - ((0.5 * PI) * legFrame.index)));
    col = mix((HULL * lit), INK, ShipDetails_scuffInk(details, vec3(rotated.x, local.y, rotated.y), t, lineA, aa));
  } else if ((id < 11.5)) {
    col = mix(_cse1, (HULL * lit), smoothstep((-aa), aa, (_cse5 + FLAP_T)));
  } else {
    col = mix(_cse1, (HULL * lit), smoothstep((-aa), aa, ((_cse4 - BELLY_R) + FLAP_T)));
  }
  return col;
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
  vec2 gradient = vec2(0.0, 0.0);
  for (int i = 0; (i < 4); i = (i + 1)) {
    gradient -= (CROSS[i] * Terrain_heightAt((x + (stepSize * CROSS[i]))));
  }
  return normalize(vec3(gradient.x, (2.0 * stepSize), gradient.y));
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
  float _cse0 = (0.5 * PI);
  for (int k = 0; (k < 9); k = (k + 1)) {
    if ((k >= n)) {
      break;
    }
    float _gv1 = float(k);
    float _gv0 = (_gv1 - mid);
    float fk = (_gv0 / mid);
    vec4 h = vec4(Noise_hash12(((seed + (_gv1 * 3.1)) + 51.0)), Noise_hash12(((seed + (_gv1 * 5.7)) + 63.0)), Noise_hash12(((seed + (_gv1 * 2.3)) + 77.0)), Noise_hash12(((seed + (_gv1 * 4.9)) + 89.0)));
    vec2 base = vec2((gap * _gv0), (((bend * fk) * fk) + _licm0));
    float _lc1 = (_cse0 * fk);
    base = mix(base, (radius * vec2(sin(_lc1), (signBend * (1.0 - cos(_lc1))))), curl);
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
      vec4 g = vec4(Noise_hash12((cell + 11.3)), Noise_hash12((cell + 23.7)), Noise_hash12((cell + 31.1)), Noise_hash12((cell + 47.9)));
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

mat2 inverseMat2(float a, float b, float c, float d) {
  float determinant = ((a * d) - (b * c));
  return mat2(vec2((d / determinant), ((-b) / determinant)), vec2(((-c) / determinant), (a / determinant)));
}

vec3 Terrain_shade(vec3 p, vec3 ro, float t, float pixA, float lineA, Ship ship, NamekTrees trees) {
  vec3 normal = ((length(p.xz) > MESA_R) ? Terrain_normal(p.xz, t) : vec3(0.0, 1.0, 0.0));
  vec2 x = p.xz;
  float radius = length(x);
  float height = (p.y - GROUND);
  vec2 warped = Terrain_groundWarp(x);
  vec3 col = mix(GRASS, GRASS_DK, (0.6 * smoothstep(0.55, 0.56, Noise_fbm(((warped * 1.1) + 3.0)))));
  float dirt = Terrain_dirtField(warped);
  vec2 dirtGradient = vec2(dFdx(dirt), dFdy(dirt));
  float recede = smoothstep(0.25, 0.6, (abs(dirtGradient.x) / max(length(dirtGradient), 0.000001)));
  dirt += (0.03 * ((abs((Noise_value((x * 5.0)) - 0.5)) + (0.5 * abs((Noise_value(((x * 11.0) + 7.0)) - 0.5)))) - 0.35));
  float fieldWidth = max(length(vec2(dFdx(dirt), dFdy(dirt))), 0.00001);
  vec2 dx = dFdx(x);
  vec2 dy = dFdy(x);
  mat2 jacobian = mat2(dx, dy);
  mat2 inverseJacobian = inverseMat2(dx.x, dx.y, dy.x, dy.y);
  float lw = ((0.5 * lineA) / pixA);
  vec2 grain = vec2(dot(x, DIRT_GRAIN), dot(x, vec2((-DIRT_GRAIN.y), DIRT_GRAIN.x)));
  vec2 _gv0 = (x * 0.25);
  grain.y += ((0.8 * Noise_fbm((_gv0 + 5.0))) + (0.12 * Noise_value(((x * 1.9) + 2.0))));
  vec2 _gv1 = (x * 0.6);
  float pattern = ((0.5 + ((Noise_fbm((vec2((0.45 * grain.x), (3.0 * grain.y)) + 27.0)) - 0.5) * (0.5 + Noise_value((_gv1 + 31.0))))) + ((0.7 * (Noise_value((vec2((1.2 * grain.x), (11.0 * grain.y)) + 41.0)) - 0.5)) * smoothstep(0.35, 0.75, Noise_value((vec2((0.7 * grain.x), (1.5 * grain.y)) + 13.0)))));
  vec3 dirtColor = mix(SAND, DIRT_DK, mix(0.36, 0.6, smoothstep(0.25, 0.75, pattern)));
  col = mix(col, dirtColor, smoothstep((-fieldWidth), fieldWidth, dirt));
  if (((dirt > ((3.0 * fieldWidth) * lw)) && (abs(determinant(jacobian)) > 1e-12))) {
    col = mix(col, INK, (smoothstep(3.0, 5.0, ((dirt / fieldWidth) / lw)) * Terrain_dirtInk(x, ro.xz, t, inverseJacobian, lw)));
  }
  float outline = (1.0 - smoothstep((lw - 0.5), (lw + 0.5), (abs(dirt) / fieldWidth)));
  float dash = smoothstep(0.45, 0.5, Noise_value(((x * 16.0) + 5.0)));
  col = mix(col, INK, (outline * mix(1.0, dash, recede)));
  float shoreDistance = Terrain_coast(x);
  col = mix(col, SAND_RIM, smoothstep(-0.75, -0.7, shoreDistance));
  col = mix(col, SAND, smoothstep(-0.6, -0.55, shoreDistance));
  float fade = (1.0 - smoothstep(20.0, 45.0, t));
  float lap = (0.5 + (0.5 * sin(((1.3 * u.time) - (6.0 * Noise_value((x * 0.4)))))));
  vec3 sea = mix(SEA_SHOAL, SEA, smoothstep(0.9, 1.0, shoreDistance));
  float shore = (-0.35 * lap);
  float foam = (1.0 - smoothstep((shore + 0.15), (shore + 0.2), shoreDistance));
  float mesa = Terrain_mesaField(x);
  float _lc0 = (0.02 * lap);
  foam = max(foam, smoothstep((0.61 - _lc0), (0.615 - _lc0), mesa));
  float wave = (Noise_value(vec2((((3.0 * radius) + (3.0 * Noise_value(_gv0))) + (1.2 * u.time)), 0.5)) * Noise_value((_gv1 + 2.0)));
  foam = max(foam, (fade * smoothstep(0.5, 0.53, wave)));
  sea = mix(sea, SEA_HI, foam);
  col = mix(col, sea, (smoothstep((shore - 0.05), shore, shoreDistance) * (1.0 - step(0.02, height))));
  col = mix(col, INK, Terrain_grassInk(x, ro, t, pixA, lineA));
  col = mix(col, MESA_TOP, smoothstep(0.5, 1.2, height));
  float strataValue = fract(((height * 1.3) + (0.35 * Noise_value((x * 0.5)))));
  vec3 strata = ((strataValue < 0.45) ? CLIFF_A : ((strataValue < 0.75) ? CLIFF_B : CLIFF_C));
  strata *= (0.8 + (0.2 * Noise_value(vec2((dot(x, vec2(2.0, 1.3)) * 3.0), (height * 0.5)))));
  col = mix(col, strata, smoothstep(0.35, 0.55, (1.0 - normal.y)));
  float lightAmount = smoothstep(-0.05, 0.2, dot(normal, LIG));
  if ((radius < 12.0)) {
    lightAmount *= ShipMaterial_celShadow((p + (normal * 0.02)), LIG, ship, trees);
  }
  col *= mix((SHADE * 0.95), vec3(1.0, 1.0, 1.0), lightAmount);
  return mix(col, HAZE, (1.0 - exp((-0.012 * t))));
}

vec3 Sky_color(vec3 rd) {
  float y = max(rd.y, 0.0);
  vec3 col = mix(SKY_HZ, SKY_MID, smoothstep(0.0, 0.12, y));
  col = mix(col, SKY_TOP, smoothstep(0.08, 0.35, y));
  vec2 uv = vec2(((atan(rd.x, rd.z) * (19.0 / TAU)) + (0.004 * u.time)), (y * 26.0));
  float clouds = Noise_fbmWrapX(((uv * vec2(1.0, 0.8)) + vec2(0.0, 3.0)), 19.0);
  float cloudMask = ((smoothstep(0.56, 0.6, clouds) * smoothstep(0.015, 0.05, y)) * (1.0 - smoothstep(0.18, 0.35, y)));
  col = mix(col, CLOUD, (0.75 * cloudMask));
  return col;
}

vec2 NamekScene_mapCel(NamekScene self_, vec3 p) {
  vec2 result = Ship_map(self_.ship, p);
  result = SDF_union(result, NamekTrees_map(self_.trees, p));
  return result;
}

vec3 NamekScene_calcNormal(NamekScene self_, vec3 p) {
  vec3 normal = vec3(0.0, 0.0, 0.0);
  for (int i = 0; (i < 4); i = (i + 1)) {
    normal += (TET[i] * NamekScene_mapCel(self_, (p + (0.0007 * TET[i]))).x);
  }
  return normalize(normal);
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

vec3 NamekScene_render(NamekScene self_, vec3 ro, vec3 rd, float pixA, float lineA) {
  MarchResult march = NamekScene_marchCel(self_, ro, rd, lineA, pixA);
  float edge = march.edge;
  if ((abs((march.hit.y - 2.5)) > 1.0)) {
    edge = max(edge, march.winEdge);
  }
  bool shipHit = (march.hit.y >= 0.0);
  float terrainT = Terrain_march(ro, rd, (shipHit ? march.hit.x : 400.0));
  vec3 col = vec3(0.0, 0.0, 0.0);
  float frontT = 10000000000.0;
  if ((shipHit && (terrainT < 0.0))) {
    vec3 p = (ro + (rd * march.hit.x));
    col = ShipMaterial_shade(p, NamekScene_calcNormal(self_, p), rd, march.hit.y, march.hit.x, pixA, lineA, self_.ship, self_.trees, self_.details, self_.lettering);
    frontT = march.hit.x;
  } else if ((terrainT > 0.0)) {
    col = Terrain_shade((ro + (rd * terrainT)), ro, terrainT, pixA, lineA, self_.ship, self_.trees);
    frontT = terrainT;
  } else {
    col = Sky_color(rd);
  }
  if ((march.tEdge < frontT)) {
    col = mix(col, INK, edge);
  }
  return col;
}

vec4 NamekScene_colorAt(NamekScene self_, vec2 uv) {
  float _licm0 = float(AA);
  vec2 resolution = u.resolution;
  vec2 fragCoord = (uv * resolution);
  vec2 pointer = (u.mouse - vec2(0.5, 0.5));
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
  vec3 _cse0 = vec3(0.0, 0.0, 0.0);
  vec3 col = _cse0;
  for (int j = 0; (j < AA); j = (j + 1)) {
    for (int i = 0; (i < AA); i = (i + 1)) {
      vec2 offset = (((vec2(float(i), float(j)) + 0.5) / _licm0) - 0.5);
      vec2 screenUV = (((2.0 * (fragCoord + offset)) - resolution) / resolution.y);
      vec3 rd = normalize((((screenUV.x * cameraRight) + (screenUV.y * cameraUp)) + (3.4 * cameraForward)));
      col += NamekScene_render(self_, rayOrigin, rd, pixA, lineA);
    }
  }
  col /= float((AA * AA));
  vec2 q = (fragCoord / resolution);
  col = ((col * vec3(0.94, 1.0, 0.96)) + vec3(0.025, 0.035, 0.03));
  col += (0.03 * (Noise_hash12((fragCoord + (61.7 * fract((u.time * 7.13))))) - 0.5));
  col *= (0.55 + (0.45 * pow(((((16.0 * q.x) * q.y) * (1.0 - q.x)) * (1.0 - q.y)), 0.12)));
  return vec4(clamp(col, _cse0, vec3(1.0, 1.0, 1.0)), 1.0);
}

NamekScene NamekScene_new() {
  Ship _cse0 = Ship(0.0);
  NamekTree _cse2 = NamekTree(vec2(0.0, 0.0), 0.0, 0.0);
  NamekTrees _cse1 = NamekTrees(_cse2, _cse2);
  NamekScene self_ = NamekScene(_cse0, _cse1, ShipDetails(_cse0, _cse1), Lettering(0.0));
  self_.ship = Ship_new();
  self_.trees = NamekTrees_new();
  self_.details = ShipDetails_new(self_.ship, self_.trees);
  self_.lettering = Lettering_new();
  return self_;
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  NamekScene scene = NamekScene_new();
  _ret = NamekScene_colorAt(scene, uv);
}
