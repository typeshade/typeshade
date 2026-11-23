import { describe, expect, it } from 'vitest';
import { bothTake } from '../../core/testing/both-halves.js';
import { compileModule } from '../../core/oracle.js';
import { fixpoint } from '../../core/passes/opt/optimize.js';

const PROGRAM = `"use typeshade";
interface VsOut {
  pos: builtin<"position">;
  uv: vec2;
}
@vertex
export function vs(vi: builtin<"vertex_index">): VsOut {
  const p: vec2 = vec2(f32(vi), 0);
  return { pos: vec4(p, 0, 1), uv: p };
}
class Material {
  albedo: vec3;
  rough: f32;
  constructor(albedo: vec3, rough: f32) {
    this.albedo = albedo;
    this.rough = rough;
  }
}
class Ball {
  material: Material;
  radius: f32;
  constructor(material: Material, radius: f32) {
    this.material = material;
    this.radius = radius;
  }
}
class Scene {
  ball: Ball;
  gain: f32;
  constructor(ball: Ball, gain: f32) {
    this.ball = ball;
    this.gain = gain;
  }
}
function march(scene: Scene, p: vec3, n: i32): vec3 {
  let acc: vec3 = p;
  for (let i = 0; i < n; i++) {
    acc = acc + scene.ball.material.albedo * (scene.gain + f32(i)) + scene.ball.radius;
  }
  return acc * scene.ball.material.rough;
}
export function shade(u: f32): f32 {
  const scene = new Scene(new Ball(new Material(vec3(u, 0.25, 0.5), 0.5), 0.25), 2);
  return march(scene, vec3(u, 0, 0), 3).x;
}
@fragment
export function fs(v: VsOut): vec4 {
  const scene = new Scene(new Ball(new Material(vec3(v.uv.x, 0.25, 0.5), 0.5), v.uv.y), 2);
  const a = march(scene, vec3(v.uv, 0), i32(v.uv.x * 8));
  const b = march(scene, a, i32(v.uv.y * 8));
  return vec4(a + b, 1);
}`;
const emit = () => {
  const { result } = bothTake(PROGRAM);
  return { wgsl: result.wgsl!, glsl: result.glsl!.fragment, module: result.module };
};

const count = (text: string, re: RegExp): number => text.match(re)?.length ?? 0;

describe('a class built by its constructor is one constructor in the emit', () => {
  it('builds each object with one constructor and no field write in WGSL', () => {
    const { wgsl } = emit();
    expect(wgsl).toMatch(/var scene: Scene = Scene\(Ball\(Material\(.*\), [\w.]+\), [\d.]+\);/);
    expect(count(wgsl, /\bScene\(/g)).toBe(2);
    expect(wgsl).not.toContain('_new');
    expect(wgsl).not.toMatch(/\b\w+\.(ball|gain|material|radius|albedo|rough) = /);
  });

  it('builds each object with one constructor and no field write in GLSL', () => {
    const { glsl } = emit();
    expect(glsl).toMatch(/Scene scene = Scene\(Ball\(Material\(.*\), [\w.]+\), [\d.]+\);/);
    expect(glsl).not.toContain('_new');
    expect(glsl).not.toMatch(/\b\w+\.(ball|gain|material|radius|albedo|rough) = /);
  });

  it('keeps the value the constructor program computes', () => {
    const { module } = emit();
    const run = compileModule(fixpoint(module)).fns.shade!;
    const expected = (u: number): number => {
      let acc = u;
      for (let i = 0; i < 3; i++) acc = acc + u * (2 + i) + 0.25;
      return acc * 0.5;
    };
    for (const u of [0, 0.5, 1, 3]) expect(run(u)).toBeCloseTo(expected(u), 5);
  });
});
