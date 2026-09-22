#version 300 es
precision highp float;
precision highp int;

layout(std140) uniform Uniforms {
  vec2 resolution;
  vec2 base;
  float fp64;
} u;

uniform sampler2D _fp64;
vec2 df64_twoSum(float a, float b) {
  float _v0 = (a + b);
  float _cse0 = texelFetch(_fp64, ivec2(0, 0), 0).x;
  float _v1 = (((_v0 * _cse0) - a) * _cse0);
  float _v2 = (((((a - ((_v0 - _v1) * _cse0)) * _cse0) * _cse0) * _cse0) + (b - _v1));
  return vec2(_v0, _v2);
}

vec2 df64_quickTwoSum(float a, float b) {
  float _cse0 = texelFetch(_fp64, ivec2(0, 0), 0).x;
  float _v0 = ((a + b) * _cse0);
  float _v1 = (b - ((_v0 - a) * _cse0));
  return vec2(_v0, _v1);
}

vec2 df64_split(float a) {
  float _cse0 = texelFetch(_fp64, ivec2(0, 0), 0).x;
  float _v0 = (a * (_cse0 * 4097.0));
  float _v1 = ((_v0 * _cse0) - (_v0 - a));
  float _v2 = ((a * _cse0) - _v1);
  return vec2(_v1, _v2);
}

vec2 df64_twoProd(float a, float b) {
  float _v0 = (a * b);
  vec2 _v1 = df64_split(a);
  vec2 _v2 = df64_split(b);
  float _v3 = (((((_v1.x * _v2.x) - _v0) + (_v1.x * _v2.y)) + (_v1.y * _v2.x)) + (_v1.y * _v2.y));
  return vec2(_v0, _v3);
}

vec2 df64_add(vec2 a, vec2 b) {
  vec2 _v0 = df64_twoSum(a.x, b.x);
  vec2 _v1 = df64_twoSum(a.y, b.y);
  _v0.y = (_v0.y + _v1.x);
  _v0 = df64_quickTwoSum(_v0.x, _v0.y);
  _v0.y = (_v0.y + _v1.y);
  _v0 = df64_quickTwoSum(_v0.x, _v0.y);
  return _v0;
}

vec2 df64_sub(vec2 a, vec2 b) {
  return df64_add(a, (-b));
}

vec2 df64_mul(vec2 a, vec2 b) {
  vec2 _v0 = df64_twoProd(a.x, b.x);
  _v0.y = (_v0.y + (a.x * b.y));
  _v0 = df64_quickTwoSum(_v0.x, _v0.y);
  _v0.y = (_v0.y + (a.y * b.x));
  return df64_quickTwoSum(_v0.x, _v0.y);
}

vec2 df64_div(vec2 a, vec2 b) {
  float _v0 = (texelFetch(_fp64, ivec2(0, 0), 0).x / b.x);
  vec2 _v1 = (a * _v0);
  float _v2 = df64_sub(a, df64_mul(b, _v1)).x;
  vec2 _v3 = df64_twoProd(_v0, _v2);
  return df64_add(_v1, _v3);
}

float df64_narrow(vec2 a) {
  return (a.x + a.y);
}

vec2 df64_nint(vec2 a) {
  float _v0 = floor((a.x + 0.5));
  float _v1 = (((abs((_v0 - a.x)) == 0.5) && (a.y < 0.0)) ? (_v0 - 1.0) : _v0);
  return ((_v0 == a.x) ? df64_quickTwoSum(_v0, floor((a.y + 0.5))) : vec2(_v1, 0.0));
}

vec2 df64_sin_taylor(vec2 a) {
  vec2 _v0 = (-df64_mul(a, a));
  vec2 _v1 = df64_mul(a, _v0);
  vec2 _v2 = df64_add(a, df64_mul(_v1, vec2(0.1666666716337204, -4.967053879312289e-9)));
  vec2 _v3 = df64_mul(_v1, _v0);
  return df64_add(_v2, df64_mul(_v3, vec2(0.008333333767950535, -4.34617203337595e-10)));
}

vec2 df64_cos_taylor(vec2 a) {
  vec2 _v0 = (-df64_mul(a, a));
  vec2 _v1 = df64_add(vec2(1.0, 0.0), df64_mul(_v0, vec2(0.5, 0.0)));
  vec2 _v2 = df64_mul(_v0, _v0);
  vec2 _v3 = df64_add(_v1, df64_mul(_v2, vec2(0.0416666679084301, -1.2417634698280722e-9)));
  vec2 _v4 = df64_mul(_v2, _v0);
  return df64_add(_v3, df64_mul(_v4, vec2(0.0013888889225199819, -3.3631094437103215e-11)));
}

vec2 df64_sin(vec2 a) {
  vec2 _cse0 = vec2(6.2831854820251465, -1.7484555314695172e-7);
  vec2 _v0 = df64_nint(df64_div(a, _cse0));
  vec2 _v1 = df64_sub(a, df64_mul(_cse0, _v0));
  float _v2 = floor(((_v1.x / 1.5707963705062866) + 0.5));
  vec2 _v3 = df64_sub(_v1, df64_mul(vec2(1.5707963705062866, -4.371138828673793e-8), vec2(_v2, 0.0)));
  float _v4 = floor(((_v3.x / 0.19634954631328583) + 0.5));
  vec2 _v5 = df64_sub(_v3, df64_mul(vec2(0.19634954631328583, -5.463923535842241e-9), vec2(_v4, 0.0)));
  vec2 _v6 = df64_sin_taylor(_v5);
  vec2 _v7 = df64_cos_taylor(_v5);
  float _v8 = abs(_v4);
  vec2 _cse1 = vec2(0.7071067690849304, 1.2101617485882343e-8);
  bool _gv0 = (_v8 == 1.0);
  vec2 _v9 = (_gv0 ? vec2(0.9807852506637573, 2.9739473106360492e-8) : ((_v8 == 2.0) ? vec2(0.9238795042037964, 2.830748968563057e-8) : ((_v8 == 3.0) ? vec2(0.8314695954322815, 1.687026340846387e-8) : ((_v8 == 4.0) ? _cse1 : vec2(1.0, 0.0)))));
  vec2 _v10 = (_gv0 ? vec2(0.19509032368659973, -1.6704715388726754e-9) : ((_v8 == 2.0) ? vec2(0.3826834261417389, 6.2233507236442165e-9) : ((_v8 == 3.0) ? vec2(0.5555702447891235, -1.1769521357507529e-8) : ((_v8 == 4.0) ? _cse1 : vec2(0.0, 0.0)))));
  vec2 _v11 = ((_v4 >= 0.0) ? _v10 : (-_v10));
  vec2 _v12 = df64_add(df64_mul(_v9, _v6), df64_mul(_v11, _v7));
  vec2 _v13 = df64_sub(df64_mul(_v9, _v7), df64_mul(_v11, _v6));
  return ((_v2 == 0.0) ? _v12 : ((_v2 == 1.0) ? _v13 : ((_v2 == -1.0) ? (-_v13) : (-_v12))));
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  float halfUv = (uv.x * 2.0);
  bool _cse0 = (uv.x < 0.5);
  float sx = (halfUv - (_cse0 ? 0.0 : 1.0));
  bool isF32 = (_cse0 || (u.fp64 < 0.5));
  float _gv0 = (sx * 25.132741228718345);
  vec2 arg64 = df64_add(u.base, vec2(_gv0, 0.0));
  float _cse1 = uintBitsToFloat(floatBitsToUint(0.0));
  float y64 = df64_narrow(df64_sin(df64_add(arg64, vec2(_cse1, _cse1))));
  float y32 = sin((df64_narrow(u.base) + _gv0));
  float v = (isF32 ? y32 : y64);
  float py = ((uv.y - 0.5) * 2.0);
  float px = (2.0 / u.resolution.y);
  float gxf = fract((sx * 10.0));
  float gyf = fract(((py + 1.0) * 4.0));
  float dgx = min(gxf, (1.0 - gxf));
  float dgy = min(gyf, (1.0 - gyf));
  float aaCx = (30.0 / u.resolution.x);
  float aaCy = (20.0 / u.resolution.y);
  float grid = ((1.0 - smoothstep(0.0, aaCx, dgx)) + (1.0 - smoothstep(0.0, aaCy, dgy)));
  vec3 paper = vec3(0.96, 0.94, 0.88);
  vec3 rgb0 = mix(paper, vec3(0.72, 0.78, 0.86), (min(grid, 1.0) * 0.45));
  float fill = step(py, v);
  vec3 rgb1 = mix(rgb0, vec3(0.62, 0.74, 0.9), (fill * 0.4));
  float ink = (1.0 - smoothstep((px * 1.2), (px * 3.0), abs((v - py))));
  vec3 rgb2 = mix(rgb1, vec3(0.13, 0.16, 0.3), (ink * 0.85));
  float _lc0 = (px * 1.5);
  float axis = min(smoothstep(0.0, _lc0, abs(py)), smoothstep(0.0, _lc0, (abs((sx - 0.5)) * 2.0)));
  vec3 rgb = mix(vec3(0.35, 0.33, 0.3), rgb2, axis);
  _ret = vec4(rgb, 1.0);
}
