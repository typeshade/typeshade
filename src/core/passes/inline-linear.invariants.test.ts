import { describe, it, expect } from 'vitest';
import {
  module,
  fn,
  f32T,
  boolT,
  floor,
  fract,
  type ModuleDecl,
  type FuncDecl,
  type Expr,
  type Stmt,
} from '../ir/index.js';
import { emitModule } from '../backends/wgsl.js';
import { emitGlslModule } from '../backends/glsl.js';
import { compileModule } from '../oracle.js';
import { inlineLinearAll } from './inline-linear.js';

const varref = (name: string): Expr => ({ op: 'varref', type: f32T, name });
const param = (name: string): Expr => ({ op: 'param', type: f32T, name });
const lit = (value: number): Expr => ({ op: 'lit', type: f32T, value });
const call = (name: string, ...args: Expr[]): Expr => ({ op: 'call', type: f32T, fn: name, args });
const binop = (bop: '+' | '*', a: Expr, b: Expr): Expr => ({ op: 'binop', bop, type: f32T, a, b });

const func = (name: string, params: string[], body: Stmt[]): FuncDecl => ({
  name,
  params: params.map((p) => ({ name: p, type: f32T })),
  ret: f32T,
  body,
});

const bare = (funcs: FuncDecl[]): ModuleDecl => ({ ...module({ funcs: [] }), funcs });

const names = (m: ModuleDecl): string[] => m.funcs.map((f) => f.name);

describe('inlineLinearAll — refusals the source states', () => {
  it('leaves a helper that holds a call statement kept for its effect', () => {
    const effect = func(
      'effect',
      ['x'],
      [
        { s: 'call', expr: call('sink', param('x')) },
        { s: 'return', expr: param('x') },
      ],
    );
    const sink = func('sink', ['x'], [{ s: 'return', expr: param('x') }]);
    const caller = func('caller', ['y'], [{ s: 'return', expr: call('effect', param('y')) }]);
    const out = inlineLinearAll(bare([effect, sink, caller]));
    expect(names(out)).toContain('effect');
  });

  it('leaves the whole module untouched when a function holds a raw statement', () => {
    const helper = func(
      'helper',
      ['x'],
      [
        { s: 'let', name: 'a', expr: binop('*', param('x'), lit(2)) },
        { s: 'return', expr: varref('a') },
      ],
    );
    const rawFn = func(
      'rawFn',
      ['x'],
      [
        { s: 'raw', wgsl: 'let z = 1.0;', glsl: 'float z = 1.0;' },
        { s: 'return', expr: param('x') },
      ],
    );
    const caller = func('caller', ['y'], [{ s: 'return', expr: call('helper', param('y')) }]);
    const m = bare([helper, rawFn, caller]);
    expect(inlineLinearAll(m)).toBe(m);
  });

  it('leaves a helper that calls itself from inside its own loop', () => {
    const loopBody: Stmt[] = [
      {
        s: 'assign',
        target: varref('r'),
        expr: binop('+', varref('r'), call('rec', varref('i'))),
      },
    ];
    const rec = func(
      'rec',
      ['x'],
      [
        { s: 'var', name: 'r', type: f32T, init: param('x') },
        {
          s: 'for',
          init: { s: 'var', name: 'i', type: f32T, init: lit(0) },
          cond: { op: 'compare', cop: '<', type: boolT, a: varref('i'), b: lit(2) },
          update: {
            s: 'assign',
            target: varref('i'),
            expr: binop('+', varref('i'), lit(1)),
          },
          body: loopBody,
        },
        { s: 'return', expr: varref('r') },
      ],
    );
    const caller = func('caller', ['y'], [{ s: 'return', expr: call('rec', param('y')) }]);
    const m = bare([rec, caller]);
    expect(inlineLinearAll(m)).toBe(m);
  });

  it('leaves a helper that nothing calls', () => {
    const idle = func(
      'idle',
      ['x'],
      [
        { s: 'let', name: 'a', expr: binop('*', param('x'), lit(2)) },
        { s: 'return', expr: varref('a') },
      ],
    );
    const other = func('other', ['y'], [{ s: 'return', expr: param('y') }]);
    const m = bare([idle, other]);
    expect(inlineLinearAll(m)).toBe(m);
  });
});

describe('inlineLinearAll — what the inlining keeps', () => {
  const twice = fn('twice', { p: f32T }, f32T, ({ p }, b) => {
    const a = b.let('a', floor(p));
    const c = b.let('c', fract(p));
    b.ret(a.add(c).mul(2).add(1));
  });

  it('keeps the order of nested calls: the inner call lands before the outer', () => {
    const m = module({
      funcs: [
        twice,
        fn('caller', { x: f32T }, f32T, ({ x }, b) => {
          b.ret(twice({ p: twice({ p: x }) }));
        }),
      ],
    });
    const out = inlineLinearAll(m);
    expect(emitModule(out)).not.toContain('fn twice');
    for (const v of [0.3, 1.7, -2.4]) {
      expect(compileModule(out).fns.caller(v) as number).toBe(
        compileModule(m).fns.caller(v) as number,
      );
    }
  });

  it('keeps one single separator when the helper local starts with an underscore', () => {
    const under = func(
      'under',
      ['x'],
      [
        { s: 'let', name: '_v0', expr: binop('*', param('x'), lit(2)) },
        { s: 'let', name: '_v1', expr: binop('+', varref('_v0'), param('x')) },
        { s: 'return', expr: binop('*', varref('_v1'), varref('_v0')) },
      ],
    );
    const caller: FuncDecl = {
      ...func(
        'caller',
        [],
        [{ s: 'return', expr: binop('+', call('under', lit(5)), call('under', lit(3))) }],
      ),
      stage: 'fragment',
      retAttr: '@location(0)',
    };
    const glsl = emitGlslModule(bare([under, caller]), 'fragment', {
      plugins: [{ name: 'inline', transformIR: inlineLinearAll }],
    });
    expect(glsl).not.toContain('under(');
    expect(glsl).not.toContain('__');
  });

  it('threads one counter through a sequence of calls so lift temps never repeat', () => {
    const counter = { n: 0 };
    const m = module({
      funcs: [
        twice,
        fn('caller', { x: f32T }, f32T, ({ x }, b) => {
          b.ret(twice({ p: x }));
        }),
      ],
    });
    inlineLinearAll(m, counter);
    expect(counter.n).toBeGreaterThan(0);
    const after = counter.n;
    inlineLinearAll(m, counter);
    expect(counter.n).toBe(after * 2);
    const wgsl = emitModule(inlineLinearAll(m, { n: after }));
    expect(wgsl).toContain(`_inl${after}_`);
    expect(wgsl).not.toContain('_inl0_');
  });

  it('does not fold float constants while it cleans up', () => {
    const scaled = func(
      'scaled',
      ['x'],
      [
        { s: 'let', name: 'a', expr: binop('*', param('x'), lit(1)) },
        { s: 'return', expr: binop('+', varref('a'), lit(0)) },
      ],
    );
    const caller = func('caller', ['y'], [{ s: 'return', expr: call('scaled', param('y')) }]);
    const out = inlineLinearAll(bare([scaled, caller]));
    const text = JSON.stringify(out.funcs.find((f) => f.name === 'caller')!.body);
    expect(text).toContain('"bop":"*"');
    expect(text).toContain('"bop":"+"');
  });
});
