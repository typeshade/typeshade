import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';
import { TS_CODES } from './codes.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';

function compiled(source: string) {
  const c = compile(`"use typeshade"\n${source}`);
  expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return c;
}
function diagnose(source: string): { code?: string; message: string } {
  const r = compileTsSource(`"use typeshade"\n${source}`);
  const first = r.diagnostics.find((d) => d.category === 'error');
  expect(first, 'expected a diagnostic, got none').toBeDefined();
  return { code: first!.code, message: first!.message };
}
function cpu(c: ReturnType<typeof compiled>, fn: string, args: readonly number[]): unknown[] {
  return [
    compileModule(c.module).fns[fn]!(...(args as never[])),
    compileModuleJs(c.module, { gpuStubs: true }).fns[fn]!(...(args as never[])),
  ];
}

describe('the unary operators WGSL has, and the one it does not', () => {
  it('lowers ~ and refuses unary minus on u32', () => {
    const c = compiled(`export function f(x: i32): i32 { return ~x }
export function g(x: u32): u32 { return ~x }`);
    expect(c.wgsl).toContain('return ~x;');
    expect(c.glsl!.fragment).toContain('return ~x;');
    expect(cpu(c, 'f', [5])).toEqual([-6, -6]);
    expect(cpu(c, 'g', [5])).toEqual([4294967290, 4294967290]);

    const d = diagnose(`export function f(u: u32): u32 { return -u }`);
    expect(d.code).toBe(TS_CODES.TYPE_MISMATCH);
    expect(d.message).toBe(
      'Unary "-" is not defined on u32; WGSL has no negation for an unsigned integer. ' +
        'Write 0u - x to wrap, or i32(x) to change kind first.',
    );
  });

  it('takes unary + as the identity it is', () => {
    const c = compiled(`export function f(x: f32): f32 { return +x }`);
    expect(c.wgsl).toContain('return x;');
    expect(c.wgsl).not.toContain('+x');
  });

  it('refuses ~ on a float and + on a bool', () => {
    expect(diagnose(`export function f(x: f32): f32 { return ~x }`).message).toContain(
      'requires an i32 or u32 operand',
    );
    expect(diagnose(`export function f(b: bool): bool { return +b }`).message).toContain(
      'requires a numeric operand',
    );
  });
});
