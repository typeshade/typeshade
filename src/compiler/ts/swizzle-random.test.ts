import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { typeKey } from '../../core/ir/types.js';
import { parseSwizzle } from './swizzle.js';
import { vec2fT, vec3fT, vec4fT, f32T } from '../../core/ir/types.js';
import { stripSpans } from '../../core/testing/strip-spans.js';

describe('swizzle', () => {
  it('parses .yx and rejects mix/range', () => {
    const ok = parseSwizzle(vec3fT, 'yx');
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(typeKey(ok.type)).toBe('vec2<f32>');
    expect(parseSwizzle(vec2fT, 'z').ok).toBe(false);
    expect(parseSwizzle(vec3fT, 'xg').ok).toBe(false);
    expect(parseSwizzle(f32T, 'x').ok).toBe(false);
  });

  it('allows .xx duplicate and .rgba on vec4', () => {
    const xx = parseSwizzle(vec2fT, 'xx');
    expect(xx.ok).toBe(true);
    const rgba = parseSwizzle(vec4fT, 'rgba');
    expect(rgba.ok).toBe(true);
    if (rgba.ok) expect(typeKey(rgba.type)).toBe('vec4<f32>');
  });

  it('lowers v.yxz to member', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(a: f32): vec3 {
        const v = vec3(a, 1, 2);
        return v.yxz;
      }
    `);
    expect(r.diagnostics).toEqual([]);
    const ret = r.funcs[0]!.body[1];
    expect(ret!.s).toBe('return');
    expect(ret!.s === 'return' && ret.expr?.op === 'member' && ret.expr.field).toBe('yxz');
    expect(ret!.s === 'return' && ret.expr !== undefined && typeKey(ret.expr.type)).toBe(
      'vec3<f32>',
    );
  });

  it('refuses v.swizzle("yxz"): a vector has no such method, and the IR builder is no source', () => {
    // `.swizzle()` is the IR builder's method (src/core/ir/swizzle.test.ts). It is not WGSL, not
    // ECMAScript and no §9.3 row, so it is no name an author writes (Rule 2.1, Rule 2.2), and the
    // editor already said so (TS2339). It compiled here because a call was routed by its name.
    const r = compileTsSource(`
      "use typeshade";
      export function f(a: f32): vec3 {
        const v = vec3(a, 1, 2);
        return v.swizzle("yxz");
      }
    `);
    expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
      `TS8022 vec3 has no method "swizzle": a swizzle is written as a member, v.yxz.`,
    ]);
  });

  it('names the builtin a method of a vector is, and the components otherwise', () => {
    // A vector has no method at all (Rule 2.2); `v.length()` is the builtin `length(v)`, and the
    // sentence names it rather than a component, which is not what the author meant.
    const said = (call: string) =>
      compileTsSource(`
      "use typeshade";
      export function f(v: vec3, w: vec3): f32 {
        const r = ${call};
        return 1.;
      }
    `).diagnostics.map((d) => `${d.code} ${d.message}`);
    expect(said('v.length()')).toEqual([
      `TS8022 vec3 has no method "length": call the builtin, length(v).`,
    ]);
    expect(said('v.dot(w)')).toEqual([
      `TS8022 vec3 has no method "dot": call the builtin, dot(v, w).`,
    ]);
    expect(said('v.foo()')).toEqual([
      `TS8022 vec3 has no method "foo": a vector's members are its components, v.x or v.xy.`,
    ]);
    // What each names compiles in its place.
    for (const remedy of ['length(v)', 'dot(v, w)', 'v.x']) expect(said(remedy)).toEqual([]);
  });

  it('names a builtin call only when that call compiles, a scalar splat to the vector', () => {
    // Each named the call as written, which the compiler then refused: `clamp(v, 0., 1.)` is
    // TS8036, `sqrt(v)` on a vec3u takes no integer, and `v.xyzw` is out of range on a vec3;
    // `b.any()` was told about components, although `any(b)` compiles (Rule 12.1).
    const said = (params: string, call: string) =>
      compileTsSource(`
      "use typeshade";
      export function f(${params}): f32 {
        const r = ${call};
        return 1.;
      }
    `).diagnostics.map((d) => `${d.code} ${d.message}`);
    const cases: [string, string, string, string | undefined][] = [
      [
        'v: vec3',
        'v.clamp(0., 1.)',
        'vec3 has no method "clamp": call the builtin, clamp(v, vec3(0.), vec3(1.)).',
        'clamp(v, vec3(0.), vec3(1.))',
      ],
      [
        'v: vec3',
        'v.max(0.)',
        'vec3 has no method "max": call the builtin, max(v, 0.).',
        'max(v, 0.)',
      ],
      ['b: vec3b', 'b.any()', 'vec3b has no method "any": call the builtin, any(b).', 'any(b)'],
      [
        'v: vec3u',
        'v.sqrt()',
        `vec3u has no method "sqrt": a vector's members are its components, v.x or v.xy.`,
        undefined,
      ],
      [
        'v: vec3',
        'v.swizzle("xyzw")',
        `vec3 has no method "swizzle": a vector's members are its components, v.x or v.xy.`,
        undefined,
      ],
    ];
    for (const [params, call, message, remedy] of cases) {
      expect(said(params, call), call).toEqual([`TS8022 ${message}`]);
      if (remedy !== undefined) expect(said(params, remedy), remedy).toEqual([]);
    }
  });

  it('diagnoses mixed swizzle in source', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(a: f32): f32 {
        const v = vec3(a, 1, 2);
        return v.xg;
      }
    `);
    expect(r.diagnostics.some((d) => /mixes xyzw and rgba/.test(d.message))).toBe(true);
  });
});

describe('random(seed)', () => {
  it('lowers random(x) to fract(sin(x)*k)', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(x: f32): f32 {
        return random(x);
      }
    `);
    expect(r.diagnostics).toEqual([]);
    const ret = r.funcs[0]!.body[0];
    expect(ret!.s).toBe('return');
    if (ret!.s === 'return' && ret.expr) {
      expect(ret.expr.op).toBe('call');
      if (ret.expr.op === 'call') expect(ret.expr.fn).toBe('fract');
    }
  });

  it('lowers random(uv) via dot', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(uv: vec2): f32 {
        return random(uv);
      }
    `);
    expect(r.diagnostics).toEqual([]);
    const ret = r.funcs[0]!.body[0];
    if (ret!.s === 'return' && ret.expr && ret.expr.op === 'call') {
      expect(ret.expr.fn).toBe('fract');
    }
  });

  it('Math.random(x) aliases random(x)', () => {
    const a = compileTsSource(
      `"use typeshade"; export function f(x: f32): f32 { return random(x); }`,
    );
    const b = compileTsSource(
      `"use typeshade"; export function f(x: f32): f32 { return Math.random(x); }`,
    );
    expect(a.diagnostics).toEqual([]);
    expect(b.diagnostics).toEqual([]);
    expect(stripSpans(a.funcs[0]!.body)).toEqual(stripSpans(b.funcs[0]!.body));
  });

  it('rejects argument-less random()', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): f32 { return random(); }
    `);
    expect(r.diagnostics.some((d) => /seed/.test(d.message))).toBe(true);
  });
});
