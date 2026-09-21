#version 300 es
precision highp float;
precision highp int;

struct VsOut {
  vec4 pos;
  vec2 uv;
};
uniform sampler2D albedo;

layout(std140) uniform Tint {
  vec4 rgb;
} tint;
vec4 sharp(vec2 uv) {
  return texture(albedo, uv);
}

vec4 wide(vec2 uv) {
  vec2 inner = (uv * 0.5);
  return texture(albedo, inner);
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

vec4 fs_impl(VsOut v) {
  vec4 base = vec4(0.0, 0.0, 0.0, 1.0);
  if ((v.uv.x > 0.5)) {
    base = sharp(v.uv);
  } else {
    base = wide(v.uv);
  }
  if ((tint.rgb.w > 0.5)) {
    vec2 near = (v.uv * 0.75);
    vec4 warm = texture(albedo, near);
    return vec4(((base.xyz * tint.rgb.xyz) + (warm.xyz * 0.25)), 1.0);
  }
  return vec4((base.xyz * tint.rgb.xyz), 1.0);
}

void main() {
  VsOut v;
  v.pos = gl_FragCoord;
  v.uv = uv;
  _ret = fs_impl(v);
}
