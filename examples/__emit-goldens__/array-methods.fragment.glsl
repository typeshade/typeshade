#version 300 es
precision highp float;
precision highp int;

struct Light {
  vec2 pos;
  float radius;
  vec3 color;
};
float fs_f(vec2 p, Light l) {
  return distance(l.pos, p);
}

float[3] array_map_fs_f(vec2 p, Light[3] lights) {
  float[3] out_ = float[3](0.0, 0.0, 0.0);
  out_[0] = fs_f(p, lights[0]);
  out_[1] = fs_f(p, lights[1]);
  out_[2] = fs_f(p, lights[2]);
  return out_;
}

float fs_f_1(float a, float b) {
  return min(a, b);
}

float array_reduce_fs_f_1(float[3] d) {
  float acc = d[0];
  float acc_1 = fs_f_1(acc, d[1]);
  float acc_2 = fs_f_1(acc_1, d[2]);
  return acc_2;
}

void fs_f_2(inout vec3 col, float[3] d, Light l, int i) {
  col += (l.color * (0.02 / (0.02 + (d[i] * d[i]))));
}

void array_forEach_fs_f_2(inout vec3 col, float[3] d, Light[3] lights) {
  fs_f_2(col, d, lights[0], 0);
  fs_f_2(col, d, lights[1], 1);
  fs_f_2(col, d, lights[2], 2);
}

bool fs_p(vec2 p, Light l) {
  return (distance(l.pos, p) < l.radius);
}

bool array_some_fs_p(vec2 p, Light[3] lights) {
  if (fs_p(p, lights[0])) {
    return true;
  }
  if (fs_p(p, lights[1])) {
    return true;
  }
  if (fs_p(p, lights[2])) {
    return true;
  }
  return false;
}

bool fs_p_1(float x) {
  return (x > 0.7);
}

bool array_every_fs_p_1(float[3] d) {
  if ((fs_p_1(d[0]) == false)) {
    return false;
  }
  if ((fs_p_1(d[1]) == false)) {
    return false;
  }
  if ((fs_p_1(d[2]) == false)) {
    return false;
  }
  return true;
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  vec2 p = uv;
  Light[3] lights = Light[3](Light(vec2(-0.5, -0.3), 0.35, vec3(1.0, 0.45, 0.2)), Light(vec2(0.45, -0.1), 0.3, vec3(0.2, 0.6, 1.0)), Light(vec2(0.0, 0.5), 0.25, vec3(0.4, 1.0, 0.5)));
  float[3] d = array_map_fs_f(p, lights);
  float nearest = array_reduce_fs_f_1(d);
  vec3 col = vec3(0.02, 0.02, 0.05);
  array_forEach_fs_f_2(col, d, lights);
  if (array_some_fs_p(p, lights)) {
    col = mix(col, vec3(1.0), 0.15);
  }
  if (array_every_fs_p_1(d)) {
    col *= 0.6;
  }
  col += vec3((1.0 - smoothstep(0.0, 0.012, abs((nearest - 0.2)))));
  color = vec4(col, 1.0);
}
