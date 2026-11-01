// The WGSL `mod` spelling writes each operand twice; an operand that holds a call goes through a
// helper instead, so the call runs once (#841, N2). See wgsl-mod.ts.

import { describe, it, expect } from 'vitest';
import { emitModule } from './wgsl.js';
import { emitGlslModule } from './glsl.js';
import { f32T, vec3fT, type ShaderType } from '../ir/types.js';
import type { Expr, FuncDecl, ModuleDecl } from '../ir/nodes.js';

const p = (name: string, type: ShaderType = f32T): Expr => ({ op: 'param', type, name });
const call = (fn: string, type: ShaderType, ...args: Expr[]): Expr => ({
  op: 'call',
  type,
  fn,
  args,
});
const mod = (x: Expr, y: Expr): Expr => call('mod', x.type, x, y);
const lit = (value: number): Expr => ({ op: 'lit', type: f32T, value });

const ret = (name: string, params: FuncDecl['params'], expr: Expr): FuncDecl => ({
  name,
  params,
  ret: expr.type,
  body: [{ s: 'return', expr }],
});
const mod1 = (...funcs: FuncDecl[]): ModuleDecl => ({
  consts: [],
  structs: [],
  bindings: [],
  funcs,
});
const ab: FuncDecl['params'] = [
  { name: 'a', type: f32T },
  { name: 'b', type: f32T },
];
const count = (text: string, needle: string): number => text.split(needle).length - 1;

describe('WGSL mod: an operand that holds a call is evaluated once', () => {
  it('routes the call through a helper with the same floor-mod arithmetic', () => {
    const wgsl = emitModule(
      mod1(ret('wrap', ab, mod(call('atan2', f32T, p('a'), p('b')), p('b')))),
    );
    expect(count(wgsl, 'atan2(')).toBe(1);
    expect(wgsl).toContain(
      'fn _mod_f32(x: f32, y: f32) -> f32 {\n  return (x - y * floor(x / y));\n}',
    );
    expect(wgsl).toContain('return _mod_f32(atan2(a, b), b);');
  });

  it('leaves a mod of names and literals inline', () => {
    const wgsl = emitModule(mod1(ret('wrap', ab, mod(p('a'), p('b')))));
    expect(wgsl).not.toContain('_mod_');
    expect(wgsl).toContain('return (a - b * floor(a / b));');
  });

  it('names a vector helper by both operand types when the modulus is a scalar', () => {
    const v: FuncDecl['params'] = [
      { name: 'v', type: vec3fT },
      { name: 'b', type: f32T },
    ];
    const wgsl = emitModule(mod1(ret('wrap', v, mod(call('sin', vec3fT, p('v', vec3fT)), p('b')))));
    expect(wgsl).toContain('fn _mod_v3f32_f32(x: vec3<f32>, y: f32) -> vec3<f32> {');
    expect(count(wgsl, 'sin(')).toBe(1);
  });

  it('shares one helper between nested calls of the same types', () => {
    const inner = mod(call('sin', f32T, p('a')), p('b'));
    const wgsl = emitModule(mod1(ret('wrap', ab, mod(inner, lit(3)))));
    expect(count(wgsl, 'fn _mod_f32(')).toBe(1);
    expect(count(wgsl, 'sin(')).toBe(1);
    expect(wgsl).toContain('_mod_f32(_mod_f32(sin(a), b), 3.0)');
  });

  it('picks a free name when the module already declares the helper name', () => {
    const taken = ret('_mod_f32', ab, p('a'));
    const wgsl = emitModule(mod1(taken, ret('wrap', ab, mod(call('sin', f32T, p('a')), p('b')))));
    expect(wgsl).toContain('fn _mod_f32_1(x: f32, y: f32) -> f32 {');
    expect(wgsl).toContain('return _mod_f32_1(sin(a), b);');
  });

  it("leaves a call to the module's own mod alone", () => {
    const own = ret('mod', ab, p('a'));
    const toOwn: Expr = { ...mod(call('sin', f32T, p('a')), p('b')), declRef: own } as Expr;
    const wgsl = emitModule(mod1(own, ret('wrap', ab, toOwn)));
    // WGSL predeclares `mod`, so the module's own function is spelled `mod_` and called as such.
    expect(wgsl).not.toContain('_mod_');
    expect(wgsl).toContain('return mod_(sin(a), b);');
  });

  it('leaves GLSL ES 3.00 on its native mod()', () => {
    const glsl = emitGlslModule(
      mod1(ret('wrap', ab, mod(call('atan2', f32T, p('a'), p('b')), p('b')))),
    );
    expect(glsl).not.toContain('_mod_');
    expect(count(glsl, 'atan(')).toBe(1);
  });
});
