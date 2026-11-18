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
Ray Ray_new(vec3 origin, vec3 direction) {
  vec3 _cse0 = vec3(0.0, 0.0, 0.0);
  Ray self_ = Ray(_cse0, _cse0);
  self_.origin = origin;
  self_.direction = direction;
  return self_;
}

float SDF_SdfSphere_distanceTo(SDF_SdfSphere self_, vec3 point) {
  return (length((point - self_.center)) - self_.radius);
}

float SDF_SdfBox_distanceTo(SDF_SdfBox self_, vec3 point) {
  vec3 local = (abs((point - self_.center)) - self_.halfSize);
  vec3 outside = max(local, vec3(0.0));
  float inside = min(max(local.x, max(local.y, local.z)), 0.0);
  return (length(outside) + inside);
}

float SDF_SdfTorus_distanceTo(SDF_SdfTorus self_, vec3 point) {
  vec3 local = (point - self_.center);
  float ring = (length(vec2(local.x, local.z)) - self_.majorRadius);
  return (length(vec2(ring, local.y)) - self_.minorRadius);
}

Hit Hit_new(float distance, int objectIndex) {
  Hit self_ = Hit(0.0, 0);
  self_.distance = distance;
  self_.objectIndex = objectIndex;
  return self_;
}

Hit Scene_raymarch(Scene self_, Ray ray, float maxDistance) {
  vec3 _licm0 = ray.origin;
  vec3 _licm1 = ray.direction;
  SDF_SdfSphere _licm2 = self_.redSphere;
  SDF_SdfBox _licm3 = self_.blueBox;
  SDF_SdfTorus _licm4 = self_.goldTorus;
  float _licm5 = self_.ground.height;
  float distance = 0.0;
  int objectIndex = -1;
  for (int step = 0; (step < MAX_STEPS); step = (step + 1)) {
    vec3 point = (_licm0 + (_licm1 * distance));
    float _i13_closestDistance = MAX_DISTANCE;
    int _i13_closestObjectIndex = -1;
    float _i13_sphereDistance = SDF_SdfSphere_distanceTo(_licm2, point);
    bool _ifc0 = (_i13_sphereDistance < _i13_closestDistance);
    _i13_closestDistance = (_ifc0 ? _i13_sphereDistance : _i13_closestDistance);
    _i13_closestObjectIndex = (_ifc0 ? 0 : _i13_closestObjectIndex);
    float _i13_boxDistance = SDF_SdfBox_distanceTo(_licm3, point);
    bool _ifc1 = (_i13_boxDistance < _i13_closestDistance);
    _i13_closestDistance = (_ifc1 ? _i13_boxDistance : _i13_closestDistance);
    _i13_closestObjectIndex = (_ifc1 ? 1 : _i13_closestObjectIndex);
    float _i13_torusDistance = SDF_SdfTorus_distanceTo(_licm4, point);
    bool _ifc2 = (_i13_torusDistance < _i13_closestDistance);
    _i13_closestDistance = (_ifc2 ? _i13_torusDistance : _i13_closestDistance);
    _i13_closestObjectIndex = (_ifc2 ? 2 : _i13_closestObjectIndex);
    float _i13_groundDistance = (point.y - _licm5);
    bool _ifc3 = (_i13_groundDistance < _i13_closestDistance);
    _i13_closestDistance = (_ifc3 ? _i13_groundDistance : _i13_closestDistance);
    _i13_closestObjectIndex = (_ifc3 ? 3 : _i13_closestObjectIndex);
    Hit _i13ret = Hit_new(_i13_closestDistance, _i13_closestObjectIndex);
    if ((_i13ret.distance < SURFACE_EPSILON)) {
      objectIndex = _i13ret.objectIndex;
      return Hit_new(distance, objectIndex);
    }
    distance = (distance + _i13ret.distance);
    if ((distance > maxDistance)) {
      break;
    }
  }
  return Hit_new(-1.0, objectIndex);
}

Hit _flow22_fused(Scene _flow0_input, vec3 _flow1_input, vec3 _flow2_input, float _flow6_input) {
  SDF_SdfSphere _licm0 = _flow0_input.redSphere;
  SDF_SdfBox _licm1 = _flow0_input.blueBox;
  SDF_SdfTorus _licm2 = _flow0_input.goldTorus;
  float _licm3 = _flow0_input.ground.height;
  vec3 _cse0 = vec3(0.0, 0.0, 0.0);
  vec3 _flow23_part = _cse0;
  vec3 _flow24_part = _cse0;
  _flow23_part = _flow1_input;
  _flow24_part = _flow2_input;
  vec3 _flow25_part = _flow23_part;
  vec3 _flow26_part = _flow24_part;
  float _flow7_local = 0.0;
  int _flow8_local = -1;
  for (int _flow9_local = 0; (_flow9_local < MAX_STEPS); _flow9_local = (_flow9_local + 1)) {
    vec3 _flow10_local = (_flow25_part + (_flow26_part * _flow7_local));
    float _flow11_local = MAX_DISTANCE;
    int _flow12_local = -1;
    float _flow13_local = SDF_SdfSphere_distanceTo(_licm0, _flow10_local);
    bool _ifc0 = (_flow13_local < _flow11_local);
    _flow11_local = (_ifc0 ? _flow13_local : _flow11_local);
    _flow12_local = (_ifc0 ? 0 : _flow12_local);
    float _flow14_local = SDF_SdfBox_distanceTo(_licm1, _flow10_local);
    bool _ifc1 = (_flow14_local < _flow11_local);
    _flow11_local = (_ifc1 ? _flow14_local : _flow11_local);
    _flow12_local = (_ifc1 ? 1 : _flow12_local);
    float _flow15_local = SDF_SdfTorus_distanceTo(_licm2, _flow10_local);
    bool _ifc2 = (_flow15_local < _flow11_local);
    _flow11_local = (_ifc2 ? _flow15_local : _flow11_local);
    _flow12_local = (_ifc2 ? 2 : _flow12_local);
    float _flow16_local = (_flow10_local.y - _licm3);
    bool _ifc3 = (_flow16_local < _flow11_local);
    _flow11_local = (_ifc3 ? _flow16_local : _flow11_local);
    _flow12_local = (_ifc3 ? 3 : _flow12_local);
    Hit _flow31_whole = Hit_new(_flow11_local, _flow12_local);
    float _flow27_part = _flow31_whole.distance;
    int _flow28_part = _flow31_whole.objectIndex;
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

vec3 Renderer_trace(Renderer self_, Ray primaryRay, float seed0) {
  Scene _licm0 = self_.scene;
  vec3 _licm1 = vec3(0.12, 0.17, 0.28);
  vec3 _licm2 = vec3(0.55, 0.72, 0.95);
  vec3 _licm3 = self_.scene.light.position;
  vec3 _licm4 = vec3(0.04);
  PointLight _licm5 = self_.scene.light;
  vec3 _licm6 = vec3(0.0, 1.0, 0.0);
  vec3 _licm7 = vec3(1.0, 0.0, 0.0);
  Ray ray = primaryRay;
  vec3 _cse0 = vec3(1.0);
  vec3 throughput = _cse0;
  vec3 radiance = vec3(0.0);
  float seed = seed0;
  vec3 _cse1 = vec3(0.0015, 0.0, 0.0);
  vec3 _cse2 = vec3(0.0, 0.0015, 0.0);
  vec3 _cse3 = vec3(0.0, 0.0, 0.0015);
  for (int bounce = 0; (bounce < MAX_BOUNCES); bounce = (bounce + 1)) {
    Hit hit = Scene_raymarch(_licm0, ray, MAX_DISTANCE);
    if (((hit.objectIndex >= 0) == false)) {
      float _i19_skyFactor = max(ray.direction.y, 0.0);
      vec3 _i19ret = mix(_licm1, _licm2, _i19_skyFactor);
      radiance += (throughput * _i19ret);
      break;
    }
    vec3 point = (ray.origin + (ray.direction * hit.distance));
    int _i14a1 = hit.objectIndex;
    vec3 _i14ret = vec3(0.0);
    if ((_i14a1 == 0)) {
      SDF_SdfSphere _i14_a0 = _licm0.redSphere;
      float _i14_dx = (SDF_SdfSphere_distanceTo(_i14_a0, (point + _cse1)) - SDF_SdfSphere_distanceTo(_i14_a0, (point - _cse1)));
      float _i14_dy = (SDF_SdfSphere_distanceTo(_i14_a0, (point + _cse2)) - SDF_SdfSphere_distanceTo(_i14_a0, (point - _cse2)));
      float _i14_dz = (SDF_SdfSphere_distanceTo(_i14_a0, (point + _cse3)) - SDF_SdfSphere_distanceTo(_i14_a0, (point - _cse3)));
      vec3 _i14_ret = normalize(vec3(_i14_dx, _i14_dy, _i14_dz));
      _i14ret = _i14_ret;
    } else {
      if ((_i14a1 == 1)) {
        SDF_SdfBox _i14_a0_ = _licm0.blueBox;
        float _i14_dx_ = (SDF_SdfBox_distanceTo(_i14_a0_, (point + _cse1)) - SDF_SdfBox_distanceTo(_i14_a0_, (point - _cse1)));
        float _i14_dy_ = (SDF_SdfBox_distanceTo(_i14_a0_, (point + _cse2)) - SDF_SdfBox_distanceTo(_i14_a0_, (point - _cse2)));
        float _i14_dz_ = (SDF_SdfBox_distanceTo(_i14_a0_, (point + _cse3)) - SDF_SdfBox_distanceTo(_i14_a0_, (point - _cse3)));
        vec3 _i14_ret_ = normalize(vec3(_i14_dx_, _i14_dy_, _i14_dz_));
        _i14ret = _i14_ret_;
      } else {
        if ((_i14a1 == 2)) {
          SDF_SdfTorus _i14_a0_1 = _licm0.goldTorus;
          float _i14_dx_1 = (SDF_SdfTorus_distanceTo(_i14_a0_1, (point + _cse1)) - SDF_SdfTorus_distanceTo(_i14_a0_1, (point - _cse1)));
          float _i14_dy_1 = (SDF_SdfTorus_distanceTo(_i14_a0_1, (point + _cse2)) - SDF_SdfTorus_distanceTo(_i14_a0_1, (point - _cse2)));
          float _i14_dz_1 = (SDF_SdfTorus_distanceTo(_i14_a0_1, (point + _cse3)) - SDF_SdfTorus_distanceTo(_i14_a0_1, (point - _cse3)));
          vec3 _i14_ret_1 = normalize(vec3(_i14_dx_1, _i14_dy_1, _i14_dz_1));
          _i14ret = _i14_ret_1;
        } else {
          SDF_SdfPlane _i14_a0_2 = _licm0.ground;
          float _i14_dx_2 = (((point + _cse1).y - _i14_a0_2.height) - ((point - _cse1).y - _i14_a0_2.height));
          float _i14_dy_2 = (((point + _cse2).y - _i14_a0_2.height) - ((point - _cse2).y - _i14_a0_2.height));
          float _i14_dz_2 = (((point + _cse3).y - _i14_a0_2.height) - ((point - _cse3).y - _i14_a0_2.height));
          vec3 _i14_ret_2 = normalize(vec3(_i14_dx_2, _i14_dy_2, _i14_dz_2));
          _i14ret = _i14_ret_2;
        }
      }
    }
    vec3 normal = _i14ret;
    int _i16a1 = hit.objectIndex;
    Material _i16ret = Material(vec3(0.0), 0.0, 0.0, vec3(0.0));
    if ((_i16a1 == 0)) {
      _i16ret = _licm0.redSphere.material;
    } else {
      if ((_i16a1 == 1)) {
        _i16ret = _licm0.blueBox.material;
      } else {
        if ((_i16a1 == 2)) {
          _i16ret = _licm0.goldTorus.material;
        } else {
          _i16ret = _licm0.ground.material;
        }
      }
    }
    Material material = _i16ret;
    vec3 _i18_viewDirection = (-ray.direction);
    vec3 _i18_lightDirection = normalize((_licm3 - point));
    float _i18_visibility = 0.0;
    vec3 _i18_toLight = (_licm0.light.position - point);
    float _i18_distanceToLight = length(_i18_toLight);
    vec3 _i18_lightDirection_ = normalize(_i18_toLight);
    vec3 _gv0 = (point + (normal * RAY_EPSILON));
    bool _i18_ret = ((_flow22_fused(_licm0, _gv0, _i18_lightDirection_, _i18_distanceToLight).objectIndex >= 0) == false);
    _i18_visibility = (_i18_ret ? 1.0 : _i18_visibility);
    float _i18_ndl = max(dot(normal, _i18_lightDirection), 0.0);
    vec3 _i18_diffuse = ((material.albedo * (1.0 - material.metallic)) * _i18_ndl);
    vec3 _i18_halfDirection = normalize((_i18_lightDirection + _i18_viewDirection));
    float _gv1 = (1.0 - material.roughness);
    float _i18_shininess = mix(16.0, 128.0, _gv1);
    float _i18_specular = pow(max(dot(normal, _i18_halfDirection), 0.0), _i18_shininess);
    vec3 _i18_baseReflectance = mix(_licm4, material.albedo, material.metallic);
    vec3 _i18_fresnel = (_i18_baseReflectance + ((_cse0 - _i18_baseReflectance) * pow((1.0 - max(dot(normal, _i18_viewDirection), 0.0)), 5.0)));
    vec3 _i18_ret_ = (_i18_diffuse + (_i18_fresnel * _i18_specular));
    vec3 _i18_offset = (_licm5.position - point);
    float _i18_distanceSquared = max(dot(_i18_offset, _i18_offset), 1.0);
    vec3 _i18_ret_1 = (_licm5.color * (_licm5.intensity / _i18_distanceSquared));
    vec3 _i18ret = (material.emission + ((_i18_visibility * _i18_ret_1) * _i18_ret_));
    radiance += (throughput * _i18ret);
    seed = (seed + 7.13);
    float _i21_r1 = fract((sin(seed) * 43758.5453123));
    float _i21_r2 = fract((sin((seed + 17.13)) * 43758.5453123));
    float _i21_phi = (6.2831853 * _i21_r1);
    float _i21_radius = sqrt(_i21_r2);
    vec3 _i21_tangent = normalize(cross(((abs(normal.x) > 0.9) ? _licm6 : _licm7), normal));
    vec3 _i21_bitangent = cross(normal, _i21_tangent);
    vec3 _i21ret = normalize((((_i21_tangent * (cos(_i21_phi) * _i21_radius)) + (_i21_bitangent * (sin(_i21_phi) * _i21_radius))) + (normal * sqrt((1.0 - _i21_r2)))));
    vec3 _i22a0 = ray.direction;
    vec3 reflectedDirection = (_i22a0 - (normal * (2.0 * dot(_i22a0, normal))));
    float bounceAmount = (material.metallic + (_gv1 * 0.25));
    vec3 nextDirection = normalize(mix(_i21ret, reflectedDirection, bounceAmount));
    throughput = (throughput * (mix(material.albedo, _cse0, material.metallic) * 0.65));
    ray = Ray_new(_gv0, nextDirection);
  }
  return radiance;
}

SdfShape _flow43_fused(vec3 _flow32_input, float _flow33_input, float _flow34_input, vec3 _flow35_input) {
  vec3 _cse0 = vec3(0.0, 0.0, 0.0);
  vec3 _flow44_part = _cse0;
  float _flow45_part = 0.0;
  float _flow46_part = 0.0;
  vec3 _flow47_part = _cse0;
  _flow44_part = _flow32_input;
  _flow45_part = _flow33_input;
  _flow46_part = _flow34_input;
  _flow47_part = _flow35_input;
  vec3 _flow48_part = _flow44_part;
  float _flow49_part = _flow45_part;
  float _flow50_part = _flow46_part;
  vec3 _flow51_part = _flow47_part;
  SdfShape _flow41_local = SdfShape(Material(_cse0, 0.0, 0.0, _cse0));
  _flow41_local.material = Material(_flow48_part, _flow49_part, _flow50_part, _flow51_part);
  return _flow41_local;
}
in vec2 ndc;
layout(location = 0) out vec4 _ret;

void main() {
  vec2 _licm0 = ndc;
  vec2 _licm1 = u.resolution;
  float _licm2 = u.frame;
  vec2 _licm3 = vec2(0.5);
  vec2 _licm4 = vec2(12.9898, 78.233);
  vec2 _licm5 = vec2(39.346, 11.135);
  vec3 _licm6 = vec3(0.0, 1.0, 0.0);
  vec2 _licm7 = vec2(17.17, 73.19);
  float _i23a0 = u.time;
  float _lc0 = (_i23a0 * 0.17);
  vec3 _i23_a0 = vec3((sin(_lc0) * 6.2), (2.0 + (sin((_i23a0 * 0.31)) * 0.12)), (cos(_lc0) * 6.2));
  vec3 _i23_a1 = vec3(0.0, 0.6, -1.8);
  vec3 _cse8 = vec3(0.0, 0.0, 0.0);
  Camera _i23_self_ = Camera(_cse8, _cse8, 0.0);
  _i23_self_.position = _i23_a0;
  _i23_self_.lookAt = _i23_a1;
  _i23_self_.fov = 1.0;
  Camera camera = _i23_self_;
  Material _cse7 = Material(_cse8, 0.0, 0.0, _cse8);
  SDF_SdfSphere _cse2 = SDF_SdfSphere(_cse7, _cse8, 0.0);
  SDF_SdfBox _cse3 = SDF_SdfBox(_cse7, _cse8, _cse8);
  SDF_SdfTorus _cse4 = SDF_SdfTorus(_cse7, _cse8, 0.0, 0.0);
  SDF_SdfPlane _cse5 = SDF_SdfPlane(_cse7, 0.0);
  PointLight _cse6 = PointLight(_cse8, _cse8, 0.0);
  Scene _cse0 = Scene(_cse2, _cse3, _cse4, _cse5, _cse6);
  Scene _i17_self_ = _cse0;
  vec3 _i17_a0 = vec3(-1.15, 0.2, -1.7);
  SDF_SdfSphere _i17_self_1 = _cse2;
  vec3 _cse1 = vec3(0.0);
  _i17_self_1.material = _flow43_fused(vec3(0.78, 0.12, 0.08), 0.0, 0.4, _cse1).material;
  _i17_self_1.center = _i17_a0;
  _i17_self_1.radius = 1.0;
  _i17_self_.redSphere = _i17_self_1;
  vec3 _i17_a0_ = vec3(1.05, 0.25, -2.0);
  vec3 _i17_a1 = vec3(0.75, 0.75, 0.75);
  SDF_SdfBox _i17_self_2 = _cse3;
  _i17_self_2.material = _flow43_fused(vec3(0.08, 0.3, 0.84), 0.2, 0.3, _cse1).material;
  _i17_self_2.center = _i17_a0_;
  _i17_self_2.halfSize = _i17_a1;
  _i17_self_.blueBox = _i17_self_2;
  vec3 _i17_a0_1 = vec3(0.0, 1.35, -2.9);
  SDF_SdfTorus _i17_self_3 = _cse4;
  _i17_self_3.material = _flow43_fused(vec3(0.95, 0.65, 0.1), 0.9, 0.12, _cse1).material;
  _i17_self_3.center = _i17_a0_1;
  _i17_self_3.majorRadius = 0.72;
  _i17_self_3.minorRadius = 0.24;
  _i17_self_.goldTorus = _i17_self_3;
  SDF_SdfPlane _i17_self_4 = _cse5;
  _i17_self_4.material = _flow43_fused(vec3(0.68, 0.72, 0.8), 0.0, 0.92, _cse1).material;
  _i17_self_4.height = -1.0;
  _i17_self_.ground = _i17_self_4;
  vec3 _i17_a0_2 = vec3(-2.5, 4.8, 2.0);
  vec3 _i17_a1_ = vec3(1.0, 0.88, 0.72);
  PointLight _i17_self_5 = _cse6;
  _i17_self_5.position = _i17_a0_2;
  _i17_self_5.color = _i17_a1_;
  _i17_self_5.intensity = 70.0;
  _i17_self_.light = _i17_self_5;
  Scene scene = _i17_self_;
  Renderer _i20_self_ = Renderer(_cse0);
  _i20_self_.scene = scene;
  Renderer renderer = _i20_self_;
  vec3 color = _cse1;
  for (int sample_ = 0; (sample_ < SAMPLES_PER_PIXEL); sample_ = (sample_ + 1)) {
    vec2 _i24_pixel = (((_licm0 * 0.5) + _licm3) * _licm1);
    float _gv0 = float(sample_);
    vec2 _i24_jitter = vec2((fract((sin(((dot(_i24_pixel, _licm4) + (_licm2 * 0.71)) + (_gv0 * 19.17))) * 43758.5453123)) - 0.5), (fract((sin(((dot(_i24_pixel, _licm5) + (_licm2 * 1.17)) + (_gv0 * 7.91))) * 43758.5453123)) - 0.5));
    vec2 _i24_sampleNdc = (_licm0 + vec2(((_i24_jitter.x * 2.0) / _licm1.x), ((_i24_jitter.y * 2.0) / _licm1.y)));
    float _gv1 = ((_i24_sampleNdc.x * _licm1.x) / _licm1.y);
    vec3 _i24_forward = normalize((camera.lookAt - camera.position));
    vec3 _i24_right = normalize(cross(_i24_forward, _licm6));
    vec3 _i24_up = cross(_i24_right, _i24_forward);
    float _i24_scale = tan((camera.fov * 0.5));
    vec3 _i24_direction = normalize(((_i24_forward + ((_i24_right * _gv1) * _i24_scale)) + ((_i24_up * _i24_sampleNdc.y) * _i24_scale)));
    Ray _i24_ret = Ray_new(camera.position, _i24_direction);
    float _i24_seed = ((dot(_i24_pixel, _licm7) + (_licm2 * 11.3)) + (_gv0 * 3.7));
    vec3 _i24ret = Renderer_trace(renderer, _i24_ret, _i24_seed);
    color += _i24ret;
  }
  vec3 _i25a0 = (color / float(SAMPLES_PER_PIXEL));
  vec3 _i25_mapped = (_i25a0 / (_i25a0 + vec3(1.0)));
  vec3 _i25ret = pow(_i25_mapped, vec3(0.45454545454545453));
  color = _i25ret;
  _ret = vec4(color, 1.0);
}
