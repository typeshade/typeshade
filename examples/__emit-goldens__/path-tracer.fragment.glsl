#version 300 es
precision highp float;
precision highp int;

struct Sphere {
  vec3 center;
  float radius;
  vec3 albedo;
  vec3 emission;
};
const Sphere[4] SPHERES = Sphere[4](Sphere(vec3(0.0, (-100.5), (-1.0)), 100.0, vec3(0.8, 0.8, 0.8), vec3(0.0)), Sphere(vec3(0.0, 0.0, (-1.0)), 0.5, vec3(0.7, 0.3, 0.3), vec3(0.0)), Sphere(vec3((-1.0), 0.0, (-1.0)), 0.5, vec3(0.3, 0.7, 0.3), vec3(0.0)), Sphere(vec3(0.0, 2.0, (-1.0)), 0.7, vec3(0.0), vec3(6.0, 5.0, 4.0)));
layout(std140) uniform Frame {
  vec2 resolution;
  float frame;
  vec3 camPos;
} u;
vec3 trace(vec3 ro0, vec3 rd0, float seed0) {
  vec3 _licm0 = vec3(0.05, 0.07, 0.1);
  vec3 _licm1 = vec3(0.0, 1.0, 0.0);
  vec3 _licm2 = vec3(1.0, 0.0, 0.0);
  vec3 ro = ro0;
  vec3 rd = rd0;
  float seed = seed0;
  vec3 throughput = vec3(1.0);
  vec3 radiance = vec3(0.0);
  for (int bounce = 0; (bounce < 8); bounce = (bounce + 1)) {
    float tMin = 1e+30;
    int hit = -1;
    for (int i = 0; (i < 4); i = (i + 1)) {
      Sphere _sm0_a0 = SPHERES[i];
      float _sm0_ret = 0.0;
      vec3 _sm0_l_oc = (ro - _sm0_a0.center);
      float _sm0_l_b = dot(_sm0_l_oc, rd);
      float _sm0_l_c = (dot(_sm0_l_oc, _sm0_l_oc) - (_sm0_a0.radius * _sm0_a0.radius));
      float _sm0_l_h = ((_sm0_l_b * _sm0_l_b) - _sm0_l_c);
      if ((_sm0_l_h < 0.0)) {
        _sm0_ret = -1.0;
      } else {
        _sm0_ret = ((-_sm0_l_b) - sqrt(_sm0_l_h));
      }
      float t = _sm0_ret;
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
    float _sm1_l_r1 = fract((sin(seed) * 43758.5453123));
    float _sm1_l_r2 = fract((sin((seed + 17.13)) * 43758.5453123));
    float _sm1_l_phi = (6.2831853 * _sm1_l_r1);
    float _sm1_l_r = sqrt(_sm1_l_r2);
    vec3 _sm1_l_t = normalize(cross(((abs(n.x) > 0.9) ? _licm1 : _licm2), n));
    vec3 _sm1_l_b = cross(n, _sm1_l_t);
    vec3 _sm1_ret = normalize((((_sm1_l_t * (cos(_sm1_l_phi) * _sm1_l_r)) + (_sm1_l_b * (sin(_sm1_l_phi) * _sm1_l_r))) + (n * sqrt((1.0 - _sm1_l_r2)))));
    rd = _sm1_ret;
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
  vec3 color = vec3(0.0);
  for (int s = 0; (s < 16); s = (s + 1)) {
    color += trace(_licm0, rd, (_licm1 + (float(s) * 3.7)));
  }
  vec3 c = (color * 0.0625);
  _ret = vec4(pow((c / (c + 1.0)), vec3(0.45454545454545453)), 1.0);
}
