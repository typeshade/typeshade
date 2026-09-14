#version 300 es
precision highp float;
precision highp int;

struct FsIn {
  vec4 pos;
  vec2 uv;
};
vec4 shade(FsIn o) {
  vec2 d = (o.uv - vec2(0.5, 0.5));
  float r = length(d);
  return vec4(o.uv.x, o.uv.y, (1.0 - r), 1.0);
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  FsIn asIn = FsIn(gl_FragCoord, uv);
  vec4 a = shade(asIn);
  vec4 b = shade(FsIn(gl_FragCoord, (uv * 0.5)));
  color = ((a + b) * 0.5);
}
