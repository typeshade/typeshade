import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Expr, Stmt, ModuleDecl, ShaderType, BinOp } from './ir/index.js';
import { f32T, i32T, boolT, voidT, vec3fT } from './ir/index.js';
import { compileModule, type CpuPrecision } from './oracle.js';
import { compileModuleJs } from './cpu-codegen.js';
import type { CpuValue } from './cpu-runtime.js';

const lit = (v: number | boolean, type: ShaderType = f32T): Expr => ({ op: 'lit', type, value: v });
const param = (name: string, type: ShaderType = f32T): Expr => ({ op: 'param', type, name });
const vref = (name: string, type: ShaderType = f32T): Expr => ({ op: 'varref', type, name });
const oref = (name: string, type: ShaderType = f32T): Expr => ({ op: 'overrideref', type, name });
const bin = (bop: BinOp, a: Expr, b: Expr, type: ShaderType = f32T): Expr => ({
  op: 'binop',
  type,
  bop,
  a,
  b,
});
const call = (fn: string, args: Expr[] = [], type: ShaderType = f32T): Expr => ({
  op: 'call',
  type,
  fn,
  args,
});
const sel = (cond: Expr, ifTrue: Expr, ifFalse: Expr): Expr => ({
  op: 'select',
  type: f32T,
  cond,
  ifTrue,
  ifFalse,
});
const matchE = (scrutinee: Expr, cases: ReadonlyArray<readonly [number, Expr]>, d: Expr): Expr => ({
  op: 'matchExpr',
  type: f32T,
  scrutinee,
  cases,
  default: d,
});
const member = (base: Expr, field: string, type: ShaderType = f32T): Expr => ({
  op: 'member',
  type,
  base,
  field,
});
const construct = (type: ShaderType, args: Expr[]): Expr => ({ op: 'construct', type, args });
const ret = (expr?: Expr): Stmt => ({ s: 'return', expr });
const letS = (name: string, expr: Expr): Stmt => ({ s: 'let', name, expr });
const assign = (target: Expr, expr: Expr): Stmt => ({ s: 'assign', target, expr });
const callS = (expr: Expr): Stmt => ({ s: 'call', expr });
const varS = (name: string, type: ShaderType, init?: Expr): Stmt => ({
  s: 'var',
  name,
  type,
  init,
});
const cmp = (cop: '>' | '<' | '!=', a: Expr, b: Expr, type: ShaderType = boolT): Expr => ({
  op: 'compare',
  type,
  cop,
  a,
  b,
});
const ifS = (cond: Expr, body: Stmt[]): Stmt => ({ s: 'if', arms: [{ cond, body }] });
const rawS: Stmt = { s: 'raw', wgsl: 'return a;' };

type P = { name: string; type: ShaderType; mode?: 'inout' };
const func = (name: string, params: P[], retType: ShaderType, body: Stmt[]) => ({
  name,
  params,
  ret: retType,
  body,
});

const counter = { name: 'n', space: 'private' as const, type: f32T, init: lit(0) };
const bumpInc = assign(vref('n'), bin('+', vref('n'), lit(1)));
const bumpF32 = func('bumpF32', [], f32T, [bumpInc, ret(vref('n'))]);
const bumpI32 = func('bumpI32', [], i32T, [
  bumpInc,
  ret({ op: 'call', type: i32T, fn: 'i32', args: [vref('n')] }),
]);

const emptyModule = (m: Partial<ModuleDecl>): ModuleDecl => ({
  consts: [],
  structs: [],
  bindings: [],
  funcs: [],
  ...m,
});

const PRECISIONS: readonly CpuPrecision[] = ['f64', 'f32'];

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function everyEngine(
  m: ModuleDecl,
  name: string,
  args: CpuValue[] = [],
  extra: { overrides?: Record<string, CpuValue> } = {},
): CpuValue[] {
  return PRECISIONS.flatMap((precision) =>
    [compileModule(m, { precision, ...extra }), compileModuleJs(m, { precision, ...extra })].map(
      (engine) => engine.fns[name]!(...(clone(args) as never[])),
    ),
  );
}

const all = (value: CpuValue): CpuValue[] => [value, value, value, value];

describe('the generated code evaluates only what the interpreter evaluates', () => {
  const m = emptyModule({
    vars: [counter],
    funcs: [
      bumpF32,
      bumpI32,
      func('selectTrue', [], f32T, [
        letS('t', sel(lit(true), lit(1), call('bumpF32'))),
        ret(vref('n')),
      ]),
      func('selectFalse', [], f32T, [
        letS('t', sel(lit(false), call('bumpF32'), lit(1))),
        ret(vref('n')),
      ]),
      func('matchOnce', [], f32T, [
        letS(
          't',
          matchE(
            call('bumpI32', [], i32T),
            [
              [2, lit(20)],
              [1, lit(10)],
            ],
            lit(30),
          ),
        ),
        ret(bin('+', vref('t'), bin('*', vref('n'), lit(1000)))),
      ]),
      func('matchArms', [], f32T, [
        letS(
          't',
          matchE(
            lit(1, i32T),
            [
              [1, lit(10)],
              [2, call('bumpF32')],
            ],
            call('bumpF32'),
          ),
        ),
        ret(bin('+', vref('t'), bin('*', vref('n'), lit(1000)))),
      ]),
    ],
  });

  it('evaluates one arm of a scalar select', () => {
    expect(everyEngine(m, 'selectTrue')).toEqual(all(0));
    expect(everyEngine(m, 'selectFalse')).toEqual(all(0));
  });

  it('evaluates the scrutinee of a match once, and only the matched arm', () => {
    expect(everyEngine(m, 'matchOnce')).toEqual(all(10 + 1000));
    expect(everyEngine(m, 'matchArms')).toEqual(all(10));
  });
});

describe('the generated code takes its inputs from where the interpreter takes them', () => {
  it('reads an override from the value the host selected, else from its default', () => {
    const m = emptyModule({
      overrides: [{ name: 'OV', type: f32T, default: 7.5 }],
      funcs: [func('ov', [], f32T, [ret(oref('OV'))])],
    });
    expect(everyEngine(m, 'ov')).toEqual(all(7.5));
    expect(everyEngine(m, 'ov', [], { overrides: { OV: 3 } })).toEqual(all(3));
  });

  it('holds a workgroup variable as zero before any invocation writes it', () => {
    const m = emptyModule({
      vars: [{ name: 'w', space: 'workgroup', type: f32T }],
      funcs: [func('read', [], f32T, [ret(vref('w'))])],
    });
    expect(everyEngine(m, 'read')).toEqual(all(0));
  });

  it('starts a private variable over at every call from the host', () => {
    const m = emptyModule({
      vars: [counter],
      funcs: [bumpF32],
    });
    for (const precision of PRECISIONS) {
      const js = compileModuleJs(m, { precision }).fns.bumpF32!;
      expect([js(), js(), js()]).toEqual([1, 1, 1]);
    }
  });

  it('reads a resource from what setBinding gave, in a compiled and in an interpreted function', () => {
    const m = emptyModule({
      bindings: [{ group: 0, binding: 0, name: 'buf', space: 'uniform', type: f32T }],
      funcs: [
        func('compiled', [], f32T, [ret(vref('buf'))]),
        func('interpreted', [], f32T, [ifS(cmp('>', lit(1), lit(2)), [rawS]), ret(vref('buf'))]),
      ],
    });
    const js = compileModuleJs(m);
    js.setBinding('buf', 5);
    expect(js.fns.compiled!()).toBe(5);
    expect(js.fns.interpreted!()).toBe(5);
  });
});

describe('the generated code writes through an inout parameter on every way out', () => {
  it('stores the parameter back when the function returns with no value', () => {
    const m = emptyModule({
      funcs: [
        func('inc', [{ name: 'x', type: f32T, mode: 'inout' }], voidT, [
          assign(param('x'), bin('+', param('x'), lit(1))),
          ifS(cmp('>', param('x'), lit(0)), [ret()]),
          assign(param('x'), bin('+', param('x'), lit(10))),
        ]),
        func('run', [{ name: 'start', type: f32T }], f32T, [
          varS('v', f32T, param('start')),
          callS(call('inc', [vref('v')], voidT)),
          ret(vref('v')),
        ]),
      ],
    });
    for (const precision of PRECISIONS) {
      const run = compileModuleJs(m, { precision }).fns.run!;
      expect([run(5), run(1), run(5)]).toEqual([6, 2, 6]);
    }
  });
});

describe('a host-provided global has no CPU value', () => {
  it('refuses the call on both engines instead of reading zero', () => {
    const m = emptyModule({
      externs: [{ name: 'host', type: f32T }],
      funcs: [func('read', [], f32T, [ret({ op: 'externref', type: f32T, name: 'host' })])],
    });
    for (const engine of [compileModule(m), compileModuleJs(m)]) {
      expect(() => engine.fns.read!()).toThrow();
    }
  });
});

describe('a host that blocks `new Function`', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('makes compileModuleJs throw, so the caller can fall the whole module back', () => {
    const m = emptyModule({ funcs: [func('one', [], f32T, [ret(lit(1))])] });
    vi.stubGlobal('Function', function blocked() {
      throw new EvalError('blocked by a content security policy');
    });
    expect(() => compileModuleJs(m)).toThrow('blocked by a content security policy');
  });
});

describe('an f32 parameter the function writes is read as it was last written', () => {
  it('rounds each read of it, and does not hold the value it had at entry', () => {
    const m = emptyModule({
      funcs: [
        func('written', [{ name: 'a', type: f32T }], f32T, [
          assign(vref('a'), bin('+', param('a'), lit(0.1))),
          ret(bin('*', param('a'), lit(3))),
        ]),
      ],
    });
    const [interpreter64, generated64, interpreter32, generated32] = everyEngine(m, 'written', [1]);
    expect(generated64).toBe(interpreter64);
    expect(generated32).toBe(interpreter32);
    expect(generated32).not.toBe(3);
  });
});

describe('a private variable initialised from a module constant', () => {
  it('starts every host call from the constant, which no call has changed', () => {
    const m = emptyModule({
      consts: [
        {
          name: 'KV',
          type: vec3fT,
          wgslValue: 0,
          cpuValue: 0,
          valueExpr: construct(vec3fT, [lit(1), lit(2), lit(3)]),
        },
      ],
      vars: [
        {
          name: 'w',
          space: 'private',
          type: vec3fT,
          init: { op: 'constref', type: vec3fT, name: 'KV' },
        },
      ],
      funcs: [
        func('bump', [], f32T, [
          assign(member(vref('w', vec3fT), 'x'), bin('+', member(vref('w', vec3fT), 'x'), lit(1))),
          ret(member(vref('w', vec3fT), 'x')),
        ]),
      ],
    });
    for (const precision of PRECISIONS) {
      const bump = compileModuleJs(m, { precision }).fns.bump!;
      expect([bump(), bump(), bump()]).toEqual([2, 2, 2]);
    }
  });
});

describe('a write to a resource', () => {
  it('lands in the binding a later call reads, not in a local of the writing function', () => {
    const m = emptyModule({
      bindings: [
        { group: 0, binding: 0, name: 'last', space: 'storage', access: 'read_write', type: f32T },
      ],
      funcs: [
        func('write', [{ name: 'v', type: f32T }], voidT, [assign(vref('last'), param('v'))]),
        func('read', [], f32T, [ret(vref('last'))]),
      ],
    });
    for (const make of [compileModule, compileModuleJs]) {
      const cm = make(m);
      cm.setBinding('last', 0);
      cm.fns.write!(5);
      expect(cm.fns.read!()).toBe(5);
    }
  });
});

describe('an inout argument that is a component of a vector', () => {
  it('stores the parameter back into that component', () => {
    const m = emptyModule({
      funcs: [
        func('inc', [{ name: 'x', type: f32T, mode: 'inout' }], voidT, [
          assign(param('x'), bin('+', param('x'), lit(1))),
        ]),
        func('run', [{ name: 'start', type: vec3fT }], vec3fT, [
          varS('v', vec3fT, param('start', vec3fT)),
          callS(call('inc', [member(vref('v', vec3fT), 'y')], voidT)),
          ret(vref('v', vec3fT)),
        ]),
      ],
    });
    for (const precision of PRECISIONS) {
      const run = compileModuleJs(m, { precision }).fns.run!;
      expect(run([1, 2, 3])).toEqual([1, 3, 3]);
      expect(run([4, 5, 6])).toEqual([4, 6, 6]);
    }
  });
});
