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

const build = (helpers: string, body: string): ModuleDecl => {
  const halves = bothTake(`${PRELUDE}
${helpers}
export function probe(a: f32, b: f32, c: f32): f32 { ${body} }
@fragment
export function fs(v: VsOut): Color { return { color: vec4(v.uv, 0, 1) }; }`);
  return halves.result.module;
};

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

describe('inlineSmall', () => {
  it('inlines a helper with several returns that is called once', () => {
    const m = build(
      `function pick(x: f32, y: f32): f32 { if (x > y) { return x - y; } return y * 2; }`,
      'return pick(a, b) + c;',
    );
    const out = inlineSmall(m);
    expect(names(out)).not.toContain('pick');
    same(m, out);
  });

  it('inlines an if and else that both return', () => {
    const m = build(
      `function pick(x: f32, y: f32): f32 { if (x > y) { return x; } else { return y; } }`,
      'return pick(a, b) + pick(b, c) + pick(a, c);',
    );
    const out = inlineSmall(m);
    expect(names(out)).not.toContain('pick');
    same(m, out);
  });

  it('inlines a helper that returns an array', () => {
    const m = build(
      `function two(x: f32, y: f32): [f32, f32] { return [y, x]; }`,
      'const t = two(a, b); return t[0] * 2 + t[1];',
    );
    const out = inlineSmall(m);
    expect(names(out)).not.toContain('two');
    same(m, out);
  });

  it('keeps the count and the order of an argument that holds a call', () => {
    const m = build(
      `function inner(x: f32): f32 { return x * x + x * 3 + x / 5 + x * 7 + x - 1 + x * 11 + x * 13; }
function twice(x: f32): f32 { const y = x + 1; return y * y; }`,
      'return twice(inner(a)) + twice(inner(b));',
    );
    const out = inlineSmall(m);
    same(m, out);
    const calls = JSON.stringify(out.funcs.find((f) => f.name === 'probe')!.body).match(
      /"fn":"inner"/g,
    );
    expect(calls?.length ?? 0).toBe(2);
  });

  it('inlines a helper that assigns its own parameter into a copy', () => {
    const m = build(
      `function bump(x: f32): f32 { x = x + 1; x = x * 2; return x; }`,
      'const r = bump(a); return r + a;',
    );
    const out = inlineSmall(m);
    expect(names(out)).not.toContain('bump');
    same(m, out);
  });

  it('does not inline a recursive helper', () => {
    const m = build(`function rec(x: f32): f32 { return x * 2; }`, 'return rec(a);');
    const recursive: ModuleDecl = {
      ...m,
      funcs: m.funcs.map((f) =>
        f.name === 'rec'
          ? {
              ...f,
              body: [
                {
                  s: 'return',
                  expr: {
                    op: 'call',
                    type: f.ret,
                    fn: 'rec',
                    args: [{ op: 'param', type: f.params[0]!.type, name: f.params[0]!.name }],
                  },
                },
              ],
            }
          : f,
      ),
    };
    expect(names(inlineSmall(recursive))).toContain('rec');
  });

  it('does not inline an entry point', () => {
    const m = build(`function id(x: f32): f32 { return x; }`, 'return id(a);');
    expect(names(inlineSmall(m))).toContain('fs');
  });

  it('does not inline an opaque helper', () => {
    const m = build(
      `function pick(x: f32, y: f32): f32 { if (x > y) { return x - y; } return y * 2; }`,
      'return pick(a, b);',
    );
    const opaque: ModuleDecl = {
      ...m,
      funcs: m.funcs.map((f) => (f.name === 'pick' ? { ...f, opaque: true } : f)),
    };
    expect(names(inlineSmall(opaque))).toContain('pick');
  });

  it('does not inline a helper that holds a loop', () => {
    const m = build(
      `function acc(x: f32): f32 { let s = 0.0; for (let i = 0; i < 4; i++) { s += x; } return s; }`,
      'return acc(a);',
    );
    expect(names(inlineSmall(m))).toContain('acc');
  });

  it('does not inline a helper that takes a derivative', () => {
    const m = build(`function slope(x: f32): f32 { return dpdx(x) * 2; }`, 'return slope(a);');
    expect(names(inlineSmall(m))).toContain('slope');
  });

  it('does not inline a helper that calls a helper that takes a derivative', () => {
    const m = build(
      `function slope(x: f32): f32 { return dpdx(x) * 2; }
function outer(x: f32): f32 { return slope(x) + 1; }`,
      'return outer(a);',
    );
    const out = inlineSmall(m);
    expect(names(out)).toContain('slope');
    expect(names(out)).toContain('outer');
  });

  it('does not inline a helper that writes the caller object', () => {
    const m = build(
      `class P { x: f32; }
function bumpP(p: P): void { p.x = p.x + 1; }`,
      'let p = new P(); p.x = a; bumpP(p); return p.x;',
    );
    expect(names(inlineSmall(m))).toContain('bumpP');
  });
});

describe('inlineSmall through compile()', () => {
  const SOURCE = `"use typeshade";
interface VsOut { pos: builtin<"position">; uv: vec2; }
interface Color { color: vec4; }
function swap(a: f32, b: f32): [f32, f32] { return [b, a]; }
function order(lo: f32, hi: f32): [f32, f32] { return lo > hi ? swap(lo, hi) : [lo, hi]; }
@vertex
export function vs(vi: builtin<"vertex_index">): VsOut {
  const p: vec2 = vec2(f32(vi), 0);
  return { pos: vec4(p, 0, 1), uv: p };
}
@fragment
export function fs(v: VsOut): Color {
  let a = v.uv.x;
  let b = v.uv.y;
  [a, b] = order(a, b);
  return { color: vec4(a, b, 0, 1) };
}
export function probe(a: f32, b: f32): f32 {
  let x = a;
  let y = b;
  [x, y] = order(x, y);
  return x * 10 + y;
}`;

  it('leaves no swap, order, swap_into, _list or _sel0 in the WGSL or the GLSL', () => {
    const { result, editor } = bothTake(SOURCE);
    expect(editor).toEqual([]);
    const text = [result.wgsl ?? '', result.glsl?.fragment ?? '', result.glsl?.vertex ?? ''];
    for (const t of text)
      for (const word of ['swap', 'order', 'swap_into', '_list[', '_sel0', 'array<f32, 2>'])
        expect(t).not.toContain(word);
    expect(text[0]).toContain('fn fs');
  });

  it('computes the same values with and without the pass', () => {
    const { result } = bothTake(SOURCE);
    const m = result.module;
    const run = (x: ModuleDecl) => compileModule(x).fns.probe! as (...a: number[]) => number;
    expect(run(inlineSmall(m))(3, 1)).toEqual(run(m)(3, 1));
    expect(run(inlineSmall(m))(1, 3)).toEqual(run(m)(1, 3));
    expect(emitModule(inlineSmall(m))).not.toContain('fn swap');
  });
});
