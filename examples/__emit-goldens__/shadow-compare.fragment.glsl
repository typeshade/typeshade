#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArrayShadow;
precision highp sampler2DShadow;

uniform sampler2DShadow shadowMap;

uniform sampler2DArrayShadow cascades;
layout(location = 0) out vec4 _ret;

void main() {
  vec4 p = gl_FragCoord;
  vec2 uv = fract((p.xy * 0.004));
  float depthHere = (0.5 + (0.25 * sin((uv.x * 6.2831))));
  float lit = texture(shadowMap, vec3(uv, depthHere));
  int band = int(floor((uv.y * float(uint(textureSize(cascades, 0).z)))));
  float litFar = textureGrad(cascades, vec4(uv, float(band), depthHere), vec2(0.0), vec2(0.0));
  uvec2 size = uvec2(textureSize(shadowMap, 0));
  float texel = (1.0 / float(size.x));
  float shade = mix(0.15, 1.0, ((lit * 0.6) + (litFar * 0.4)));
  _ret = vec4((shade * (0.9 - texel)), (shade * 0.8), (shade * 0.6), 1.0);
}
