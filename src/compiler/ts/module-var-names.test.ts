import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { startDebugSession } from '../../core/debug/session.js';
import { optimizeAt } from '../../core/passes/opt/optimize.js';
import { proveKernels } from '../../core/passes/parallel-loop.js';
import { describeRead } from './kernel-loops.js';

const voice = 'class Voice { static count: u32 = 3; }';

function check(body: string, value: number): ReturnType<typeof compile> {
  const source = `"use typeshade";\n${body}\nexport const fs = fragment(function fs(): vec4 {
    return vec4(f32(run(7)), 0., 0., 1.);
  });`;
  const r = compile(source, { fileName: 'names.shade.ts' });
  expect(r.diagnostics).toEqual([]);
  const service = createTypeshadeLanguageService();
  service.openDocument('names.shade.ts', source);
  expect(service.getDiagnostics('names.shade.ts')).toEqual([]);
  expect(r.eval('run', [7])).toBe(value);
  for (const precision of ['f32', 'f64'] as const) {
    expect(compileModuleJs(r.module, { precision }).fns['run']!(7)).toBe(value);
    expect(compileModule(r.module, { precision }).fns['run']!(7)).toBe(value);
  }
  for (const level of ['O1', 'O2'] as const)
    expect(compileModule(optimizeAt(r.module, level)).fns['run']!(7)).toBe(value);
  const session = startDebugSession(r.module, 'run', [7]);
  session.continue();
  expect(session.done).toBe(true);
  expect(session.result).toBe(value);
  return r;
}

describe('module variables and parameters occupy distinct IR slots (#1009)', () => {
  it('keeps reads and writes distinct on every execution path and in both GPU texts', () => {
    const r = check(
      `${voice}
      export function run(Voice_count: u32): u32 {
        Voice.count += 1;
        return Voice_count + Voice.count;
      }`,
      11,
    );
    expect(r.wgsl).toContain('var<private> Voice_count_module: u32 = 3u;');
    expect(r.wgsl).toContain('(Voice_count + Voice_count_module)');
    expect(r.glsl!.fragment).toContain('uint Voice_count_module = 3u;');
    expect(r.glsl!.fragment).toContain('(Voice_count + Voice_count_module)');
  });

  it('keeps a mutable parameter copy distinct', () => {
    check(
      `${voice}
      export function run(Voice_count: u32): u32 {
        Voice_count += 2;
        Voice.count += 1;
        return Voice_count + Voice.count;
      }`,
      13,
    );
  });

  it('keeps an inout parameter distinct', () => {
    check(
      `${voice}
      function adjust(@inout Voice_count: u32): u32 {
        Voice_count += 2;
        Voice.count += 1;
        return Voice_count + Voice.count;
      }
      export function run(x: u32): u32 {
        let v = x;
        const result = adjust(v);
        return result + v;
      }`,
      22,
    );
  });

  it('shares the renamed variable across functions and a captured local function', () => {
    check(
      `${voice}
      function bump(): void { Voice.count += 1; }
      export function run(Voice_count: u32): u32 {
        const read = (): u32 => Voice_count + Voice.count;
        bump();
        return read();
      }`,
      11,
    );
  });

  it('reads the renamed variable through an inherited static and super', () => {
    check(
      `class Base { static count: u32 = 3; }
      class Derived extends Base {
        static read(Base_count: u32): u32 {
          Base.count += 1;
          return super.count + Derived.count + Base_count;
        }
      }
      export function run(x: u32): u32 { return Derived.read(x); }`,
      15,
    );
  });

  it('does not take another declaration or parameter name for the renamed variable', () => {
    check(
      `const Voice_count_module: u32 = 10;
      ${voice}
      export function run(Voice_count: u32): u32 {
        let Voice_count_module_1: u32 = 2;
        Voice.count += 1;
        return Voice_count + Voice.count + Voice_count_module + Voice_count_module_1;
      }`,
      23,
    );
  });

  it('keeps lexical shadowing of an ordinary module variable', () => {
    check(
      `let count: u32 = 3;
      function bump(): u32 { count += 1; return count; }
      export function run(count: u32): u32 { return count + bump(); }`,
      11,
    );
  });

  it('reserves a static method name when choosing the variable name', () => {
    check(
      `class Voice {
        static count: u32 = 3;
        static count_module(): u32 { return 2; }
      }
      export function run(Voice_count: u32): u32 {
        Voice.count += 1;
        return Voice_count + Voice.count + Voice.count_module();
      }`,
      13,
    );
  });

  it('still diagnoses a duplicate declaration before renaming', () => {
    const source = `"use typeshade"; const count: u32 = 2; let count: u32 = 3;
      export function run(count: u32): u32 { return count; }`;
    const r = compile(source);
    expect(r.diagnostics.some((d) => d.message.includes('count') && d.category === 'error')).toBe(
      true,
    );
    const service = createTypeshadeLanguageService();
    service.openDocument('duplicate.shade.ts', source);
    expect(service.getDiagnostics('duplicate.shade.ts').some((d) => d.severity === 'error')).toBe(
      true,
    );
  });

  it('keeps authored field names in kernel access reports after renaming', () => {
    const source = `"use typeshade"; ${voice}
      function bump(): void { Voice.count += 1; }
      export function run(out: array<f32>, t: array<f32>, Voice_count: u32): void {
        for (let i: u32 = 0; i < out.length; i++) {
          out[i] = t[i + Voice_count + Voice.count];
        }
      }`;
    const r = compile(source);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('report.shade.ts', source);
    expect(service.getDiagnostics('report.shade.ts').filter((d) => d.severity === 'error')).toEqual(
      [],
    );
    const f = r.module.funcs.find((fn) => fn.name === 'run')!;
    const loop = proveKernels(r.module).find((p) => p.fn === 'run')!.loops[0]!;
    expect(loop.ok).toBe(true);
    if (!loop.ok) throw new Error('refused loop');
    expect(
      describeRead(
        f,
        loop.reads.find((r) => r.name === 't')!,
      )?.text,
    ).toBe('t[i + Voice_count + Voice.count]');
  });
});
