#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
precision highp samplerCubeShadow;

uniform samplerCube env;

uniform sampler3D lut;

uniform sampler2D albedo;

uniform samplerCubeShadow pointShadow;
layout(location = 0) out vec4 _ret;

void main() {
  vec4 p = gl_FragCoord;
  vec2 uv = fract((p.xy * 0.004));
  vec3 dir = normalize(vec3(((uv * 2.0) - 1.0), 1.0));
  vec4 sky = texture(env, dir);
  vec4 glossy = texture(env, dir, 2.0);
  vec4 graded = textureLod(lut, sky.rgb, 0.0);
  vec4 detail = textureGrad(albedo, uv, vec2(0.004, 0.0), vec2(0.0, 0.004));
  vec3 toLight = vec3((uv - 0.5), 0.5);
  float lit = texture(pointShadow, vec4(normalize(toLight), length(toLight)));
  uvec3 size = uvec3(textureSize(lut, 0));
  float fade = clamp((float(size.z) * 0.015625), 0.0, 1.0);
  vec4 voxel = texelFetch(lut, ivec3(0, 0, 0), int(0u));
  vec3 shade = ((mix(graded.rgb, glossy.rgb, 0.25) * (lit * detail.r)) * fade);
  _ret = vec4((shade + (voxel.rgb * 0.05)), 1.0);
}
