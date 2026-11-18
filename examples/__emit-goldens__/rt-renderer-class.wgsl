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
    var _i13_closestDistance: f32 = MAX_DISTANCE;
    var _i13_closestObjectIndex: i32 = -1;
    let _i13_sphereDistance = SDF_SdfSphere_distanceTo(&(*self_).redSphere, point);
    let _ifc0 = (_i13_sphereDistance < _i13_closestDistance);
    _i13_closestDistance = select(_i13_closestDistance, _i13_sphereDistance, _ifc0);
    _i13_closestObjectIndex = select(_i13_closestObjectIndex, 0, _ifc0);
    let _i13_boxDistance = SDF_SdfBox_distanceTo(&(*self_).blueBox, point);
    let _ifc1 = (_i13_boxDistance < _i13_closestDistance);
    _i13_closestDistance = select(_i13_closestDistance, _i13_boxDistance, _ifc1);
    _i13_closestObjectIndex = select(_i13_closestObjectIndex, 1, _ifc1);
    let _i13_torusDistance = SDF_SdfTorus_distanceTo(&(*self_).goldTorus, point);
    let _ifc2 = (_i13_torusDistance < _i13_closestDistance);
    _i13_closestDistance = select(_i13_closestDistance, _i13_torusDistance, _ifc2);
    _i13_closestObjectIndex = select(_i13_closestObjectIndex, 2, _ifc2);
    let _i13_groundDistance = (point.y - _licm5);
    let _ifc3 = (_i13_groundDistance < _i13_closestDistance);
    _i13_closestDistance = select(_i13_closestDistance, _i13_groundDistance, _ifc3);
    _i13_closestObjectIndex = select(_i13_closestObjectIndex, 3, _ifc3);
    var _i13ret: Hit;
    Hit_new_into(&_i13ret, _i13_closestDistance, _i13_closestObjectIndex);
    if ((_i13ret.distance < SURFACE_EPSILON)) {
      objectIndex = _i13ret.objectIndex;
      Hit_new_into(_dst, distance, objectIndex);
      return;
    }
    distance = (distance + _i13ret.distance);
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
      let _i19_skyFactor = max(ray.direction.y, 0.0);
      let _i19ret = mix(_licm1, _licm2, _i19_skyFactor);
      radiance += (throughput * _i19ret);
      break;
    }
    let point = (ray.origin + (ray.direction * hit.distance));
    let _i14a1 = hit.objectIndex;
    var _i14ret: vec3<f32>;
    if ((_i14a1 == 0)) {
      let _i14_dx = (SDF_SdfSphere_distanceTo(&(*self_).scene.redSphere, (point + _cse1)) - SDF_SdfSphere_distanceTo(&(*self_).scene.redSphere, (point - _cse1)));
      let _i14_dy = (SDF_SdfSphere_distanceTo(&(*self_).scene.redSphere, (point + _cse2)) - SDF_SdfSphere_distanceTo(&(*self_).scene.redSphere, (point - _cse2)));
      let _i14_dz = (SDF_SdfSphere_distanceTo(&(*self_).scene.redSphere, (point + _cse3)) - SDF_SdfSphere_distanceTo(&(*self_).scene.redSphere, (point - _cse3)));
      let _i14_ret = normalize(vec3<f32>(_i14_dx, _i14_dy, _i14_dz));
      _i14ret = _i14_ret;
    } else {
      if ((_i14a1 == 1)) {
        let _i14_dx_ = (SDF_SdfBox_distanceTo(&(*self_).scene.blueBox, (point + _cse1)) - SDF_SdfBox_distanceTo(&(*self_).scene.blueBox, (point - _cse1)));
        let _i14_dy_ = (SDF_SdfBox_distanceTo(&(*self_).scene.blueBox, (point + _cse2)) - SDF_SdfBox_distanceTo(&(*self_).scene.blueBox, (point - _cse2)));
        let _i14_dz_ = (SDF_SdfBox_distanceTo(&(*self_).scene.blueBox, (point + _cse3)) - SDF_SdfBox_distanceTo(&(*self_).scene.blueBox, (point - _cse3)));
        let _i14_ret_ = normalize(vec3<f32>(_i14_dx_, _i14_dy_, _i14_dz_));
        _i14ret = _i14_ret_;
      } else {
        if ((_i14a1 == 2)) {
          let _i14_dx__ = (SDF_SdfTorus_distanceTo(&(*self_).scene.goldTorus, (point + _cse1)) - SDF_SdfTorus_distanceTo(&(*self_).scene.goldTorus, (point - _cse1)));
          let _i14_dy__ = (SDF_SdfTorus_distanceTo(&(*self_).scene.goldTorus, (point + _cse2)) - SDF_SdfTorus_distanceTo(&(*self_).scene.goldTorus, (point - _cse2)));
          let _i14_dz__ = (SDF_SdfTorus_distanceTo(&(*self_).scene.goldTorus, (point + _cse3)) - SDF_SdfTorus_distanceTo(&(*self_).scene.goldTorus, (point - _cse3)));
          let _i14_ret__ = normalize(vec3<f32>(_i14_dx__, _i14_dy__, _i14_dz__));
          _i14ret = _i14_ret__;
        } else {
          let _i14_dx___ = (((point + _cse1).y - (*self_).scene.ground.height) - ((point - _cse1).y - (*self_).scene.ground.height));
          let _i14_dy___ = (((point + _cse2).y - (*self_).scene.ground.height) - ((point - _cse2).y - (*self_).scene.ground.height));
          let _i14_dz___ = (((point + _cse3).y - (*self_).scene.ground.height) - ((point - _cse3).y - (*self_).scene.ground.height));
          let _i14_ret___ = normalize(vec3<f32>(_i14_dx___, _i14_dy___, _i14_dz___));
          _i14ret = _i14_ret___;
        }
      }
    }
    let normal = _i14ret;
    let _i16a1 = hit.objectIndex;
    var _i16ret: Material;
    if ((_i16a1 == 0)) {
      _i16ret = (*self_).scene.redSphere.material;
    } else {
      if ((_i16a1 == 1)) {
        _i16ret = (*self_).scene.blueBox.material;
      } else {
        if ((_i16a1 == 2)) {
          _i16ret = (*self_).scene.goldTorus.material;
        } else {
          _i16ret = (*self_).scene.ground.material;
        }
      }
    }
    var material: Material = _i16ret;
    let _i18_viewDirection = (-ray.direction);
    let _i18_lightDirection = normalize((_licm3 - point));
    var _i18_visibility: f32 = 0.0;
    let _i18_toLight = ((*self_).scene.light.position - point);
    let _i18_distanceToLight = length(_i18_toLight);
    let _i18_lightDirection_ = normalize(_i18_toLight);
    let _gv0 = (point + (normal * RAY_EPSILON));
    let _i18_ret = ((_flow22_fused(&(*self_).scene, _gv0, _i18_lightDirection_, _i18_distanceToLight).objectIndex >= 0) == false);
    _i18_visibility = select(_i18_visibility, 1.0, _i18_ret);
    let _i18_ndl = max(dot(normal, _i18_lightDirection), 0.0);
    let _i18_diffuse = ((material.albedo * (1.0 - material.metallic)) * _i18_ndl);
    let _i18_halfDirection = normalize((_i18_lightDirection + _i18_viewDirection));
    let _gv1 = (1.0 - material.roughness);
    let _i18_shininess = mix(16.0, 128.0, _gv1);
    let _i18_specular = pow(max(dot(normal, _i18_halfDirection), 0.0), _i18_shininess);
    let _i18_baseReflectance = mix(_licm4, material.albedo, material.metallic);
    let _i18_fresnel = (_i18_baseReflectance + ((_cse0 - _i18_baseReflectance) * pow((1.0 - max(dot(normal, _i18_viewDirection), 0.0)), 5.0)));
    let _i18_ret_ = (_i18_diffuse + (_i18_fresnel * _i18_specular));
    let _i18_offset = ((*self_).scene.light.position - point);
    let _i18_distanceSquared = max(dot(_i18_offset, _i18_offset), 1.0);
    let _i18_ret__ = ((*self_).scene.light.color * ((*self_).scene.light.intensity / _i18_distanceSquared));
    let _i18ret = (material.emission + ((_i18_visibility * _i18_ret__) * _i18_ret_));
    radiance += (throughput * _i18ret);
    seed = (seed + 7.13);
    let _i21_r1 = fract((sin(seed) * 43758.5453123));
    let _i21_r2 = fract((sin((seed + 17.13)) * 43758.5453123));
    let _i21_phi = (6.2831853 * _i21_r1);
    let _i21_radius = sqrt(_i21_r2);
    let _i21_tangent = normalize(cross(select(_licm7, _licm6, (abs(normal.x) > 0.9)), normal));
    let _i21_bitangent = cross(normal, _i21_tangent);
    let _i21ret = normalize((((_i21_tangent * (cos(_i21_phi) * _i21_radius)) + (_i21_bitangent * (sin(_i21_phi) * _i21_radius))) + (normal * sqrt((1.0 - _i21_r2)))));
    let _i22a0 = ray.direction;
    let reflectedDirection = (_i22a0 - (normal * (2.0 * dot(_i22a0, normal))));
    let bounceAmount = (material.metallic + (_gv1 * 0.25));
    let nextDirection = normalize(mix(_i21ret, reflectedDirection, bounceAmount));
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
  let _i23a0 = u.time;
  let _lc0 = (_i23a0 * 0.17);
  let _i23_a0 = vec3<f32>((sin(_lc0) * 6.2), (2.0 + (sin((_i23a0 * 0.31)) * 0.12)), (cos(_lc0) * 6.2));
  let _i23_a1 = vec3<f32>(0.0, 0.6, -1.8);
  let _cse8 = vec3<f32>(0.0, 0.0, 0.0);
  var _i23_self_: Camera = Camera(_cse8, _cse8, 0.0);
  _i23_self_.position = _i23_a0;
  _i23_self_.lookAt = _i23_a1;
  _i23_self_.fov = 1.0;
  var camera: Camera = _i23_self_;
  var _cse7: Material = Material(_cse8, 0.0, 0.0, _cse8);
  var _cse2: SDF_SdfSphere = SDF_SdfSphere(_cse7, _cse8, 0.0);
  var _cse3: SDF_SdfBox = SDF_SdfBox(_cse7, _cse8, _cse8);
  var _cse4: SDF_SdfTorus = SDF_SdfTorus(_cse7, _cse8, 0.0, 0.0);
  var _cse5: SDF_SdfPlane = SDF_SdfPlane(_cse7, 0.0);
  var _cse6: PointLight = PointLight(_cse8, _cse8, 0.0);
  var _cse0: Scene = Scene(_cse2, _cse3, _cse4, _cse5, _cse6);
  var _i17_self_: Scene = _cse0;
  let _i17_a0 = vec3<f32>(-1.15, 0.2, -1.7);
  var _i17_self__: SDF_SdfSphere = _cse2;
  let _cse1 = vec3<f32>(0.0);
  _i17_self__.material = _flow43_fused(vec3<f32>(0.78, 0.12, 0.08), 0.0, 0.4, _cse1).material;
  _i17_self__.center = _i17_a0;
  _i17_self__.radius = 1.0;
  _i17_self_.redSphere = _i17_self__;
  let _i17_a0_ = vec3<f32>(1.05, 0.25, -2.0);
  let _i17_a1 = vec3<f32>(0.75, 0.75, 0.75);
  var _i17_self___: SDF_SdfBox = _cse3;
  _i17_self___.material = _flow43_fused(vec3<f32>(0.08, 0.3, 0.84), 0.2, 0.3, _cse1).material;
  _i17_self___.center = _i17_a0_;
  _i17_self___.halfSize = _i17_a1;
  _i17_self_.blueBox = _i17_self___;
  let _i17_a0__ = vec3<f32>(0.0, 1.35, -2.9);
  var _i17_self____: SDF_SdfTorus = _cse4;
  _i17_self____.material = _flow43_fused(vec3<f32>(0.95, 0.65, 0.1), 0.9, 0.12, _cse1).material;
  _i17_self____.center = _i17_a0__;
  _i17_self____.majorRadius = 0.72;
  _i17_self____.minorRadius = 0.24;
  _i17_self_.goldTorus = _i17_self____;
  var _i17_self_____: SDF_SdfPlane = _cse5;
  _i17_self_____.material = _flow43_fused(vec3<f32>(0.68, 0.72, 0.8), 0.0, 0.92, _cse1).material;
  _i17_self_____.height = -1.0;
  _i17_self_.ground = _i17_self_____;
  let _i17_a0____ = vec3<f32>(-2.5, 4.8, 2.0);
  let _i17_a1__ = vec3<f32>(1.0, 0.88, 0.72);
  var _i17_self______: PointLight = _cse6;
  _i17_self______.position = _i17_a0____;
  _i17_self______.color = _i17_a1__;
  _i17_self______.intensity = 70.0;
  _i17_self_.light = _i17_self______;
  var scene: Scene = _i17_self_;
  var _i20_self_: Renderer = Renderer(_cse0);
  _i20_self_.scene = scene;
  var renderer: Renderer = _i20_self_;
  var color: vec3<f32> = _cse1;
  for (var sample: i32 = 0; (sample < SAMPLES_PER_PIXEL); sample = (sample + 1)) {
    let _i24_pixel = (((_licm0 * 0.5) + _licm3) * _licm1);
    let _gv0 = f32(sample);
    let _i24_jitter = vec2<f32>((fract((sin(((dot(_i24_pixel, _licm4) + (_licm2 * 0.71)) + (_gv0 * 19.17))) * 43758.5453123)) - 0.5), (fract((sin(((dot(_i24_pixel, _licm5) + (_licm2 * 1.17)) + (_gv0 * 7.91))) * 43758.5453123)) - 0.5));
    let _i24_sampleNdc = (_licm0 + vec2<f32>(((_i24_jitter.x * 2.0) / _licm1.x), ((_i24_jitter.y * 2.0) / _licm1.y)));
    let _gv1 = ((_i24_sampleNdc.x * _licm1.x) / _licm1.y);
    let _i24_forward = normalize((camera.lookAt - camera.position));
    let _i24_right = normalize(cross(_i24_forward, _licm6));
    let _i24_up = cross(_i24_right, _i24_forward);
    let _i24_scale = tan((camera.fov * 0.5));
    let _i24_direction = normalize(((_i24_forward + ((_i24_right * _gv1) * _i24_scale)) + ((_i24_up * _i24_sampleNdc.y) * _i24_scale)));
    var _i24_ret: Ray;
    Ray_new_into(&_i24_ret, camera.position, _i24_direction);
    let _i24_seed = ((dot(_i24_pixel, _licm7) + (_licm2 * 11.3)) + (_gv0 * 3.7));
    let _i24ret = Renderer_trace(&renderer, &_i24_ret, _i24_seed);
    color += _i24ret;
  }
  let _i25a0 = (color / f32(SAMPLES_PER_PIXEL));
  let _i25_mapped = (_i25a0 / (_i25a0 + vec3<f32>(1.0)));
  let _i25ret = pow(_i25_mapped, vec3<f32>(0.45454545454545453));
  color = _i25ret;
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
    let _ifc0 = (_flow13_local < _flow11_local);
    _flow11_local = select(_flow11_local, _flow13_local, _ifc0);
    _flow12_local = select(_flow12_local, 0, _ifc0);
    let _flow14_local = SDF_SdfBox_distanceTo(&(*_flow0_input).blueBox, _flow10_local);
    let _ifc1 = (_flow14_local < _flow11_local);
    _flow11_local = select(_flow11_local, _flow14_local, _ifc1);
    _flow12_local = select(_flow12_local, 1, _ifc1);
    let _flow15_local = SDF_SdfTorus_distanceTo(&(*_flow0_input).goldTorus, _flow10_local);
    let _ifc2 = (_flow15_local < _flow11_local);
    _flow11_local = select(_flow11_local, _flow15_local, _ifc2);
    _flow12_local = select(_flow12_local, 2, _ifc2);
    let _flow16_local = (_flow10_local.y - _licm3);
    let _ifc3 = (_flow16_local < _flow11_local);
    _flow11_local = select(_flow11_local, _flow16_local, _ifc3);
    _flow12_local = select(_flow12_local, 3, _ifc3);
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
