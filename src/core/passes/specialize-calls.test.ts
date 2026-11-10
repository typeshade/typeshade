import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { compileModule } from '../oracle.js';
import { eachExpr, eachStmtExpr } from '../ir/visit.js';
import type { ModuleDecl } from '../ir/index.js';
import { specializeCalls } from './specialize-calls.js';
import { lowerWgsl } from '../backends/wgsl.js';
import { profileEmit } from '../measure.js';

function fixture(source: string): ModuleDecl {
  const r = compile(`"use typeshade";
    declare const output: storage<array<f32>, "read_write">;
    ${source}
    @compute([1]) export function main(): void { output[0] = run(2.); }
  `);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return r.module;
}

function calls(m: ModuleDecl, name: string): string[] {
  const names: string[] = [];
  for (const s of m.funcs.find((f) => f.name === name)!.body)
    eachStmtExpr(s, (e) =>
      eachExpr(e, (x) => {
        if (x.op === 'call') names.push(x.fn);
      }),
    );
  return names;
}

describe('module-level call specialization', () => {
  it('synthesizes one shared helper for equal boolean call-site requirements', () => {
    const m = fixture(`
      function choose(x: f32, candidate: bool): f32 {
        if (candidate) return x * 2.;
        return x + 3.;
      }
      function run(x: f32): f32 { return choose(x, true) + choose(x + 1., true); }
    `);
    const out = specializeCalls(m);
    const generated = out.funcs.filter((f) => f.name.startsWith('_spec'));
    expect(generated).toHaveLength(1);
    expect(generated[0]!.params.map((p) => p.name)).toEqual(['x']);
    expect(calls(out, 'run')).toEqual([generated[0]!.name, generated[0]!.name]);
    expect(generated[0]!.body.some((s) => s.s === 'if')).toBe(false);
    for (const x of [-2, 0, 3.25])
      expect(compileModule(out).fns.run!(x)).toBe(compileModule(m).fns.run!(x));
    expect(specializeCalls(out)).toEqual(out);
  });

  it('retains dynamic calls and specializes both constant alternatives', () => {
    const m = fixture(`
      function choose(x: f32, take: bool): f32 { if (take) return x; return -x; }
      function run(x: f32): f32 { return choose(x, true) + choose(x, false) + choose(x, x > 0.); }
    `);
    const out = specializeCalls(m);
    expect(out.funcs.filter((f) => f.name.startsWith('_spec'))).toHaveLength(2);
    expect(calls(out, 'run')).toContain('choose');
    for (const x of [-3, 0, 3])
      expect(compileModule(out).fns.run!(x)).toBe(compileModule(m).fns.run!(x));
  });

  it('evaluates a remaining effectful argument exactly once', () => {
    const m = fixture(`
      function tick(): f32 { output[1] += 1.; return output[1]; }
      function choose(x: f32, take: bool): f32 { if (take) return x + x; return 0.; }
      function run(x: f32): f32 { return choose(tick(), true); }
    `);
    for (const variant of [m, specializeCalls(m)]) {
      const cpu = compileModule(variant),
        output = [0, 0];
      cpu.setBinding('output', output);
      expect(cpu.fns.run!(2)).toBe(2);
      expect(output[1]).toBe(1);
    }
  });

  it('preserves a mutable local copy of a specialized value parameter', () => {
    const m = fixture(`
      function choose(x: f32, take: bool): f32 { take = !take; if (take) return x; return -x; }
      function run(x: f32): f32 { return choose(x, true); }
    `);
    expect(compileModule(specializeCalls(m)).fns.run!(3)).toBe(-3);
  });

  it('snapshots constructor fields before their inputs change', () => {
    const m = fixture(`
      class Pair { a: f32; b: f32; }
      function pair(x: f32): Pair {
        let value = x;
        const p: Pair = { a: value, b: value * 2. };
        value += 10.;
        if (value > 100.) return { a: value, b: value };
        return p;
      }
      function run(x: f32): f32 { const p = pair(x); return p.a; }
    `);
    const out = specializeCalls(m);
    for (const x of [-3, 0, 20, 100])
      expect(compileModule(out).fns.run!(x)).toBe(compileModule(m).fns.run!(x));
    expect(compileModule(out).fns.run!(20)).toBe(20);
  });

  it.each([
    'workgroupBarrier(); if (take) return x; return -x;',
    'output[1] = x; if (take) return x; return -x;',
  ])('leaves mutations and effects outside its specialization subset: %s', (body) => {
    const m = fixture(`function choose(x: f32, take: bool): f32 { ${body} }
      function run(x: f32): f32 { return choose(x, true); }`);
    expect(specializeCalls(m)).toEqual(m);
  });

  const projection = `
    class Result { pixel: f32; derivative: f32; ok: u32; }
    function project(x: f32): Result {
      const bad: Result = { pixel: 0., derivative: 0., ok: 0 };
      if (x < 0.) return bad;
      const derivative = x * x;
      if (derivative > 100.) return bad;
      return { pixel: x + 1., derivative, ok: 1 };
    }
  `;
  it('returns only demanded fields while retaining derivative-dependent validity', () => {
    const m = fixture(`${projection}
      function run(x: f32): f32 { const p = project(x); return p.ok === 0 ? -1. : p.pixel; }
      function again(x: f32): f32 { const p = project(x); return p.pixel + f32(p.ok); }
      function full(x: f32): f32 { const p = project(x); return p.pixel + p.derivative + f32(p.ok); }
    `);
    const out = specializeCalls(m);
    const generated = out.funcs.filter((f) => f.name.startsWith('_spec'));
    expect(generated).toHaveLength(1);
    const ret = generated[0]!.ret;
    expect(ret.kind).toBe('struct');
    if (ret.kind !== 'struct') throw new Error('Expected narrowed struct');
    expect(out.structs.find((s) => s.name === ret.name)!.fields.map((f) => f.name)).toEqual([
      'pixel',
      'ok',
    ]);
    expect(calls(out, 'again')).toContain(calls(out, 'run')[0]);
    expect(calls(out, 'full')).toContain('project');
    const before = compileModule(m),
      after = compileModule(out);
    for (const x of [-2, 0, 3, 10, 11, NaN, Infinity])
      for (const fn of ['run', 'again', 'full']) expect(after.fns[fn]!(x)).toBe(before.fns[fn]!(x));
    expect(after.fns.run!(11)).toBe(-1);
  });

  it.each([
    'const p = project(x); return consume(p);',
    'let p = project(x); p.pixel += 1.; return p.pixel;',
  ])('keeps a full return for escaping or mutated results: %s', (body) => {
    const m = fixture(`${projection}
      function consume(p: Result): f32 { return p.pixel; }
      function run(x: f32): f32 { ${body} }`);
    expect(specializeCalls(m)).toEqual(m);
  });

  it('does not specialize helpers-only modules, opaque functions or raw modules', () => {
    const m = fixture(`function choose(x: f32, take: bool): f32 { if (take) return x; return 0.; }
      function run(x: f32): f32 { return choose(x, true); }`);
    const helpers = { ...m, funcs: m.funcs.filter((f) => f.name !== 'main') };
    expect(specializeCalls(helpers)).toBe(helpers);
    const opaque = {
      ...m,
      funcs: m.funcs.map((f) => (f.name === 'choose' ? { ...f, opaque: true } : f)),
    };
    expect(specializeCalls(opaque)).toBe(opaque);
    const raw: ModuleDecl = {
      ...m,
      funcs: m.funcs.map((f) =>
        f.name === 'run' ? { ...f, body: [{ s: 'raw', wgsl: 'return choose(x, true);' }] } : f,
      ),
    };
    expect(specializeCalls(raw)).toBe(raw);
  });

  it('avoids collisions with unused module declarations', () => {
    const m = fixture(`function choose(x: f32, take: bool): f32 { if (take) return x; return 0.; }
      function run(x: f32): f32 { return choose(x, true); }`);
    const occupied: ModuleDecl = {
      ...m,
      vars: [{ name: '_spec0_choose', type: { kind: 'scalar', scalar: 'f32' }, space: 'private' }],
    };
    const out = specializeCalls(occupied);
    expect(out.funcs.some((f) => f.name === '_spec0_choose')).toBe(false);
    expect(compileModule(out).fns.run!(3)).toBe(3);
  });

  it('bounds clone growth and retains working calls beyond the budget', () => {
    const helpers = Array.from(
      { length: 20 },
      (_, i) => `function choose${i}(x: f32, take: bool): f32 {
      if (take) return x + ${i}.; return -x;
    }`,
    ).join('\n');
    const sum = Array.from({ length: 20 }, (_, i) => `choose${i}(x, true)`).join(' + ');
    const m = fixture(`${helpers} function run(x: f32): f32 { return ${sum}; }`);
    const out = specializeCalls(m);
    expect(out.funcs.filter((f) => f.name.startsWith('_spec')).length).toBeLessThanOrEqual(16);
    expect(calls(out, 'run').some((n) => n.startsWith('choose'))).toBe(true);
    expect(compileModule(out).fns.run!(3)).toBe(compileModule(m).fns.run!(3));
  });

  it('runs only on O2 emission and agrees with the instrumented pipeline', () => {
    const m = fixture(`function choose(x: f32, take: bool): f32 { if (take) return x; return 0.; }
      function run(x: f32): f32 { return choose(x, true); }`);
    for (const level of ['O0', 'O1'] as const)
      expect(lowerWgsl(m, level).funcs.some((f) => f.name.startsWith('_spec'))).toBe(false);
    expect(lowerWgsl(m, 'O2').funcs.some((f) => f.name.startsWith('_spec'))).toBe(true);
    expect(() => profileEmit(m)).not.toThrow();
    const fragment = compile(`"use typeshade";
      function choose(x: f32, take: bool): f32 { if (take) return x; return 0.; }
      @fragment export function main(): vec4f { return vec4f(choose(2., true)); }
    `);
    expect(fragment.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(() => profileEmit(fragment.module, 'glsl-es300')).not.toThrow();
  });
});
