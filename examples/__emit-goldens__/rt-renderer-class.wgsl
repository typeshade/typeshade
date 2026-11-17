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

fn Ray_new_into(_dst: ptr<function, Ray>, origin: vec3<f32>, direction: vec3<f32>) {
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  (*_dst) = Ray(_cse0, _cse0);
  (*_dst).origin = origin;
  (*_dst).direction = direction;
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

fn SDF_SdfSphere_distanceTo(self_: ptr<function, SDF_SdfSphere>, point: vec3<f32>) -> f32 {
  return (length((point - (*self_).center)) - (*self_).radius);
}

fn SDF_SdfBox_distanceTo(self_: ptr<function, SDF_SdfBox>, point: vec3<f32>) -> f32 {
  let local = (abs((point - (*self_).center)) - (*self_).halfSize);
  let outside = max(local, vec3<f32>(0.0));
  let inside = min(max(local.x, max(local.y, local.z)), 0.0);
  return (length(outside) + inside);
}

fn SDF_SdfTorus_distanceTo(self_: ptr<function, SDF_SdfTorus>, point: vec3<f32>) -> f32 {
  let local = (point - (*self_).center);
  let ring = (length(vec2<f32>(local.x, local.z)) - (*self_).majorRadius);
  return (length(vec2<f32>(ring, local.y)) - (*self_).minorRadius);
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

fn Scene_raymarch_into(_dst: ptr<function, Hit>, self_: ptr<function, Scene>, ray: ptr<function, Ray>, maxDistance: f32) {
  let _licm0 = (*ray).origin;
  let _licm1 = (*ray).direction;
  let _licm5 = (*self_).ground.height;
  var distance: f32 = 0.0;
  var objectIndex: i32 = -1;
  for (var step: i32 = 0; (step < MAX_STEPS); step = (step + 1)) {
    let point = (_licm0 + (_licm1 * distance));
    var _sm13_l_closestDistance: f32 = MAX_DISTANCE;
    var _sm13_l_closestObjectIndex: i32 = -1;
    let _sm13_l_sphereDistance = SDF_SdfSphere_distanceTo(&(*self_).redSphere, point);
    if ((_sm13_l_sphereDistance < _sm13_l_closestDistance)) {
      _sm13_l_closestDistance = _sm13_l_sphereDistance;
      _sm13_l_closestObjectIndex = 0;
    }
    let _sm13_l_boxDistance = SDF_SdfBox_distanceTo(&(*self_).blueBox, point);
    if ((_sm13_l_boxDistance < _sm13_l_closestDistance)) {
      _sm13_l_closestDistance = _sm13_l_boxDistance;
      _sm13_l_closestObjectIndex = 1;
    }
    let _sm13_l_torusDistance = SDF_SdfTorus_distanceTo(&(*self_).goldTorus, point);
    if ((_sm13_l_torusDistance < _sm13_l_closestDistance)) {
      _sm13_l_closestDistance = _sm13_l_torusDistance;
      _sm13_l_closestObjectIndex = 2;
    }
    let _sm13_l_groundDistance = (point.y - _licm5);
    if ((_sm13_l_groundDistance < _sm13_l_closestDistance)) {
      _sm13_l_closestDistance = _sm13_l_groundDistance;
      _sm13_l_closestObjectIndex = 3;
    }
    var _sm13_ret: Hit;
    Hit_new_into(&_sm13_ret, _sm13_l_closestDistance, _sm13_l_closestObjectIndex);
    if ((_sm13_ret.distance < SURFACE_EPSILON)) {
      objectIndex = _sm13_ret.objectIndex;
      Hit_new_into(_dst, distance, objectIndex);
      return;
    }
    distance = (distance + _sm13_ret.distance);
    if ((distance > maxDistance)) {
      break;
    }
  }
  Hit_new_into(_dst, -1.0, objectIndex);
}

fn Renderer_trace(self_: ptr<function, Renderer>, primaryRay: ptr<function, Ray>, seed0: f32) -> vec3<f32> {
  let _licm1 = vec3<f32>(0.12, 0.17, 0.28);
  let _licm2 = vec3<f32>(0.55, 0.72, 0.95);
  let _licm3 = (*self_).scene.light.position;
  let _licm4 = vec3<f32>(0.04);
  let _licm6 = vec3<f32>(0.0, 1.0, 0.0);
  let _licm7 = vec3<f32>(1.0, 0.0, 0.0);
  var ray: Ray = (*primaryRay);
  let _cse0 = vec3<f32>(1.0);
  var throughput: vec3<f32> = _cse0;
  var radiance: vec3<f32> = vec3<f32>(0.0);
  var seed: f32 = seed0;
  let _cse1 = vec3<f32>(0.0015, 0.0, 0.0);
  let _cse2 = vec3<f32>(0.0, 0.0015, 0.0);
  let _cse3 = vec3<f32>(0.0, 0.0, 0.0015);
  for (var bounce: i32 = 0; (bounce < MAX_BOUNCES); bounce = (bounce + 1)) {
    var hit: Hit;
    Scene_raymarch_into(&hit, &(*self_).scene, &ray, MAX_DISTANCE);
    if (((hit.objectIndex >= 0) == false)) {
      let _sm19_l_skyFactor = max(ray.direction.y, 0.0);
      let _sm19_ret = mix(_licm1, _licm2, _sm19_l_skyFactor);
      radiance += (throughput * _sm19_ret);
      break;
    }
    let point = (ray.origin + (ray.direction * hit.distance));
    let _sm14_a1 = hit.objectIndex;
    var _sm14_ret: vec3<f32>;
    if ((_sm14_a1 == 0)) {
      let _sm14_l_sm1_l_dx = (SDF_SdfSphere_distanceTo(&(*self_).scene.redSphere, (point + _cse1)) - SDF_SdfSphere_distanceTo(&(*self_).scene.redSphere, (point - _cse1)));
      let _sm14_l_sm1_l_dy = (SDF_SdfSphere_distanceTo(&(*self_).scene.redSphere, (point + _cse2)) - SDF_SdfSphere_distanceTo(&(*self_).scene.redSphere, (point - _cse2)));
      let _sm14_l_sm1_l_dz = (SDF_SdfSphere_distanceTo(&(*self_).scene.redSphere, (point + _cse3)) - SDF_SdfSphere_distanceTo(&(*self_).scene.redSphere, (point - _cse3)));
      let _sm14_l_sm1_ret = normalize(vec3<f32>(_sm14_l_sm1_l_dx, _sm14_l_sm1_l_dy, _sm14_l_sm1_l_dz));
      _sm14_ret = _sm14_l_sm1_ret;
    } else {
      if ((_sm14_a1 == 1)) {
        let _sm14_l_sm3_l_dx = (SDF_SdfBox_distanceTo(&(*self_).scene.blueBox, (point + _cse1)) - SDF_SdfBox_distanceTo(&(*self_).scene.blueBox, (point - _cse1)));
        let _sm14_l_sm3_l_dy = (SDF_SdfBox_distanceTo(&(*self_).scene.blueBox, (point + _cse2)) - SDF_SdfBox_distanceTo(&(*self_).scene.blueBox, (point - _cse2)));
        let _sm14_l_sm3_l_dz = (SDF_SdfBox_distanceTo(&(*self_).scene.blueBox, (point + _cse3)) - SDF_SdfBox_distanceTo(&(*self_).scene.blueBox, (point - _cse3)));
        let _sm14_l_sm3_ret = normalize(vec3<f32>(_sm14_l_sm3_l_dx, _sm14_l_sm3_l_dy, _sm14_l_sm3_l_dz));
        _sm14_ret = _sm14_l_sm3_ret;
      } else {
        if ((_sm14_a1 == 2)) {
          let _sm14_l_sm5_l_dx = (SDF_SdfTorus_distanceTo(&(*self_).scene.goldTorus, (point + _cse1)) - SDF_SdfTorus_distanceTo(&(*self_).scene.goldTorus, (point - _cse1)));
          let _sm14_l_sm5_l_dy = (SDF_SdfTorus_distanceTo(&(*self_).scene.goldTorus, (point + _cse2)) - SDF_SdfTorus_distanceTo(&(*self_).scene.goldTorus, (point - _cse2)));
          let _sm14_l_sm5_l_dz = (SDF_SdfTorus_distanceTo(&(*self_).scene.goldTorus, (point + _cse3)) - SDF_SdfTorus_distanceTo(&(*self_).scene.goldTorus, (point - _cse3)));
          let _sm14_l_sm5_ret = normalize(vec3<f32>(_sm14_l_sm5_l_dx, _sm14_l_sm5_l_dy, _sm14_l_sm5_l_dz));
          _sm14_ret = _sm14_l_sm5_ret;
        } else {
          let _sm14_l_sm7_l_dx = (((point + _cse1).y - (*self_).scene.ground.height) - ((point - _cse1).y - (*self_).scene.ground.height));
          let _sm14_l_sm7_l_dy = (((point + _cse2).y - (*self_).scene.ground.height) - ((point - _cse2).y - (*self_).scene.ground.height));
          let _sm14_l_sm7_l_dz = (((point + _cse3).y - (*self_).scene.ground.height) - ((point - _cse3).y - (*self_).scene.ground.height));
          let _sm14_l_sm7_ret = normalize(vec3<f32>(_sm14_l_sm7_l_dx, _sm14_l_sm7_l_dy, _sm14_l_sm7_l_dz));
          _sm14_ret = _sm14_l_sm7_ret;
        }
      }
    }
    let normal = _sm14_ret;
    let _sm16_a1 = hit.objectIndex;
    var _sm16_ret: Material;
    if ((_sm16_a1 == 0)) {
      _sm16_ret = (*self_).scene.redSphere.material;
    } else {
      if ((_sm16_a1 == 1)) {
        _sm16_ret = (*self_).scene.blueBox.material;
      } else {
        if ((_sm16_a1 == 2)) {
          _sm16_ret = (*self_).scene.goldTorus.material;
        } else {
          _sm16_ret = (*self_).scene.ground.material;
        }
      }
    }
    var material: Material = _sm16_ret;
    let _sm18_l_viewDirection = (-ray.direction);
    let _sm18_l_lightDirection = normalize((_licm3 - point));
    var _sm18_l_visibility: f32 = 0.0;
    let _sm18_l_sm15_l_toLight = ((*self_).scene.light.position - point);
    let _sm18_l_sm15_l_distanceToLight = length(_sm18_l_sm15_l_toLight);
    let _sm18_l_sm15_l_lightDirection = normalize(_sm18_l_sm15_l_toLight);
    let _gv0 = (point + (normal * RAY_EPSILON));
    let _sm18_l_sm15_ret = ((_flow22_fused(&(*self_).scene, _gv0, _sm18_l_sm15_l_lightDirection, _sm18_l_sm15_l_distanceToLight).objectIndex >= 0) == false);
    if (_sm18_l_sm15_ret) {
      _sm18_l_visibility = 1.0;
    }
    let _sm18_l_sm0_l_ndl = max(dot(normal, _sm18_l_lightDirection), 0.0);
    let _sm18_l_sm0_l_diffuse = ((material.albedo * (1.0 - material.metallic)) * _sm18_l_sm0_l_ndl);
    let _sm18_l_sm0_l_halfDirection = normalize((_sm18_l_lightDirection + _sm18_l_viewDirection));
    let _gv1 = (1.0 - material.roughness);
    let _sm18_l_sm0_l_shininess = mix(16.0, 128.0, _gv1);
    let _sm18_l_sm0_l_specular = pow(max(dot(normal, _sm18_l_sm0_l_halfDirection), 0.0), _sm18_l_sm0_l_shininess);
    let _sm18_l_sm0_l_baseReflectance = mix(_licm4, material.albedo, material.metallic);
    let _sm18_l_sm0_l_fresnel = (_sm18_l_sm0_l_baseReflectance + ((_cse0 - _sm18_l_sm0_l_baseReflectance) * pow((1.0 - max(dot(normal, _sm18_l_viewDirection), 0.0)), 5.0)));
    let _sm18_l_sm0_ret = (_sm18_l_sm0_l_diffuse + (_sm18_l_sm0_l_fresnel * _sm18_l_sm0_l_specular));
    let _sm18_l_sm9_l_offset = ((*self_).scene.light.position - point);
    let _sm18_l_sm9_l_distanceSquared = max(dot(_sm18_l_sm9_l_offset, _sm18_l_sm9_l_offset), 1.0);
    let _sm18_l_sm9_ret = ((*self_).scene.light.color * ((*self_).scene.light.intensity / _sm18_l_sm9_l_distanceSquared));
    let _sm18_ret = (material.emission + ((_sm18_l_visibility * _sm18_l_sm9_ret) * _sm18_l_sm0_ret));
    radiance += (throughput * _sm18_ret);
    seed = (seed + 7.13);
    let _sm21_l_r1 = fract((sin(seed) * 43758.5453123));
    let _sm21_l_r2 = fract((sin((seed + 17.13)) * 43758.5453123));
    let _sm21_l_phi = (6.2831853 * _sm21_l_r1);
    let _sm21_l_radius = sqrt(_sm21_l_r2);
    let _sm21_l_tangent = normalize(cross(select(_licm7, _licm6, (abs(normal.x) > 0.9)), normal));
    let _sm21_l_bitangent = cross(normal, _sm21_l_tangent);
    let _sm21_ret = normalize((((_sm21_l_tangent * (cos(_sm21_l_phi) * _sm21_l_radius)) + (_sm21_l_bitangent * (sin(_sm21_l_phi) * _sm21_l_radius))) + (normal * sqrt((1.0 - _sm21_l_r2)))));
    let _sm22_a0 = ray.direction;
    let reflectedDirection = (_sm22_a0 - (normal * (2.0 * dot(_sm22_a0, normal))));
    let bounceAmount = (material.metallic + (_gv1 * 0.25));
    let nextDirection = normalize(mix(_sm21_ret, reflectedDirection, bounceAmount));
    throughput = (throughput * (mix(material.albedo, _cse0, material.metallic) * 0.65));
    Ray_new_into(&ray, _gv0, nextDirection);
  }
  return radiance;
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
  let _licm3 = vec2<f32>(0.5);
  let _licm4 = vec2<f32>(12.9898, 78.233);
  let _licm5 = vec2<f32>(39.346, 11.135);
  let _licm6 = vec3<f32>(0.0, 1.0, 0.0);
  let _licm7 = vec2<f32>(17.17, 73.19);
  let _sm23_a0 = u.time;
  let _lc0 = (_sm23_a0 * 0.17);
  let _sm23_l_sm12_a0 = vec3<f32>((sin(_lc0) * 6.2), (2.0 + (sin((_sm23_a0 * 0.31)) * 0.12)), (cos(_lc0) * 6.2));
  let _sm23_l_sm12_a1 = vec3<f32>(0.0, 0.6, -1.8);
  let _cse8 = vec3<f32>(0.0, 0.0, 0.0);
  var _sm23_l_sm12_l_self_: Camera = Camera(_cse8, _cse8, 0.0);
  _sm23_l_sm12_l_self_.position = _sm23_l_sm12_a0;
  _sm23_l_sm12_l_self_.lookAt = _sm23_l_sm12_a1;
  _sm23_l_sm12_l_self_.fov = 1.0;
  var camera: Camera = _sm23_l_sm12_l_self_;
  var _cse7: Material = Material(_cse8, 0.0, 0.0, _cse8);
  var _cse2: SDF_SdfSphere = SDF_SdfSphere(_cse7, _cse8, 0.0);
  var _cse3: SDF_SdfBox = SDF_SdfBox(_cse7, _cse8, _cse8);
  var _cse4: SDF_SdfTorus = SDF_SdfTorus(_cse7, _cse8, 0.0, 0.0);
  var _cse5: SDF_SdfPlane = SDF_SdfPlane(_cse7, 0.0);
  var _cse6: PointLight = PointLight(_cse8, _cse8, 0.0);
  var _cse0: Scene = Scene(_cse2, _cse3, _cse4, _cse5, _cse6);
  var _sm17_l_self_: Scene = _cse0;
  let _sm17_l_sm2_a0 = vec3<f32>(-1.15, 0.2, -1.7);
  var _sm17_l_sm2_l_self_: SDF_SdfSphere = _cse2;
  let _cse1 = vec3<f32>(0.0);
  _sm17_l_sm2_l_self_.material = _flow43_fused(vec3<f32>(0.78, 0.12, 0.08), 0.0, 0.4, _cse1).material;
  _sm17_l_sm2_l_self_.center = _sm17_l_sm2_a0;
  _sm17_l_sm2_l_self_.radius = 1.0;
  _sm17_l_self_.redSphere = _sm17_l_sm2_l_self_;
  let _sm17_l_sm4_a0 = vec3<f32>(1.05, 0.25, -2.0);
  let _sm17_l_sm4_a1 = vec3<f32>(0.75, 0.75, 0.75);
  var _sm17_l_sm4_l_self_: SDF_SdfBox = _cse3;
  _sm17_l_sm4_l_self_.material = _flow43_fused(vec3<f32>(0.08, 0.3, 0.84), 0.2, 0.3, _cse1).material;
  _sm17_l_sm4_l_self_.center = _sm17_l_sm4_a0;
  _sm17_l_sm4_l_self_.halfSize = _sm17_l_sm4_a1;
  _sm17_l_self_.blueBox = _sm17_l_sm4_l_self_;
  let _sm17_l_sm6_a0 = vec3<f32>(0.0, 1.35, -2.9);
  var _sm17_l_sm6_l_self_: SDF_SdfTorus = _cse4;
  _sm17_l_sm6_l_self_.material = _flow43_fused(vec3<f32>(0.95, 0.65, 0.1), 0.9, 0.12, _cse1).material;
  _sm17_l_sm6_l_self_.center = _sm17_l_sm6_a0;
  _sm17_l_sm6_l_self_.majorRadius = 0.72;
  _sm17_l_sm6_l_self_.minorRadius = 0.24;
  _sm17_l_self_.goldTorus = _sm17_l_sm6_l_self_;
  var _sm17_l_sm8_l_self_: SDF_SdfPlane = _cse5;
  _sm17_l_sm8_l_self_.material = _flow43_fused(vec3<f32>(0.68, 0.72, 0.8), 0.0, 0.92, _cse1).material;
  _sm17_l_sm8_l_self_.height = -1.0;
  _sm17_l_self_.ground = _sm17_l_sm8_l_self_;
  let _sm17_l_sm10_a0 = vec3<f32>(-2.5, 4.8, 2.0);
  let _sm17_l_sm10_a1 = vec3<f32>(1.0, 0.88, 0.72);
  var _sm17_l_sm10_l_self_: PointLight = _cse6;
  _sm17_l_sm10_l_self_.position = _sm17_l_sm10_a0;
  _sm17_l_sm10_l_self_.color = _sm17_l_sm10_a1;
  _sm17_l_sm10_l_self_.intensity = 70.0;
  _sm17_l_self_.light = _sm17_l_sm10_l_self_;
  var scene: Scene = _sm17_l_self_;
  var _sm20_l_self_: Renderer = Renderer(_cse0);
  _sm20_l_self_.scene = scene;
  var renderer: Renderer = _sm20_l_self_;
  var color: vec3<f32> = _cse1;
  for (var sample: i32 = 0; (sample < SAMPLES_PER_PIXEL); sample = (sample + 1)) {
    let _sm24_l_pixel = (((_licm0 * 0.5) + _licm3) * _licm1);
    let _gv0 = f32(sample);
    let _sm24_l_jitter = vec2<f32>((fract((sin(((dot(_sm24_l_pixel, _licm4) + (_licm2 * 0.71)) + (_gv0 * 19.17))) * 43758.5453123)) - 0.5), (fract((sin(((dot(_sm24_l_pixel, _licm5) + (_licm2 * 1.17)) + (_gv0 * 7.91))) * 43758.5453123)) - 0.5));
    let _sm24_l_sampleNdc = (_licm0 + vec2<f32>(((_sm24_l_jitter.x * 2.0) / _licm1.x), ((_sm24_l_jitter.y * 2.0) / _licm1.y)));
    let _gv1 = ((_sm24_l_sampleNdc.x * _licm1.x) / _licm1.y);
    let _sm24_l_sm11_l_forward = normalize((camera.lookAt - camera.position));
    let _sm24_l_sm11_l_right = normalize(cross(_sm24_l_sm11_l_forward, _licm6));
    let _sm24_l_sm11_l_up = cross(_sm24_l_sm11_l_right, _sm24_l_sm11_l_forward);
    let _sm24_l_sm11_l_scale = tan((camera.fov * 0.5));
    let _sm24_l_sm11_l_direction = normalize(((_sm24_l_sm11_l_forward + ((_sm24_l_sm11_l_right * _gv1) * _sm24_l_sm11_l_scale)) + ((_sm24_l_sm11_l_up * _sm24_l_sampleNdc.y) * _sm24_l_sm11_l_scale)));
    var _sm24_l_sm11_ret: Ray;
    Ray_new_into(&_sm24_l_sm11_ret, camera.position, _sm24_l_sm11_l_direction);
    let _sm24_l_seed = ((dot(_sm24_l_pixel, _licm7) + (_licm2 * 11.3)) + (_gv0 * 3.7));
    let _sm24_ret = Renderer_trace(&renderer, &_sm24_l_sm11_ret, _sm24_l_seed);
    color += _sm24_ret;
  }
  let _sm25_a0 = (color / f32(SAMPLES_PER_PIXEL));
  let _sm25_l_mapped = (_sm25_a0 / (_sm25_a0 + vec3<f32>(1.0)));
  let _sm25_ret = pow(_sm25_l_mapped, vec3<f32>(0.45454545454545453));
  color = _sm25_ret;
  return vec4<f32>(color, 1.0);
}

fn _flow22_fused(_flow0_input: ptr<function, Scene>, _flow1_input: vec3<f32>, _flow2_input: vec3<f32>, _flow6_input: f32) -> Hit {
  let _licm3 = (*_flow0_input).ground.height;
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  var _flow23_part: vec3<f32> = _cse0;
  var _flow24_part: vec3<f32> = _cse0;
  _flow23_part = _flow1_input;
  _flow24_part = _flow2_input;
  let _flow25_part = _flow23_part;
  let _flow26_part = _flow24_part;
  var _flow7_local: f32 = 0.0;
  var _flow8_local: i32 = -1;
  for (var _flow9_local: i32 = 0; (_flow9_local < MAX_STEPS); _flow9_local = (_flow9_local + 1)) {
    let _flow10_local = (_flow25_part + (_flow26_part * _flow7_local));
    var _flow11_local: f32 = MAX_DISTANCE;
    var _flow12_local: i32 = -1;
    let _flow13_local = SDF_SdfSphere_distanceTo(&(*_flow0_input).redSphere, _flow10_local);
    if ((_flow13_local < _flow11_local)) {
      _flow11_local = _flow13_local;
      _flow12_local = 0;
    }
    let _flow14_local = SDF_SdfBox_distanceTo(&(*_flow0_input).blueBox, _flow10_local);
    if ((_flow14_local < _flow11_local)) {
      _flow11_local = _flow14_local;
      _flow12_local = 1;
    }
    let _flow15_local = SDF_SdfTorus_distanceTo(&(*_flow0_input).goldTorus, _flow10_local);
    if ((_flow15_local < _flow11_local)) {
      _flow11_local = _flow15_local;
      _flow12_local = 2;
    }
    let _flow16_local = (_flow10_local.y - _licm3);
    if ((_flow16_local < _flow11_local)) {
      _flow11_local = _flow16_local;
      _flow12_local = 3;
    }
    var _flow31_whole: Hit;
    Hit_new_into(&_flow31_whole, _flow11_local, _flow12_local);
    let _flow27_part = _flow31_whole.distance;
    let _flow28_part = _flow31_whole.objectIndex;
    if ((_flow27_part < SURFACE_EPSILON)) {
      _flow8_local = _flow28_part;
      return Hit_new(_flow7_local, _flow8_local);
    }
    _flow7_local = (_flow7_local + _flow27_part);
    if ((_flow7_local > _flow6_input)) {
      break;
    }
  }
  return Hit_new(-1.0, _flow8_local);
}

fn _flow43_fused(_flow32_input: vec3<f32>, _flow33_input: f32, _flow34_input: f32, _flow35_input: vec3<f32>) -> SdfShape {
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  var _flow44_part: vec3<f32> = _cse0;
  var _flow45_part: f32 = 0.0;
  var _flow46_part: f32 = 0.0;
  var _flow47_part: vec3<f32> = _cse0;
  _flow44_part = _flow32_input;
  _flow45_part = _flow33_input;
  _flow46_part = _flow34_input;
  _flow47_part = _flow35_input;
  let _flow48_part = _flow44_part;
  let _flow49_part = _flow45_part;
  let _flow50_part = _flow46_part;
  let _flow51_part = _flow47_part;
  var _flow41_local: SdfShape = SdfShape(Material(_cse0, 0.0, 0.0, _cse0));
  _flow41_local.material = Material(_flow48_part, _flow49_part, _flow50_part, _flow51_part);
  return _flow41_local;
}
