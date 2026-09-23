// Vector against scalar broadcast in "use typeshade" arithmetic (#8 A1): `v * s`, `s * v`,
// `v += s` and friends take a scalar of the vector's element kind, as WGSL, GLSL ES 3.00 and
// the fn() EDSL do. The literal on the scalar side takes the vector's element kind.

import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { compile } from './compile.js';
import { typeKey } from '../../core/ir/types.js';
import type { Expr, Stmt } from '../../core/ir/nodes.js';

function lowerReturn(body: string, params: string, ret: string): Expr {
  const r = compileTsSource(`
    "use typeshade";
    export function f(${params}): ${ret} {
      return ${body};
    }
  `);
  expect(r.diagnostics).toEqual([]);
  const stmt = r.funcs[0]!.body[0]!;
  if (stmt.s !== 'return' || !stmt.expr) throw new Error(`expected a return, got ${stmt.s}`);
  return stmt.expr;
}

function diagnose(body: string, params: string, ret: string): string {
  const r = compileTsSource(`
    "use typeshade";
    export function f(${params}): ${ret} {
      return ${body};
    }
  `);
  expect(r.diagnostics.length).toBeGreaterThan(0);
  return r.diagnostics[0]!.message;
}

function expectBinop(
  e: Expr,
  bop: string,
  type: string,
  a: (x: Expr) => void,
  b: (x: Expr) => void,
): void {
  expect(e.op).toBe('binop');
  if (e.op !== 'binop') return;
  expect(e.bop).toBe(bop);
  expect(typeKey(e.type)).toBe(type);
  a(e.a);
  b(e.b);
}

const param = (name: string, type: string) => (x: Expr) => {
  expect(x.op).toBe('param');
  if (x.op === 'param') expect(x.name).toBe(name);
  expect(typeKey(x.type)).toBe(type);
};
const lit = (value: number, type: string) => (x: Expr) => {
  expect(x).toEqual({ op: 'lit', type: expect.anything(), value });
  expect(typeKey(x.type)).toBe(type);
};

describe('vector against scalar broadcast', () => {
  const V_S = 'v: vec3, s: f32';

  it.each(['+', '-', '*', '/', '%'])('lowers v %s s to a vec3<f32> binop', (op) => {
    const e = lowerReturn(`v ${op} s`, V_S, 'vec3');
    expectBinop(e, op, 'vec3<f32>', param('v', 'vec3<f32>'), param('s', 'f32'));
  });

  it('keeps the scalar on the left for s * v', () => {
    const e = lowerReturn('s * v', V_S, 'vec3');
    expectBinop(e, '*', 'vec3<f32>', param('s', 'f32'), param('v', 'vec3<f32>'));
  });

  it('emits s * v in that order in WGSL', () => {
    const c = compile(`
      "use typeshade";
      export function f(v: vec3, s: f32): vec3 {
        return s * v;
      }
    `);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(c.wgsl).toMatch(/return \(s \* v\);/);
    expect(c.wgsl).not.toMatch(/v \* s/);
  });

  it('broadcasts a swizzle: c.rgb * 0.5', () => {
    const e = lowerReturn('c.rgb * 0.5', 'c: vec4', 'vec3');
    expect(e.op).toBe('binop');
    if (e.op !== 'binop') return;
    expect(e.bop).toBe('*');
    expect(typeKey(e.type)).toBe('vec3<f32>');
    expect(typeKey(e.a.type)).toBe('vec3<f32>');
    lit(0.5, 'f32')(e.b);
  });

  it('accepts the Playground case vec4(0.) * Math.PI', () => {
    const e = lowerReturn('vec4(0.) * Math.PI', '', 'vec4');
    expect(e.op).toBe('binop');
    if (e.op !== 'binop') return;
    expect(typeKey(e.type)).toBe('vec4<f32>');
    expect(e.a.op).toBe('construct');
    lit(Math.PI, 'f32')(e.b);
  });

  it('types the literal in v * 2 as f32 for a vec3<f32>', () => {
    const e = lowerReturn('v * 2', V_S, 'vec3');
    expectBinop(e, '*', 'vec3<f32>', param('v', 'vec3<f32>'), lit(2, 'f32'));
  });

  it('types the literal in v * 2 as u32 for a vec3<u32>', () => {
    const e = lowerReturn('v * 2', 'v: vec3u', 'vec3u');
    expectBinop(e, '*', 'vec3<u32>', param('v', 'vec3<u32>'), lit(2, 'u32'));
  });

  it('types the literal as u32 against a constructed vec3<u32>', () => {
    // A bare `vec3u(1, 2, 3)` is item A3 (an integer literal taking the constructor's element
    // kind) and still diagnoses on its own; the cast spelling exercises the same broadcast.
    const e = lowerReturn('vec3u(u32(1), u32(2), u32(3)) * 2', '', 'vec3u');
    expect(e.op).toBe('binop');
    if (e.op !== 'binop') return;
    expect(typeKey(e.type)).toBe('vec3<u32>');
    expect(e.a.op).toBe('construct');
    lit(2, 'u32')(e.b);
  });

  it('diagnoses a non-integer literal against an integer vector instead of truncating', () => {
    const m = diagnose('v * 2.5', 'v: vec3u', 'vec3u');
    expect(m).toMatch(/vec3<u32> and f32/);
    expect(m).toMatch(/own element type/);
    expect(m).toMatch(/u32\(x\)/);
    // vec3(v) does not compile (there is no element-converting constructor, #8 A8), so the
    // message must not suggest it.
    expect(m).not.toMatch(/vec3\(/);
  });

  it('types a literal against a vec64 as f64 with the full double', () => {
    const e = lowerReturn('v * 0.1', 'v: vec3f64', 'vec3f64');
    expectBinop(e, '*', 'vec3<f64>', param('v', 'vec3<f64>'), lit(0.1, 'f64'));
    const n = lowerReturn('v * -2', 'v: vec3d', 'vec3d');
    expectBinop(n, '*', 'vec3<f64>', param('v', 'vec3<f64>'), lit(-2, 'f64'));
    const pi = lowerReturn('Math.PI * v', 'v: vec3d', 'vec3d');
    expectBinop(pi, '*', 'vec3<f64>', lit(Math.PI, 'f64'), param('v', 'vec3<f64>'));
  });

  it('keeps an explicit f32() cast against a vec64 as f32', () => {
    const e = lowerReturn('v * f32(0.1)', 'v: vec3f64', 'vec3f64');
    expectBinop(e, '*', 'vec3<f64>', param('v', 'vec3<f64>'), lit(0.1, 'f32'));
  });

  it('emits the low half of a double literal against a vec64', () => {
    const c = compile(`
      "use typeshade";
      export function f(v: vec3f64): vec3f64 {
        return v * 0.1;
      }
    `);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    // An f32 literal widened as (f32(0.1), 0.0) would print a zero low half; the f64 literal
    // keeps the ~-1.49e-9 remainder the df64 emulation exists for.
    expect(c.wgsl).toMatch(/vec2<f32>\(0\.10000000149011612, -1\.4901161415892261e-9\)/);
  });

  it('does not change scalar against scalar literal typing', () => {
    const e = lowerReturn('i + 1', 'i: u32', 'u32');
    expectBinop(e, '+', 'u32', param('i', 'u32'), lit(1, 'u32'));
    const f = lowerReturn('x * 2', 'x: f32', 'f32');
    expectBinop(f, '*', 'f32', param('x', 'f32'), lit(2, 'f32'));
  });
});

describe('compound assignment with a vector target', () => {
  function lowerBody(body: string, params: string, ret: string): readonly Stmt[] {
    const r = compileTsSource(`
      "use typeshade";
      export function f(${params}): ${ret} {
        ${body}
      }
    `);
    expect(r.diagnostics).toEqual([]);
    return r.funcs[0]!.body;
  }

  it('v += 1. is an assignOp with an f32 literal', () => {
    const body = lowerBody('let w = v; w += 1.; return w;', 'v: vec3', 'vec3');
    const s = body[1]!;
    expect(s.s).toBe('assignOp');
    if (s.s !== 'assignOp') return;
    expect(s.bop).toBe('+');
    expect(typeKey(s.target.type)).toBe('vec3<f32>');
    lit(1, 'f32')(s.expr);
  });

  it('v *= s is an assignOp with the scalar operand', () => {
    const body = lowerBody('let w = v; w *= s; return w;', 'v: vec3, s: f32', 'vec3');
    const s = body[1]!;
    expect(s.s).toBe('assignOp');
    if (s.s !== 'assignOp') return;
    expect(s.bop).toBe('*');
    param('s', 'f32')(s.expr);
  });

  it('v /= s and v *= 2. follow the same rule', () => {
    const body = lowerBody('let w = v; w /= s; w *= 2.; return w;', 'v: vec3, s: f32', 'vec3');
    expect(body.map((s) => s.s)).toEqual(['var', 'assignOp', 'assignOp', 'return']);
  });

  it('v *= 2 on a vec3<u32> target types the literal as u32', () => {
    const body = lowerBody('let w = v; w *= 2; return w;', 'v: vec3u', 'vec3u');
    const s = body[1]!;
    if (s.s === 'assignOp') lit(2, 'u32')(s.expr);
    else throw new Error(`expected assignOp, got ${s.s}`);
  });

  it('rejects v *= 2.5 on a vec3<u32> target', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(v: vec3u): vec3u {
        let w = v; w *= 2.5; return w;
      }
    `);
    expect(r.diagnostics.some((d) => /vec3<u32> and f32/.test(d.message))).toBe(true);
  });

  it('rejects a vector value on a scalar target and says why', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(v: vec3, s: f32): f32 {
        let t = s; t += v; return t;
      }
    `);
    expect(r.diagnostics.length).toBe(1);
    const m = r.diagnostics[0]!.message;
    expect(m).toMatch(/Type mismatch: cannot \+= f32 and vec3<f32>/);
    // The op is one of + - * / %, so the message must not claim it is the operator that is
    // wrong; it is the vector result that the scalar target cannot hold.
    expect(m).toMatch(/result would be vec3<f32>/);
    expect(m).not.toMatch(/only through/);
  });

  it('leaves plain assignment strict and names the splat that compiles', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(v: vec3, s: f32): vec3 {
        let w = v; w = s; return w;
      }
    `);
    expect(r.diagnostics.some((d) => /assign to vec3<f32>/.test(d.message))).toBe(true);
    expect(r.diagnostics[0]!.message).toMatch(/vec3\(x\)/);
    const ok = compileTsSource(`
      "use typeshade";
      export function f(v: vec3, s: f32): vec3 {
        let w = v; w = vec3(s); return w;
      }
    `);
    expect(ok.diagnostics).toEqual([]);
  });
});

describe('compound assignment with a vec64 target', () => {
  // The fp64 pass lowers an assignOp on a vec64 target only when the value is a vec64 too
  // and throws SD0041 for a scalar, so the frontend spells `w *= s` as `w = w * s`, which
  // takes the binop arm that widens the scalar.
  function lower(body: string, params: string): readonly Stmt[] {
    const r = compileTsSource(`
      "use typeshade";
      export function f(${params}): vec3f64 {
        ${body}
      }
    `);
    expect(r.diagnostics).toEqual([]);
    return r.funcs[0]!.body;
  }

  it('w *= s with an f32 scalar becomes w = w * s', () => {
    const body = lower('let w = v; w *= s; return w;', 'v: vec3f64, s: f32');
    const s = body[1]!;
    expect(s.s).toBe('assign');
    if (s.s !== 'assign') return;
    expect(typeKey(s.target.type)).toBe('vec3<f64>');
    expectBinop(s.expr, '*', 'vec3<f64>', (a) => expect(a).toEqual(s.target), param('s', 'f32'));
  });

  it('w += 1. types the literal as f64', () => {
    const body = lower('let w = v; w += 1.; return w;', 'v: vec3d');
    const s = body[1]!;
    expect(s.s).toBe('assign');
    if (s.s !== 'assign') return;
    expectBinop(s.expr, '+', 'vec3<f64>', () => undefined, lit(1, 'f64'));
  });

  it('compiles and evaluates instead of failing in the fp64 pass', () => {
    const c = compile(`
      "use typeshade";
      export function f(v: vec3f64, s: f32): vec3f64 {
        let w = v; w *= s; w += 1.; return w;
      }
    `);
    expect(c.diagnostics).toEqual([]);
    expect(c.wgsl).toMatch(/w = df64_v3_mul\(w, /);
    expect(c.wgsl).toMatch(/w = df64_v3_add\(w, /);
    expect(c.eval('f', [[1, 2, 3], 2])).toEqual([3, 5, 7]);
  });

  it('still rejects %= on a vec64 target and says % has no f64 emulation', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(v: vec3f64, s: f32): vec3f64 {
        let w = v; w %= s; return w;
      }
    `);
    expect(r.diagnostics.length).toBe(1);
    expect(r.diagnostics[0]!.message).toMatch(/cannot %= vec3<f64> and f32/);
    expect(r.diagnostics[0]!.message).toMatch(/% has no f64 emulation/);
  });
});

describe('mismatch diagnostics for vectors', () => {
  it('names the scalar cast for vec3<f32> * u32 and no constructor that does not compile', () => {
    const m = diagnose('v * n', 'v: vec3, n: u32', 'vec3');
    expect(m).toMatch(/cannot \* vec3<f32> and u32/);
    expect(m).toMatch(/A vector takes a scalar of its own element type/);
    expect(m).toMatch(/f32\(x\)/);
    // vec3u(v) is rejected by the vector constructor (#8 A8), so it must not be suggested.
    expect(m).not.toMatch(/vec3u\(/);
    expect(m).not.toMatch(/f32\(\)\/i32\(\)\/u32\(\)/);
  });

  it('says vectors must have the same size for vec2 * vec3', () => {
    const m = diagnose('a * b', 'a: vec2, b: vec3', 'vec3');
    expect(m).toMatch(/vec2<f32> and vec3<f32>/);
    expect(m).toMatch(/same size/);
  });

  it('names the per-component cast for vec3 + vec3u', () => {
    const m = diagnose('a + b', 'a: vec3, b: vec3u', 'vec3');
    expect(m).toMatch(/vec3<f32> and vec3<u32>/);
    expect(m).toMatch(/same element type/);
    expect(m).toMatch(/a \+ vec3\(f32\(b\.x\), f32\(b\.y\), f32\(b\.z\)\)/);
    expect(m).not.toMatch(/vec3u\(/);
    const m2 = diagnose('a * b', 'a: vec2u, b: vec2', 'vec2u');
    expect(m2).toMatch(/a \* vec2u\(u32\(b\.x\), u32\(b\.y\)\)/);
  });

  it('every spelling the messages name compiles', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(v: vec3, n: u32, a: vec3, b: vec3u, w: vec3u): vec3 {
        const p = v * f32(n);
        const q = a + vec3(f32(b.x), f32(b.y), f32(b.z));
        const r = w * u32(2.5);
        return p + q + vec3(f32(r.x), f32(r.y), f32(r.z));
      }
    `);
    expect(r.diagnostics).toEqual([]);
  });

  it('says % has no f64 emulation for vec3<f64> % f32', () => {
    const m = diagnose('v % s', 'v: vec3d, s: f32', 'vec3d');
    expect(m).toMatch(/cannot % vec3<f64> and f32/);
    expect(m).toMatch(/% has no f64 emulation/);
    expect(m).not.toMatch(/Types must match\./);
  });

  it('keeps the scalar messages as they were', () => {
    expect(diagnose('a + b', 'a: i32, b: u32', 'i32')).toMatch(/no implicit integer conversion/);
    expect(diagnose('a + x', 'a: i32, x: f32', 'f32')).toMatch(/no implicit int\/float conversion/);
    expect(diagnose('a + flag', 'a: f32, flag: bool', 'f32')).toMatch(
      /Types must match, or cast with f32\(\)\/i32\(\)\/u32\(\)/,
    );
  });

  it('does not broadcast a scalar of another kind even with a matching size', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(v: vec3u, s: f32): vec3u { return v * s; }
    `);
    expect(r.diagnostics.length).toBe(1);
    expect(r.diagnostics[0]!.message).toMatch(/vec3<u32> and f32/);
  });
});

describe('backends', () => {
  const SRC = `
    "use typeshade";
    export function scale(v: vec3, s: f32): vec3 {
      return v * s;
    }
    export function flip(v: vec3, s: f32): vec3 {
      return s - v;
    }
  `;

  it('evaluates v * s and s - v on the CPU oracle with the broadcast semantics', () => {
    const c = compile(SRC);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(c.eval('scale', [[1, 2, 3], 2])).toEqual([2, 4, 6]);
    expect(c.eval('flip', [[1, 2, 3], 10])).toEqual([9, 8, 7]);
  });

  it('emits the binop in WGSL', () => {
    const c = compile(SRC);
    expect(c.wgsl).toMatch(/return \(v \* s\);/);
    expect(c.wgsl).toMatch(/return \(s - v\);/);
  });

  it('emits GLSL for a fragment that scales a vector by a scalar', () => {
    const c = compile(`
      "use typeshade";
      class Color {
        @location(0) color: vec4;
      }
      @fragment
      export function fs(): Color {
        const base = vec4(1., 0.5, 0.25, 1.);
        return { color: base * 0.5 };
      }
    `);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(c.wgsl).toMatch(/base \* 0\.5/);
    expect(c.glsl?.fragment).toMatch(/#version 300 es/);
    expect(c.glsl?.fragment).toMatch(/base \* 0\.5/);
    expect(c.eval('fs')).toEqual({ color: [0.5, 0.25, 0.125, 0.5] });
  });
});
