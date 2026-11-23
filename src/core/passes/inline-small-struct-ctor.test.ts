import { describe, expect, it } from 'vitest';
import { bothTake } from '../testing/both-halves.js';
import { compileModule } from '../oracle.js';
import { emitModule } from '../backends/wgsl.js';
import type { ModuleDecl } from '../ir/index.js';
import { inlineSmall } from './inline-small.js';

const PRELUDE = `"use typeshade";
interface VsOut { pos: builtin<"position">; uv: vec2; }
interface Color { color: vec4; }
@vertex
export function vs(vi: builtin<"vertex_index">): VsOut {
  const p: vec2 = vec2(f32(vi), 0);
  return { pos: vec4(p, 0, 1), uv: p };
}`;

const RAY = `
class Ray {
  origin: vec2;
  direction: vec2;
  constructor(origin: vec2, direction: vec2) {
    this.origin = origin;
    this.direction = direction;
  }
}`;

const build = (helpers: string, body: string): ModuleDecl =>
  bothTake(`${PRELUDE}
${helpers}
export function probe(a: f32, b: f32, c: f32): f32 { ${body} }
@fragment
export function fs(v: VsOut): Color { return { color: vec4(v.uv, 0, 1) }; }`).result.module;

const names = (m: ModuleDecl): string[] => m.funcs.map((f) => f.name);

const same = (before: ModuleDecl, after: ModuleDecl): void => {
  const run = (m: ModuleDecl) => compileModule(m).fns.probe! as (...a: number[]) => number;
  for (const args of [
    [1, 2, 3],
    [-4.5, 0.25, 9],
    [0, 0, 0],
    [7, -7, 2],
  ])
    expect(run(after)(...args)).toEqual(run(before)(...args));
};

describe('inlineSmall judges a helper by the body the optimizer leaves', () => {
  it('inlines a struct constructor called twice', () => {
    const m = build(
      `${RAY}
function make(x: f32, y: f32): Ray { return new Ray(vec2(x, y), vec2(y, x)); }`,
      'const r = make(a, b); const s = make(b, c); return r.origin.x + r.direction.y + s.origin.y * s.direction.x;',
    );
    const out = inlineSmall(m);
    expect(names(out)).not.toContain('Ray_new');
    same(m, out);
  });

  it('inlines a constructor called from a loop', () => {
    const m = build(
      RAY,
      'let t = 0; for (let i = 0; i < 4; i++) { const r = new Ray(vec2(a + f32(i), b), vec2(c, f32(i))); t += r.origin.x * r.direction.y; } const q = new Ray(vec2(a, b), vec2(c, c)); return t + q.origin.y;',
    );
    const out = inlineSmall(m);
    expect(names(out)).not.toContain('Ray_new');
    same(m, out);
  });

  it('keeps the values of a constructor that reads a field it has written', () => {
    const m = build(
      `class Box {
  size: f32;
  area: f32;
  constructor(size: f32) {
    this.size = size;
    this.area = this.size * this.size;
  }
}`,
      'const p = new Box(a); const q = new Box(b); return p.area + q.area + p.size + c;',
    );
    const out = inlineSmall(m);
    same(m, out);
  });

  it('keeps a helper that stays large after the optimizer', () => {
    const m = build(
      `function big(x: f32): f32 {
  let t = x;
  for (let i = 0; i < 3; i++) { t = t * 1.5 + f32(i); t = sin(t) + x; }
  return t;
}`,
      'return big(a) + big(b) + c;',
    );
    const out = inlineSmall(m);
    expect(names(out)).toContain('big');
    same(m, out);
  });

  it('keeps a struct helper whose loop stays after the optimizer', () => {
    const m = build(
      `${RAY}
function walk(x: f32): Ray {
  let o = vec2(x, x);
  for (let i = 0; i < 3; i++) { o = o * 2; }
  return new Ray(o, o);
}`,
      'const r = walk(a); const s = walk(b); return r.origin.x + s.direction.y + c;',
    );
    const out = inlineSmall(m);
    expect(names(out)).toContain('walk');
    same(m, out);
  });
});

describe('a struct constructor through compile()', () => {
  const SOURCE = `${PRELUDE}
${RAY}
@fragment
export function fs(v: VsOut): Color {
  let t = 0;
  for (let i = 0; i < 4; i++) {
    const r = new Ray(vec2(v.uv.x + f32(i), v.uv.y), vec2(f32(i), 1));
    t += r.origin.x * r.direction.y;
  }
  return { color: vec4(t, 0, 0, 1) };
}`;

  it('leaves no _into function and no _into call in the WGSL or the GLSL', () => {
    const { result } = bothTake(SOURCE);
    const text = [result.wgsl ?? '', result.glsl?.fragment ?? '', result.glsl?.vertex ?? ''];
    expect(text[0]).toContain('fn fs');
    for (const t of text) {
      expect(t).not.toContain('_into(');
      expect(t).not.toContain('_into');
      expect(t).not.toContain('Ray_new');
    }
  });

  it('computes the same values with and without the pass', () => {
    const m = bothTake(`${SOURCE}
export function probe(a: f32, b: f32, c: f32): f32 {
  let t = 0;
  for (let i = 0; i < 4; i++) { const r = new Ray(vec2(a + f32(i), b), vec2(f32(i), c)); t += r.origin.x * r.direction.y; }
  return t;
}`).result.module;
    same(m, inlineSmall(m));
    expect(emitModule(m)).not.toContain('_into');
  });
});
