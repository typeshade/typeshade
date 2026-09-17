#version 300 es
precision highp float;
precision highp int;

#ifndef tint
#define tint 0.85
#endif
#ifndef desaturate
#define desaturate 0.0
#endif
uniform sampler2D tex;
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  vec4 texel = texture(tex, uv);
  uvec2 dims = uvec2(textureSize(tex, 0));
  float width = float(dims.x);
  float edge = clamp(((uv.x * width) / (width + 1.0)), 0.0, 1.0);
  float grey = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
  vec3 mixed = mix(texel.rgb, vec3(grey, grey, grey), vec3(desaturate, desaturate, desaturate));
  vec3 shaded = (mixed * (tint * edge));
  color = vec4(shaded, texel.a);
}
