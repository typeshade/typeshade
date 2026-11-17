// Verifies: Rule 6.2 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { compile } from './compile.js';
import { typeKey } from '../../core/ir/types.js';
import type { Expr, Stmt } from '../../core/ir/nodes.js';

const STRUCTS = `
  class P {
    a: f32
    b: f32
  }
`;

function lowerBody(source: string): readonly Stmt[] {
  const r = compileTsSource(`"use typeshade";\n${source}`);
  expect(r.diagnostics).toEqual([]);
  return r.funcs[0]!.body;
}

function diagnose(source: string): string {
  const r = compileTsSource(`"use typeshade";\n${source}`);
  expect(r.diagnostics.length).toBeGreaterThan(0);
  return r.diagnostics[0]!.message;
}

function expectMember(e: Expr, field: string, type: string, base: (x: Expr) => void): void {
  expect(e.op).toBe('member');
  if (e.op !== 'member') return;
  expect(e.field).toBe(field);
  expect(typeKey(e.type)).toBe(type);
  base(e.base);
}

const varref = (name: string, type: string) => (x: Expr) => {
  expect(x.op).toBe('varref');
  if (x.op === 'varref') expect(x.name).toBe(name);
  expect(typeKey(x.type)).toBe(type);
};

describe('component assignment', () => {
  it('lowers v.x = a to an assign whose target is a member of the var', () => {
    const body = lowerBody(`
      export function f(a: f32): vec3 {
        let v = vec3(0.);
        v.x = a;
        return v;
      }
    `);
    const s = body[1]!;
    expect(s.s).toBe('assign');
    if (s.s !== 'assign') return;
    expectMember(s.target, 'x', 'f32', varref('v', 'vec3<f32>'));
    expect(s.expr.op).toBe('param');
  });

  it('accepts an rgba component and keeps the spelling the author wrote', () => {
    const body = lowerBody(`
      export function f(a: f32): vec4 {
        let c = vec4(0.);
        c.r = a;
        c.a = 1.;
        return c;
      }
    `);
    const first = body[1]!;
    const second = body[2]!;
    if (first.s !== 'assign' || second.s !== 'assign') throw new Error('expected two assigns');
    expectMember(first.target, 'r', 'f32', varref('c', 'vec4<f32>'));
    expectMember(second.target, 'a', 'f32', varref('c', 'vec4<f32>'));
  });

  it('lowers v.x += 1. to an assignOp on the member', () => {
    const body = lowerBody(`
      export function f(): vec3 {
        let v = vec3(0.);
        v.x += 1.;
        return v;
      }
    `);
    const s = body[1]!;
    expect(s.s).toBe('assignOp');
    if (s.s !== 'assignOp') return;
    expect(s.bop).toBe('+');
    expectMember(s.target, 'x', 'f32', varref('v', 'vec3<f32>'));
    expect(s.expr).toEqual({ op: 'lit', type: expect.anything(), value: 1 });
    expect(typeKey(s.expr.type)).toBe('f32');
  });

  it('takes the component kind for a bare integer literal in v.x += 1', () => {
    const body = lowerBody(`
      export function f(): vec3u {
        let v = vec3u(u32(1), u32(2), u32(3));
        v.x += 1;
        return v;
      }
    `);
    const s = body[1]!;
    if (s.s !== 'assignOp') throw new Error(`expected an assignOp, got ${s.s}`);
    expect(typeKey(s.expr.type)).toBe('u32');
  });

  it('lowers v.z++ to an assignOp, so the target is written once', () => {
    const body = lowerBody(`
      export function f(): vec3 {
        let v = vec3(0.);
        v.z++;
        return v;
      }
    `);
    const s = body[1]!;
    if (s.s !== 'assignOp') throw new Error(`expected an assignOp, got ${s.s}`);
    expect(s.bop).toBe('+');
    expectMember(s.target, 'z', 'f32', varref('v', 'vec3<f32>'));
    expect(s.expr).toEqual({ op: 'lit', type: expect.anything(), value: 1 });
  });

  it('keeps a bare name on the assign-of-binop form, so its emit does not move', () => {
    const body = lowerBody(`
      export function f(): i32 {
        let i: i32 = 0;
        i++;
        return i;
      }
    `);
    const s = body[1]!;
    if (s.s !== 'assign') throw new Error(`expected an assign, got ${s.s}`);
    expect(s.expr.op).toBe('binop');
  });

  it('rejects ++ on a target there is nothing to add 1 to', () => {
    expect(
      diagnose(`
        export function f(): bool {
          let b = true;
          b++;
          return b;
        }
      `),
    ).toBe('Cannot apply ++ to bool: ++ steps a numeric scalar (f32, i32, u32, f64).');
    expect(
      diagnose(`
        ${STRUCTS}
        export function f(x: f32): f32 {
          let p: P = { a: x, b: 0. };
          p--;
          return p.a;
        }
      `),
    ).toBe('Cannot apply -- to P: -- steps a numeric scalar (f32, i32, u32, f64).');
  });
});

describe('field assignment', () => {
  it('lowers o.a = x on a struct local', () => {
    const body = lowerBody(`
      ${STRUCTS}
      export function f(x: f32): f32 {
        let p: P = { a: 0., b: 0. };
        p.a = x;
        return p.a;
      }
    `);
    const s = body[1]!;
    if (s.s !== 'assign') throw new Error(`expected an assign, got ${s.s}`);
    expectMember(s.target, 'a', 'f32', varref('p', 'struct:P'));
  });

  it('lowers a field of an element: ps[i].a = 1.', () => {
    const body = lowerBody(`
      ${STRUCTS}
      declare const ps: storage<array<P>, "read_write">
      @compute([64, 1, 1]) export function k(gid: builtin<"global_invocation_id">) {
        ps[gid.x].a = 1.;
      }
    `);
    const s = body[0]!;
    if (s.s !== 'assign') throw new Error(`expected an assign, got ${s.s}`);
    expect(s.target.op).toBe('member');
    if (s.target.op !== 'member') return;
    expect(s.target.field).toBe('a');
    expect(s.target.base.op).toBe('index');
  });

  it('lowers a component of a field: o.pos.x = 2.', () => {
    const body = lowerBody(`
      interface VsOut {
        pos: builtin<"position">
        uv: location<0, vec2>
      }
      @vertex export function vs(p: location<0, vec2>): VsOut {
        let o: VsOut = { pos: vec4(p, 0., 1.), uv: p };
        o.pos.x = 2.;
        return o;
      }
    `);
    const s = body[1]!;
    if (s.s !== 'assign') throw new Error(`expected an assign, got ${s.s}`);
    expect(s.target.op).toBe('member');
    if (s.target.op !== 'member') return;
    expect(s.target.field).toBe('x');
    expect(s.target.base.op).toBe('member');
    if (s.target.base.op !== 'member') return;
    expect(s.target.base.field).toBe('pos');
  });
});

describe('emitted text', () => {
  const RENDER = `
    "use typeshade";
    interface VsOut {
      pos: builtin<"position">;
      uv: location<0, vec2>;
    }
    interface Color {
      color: location<0, vec4>;
    }
    @vertex export function vs(p: location<0, vec2>): VsOut {
      let o: VsOut = { pos: vec4(p, 0., 1.), uv: p };
      o.pos.x = o.pos.x * 2.;
      return o;
    }
    @fragment export function fs(v: VsOut): Color {
      let c = vec4(0.);
      c.r = v.uv.x;
      c.a = 1.;
      return { color: c };
    }
  `;

  it('emits the member assignment verbatim in WGSL', () => {
    const c = compile(RENDER);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(c.wgsl).toContain('o.pos.x = (o.pos.x * 2.0);');
    expect(c.wgsl).toContain('c.r = v.uv.x;');
    expect(c.wgsl).toContain('c.a = 1.0;');
  });

  it('emits the member assignment verbatim in GLSL ES 3.00', () => {
    const c = compile(RENDER);
    expect(c.glsl?.vertex).toContain('o.pos.x = (o.pos.x * 2.0);');
    expect(c.glsl?.fragment).toContain('c.r = uv.x;');
    expect(c.glsl?.fragment).toContain('c.a = 1.0;');
  });

  it('emits a compound component assignment as WGSL `+=`', () => {
    const c = compile(`
      "use typeshade";
      export function f(): vec3 {
        let v = vec3(0.);
        v.x += 1.;
        return v;
      }
    `);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(c.wgsl).toContain('v.x += 1.0;');
  });

  it('emits a field write through an element in WGSL', () => {
    const c = compile(`
      "use typeshade";
      ${STRUCTS}
      declare const ps: storage<array<P>, "read_write">
      @compute([64, 1, 1]) export function k(gid: builtin<"global_invocation_id">) {
        ps[gid.x].a = 1.;
        ps[gid.x].b += 2.;
      }
    `);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(c.wgsl).toContain('ps[gid.x].a = 1.0;');
    expect(c.wgsl).toContain('ps[gid.x].b += 2.0;');
  });
});
