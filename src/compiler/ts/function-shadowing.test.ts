// Verifies: Rule 3.2 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

describe('function lexical shadowing (#429)', () => {
  it('a top-level noise local shadows the module uniform', () => {
    const r = compile(`"use typeshade";
interface Frame { resolution: vec2; }
declare const u: uniform<Frame>;
function noise(p: vec2): f32 { const u: vec2 = p; return u.x; }
@fragment
export function fs(): vec4 { return vec4(noise(vec2(3., 4.)), 0., 0., 1.); }
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.module.funcs.find((fn) => fn.name === 'noise')!.body[0]).toMatchObject({
      s: 'let',
      name: 'u_1',
    });
    expect(r.eval('fs')).toEqual([3, 0, 0, 1]);
  });

  it.each([
    'const x: f32 = 10.;',
    'interface Frame { value: f32; } declare const x: uniform<Frame>;',
    'declare const x: override<f32>;',
    'let x: f32 = 10.;',
  ])('parameters and locals shadow %s', (moduleValue) => {
    const r = compile(`"use typeshade";
${moduleValue}
function param(x: f32): f32 { return x + 1.; }
function local(): f32 { const x = 3.; return x; }
@fragment
export function fs(): vec4 { return vec4(param(2.) + local(), 0., 0., 1.); }
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.module.funcs.find((fn) => fn.name === 'param')!.params[0]!.name).toBe('x');
    expect(r.wgsl).toContain('fn param(x: f32)');
    expect(r.eval('fs')).toEqual([6, 0, 0, 1]);
  });

  it('a closure captures the local that shadows a uniform', () => {
    const r = compile(`"use typeshade";
declare const u: uniform<f32>;
export function f(): f32 {
  let u = 3.;
  function add(): f32 { u = u + 2.; return u; }
  return add() + u;
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.eval('f')).toBe(10);
  });

  it('a mutable parameter shadow keeps its input and shared closure copy distinct', () => {
    const r = compile(`"use typeshade";
const u: f32 = 20.;
const u_1: f32 = 40.;
export function f(u: f32): f32 {
  function add(): f32 { u = u + 2.; return u; }
  u = u + 1.;
  return add() + u;
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.eval('f', [3])).toBe(12);
    expect(r.module.funcs.find((fn) => fn.name === 'f')!.params[0]!.name).toBe('u');
  });

  it('a receiver input may shadow a module value named self_', () => {
    const r = compile(`"use typeshade";
const self_: f32 = 99.;
class Value { y: f32 = 2.; constructor(public x: f32) {} read(): f32 { const get = (): f32 => this.x; return get(); } add(): f32 { this.x = this.x + this.y; return this.x; } }
export function f(): f32 { let value = new Value(3.); return value.read() + value.add(); }
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.eval('f')).toBe(8);
  });

  it('constructors and methods may shadow module names', () => {
    const r = compile(`"use typeshade";
const x: f32 = 99.;
class Value { x: f32; constructor(x: f32) { this.x = x; } add(x: f32): f32 { return this.x + x; } }
export function f(): f32 { return new Value(3.).add(4.); }
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.eval('f')).toBe(7);
  });

  it('the editor resolves a local and parameter ahead of the module uniform', () => {
    const source = `"use typeshade";
interface Frame { value: f32; }
declare const u: uniform<Frame>;
function param(u: f32): f32 { return u; }
export function f(): f32 { const u = vec2(3., 4.); return param(u.x); }
`;
    const service = createTypeshadeLanguageService();
    service.openDocument('shadow.shade.ts', source);
    expect(service.getDiagnostics('shadow.shade.ts')).toEqual([]);
    expect(
      service.getHover(
        'shadow.shade.ts',
        service.positionAt('shadow.shade.ts', source.indexOf('u = vec2')),
      )?.contents,
    ).toContain('u: vec2');
    expect(
      service.getHover(
        'shadow.shade.ts',
        service.positionAt('shadow.shade.ts', source.indexOf('u: f32')),
      )?.contents,
    ).toContain('u: f32');
  });

  it.each([
    'export function f(x: f32): f32 { const x = 2.; return x; }',
    'export function f(): f32 { const x = 1.; const x = 2.; return x; }',
    'export function f(x: f32, x: f32): f32 { return x; }',
  ])('still refuses a duplicate in the same frame: %s', (body) => {
    const r = compile('"use typeshade";\n' + body);
    expect(r.diagnostics.some((d) => d.code === 'TS8023')).toBe(true);
    expect(r.wgsl).toBeUndefined();
  });

  it.each(['eval', 'arguments'])('still refuses strict-mode identifier %s', (name) => {
    const r = compile(`"use typeshade"; export function f(${name}: f32): f32 { return ${name}; }`);
    expect(r.diagnostics.some((d) => d.code === 'TS8068')).toBe(true);
  });
});
