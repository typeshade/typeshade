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
vec4 sharp_grad(vec2 uv, vec2 hoist_gx_h0, vec2 hoist_gy_h1) {
  return textureGrad(albedo, uv, hoist_gx_h0, hoist_gy_h1);
}

vec4 wide_grad(vec2 uv, vec2 hoist_gx_h0, vec2 hoist_gy_h1) {
  vec2 inner = (uv * 0.5);
  return textureGrad(albedo, inner, hoist_gx_h0, hoist_gy_h1);
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

vec4 fs_impl(VsOut v) {
  vec4 base = vec4(0.0, 0.0, 0.0, 1.0);
  vec2 uv_h0 = v.uv;
  vec2 hoist_gx_h1 = dFdx(uv_h0);
  vec2 hoist_gy_h2 = dFdy(uv_h0);
  vec2 uv_h1 = v.uv;
  vec2 inner_h2 = (uv_h1 * 0.5);
  vec2 hoist_gx_h3 = dFdx(inner_h2);
  vec2 hoist_gy_h4 = dFdy(inner_h2);
  if ((v.uv.x > 0.5)) {
    base = sharp_grad(v.uv, hoist_gx_h1, hoist_gy_h2);
  } else {
    base = wide_grad(v.uv, hoist_gx_h3, hoist_gy_h4);
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
