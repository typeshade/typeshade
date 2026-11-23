import { describe, expect, it } from 'vitest';
import { compileModule } from '../../core/oracle.js';
import { bothTake } from '../../core/testing/both-halves.js';

const SOURCE = `"use typeshade";
interface VsOut {
  pos: builtin<"position">;
  uv: vec2;
}
class Camera {
  position: vec3;
  lookAt: vec3;
  fov: f32;
  constructor(position: vec3, lookAt: vec3, fov: f32) {
    this.position = position;
    this.lookAt = lookAt;
    this.fov = fov;
  }
}
@vertex
export function vs(vi: builtin<"vertex_index">): VsOut {
  const p: vec2 = vec2(f32(vi), 0);
  return { pos: vec4(p, 0, 1), uv: p };
}
@fragment
export function fs(v: VsOut): vec4 {
  let camera: Camera;
  camera = new Camera(vec3(v.uv.x, 1, 2), vec3(0, v.uv.y, 5), 1.5);
  let sum = 0;
  for (let i = 0; i < 64; i++) {
    const forward = normalize(camera.lookAt - camera.position);
    sum += dot(forward, vec3(f32(i), 1, 0)) * tan(camera.fov * 0.5);
  }
  return vec4(sum, sum, sum, 1);
}`;

const VALUE = `"use typeshade";
class Pair {
  a: f32;
  b: f32;
  constructor(a: f32, b: f32) {
    this.a = a;
    this.b = b;
  }
}
export function g(x: f32): f32 {
  let p: Pair;
  p = new Pair(x, 2);
  let sum = 0;
  for (let i = 0; i < 64; i++) {
    sum += sqrt(p.a * p.a + p.b) * f32(i + 1);
  }
  return sum;
}`;

describe('a struct local that is never rewritten', () => {
  it('is declared with its value and has its loop-invariant read hoisted, on both targets', () => {
    const { result } = bothTake(SOURCE);
    const wgsl = result.wgsl!;
    const loop = wgsl.slice(wgsl.indexOf('for ('));
    expect(loop).not.toContain('normalize(');
    expect(wgsl).toMatch(/let _licm\d+ = normalize\(/);
    expect(wgsl).not.toMatch(/^\s*camera = /m);
    expect(wgsl).not.toMatch(/var camera: Camera;/);
    expect(wgsl).toMatch(/let _i0a1 = vec3<f32>\(0\.0, v\.uv\.y, 5\.0\);/);
    const glsl = result.glsl!.fragment;
    expect(glsl.slice(glsl.indexOf('for ('))).not.toContain('normalize(');
    expect(glsl).not.toMatch(/^\s*camera = /m);
    expect(glsl).not.toMatch(/Camera camera;/);
  });

  it('keeps the value of a loop that reads it', () => {
    const { result } = bothTake(VALUE);
    const x = 1.5;
    expect(compileModule(result.module).fns.g!(x)).toBeCloseTo(Math.sqrt(x * x + 2) * 2080, 2);
    const wgsl = result.wgsl!;
    expect(wgsl).not.toMatch(/^\s*p = /m);
  });
});
