import { describe, it, expect } from 'vitest';
import {
  fn,
  module,
  f64T,
  f32T,
  vec3f64T,
  toF32,
  sqrt,
  abs,
  floor,
  fract,
  round,
  sin,
  cos,
  normalize,
  distance,
  mix,
  type Expr,
} from '../ir/index.js';
import { fp64Lower } from './fp64-lower.js';

const returned = (m: ReturnType<typeof module>): Expr => {
  const k = fp64Lower(m).funcs.find((f) => f.name === 'k')!;
  const last = k.body[k.body.length - 1]!;
  if (last.s !== 'return' || last.expr === undefined) throw new Error('k does not return');
  return last.expr;
};

const isCall = (e: Expr): e is Extract<Expr, { op: 'call' }> => e.op === 'call';

const isRenorm = (e: Expr): boolean =>
  isCall(e) && /^df64_(v\d_)?add$/.test(e.fn) && JSON.stringify(e.args[1]).includes('bitcastF32');

const argsOf = (e: Expr): readonly Expr[] => {
  if (!isCall(e)) throw new Error('not a call');
  return e.args.filter((x) => !(isCall(x) && x.fn === 'f64Guard'));
};

type Method = Record<string, (x: unknown) => unknown>;
const send = (a: unknown, op: string, b: unknown): unknown => (a as Method)[op]!(b);
const apply = (f: unknown, ...xs: unknown[]): unknown => (f as (...a: unknown[]) => unknown)(...xs);

const scalar = (body: (a: unknown, b: unknown) => unknown): Expr =>
  returned(
    module({
      funcs: [fn('k', { a: f64T, b: f64T }, (p) => body(p.a, p.b) as never)],
    }),
  );

const vector = (body: (a: unknown, b: unknown) => unknown): Expr =>
  returned(
    module({
      funcs: [fn('k', { a: vec3f64T, b: vec3f64T }, (p) => body(p.a, p.b) as never)],
    }),
  );

describe('a raw operand is renormed before a cancelling op, and only before one', () => {
  it('scalar sub and div renorm both raw operands; add and mul renorm neither', () => {
    for (const op of ['sub', 'div'] as const) {
      const e = scalar((a, b) => send(a, op, b));
      expect(argsOf(e).map(isRenorm), op).toEqual([true, true]);
    }
    for (const op of ['add', 'mul'] as const) {
      const e = scalar((a, b) => send(a, op, b));
      expect(argsOf(e).map(isRenorm), op).toEqual([false, false]);
    }
  });

  it('a helper output is not renormed again', () => {
    const e = scalar((a, b) => send(send(a, 'add', b), 'sub', b));
    expect(argsOf(e).map(isRenorm)).toEqual([false, true]);
  });

  it('vec64 sub and div renorm both raw operands; add and mul renorm neither', () => {
    for (const op of ['sub', 'div'] as const) {
      const e = vector((a, b) => send(a, op, b));
      expect(argsOf(e).map(isRenorm), op).toEqual([true, true]);
    }
    for (const op of ['add', 'mul'] as const) {
      const e = vector((a, b) => send(a, op, b));
      expect(argsOf(e).map(isRenorm), op).toEqual([false, false]);
    }
  });

  it('scalar fract, round, sin and cos renorm their operand; sqrt, abs and floor do not', () => {
    const cancelling = { fract, round, sin, cos } as const;
    for (const [name, f] of Object.entries(cancelling)) {
      const e = scalar((a) => apply(f, a));
      expect(isRenorm(argsOf(e)[0]!), name).toBe(true);
    }
    const plain = { sqrt, abs, floor } as const;
    for (const [name, f] of Object.entries(plain)) {
      const e = scalar((a) => apply(f, a));
      expect(isRenorm(argsOf(e)[0]!), name).toBe(false);
    }
  });

  it('vec64 fract, round, normalize, sin and cos renorm their operand; abs and floor do not', () => {
    const cancelling = { fract, round, normalize, sin, cos } as const;
    for (const [name, f] of Object.entries(cancelling)) {
      const e = vector((a) => apply(f, a));
      expect(isRenorm(argsOf(e)[0]!), name).toBe(true);
    }
    const plain = { abs, floor } as const;
    for (const [name, f] of Object.entries(plain)) {
      const e = vector((a) => apply(f, a));
      expect(isRenorm(argsOf(e)[0]!), name).toBe(false);
    }
  });

  it('mix renorms both pair operands and leaves the f32 interpolant alone', () => {
    const k = (a: unknown, b: unknown): Expr =>
      returned(
        module({
          funcs: [
            fn(
              'k',
              { a: a as never, b: b as never, t: f32T },
              (p) => apply(mix, p.a, p.b, p.t) as never,
            ),
          ],
        }),
      );
    for (const T of [f64T, vec3f64T]) {
      const args = argsOf(k(T, T));
      expect(args.map(isRenorm), T.kind).toEqual([true, true, false]);
    }
  });

  it('distance renorms the raw lane operands of every per-lane subtraction', () => {
    const e = returned(
      module({
        funcs: [
          fn('k', { a: vec3f64T, b: vec3f64T }, f32T, (p, bb) => {
            bb.ret(toF32(distance(p.a, p.b)));
          }),
        ],
      }),
    );
    const subs: Expr[] = [];
    const visit = (x: Expr): void => {
      if (isCall(x)) {
        if (x.fn === 'df64_sub') subs.push(x);
        x.args.forEach(visit);
      }
    };
    visit(e);
    expect(subs).toHaveLength(3);
    for (const s of subs) expect(argsOf(s).map(isRenorm)).toEqual([true, true]);
  });
});
