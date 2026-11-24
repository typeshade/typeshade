import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { compileModule } from './oracle.js';
import { ValidationError } from './passes/validate.js';
import { fn, module, f32, f32T, u32T, i32T, abs, toU32, toI32 } from './ir/index.js';
import type { ModuleDecl } from './ir/index.js';

const moduleOf = (body: string): ModuleDecl => {
  const r = compile(`"use typeshade";\n${body}\n`);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return r.module;
};

const run = (body: string, precision?: 'f32'): unknown =>
  compileModule(moduleOf(body), { precision }).fns['run']!();

describe('oracle: shaped matrix products and transposes', () => {
  it('a row vector times a matrix is the product with each column', () => {
    expect(
      run(`export function run(): vec3 {
  const m = mat3x2(1., 2., 3., 4., 5., 6.);
  return vec2(1., 10.) * m;
}`),
    ).toEqual([21, 43, 65]);
  });

  it('transpose reads the shape of its argument: mat2x3 and mat3x2 differ', () => {
    expect(
      run(`export function run(): mat3x2 {
  return transpose(mat2x3(1., 2., 3., 4., 5., 6.));
}`),
    ).toEqual([1, 4, 2, 5, 3, 6]);
    expect(
      run(`export function run(): mat2x3 {
  return transpose(mat3x2(1., 2., 3., 4., 5., 6.));
}`),
    ).toEqual([1, 3, 5, 2, 4, 6]);
  });
});

describe('oracle: integer conversions and wrapping', () => {
  const sat = module({
    funcs: [
      fn('toU', { x: f32T }, u32T, ({ x }) => toU32(x)),
      fn('toI', { x: f32T }, i32T, ({ x }) => toI32(x)),
      fn('absI', { x: i32T }, i32T, ({ x }) => abs(x)),
    ],
  });
  const cpu = compileModule(sat);

  it('an f32 source saturates into u32 and i32', () => {
    expect(cpu.fns['toU']!(1e20)).toBe(4294967040);
    expect(cpu.fns['toU']!(-5)).toBe(0);
    expect(cpu.fns['toI']!(1e20)).toBe(2147483520);
    expect(cpu.fns['toI']!(-1e20)).toBe(-2147483648);
  });

  it('an integer result of a builtin wraps into its type', () => {
    expect(cpu.fns['absI']!(-2147483648)).toBe(-2147483648);
  });
});

describe('oracle: a declared function takes the call written for it', () => {
  it('a declared saturate and a declared pow are called, not the builtins', () => {
    expect(
      run(`function saturate(x: f32): f32 { return x + 100.; }
function pow(x: f32, y: f32): f32 { return x + y + 1000.; }
export function run(): vec2 { return vec2(saturate(0.5), pow(2., 3.)); }`),
    ).toEqual([100.5, 1005]);
  });

  it('the builtin is still called where nothing is declared', () => {
    expect(
      run(`export function run(): vec2 { return vec2(saturate(1.5), Math.pow(2., 3.)); }`),
    ).toEqual([1, 8]);
  });
});

describe('oracle: stores and statements', () => {
  it('a function writes a module variable that the caller reads in the same call', () => {
    expect(
      run(`let g: f32 = 0.;
function bump(): void { g = g + 1.; }
export function run(): f32 { bump(); bump(); return g; }`),
    ).toBe(2);
  });

  it('a private variable restarts at its initializer on each host call', () => {
    const cpu = compileModule(
      moduleOf(`let g: f32 = 10.;
function bump(): void { g = g + 1.; }
export function run(): f32 { bump(); bump(); return g; }`),
    );
    expect(cpu.fns['run']!()).toBe(12);
    expect(cpu.fns['run']!()).toBe(12);
  });

  it('a compound assignment of a vector does not alias the other name', () => {
    expect(
      run(`export function run(): vec2 {
  let w = vec2(1., 2.);
  let v = w;
  v += vec2(10., 10.);
  return w;
}`),
    ).toEqual([1, 2]);
  });

  it('continue in a for loop skips to the update', () => {
    expect(
      run(`export function run(): f32 {
  let acc = 0.;
  for (let i = 0; i < 6; i++) {
    if (i % 2 === 0) { continue; }
    acc += 1.;
  }
  return acc;
}`),
    ).toBe(3);
  });

  it('a void function called as a statement yields no value', () => {
    const cpu = compileModule(
      moduleOf(`let g: f32 = 0.;\nexport function run(): void { g = 1.; }`),
    );
    expect(cpu.fns['run']!()).toBeUndefined();
  });
});

describe('oracle: f32 mode rounds an initializer that autoVars materialises', () => {
  it('a value assigned after its binding holds the f32 of its initializer', () => {
    const m = module({
      funcs: [
        fn('t', {}, f32T, () => {
          const a = f32(0.1);
          a.assign(a.add(f32(0)));
          return a;
        }),
      ],
    });
    expect(compileModule(m, { precision: 'f32' }).fns['t']!()).toBe(Math.fround(0.1));
    expect(compileModule(m).fns['t']!()).toBe(0.1);
  });
});

describe('oracle: statements the CPU does not run', () => {
  const withBody = (body: ModuleDecl['funcs'][number]['body']): ModuleDecl => ({
    consts: [],
    structs: [],
    bindings: [],
    funcs: [{ name: 'host', params: [], ret: { kind: 'void' }, body }],
  });

  it('a raw statement throws, naming the passthrough', () => {
    const cpu = compileModule(withBody([{ s: 'raw', wgsl: 'x = 1.0;' }]));
    expect(() => cpu.fns['host']!()).toThrow(/raw Stmt reached CPU backend/);
  });

  it('a structurally invalid module is refused before it runs', () => {
    expect(() =>
      compileModule({
        consts: [],
        structs: [],
        bindings: [],
        funcs: [
          { name: 'a', params: [], ret: { kind: 'void' }, body: [] },
          { name: 'a', params: [], ret: { kind: 'void' }, body: [] },
        ],
      }),
    ).toThrow(ValidationError);
  });
});

describe('oracle: barriers', () => {
  const KERNEL = `"use typeshade";
@compute([2, 1, 1]) export function w(lid: builtin<"local_invocation_id">): void {
  workgroupBarrier();
}
`;

  it('a barrier called one invocation at a time is refused', () => {
    const cpu = compileModule(moduleOf(KERNEL.slice(KERNEL.indexOf('\n') + 1)));
    expect(() => cpu.fns['w']!([0, 0, 0])).toThrow(/workgroupBarrier\(\) waits for the other/);
  });
});

describe('oracle: a module constant reads its full-precision value', () => {
  it('cpuValue is returned, not the truncated shader constant', () => {
    const m: ModuleDecl = {
      consts: [{ name: 'K', type: f32T, wgslValue: 3.14159265, cpuValue: Math.PI }],
      structs: [],
      bindings: [],
      funcs: [
        {
          name: 'k',
          params: [],
          ret: f32T,
          body: [{ s: 'return', expr: { op: 'constref', name: 'K', type: f32T } }],
        },
      ],
    };
    expect(compileModule(m).fns['k']!()).toBe(Math.PI);
  });
});
