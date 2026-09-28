"use typeshade";

// The second material: a brick wall's top, rows of bricks with mortar between them, lit by the
// same two lights. It is nearer the light than anything, so it reads no shadow.

class Camera {
  viewProj: mat4;
  time: f32;
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
declare const lights: uniform<Lights>;

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
  // Rows an eighth of a unit high; each row's bricks a quarter wide, every other row offset by
  // half a brick. A point near a row's or a brick's start is mortar.
  const row = floor(v.world.y * 8.);
  const inRow = fract(v.world.y * 8.);
  const inBrick = fract(v.world.x * 4. + 0.5 * row);
  const mortar = inRow < 0.2 || inBrick < 0.1;
  const albedo = mortar ? vec3(0.85, 0.82, 0.78) : vec3(0.7, 0.25, 0.2);
  const n = vec3(0., 0., 1.);
  const pulse = 0.5 + 0.5 * sin(camera.time * 6.2831853);
  const light0 = lights.key.color.xyz * max(dot(n, lights.key.dir.xyz), 0.);
  const light1 = lights.fill.color.xyz * max(dot(n, lights.fill.dir.xyz), 0.) * pulse;
  return { color: vec4(albedo * (vec3(0.08, 0.08, 0.08) + light0 + light1), 1.) };
}
