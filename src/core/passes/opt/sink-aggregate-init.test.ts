import { describe, expect, it } from 'vitest';
import { compile } from '../../../compiler/ts/compile.js';
import { compileModule } from '../../oracle.js';
import { sinkAggregateInit } from './sink-aggregate-init.js';

function fixture(branch = 'if (take) { result = make(x); }', prelude = '') {
  const r = compile(`"use typeshade";
    function make(x: f32): array<f32, 3> { return [x, x + 1., x + 2.]; }
    ${prelude}
    export function f(x: f32, take: bool): array<f32, 3> {
      let source: array<f32, 3> = [x * 2., x * 3., x * 4.];
      let result = source;
      ${branch}
      return result;
    }`);
  expect(r.diagnostics).toEqual([]);
  return r.module;
}

describe('sink aggregate initialization to the path that needs its snapshot', () => {
  it('retains both branch values and moves the copy into else', () => {
    const m = fixture(),
      out = sinkAggregateInit(m);
    const body = out.funcs.find((f) => f.name === 'f')!.body;
    const decl = body.find((s) => s.s === 'var' && s.name === 'result');
    expect(decl?.s === 'var' && decl.init).toBeUndefined();
    const branch = body.find((s) => s.s === 'if');
    expect(branch?.s === 'if' && branch.elseBody?.[0]).toMatchObject({
      s: 'assign',
      target: { name: 'result' },
      expr: { name: 'source' },
    });
    for (const take of [false, true])
      for (const x of [-2.5, 0, 3])
        expect(compileModule(out).fns.f!(x, take)).toEqual(compileModule(m).fns.f!(x, take));
    expect(sinkAggregateInit(out)).toEqual(out);
  });

  it('preserves the old value when the existing else reads or partially updates it', () => {
    const m = fixture('if (take) { result = make(x); } else { result[1] = result[0] + 1.; }');
    for (const take of [false, true])
      expect(compileModule(sinkAggregateInit(m)).fns.f!(2, take)).toEqual(
        compileModule(m).fns.f!(2, take),
      );
  });

  it.each([
    'if (take) { result[0] = x; }',
    'if (result[0] > 0.) { result = make(x); }',
    'if (take) { result = make(result[0]); }',
    'if (take) { source[0] = x; result = make(x); }',
    'if (take) { result = make(x); } else if (x > 0.) { result[0] = x; }',
  ])('leaves an unsafe or unsupported branch alone: %s', (branch) => {
    const m = fixture(branch);
    expect(sinkAggregateInit(m)).toEqual(m);
  });

  it('does not delay the snapshot across a condition that mutates its source', () => {
    const m = fixture(
      'if (change(source)) { result = make(x); }',
      'function change(@inout a: array<f32, 3>): bool { a[0] = 99.; return false; }',
    );
    expect(sinkAggregateInit(m)).toEqual(m);
    expect(compileModule(m).fns.f!(2, false)).toEqual([4, 6, 8]);
  });
});
