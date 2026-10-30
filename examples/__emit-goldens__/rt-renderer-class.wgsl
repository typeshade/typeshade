const SURFACE_EPSILON: f32 = 0.001;
const RAY_EPSILON: f32 = 0.003;
const MAX_DISTANCE: f32 = 40.0;
const MAX_STEPS: i32 = 96;
const MAX_BOUNCES: i32 = 3;
const SAMPLES_PER_PIXEL: i32 = 2;

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) ndc: vec2<f32>,
}

struct Frame {
  resolution: vec2<f32>,
  time: f32,
  frame: f32,
}

struct Ray {
  origin: vec3<f32>,
  direction: vec3<f32>,
}

struct Material {
  albedo: vec3<f32>,
  metallic: f32,
  roughness: f32,
  emission: vec3<f32>,
}

struct SdfShape {
  material: Material,
}

struct SDF_SdfSphere {
  material: Material,
  center: vec3<f32>,
  radius: f32,
}

struct SDF_SdfBox {
  material: Material,
  center: vec3<f32>,
  halfSize: vec3<f32>,
}

struct SDF_SdfTorus {
  material: Material,
  center: vec3<f32>,
  majorRadius: f32,
  minorRadius: f32,
}

struct SDF_SdfPlane {
  material: Material,
  height: f32,
}

struct Hit {
  distance: f32,
  objectIndex: i32,
}

struct PointLight {
  position: vec3<f32>,
  color: vec3<f32>,
  intensity: f32,
}

struct Camera {
  position: vec3<f32>,
  lookAt: vec3<f32>,
  fov: f32,
}

struct Scene {
  redSphere: SDF_SdfSphere,
  blueBox: SDF_SdfBox,
  goldTorus: SDF_SdfTorus,
  ground: SDF_SdfPlane,
  light: PointLight,
}

struct Renderer {
  scene: Scene,
}

@group(0) @binding(0) var<uniform> u: Frame;

fn Ray_at_function(self_: ptr<function, Ray>, distance: f32) -> vec3<f32> {
  return ((*self_).origin + ((*self_).direction * distance));
}

fn Ray_at_value(self_: Ray, distance: f32) -> vec3<f32> {
  return (self_.origin + (self_.direction * distance));
}

fn Ray_new(origin: vec3<f32>, direction: vec3<f32>) -> Ray {
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  var self_: Ray = Ray(_cse0, _cse0);
  self_.origin = origin;
  self_.direction = direction;
  return self_;
}

fn Ray_new_into(_dst: ptr<function, Ray>, origin: vec3<f32>, direction: vec3<f32>) {
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  (*_dst) = Ray(_cse0, _cse0);
  (*_dst).origin = origin;
  (*_dst).direction = direction;
}

fn Material_directResponse(self_: ptr<function, Material>, normal: vec3<f32>, viewDirection: vec3<f32>, lightDirection: vec3<f32>) -> vec3<f32> {
  let ndl = max(dot(normal, lightDirection), 0.0);
  let diffuse = (((*self_).albedo * (1.0 - (*self_).metallic)) * ndl);
  let halfDirection = normalize((lightDirection + viewDirection));
  let shininess = mix(16.0, 128.0, (1.0 - (*self_).roughness));
  let specular = pow(max(dot(normal, halfDirection), 0.0), shininess);
  let baseReflectance = mix(vec3<f32>(0.04), (*self_).albedo, (*self_).metallic);
  let fresnel = (baseReflectance + ((vec3<f32>(1.0) - baseReflectance) * pow((1.0 - max(dot(normal, viewDirection), 0.0)), 5.0)));
  return (diffuse + (fresnel * specular));
}

fn Material_bounceWeight(self_: ptr<function, Material>) -> vec3<f32> {
  return (mix((*self_).albedo, vec3<f32>(1.0), (*self_).metallic) * 0.65);
}

fn Material_new(albedo: vec3<f32>, metallic: f32, roughness: f32, emission: vec3<f32>) -> Material {
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  var self_: Material = Material(_cse0, 0.0, 0.0, _cse0);
  self_.albedo = albedo;
  self_.metallic = metallic;
  self_.roughness = roughness;
  self_.emission = emission;
  return self_;
}

fn SdfShape_new_into(_dst: ptr<function, SdfShape>, material: Material) {
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  (*_dst) = SdfShape(Material(_cse0, 0.0, 0.0, _cse0));
  (*_dst).material = material;
}

fn SDF_SdfSphere_distanceTo(self_: ptr<function, SDF_SdfSphere>, point: vec3<f32>) -> f32 {
  return (length((point - (*self_).center)) - (*self_).radius);
}

fn SDF_SdfSphere_normalAt(self_: ptr<function, SDF_SdfSphere>, point: vec3<f32>) -> vec3<f32> {
  let _cse0 = vec3<f32>(0.0015, 0.0, 0.0);
  let dx = (SDF_SdfSphere_distanceTo(self_, (point + _cse0)) - SDF_SdfSphere_distanceTo(self_, (point - _cse0)));
  let _cse1 = vec3<f32>(0.0, 0.0015, 0.0);
  let dy = (SDF_SdfSphere_distanceTo(self_, (point + _cse1)) - SDF_SdfSphere_distanceTo(self_, (point - _cse1)));
  let _cse2 = vec3<f32>(0.0, 0.0, 0.0015);
  let dz = (SDF_SdfSphere_distanceTo(self_, (point + _cse2)) - SDF_SdfSphere_distanceTo(self_, (point - _cse2)));
  return normalize(vec3<f32>(dx, dy, dz));
}

fn SDF_SdfBox_distanceTo(self_: ptr<function, SDF_SdfBox>, point: vec3<f32>) -> f32 {
  let local = (abs((point - (*self_).center)) - (*self_).halfSize);
  let outside = max(local, vec3<f32>(0.0));
  let inside = min(max(local.x, max(local.y, local.z)), 0.0);
  return (length(outside) + inside);
}

fn SDF_SdfBox_normalAt(self_: ptr<function, SDF_SdfBox>, point: vec3<f32>) -> vec3<f32> {
  let _cse0 = vec3<f32>(0.0015, 0.0, 0.0);
  let dx = (SDF_SdfBox_distanceTo(self_, (point + _cse0)) - SDF_SdfBox_distanceTo(self_, (point - _cse0)));
  let _cse1 = vec3<f32>(0.0, 0.0015, 0.0);
  let dy = (SDF_SdfBox_distanceTo(self_, (point + _cse1)) - SDF_SdfBox_distanceTo(self_, (point - _cse1)));
  let _cse2 = vec3<f32>(0.0, 0.0, 0.0015);
  let dz = (SDF_SdfBox_distanceTo(self_, (point + _cse2)) - SDF_SdfBox_distanceTo(self_, (point - _cse2)));
  return normalize(vec3<f32>(dx, dy, dz));
}

fn SDF_SdfTorus_distanceTo(self_: ptr<function, SDF_SdfTorus>, point: vec3<f32>) -> f32 {
  let local = (point - (*self_).center);
  let ring = (length(vec2<f32>(local.x, local.z)) - (*self_).majorRadius);
  return (length(vec2<f32>(ring, local.y)) - (*self_).minorRadius);
}

fn SDF_SdfTorus_normalAt(self_: ptr<function, SDF_SdfTorus>, point: vec3<f32>) -> vec3<f32> {
  let _cse0 = vec3<f32>(0.0015, 0.0, 0.0);
  let dx = (SDF_SdfTorus_distanceTo(self_, (point + _cse0)) - SDF_SdfTorus_distanceTo(self_, (point - _cse0)));
  let _cse1 = vec3<f32>(0.0, 0.0015, 0.0);
  let dy = (SDF_SdfTorus_distanceTo(self_, (point + _cse1)) - SDF_SdfTorus_distanceTo(self_, (point - _cse1)));
  let _cse2 = vec3<f32>(0.0, 0.0, 0.0015);
  let dz = (SDF_SdfTorus_distanceTo(self_, (point + _cse2)) - SDF_SdfTorus_distanceTo(self_, (point - _cse2)));
  return normalize(vec3<f32>(dx, dy, dz));
}

fn SDF_SdfPlane_distanceTo(self_: ptr<function, SDF_SdfPlane>, point: vec3<f32>) -> f32 {
  return (point.y - (*self_).height);
}

fn SDF_SdfPlane_normalAt(self_: ptr<function, SDF_SdfPlane>, point: vec3<f32>) -> vec3<f32> {
  let _cse0 = vec3<f32>(0.0015, 0.0, 0.0);
  let dx = (SDF_SdfPlane_distanceTo(self_, (point + _cse0)) - SDF_SdfPlane_distanceTo(self_, (point - _cse0)));
  let _cse1 = vec3<f32>(0.0, 0.0015, 0.0);
  let dy = (SDF_SdfPlane_distanceTo(self_, (point + _cse1)) - SDF_SdfPlane_distanceTo(self_, (point - _cse1)));
  let _cse2 = vec3<f32>(0.0, 0.0, 0.0015);
  let dz = (SDF_SdfPlane_distanceTo(self_, (point + _cse2)) - SDF_SdfPlane_distanceTo(self_, (point - _cse2)));
  return normalize(vec3<f32>(dx, dy, dz));
}

fn Hit_isValid(self_: Hit) -> bool {
  return (self_.objectIndex >= 0);
}

fn Hit_new(distance: f32, objectIndex: i32) -> Hit {
  var self_: Hit = Hit(0.0, 0);
  self_.distance = distance;
  self_.objectIndex = objectIndex;
  return self_;
}

fn Hit_new_into(_dst: ptr<function, Hit>, distance: f32, objectIndex: i32) {
  (*_dst) = Hit(0.0, 0);
  (*_dst).distance = distance;
  (*_dst).objectIndex = objectIndex;
}

fn PointLight_irradianceAt(self_: ptr<function, PointLight>, point: vec3<f32>) -> vec3<f32> {
  let offset = ((*self_).position - point);
  let distanceSquared = max(dot(offset, offset), 1.0);
  return ((*self_).color * ((*self_).intensity / distanceSquared));
}

fn PointLight_new_into(_dst: ptr<function, PointLight>, position: vec3<f32>, color: vec3<f32>, intensity: f32) {
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  (*_dst) = PointLight(_cse0, _cse0, 0.0);
  (*_dst).position = position;
  (*_dst).color = color;
  (*_dst).intensity = intensity;
}

fn Camera_rayFor(self_: Camera, ndc: vec2<f32>) -> Ray {
  let forward = normalize((self_.lookAt - self_.position));
  let right = normalize(cross(forward, vec3<f32>(0.0, 1.0, 0.0)));
  let up = cross(right, forward);
  let scale = tan((self_.fov * 0.5));
  let direction = normalize(((forward + ((right * ndc.x) * scale)) + ((up * ndc.y) * scale)));
  return Ray_new(self_.position, direction);
}

fn Camera_new_into(_dst: ptr<function, Camera>, position: vec3<f32>, lookAt: vec3<f32>, fov: f32) {
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  (*_dst) = Camera(_cse0, _cse0, 0.0);
  (*_dst).position = position;
  (*_dst).lookAt = lookAt;
  (*_dst).fov = fov;
}

fn Scene_sample_into(_dst: ptr<function, Hit>, self_: ptr<function, Scene>, point: vec3<f32>) {
  var closestDistance: f32 = MAX_DISTANCE;
  var closestObjectIndex: i32 = -1;
  let sphereDistance = SDF_SdfSphere_distanceTo(&(*self_).redSphere, point);
  if ((sphereDistance < closestDistance)) {
    closestDistance = sphereDistance;
    closestObjectIndex = 0;
  }
  let boxDistance = SDF_SdfBox_distanceTo(&(*self_).blueBox, point);
  if ((boxDistance < closestDistance)) {
    closestDistance = boxDistance;
    closestObjectIndex = 1;
  }
  let torusDistance = SDF_SdfTorus_distanceTo(&(*self_).goldTorus, point);
  if ((torusDistance < closestDistance)) {
    closestDistance = torusDistance;
    closestObjectIndex = 2;
  }
  let groundDistance = SDF_SdfPlane_distanceTo(&(*self_).ground, point);
  if ((groundDistance < closestDistance)) {
    closestDistance = groundDistance;
    closestObjectIndex = 3;
  }
  Hit_new_into(_dst, closestDistance, closestObjectIndex);
}

fn Scene_raymarch_into(_dst: ptr<function, Hit>, self_: ptr<function, Scene>, ray: ptr<function, Ray>, maxDistance: f32) {
  var distance: f32 = 0.0;
  var objectIndex: i32 = -1;
  for (var step: i32 = 0; (step < MAX_STEPS); step = (step + 1)) {
    let point = Ray_at_function(ray, distance);
    var field: Hit;
    Scene_sample_into(&field, self_, point);
    if ((field.distance < SURFACE_EPSILON)) {
      objectIndex = field.objectIndex;
      Hit_new_into(_dst, distance, objectIndex);
      return;
    }
    distance = (distance + field.distance);
    if ((distance > maxDistance)) {
      break;
    }
  }
  Hit_new_into(_dst, -1.0, objectIndex);
}

fn Scene_normalAt(self_: ptr<function, Scene>, index: i32, point: vec3<f32>) -> vec3<f32> {
  if ((index == 0)) {
    return SDF_SdfSphere_normalAt(&(*self_).redSphere, point);
  }
  if ((index == 1)) {
    return SDF_SdfBox_normalAt(&(*self_).blueBox, point);
  }
  if ((index == 2)) {
    return SDF_SdfTorus_normalAt(&(*self_).goldTorus, point);
  }
  return SDF_SdfPlane_normalAt(&(*self_).ground, point);
}

fn Scene_isVisible(self_: ptr<function, Scene>, point: vec3<f32>, normal: vec3<f32>) -> bool {
  let toLight = ((*self_).light.position - point);
  let distanceToLight = length(toLight);
  let lightDirection = normalize(toLight);
  return (Hit_isValid(_flow16_fused(self_, (point + (normal * RAY_EPSILON)), lightDirection, distanceToLight)) == false);
}

fn Scene_materialAt(self_: ptr<function, Scene>, index: i32) -> Material {
  if ((index == 0)) {
    return (*self_).redSphere.material;
  }
  if ((index == 1)) {
    return (*self_).blueBox.material;
  }
  if ((index == 2)) {
    return (*self_).goldTorus.material;
  }
  return (*self_).ground.material;
}

fn Scene_new_into(_dst: ptr<function, Scene>) {
  let _cse2 = vec3<f32>(0.0, 0.0, 0.0);
  var _cse0: Material = Material(_cse2, 0.0, 0.0, _cse2);
  (*_dst) = Scene(SDF_SdfSphere(_cse0, _cse2, 0.0), SDF_SdfBox(_cse0, _cse2, _cse2), SDF_SdfTorus(_cse0, _cse2, 0.0, 0.0), SDF_SdfPlane(_cse0, 0.0), PointLight(_cse2, _cse2, 0.0));
  let _cse1 = vec3<f32>(0.0);
  _flow40_fused_into(&(*_dst).redSphere, vec3<f32>(-1.15, 0.2, -1.7), 1.0, vec3<f32>(0.78, 0.12, 0.08), 0.0, 0.4, _cse1);
  _flow65_fused_into(&(*_dst).blueBox, vec3<f32>(1.05, 0.25, -2.0), vec3<f32>(0.75, 0.75, 0.75), vec3<f32>(0.08, 0.3, 0.84), 0.2, 0.3, _cse1);
  _flow92_fused_into(&(*_dst).goldTorus, vec3<f32>(0.0, 1.35, -2.9), 0.72, 0.24, vec3<f32>(0.95, 0.65, 0.1), 0.9, 0.12, _cse1);
  _flow115_fused_into(&(*_dst).ground, -1.0, vec3<f32>(0.68, 0.72, 0.8), 0.0, 0.92, _cse1);
  PointLight_new_into(&(*_dst).light, vec3<f32>(-2.5, 4.8, 2.0), vec3<f32>(1.0, 0.88, 0.72), 70.0);
}

fn Renderer_shade(self_: ptr<function, Renderer>, ray: ptr<function, Ray>, point: vec3<f32>, normal: vec3<f32>, material: ptr<function, Material>) -> vec3<f32> {
  let viewDirection = (-(*ray).direction);
  let lightDirection = normalize(((*self_).scene.light.position - point));
  var visibility: f32 = 0.0;
  if (Scene_isVisible(&(*self_).scene, point, normal)) {
    visibility = 1.0;
  }
  return ((*material).emission + ((visibility * PointLight_irradianceAt(&(*self_).scene.light, point)) * Material_directResponse(material, normal, viewDirection, lightDirection)));
}

fn Renderer_sky(self_: ptr<function, Renderer>, ray: ptr<function, Ray>) -> vec3<f32> {
  let horizon = vec3<f32>(0.12, 0.17, 0.28);
  let zenith = vec3<f32>(0.55, 0.72, 0.95);
  let skyFactor = max((*ray).direction.y, 0.0);
  return mix(horizon, zenith, skyFactor);
}

fn Renderer_new_into(_dst: ptr<function, Renderer>, scene: ptr<function, Scene>) {
  let _cse1 = vec3<f32>(0.0, 0.0, 0.0);
  var _cse0: Material = Material(_cse1, 0.0, 0.0, _cse1);
  (*_dst) = Renderer(Scene(SDF_SdfSphere(_cse0, _cse1, 0.0), SDF_SdfBox(_cse0, _cse1, _cse1), SDF_SdfTorus(_cse0, _cse1, 0.0, 0.0), SDF_SdfPlane(_cse0, 0.0), PointLight(_cse1, _cse1, 0.0)));
  (*_dst).scene = (*scene);
}

fn cosineDirection(normal: vec3<f32>, seed: f32) -> vec3<f32> {
  let r1 = fract((sin(seed) * 43758.5453123));
  let r2 = fract((sin((seed + 17.13)) * 43758.5453123));
  let phi = (6.2831853 * r1);
  let radius = sqrt(r2);
  let tangent = normalize(cross(select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), (abs(normal.x) > 0.9)), normal));
  let bitangent = cross(normal, tangent);
  return normalize((((tangent * (cos(phi) * radius)) + (bitangent * (sin(phi) * radius))) + (normal * sqrt((1.0 - r2)))));
}

fn reflectDirection(direction: vec3<f32>, normal: vec3<f32>) -> vec3<f32> {
  return (direction - (normal * (2.0 * dot(direction, normal))));
}

fn createCamera_into(_dst: ptr<function, Camera>, time: f32) {
  let _cse0 = (time * 0.17);
  Camera_new_into(_dst, vec3<f32>((sin(_cse0) * 6.2), (2.0 + (sin((time * 0.31)) * 0.12)), (cos(_cse0) * 6.2)), vec3<f32>(0.0, 0.6, -1.8), 1.0);
}

fn pixelJitter(position: vec2<f32>, frame: f32, sample: i32) -> vec2<f32> {
  let _cse0 = f32(sample);
  return vec2<f32>((fract((sin(((dot(position, vec2<f32>(12.9898, 78.233)) + (frame * 0.71)) + (_cse0 * 19.17))) * 43758.5453123)) - 0.5), (fract((sin(((dot(position, vec2<f32>(39.346, 11.135)) + (frame * 1.17)) + (_cse0 * 7.91))) * 43758.5453123)) - 0.5));
}

fn renderSample(renderer: ptr<function, Renderer>, camera: ptr<function, Camera>, ndc: vec2<f32>, resolution: vec2<f32>, frame: f32, sample: i32) -> vec3<f32> {
  let pixel = (((ndc * 0.5) + vec2<f32>(0.5)) * resolution);
  let jitter = pixelJitter(pixel, frame, sample);
  let sampleNdc = (ndc + vec2<f32>(((jitter.x * 2.0) / resolution.x), ((jitter.y * 2.0) / resolution.y)));
  let seed = ((dot(pixel, vec2<f32>(17.17, 73.19)) + (frame * 11.3)) + (f32(sample) * 3.7));
  return _flow151_fused(renderer, camera, vec2<f32>(((sampleNdc.x * resolution.x) / resolution.y), sampleNdc.y), seed);
}

fn toneMap(color: vec3<f32>) -> vec3<f32> {
  let mapped = (color / (color + vec3<f32>(1.0)));
  return pow(mapped, vec3<f32>(0.45454545454545453));
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(x, y));
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4<f32> {
  let _licm0 = v.ndc;
  let _licm1 = u.resolution;
  let _licm2 = u.frame;
  var camera: Camera;
  createCamera_into(&camera, u.time);
  var scene: Scene;
  Scene_new_into(&scene);
  var renderer: Renderer;
  Renderer_new_into(&renderer, &scene);
  var color: vec3<f32> = vec3<f32>(0.0);
  for (var sample: i32 = 0; (sample < SAMPLES_PER_PIXEL); sample = (sample + 1)) {
    color += renderSample(&renderer, &camera, _licm0, _licm1, _licm2, sample);
  }
  color = toneMap((color / f32(SAMPLES_PER_PIXEL)));
  return vec4<f32>(color, 1.0);
}

fn _flow16_fused(_flow1_input: ptr<function, Scene>, _flow2_input: vec3<f32>, _flow3_input: vec3<f32>, _flow7_input: f32) -> Hit {
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  var _flow17_part: vec3<f32> = _cse0;
  var _flow18_part: vec3<f32> = _cse0;
  _flow17_part = _flow2_input;
  _flow18_part = _flow3_input;
  let _flow19_part = _flow17_part;
  let _flow20_part = _flow18_part;
  var _flow8_local: f32 = 0.0;
  var _flow9_local: i32 = -1;
  for (var _flow10_local: i32 = 0; (_flow10_local < MAX_STEPS); _flow10_local = (_flow10_local + 1)) {
    let _flow11_local = Ray_at_value(Ray(_flow19_part, _flow20_part), _flow8_local);
    var _flow23_whole: Hit;
    Scene_sample_into(&_flow23_whole, _flow1_input, _flow11_local);
    let _flow21_part = _flow23_whole.distance;
    let _flow22_part = _flow23_whole.objectIndex;
    if ((_flow21_part < SURFACE_EPSILON)) {
      _flow9_local = _flow22_part;
      return Hit_new(_flow8_local, _flow9_local);
    }
    _flow8_local = (_flow8_local + _flow21_part);
    if ((_flow8_local > _flow7_input)) {
      break;
    }
  }
  return Hit_new(-1.0, _flow9_local);
}

fn _flow40_fused_into(_dst: ptr<function, SDF_SdfSphere>, _flow24_input: vec3<f32>, _flow25_input: f32, _flow26_input: vec3<f32>, _flow27_input: f32, _flow28_input: f32, _flow29_input: vec3<f32>) {
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  var _flow41_part: vec3<f32> = _cse0;
  var _flow42_part: f32 = 0.0;
  var _flow43_part: f32 = 0.0;
  var _flow44_part: vec3<f32> = _cse0;
  _flow41_part = _flow26_input;
  _flow42_part = _flow27_input;
  _flow43_part = _flow28_input;
  _flow44_part = _flow29_input;
  let _flow45_part = _flow41_part;
  let _flow46_part = _flow42_part;
  let _flow47_part = _flow43_part;
  let _flow48_part = _flow44_part;
  (*_dst) = SDF_SdfSphere(Material(_cse0, 0.0, 0.0, _cse0), _cse0, 0.0);
  var _flow36_local: SdfShape;
  SdfShape_new_into(&_flow36_local, Material(_flow45_part, _flow46_part, _flow47_part, _flow48_part));
  (*_dst).material = _flow36_local.material;
  (*_dst).center = _flow24_input;
  (*_dst).radius = _flow25_input;
}

fn _flow65_fused_into(_dst: ptr<function, SDF_SdfBox>, _flow49_input: vec3<f32>, _flow50_input: vec3<f32>, _flow51_input: vec3<f32>, _flow52_input: f32, _flow53_input: f32, _flow54_input: vec3<f32>) {
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  var _flow66_part: vec3<f32> = _cse0;
  var _flow67_part: f32 = 0.0;
  var _flow68_part: f32 = 0.0;
  var _flow69_part: vec3<f32> = _cse0;
  _flow66_part = _flow51_input;
  _flow67_part = _flow52_input;
  _flow68_part = _flow53_input;
  _flow69_part = _flow54_input;
  let _flow70_part = _flow66_part;
  let _flow71_part = _flow67_part;
  let _flow72_part = _flow68_part;
  let _flow73_part = _flow69_part;
  (*_dst) = SDF_SdfBox(Material(_cse0, 0.0, 0.0, _cse0), _cse0, _cse0);
  var _flow61_local: SdfShape;
  SdfShape_new_into(&_flow61_local, Material(_flow70_part, _flow71_part, _flow72_part, _flow73_part));
  (*_dst).material = _flow61_local.material;
  (*_dst).center = _flow49_input;
  (*_dst).halfSize = _flow50_input;
}

fn _flow92_fused_into(_dst: ptr<function, SDF_SdfTorus>, _flow74_input: vec3<f32>, _flow75_input: f32, _flow76_input: f32, _flow77_input: vec3<f32>, _flow78_input: f32, _flow79_input: f32, _flow80_input: vec3<f32>) {
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  var _flow93_part: vec3<f32> = _cse0;
  var _flow94_part: f32 = 0.0;
  var _flow95_part: f32 = 0.0;
  var _flow96_part: vec3<f32> = _cse0;
  _flow93_part = _flow77_input;
  _flow94_part = _flow78_input;
  _flow95_part = _flow79_input;
  _flow96_part = _flow80_input;
  let _flow97_part = _flow93_part;
  let _flow98_part = _flow94_part;
  let _flow99_part = _flow95_part;
  let _flow100_part = _flow96_part;
  (*_dst) = SDF_SdfTorus(Material(_cse0, 0.0, 0.0, _cse0), _cse0, 0.0, 0.0);
  var _flow87_local: SdfShape;
  SdfShape_new_into(&_flow87_local, Material(_flow97_part, _flow98_part, _flow99_part, _flow100_part));
  (*_dst).material = _flow87_local.material;
  (*_dst).center = _flow74_input;
  (*_dst).majorRadius = _flow75_input;
  (*_dst).minorRadius = _flow76_input;
}

fn _flow115_fused_into(_dst: ptr<function, SDF_SdfPlane>, _flow101_input: f32, _flow102_input: vec3<f32>, _flow103_input: f32, _flow104_input: f32, _flow105_input: vec3<f32>) {
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  var _flow116_part: vec3<f32> = _cse0;
  var _flow117_part: f32 = 0.0;
  var _flow118_part: f32 = 0.0;
  var _flow119_part: vec3<f32> = _cse0;
  _flow116_part = _flow102_input;
  _flow117_part = _flow103_input;
  _flow118_part = _flow104_input;
  _flow119_part = _flow105_input;
  let _flow120_part = _flow116_part;
  let _flow121_part = _flow117_part;
  let _flow122_part = _flow118_part;
  let _flow123_part = _flow119_part;
  (*_dst) = SDF_SdfPlane(Material(_cse0, 0.0, 0.0, _cse0), 0.0);
  var _flow112_local: SdfShape;
  SdfShape_new_into(&_flow112_local, Material(_flow120_part, _flow121_part, _flow122_part, _flow123_part));
  (*_dst).material = _flow112_local.material;
  (*_dst).height = _flow101_input;
}

fn _flow151_fused(_flow124_input: ptr<function, Renderer>, _flow125_input: ptr<function, Camera>, _flow126_input: vec2<f32>, _flow134_input: f32) -> vec3<f32> {
  let _flow152_part = (*_flow125_input).position;
  let _flow153_part = (*_flow125_input).lookAt;
  let _flow154_part = (*_flow125_input).fov;
  let _flow127_local = normalize((_flow153_part - _flow152_part));
  let _flow128_local = normalize(cross(_flow127_local, vec3<f32>(0.0, 1.0, 0.0)));
  let _flow129_local = cross(_flow128_local, _flow127_local);
  let _flow130_local = tan((_flow154_part * 0.5));
  let _flow131_local = normalize(((_flow127_local + ((_flow128_local * _flow126_input.x) * _flow130_local)) + ((_flow129_local * _flow126_input.y) * _flow130_local)));
  var _flow166_whole: Ray;
  Ray_new_into(&_flow166_whole, _flow152_part, _flow131_local);
  let _flow155_part = _flow166_whole.origin;
  let _flow156_part = _flow166_whole.direction;
  var _flow157_part: vec3<f32> = _flow155_part;
  var _flow158_part: vec3<f32> = _flow156_part;
  var _flow136_local: vec3<f32> = vec3<f32>(1.0);
  var _flow137_local: vec3<f32> = vec3<f32>(0.0);
  var _flow138_local: f32 = _flow134_input;
  for (var _flow139_local: i32 = 0; (_flow139_local < MAX_BOUNCES); _flow139_local = (_flow139_local + 1)) {
    var _gv0: Ray = Ray(_flow157_part, _flow158_part);
    var _flow167_whole: Hit;
    Scene_raymarch_into(&_flow167_whole, &(*_flow124_input).scene, &_gv0, MAX_DISTANCE);
    let _flow159_part = _flow167_whole.distance;
    let _flow160_part = _flow167_whole.objectIndex;
    if ((Hit_isValid(Hit(_flow159_part, _flow160_part)) == false)) {
      _flow137_local += (_flow136_local * Renderer_sky(_flow124_input, &_gv0));
      break;
    }
    let _flow141_local = Ray_at_function(&_gv0, _flow159_part);
    let _flow142_local = Scene_normalAt(&(*_flow124_input).scene, _flow160_part, _flow141_local);
    var _flow168_whole: Material = Scene_materialAt(&(*_flow124_input).scene, _flow160_part);
    let _flow161_part = _flow168_whole.albedo;
    let _flow162_part = _flow168_whole.metallic;
    let _flow163_part = _flow168_whole.roughness;
    let _flow164_part = _flow168_whole.emission;
    var _gv1: Material = Material(_flow161_part, _flow162_part, _flow163_part, _flow164_part);
    _flow137_local += (_flow136_local * Renderer_shade(_flow124_input, &_gv0, _flow141_local, _flow142_local, &_gv1));
    _flow138_local = (_flow138_local + 7.13);
    let _flow144_local = cosineDirection(_flow142_local, _flow138_local);
    let _flow145_local = reflectDirection(_flow158_part, _flow142_local);
    let _flow146_local = (_flow162_part + ((1.0 - _flow163_part) * 0.25));
    let _flow147_local = normalize(mix(_flow144_local, _flow145_local, _flow146_local));
    _flow136_local = (_flow136_local * Material_bounceWeight(&_gv1));
    var _flow169_whole: Ray;
    Ray_new_into(&_flow169_whole, (_flow141_local + (_flow142_local * RAY_EPSILON)), _flow147_local);
    let _flow170_copy = _flow169_whole.origin;
    let _flow171_copy = _flow169_whole.direction;
    _flow157_part = _flow170_copy;
    _flow158_part = _flow171_copy;
  }
  return _flow137_local;
}
