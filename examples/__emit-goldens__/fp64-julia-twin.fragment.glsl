#version 300 es
precision highp float;
precision highp int;

struct DF64Vec2 {
  vec2 hi;
  vec2 lo;
};
layout(std140) uniform Uniforms {
  DF64Vec2 center;
  vec2 resolution;
  float zoom_exp;
  float fp64;
} u;

uniform highp sampler2D _fp64;
vec2 df64_twoSum(float a, float b, float _fp64_g) {
  float _v0 = (a + b);
  float _v1 = (((_v0 * _fp64_g) - a) * _fp64_g);
  float _v2 = (((a - ((_v0 - _v1) * _fp64_g)) * _fp64_g) + (b - _v1));
  return vec2(_v0, _v2);
}

vec2 df64_quickTwoSum(float a, float b, float _fp64_g) {
  float _v0 = ((a + b) * _fp64_g);
  float _v1 = (b - ((_v0 - a) * _fp64_g));
  return vec2(_v0, _v1);
}

vec2 df64_split(float a, float _fp64_g) {
  float _v0 = (a * (_fp64_g * 4097.0));
  float _v1 = ((_v0 * _fp64_g) - (_v0 - a));
  float _v2 = ((a * _fp64_g) - _v1);
  return vec2(_v1, _v2);
}

vec2 df64_twoProd(float a, float b, float _fp64_g) {
  float _v0 = (a * b);
  vec2 _v1 = df64_split(a, _fp64_g);
  vec2 _v2 = df64_split(b, _fp64_g);
  float _v3 = (((((_v1.x * _v2.x) - _v0) + (_v1.x * _v2.y)) + (_v1.y * _v2.x)) + (_v1.y * _v2.y));
  return vec2(_v0, _v3);
}

vec2 df64_add(vec2 a, vec2 b, float _fp64_g) {
  vec2 _v0 = df64_twoSum(a.x, b.x, _fp64_g);
  vec2 _v1 = df64_twoSum(a.y, b.y, _fp64_g);
  _v0.y = (_v0.y + _v1.x);
  _v0 = df64_quickTwoSum(_v0.x, _v0.y, _fp64_g);
  _v0.y = (_v0.y + _v1.y);
  _v0 = df64_quickTwoSum(_v0.x, _v0.y, _fp64_g);
  return _v0;
}

vec2 df64_sub(vec2 a, vec2 b, float _fp64_g) {
  return df64_add(a, (-b), _fp64_g);
}

vec2 df64_mul(vec2 a, vec2 b, float _fp64_g) {
  vec2 _v0 = df64_twoProd(a.x, b.x, _fp64_g);
  _v0.y = (_v0.y + (a.x * b.y));
  _v0 = df64_quickTwoSum(_v0.x, _v0.y, _fp64_g);
  _v0.y = (_v0.y + (a.y * b.x));
  return df64_quickTwoSum(_v0.x, _v0.y, _fp64_g);
}

bool df64_le(vec2 a, vec2 b) {
  return ((a.x < b.x) || ((a.x == b.x) && (a.y <= b.y)));
}

float df64_narrow(vec2 a) {
  return (a.x + a.y);
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  float _fp64_g = texelFetch(_fp64, ivec2(0, 0), 0).x;
  vec2 _licm0 = vec2(16.0, 0.0);
  vec2 _licm1 = vec2(-0.800000011920929, 1.1920929132713809e-8);
  vec2 _licm2 = vec2(2.0, 0.0);
  vec2 _licm3 = vec2(0.15600000321865082, -3.218650901359865e-9);
  float span = pow(10.0, (-u.zoom_exp));
  float half_ = (uv.x * 2.0);
  bool _cse0 = (uv.x < 0.5);
  float sx = (half_ - (_cse0 ? 0.0 : 1.0));
  float dx = ((sx - 0.5) * span);
  float dy = (((uv.y - 0.5) * span) * ((u.resolution.y / u.resolution.x) * 2.0));
  float it = 0.0;
  float m2 = 0.0;
  vec2 _cse1 = vec2(u.center.hi.x, u.center.lo.x);
  vec2 _cse2 = vec2(u.center.hi.y, u.center.lo.y);
  if ((_cse0 || (u.fp64 < 0.5))) {
    float zx = (df64_narrow(_cse1) + dx);
    float zy = (df64_narrow(_cse2) + dy);
    for (uint j = 0u; (j < 128u); j = (j + 1u)) {
      float _gv0 = (zx * zx);
      float _gv1 = (zy * zy);
      if (((_gv0 + _gv1) <= 16.0)) {
        float nzx = ((_gv0 - _gv1) + -0.8);
        zy = (((zx * zy) * 2.0) + 0.156);
        zx = nzx;
        it = (it + 1.0);
      }
    }
    m2 = ((zx * zx) + (zy * zy));
  } else {
    vec2 zx_1 = df64_add(_cse1, vec2(dx, 0.0), _fp64_g);
    vec2 zy_1 = df64_add(_cse2, vec2(dy, 0.0), _fp64_g);
    for (uint j_1 = 0u; (j_1 < 128u); j_1 = (j_1 + 1u)) {
      vec2 _gv2 = df64_mul(zx_1, zx_1, _fp64_g);
      vec2 _gv3 = df64_mul(zy_1, zy_1, _fp64_g);
      if (df64_le(df64_add(_gv2, _gv3, _fp64_g), _licm0)) {
        vec2 nzx_1 = df64_add(df64_sub(_gv2, _gv3, _fp64_g), _licm1, _fp64_g);
        zy_1 = df64_add(df64_mul(df64_mul(zx_1, zy_1, _fp64_g), _licm2, _fp64_g), _licm3, _fp64_g);
        zx_1 = nzx_1;
        it = (it + 1.0);
      }
    }
    m2 = df64_narrow(df64_add(df64_mul(zx_1, zx_1, _fp64_g), df64_mul(zy_1, zy_1, _fp64_g), _fp64_g));
  }
  float sn = ((it - log2(max(log2(max(m2, 1.0001)), 0.0001))) + 1.0);
  float inside = step(127.5, it);
  float s = (sn * 0.0078125);
  vec3 ph = vec3(0.0, 0.25, 0.6);
  vec3 rgb = (((vec3(0.5, 0.5, 0.5) + (cos(((ph + (s * 5.5)) + 2.2)) * 0.5)) * mix(0.35, 1.0, s)) * (1.0 - inside));
  _ret = vec4(rgb, 1.0);
}
