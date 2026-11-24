import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { padUniformArrays } from '../../core/passes/uniform-layout.js';
import { UnsupportedFeatureError } from '../../core/backend.js';
import type { ModuleDecl } from '../../core/ir/nodes.js';
import { arrayT, f32T, structT } from '../../core/ir/types.js';

function compiled(source: string) {
  const c = compile(`"use typeshade"\n${source}`);
  expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return c;
}

function messages(source: string): string[] {
  return compile(`"use typeshade"\n${source}`)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => d.message);
}

describe('the padding keeps one wrapper per element type and rewrites nested reads', () => {
  it('shares one wrapper between two fields of one element type', () => {
    const c = compiled(`interface U { xs: array<f32, 2>; ys: array<f32, 3> }
declare const U_: uniform<U>
@fragment export function fs(): vec4 { return vec4(U_.xs[1] + U_.ys[2]) }`);
    expect(c.wgsl!.match(/struct _Pad16_f32 \{/g)).toHaveLength(1);
    expect(c.wgsl).toContain('@align(16) xs: array<_Pad16_f32, 2>,');
    expect(c.wgsl).toContain('@align(16) ys: array<_Pad16_f32, 3>,');
  });

  it('rewrites a padded read used as the index of another padded read', () => {
    const c = compiled(`interface U { xs: array<f32, 4>; ys: array<f32, 4> }
declare const U_: uniform<U>
@fragment export function fs(): vec4 { return vec4(U_.xs[i32(U_.ys[1])]) }`);
    expect(c.wgsl).toContain('U_.xs[i32(U_.ys[1].v)].v');
  });
});

describe('a whole-array write to a padded member is refused', () => {
  const U = `interface U { xs: array<f32, 2>; k: f32 }
declare const U_: uniform<U>`;

  it('refuses the write to a local of the uniform struct type', () => {
    const found = messages(`${U}
@fragment export function fs(): vec4 {
  const l: U = { xs: [0., 1.], k: 1. }
  l.xs = [2., 3.]
  return vec4(l.xs[0] + U_.k)
}`);
    expect(found.some((m) => m.includes("'xs' is a uniform-padded list"))).toBe(true);
    expect(found.some((m) => m.includes('cannot be assigned whole'))).toBe(true);
  });

  it('refuses the write inside a nested block', () => {
    const found = messages(`${U}
@fragment export function fs(): vec4 {
  const l: U = { xs: [0., 1.], k: 1. }
  if (U_.k > 0.) { for (let i = 0; i < 2; i++) { l.xs = [2., 3.] } }
  return vec4(l.xs[0] + U_.k)
}`);
    expect(found.some((m) => m.includes('cannot be assigned whole'))).toBe(true);
  });

  it('accepts a write to one element of the same local', () => {
    const c = compiled(`${U}
@fragment export function fs(): vec4 {
  const l: U = { xs: [0., 1.], k: 1. }
  l.xs[1] = 2.
  return vec4(l.xs[1] + U_.k)
}`);
    expect(c.wgsl).toContain('.xs[1].v = 2.0');
  });
});

function uniformModule(extra: ModuleDecl['structs']): ModuleDecl {
  const xs = arrayT(f32T, 3);
  return {
    structs: [{ name: 'U', fields: [{ name: 'xs', type: xs }] }, ...extra],
    bindings: [
      {
        name: 'u',
        type: structT('U'),
        space: 'uniform',
        group: 0,
        binding: 0,
      } as ModuleDecl['bindings'][number],
    ],
    funcs: [],
  } as unknown as ModuleDecl;
}

describe('the padding at the IR level', () => {
  it('refuses a module that declares the wrapper name itself', () => {
    const m = uniformModule([{ name: '_Pad16_f32', fields: [{ name: 'a', type: f32T }] }]);
    expect(() => padUniformArrays(m)).toThrow(UnsupportedFeatureError);
    expect(() => padUniformArrays(m)).toThrow(/reserved for that padding/);
  });

  it('leaves an array alone whose element holds a runtime-sized array', () => {
    const item = { name: 'Item', fields: [{ name: 'r', type: arrayT(f32T, undefined) }] };
    const m = {
      ...uniformModule([item]),
      structs: [{ name: 'U', fields: [{ name: 'items', type: arrayT(structT('Item'), 2) }] }, item],
    } as unknown as ModuleDecl;
    expect(padUniformArrays(m)).toBe(m);
  });
});
