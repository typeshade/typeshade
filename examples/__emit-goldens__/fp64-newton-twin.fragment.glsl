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

vec2 df64_div(vec2 a, vec2 b, float _fp64_g) {
  float _v0 = (_fp64_g / b.x);
  vec2 _v1 = (a * _v0);
  float _v2 = df64_sub(a, df64_mul(b, _v1, _fp64_g), _fp64_g).x;
  vec2 _v3 = df64_twoProd(_v0, _v2, _fp64_g);
  return df64_add(_v1, _v3, _fp64_g);
}

float df64_narrow(vec2 a) {
  return (a.x + a.y);
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  float _fp64_g = texelFetch(_fp64, ivec2(0, 0), 0).x;
  vec2 _licm0 = vec2(2.0, 0.0);
  float _cse5 = uintBitsToFloat(floatBitsToUint(0.0));
  vec2 _licm1 = vec2(_cse5, _cse5);
  float span = pow(10.0, (-u.zoom_exp));
  float half_ = (uv.x * 2.0);
  bool _cse0 = (uv.x < 0.5);
  float sx = (half_ - (_cse0 ? 0.0 : 1.0));
  float dx = ((sx - 0.5) * span);
  float dy = (((uv.y - 0.5) * span) * ((u.resolution.y / u.resolution.x) * 2.0));
  float fx = 0.0;
  float fy = 0.0;
  float it = 0.0;
  vec2 _cse1 = vec2(u.center.hi.x, u.center.lo.x);
  vec2 _cse2 = vec2(u.center.hi.y, u.center.lo.y);
  if ((_cse0 || (u.fp64 < 0.5))) {
    float zx = (df64_narrow(_cse1) + dx);
    float zy = (df64_narrow(_cse2) + dy);
    for (uint j = 0u; (j < 48u); j = (j + 1u)) {
      float z2x = ((zx * zx) - (zy * zy));
      float z2y = ((zx * zy) * 2.0);
      float nx = (((z2x * zx) - (z2y * zy)) - 1.0);
      float ny = ((z2x * zy) + (z2y * zx));
      float gx = (z2x * 3.0);
      float gy = (z2y * 3.0);
      float inv = (1.0 / ((gx * gx) + (gy * gy)));
      float qx = (((nx * gx) + (ny * gy)) * inv);
      float qy = (((ny * gx) - (nx * gy)) * inv);
      zx = (zx - qx);
      zy = (zy - qy);
      if ((((qx * qx) + (qy * qy)) > 1e-14)) {
        it = (it + 1.0);
      }
    }
    fx = zx;
    fy = zy;
  } else {
    vec2 zx_1 = df64_add(_cse1, vec2(dx, 0.0), _fp64_g);
    vec2 zy_1 = df64_add(_cse2, vec2(dy, 0.0), _fp64_g);
    vec2 _cse3 = df64_add(vec2(1.0, 0.0), _licm1, _fp64_g);
    vec2 _cse4 = vec2(3.0, 0.0);
    for (uint j_1 = 0u; (j_1 < 48u); j_1 = (j_1 + 1u)) {
      vec2 z2x_1 = df64_sub(df64_mul(zx_1, zx_1, _fp64_g), df64_mul(zy_1, zy_1, _fp64_g), _fp64_g);
      vec2 z2y_1 = df64_mul(df64_mul(zx_1, zy_1, _fp64_g), _licm0, _fp64_g);
      vec2 nx_1 = df64_sub(df64_sub(df64_mul(z2x_1, zx_1, _fp64_g), df64_mul(z2y_1, zy_1, _fp64_g), _fp64_g), _cse3, _fp64_g);
      vec2 ny_1 = df64_add(df64_mul(z2x_1, zy_1, _fp64_g), df64_mul(z2y_1, zx_1, _fp64_g), _fp64_g);
      vec2 gx_1 = df64_mul(z2x_1, _cse4, _fp64_g);
      vec2 gy_1 = df64_mul(z2y_1, _cse4, _fp64_g);
      vec2 inv_1 = df64_div(_cse3, df64_add(df64_mul(gx_1, gx_1, _fp64_g), df64_mul(gy_1, gy_1, _fp64_g), _fp64_g), _fp64_g);
      vec2 qx_1 = df64_mul(df64_add(df64_mul(nx_1, gx_1, _fp64_g), df64_mul(ny_1, gy_1, _fp64_g), _fp64_g), inv_1, _fp64_g);
      vec2 qy_1 = df64_mul(df64_sub(df64_mul(ny_1, gx_1, _fp64_g), df64_mul(nx_1, gy_1, _fp64_g), _fp64_g), inv_1, _fp64_g);
      zx_1 = df64_sub(df64_add(zx_1, _licm1, _fp64_g), df64_add(qx_1, _licm1, _fp64_g), _fp64_g);
      zy_1 = df64_sub(df64_add(zy_1, _licm1, _fp64_g), df64_add(qy_1, _licm1, _fp64_g), _fp64_g);
      if ((df64_narrow(df64_add(df64_mul(qx_1, qx_1, _fp64_g), df64_mul(qy_1, qy_1, _fp64_g), _fp64_g)) > 1e-14)) {
        it = (it + 1.0);
      }
    }
    fx = df64_narrow(zx_1);
    fy = df64_narrow(zy_1);
  }
  float _lc0 = (fx - 1.0);
  float d0 = ((_lc0 * _lc0) + (fy * fy));
  float _gv0 = (fx + 0.5);
  float _lc2 = (fy - 0.8660254037844386);
  float _gv1 = (_gv0 * _gv0);
  float d1 = (_gv1 + (_lc2 * _lc2));
  float _lc4 = (fy + 0.8660254037844386);
  float d2 = (_gv1 + (_lc4 * _lc4));
  vec3 c0 = vec3(0.91, 0.34, 0.22);
  vec3 c1 = vec3(0.2, 0.66, 0.88);
  vec3 c2 = vec3(0.98, 0.78, 0.22);
  vec3 base = (((d0 <= d1) && (d0 <= d2)) ? c0 : ((d1 <= d2) ? c1 : c2));
  float speed = (1.0 - (it / 48.0));
  vec3 rgb = (base * mix(0.25, 1.0, speed));
  _ret = vec4(rgb, 1.0);
}
