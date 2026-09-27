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

struct SdfSphere {
  vec3 center;
  float radius;
  Material material;
};

struct SdfBox {
  vec3 center;
  vec3 halfSize;
  Material material;
};

struct SdfTorus {
  vec3 center;
  float majorRadius;
  float minorRadius;
  Material material;
};

struct SdfPlane {
  float height;
  Material material;
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
  SdfSphere redSphere;
  SdfBox blueBox;
  SdfTorus goldTorus;
  SdfPlane ground;
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
  vec3 baseReflectance = mix(vec3(0.04, 0.04, 0.04), self_.albedo, self_.metallic);
  vec3 fresnel = (baseReflectance + ((vec3(1.0, 1.0, 1.0) - baseReflectance) * pow((1.0 - max(dot(normal, viewDirection), 0.0)), 5.0)));
  return (diffuse + (fresnel * specular));
}

vec3 Material_bounceWeight(Material self_) {
  return (mix(self_.albedo, vec3(1.0, 1.0, 1.0), self_.metallic) * 0.65);
}

Material Material_new(vec3 albedo, float metallic, float roughness, vec3 emission) {
  vec3 _cse0 = vec3(0.0, 0.0, 0.0);
  Material self_ = Material(_cse0, 0.0, 0.0, _cse0);
  self_.albedo = albedo;
  self_.metallic = metallic;
  self_.roughness = roughness;
  self_.emission = emission;
  return self_;
}

float SdfSphere_distanceTo(SdfSphere self_, vec3 point) {
  return (length((point - self_.center)) - self_.radius);
}

SdfSphere SdfSphere_new(vec3 center, float radius, Material material) {
  vec3 _cse0 = vec3(0.0, 0.0, 0.0);
  SdfSphere self_ = SdfSphere(_cse0, 0.0, Material(_cse0, 0.0, 0.0, _cse0));
  self_.center = center;
  self_.radius = radius;
  self_.material = material;
  return self_;
}

float SdfBox_distanceTo(SdfBox self_, vec3 point) {
  vec3 local = (abs((point - self_.center)) - self_.halfSize);
  vec3 outside = max(local, vec3(0.0, 0.0, 0.0));
  float inside = min(max(local.x, max(local.y, local.z)), 0.0);
  return (length(outside) + inside);
}

SdfBox SdfBox_new(vec3 center, vec3 halfSize, Material material) {
  vec3 _cse0 = vec3(0.0, 0.0, 0.0);
  SdfBox self_ = SdfBox(_cse0, _cse0, Material(_cse0, 0.0, 0.0, _cse0));
  self_.center = center;
  self_.halfSize = halfSize;
  self_.material = material;
  return self_;
}

float SdfTorus_distanceTo(SdfTorus self_, vec3 point) {
  vec3 local = (point - self_.center);
  float ring = (length(vec2(local.x, local.z)) - self_.majorRadius);
  return (length(vec2(ring, local.y)) - self_.minorRadius);
}

SdfTorus SdfTorus_new(vec3 center, float majorRadius, float minorRadius, Material material) {
  vec3 _cse0 = vec3(0.0, 0.0, 0.0);
  SdfTorus self_ = SdfTorus(_cse0, 0.0, 0.0, Material(_cse0, 0.0, 0.0, _cse0));
  self_.center = center;
  self_.majorRadius = majorRadius;
  self_.minorRadius = minorRadius;
  self_.material = material;
  return self_;
}

float SdfPlane_distanceTo(SdfPlane self_, vec3 point) {
  return (point.y - self_.height);
}

SdfPlane SdfPlane_new(float height, Material material) {
  vec3 _cse0 = vec3(0.0, 0.0, 0.0);
  SdfPlane self_ = SdfPlane(0.0, Material(_cse0, 0.0, 0.0, _cse0));
  self_.height = height;
  self_.material = material;
  return self_;
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

Ray Camera_rayFor(Camera self_, vec2 ndc) {
  vec3 forward = normalize((self_.lookAt - self_.position));
  vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, forward);
  float scale = tan((self_.fov * 0.5));
  vec3 direction = normalize(((forward + ((right * ndc.x) * scale)) + ((up * ndc.y) * scale)));
  return Ray_new(self_.position, direction);
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
  float sphereDistance = SdfSphere_distanceTo(self_.redSphere, point);
  if ((sphereDistance < closestDistance)) {
    closestDistance = sphereDistance;
    closestObjectIndex = 0;
  }
  float boxDistance = SdfBox_distanceTo(self_.blueBox, point);
  if ((boxDistance < closestDistance)) {
    closestDistance = boxDistance;
    closestObjectIndex = 1;
  }
  float torusDistance = SdfTorus_distanceTo(self_.goldTorus, point);
  if ((torusDistance < closestDistance)) {
    closestDistance = torusDistance;
    closestObjectIndex = 2;
  }
  float groundDistance = SdfPlane_distanceTo(self_.ground, point);
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

vec3 Scene_normalAt(Scene self_, vec3 point) {
  vec3 _cse0 = vec3(0.0015, 0.0, 0.0);
  float dx = (Scene_sample(self_, (point + _cse0)).distance - Scene_sample(self_, (point - _cse0)).distance);
  vec3 _cse1 = vec3(0.0, 0.0015, 0.0);
  float dy = (Scene_sample(self_, (point + _cse1)).distance - Scene_sample(self_, (point - _cse1)).distance);
  vec3 _cse2 = vec3(0.0, 0.0, 0.0015);
  float dz = (Scene_sample(self_, (point + _cse2)).distance - Scene_sample(self_, (point - _cse2)).distance);
  return normalize(vec3(dx, dy, dz));
}

bool Scene_isVisible(Scene self_, vec3 point, vec3 normal) {
  vec3 toLight = (self_.light.position - point);
  float distanceToLight = length(toLight);
  vec3 lightDirection = normalize(toLight);
  Ray shadowRay = Ray_new((point + (normal * RAY_EPSILON)), lightDirection);
  Hit shadowHit = Scene_raymarch(self_, shadowRay, distanceToLight);
  return (Hit_isValid(shadowHit) == false);
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

Scene Scene_new() {
  vec3 _cse1 = vec3(0.0, 0.0, 0.0);
  Material _cse0 = Material(_cse1, 0.0, 0.0, _cse1);
  Scene self_ = Scene(SdfSphere(_cse1, 0.0, _cse0), SdfBox(_cse1, _cse1, _cse0), SdfTorus(_cse1, 0.0, 0.0, _cse0), SdfPlane(0.0, _cse0), PointLight(_cse1, _cse1, 0.0));
  self_.redSphere = SdfSphere_new(vec3(-1.15, 0.2, -1.7), 1.0, Material_new(vec3(0.78, 0.12, 0.08), 0.0, 0.4, _cse1));
  self_.blueBox = SdfBox_new(vec3(1.05, 0.25, -2.0), vec3(0.75, 0.75, 0.75), Material_new(vec3(0.08, 0.3, 0.84), 0.2, 0.3, _cse1));
  self_.goldTorus = SdfTorus_new(vec3(0.0, 1.35, -2.9), 0.72, 0.24, Material_new(vec3(0.95, 0.65, 0.1), 0.9, 0.12, _cse1));
  self_.ground = SdfPlane_new(-1.0, Material_new(vec3(0.68, 0.72, 0.8), 0.0, 0.92, _cse1));
  self_.light = PointLight_new(vec3(-2.5, 4.8, 2.0), vec3(1.0, 0.88, 0.72), 70.0);
  return self_;
}

vec3 Renderer_sky(Renderer self_, Ray ray) {
  vec3 horizon = vec3(0.12, 0.17, 0.28);
  vec3 zenith = vec3(0.55, 0.72, 0.95);
  float skyFactor = max(ray.direction.y, 0.0);
  return mix(horizon, zenith, skyFactor);
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

vec3 Renderer_trace(Renderer self_, Ray primaryRay, float seed0) {
  Scene _licm0 = self_.scene;
  Ray ray = primaryRay;
  vec3 throughput = vec3(1.0, 1.0, 1.0);
  vec3 radiance = vec3(0.0, 0.0, 0.0);
  float seed = seed0;
  for (int bounce = 0; (bounce < MAX_BOUNCES); bounce = (bounce + 1)) {
    Hit hit = Scene_raymarch(_licm0, ray, MAX_DISTANCE);
    if ((Hit_isValid(hit) == false)) {
      radiance += (throughput * Renderer_sky(self_, ray));
      break;
    }
    vec3 point = Ray_at(ray, hit.distance);
    vec3 normal = Scene_normalAt(_licm0, point);
    Material material = Scene_materialAt(_licm0, hit.objectIndex);
    radiance += (throughput * Renderer_shade(self_, ray, point, normal, material));
    seed = (seed + 7.13);
    vec3 diffuseDirection = cosineDirection(normal, seed);
    vec3 reflectedDirection = reflectDirection(ray.direction, normal);
    float bounceAmount = (material.metallic + ((1.0 - material.roughness) * 0.25));
    vec3 nextDirection = normalize(mix(diffuseDirection, reflectedDirection, bounceAmount));
    throughput = (throughput * Material_bounceWeight(material));
    ray = Ray_new((point + (normal * RAY_EPSILON)), nextDirection);
  }
  return radiance;
}

Renderer Renderer_new(Scene scene) {
  vec3 _cse1 = vec3(0.0, 0.0, 0.0);
  Material _cse0 = Material(_cse1, 0.0, 0.0, _cse1);
  Renderer self_ = Renderer(Scene(SdfSphere(_cse1, 0.0, _cse0), SdfBox(_cse1, _cse1, _cse0), SdfTorus(_cse1, 0.0, 0.0, _cse0), SdfPlane(0.0, _cse0), PointLight(_cse1, _cse1, 0.0)));
  self_.scene = scene;
  return self_;
}

Camera createCamera(float time) {
  float _cse0 = (time * 0.17);
  return Camera_new(vec3((sin(_cse0) * 6.2), (2.0 + (sin((time * 0.31)) * 0.12)), (cos(_cse0) * 6.2)), vec3(0.0, 0.6, -1.8), 1.0);
}

vec2 pixelJitter(vec2 position, float frame, int sample_) {
  float _cse0 = float(sample_);
  return vec2((fract((sin(((dot(position, vec2(12.9898, 78.233)) + (frame * 0.71)) + (_cse0 * 19.17))) * 43758.5453123)) - 0.5), (fract((sin(((dot(position, vec2(39.346, 11.135)) + (frame * 1.17)) + (_cse0 * 7.91))) * 43758.5453123)) - 0.5));
}

vec3 renderSample(Renderer renderer, Camera camera, vec2 position, vec2 resolution, float frame, int sample_) {
  vec2 uv = (((position - (resolution * 0.5)) + vec2(0.5, 0.5)) / resolution.y);
  vec2 jitter = pixelJitter(position, frame, sample_);
  vec2 sampleUv = vec2((uv.x + (jitter.x / resolution.x)), (uv.y + (jitter.y / resolution.y)));
  Ray ray = Camera_rayFor(camera, (sampleUv * vec2((resolution.x / resolution.y), 1.0)));
  float seed = ((dot(position, vec2(17.17, 73.19)) + (frame * 11.3)) + (float(sample_) * 3.7));
  return Renderer_trace(renderer, ray, seed);
}

vec3 toneMap(vec3 color) {
  vec3 mapped = (color / (color + vec3(1.0, 1.0, 1.0)));
  return pow(mapped, vec3(0.45454545454545453, 0.45454545454545453, 0.45454545454545453));
}
layout(location = 0) out vec4 _ret;

void main() {
  vec2 _licm0 = gl_FragCoord.xy;
  vec2 _licm1 = u.resolution;
  float _licm2 = u.frame;
  Camera camera = createCamera(u.time);
  Renderer renderer = Renderer_new(Scene_new());
  vec3 color = vec3(0.0, 0.0, 0.0);
  for (int sample_ = 0; (sample_ < SAMPLES_PER_PIXEL); sample_ = (sample_ + 1)) {
    color += renderSample(renderer, camera, _licm0, _licm1, _licm2, sample_);
  }
  color = toneMap((color / float(SAMPLES_PER_PIXEL)));
  _ret = vec4(color, 1.0);
}
