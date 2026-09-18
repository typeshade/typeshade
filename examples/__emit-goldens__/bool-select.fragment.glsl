#version 300 es
precision highp float;
precision highp int;

in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  bvec2 past = greaterThan(uv, vec2(0.5, 0.5));
  vec3 cool = vec3(0.1, 0.3, 0.8);
  vec3 warm = vec3(0.9, 0.5, 0.1);
  bool _cse0 = (uv.x > 0.5);
  bvec3 mask = bvec3(_cse0, _cse0, (uv.y > 0.5));
  vec3 color = mix(cool, warm, mask);
  if (all(past)) {
    color = (color * 1.2);
  } else if ((any(past) == false)) {
    color = (color * 0.6);
  }
  _ret = vec4(color, 1.0);
}
