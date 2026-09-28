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

fn Ray_at(self_: Ray, distance: f32) -> vec3<f32> {
  return (self_.origin + (self_.direction * distance));
}

fn Ray_new(origin: vec3<f32>, direction: vec3<f32>) -> Ray {
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  var self_: Ray = Ray(_cse0, _cse0);
  self_.origin = origin;
  self_.direction = direction;
  return self_;
}

fn Material_directResponse(self_: Material, normal: vec3<f32>, viewDirection: vec3<f32>, lightDirection: vec3<f32>) -> vec3<f32> {
  let ndl = max(dot(normal, lightDirection), 0.0);
  let diffuse = ((self_.albedo * (1.0 - self_.metallic)) * ndl);
  let halfDirection = normalize((lightDirection + viewDirection));
  let shininess = mix(16.0, 128.0, (1.0 - self_.roughness));
  let specular = pow(max(dot(normal, halfDirection), 0.0), shininess);
  let baseReflectance = mix(vec3<f32>(0.04, 0.04, 0.04), self_.albedo, self_.metallic);
  let fresnel = (baseReflectance + ((vec3<f32>(1.0, 1.0, 1.0) - baseReflectance) * pow((1.0 - max(dot(normal, viewDirection), 0.0)), 5.0)));
  return (diffuse + (fresnel * specular));
}

fn Material_bounceWeight(self_: Material) -> vec3<f32> {
  return (mix(self_.albedo, vec3<f32>(1.0, 1.0, 1.0), self_.metallic) * 0.65);
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

fn SdfShape_new(material: Material) -> SdfShape {
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  var self_: SdfShape = SdfShape(Material(_cse0, 0.0, 0.0, _cse0));
  self_.material = material;
  return self_;
}

fn SDF_SdfSphere_distanceTo(self_: SDF_SdfSphere, point: vec3<f32>) -> f32 {
  return (length((point - self_.center)) - self_.radius);
}

fn SDF_SdfSphere_normalAt(self_: SDF_SdfSphere, point: vec3<f32>) -> vec3<f32> {
  let _cse0 = vec3<f32>(0.0015, 0.0, 0.0);
  let dx = (SDF_SdfSphere_distanceTo(self_, (point + _cse0)) - SDF_SdfSphere_distanceTo(self_, (point - _cse0)));
  let _cse1 = vec3<f32>(0.0, 0.0015, 0.0);
  let dy = (SDF_SdfSphere_distanceTo(self_, (point + _cse1)) - SDF_SdfSphere_distanceTo(self_, (point - _cse1)));
  let _cse2 = vec3<f32>(0.0, 0.0, 0.0015);
  let dz = (SDF_SdfSphere_distanceTo(self_, (point + _cse2)) - SDF_SdfSphere_distanceTo(self_, (point - _cse2)));
  return normalize(vec3<f32>(dx, dy, dz));
}

fn SDF_SdfSphere_new(center: vec3<f32>, radius: f32, material: Material) -> SDF_SdfSphere {
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  var self_: SDF_SdfSphere = SDF_SdfSphere(Material(_cse0, 0.0, 0.0, _cse0), _cse0, 0.0);
  let _sup = SdfShape_new(material);
  self_.material = _sup.material;
  self_.center = center;
  self_.radius = radius;
  return self_;
}

fn SDF_SdfBox_distanceTo(self_: SDF_SdfBox, point: vec3<f32>) -> f32 {
  let local = (abs((point - self_.center)) - self_.halfSize);
  let outside = max(local, vec3<f32>(0.0, 0.0, 0.0));
  let inside = min(max(local.x, max(local.y, local.z)), 0.0);
  return (length(outside) + inside);
}

fn SDF_SdfBox_normalAt(self_: SDF_SdfBox, point: vec3<f32>) -> vec3<f32> {
  let _cse0 = vec3<f32>(0.0015, 0.0, 0.0);
  let dx = (SDF_SdfBox_distanceTo(self_, (point + _cse0)) - SDF_SdfBox_distanceTo(self_, (point - _cse0)));
  let _cse1 = vec3<f32>(0.0, 0.0015, 0.0);
  let dy = (SDF_SdfBox_distanceTo(self_, (point + _cse1)) - SDF_SdfBox_distanceTo(self_, (point - _cse1)));
  let _cse2 = vec3<f32>(0.0, 0.0, 0.0015);
  let dz = (SDF_SdfBox_distanceTo(self_, (point + _cse2)) - SDF_SdfBox_distanceTo(self_, (point - _cse2)));
  return normalize(vec3<f32>(dx, dy, dz));
}

fn SDF_SdfBox_new(center: vec3<f32>, halfSize: vec3<f32>, material: Material) -> SDF_SdfBox {
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  var self_: SDF_SdfBox = SDF_SdfBox(Material(_cse0, 0.0, 0.0, _cse0), _cse0, _cse0);
  let _sup = SdfShape_new(material);
  self_.material = _sup.material;
  self_.center = center;
  self_.halfSize = halfSize;
  return self_;
}

fn SDF_SdfTorus_distanceTo(self_: SDF_SdfTorus, point: vec3<f32>) -> f32 {
  let local = (point - self_.center);
  let ring = (length(vec2<f32>(local.x, local.z)) - self_.majorRadius);
  return (length(vec2<f32>(ring, local.y)) - self_.minorRadius);
}

fn SDF_SdfTorus_normalAt(self_: SDF_SdfTorus, point: vec3<f32>) -> vec3<f32> {
  let _cse0 = vec3<f32>(0.0015, 0.0, 0.0);
  let dx = (SDF_SdfTorus_distanceTo(self_, (point + _cse0)) - SDF_SdfTorus_distanceTo(self_, (point - _cse0)));
  let _cse1 = vec3<f32>(0.0, 0.0015, 0.0);
  let dy = (SDF_SdfTorus_distanceTo(self_, (point + _cse1)) - SDF_SdfTorus_distanceTo(self_, (point - _cse1)));
  let _cse2 = vec3<f32>(0.0, 0.0, 0.0015);
  let dz = (SDF_SdfTorus_distanceTo(self_, (point + _cse2)) - SDF_SdfTorus_distanceTo(self_, (point - _cse2)));
  return normalize(vec3<f32>(dx, dy, dz));
}

fn SDF_SdfTorus_new(center: vec3<f32>, majorRadius: f32, minorRadius: f32, material: Material) -> SDF_SdfTorus {
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  var self_: SDF_SdfTorus = SDF_SdfTorus(Material(_cse0, 0.0, 0.0, _cse0), _cse0, 0.0, 0.0);
  let _sup = SdfShape_new(material);
  self_.material = _sup.material;
  self_.center = center;
  self_.majorRadius = majorRadius;
  self_.minorRadius = minorRadius;
  return self_;
}

fn SDF_SdfPlane_distanceTo(self_: SDF_SdfPlane, point: vec3<f32>) -> f32 {
  return (point.y - self_.height);
}

fn SDF_SdfPlane_normalAt(self_: SDF_SdfPlane, point: vec3<f32>) -> vec3<f32> {
  let _cse0 = vec3<f32>(0.0015, 0.0, 0.0);
  let dx = (SDF_SdfPlane_distanceTo(self_, (point + _cse0)) - SDF_SdfPlane_distanceTo(self_, (point - _cse0)));
  let _cse1 = vec3<f32>(0.0, 0.0015, 0.0);
  let dy = (SDF_SdfPlane_distanceTo(self_, (point + _cse1)) - SDF_SdfPlane_distanceTo(self_, (point - _cse1)));
  let _cse2 = vec3<f32>(0.0, 0.0, 0.0015);
  let dz = (SDF_SdfPlane_distanceTo(self_, (point + _cse2)) - SDF_SdfPlane_distanceTo(self_, (point - _cse2)));
  return normalize(vec3<f32>(dx, dy, dz));
}

fn SDF_SdfPlane_new(height: f32, material: Material) -> SDF_SdfPlane {
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  var self_: SDF_SdfPlane = SDF_SdfPlane(Material(_cse0, 0.0, 0.0, _cse0), 0.0);
  let _sup = SdfShape_new(material);
  self_.material = _sup.material;
  self_.height = height;
  return self_;
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

fn PointLight_irradianceAt(self_: PointLight, point: vec3<f32>) -> vec3<f32> {
  let offset = (self_.position - point);
  let distanceSquared = max(dot(offset, offset), 1.0);
  return (self_.color * (self_.intensity / distanceSquared));
}

fn PointLight_new(position: vec3<f32>, color: vec3<f32>, intensity: f32) -> PointLight {
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  var self_: PointLight = PointLight(_cse0, _cse0, 0.0);
  self_.position = position;
  self_.color = color;
  self_.intensity = intensity;
  return self_;
}

fn Camera_rayFor(self_: Camera, ndc: vec2<f32>) -> Ray {
  let forward = normalize((self_.lookAt - self_.position));
  let right = normalize(cross(forward, vec3<f32>(0.0, 1.0, 0.0)));
  let up = cross(right, forward);
  let scale = tan((self_.fov * 0.5));
  let direction = normalize(((forward + ((right * ndc.x) * scale)) + ((up * ndc.y) * scale)));
  return Ray_new(self_.position, direction);
}

fn Camera_new(position: vec3<f32>, lookAt: vec3<f32>, fov: f32) -> Camera {
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  var self_: Camera = Camera(_cse0, _cse0, 0.0);
  self_.position = position;
  self_.lookAt = lookAt;
  self_.fov = fov;
  return self_;
}

fn Scene_sample(self_: Scene, point: vec3<f32>) -> Hit {
  var closestDistance: f32 = MAX_DISTANCE;
  var closestObjectIndex: i32 = -1;
  let sphereDistance = SDF_SdfSphere_distanceTo(self_.redSphere, point);
  if ((sphereDistance < closestDistance)) {
    closestDistance = sphereDistance;
    closestObjectIndex = 0;
  }
  let boxDistance = SDF_SdfBox_distanceTo(self_.blueBox, point);
  if ((boxDistance < closestDistance)) {
    closestDistance = boxDistance;
    closestObjectIndex = 1;
  }
  let torusDistance = SDF_SdfTorus_distanceTo(self_.goldTorus, point);
  if ((torusDistance < closestDistance)) {
    closestDistance = torusDistance;
    closestObjectIndex = 2;
  }
  let groundDistance = SDF_SdfPlane_distanceTo(self_.ground, point);
  if ((groundDistance < closestDistance)) {
    closestDistance = groundDistance;
    closestObjectIndex = 3;
  }
  return Hit_new(closestDistance, closestObjectIndex);
}

fn Scene_raymarch(self_: Scene, ray: Ray, maxDistance: f32) -> Hit {
  var distance: f32 = 0.0;
  var objectIndex: i32 = -1;
  for (var step: i32 = 0; (step < MAX_STEPS); step = (step + 1)) {
    let point = Ray_at(ray, distance);
    let field = Scene_sample(self_, point);
    if ((field.distance < SURFACE_EPSILON)) {
      objectIndex = field.objectIndex;
      return Hit_new(distance, objectIndex);
    }
    distance = (distance + field.distance);
    if ((distance > maxDistance)) {
      break;
    }
  }
  return Hit_new(-1.0, objectIndex);
}

fn Scene_normalAt(self_: Scene, index: i32, point: vec3<f32>) -> vec3<f32> {
  if ((index == 0)) {
    return SDF_SdfSphere_normalAt(self_.redSphere, point);
  }
  if ((index == 1)) {
    return SDF_SdfBox_normalAt(self_.blueBox, point);
  }
  if ((index == 2)) {
    return SDF_SdfTorus_normalAt(self_.goldTorus, point);
  }
  return SDF_SdfPlane_normalAt(self_.ground, point);
}

fn Scene_isVisible(self_: Scene, point: vec3<f32>, normal: vec3<f32>) -> bool {
  let toLight = (self_.light.position - point);
  let distanceToLight = length(toLight);
  let lightDirection = normalize(toLight);
  let shadowRay = Ray_new((point + (normal * RAY_EPSILON)), lightDirection);
  let shadowHit = Scene_raymarch(self_, shadowRay, distanceToLight);
  return (Hit_isValid(shadowHit) == false);
}

fn Scene_materialAt(self_: Scene, index: i32) -> Material {
  if ((index == 0)) {
    return self_.redSphere.material;
  }
  if ((index == 1)) {
    return self_.blueBox.material;
  }
  if ((index == 2)) {
    return self_.goldTorus.material;
  }
  return self_.ground.material;
}

fn Scene_new() -> Scene {
  let _cse1 = vec3<f32>(0.0, 0.0, 0.0);
  let _cse0 = Material(_cse1, 0.0, 0.0, _cse1);
  var self_: Scene = Scene(SDF_SdfSphere(_cse0, _cse1, 0.0), SDF_SdfBox(_cse0, _cse1, _cse1), SDF_SdfTorus(_cse0, _cse1, 0.0, 0.0), SDF_SdfPlane(_cse0, 0.0), PointLight(_cse1, _cse1, 0.0));
  self_.redSphere = SDF_SdfSphere_new(vec3<f32>(-1.15, 0.2, -1.7), 1.0, Material_new(vec3<f32>(0.78, 0.12, 0.08), 0.0, 0.4, _cse1));
  self_.blueBox = SDF_SdfBox_new(vec3<f32>(1.05, 0.25, -2.0), vec3<f32>(0.75, 0.75, 0.75), Material_new(vec3<f32>(0.08, 0.3, 0.84), 0.2, 0.3, _cse1));
  self_.goldTorus = SDF_SdfTorus_new(vec3<f32>(0.0, 1.35, -2.9), 0.72, 0.24, Material_new(vec3<f32>(0.95, 0.65, 0.1), 0.9, 0.12, _cse1));
  self_.ground = SDF_SdfPlane_new(-1.0, Material_new(vec3<f32>(0.68, 0.72, 0.8), 0.0, 0.92, _cse1));
  self_.light = PointLight_new(vec3<f32>(-2.5, 4.8, 2.0), vec3<f32>(1.0, 0.88, 0.72), 70.0);
  return self_;
}

fn Renderer_trace(self_: Renderer, primaryRay: Ray, seed0: f32) -> vec3<f32> {
  let _licm0 = self_.scene;
  var ray: Ray = primaryRay;
  var throughput: vec3<f32> = vec3<f32>(1.0, 1.0, 1.0);
  var radiance: vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);
  var seed: f32 = seed0;
  for (var bounce: i32 = 0; (bounce < MAX_BOUNCES); bounce = (bounce + 1)) {
    let hit = Scene_raymarch(_licm0, ray, MAX_DISTANCE);
    if ((Hit_isValid(hit) == false)) {
      radiance += (throughput * Renderer_sky(self_, ray));
      break;
    }
    let point = Ray_at(ray, hit.distance);
    let normal = Scene_normalAt(_licm0, hit.objectIndex, point);
    let material = Scene_materialAt(_licm0, hit.objectIndex);
    radiance += (throughput * Renderer_shade(self_, ray, point, normal, material));
    seed = (seed + 7.13);
    let diffuseDirection = cosineDirection(normal, seed);
    let reflectedDirection = reflectDirection(ray.direction, normal);
    let bounceAmount = (material.metallic + ((1.0 - material.roughness) * 0.25));
    let nextDirection = normalize(mix(diffuseDirection, reflectedDirection, bounceAmount));
    throughput = (throughput * Material_bounceWeight(material));
    ray = Ray_new((point + (normal * RAY_EPSILON)), nextDirection);
  }
  return radiance;
}

fn Renderer_shade(self_: Renderer, ray: Ray, point: vec3<f32>, normal: vec3<f32>, material: Material) -> vec3<f32> {
  let viewDirection = (-ray.direction);
  let lightDirection = normalize((self_.scene.light.position - point));
  var visibility: f32 = 0.0;
  if (Scene_isVisible(self_.scene, point, normal)) {
    visibility = 1.0;
  }
  return (material.emission + ((visibility * PointLight_irradianceAt(self_.scene.light, point)) * Material_directResponse(material, normal, viewDirection, lightDirection)));
}

fn Renderer_sky(self_: Renderer, ray: Ray) -> vec3<f32> {
  let horizon = vec3<f32>(0.12, 0.17, 0.28);
  let zenith = vec3<f32>(0.55, 0.72, 0.95);
  let skyFactor = max(ray.direction.y, 0.0);
  return mix(horizon, zenith, skyFactor);
}

fn Renderer_new(scene: Scene) -> Renderer {
  let _cse1 = vec3<f32>(0.0, 0.0, 0.0);
  let _cse0 = Material(_cse1, 0.0, 0.0, _cse1);
  var self_: Renderer = Renderer(Scene(SDF_SdfSphere(_cse0, _cse1, 0.0), SDF_SdfBox(_cse0, _cse1, _cse1), SDF_SdfTorus(_cse0, _cse1, 0.0, 0.0), SDF_SdfPlane(_cse0, 0.0), PointLight(_cse1, _cse1, 0.0)));
  self_.scene = scene;
  return self_;
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

fn createCamera(time: f32) -> Camera {
  let _cse0 = (time * 0.17);
  return Camera_new(vec3<f32>((sin(_cse0) * 6.2), (2.0 + (sin((time * 0.31)) * 0.12)), (cos(_cse0) * 6.2)), vec3<f32>(0.0, 0.6, -1.8), 1.0);
}

fn pixelJitter(position: vec2<f32>, frame: f32, sample: i32) -> vec2<f32> {
  let _cse0 = f32(sample);
  return vec2<f32>((fract((sin(((dot(position, vec2<f32>(12.9898, 78.233)) + (frame * 0.71)) + (_cse0 * 19.17))) * 43758.5453123)) - 0.5), (fract((sin(((dot(position, vec2<f32>(39.346, 11.135)) + (frame * 1.17)) + (_cse0 * 7.91))) * 43758.5453123)) - 0.5));
}

fn renderSample(renderer: Renderer, camera: Camera, ndc: vec2<f32>, resolution: vec2<f32>, frame: f32, sample: i32) -> vec3<f32> {
  let pixel = (((ndc * 0.5) + vec2<f32>(0.5, 0.5)) * resolution);
  let jitter = pixelJitter(pixel, frame, sample);
  let sampleNdc = (ndc + vec2<f32>(((jitter.x * 2.0) / resolution.x), ((jitter.y * 2.0) / resolution.y)));
  let ray = Camera_rayFor(camera, vec2<f32>(((sampleNdc.x * resolution.x) / resolution.y), sampleNdc.y));
  let seed = ((dot(pixel, vec2<f32>(17.17, 73.19)) + (frame * 11.3)) + (f32(sample) * 3.7));
  return Renderer_trace(renderer, ray, seed);
}

fn toneMap(color: vec3<f32>) -> vec3<f32> {
  let mapped = (color / (color + vec3<f32>(1.0, 1.0, 1.0)));
  return pow(mapped, vec3<f32>(0.45454545454545453, 0.45454545454545453, 0.45454545454545453));
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
  let camera = createCamera(u.time);
  let scene = Scene_new();
  let renderer = Renderer_new(scene);
  var color: vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);
  for (var sample: i32 = 0; (sample < SAMPLES_PER_PIXEL); sample = (sample + 1)) {
    color += renderSample(renderer, camera, _licm0, _licm1, _licm2, sample);
  }
  color = toneMap((color / f32(SAMPLES_PER_PIXEL)));
  return vec4<f32>(color, 1.0);
}
