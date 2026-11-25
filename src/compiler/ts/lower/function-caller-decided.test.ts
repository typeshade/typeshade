import { describe, expect, it } from 'vitest';
import { bothHalves } from '../../../core/testing/both-halves.js';
import { uninlined } from '../../../core/testing/keep-helpers.js';

const entry = (head: string, body: string): string =>
  `"use typeshade"\n${head}\n@fragment export function fs(): vec4 { ${body} return vec4(1., 0., 0., 1.); }\n`;

const read = (source: string) => uninlined(() => bothHalves(source));

const fnsOf = (source: string): { names: string[]; wgsl: string; hover: (n: string) => string } => {
  const h = read(source);
  expect(h.compiler).toEqual([]);
  expect(h.editor).toEqual([]);
  const wgsl = h.result.wgsl ?? '';
  return {
    names: [...wgsl.matchAll(/^fn (\w+)\(/gm)].map((m) => m[1]!),
    wgsl,
    hover: (n) => h.hover(n) ?? '',
  };
};

describe('a result its callers decide (Rule 8.19, change 0134)', () => {
  it('is the one type the calls ask, with no copy', () => {
    const r = fnsOf(
      entry('function g() { return 2 }', 'const a: u32 = g(); const b: u32 = g() + 1;'),
    );
    expect(r.wgsl).toContain('fn g() -> u32 {');
    expect(r.names).not.toContain('g_u32');
    expect(r.hover('g()')).toContain('function g(): u32');
  });

  it('keeps f32 under its own name and copies for each other type asked', () => {
    const r = fnsOf(entry('function g() { return 2 }', 'const a: u32 = g(); const b: i32 = g();'));
    expect(r.wgsl).toContain('fn g() -> f32 {');
    expect(r.wgsl).toContain('fn g_u32() -> u32 {');
    expect(r.wgsl).toContain('fn g_i32() -> i32 {');
    expect(r.hover('g()')).toContain('function g() (i32 or u32 where it is called)');
  });

  it('keeps f32 for an exported function, which the host calls, and copies the type asked', () => {
    const r = fnsOf(entry('export function g() { return 2 }', 'const a: u32 = g();'));
    expect(r.wgsl).toContain('fn g() -> f32 {');
    expect(r.wgsl).toContain('fn g_u32() -> u32 {');
    expect(r.hover('g()')).toContain('function g() (u32 or f32 where it is called)');
  });

  it('makes a copy of a method and says so in its hover', () => {
    const r = fnsOf(
      entry(
        'class C { n: f32 = 1.; k() { return 3 } }',
        'const c = new C(); const a: u32 = c.k(); const b: i32 = c.k();',
      ),
    );
    expect(r.names).toEqual(expect.arrayContaining(['C_k', 'C_k_u32', 'C_k_i32']));
    expect(r.hover('k()')).toContain('(method) C.k() (i32 or u32 where it is called)');
  });

  it('makes a copy of an arrow function a body declares', () => {
    const r = fnsOf(entry('', 'const k = () => 3; const a: u32 = k(); const b: i32 = k();'));
    expect(r.names).toEqual(expect.arrayContaining(['fs_k', 'fs_k_u32', 'fs_k_i32']));
  });

  it('takes a name no function of the module has, and no local-function prefix either', () => {
    const r = fnsOf(
      entry(
        `function g() { function inc(x: f32): f32 { return x + 1. } return 3 }
function g_u32_inc(): f32 { return 1. }`,
        'const a: u32 = g(); const b: i32 = g(); g_u32_inc();',
      ),
    );
    expect(r.names).toContain('g_u32_inc');
    expect(r.names).toContain('g_u32_1');
    expect(r.names).toContain('g_u32_1_inc');
    expect(r.names).not.toContain('g_u32');
  });

  it('gives each copy its own local functions, named after the copy', () => {
    const r = fnsOf(
      entry(
        `function g() { const inc = (x: f32) => x + 1.; const n = 3; return n }`,
        'const a: u32 = g(); const b: i32 = g();',
      ),
    );
    expect(r.names).toEqual(
      expect.arrayContaining(['g_inc', 'g_u32_inc', 'g_i32_inc', 'g_u32', 'g_i32']),
    );
  });
});
