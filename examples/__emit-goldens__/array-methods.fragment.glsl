#version 300 es
precision highp float;
precision highp int;

struct Light {
  vec2 pos;
  float radius;
  vec3 color;
};
float[3] array_map_fs_f(vec2 p, Light[3] lights) {
  float[3] out_ = float[3](0.0, 0.0, 0.0);
  out_[0] = distance(lights[0].pos, p);
  out_[1] = distance(lights[1].pos, p);
  out_[2] = distance(lights[2].pos, p);
  return out_;
}

float array_reduce_fs_f_1(float[3] d) {
  float acc = d[0];
  float acc_1 = min(acc, d[1]);
  float acc_2 = min(acc_1, d[2]);
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

bool array_some_fs_p(vec2 p, Light[3] lights) {
  Light _u0_i0a1 = lights[0];
  if ((distance(_u0_i0a1.pos, p) < _u0_i0a1.radius)) {
    return true;
  }
  Light _u1_i0a1 = lights[1];
  if ((distance(_u1_i0a1.pos, p) < _u1_i0a1.radius)) {
    return true;
  }
  Light _u2_i0a1 = lights[2];
  if ((distance(_u2_i0a1.pos, p) < _u2_i0a1.radius)) {
    return true;
  }
  return false;
}

bool array_every_fs_p_1(float[3] d) {
  if (((d[0] > 0.7) == false)) {
    return false;
  }
  if (((d[1] > 0.7) == false)) {
    return false;
  }
  if (((d[2] > 0.7) == false)) {
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
  bool _ifc0 = array_some_fs_p(p, lights);
  col = (_ifc0 ? mix(col, vec3(1.0), 0.15) : col);
  bool _ifc1 = array_every_fs_p_1(d);
  col = (_ifc1 ? (col * 0.6) : col);
  col += vec3((1.0 - smoothstep(0.0, 0.012, abs((nearest - 0.2)))));
  color = vec4(col, 1.0);
}
