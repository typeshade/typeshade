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

void main() {
  uint vi = uint(gl_VertexID);
  int _cse0 = int(vi);
  float x = ((float((_cse0 / 2)) * 4.0) - 1.0);
  float y = ((float((_cse0 % 2)) * 4.0) - 1.0);
  gl_Position = vec4(x, y, 0.0, 1.0);
}
