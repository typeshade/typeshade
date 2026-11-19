#version 300 es
precision highp float;
precision highp int;

struct Sphere {
  vec3 center;
  float radius;
  vec3 albedo;
  vec3 emission;
};
const Sphere SPHERES[4] = Sphere[4](Sphere(vec3(0.0, (-100.5), (-1.0)), 100.0, vec3(0.8, 0.8, 0.8), vec3(0.0)), Sphere(vec3(0.0, 0.0, (-1.0)), 0.5, vec3(0.7, 0.3, 0.3), vec3(0.0)), Sphere(vec3((-1.0), 0.0, (-1.0)), 0.5, vec3(0.3, 0.7, 0.3), vec3(0.0)), Sphere(vec3(0.0, 2.0, (-1.0)), 0.7, vec3(0.0), vec3(6.0, 5.0, 4.0)));
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
      Sphere _i0a0 = SPHERES[i];
      vec3 _i0_oc = (ro - _i0a0.center);
      float _i0_b = dot(_i0_oc, rd);
      float _i0_c = (dot(_i0_oc, _i0_oc) - (_i0a0.radius * _i0a0.radius));
      float _i0_h = ((_i0_b * _i0_b) - _i0_c);
      float _i0ret = mix(((-_i0_b) - sqrt(_i0_h)), -1.0, (_i0_h < 0.0));
      bool _ifc0 = ((_i0ret > 0.001) && (_i0ret < tMin));
      tMin = mix(tMin, _i0ret, _ifc0);
      hit = (_ifc0 ? i : hit);
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
    float _i1_r1 = fract((sin(seed) * 43758.5453123));
    float _i1_r2 = fract((sin((seed + 17.13)) * 43758.5453123));
    float _i1_phi = (6.2831853 * _i1_r1);
    float _i1_r = sqrt(_i1_r2);
    vec3 _i1_t = normalize(cross(mix(_licm2, _licm1, bvec3((abs(n.x) > 0.9))), n));
    vec3 _i1_b = cross(n, _i1_t);
    vec3 _i1ret = normalize((((_i1_t * (cos(_i1_phi) * _i1_r)) + (_i1_b * (sin(_i1_phi) * _i1_r))) + (n * sqrt((1.0 - _i1_r2)))));
    rd = _i1ret;
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
