"use typeshade";

// The first material: a grey ground, lit by the scene's two lights, the first of them through
// the shadow map the shadow pass wrote. The camera and the lights are the scene's, shared with
// the brick material; the light's view is shared with the shadow pass.

class Camera {
  viewProj: mat4;
  time: f32;
}

class LightView {
  viewProj: mat4;
}

class Light {
  dir: vec4;
  color: vec4;
}

// The scene's two lights: a key light that casts the shadow, and a fill light from above.
class Lights {
  key: Light;
  fill: Light;
}

declare const camera: uniform<Camera>;
declare const light: uniform<LightView>;
declare const lights: uniform<Lights>;
declare const shadowMap: texture_depth_2d;
declare const cmp: sampler_comparison;

class VsIn {
  @location(0) position: vec3;
}

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) world: vec3;
}

class Color {
  @location(0) color: vec4;
}

@vertex
export function vs(v: VsIn): VsOut {
  return { pos: camera.viewProj * vec4(v.position, 1.), world: v.position };
}

@fragment
export function fs(v: VsOut): Color {
  // Where this point falls in the light's view, and whether the occluder is nearer the light.
  const ls = light.viewProj * vec4(v.world, 1.);
  const uv = vec2(ls.x * 0.5 + 0.5, 0.5 - ls.y * 0.5);
  const seen = textureSampleCompare(shadowMap, cmp, uv, ls.z);
  const n = vec3(0., 0., 1.);
  // The fill light pulses with the camera's clock, once a second.
  const pulse = 0.5 + 0.5 * sin(camera.time * 6.2831853);
  const light0 = lights.key.color.xyz * max(dot(n, lights.key.dir.xyz), 0.) * seen;
  const light1 = lights.fill.color.xyz * max(dot(n, lights.fill.dir.xyz), 0.) * pulse;
  const albedo = vec3(0.6, 0.6, 0.6);
  return { color: vec4(albedo * (vec3(0.08, 0.08, 0.08) + light0 + light1), 1.) };
}
