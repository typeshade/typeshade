import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { compileModule } from '../oracle.js';
import type { ModuleDecl } from '../ir/index.js';
import { eachExpr, eachStmtExpr } from '../ir/visit.js';
import { restructureCalls } from './restructure-calls.js';

function fixture(source: string): ModuleDecl {
  const result = compile(`"use typeshade";
    declare const input: storage<array<f32>, "read_write">;
    declare const output: storage<array<f32>, "read_write">;
    ${source}
    @compute([1]) export function main(): void { output[0] = run(2.); }
  `);
  expect(result.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return result.module;
}

const producer = `
  function produce(base: u32): array<f32, 12> {
    let p: array<f32, 12> = fill<f32, 12>(0.);
    for (let i: u32 = 0; i < 12; i++) p[i] = input[base + i];
    return p;
  }
`;

function compileWithInput(m: ModuleDecl, x: number): unknown {
  const cpu = compileModule(m);
  cpu.setBinding('input', Array(13).fill(2));
  return cpu.fns.run!(x);
}

describe('restructure producer/consumer graphs and rebuild shared functions', () => {
  it('connects a chain of single-use local snapshots and removes unused loads', () => {
    const m = fixture(`${producer}
      function transform(p: array<f32, 12>, x: f32): vec2f { return vec2f(p[0] * x, p[11]); }
      function consume(v: vec2f): f32 { return v.x + v.y; }
      function run(x: f32): f32 {
        const p = produce(0);
        const v = transform(p, x);
        const answer = consume(v);
        return answer;
      }
    `);
    const out = restructureCalls(m);
    expect(out.funcs.some((f) => f.name.endsWith('_fused'))).toBe(true);
    const counts: number[] = [];
    for (const variant of [m, out]) {
      let reads = 0;
      const input = new Proxy(
        Array.from({ length: 12 }, (_, i) => i + 1),
        {
          get(target, key, receiver) {
            if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
            return Reflect.get(target, key, receiver);
          },
        },
      );
      const cpu = compileModule(variant);
      cpu.setBinding('input', input);
      expect(cpu.fns.run!(3)).toBe(15);
      counts.push(reads);
    }
    expect(counts).toEqual([12, 2]);
    const run = out.funcs.find((f) => f.name === 'run')!;
    expect(run.body).toHaveLength(1);
  });

  it.each([
    'input[0] = 99.;',
    'output[0] = 99.;',
    'write();',
    'workgroupBarrier();',
    'if (x > 0.) { output[0] = 99.; }',
  ])('does not sink a producer snapshot across %s', (intervening) => {
    const m = fixture(`${producer}
      function write(): void { input[0] = 99.; }
      function consume(p: array<f32, 12>): f32 { return p[0]; }
      function run(x: f32): f32 {
        const p = produce(0); ${intervening} return consume(p);
      }
    `);
    expect(restructureCalls(m).funcs.some((f) => f.name.endsWith('_fused'))).toBe(false);
  });

  it.each([
    'let base: u32 = 0; const p = produce(base); base = 1; return consume(p, f32(base));',
    'const p = produce(0); return x > 0. ? consume(p, x) : 0.;',
    'const p = produce(0); return consume(p, x) + consume(p, x);',
    'let p = produce(0); p[0] = x; return consume(p, x);',
  ])('retains snapshots when dependencies change, uses repeat or guards intervene: %s', (body) => {
    const m = fixture(`${producer}
      function consume(p: array<f32, 12>, x: f32): f32 { return p[0] + x; }
      function run(x: f32): f32 { ${body} }
    `);
    const out = restructureCalls(m);
    expect(out.funcs.some((f) => f.name.endsWith('_fused'))).toBe(false);
    for (const variant of [m, out]) {
      const cpu = compileModule(variant);
      cpu.setBinding('input', Array(13).fill(2));
      expect(cpu.fns.run!(3)).toBe(compileWithInput(m, 3));
    }
  });

  it('removes a twelve-element producer array and loads only consumed elements', () => {
    const m = fixture(`${producer}
      function consume(p: array<f32, 12>, x: f32): f32 { return p[0] * x + p[11]; }
      function run(x: f32): f32 { return consume(produce(0), x); }
    `);
    const out = restructureCalls(m),
      fused = out.funcs.filter((f) => f.name.endsWith('_fused'));
    expect(fused).toHaveLength(1);
    let aggregateLocals = 0;
    for (const s of fused[0]!.body)
      eachStmtExpr(s, (e) =>
        eachExpr(e, (x) => {
          if (x.op === 'construct' && x.type.kind === 'array') aggregateLocals++;
        }),
      );
    expect(aggregateLocals).toBe(0);
    const counts: number[] = [];
    for (const variant of [m, out]) {
      let reads = 0;
      const data = new Proxy(
        Array.from({ length: 12 }, (_, i) => i + 1),
        {
          get(target, key, receiver) {
            if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
            return Reflect.get(target, key, receiver);
          },
        },
      );
      const cpu = compileModule(variant);
      cpu.setBinding('input', data);
      expect(cpu.fns.run!(3)).toBe(15);
      counts.push(reads);
    }
    expect(counts).toEqual([12, 2]);
  });

  it('keeps root early returns inside the synthesized helper', () => {
    const m = fixture(`${producer}
      function consume(p: array<f32, 12>): f32 { if (p[0] < 0.) return -1.; return p[11]; }
      function run(x: f32): f32 { return consume(produce(0)) + 100.; }
    `);
    for (const variant of [m, restructureCalls(m)]) {
      const cpu = compileModule(variant);
      cpu.setBinding('input', [-1, ...Array(11).fill(5)]);
      expect(cpu.fns.run!(0)).toBe(99);
    }
  });

  it('preserves simultaneous struct assignments while splitting mutable fields', () => {
    const m = fixture(`
      class Pair { a: f32; b: f32; }
      function produce(x: f32): Pair {
        let p: Pair = { a: x, b: x + 1. };
        p = { a: p.b, b: p.a };
        return p;
      }
      function consume(p: Pair): f32 { return p.a * 10. + p.b; }
      function run(x: f32): f32 { return consume(produce(x)); }
    `);
    const out = restructureCalls(m);
    for (const x of [-3, 0, 5])
      expect(compileModule(out).fns.run!(x)).toBe(compileModule(m).fns.run!(x));
    expect(compileModule(out).fns.run!(5)).toBe(65);
  });

  it('retains arrays required by dynamic indexing', () => {
    const m = fixture(`${producer}
      function consume(p: array<f32, 12>, i: u32): f32 { return p[i]; }
      function run(x: f32): f32 { return consume(produce(0), u32(x)); }
    `);
    const before = compileModule(m),
      after = compileModule(restructureCalls(m));
    for (const cpu of [before, after])
      cpu.setBinding(
        'input',
        Array.from({ length: 12 }, (_, i) => i * 2),
      );
    for (const i of [0, 3, 11]) expect(after.fns.run!(i)).toBe(before.fns.run!(i));
  });

  it('shares equal call graphs across callers with different local names', () => {
    const m = fixture(`${producer}
      function consume(p: array<f32, 12>, x: f32): f32 { return p[0] + x; }
      function run(x: f32): f32 { return consume(produce(0), x); }
      function second(y: f32): f32 { return consume(produce(0), y); }
    `);
    const out = restructureCalls(m);
    expect(out.funcs.filter((f) => f.name.endsWith('_fused'))).toHaveLength(1);
  });

  it('does not lift the fused call outside its guard', () => {
    const m = fixture(`${producer}
      function consume(p: array<f32, 12>): f32 { return p[0]; }
      function run(x: f32): f32 { if (x > 0.) return consume(produce(0)); return 7.; }
    `);
    const cpu = compileModule(restructureCalls(m));
    cpu.setBinding(
      'input',
      new Proxy([], {
        get() {
          throw new Error('guarded read');
        },
      }),
    );
    expect(cpu.fns.run!(-1)).toBe(7);
  });

  it('refuses a call tree with an effectful argument', () => {
    const m = fixture(`${producer}
      function tick(): f32 { output[1] += 1.; return output[1]; }
      function consume(p: array<f32, 12>, x: f32): f32 { return p[0] + x; }
      function run(x: f32): f32 { return consume(produce(0), tick()); }
    `);
    expect(restructureCalls(m).funcs.some((f) => f.name.endsWith('_fused'))).toBe(false);
  });

  it('outlines shared arithmetic after abstracting caller-local names', () => {
    const m = fixture(`
      function first(x: f32, y: f32): f32 { return (x * y + x) * (x - y) + x / (y + 1.); }
      function second(a: f32, b: f32): f32 { return (a * b + a) * (a - b) + a / (b + 1.); }
      function run(x: f32): f32 { return first(x, 2.) + second(x + 1., 3.); }
    `);
    const out = restructureCalls(m);
    expect(out.funcs.some((f) => f.name.endsWith('_shared'))).toBe(true);
    for (const x of [-100, -0, 0, 3.25, 1e20, NaN])
      expect(compileModule(out).fns.run!(x)).toBe(compileModule(m).fns.run!(x));
  });
});
