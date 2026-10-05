diagnostic(off, derivative_uniformity);

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
const TET: array<vec3<f32>, 4> = array<vec3<f32>, 4>(vec3<f32>(1.0, (-1.0), (-1.0)), vec3<f32>((-1.0), (-1.0), 1.0), vec3<f32>((-1.0), 1.0, (-1.0)), vec3<f32>(1.0, 1.0, 1.0));

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

@group(0) @binding(0) var<uniform> u: Uniforms;

fn PolarResult_new(point: vec3<f32>, index: f32) -> PolarResult {
  var self_: PolarResult = PolarResult(vec3<f32>(0.0, 0.0, 0.0), 0.0);
  self_.point = point;
  self_.index = index;
  return self_;
}

fn MarchResult_new(hit: vec2<f32>, edge: f32, winEdge: f32, tEdge: f32) -> MarchResult {
  var self_: MarchResult = MarchResult(vec2<f32>(0.0, 0.0), 0.0, 0.0, 0.0);
  self_.hit = hit;
  self_.edge = edge;
  self_.winEdge = winEdge;
  self_.tEdge = tEdge;
  return self_;
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
  var q: vec2<f32> = p;
  var sum: f32 = 0.0;
  var amplitude: f32 = 0.5;
  for (var i: i32 = 0; (i < 4); i = (i + 1)) {
    sum += (amplitude * Noise_value(q));
    q = (rotation * q);
    amplitude *= 0.5;
  }
  return (sum / 0.9375);
}

fn Noise_mod(x: f32, y: f32) -> f32 {
  return (x - (y * floor((x / y))));
}

fn Noise_wrapX(p: vec2<f32>, n: f32) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let q = ((f * f) * (3.0 - (2.0 * f)));
  let i0 = Noise_mod(i.x, n);
  let i1 = Noise_mod((i.x + 1.0), n);
  let _lc0 = (i.y + 1.0);
  return mix(mix(Noise_hash12(vec2<f32>(i0, i.y)), Noise_hash12(vec2<f32>(i1, i.y)), q.x), mix(Noise_hash12(vec2<f32>(i0, _lc0)), Noise_hash12(vec2<f32>(i1, _lc0)), q.x), q.y);
}

fn Noise_fbmWrapX(p: vec2<f32>, n: f32) -> f32 {
  let _licm0 = vec2<f32>(0.0, 5.3);
  var q: vec2<f32> = p;
  var period: f32 = n;
  var sum: f32 = 0.0;
  var amplitude: f32 = 0.5;
  for (var i: i32 = 0; (i < 4); i = (i + 1)) {
    sum += (amplitude * Noise_wrapX(q, period));
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

fn SDF_box(p: vec3<f32>, b: vec3<f32>) -> f32 {
  let q = (abs(p) - b);
  return (length(max(q, vec3<f32>(0.0, 0.0, 0.0))) + min(max(q.x, max(q.y, q.z)), 0.0));
}

fn SDF_box2(p: vec2<f32>, b: vec2<f32>) -> f32 {
  let q = (abs(p) - b);
  return (length(max(q, vec2<f32>(0.0, 0.0))) + min(max(q.x, q.y), 0.0));
}

fn SDF_trapezoid(p: vec2<f32>, r1: f32, r2: f32, height: f32) -> f32 {
  let k1 = vec2<f32>(r2, height);
  let k2 = vec2<f32>((r2 - r1), (2.0 * height));
  let qx = abs(p.x);
  let q = vec2<f32>(qx, p.y);
  let ca = vec2<f32>((qx - min(qx, select(r2, r1, (q.y < 0.0)))), (abs(q.y) - height));
  let cb = ((q - k1) + (k2 * clamp((dot((k1 - q), k2) / dot(k2, k2)), 0.0, 1.0)));
  let sign = select(1.0, -1.0, ((cb.x < 0.0) && (ca.y < 0.0)));
  return (sign * sqrt(min(dot(ca, ca), dot(cb, cb))));
}

fn SDF_cylinderY(p: vec3<f32>, radius: f32, y0: f32, y1: f32) -> f32 {
  let d = vec2<f32>((length(p.xz) - radius), (abs((p.y - (0.5 * (y0 + y1)))) - (0.5 * (y1 - y0))));
  return (min(max(d.x, d.y), 0.0) + length(max(d, vec2<f32>(0.0, 0.0))));
}

fn SDF_coneY(p: vec3<f32>, rb: f32, rt: f32, y0: f32, y1: f32) -> f32 {
  let halfHeight = (0.5 * (y1 - y0));
  let q = vec2<f32>(length(p.xz), ((p.y - y0) - halfHeight));
  let k1 = vec2<f32>(rt, halfHeight);
  let k2 = vec2<f32>((rt - rb), (2.0 * halfHeight));
  let ca = vec2<f32>((q.x - min(q.x, select(rt, rb, (q.y < 0.0)))), (abs(q.y) - halfHeight));
  let cb = ((q - k1) + (k2 * clamp((dot((k1 - q), k2) / dot(k2, k2)), 0.0, 1.0)));
  let sign = select(1.0, -1.0, ((cb.x < 0.0) && (ca.y < 0.0)));
  return (sign * sqrt(min(dot(ca, ca), dot(cb, cb))));
}

fn SDF_cutSphereBelow(p: vec3<f32>, radius: f32, height: f32) -> f32 {
  let width = sqrt(((radius * radius) - (height * height)));
  let q = vec2<f32>(length(p.xz), (-p.y));
  let h = (-height);
  let s = max(((((h - radius) * q.x) * q.x) + ((width * width) * ((h + radius) - (2.0 * q.y)))), ((h * q.x) - (width * q.y)));
  return select(select(length((q - vec2<f32>(width, h))), (h - q.y), (q.x < width)), (length(q) - radius), (s < 0.0));
}

fn SDF_cylinderSegment(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, radius: f32) -> f32 {
  let pa = (p - a);
  let ba = (b - a);
  let lengthAB = length(ba);
  let h = (dot(pa, ba) / lengthAB);
  let _lc0 = (0.5 * lengthAB);
  let d = vec2<f32>((length((pa - (ba * (h / lengthAB)))) - radius), (abs((h - _lc0)) - _lc0));
  return (min(max(d.x, d.y), 0.0) + length(max(d, vec2<f32>(0.0, 0.0))));
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

fn SDF_polarY(angle: f32, radius: f32, y: f32, count: f32, offset: f32) -> PolarResult {
  let sector = (TAU / count);
  let shifted = (angle - offset);
  let index = floor(((shifted / sector) + 0.5));
  let localAngle = (shifted - (index * sector));
  return PolarResult_new(vec3<f32>((radius * sin(localAngle)), y, (radius * cos(localAngle))), index);
}

fn Ship_flapOutline(self_: Ship, s: vec3<f32>) -> f32 {
  let angle = (asin(FLAP_Y) - atan2(s.y, length(s.xz)));
  let _cse0 = (0.5 * FLAP_LEN);
  return (SDF_trapezoid(vec2<f32>(s.x, (angle - _cse0)), (FLAP_HW - 0.06), (FLAP_TIP_HW - 0.06), (_cse0 - 0.06)) - 0.06);
}

fn Ship_flapHome(self_: Ship, l: vec3<f32>) -> vec3<f32> {
  let hinge = vec2<f32>(sqrt((1.0 - (FLAP_Y * FLAP_Y))), FLAP_Y);
  let q = (hinge + SDF_rotate((l.zy - hinge), (-FLAP_OPEN)));
  return vec3<f32>(l.x, q.y, q.x);
}

fn Ship_flap(self_: Ship, l: vec3<f32>) -> f32 {
  let home = Ship_flapHome(self_, l);
  let _cse0 = (0.5 * FLAP_T);
  return max((abs(((length(home) - 1.0) + _cse0)) - _cse0), Ship_flapOutline(self_, home));
}

fn Ship_mapLeg(self_: Ship, l: vec3<f32>, best: f32) -> vec2<f32> {
  var y: f32 = -0.73;
  let hinge = vec2<f32>(sqrt((1.0 - (FLAP_Y * FLAP_Y))), FLAP_Y);
  let tipLat = (asin(FLAP_Y) - FLAP_LEN);
  let tip = (hinge + SDF_rotate((vec2<f32>(cos(tipLat), sin(tipLat)) - hinge), FLAP_OPEN));
  var bounds: f32 = max(((SDF_segment(l.zy, hinge, tip) - FLAP_T) - FLAP_HW), (abs(l.x) - FLAP_HW));
  let lo = vec3<f32>(-0.1, GROUND, 0.0);
  let hi = vec3<f32>(0.1, ((y + 0.02) + 0.02), (LEG_R + 0.1));
  bounds = min(bounds, SDF_box((l - (0.5 * (lo + hi))), (0.5 * (hi - lo))));
  if ((bounds > min(best, 0.1))) {
    return vec2<f32>(bounds, 5.0);
  }
  let c = (l - vec3<f32>(0.0, 0.0, LEG_R));
  var leg: f32 = (SDF_cylinderY(c, 0.05, (SHOCK_Y + 0.01), -0.72) - 0.01);
  leg = min(leg, SDF_cylinderY(c, 0.025, (GROUND + 0.05), SHOCK_Y));
  leg = min(leg, SDF_capsule(l, vec3<f32>(0.0, (y + 0.02), 0.6), vec3<f32>(0.0, y, LEG_R), 0.018));
  let joint = (LEG_R - 0.2);
  let _gv0 = (y - 0.09);
  leg = min(leg, SDF_capsule(l, vec3<f32>(-0.05, y, 0.6), vec3<f32>(-0.05, _gv0, joint), 0.018));
  leg = min(leg, SDF_capsule(l, vec3<f32>(0.05, y, 0.6), vec3<f32>(0.05, _gv0, joint), 0.018));
  y -= 0.09;
  let _lc0 = (y + 0.02);
  leg = min(leg, SDF_cylinderSegment(l, vec3<f32>(-0.07, _lc0, joint), vec3<f32>(0.07, _lc0, joint), 0.05));
  let _gv1 = vec3<f32>(0.05, (y + 0.02), joint);
  leg = min(leg, SDF_capsule(l, _gv1, vec3<f32>(0.05, y, LEG_R), 0.012));
  let _gv2 = vec3<f32>(-0.05, (y + 0.02), joint);
  leg = min(leg, SDF_capsule(l, _gv2, vec3<f32>(-0.05, y, LEG_R), 0.012));
  leg = min(leg, SDF_capsule(l, _gv1, vec3<f32>(0.05, y, 0.2), 0.012));
  leg = min(leg, SDF_capsule(l, _gv2, vec3<f32>(-0.05, y, 0.2), 0.012));
  var result: vec2<f32> = vec2<f32>(leg, 5.0);
  result = SDF_union(result, vec2<f32>((SDF_coneY(c, 0.094, 0.024, (GROUND + 0.006), (GROUND + 0.064)) - 0.006), 6.0));
  result = SDF_union(result, vec2<f32>(Ship_flap(self_, l), 10.0));
  return result;
}

fn Ship_map(self_: Ship, p: vec3<f32>) -> vec2<f32> {
  let bound = (length((p - vec3<f32>(0.0, -0.3, 0.0))) - 1.6);
  if ((bound > 0.25)) {
    return vec2<f32>(bound, 0.0);
  }
  let radius = length(p);
  let longitude = atan2(p.x, p.z);
  let horizontalRadius = length(p.xz);
  let legFrame = SDF_polarY(longitude, horizontalRadius, p.y, self_.legCount, LEG_LON);
  let l = legFrame.point;
  let bay = max(Ship_flapOutline(self_, l), (((1.0 - FLAP_T) - BAY_DEPTH) - radius));
  var result: vec2<f32> = select(vec2<f32>((-bay), 11.0), vec2<f32>((radius - 1.0), 0.0), ((radius - 1.0) > (-bay)));
  let _cse0 = (BELLY_Y - p.y);
  if ((_cse0 > result.x)) {
    result = vec2<f32>(_cse0, 12.0);
  }
  result = SDF_union(result, vec2<f32>(max((radius - 1.022), (abs((p.y - RING_Y)) - RING_H)), 1.0));
  let door = SDF_arch(vec2<f32>((longitude * horizontalRadius), p.y), DOOR_HW, DOOR_Y0, DOOR_Y1);
  result = SDF_union(result, vec2<f32>(max(((radius - 1.0) - DOOR_T), door), 4.0));
  let windowFrame = SDF_polarY(longitude, horizontalRadius, p.y, WIN_N, 0.0);
  if ((abs(windowFrame.index) > 0.5)) {
    let center = vec3<f32>(0.0, WIN_Y, sqrt((1.0 - (WIN_Y * WIN_Y))));
    let w = (windowFrame.point - center);
    let h = dot(w, center);
    let glassRadius = (((WIN_A * WIN_A) + (WIN_BULGE * WIN_BULGE)) / (2.0 * WIN_BULGE));
    result = SDF_union(result, vec2<f32>((length((windowFrame.point - (center * ((1.0 + WIN_BULGE) - glassRadius)))) - glassRadius), 2.0));
    result = SDF_union(result, vec2<f32>((length(vec2<f32>((length((w - (h * center))) - 0.114), h)) - 0.017), 3.0));
  }
  result = SDF_union(result, Ship_mapLeg(self_, l, result.x));
  let bellyPoint = (p + vec3<f32>(0.0, BELLY_EXT, 0.0));
  result = SDF_union(result, vec2<f32>(SDF_cutSphereBelow(bellyPoint, 1.0, BELLY_Y), select(0.0, 12.0, ((bellyPoint.y - BELLY_Y) > (length(bellyPoint) - 1.0)))));
  result = SDF_union(result, vec2<f32>(SDF_cylinderY(p, SHAFT_R, ((BELLY_Y - BELLY_EXT) - 0.01), (BELLY_Y + 0.05)), 7.0));
  return result;
}

fn Ship_new() -> Ship {
  var self_: Ship = Ship(0.0);
  self_.legCount = 4.0;
  return self_;
}

fn NamekTree_map(self_: NamekTree, p: vec3<f32>) -> vec2<f32> {
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

fn NamekTree_shadowRadius(self_: NamekTree) -> f32 {
  return (((0.5 * self_.height) + self_.radius) + 0.1);
}

fn NamekTree_shadowCenter(self_: NamekTree) -> vec3<f32> {
  return vec3<f32>(self_.position.x, (GROUND + (0.5 * self_.height)), self_.position.y);
}

fn NamekTree_new(position: vec2<f32>, height: f32, radius: f32) -> NamekTree {
  var self_: NamekTree = NamekTree(vec2<f32>(0.0, 0.0), 0.0, 0.0);
  self_.position = position;
  self_.height = height;
  self_.radius = radius;
  return self_;
}

fn NamekTrees_map(self_: NamekTrees, p: vec3<f32>) -> vec2<f32> {
  var result: vec2<f32> = NamekTree_map(self_.first, p);
  result = SDF_union(result, NamekTree_map(self_.second, p));
  return result;
}

fn NamekTrees_nearest(self_: NamekTrees, p: vec3<f32>) -> NamekTree {
  let firstDistance = length((p.xz - self_.first.position));
  let secondDistance = length((p.xz - self_.second.position));
  var _sel0: NamekTree;
  if ((firstDistance < secondDistance)) {
    _sel0 = self_.first;
  } else {
    _sel0 = self_.second;
  }
  return _sel0;
}

fn NamekTrees_casterExit(self_: NamekTrees, ro: vec3<f32>, rd: vec3<f32>, current: f32) -> f32 {
  let firstExit = NamekTrees_sphereExit(self_, ro, rd, NamekTree_shadowCenter(self_.first), NamekTree_shadowRadius(self_.first));
  let secondExit = NamekTrees_sphereExit(self_, ro, rd, NamekTree_shadowCenter(self_.second), NamekTree_shadowRadius(self_.second));
  return max(current, max(firstExit, secondExit));
}

fn NamekTrees_sphereExit(self_: NamekTrees, ro: vec3<f32>, rd: vec3<f32>, center: vec3<f32>, radius: f32) -> f32 {
  let oc = (ro - center);
  let b = dot(oc, rd);
  let h = (((b * b) - dot(oc, oc)) + (radius * radius));
  return select(0.0, ((-b) + sqrt(h)), (h > 0.0));
}

fn NamekTrees_new() -> NamekTrees {
  let _cse0 = NamekTree(vec2<f32>(0.0, 0.0), 0.0, 0.0);
  var self_: NamekTrees = NamekTrees(_cse0, _cse0);
  self_.first = NamekTree_new(vec2<f32>(1.86, 0.83), 0.65, 0.15);
  self_.second = NamekTree_new(vec2<f32>(-5.9, -4.4), 1.9, 0.38);
  return self_;
}

fn ShipDetails_tickRow(self_: ShipDetails, q: vec2<f32>, seed: vec2<f32>, n: i32, gap: f32, len: f32, bend: f32, curl: f32, spread: f32, lw: f32) -> f32 {
  let _licm0 = max((-bend), 0.0);
  let _licm1 = (0.4 * gap);
  let _licm2 = (0.35 * len);
  let mid = (0.5 * f32((n - 1)));
  let radius = (((2.0 * mid) * gap) / PI);
  let bendSign = select(1.0, -1.0, (bend < 0.0));
  var distance: f32 = 1000000000.0;
  let _cse0 = (0.5 * PI);
  for (var k: i32 = 0; (k < 9); k = (k + 1)) {
    if ((k >= n)) {
      break;
    }
    let _gv1 = f32(k);
    let _gv0 = (_gv1 - mid);
    let fk = (_gv0 / mid);
    let h = vec4<f32>(Noise_hash12(((seed + (_gv1 * 3.1)) + 51.0)), Noise_hash12(((seed + (_gv1 * 5.7)) + 63.0)), Noise_hash12(((seed + (_gv1 * 2.3)) + 77.0)), Noise_hash12(((seed + (_gv1 * 4.9)) + 89.0)));
    var base: vec2<f32> = vec2<f32>((gap * _gv0), (((bend * fk) * fk) + _licm0));
    let _lc1 = (_cse0 * fk);
    base = mix(base, (radius * vec2<f32>(sin(_lc1), (bendSign * (1.0 - cos(_lc1))))), curl);
    base += vec2<f32>((_licm1 * (h.x - 0.5)), (_licm2 * h.y));
    let bladeLength = (len * (1.0 - (spread * Noise_hash12(((seed + (_gv1 * 6.1)) + 97.0)))));
    let angle = (0.5 * (h.z - 0.5));
    distance = min(distance, (SDF_segment(q, base, (base + (bladeLength * vec2<f32>(sin(angle), cos(angle))))) - ((0.5 + h.w) * lw)));
  }
  return distance;
}

fn ShipDetails_scuffInk(self_: ShipDetails, p: vec3<f32>, t: f32, lineA: f32, aa: f32) -> f32 {
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
      let cell = vec2<f32>(((floor((lon / deltaAngle)) + f32(i)) - ringCells * floor((floor((lon / deltaAngle)) + f32(i)) / ringCells)), ring);
      if ((Noise_hash12(((cell * 1.17) + 3.9)) > fill)) {
        continue;
      }
      let g = vec4<f32>(Noise_hash12((cell + 7.3)), Noise_hash12((cell + 19.1)), Noise_hash12((cell + 23.9)), Noise_hash12((cell + 37.3)));
      let cellLat = (((ring + 0.25) + (0.5 * g.x)) * cellA);
      let cellLon = (((cell.x + 0.25) + (0.5 * g.y)) * deltaAngle);
      let _lc0 = cos(cellLat);
      let _gv0 = sin(cellLon);
      let _gv1 = cos(cellLon);
      let center = vec3<f32>((_lc0 * _gv0), sin(cellLat), (_lc0 * _gv1));
      let east = vec3<f32>(_gv1, 0.0, (-_gv0));
      let _lc1 = (normal - center);
      let local = SDF_rotate(vec2<f32>(dot(_lc1, east), dot(_lc1, cross(center, east))), (2.4 * (g.z - 0.5)));
      if ((dot(local, local) > 0.0225)) {
        continue;
      }
      let hatchTest = SDF_arch(vec2<f32>((atan2(center.x, center.z) * length(center.xz)), center.y), DOOR_HW, DOOR_Y0, DOOR_Y1);
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

fn ShipDetails_hatchedSheen(self_: ShipDetails, normal: vec3<f32>, viewRight: vec3<f32>, viewUp: vec3<f32>, aa: f32) -> f32 {
  let sheenCenter = ((0.6 * viewUp) - (0.8 * viewRight));
  let c0 = cos((SHEEN_R + (0.1 * (Noise_value((7.0 * vec2<f32>(dot(normal, viewRight), dot(normal, viewUp)))) - 0.5))));
  let rho = max(length(normal.xz), 0.0001);
  let hH = length(sheenCenter.xz);
  let m = (normal.y * sheenCenter.y);
  let w = (rho * hH);
  let angle = acos(clamp((dot(normal.xz, sheenCenter.xz) / w), -1.0, 1.0));
  let q = ((c0 - m) / w);
  var e: f32 = 0.0;
  var de: f32 = 0.0;
  if ((abs(q) < 1.0)) {
    let lit = acos(q);
    let _gv0 = (lit - angle);
    e = (rho * _gv0);
    de = (((-normal.y) * _gv0) - (((c0 * normal.y) - sheenCenter.y) / (w * max(sqrt((1.0 - (q * q))), 0.05))));
  } else {
    let _gv1 = sign(q);
    let hm = (m + (_gv1 * w));
    let gap = (abs((c0 - hm)) / sqrt(max((1.0 - (hm * hm)), 0.0001)));
    let arc = select((PI - angle), angle, (q > 0.0));
    e = ((-_gv1) * (gap + (rho * arc)));
    de = ((_gv1 * normal.y) * arc);
  }
  let s = (asin(clamp(normal.y, -1.0, 1.0)) / HATCH_W);
  let c1 = floor((s + 0.5));
  let u1 = (s - c1);
  let c2 = floor(s);
  let u2 = ((s - c2) - 0.5);
  let fit = min(1.0, ((1.25 * rho) / max(HATCH_L, HATCH_D)));
  let lightLength = ((fit * HATCH_L) * (0.15 + (0.85 * Noise_hash12(vec2<f32>(c1, 3.1)))));
  let darkLength = ((fit * HATCH_D) * (0.15 + (0.85 * Noise_hash12(vec2<f32>(c2, 7.7)))));
  let z = ((e + (lightLength * (1.0 - (2.0 * abs(u1))))) - (darkLength * (1.0 - (2.0 * abs(u2)))));
  let dz = (de + ((2.0 * ((darkLength * sign(u2)) - (lightLength * sign(u1)))) / HATCH_W));
  return smoothstep((-aa), aa, (z / sqrt((1.0 + (dz * dz)))));
}

fn ShipDetails_new(ship: Ship, trees: NamekTrees) -> ShipDetails {
  let _cse0 = NamekTree(vec2<f32>(0.0, 0.0), 0.0, 0.0);
  var self_: ShipDetails = ShipDetails(Ship(0.0), NamekTrees(_cse0, _cse0));
  self_.ship = ship;
  self_.trees = trees;
  return self_;
}

fn Lettering_rect(self_: Lettering, p: vec2<f32>, x0: f32, y0: f32, x1: f32, y1: f32) -> f32 {
  return SDF_box2((p - (0.5 * vec2<f32>((x0 + x1), (y0 + y1)))), (0.5 * vec2<f32>((x1 - x0), (y1 - y0))));
}

fn Lettering_stroke(self_: Lettering, p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
  return (SDF_segment(p, a, b) - self_.strokeWidth);
}

fn Lettering_arc(self_: Lettering, p: vec2<f32>, center: vec2<f32>, radius: f32, start: f32, end: f32) -> f32 {
  let q = (p - center);
  if ((((atan2(q.y, q.x) - start) - TAU * floor((atan2(q.y, q.x) - start) / TAU)) < (end - start))) {
    return (abs((length(q) - radius)) - self_.strokeWidth);
  }
  return (min(length((q - (radius * vec2<f32>(cos(start), sin(start))))), length((q - (radius * vec2<f32>(cos(end), sin(end)))))) - self_.strokeWidth);
}

fn Lettering_glyph(self_: Lettering, p: vec2<f32>, glyphId: i32) -> f32 {
  var d: f32 = 0.0;
  let _cse0 = vec2<f32>(0.0, -0.2);
  let _cse1 = (glyphId == 8);
  let _cse2 = Lettering_rect(self_, p, -0.27, -0.5, -0.1, 0.5);
  let _cse3 = Lettering_rect(self_, p, -0.27, -0.5, 0.26, -0.33);
  if ((glyphId == 0)) {
    d = min(Lettering_arc(self_, p, vec2<f32>(0.0, 0.2), 0.215, 0.5, PI), Lettering_arc(self_, p, _cse0, 0.215, PI, (TAU - 0.5)));
    d = min(d, Lettering_rect(self_, p, -0.3, -0.2, -0.13, 0.2));
  } else if ((glyphId == 1)) {
    d = min(Lettering_stroke(self_, p, vec2<f32>(-0.245, -0.6), vec2<f32>(-0.01, 0.6)), Lettering_stroke(self_, p, vec2<f32>(0.245, -0.6), vec2<f32>(0.01, 0.6)));
    d = min(d, Lettering_rect(self_, p, -0.16, -0.22, 0.16, -0.06));
  } else if (((glyphId == 2) || _cse1)) {
    d = min(Lettering_rect(self_, p, -0.28, -0.5, -0.11, 0.5), Lettering_rect(self_, p, -0.28, 0.33, 0.0, 0.5));
    d = min(d, Lettering_rect(self_, p, -0.28, -0.08, 0.0, 0.09));
    d = min(d, Lettering_arc(self_, p, vec2<f32>(0.0, 0.205), 0.21, (-0.5 * PI), (0.5 * PI)));
    if (_cse1) {
      d = min(d, Lettering_stroke(self_, p, vec2<f32>(0.0, 0.0), vec2<f32>(0.24, -0.6)));
    }
  } else if ((glyphId == 3)) {
    d = min(Lettering_arc(self_, p, vec2<f32>(0.0, 0.2075), 0.2075, 0.4, (1.5 * PI)), Lettering_arc(self_, p, vec2<f32>(0.0, -0.2075), 0.2075, (PI + 0.4), (2.5 * PI)));
  } else if ((glyphId == 4)) {
    d = min(Lettering_rect(self_, p, -0.3, -0.2, -0.13, 0.5), Lettering_rect(self_, p, 0.13, -0.2, 0.3, 0.5));
    d = min(d, Lettering_arc(self_, p, _cse0, 0.215, PI, TAU));
  } else if ((glyphId == 5)) {
    d = min(_cse2, _cse3);
  } else if ((glyphId == 6)) {
    d = min(_cse2, Lettering_rect(self_, p, -0.27, 0.33, 0.26, 0.5));
    d = min(d, min(Lettering_rect(self_, p, -0.27, -0.085, 0.2, 0.085), _cse3));
  } else if ((glyphId == 7)) {
    d = (abs((length(vec2<f32>(p.x, (p.y - clamp(p.y, -0.2, 0.2)))) - 0.215)) - self_.strokeWidth);
  } else {
    d = (length((p - vec2<f32>(-0.26, -0.4))) - 0.1);
  }
  return max(d, (abs(p.y) - 0.5));
}

fn Lettering_render(self_: Lettering, p: vec3<f32>, aa: f32) -> f32 {
  let longitude = atan2(p.x, p.z);
  let latitude = asin(clamp((p.y / length(p)), -1.0, 1.0));
  var ink: f32 = 0.0;
  var caps: vec2<f32> = (vec2<f32>(((longitude - CAPS_LON) * cos(CAPS_LAT)), (latitude - CAPS_LAT)) / CAPS_H);
  var index: f32 = floor(((caps.x / ADV) + 3.5));
  let _cse0 = (-aa);
  if ((((abs(caps.y) < 0.6) && (index >= 0.0)) && (index < 7.0))) {
    ink = (1.0 - smoothstep(_cse0, aa, (CAPS_H * Lettering_glyph(self_, vec2<f32>((caps.x - ((index - 3.0) * ADV)), caps.y), i32(index)))));
  }
  var corp: vec2<f32> = (vec2<f32>(((longitude - CORP_LON) * cos(CORP_LAT)), (latitude - CORP_LAT)) / CORP_H);
  index = floor(((corp.x / ADV) + 2.5));
  if ((((abs(corp.y) < 0.6) && (index >= 0.0)) && (index < 5.0))) {
    let glyphId = select(select(select(select(9, 2, (index < 3.5)), 8, (index < 2.5)), 7, (index < 1.5)), 0, (index < 0.5));
    ink = max(ink, (1.0 - smoothstep(_cse0, aa, (CORP_H * Lettering_glyph(self_, vec2<f32>((corp.x - ((index - 2.0) * ADV)), corp.y), glyphId)))));
  }
  return ink;
}

fn Lettering_new() -> Lettering {
  var self_: Lettering = Lettering(0.0);
  self_.strokeWidth = SW;
  return self_;
}

fn ShipMaterial_celShadow(ro: vec3<f32>, rd: vec3<f32>, ship: Ship, trees: NamekTrees) -> f32 {
  var tmax: f32 = ShipMaterial_sphereExit(ro, rd, vec3<f32>(0.0, -0.3, 0.0), 2.0);
  tmax = NamekTrees_casterExit(trees, ro, rd, tmax);
  tmax = min(tmax, 9.0);
  if ((tmax < 0.02)) {
    return 1.0;
  }
  var result: f32 = 1.0;
  var t: f32 = 0.02;
  for (var i: i32 = 0; (i < 64); i = (i + 1)) {
    let h = ShipMaterial_mapCel((ro + (rd * t)), ship, trees).x;
    result = min(result, ((10.0 * h) / t));
    t += clamp(h, 0.01, 0.3);
    if (((result < 0.0) || (t > tmax))) {
      break;
    }
  }
  return smoothstep(0.25, 0.4, result);
}

fn ShipMaterial_shade(p: vec3<f32>, n: vec3<f32>, rd: vec3<f32>, id: f32, t: f32, pixA: f32, lineA: f32, ship: Ship, trees: NamekTrees, details: ShipDetails, lettering: Lettering) -> vec3<f32> {
  let aa = (((0.7 * pixA) * t) / max(dot(n, (-rd)), 0.3));
  let lw = ((0.5 * lineA) * t);
  var lightAmount: f32 = smoothstep(-0.02, 0.02, dot(n, LIG));
  if ((lightAmount > 0.0)) {
    lightAmount *= ShipMaterial_celShadow((p + (n * 0.004)), LIG, ship, trees);
  }
  let _cse0 = vec3<f32>(1.0, 1.0, 1.0);
  let lit = mix(SHADE, _cse0, lightAmount);
  let _cse1 = vec3<f32>(0.0, 0.0, 0.0);
  var col: vec3<f32> = _cse1;
  let _cse2 = vec3<f32>(0.0, 1.0, 0.0);
  let _cse3 = atan2(p.x, p.z);
  let _cse4 = length(p.xz);
  let _cse5 = (length(p) - 1.0);
  if ((id < 0.5)) {
    let _gv0 = (-aa);
    let cap = smoothstep(_gv0, aa, (p.y - (RING_Y + RING_H)));
    let band = (smoothstep(_gv0, aa, (p.y - BAND_BOT)) - smoothstep(_gv0, aa, (p.y - BAND_TOP)));
    let viewDirection = normalize(((t * rd) - p));
    let viewRight = normalize(cross(viewDirection, _cse2));
    let sheen = ShipDetails_hatchedSheen(details, n, viewRight, cross(viewRight, viewDirection), aa);
    let blackPaint = (mix(BLACK, BLACK_HI, sheen) * mix(0.7, 1.0, lightAmount));
    let dark = max(cap, band);
    col = mix((HULL * lit), blackPaint, dark);
    col = mix(col, INK, max(Lettering_render(lettering, p, aa), ((1.0 - dark) * ShipDetails_scuffInk(details, p, t, lineA, aa))));
  } else if ((id < 1.5)) {
    let dy = abs((p.y - RING_Y));
    col = (HULL * lit);
    let _lc1 = (0.6 * lw);
    var ink: f32 = (1.0 - smoothstep((_lc1 - aa), (_lc1 + aa), dy));
    let _lc2 = (RING_H - (1.3 * lw));
    ink = max(ink, smoothstep((_lc2 - aa), (_lc2 + aa), dy));
    col = mix(col, INK, ink);
  } else if ((id < 2.5)) {
    let windowFrame = SDF_polarY(_cse3, _cse4, p.y, WIN_N, 0.0);
    let q = windowFrame.point;
    let center = vec3<f32>(0.0, WIN_Y, sqrt((1.0 - (WIN_Y * WIN_Y))));
    let w = vec2<f32>(q.x, dot((q - center), normalize((_cse2 - (center * WIN_Y)))));
    let radius = length(w);
    col = mix(GLASS_HI, GLASS_LO, smoothstep((0.1 - aa), (0.1 + aa), length((w - vec2<f32>(-0.035, 0.04)))));
    var streak: f32 = (abs((radius - 0.062)) - 0.011);
    streak = max(streak, ((abs((atan2(w.y, w.x) - 2.25)) * radius) - 0.035));
    col = mix(col, vec3<f32>(0.93, 0.98, 1.0), (1.0 - smoothstep((-aa), aa, streak)));
    col *= mix(0.8, 1.0, lightAmount);
  } else if ((id < 3.5)) {
    col = (METAL * lit);
  } else if ((id < 4.5)) {
    let doorDistance = SDF_arch(vec2<f32>((_cse3 * _cse4), p.y), DOOR_HW, DOOR_Y0, DOOR_Y1);
    let top = (_cse5 - DOOR_T);
    col = (HULL * lit);
    var ink_1: f32 = (1.0 - smoothstep((lw - aa), (lw + aa), length(vec2<f32>(doorDistance, top))));
    let _lc3 = (0.7 * lw);
    ink_1 = max(ink_1, (1.0 - smoothstep((_lc3 - aa), (_lc3 + aa), length(vec2<f32>(doorDistance, (top + DOOR_T))))));
    col = mix(col, INK, ink_1);
  } else if ((id < 7.5)) {
    col = (METAL * mix(vec3<f32>(0.5, 0.6, 0.78), _cse0, lightAmount));
  } else if ((id < 8.5)) {
    col = (TRUNK * lit);
  } else if ((id < 9.5)) {
    let tree = NamekTrees_nearest(trees, p);
    let normal = normalize((p - vec3<f32>(tree.position.x, (GROUND + tree.height), tree.position.y)));
    let k = (dot(normalize((normal + (0.5 * n))), LIG) + (0.15 * (Noise_value(((normal.xy * 9.0) + (normal.z * 5.0))) - 0.5)));
    col = mix((LEAF * vec3<f32>(0.72, 0.78, 0.9)), LEAF, (smoothstep(0.0, 0.04, k) * ShipMaterial_celShadow((p + (n * 0.01)), LIG, ship, trees)));
    col = mix(col, LEAF_HI, smoothstep(0.55, 0.59, k));
  } else if ((id < 10.5)) {
    let legFrame = SDF_polarY(_cse3, _cse4, p.y, 4.0, LEG_LON);
    let local = Ship_flapHome(ship, legFrame.point);
    let rotated = SDF_rotate(local.xz, ((-LEG_LON) - ((0.5 * PI) * legFrame.index)));
    col = mix((HULL * lit), INK, ShipDetails_scuffInk(details, vec3<f32>(rotated.x, local.y, rotated.y), t, lineA, aa));
  } else if ((id < 11.5)) {
    col = mix(_cse1, (HULL * lit), smoothstep((-aa), aa, (_cse5 + FLAP_T)));
  } else {
    col = mix(_cse1, (HULL * lit), smoothstep((-aa), aa, ((_cse4 - BELLY_R) + FLAP_T)));
  }
  return col;
}

fn ShipMaterial_sphereExit(ro: vec3<f32>, rd: vec3<f32>, center: vec3<f32>, radius: f32) -> f32 {
  let oc = (ro - center);
  let b = dot(oc, rd);
  let h = (((b * b) - dot(oc, oc)) + (radius * radius));
  return select(0.0, ((-b) + sqrt(h)), (h > 0.0));
}

fn ShipMaterial_mapCel(p: vec3<f32>, ship: Ship, trees: NamekTrees) -> vec2<f32> {
  var result: vec2<f32> = Ship_map(ship, p);
  result = SDF_union(result, NamekTrees_map(trees, p));
  return result;
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
  var gradient: vec2<f32> = vec2<f32>(0.0, 0.0);
  for (var i: i32 = 0; (i < 4); i = (i + 1)) {
    gradient -= (CROSS[i] * Terrain_heightAt((x + (stepSize * CROSS[i]))));
  }
  return normalize(vec3<f32>(gradient.x, (2.0 * stepSize), gradient.y));
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
  let _cse0 = (0.5 * PI);
  for (var k: i32 = 0; (k < 9); k = (k + 1)) {
    if ((k >= n)) {
      break;
    }
    let _gv1 = f32(k);
    let _gv0 = (_gv1 - mid);
    let fk = (_gv0 / mid);
    let h = vec4<f32>(Noise_hash12(((seed + (_gv1 * 3.1)) + 51.0)), Noise_hash12(((seed + (_gv1 * 5.7)) + 63.0)), Noise_hash12(((seed + (_gv1 * 2.3)) + 77.0)), Noise_hash12(((seed + (_gv1 * 4.9)) + 89.0)));
    var base: vec2<f32> = vec2<f32>((gap * _gv0), (((bend * fk) * fk) + _licm0));
    let _lc1 = (_cse0 * fk);
    base = mix(base, (radius * vec2<f32>(sin(_lc1), (signBend * (1.0 - cos(_lc1))))), curl);
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
      let g = vec4<f32>(Noise_hash12((cell + 11.3)), Noise_hash12((cell + 23.7)), Noise_hash12((cell + 31.1)), Noise_hash12((cell + 47.9)));
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
  let normal = select(vec3<f32>(0.0, 1.0, 0.0), Terrain_normal(p.xz, t), (length(p.xz) > MESA_R));
  let x = p.xz;
  let radius = length(x);
  let height = (p.y - GROUND);
  let warped = Terrain_groundWarp(x);
  var col: vec3<f32> = mix(GRASS, GRASS_DK, (0.6 * smoothstep(0.55, 0.56, Noise_fbm(((warped * 1.1) + 3.0)))));
  var dirt: f32 = Terrain_dirtField(warped);
  let dirtGradient = vec2<f32>(dpdx(dirt), dpdy(dirt));
  let recede = smoothstep(0.25, 0.6, (abs(dirtGradient.x) / max(length(dirtGradient), 0.000001)));
  dirt += (0.03 * ((abs((Noise_value((x * 5.0)) - 0.5)) + (0.5 * abs((Noise_value(((x * 11.0) + 7.0)) - 0.5)))) - 0.35));
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
  var pattern: f32 = ((0.5 + ((Noise_fbm((vec2<f32>((0.45 * grain.x), (3.0 * grain.y)) + 27.0)) - 0.5) * (0.5 + Noise_value((_gv1 + 31.0))))) + ((0.7 * (Noise_value((vec2<f32>((1.2 * grain.x), (11.0 * grain.y)) + 41.0)) - 0.5)) * smoothstep(0.35, 0.75, Noise_value((vec2<f32>((0.7 * grain.x), (1.5 * grain.y)) + 13.0)))));
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
  let _lc0 = (0.02 * lap);
  foam = max(foam, smoothstep((0.61 - _lc0), (0.615 - _lc0), mesa));
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
    lightAmount *= ShipMaterial_celShadow((p + (normal * 0.02)), LIG, ship, trees);
  }
  col *= mix((SHADE * 0.95), vec3<f32>(1.0, 1.0, 1.0), lightAmount);
  return mix(col, HAZE, (1.0 - exp((-0.012 * t))));
}

fn Sky_color(rd: vec3<f32>) -> vec3<f32> {
  let y = max(rd.y, 0.0);
  var col: vec3<f32> = mix(SKY_HZ, SKY_MID, smoothstep(0.0, 0.12, y));
  col = mix(col, SKY_TOP, smoothstep(0.08, 0.35, y));
  let uv = vec2<f32>(((atan2(rd.x, rd.z) * (19.0 / TAU)) + (0.004 * u.time)), (y * 26.0));
  let clouds = Noise_fbmWrapX(((uv * vec2<f32>(1.0, 0.8)) + vec2<f32>(0.0, 3.0)), 19.0);
  let cloudMask = ((smoothstep(0.56, 0.6, clouds) * smoothstep(0.015, 0.05, y)) * (1.0 - smoothstep(0.18, 0.35, y)));
  col = mix(col, CLOUD, (0.75 * cloudMask));
  return col;
}

fn NamekScene_mapCel(self_: NamekScene, p: vec3<f32>) -> vec2<f32> {
  var result: vec2<f32> = Ship_map(self_.ship, p);
  result = SDF_union(result, NamekTrees_map(self_.trees, p));
  return result;
}

fn NamekScene_calcNormal(self_: NamekScene, p: vec3<f32>) -> vec3<f32> {
  var normal: vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);
  for (var i: i32 = 0; (i < 4); i = (i + 1)) {
    normal += (TET[i] * NamekScene_mapCel(self_, (p + (0.0007 * TET[i]))).x);
  }
  return normalize(normal);
}

fn NamekScene_marchCel(self_: NamekScene, ro: vec3<f32>, rd: vec3<f32>, lineA: f32, pixA: f32) -> MarchResult {
  var edge: f32 = 0.0;
  var windowEdge: f32 = 0.0;
  var edgeT: f32 = 10000000000.0;
  var t: f32 = 0.5;
  var previous: vec2<f32> = vec2<f32>(10000000000.0, -1.0);
  for (var i: i32 = 0; (i < 180); i = (i + 1)) {
    let hit = NamekScene_mapCel(self_, (ro + (rd * t)));
    if ((hit.x < (0.0003 * t))) {
      return MarchResult_new(vec2<f32>(t, hit.y), edge, windowEdge, edgeT);
    }
    let width = (lineA * t);
    if (((hit.x > previous.x) && (previous.x < width))) {
      let contour = clamp(((width - previous.x) / (pixA * t)), 0.0, 1.0);
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
  return MarchResult_new(vec2<f32>(t, -1.0), edge, windowEdge, edgeT);
}

fn NamekScene_render(self_: NamekScene, ro: vec3<f32>, rd: vec3<f32>, pixA: f32, lineA: f32) -> vec3<f32> {
  let march = NamekScene_marchCel(self_, ro, rd, lineA, pixA);
  var edge: f32 = march.edge;
  if ((abs((march.hit.y - 2.5)) > 1.0)) {
    edge = max(edge, march.winEdge);
  }
  let shipHit = (march.hit.y >= 0.0);
  let terrainT = Terrain_march(ro, rd, select(400.0, march.hit.x, shipHit));
  var col: vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);
  var frontT: f32 = 10000000000.0;
  if ((shipHit && (terrainT < 0.0))) {
    let p = (ro + (rd * march.hit.x));
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

fn NamekScene_colorAt(self_: NamekScene, uv: vec2<f32>) -> vec4<f32> {
  let _licm0 = f32(AA);
  let resolution = u.resolution;
  let fragCoord = (uv * resolution);
  let pointer = (u.mouse - vec2<f32>(0.5, 0.5));
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
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  var col: vec3<f32> = _cse0;
  for (var j: i32 = 0; (j < AA); j = (j + 1)) {
    for (var i: i32 = 0; (i < AA); i = (i + 1)) {
      let offset = (((vec2<f32>(f32(i), f32(j)) + 0.5) / _licm0) - 0.5);
      let screenUV = (((2.0 * (fragCoord + offset)) - resolution) / resolution.y);
      let rd = normalize((((screenUV.x * cameraRight) + (screenUV.y * cameraUp)) + (3.4 * cameraForward)));
      col += NamekScene_render(self_, rayOrigin, rd, pixA, lineA);
    }
  }
  col /= f32((AA * AA));
  let q = (fragCoord / resolution);
  col = ((col * vec3<f32>(0.94, 1.0, 0.96)) + vec3<f32>(0.025, 0.035, 0.03));
  col += (0.03 * (Noise_hash12((fragCoord + (61.7 * fract((u.time * 7.13))))) - 0.5));
  col *= (0.55 + (0.45 * pow(((((16.0 * q.x) * q.y) * (1.0 - q.x)) * (1.0 - q.y)), 0.12)));
  return vec4<f32>(clamp(col, _cse0, vec3<f32>(1.0, 1.0, 1.0)), 1.0);
}

fn NamekScene_new() -> NamekScene {
  let _cse0 = Ship(0.0);
  let _cse2 = NamekTree(vec2<f32>(0.0, 0.0), 0.0, 0.0);
  let _cse1 = NamekTrees(_cse2, _cse2);
  var self_: NamekScene = NamekScene(_cse0, _cse1, ShipDetails(_cse0, _cse1), Lettering(0.0));
  self_.ship = Ship_new();
  self_.trees = NamekTrees_new();
  self_.details = ShipDetails_new(self_.ship, self_.trees);
  self_.lettering = Lettering_new();
  return self_;
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
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), ((ndc * 0.5) + vec2<f32>(0.5, 0.5)));
}

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let scene = NamekScene_new();
  return NamekScene_colorAt(scene, uv);
}
