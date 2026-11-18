// Verifies: Rule 7.10, Rule 12.7 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import type { CpuValue } from '../../core/cpu-runtime.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const program = (body: string, call = '0.'): string => `"use typeshade";
${body}
@fragment export function fs(uv: location<0, vec2>): vec4 {
  return vec4(uv, ${call}, 1.);
}
`;
function editorOf(source: string): string[] {
  const service = createTypeshadeLanguageService();
  service.openDocument('/optional/a.ts', source);
  return service
    .getDiagnostics('/optional/a.ts')
    .map((d) => `${d.source} ${String(d.code)} ${d.message}`);
}
function bothAccept(source: string): ReturnType<typeof compile> {
  const r = compile(source);
  expect(r.diagnostics).toEqual([]);
  expect(editorOf(source)).toEqual([]);
  return r;
}
function cpu(r: ReturnType<typeof compile>): (fn: string, ...args: CpuValue[]) => CpuValue {
  const oracle = compileModule(r.module).fns;
  const js = compileModuleJs(r.module).fns;
  return (fn, ...args) => {
    const a = oracle[fn]!(...args);
    const b = js[fn]!(...args);
    expect(b, `${fn}(${JSON.stringify(args)}): the CPU codegen disagrees with the oracle`).toEqual(
      a,
    );
    return a;
  };
}
const present = (value: CpuValue): CpuValue => ({ value, present: true });
const absent = (value: CpuValue): CpuValue => ({ value, present: false });

describe('loose null tests on existing optional values (change 0098 D4)', () => {
  const PRESENT_TESTS = ['v != null', 'null != v', '!(v == null)', '!(null == v)'];
  const ABSENT_TESTS = ['v == null', 'null == v', '!(v != null)', '!(null != v)'];
  for (const [isPresent, forms] of [
    [true, PRESENT_TESTS],
    [false, ABSENT_TESTS],
  ] as const) {
    for (const form of forms) {
      it(`narrows ${form} in both halves and matches the undefined emit`, () => {
        const body = isPresent
          ? `if (${form}) { return v; } return -1.;`
          : `if (${form}) { return -1.; } return v;`;
        const source = program(`function run(v: f32 | undefined): f32 { ${body} }`, 'run(uv.x)');
        const r = bothAccept(source);
        const reference = bothAccept(source.replaceAll('null', 'undefined'));
        expect(r.wgsl).toBe(reference.wgsl);
        expect(r.glsl).toEqual(reference.glsl);
        const run = cpu(r);
        expect(run('run', present(0))).toBe(0);
        expect(run('run', present(3))).toBe(3);
        expect(run('run', absent(0))).toBe(-1);
      });
    }
  }

  it('narrows nested class members and local-function parameters', () => {
    const source = program(
      `
class Inner { n: f32 | undefined; }
class Outer { inner: Inner; }
function read(h: Outer): f32 {
  const local = (v: f32 | undefined): f32 => v != null ? v : -2.;
  if (h.inner.n == null) { return -1.; }
  return h.inner.n + local(h.inner.n);
}
function run(k: f32): f32 {
  return read({ inner: { n: k } }) + read({ inner: { n: undefined } });
}`,
      'run(uv.x)',
    );
    const r = bothAccept(source);
    expect(cpu(r)('run', 3)).toBe(5);
    const reference = bothAccept(source.replaceAll('null', 'undefined'));
    expect(r.wgsl).toBe(reference.wgsl);
    expect(r.glsl).toEqual(reference.glsl);
  });

  it('follows short circuit and loop facts', () => {
    const r = bothAccept(
      program(
        `
function run(v: f32 | undefined): f32 {
  if (v == null || v < 0.) { return -1.; }
  let total = 0.;
  while (v != null && total < v) { total = total + 1.; }
  return total;
}`,
        'run(uv.x)',
      ),
    );
    const run = cpu(r);
    expect(run('run', present(3))).toBe(3);
    expect(run('run', present(-1))).toBe(-1);
    expect(run('run', absent(0))).toBe(-1);
  });

  it('evaluates an effectful optional-producing method exactly once', () => {
    const source = program(
      `
class Counter {
  count: f32 = 0.;
  next(v: f32): f32 | undefined {
    this.count = this.count + 1.;
    if (v > 0.) { return v; }
    return undefined;
  }
}
function run(k: f32): f32 {
  let c = new Counter();
  const missing = c.next(k) == null;
  return c.count + (missing ? 10. : 20.);
}`,
      'run(uv.x)',
    );
    const r = bothAccept(source);
    expect(cpu(r)('run', 0)).toBe(11);
    expect(cpu(r)('run', 3)).toBe(21);
    const reference = bothAccept(source.replaceAll('null', 'undefined'));
    expect(r.wgsl).toBe(reference.wgsl);
    expect(r.glsl).toEqual(reference.glsl);
  });
});
