#version 300 es
precision highp float;
precision highp int;

struct Sphere {
  vec3 center;
  float radius;
  vec3 albedo;
  vec3 emission;
};
const Sphere[4] SPHERES = Sphere[4](Sphere(vec3(0.0, (-100.5), (-1.0)), 100.0, vec3(0.8, 0.8, 0.8), vec3(0.0, 0.0, 0.0)), Sphere(vec3(0.0, 0.0, (-1.0)), 0.5, vec3(0.7, 0.3, 0.3), vec3(0.0, 0.0, 0.0)), Sphere(vec3((-1.0), 0.0, (-1.0)), 0.5, vec3(0.3, 0.7, 0.3), vec3(0.0, 0.0, 0.0)), Sphere(vec3(0.0, 2.0, (-1.0)), 0.7, vec3(0.0, 0.0, 0.0), vec3(6.0, 5.0, 4.0)));
layout(std140) uniform Frame {
  vec2 resolution;
  float frame;
  vec3 camPos;
} u;
float hitSphere(Sphere s, vec3 ro, vec3 rd) {
  vec3 oc = (ro - s.center);
  float b = dot(oc, rd);
  float c = (dot(oc, oc) - (s.radius * s.radius));
  float h = ((b * b) - c);
  if ((h < 0.0)) {
    return -1.0;
  }
  return ((-b) - sqrt(h));
}

vec3 cosineDir(vec3 n, float seed) {
  float r1 = fract((sin(seed) * 43758.5453123));
  float r2 = fract((sin((seed + 17.13)) * 43758.5453123));
  float phi = (6.2831853 * r1);
  float r = sqrt(r2);
  vec3 t = normalize(cross(((abs(n.x) > 0.9) ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)), n));
  vec3 b = cross(n, t);
  return normalize((((t * (cos(phi) * r)) + (b * (sin(phi) * r))) + (n * sqrt((1.0 - r2)))));
}

vec3 trace(vec3 ro0, vec3 rd0, float seed0) {
  vec3 _licm0 = vec3(0.05, 0.07, 0.1);
  vec3 ro = ro0;
  vec3 rd = rd0;
  float seed = seed0;
  vec3 throughput = vec3(1.0, 1.0, 1.0);
  vec3 radiance = vec3(0.0, 0.0, 0.0);
  for (int bounce = 0; (bounce < 8); bounce = (bounce + 1)) {
    float tMin = 1e+30;
    int hit = -1;
    for (int i = 0; (i < 4); i = (i + 1)) {
      float t = hitSphere(SPHERES[i], ro, rd);
      if (((t > 0.001) && (t < tMin))) {
        tMin = t;
        hit = i;
      }
    }
    if ((hit < 0)) {
      radiance += (throughput * _licm0);
      break;
    }
    Sphere s = SPHERES[hit];
    vec3 p = (ro + (rd * tMin));
    vec3 n = normalize((p - s.center));
    radiance += (throughput * s.emission);
    throughput = (throughput * s.albedo);
    ro = (p + (n * 0.001));
    seed = (seed + 1.618);
    rd = cosineDir(n, seed);
  }
  return radiance;
}
layout(location = 0) out vec4 _ret;

void main() {
  vec4 pos = gl_FragCoord;
  vec3 _licm0 = u.camPos;
  float _licm1 = (dot(pos.xy, vec2(12.9898, 78.233)) + (u.frame * 7.31));
  vec2 uv = ((pos.xy - (u.resolution * 0.5)) / u.resolution.y);
  vec3 rd = normalize(vec3(uv.x, (-uv.y), -1.0));
  vec3 color = vec3(0.0, 0.0, 0.0);
  for (int s = 0; (s < 16); s = (s + 1)) {
    color += trace(_licm0, rd, (_licm1 + (float(s) * 3.7)));
  }
  vec3 c = (color * 0.0625);
  _ret = vec4(pow((c / (c + 1.0)), vec3(0.45454545454545453, 0.45454545454545453, 0.45454545454545453)), 1.0);
}
