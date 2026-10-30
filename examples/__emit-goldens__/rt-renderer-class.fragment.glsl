#version 300 es
precision highp float;
precision highp int;

struct Ray {
  vec3 origin;
  vec3 direction;
};

struct Material {
  vec3 albedo;
  float metallic;
  float roughness;
  vec3 emission;
};

struct SdfShape {
  Material material;
};

struct SDF_SdfSphere {
  Material material;
  vec3 center;
  float radius;
};

struct SDF_SdfBox {
  Material material;
  vec3 center;
  vec3 halfSize;
};

struct SDF_SdfTorus {
  Material material;
  vec3 center;
  float majorRadius;
  float minorRadius;
};

struct SDF_SdfPlane {
  Material material;
  float height;
};

struct Hit {
  float distance;
  int objectIndex;
};

struct PointLight {
  vec3 position;
  vec3 color;
  float intensity;
};

struct Camera {
  vec3 position;
  vec3 lookAt;
  float fov;
};

struct Scene {
  SDF_SdfSphere redSphere;
  SDF_SdfBox blueBox;
  SDF_SdfTorus goldTorus;
  SDF_SdfPlane ground;
  PointLight light;
};

struct Renderer {
  Scene scene;
};
const float SURFACE_EPSILON = 0.001;
const float RAY_EPSILON = 0.003;
const float MAX_DISTANCE = 40.0;
const int MAX_STEPS = 96;
const int MAX_BOUNCES = 3;
const int SAMPLES_PER_PIXEL = 2;
layout(std140) uniform Frame {
  vec2 resolution;
  float time;
  float frame;
} u;
vec3 Ray_at(Ray self_, float distance) {
  return (self_.origin + (self_.direction * distance));
}

Ray Ray_new(vec3 origin, vec3 direction) {
  vec3 _cse0 = vec3(0.0, 0.0, 0.0);
  Ray self_ = Ray(_cse0, _cse0);
  self_.origin = origin;
  self_.direction = direction;
  return self_;
}

vec3 Material_directResponse(Material self_, vec3 normal, vec3 viewDirection, vec3 lightDirection) {
  float ndl = max(dot(normal, lightDirection), 0.0);
  vec3 diffuse = ((self_.albedo * (1.0 - self_.metallic)) * ndl);
  vec3 halfDirection = normalize((lightDirection + viewDirection));
  float shininess = mix(16.0, 128.0, (1.0 - self_.roughness));
  float specular = pow(max(dot(normal, halfDirection), 0.0), shininess);
  vec3 baseReflectance = mix(vec3(0.04), self_.albedo, self_.metallic);
  vec3 fresnel = (baseReflectance + ((vec3(1.0) - baseReflectance) * pow((1.0 - max(dot(normal, viewDirection), 0.0)), 5.0)));
  return (diffuse + (fresnel * specular));
}

vec3 Material_bounceWeight(Material self_) {
  return (mix(self_.albedo, vec3(1.0), self_.metallic) * 0.65);
}

SdfShape SdfShape_new(Material material) {
  vec3 _cse0 = vec3(0.0, 0.0, 0.0);
  SdfShape self_ = SdfShape(Material(_cse0, 0.0, 0.0, _cse0));
  self_.material = material;
  return self_;
}

float SDF_SdfSphere_distanceTo(SDF_SdfSphere self_, vec3 point) {
  return (length((point - self_.center)) - self_.radius);
}

vec3 SDF_SdfSphere_normalAt(SDF_SdfSphere self_, vec3 point) {
  vec3 _cse0 = vec3(0.0015, 0.0, 0.0);
  float dx = (SDF_SdfSphere_distanceTo(self_, (point + _cse0)) - SDF_SdfSphere_distanceTo(self_, (point - _cse0)));
  vec3 _cse1 = vec3(0.0, 0.0015, 0.0);
  float dy = (SDF_SdfSphere_distanceTo(self_, (point + _cse1)) - SDF_SdfSphere_distanceTo(self_, (point - _cse1)));
  vec3 _cse2 = vec3(0.0, 0.0, 0.0015);
  float dz = (SDF_SdfSphere_distanceTo(self_, (point + _cse2)) - SDF_SdfSphere_distanceTo(self_, (point - _cse2)));
  return normalize(vec3(dx, dy, dz));
}

float SDF_SdfBox_distanceTo(SDF_SdfBox self_, vec3 point) {
  vec3 local = (abs((point - self_.center)) - self_.halfSize);
  vec3 outside = max(local, vec3(0.0));
  float inside = min(max(local.x, max(local.y, local.z)), 0.0);
  return (length(outside) + inside);
}

vec3 SDF_SdfBox_normalAt(SDF_SdfBox self_, vec3 point) {
  vec3 _cse0 = vec3(0.0015, 0.0, 0.0);
  float dx = (SDF_SdfBox_distanceTo(self_, (point + _cse0)) - SDF_SdfBox_distanceTo(self_, (point - _cse0)));
  vec3 _cse1 = vec3(0.0, 0.0015, 0.0);
  float dy = (SDF_SdfBox_distanceTo(self_, (point + _cse1)) - SDF_SdfBox_distanceTo(self_, (point - _cse1)));
  vec3 _cse2 = vec3(0.0, 0.0, 0.0015);
  float dz = (SDF_SdfBox_distanceTo(self_, (point + _cse2)) - SDF_SdfBox_distanceTo(self_, (point - _cse2)));
  return normalize(vec3(dx, dy, dz));
}

float SDF_SdfTorus_distanceTo(SDF_SdfTorus self_, vec3 point) {
  vec3 local = (point - self_.center);
  float ring = (length(vec2(local.x, local.z)) - self_.majorRadius);
  return (length(vec2(ring, local.y)) - self_.minorRadius);
}

vec3 SDF_SdfTorus_normalAt(SDF_SdfTorus self_, vec3 point) {
  vec3 _cse0 = vec3(0.0015, 0.0, 0.0);
  float dx = (SDF_SdfTorus_distanceTo(self_, (point + _cse0)) - SDF_SdfTorus_distanceTo(self_, (point - _cse0)));
  vec3 _cse1 = vec3(0.0, 0.0015, 0.0);
  float dy = (SDF_SdfTorus_distanceTo(self_, (point + _cse1)) - SDF_SdfTorus_distanceTo(self_, (point - _cse1)));
  vec3 _cse2 = vec3(0.0, 0.0, 0.0015);
  float dz = (SDF_SdfTorus_distanceTo(self_, (point + _cse2)) - SDF_SdfTorus_distanceTo(self_, (point - _cse2)));
  return normalize(vec3(dx, dy, dz));
}

float SDF_SdfPlane_distanceTo(SDF_SdfPlane self_, vec3 point) {
  return (point.y - self_.height);
}

vec3 SDF_SdfPlane_normalAt(SDF_SdfPlane self_, vec3 point) {
  vec3 _cse0 = vec3(0.0015, 0.0, 0.0);
  float dx = (SDF_SdfPlane_distanceTo(self_, (point + _cse0)) - SDF_SdfPlane_distanceTo(self_, (point - _cse0)));
  vec3 _cse1 = vec3(0.0, 0.0015, 0.0);
  float dy = (SDF_SdfPlane_distanceTo(self_, (point + _cse1)) - SDF_SdfPlane_distanceTo(self_, (point - _cse1)));
  vec3 _cse2 = vec3(0.0, 0.0, 0.0015);
  float dz = (SDF_SdfPlane_distanceTo(self_, (point + _cse2)) - SDF_SdfPlane_distanceTo(self_, (point - _cse2)));
  return normalize(vec3(dx, dy, dz));
}

bool Hit_isValid(Hit self_) {
  return (self_.objectIndex >= 0);
}

Hit Hit_new(float distance, int objectIndex) {
  Hit self_ = Hit(0.0, 0);
  self_.distance = distance;
  self_.objectIndex = objectIndex;
  return self_;
}

vec3 PointLight_irradianceAt(PointLight self_, vec3 point) {
  vec3 offset = (self_.position - point);
  float distanceSquared = max(dot(offset, offset), 1.0);
  return (self_.color * (self_.intensity / distanceSquared));
}

PointLight PointLight_new(vec3 position, vec3 color, float intensity) {
  vec3 _cse0 = vec3(0.0, 0.0, 0.0);
  PointLight self_ = PointLight(_cse0, _cse0, 0.0);
  self_.position = position;
  self_.color = color;
  self_.intensity = intensity;
  return self_;
}

Camera Camera_new(vec3 position, vec3 lookAt, float fov) {
  vec3 _cse0 = vec3(0.0, 0.0, 0.0);
  Camera self_ = Camera(_cse0, _cse0, 0.0);
  self_.position = position;
  self_.lookAt = lookAt;
  self_.fov = fov;
  return self_;
}

Hit Scene_sample(Scene self_, vec3 point) {
  float closestDistance = MAX_DISTANCE;
  int closestObjectIndex = -1;
  float sphereDistance = SDF_SdfSphere_distanceTo(self_.redSphere, point);
  if ((sphereDistance < closestDistance)) {
    closestDistance = sphereDistance;
    closestObjectIndex = 0;
  }
  float boxDistance = SDF_SdfBox_distanceTo(self_.blueBox, point);
  if ((boxDistance < closestDistance)) {
    closestDistance = boxDistance;
    closestObjectIndex = 1;
  }
  float torusDistance = SDF_SdfTorus_distanceTo(self_.goldTorus, point);
  if ((torusDistance < closestDistance)) {
    closestDistance = torusDistance;
    closestObjectIndex = 2;
  }
  float groundDistance = SDF_SdfPlane_distanceTo(self_.ground, point);
  if ((groundDistance < closestDistance)) {
    closestDistance = groundDistance;
    closestObjectIndex = 3;
  }
  return Hit_new(closestDistance, closestObjectIndex);
}

Hit Scene_raymarch(Scene self_, Ray ray, float maxDistance) {
  float distance = 0.0;
  int objectIndex = -1;
  for (int step = 0; (step < MAX_STEPS); step = (step + 1)) {
    vec3 point = Ray_at(ray, distance);
    Hit field = Scene_sample(self_, point);
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

vec3 Scene_normalAt(Scene self_, int index, vec3 point) {
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

Hit _flow16_fused(Scene _flow1_input, vec3 _flow2_input, vec3 _flow3_input, float _flow7_input) {
  vec3 _cse0 = vec3(0.0, 0.0, 0.0);
  vec3 _flow17_part = _cse0;
  vec3 _flow18_part = _cse0;
  _flow17_part = _flow2_input;
  _flow18_part = _flow3_input;
  vec3 _flow19_part = _flow17_part;
  vec3 _flow20_part = _flow18_part;
  float _flow8_local = 0.0;
  int _flow9_local = -1;
  for (int _flow10_local = 0; (_flow10_local < MAX_STEPS); _flow10_local = (_flow10_local + 1)) {
    vec3 _flow11_local = Ray_at(Ray(_flow19_part, _flow20_part), _flow8_local);
    Hit _flow23_whole = Scene_sample(_flow1_input, _flow11_local);
    float _flow21_part = _flow23_whole.distance;
    int _flow22_part = _flow23_whole.objectIndex;
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

bool Scene_isVisible(Scene self_, vec3 point, vec3 normal) {
  vec3 toLight = (self_.light.position - point);
  float distanceToLight = length(toLight);
  vec3 lightDirection = normalize(toLight);
  return (Hit_isValid(_flow16_fused(self_, (point + (normal * RAY_EPSILON)), lightDirection, distanceToLight)) == false);
}

Material Scene_materialAt(Scene self_, int index) {
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

SDF_SdfSphere _flow40_fused(vec3 _flow24_input, float _flow25_input, vec3 _flow26_input, float _flow27_input, float _flow28_input, vec3 _flow29_input) {
  vec3 _cse0 = vec3(0.0, 0.0, 0.0);
  vec3 _flow41_part = _cse0;
  float _flow42_part = 0.0;
  float _flow43_part = 0.0;
  vec3 _flow44_part = _cse0;
  _flow41_part = _flow26_input;
  _flow42_part = _flow27_input;
  _flow43_part = _flow28_input;
  _flow44_part = _flow29_input;
  vec3 _flow45_part = _flow41_part;
  float _flow46_part = _flow42_part;
  float _flow47_part = _flow43_part;
  vec3 _flow48_part = _flow44_part;
  SDF_SdfSphere _flow35_local = SDF_SdfSphere(Material(_cse0, 0.0, 0.0, _cse0), _cse0, 0.0);
  SdfShape _flow36_local = SdfShape_new(Material(_flow45_part, _flow46_part, _flow47_part, _flow48_part));
  _flow35_local.material = _flow36_local.material;
  _flow35_local.center = _flow24_input;
  _flow35_local.radius = _flow25_input;
  return _flow35_local;
}

SDF_SdfBox _flow65_fused(vec3 _flow49_input, vec3 _flow50_input, vec3 _flow51_input, float _flow52_input, float _flow53_input, vec3 _flow54_input) {
  vec3 _cse0 = vec3(0.0, 0.0, 0.0);
  vec3 _flow66_part = _cse0;
  float _flow67_part = 0.0;
  float _flow68_part = 0.0;
  vec3 _flow69_part = _cse0;
  _flow66_part = _flow51_input;
  _flow67_part = _flow52_input;
  _flow68_part = _flow53_input;
  _flow69_part = _flow54_input;
  vec3 _flow70_part = _flow66_part;
  float _flow71_part = _flow67_part;
  float _flow72_part = _flow68_part;
  vec3 _flow73_part = _flow69_part;
  SDF_SdfBox _flow60_local = SDF_SdfBox(Material(_cse0, 0.0, 0.0, _cse0), _cse0, _cse0);
  SdfShape _flow61_local = SdfShape_new(Material(_flow70_part, _flow71_part, _flow72_part, _flow73_part));
  _flow60_local.material = _flow61_local.material;
  _flow60_local.center = _flow49_input;
  _flow60_local.halfSize = _flow50_input;
  return _flow60_local;
}

SDF_SdfTorus _flow92_fused(vec3 _flow74_input, float _flow75_input, float _flow76_input, vec3 _flow77_input, float _flow78_input, float _flow79_input, vec3 _flow80_input) {
  vec3 _cse0 = vec3(0.0, 0.0, 0.0);
  vec3 _flow93_part = _cse0;
  float _flow94_part = 0.0;
  float _flow95_part = 0.0;
  vec3 _flow96_part = _cse0;
  _flow93_part = _flow77_input;
  _flow94_part = _flow78_input;
  _flow95_part = _flow79_input;
  _flow96_part = _flow80_input;
  vec3 _flow97_part = _flow93_part;
  float _flow98_part = _flow94_part;
  float _flow99_part = _flow95_part;
  vec3 _flow100_part = _flow96_part;
  SDF_SdfTorus _flow86_local = SDF_SdfTorus(Material(_cse0, 0.0, 0.0, _cse0), _cse0, 0.0, 0.0);
  SdfShape _flow87_local = SdfShape_new(Material(_flow97_part, _flow98_part, _flow99_part, _flow100_part));
  _flow86_local.material = _flow87_local.material;
  _flow86_local.center = _flow74_input;
  _flow86_local.majorRadius = _flow75_input;
  _flow86_local.minorRadius = _flow76_input;
  return _flow86_local;
}

SDF_SdfPlane _flow115_fused(float _flow101_input, vec3 _flow102_input, float _flow103_input, float _flow104_input, vec3 _flow105_input) {
  vec3 _cse0 = vec3(0.0, 0.0, 0.0);
  vec3 _flow116_part = _cse0;
  float _flow117_part = 0.0;
  float _flow118_part = 0.0;
  vec3 _flow119_part = _cse0;
  _flow116_part = _flow102_input;
  _flow117_part = _flow103_input;
  _flow118_part = _flow104_input;
  _flow119_part = _flow105_input;
  vec3 _flow120_part = _flow116_part;
  float _flow121_part = _flow117_part;
  float _flow122_part = _flow118_part;
  vec3 _flow123_part = _flow119_part;
  SDF_SdfPlane _flow111_local = SDF_SdfPlane(Material(_cse0, 0.0, 0.0, _cse0), 0.0);
  SdfShape _flow112_local = SdfShape_new(Material(_flow120_part, _flow121_part, _flow122_part, _flow123_part));
  _flow111_local.material = _flow112_local.material;
  _flow111_local.height = _flow101_input;
  return _flow111_local;
}

Scene Scene_new() {
  vec3 _cse2 = vec3(0.0, 0.0, 0.0);
  Material _cse0 = Material(_cse2, 0.0, 0.0, _cse2);
  Scene self_ = Scene(SDF_SdfSphere(_cse0, _cse2, 0.0), SDF_SdfBox(_cse0, _cse2, _cse2), SDF_SdfTorus(_cse0, _cse2, 0.0, 0.0), SDF_SdfPlane(_cse0, 0.0), PointLight(_cse2, _cse2, 0.0));
  vec3 _cse1 = vec3(0.0);
  self_.redSphere = _flow40_fused(vec3(-1.15, 0.2, -1.7), 1.0, vec3(0.78, 0.12, 0.08), 0.0, 0.4, _cse1);
  self_.blueBox = _flow65_fused(vec3(1.05, 0.25, -2.0), vec3(0.75, 0.75, 0.75), vec3(0.08, 0.3, 0.84), 0.2, 0.3, _cse1);
  self_.goldTorus = _flow92_fused(vec3(0.0, 1.35, -2.9), 0.72, 0.24, vec3(0.95, 0.65, 0.1), 0.9, 0.12, _cse1);
  self_.ground = _flow115_fused(-1.0, vec3(0.68, 0.72, 0.8), 0.0, 0.92, _cse1);
  self_.light = PointLight_new(vec3(-2.5, 4.8, 2.0), vec3(1.0, 0.88, 0.72), 70.0);
  return self_;
}

vec3 Renderer_shade(Renderer self_, Ray ray, vec3 point, vec3 normal, Material material) {
  vec3 viewDirection = (-ray.direction);
  vec3 lightDirection = normalize((self_.scene.light.position - point));
  float visibility = 0.0;
  if (Scene_isVisible(self_.scene, point, normal)) {
    visibility = 1.0;
  }
  return (material.emission + ((visibility * PointLight_irradianceAt(self_.scene.light, point)) * Material_directResponse(material, normal, viewDirection, lightDirection)));
}

vec3 Renderer_sky(Renderer self_, Ray ray) {
  vec3 horizon = vec3(0.12, 0.17, 0.28);
  vec3 zenith = vec3(0.55, 0.72, 0.95);
  float skyFactor = max(ray.direction.y, 0.0);
  return mix(horizon, zenith, skyFactor);
}

Renderer Renderer_new(Scene scene) {
  vec3 _cse1 = vec3(0.0, 0.0, 0.0);
  Material _cse0 = Material(_cse1, 0.0, 0.0, _cse1);
  Renderer self_ = Renderer(Scene(SDF_SdfSphere(_cse0, _cse1, 0.0), SDF_SdfBox(_cse0, _cse1, _cse1), SDF_SdfTorus(_cse0, _cse1, 0.0, 0.0), SDF_SdfPlane(_cse0, 0.0), PointLight(_cse1, _cse1, 0.0)));
  self_.scene = scene;
  return self_;
}

vec3 cosineDirection(vec3 normal, float seed) {
  float r1 = fract((sin(seed) * 43758.5453123));
  float r2 = fract((sin((seed + 17.13)) * 43758.5453123));
  float phi = (6.2831853 * r1);
  float radius = sqrt(r2);
  vec3 tangent = normalize(cross(((abs(normal.x) > 0.9) ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)), normal));
  vec3 bitangent = cross(normal, tangent);
  return normalize((((tangent * (cos(phi) * radius)) + (bitangent * (sin(phi) * radius))) + (normal * sqrt((1.0 - r2)))));
}

vec3 reflectDirection(vec3 direction, vec3 normal) {
  return (direction - (normal * (2.0 * dot(direction, normal))));
}

Camera createCamera(float time) {
  float _cse0 = (time * 0.17);
  return Camera_new(vec3((sin(_cse0) * 6.2), (2.0 + (sin((time * 0.31)) * 0.12)), (cos(_cse0) * 6.2)), vec3(0.0, 0.6, -1.8), 1.0);
}

vec2 pixelJitter(vec2 position, float frame, int sample_) {
  float _cse0 = float(sample_);
  return vec2((fract((sin(((dot(position, vec2(12.9898, 78.233)) + (frame * 0.71)) + (_cse0 * 19.17))) * 43758.5453123)) - 0.5), (fract((sin(((dot(position, vec2(39.346, 11.135)) + (frame * 1.17)) + (_cse0 * 7.91))) * 43758.5453123)) - 0.5));
}

vec3 _flow151_fused(Renderer _flow124_input, Camera _flow125_input, vec2 _flow126_input, float _flow134_input) {
  Scene _licm0 = _flow124_input.scene;
  vec3 _flow152_part = _flow125_input.position;
  vec3 _flow153_part = _flow125_input.lookAt;
  float _flow154_part = _flow125_input.fov;
  vec3 _flow127_local = normalize((_flow153_part - _flow152_part));
  vec3 _flow128_local = normalize(cross(_flow127_local, vec3(0.0, 1.0, 0.0)));
  vec3 _flow129_local = cross(_flow128_local, _flow127_local);
  float _flow130_local = tan((_flow154_part * 0.5));
  vec3 _flow131_local = normalize(((_flow127_local + ((_flow128_local * _flow126_input.x) * _flow130_local)) + ((_flow129_local * _flow126_input.y) * _flow130_local)));
  Ray _flow166_whole = Ray_new(_flow152_part, _flow131_local);
  vec3 _flow155_part = _flow166_whole.origin;
  vec3 _flow156_part = _flow166_whole.direction;
  vec3 _flow157_part = _flow155_part;
  vec3 _flow158_part = _flow156_part;
  vec3 _flow136_local = vec3(1.0);
  vec3 _flow137_local = vec3(0.0);
  float _flow138_local = _flow134_input;
  for (int _flow139_local = 0; (_flow139_local < MAX_BOUNCES); _flow139_local = (_flow139_local + 1)) {
    Ray _gv0 = Ray(_flow157_part, _flow158_part);
    Hit _flow167_whole = Scene_raymarch(_licm0, _gv0, MAX_DISTANCE);
    float _flow159_part = _flow167_whole.distance;
    int _flow160_part = _flow167_whole.objectIndex;
    if ((Hit_isValid(Hit(_flow159_part, _flow160_part)) == false)) {
      _flow137_local += (_flow136_local * Renderer_sky(_flow124_input, _gv0));
      break;
    }
    vec3 _flow141_local = Ray_at(_gv0, _flow159_part);
    vec3 _flow142_local = Scene_normalAt(_licm0, _flow160_part, _flow141_local);
    Material _flow168_whole = Scene_materialAt(_licm0, _flow160_part);
    vec3 _flow161_part = _flow168_whole.albedo;
    float _flow162_part = _flow168_whole.metallic;
    float _flow163_part = _flow168_whole.roughness;
    vec3 _flow164_part = _flow168_whole.emission;
    Material _gv1 = Material(_flow161_part, _flow162_part, _flow163_part, _flow164_part);
    _flow137_local += (_flow136_local * Renderer_shade(_flow124_input, _gv0, _flow141_local, _flow142_local, _gv1));
    _flow138_local = (_flow138_local + 7.13);
    vec3 _flow144_local = cosineDirection(_flow142_local, _flow138_local);
    vec3 _flow145_local = reflectDirection(_flow158_part, _flow142_local);
    float _flow146_local = (_flow162_part + ((1.0 - _flow163_part) * 0.25));
    vec3 _flow147_local = normalize(mix(_flow144_local, _flow145_local, _flow146_local));
    _flow136_local = (_flow136_local * Material_bounceWeight(_gv1));
    Ray _flow169_whole = Ray_new((_flow141_local + (_flow142_local * RAY_EPSILON)), _flow147_local);
    vec3 _flow170_copy = _flow169_whole.origin;
    vec3 _flow171_copy = _flow169_whole.direction;
    _flow157_part = _flow170_copy;
    _flow158_part = _flow171_copy;
  }
  return _flow137_local;
}

vec3 renderSample(Renderer renderer, Camera camera, vec2 ndc, vec2 resolution, float frame, int sample_) {
  vec2 pixel = (((ndc * 0.5) + vec2(0.5)) * resolution);
  vec2 jitter = pixelJitter(pixel, frame, sample_);
  vec2 sampleNdc = (ndc + vec2(((jitter.x * 2.0) / resolution.x), ((jitter.y * 2.0) / resolution.y)));
  float seed = ((dot(pixel, vec2(17.17, 73.19)) + (frame * 11.3)) + (float(sample_) * 3.7));
  return _flow151_fused(renderer, camera, vec2(((sampleNdc.x * resolution.x) / resolution.y), sampleNdc.y), seed);
}

vec3 toneMap(vec3 color) {
  vec3 mapped = (color / (color + vec3(1.0)));
  return pow(mapped, vec3(0.45454545454545453));
}
in vec2 ndc;
layout(location = 0) out vec4 _ret;

void main() {
  vec2 _licm0 = ndc;
  vec2 _licm1 = u.resolution;
  float _licm2 = u.frame;
  Camera camera = createCamera(u.time);
  Scene scene = Scene_new();
  Renderer renderer = Renderer_new(scene);
  vec3 color = vec3(0.0);
  for (int sample_ = 0; (sample_ < SAMPLES_PER_PIXEL); sample_ = (sample_ + 1)) {
    color += renderSample(renderer, camera, _licm0, _licm1, _licm2, sample_);
  }
  color = toneMap((color / float(SAMPLES_PER_PIXEL)));
  _ret = vec4(color, 1.0);
}
