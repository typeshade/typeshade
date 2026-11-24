import { describe, expect, it } from 'vitest';
import { compiled } from './uniform-layout-compiled.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { bothHalves } from '../../core/testing/both-halves.js';
import { padUniformArrays } from '../../core/passes/uniform-layout.js';
import { UnsupportedFeatureError } from '../../core/backend.js';
import type { ModuleDecl } from '../../core/ir/nodes.js';
import { arrayT, f32T, structT } from '../../core/ir/types.js';

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

  const refusal =
    "typeshade TS8015: Backend emit failed: wgsl: 'xs' is a uniform-padded list (§51) and cannot be assigned whole. Write its elements one at a time.";

  it.each([
    [
      'a local of the uniform struct type',
      `${U}
@fragment export function fs(): vec4 {
  const l: U = { xs: [0., 1.], k: 1. }
  l.xs = [2., 3.]
  return vec4(l.xs[0] + U_.k)
}`,
    ],
    [
      'a nested block',
      `${U}
@fragment export function fs(): vec4 {
  const l: U = { xs: [0., 1.], k: 1. }
  if (U_.k > 0.) { for (let i = 0; i < 2; i++) { l.xs = [2., 3.] } }
  return vec4(l.xs[0] + U_.k)
}`,
    ],
  ])('refuses the write in %s, and the editor reads the same refusal', (_name, body) => {
    const text = `"use typeshade"\n${body}`;
    expect(bothHalves(text).compiler).toEqual([refusal]);
    const service = createTypeshadeLanguageService();
    service.openDocument('a.shade.ts', text);
    expect(service.getDiagnostics('a.shade.ts')).toEqual([]);
    const pane = service.getCompiledOutput('a.shade.ts', 'wgsl')!;
    expect(pane.diagnostics.map((d) => d.message)).toEqual([
      "Backend emit failed: wgsl: 'xs' is a uniform-padded list (§51) and cannot be assigned whole. Write its elements one at a time.",
    ]);
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

describe('the layout the pass decides', () => {
  it('keeps an array without a wrapper 16-aligned inside a nested struct', () => {
    const c = compiled(`interface P { a: f32; b: f32; c: f32; d: f32 }
interface In { k: f32; ps: array<P, 2> }
interface U { inner: In; z: f32 }
declare const U_: uniform<U>
@fragment export function fs(): vec4 { return vec4(U_.inner.ps[1].a + U_.z) }`);
    expect(c.wgsl).toContain('  inner: In,');
    expect(c.wgsl).toContain('  @align(16) ps: array<P, 2>,');
    expect(c.wgsl).not.toContain('@size(48)');
  });

  it.each([
    ['xs: array<f32, 2>; ys: array<vec2, 2>', '_Pad16_f32', '_Pad16_vec2_f32_'],
    ['ys: array<vec2, 2>; xs: array<f32, 2>', '_Pad16_vec2_f32_', '_Pad16_f32'],
  ])('puts the wrappers of scalar and vector elements in field order for %s', (fields, a, b) => {
    const c = compiled(`interface U { ${fields} }
declare const U_: uniform<U>
@fragment export function fs(): vec4 { return vec4(U_.xs[1] + U_.ys[1].x) }`);
    expect(c.wgsl!.indexOf(`struct ${a} {`)).toBeGreaterThanOrEqual(0);
    expect(c.wgsl!.indexOf(`struct ${a} {`)).toBeLessThan(c.wgsl!.indexOf(`struct ${b} {`));
  });

  it('pads before the optimizer, so a hoisted read keeps its wrapper member', () => {
    const c = compiled(`interface U { n: f32; weights: array<f32, 4> }
declare const U_: uniform<U>
@fragment export function fs(): vec4 {
  let s = 0.
  for (let i = 0; i < i32(U_.n); i++) { s += U_.weights[i] * U_.n }
  return vec4(s)
}`);
    expect(c.wgsl).toContain('U_.weights[i].v');
    expect(c.wgsl).not.toMatch(/_licm\d+: array<f32, 4>/);
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

  it('is the identity on a second application', () => {
    const P = { name: 'P', fields: ['a', 'b', 'c', 'd'].map((name) => ({ name, type: f32T })) };
    const S = { name: 'S', fields: ['x', 'y'].map((name) => ({ name, type: f32T })) };
    const In = {
      name: 'In',
      fields: [
        { name: 'k', type: f32T },
        { name: 't', type: structT('S') },
      ],
    };
    const U = {
      name: 'U',
      fields: [
        { name: 'k', type: f32T },
        { name: 'ps', type: arrayT(structT('P'), 2) },
        { name: 'xs', type: arrayT(f32T, 3) },
        { name: 'inner', type: structT('In') },
        { name: 's', type: structT('S') },
        { name: 'z', type: f32T },
      ],
    };
    const m = { ...uniformModule([P, S, In]), structs: [U, P, S, In] } as unknown as ModuleDecl;
    const once = padUniformArrays(m);
    expect(once).not.toBe(m);
    expect(padUniformArrays(once)).toEqual(once);
  });
});
