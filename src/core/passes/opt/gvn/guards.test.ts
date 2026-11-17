import { describe, expect, it } from 'vitest';
import {
  f32,
  f32T,
  fn,
  module,
  normalize,
  vec3,
  type ModuleDecl,
  type Stmt,
} from '../../../ir/index.js';
import { gvn } from '../gvn.js';

const repeatAcrossTwoStatements = (): ModuleDecl =>
  module({
    funcs: [
      fn('f', { x: f32T }, f32T, ({ x }, b) => {
        const v = b.let('v', vec3(x, x.mul(2), x.mul(3)));
        const p = b.let('p', normalize(v).x);
        const q = b.let('q', normalize(v).y);
        b.ret(p.add(q));
      }),
    ],
  });

const tempNames = (body: readonly Stmt[]): string[] =>
  body.flatMap((s) => (s.s === 'let' && /^_gv\d+$/.test(s.name) ? [s.name] : []));

const withBody = (m: ModuleDecl, body: (own: readonly Stmt[]) => Stmt[]): ModuleDecl => ({
  ...m,
  funcs: [{ ...m.funcs[0]!, body: body(m.funcs[0]!.body) }],
});

describe('gvn guards', () => {
  it('binds the repeat of the fixture, so the guards below have something to refuse', () => {
    expect(tempNames(gvn(repeatAcrossTwoStatements()).funcs[0]!.body)).toEqual(['_gv0']);
  });

  it('leaves a function with a raw statement alone, even when it has a repeat', () => {
    const m = withBody(repeatAcrossTwoStatements(), (own) => [
      { s: 'raw', wgsl: 'let unseen = 1.0;' },
      ...own,
    ]);
    expect(gvn(m).funcs[0]!.body).toEqual(m.funcs[0]!.body);
  });

  it('binds no temp for a repeat that only the branches of a select hold', () => {
    const m = module({
      funcs: [
        fn('f', { x: f32T }, f32T, ({ x }, b) => {
          const v = b.let('v', vec3(x, x.mul(2), x.mul(3)));
          const positive = x.gt(0);
          const p = b.let('p', positive.select(normalize(v).x, f32(0)));
          const q = b.let('q', positive.select(normalize(v).y, f32(1)));
          b.ret(p.add(q));
        }),
      ],
    });
    expect(tempNames(gvn(m).funcs[0]!.body)).toEqual([]);
  });

  it('numbers a new temp after the temps the function already has', () => {
    const once = gvn(repeatAcrossTwoStatements());
    const twice = gvn(
      withBody(once, (own) => {
        const ret = own[own.length - 1]!;
        const repeatAgain = repeatAcrossTwoStatements().funcs[0]!.body.filter(
          (s) => s.s === 'let' && (s.name === 'p' || s.name === 'q'),
        ) as Extract<Stmt, { s: 'let' }>[];
        return [
          ...own.slice(0, -1),
          { ...repeatAgain[0]!, name: 'p2', expr: flipped(repeatAgain[0]!.expr) },
          { ...repeatAgain[1]!, name: 'q2', expr: flipped(repeatAgain[1]!.expr) },
          ret,
        ];
      }),
    );
    const names = tempNames(twice.funcs[0]!.body);
    expect(names).toEqual([...new Set(names)]);
    expect(names).toContain('_gv0');
    expect(names).toContain('_gv1');
  });
});

function flipped(e: Extract<Stmt, { s: 'let' }>['expr']): typeof e {
  if (e.op !== 'member') throw new Error('the fixture reads a member of normalize(v)');
  return {
    ...e,
    base: { op: 'unop', type: e.base.type, operator: '-', a: e.base } as typeof e.base,
  };
}
