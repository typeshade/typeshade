import { describe, expect, it } from 'vitest';
import { selectAsMix } from './glsl-select.js';
import type { Expr, ModuleDecl, ShaderType } from '../ir/index.js';

const f32: ShaderType = { kind: 'scalar', scalar: 'f32' };
const i32: ShaderType = { kind: 'scalar', scalar: 'i32' };
const bool: ShaderType = { kind: 'scalar', scalar: 'bool' };
const vec3f: ShaderType = { kind: 'vec', elem: 'f32', n: 3 };
const vec3b: ShaderType = { kind: 'vec', elem: 'bool', n: 3 };
const name = (n: string, type: ShaderType): Expr => ({ op: 'varref', name: n, type });

function picked(type: ShaderType, condType: ShaderType = bool): Expr {
  const select: Expr = {
    op: 'select',
    type,
    cond: name('c', condType),
    ifTrue: name('t', type),
    ifFalse: name('f', type),
  };
  const m = {
    funcs: [{ name: 'g', params: [], ret: type, body: [{ s: 'return', expr: select }] }],
  } as unknown as ModuleDecl;
  const ret = selectAsMix(m).funcs[0]!.body[0]!;
  return (ret as { expr: Expr }).expr;
}

describe('a GLSL select evaluates both values, as WGSL select does', () => {
  it('spells a float pick with a bool condition as mix', () => {
    expect(picked(f32)).toMatchObject({
      op: 'call',
      fn: 'mix',
      args: [{ name: 'f' }, { name: 't' }, { name: 'c' }],
    });
  });
  it('widens a bool condition to a bvec for a float vector', () => {
    expect(picked(vec3f)).toMatchObject({
      op: 'call',
      fn: 'mix',
      args: [{ name: 'f' }, { name: 't' }, { op: 'construct', type: vec3b, args: [{ name: 'c' }] }],
    });
  });
  it('leaves a bvec condition to the per-component spelling', () => {
    expect(picked(vec3f, vec3b)).toMatchObject({ op: 'select' });
  });
  it('keeps the ternary for an integer pick, which GLSL ES 3.00 mix does not take', () => {
    expect(picked(i32)).toMatchObject({ op: 'select' });
  });
});
