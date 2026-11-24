import { describe, expect, it } from 'vitest';
import type { CpuValue } from '../cpu-runtime.js';
import {
  boolT,
  f32T,
  u32T,
  type Expr,
  type FuncDecl,
  type ShaderType,
  type Stmt,
} from '../ir/index.js';
import {
  add,
  call,
  entryModule,
  field,
  lit,
  moduleOfFuncs,
  mul,
  param,
  ref,
} from '../testing/ir-shorthand.js';
import { steppedResult } from '../testing/stepped-run.js';
import { startDebugSession } from './session.js';

const SOURCE = `"use typeshade";
class P {
  v: f32;
  bump(d: f32): void {
    this.v = this.v + d;
  }
}
class Box {
  p: P;
  q: P;
}
let counter: f32 = 0.;
function tick(): bool {
  counter = counter + 1.;
  return true;
}
export function bumpLocal(): f32 {
  let p = new P();
  p.v = 1.;
  p.bump(2.);
  return p.v;
}
export function bumpField(): f32 {
  let b = new Box();
  b.p.v = 1.;
  b.p.bump(2.);
  return b.p.v;
}
export function bumpElement(): f32 {
  let a: array<P, 2> = [new P(), new P()];
  a[1].v = 1.;
  a[1].bump(2.);
  return a[1].v;
}
export function andCalls(a: f32): f32 {
  counter = 0.;
  if (a > 5. && tick()) {
    counter = counter + 10.;
  }
  return counter;
}
export function orCalls(a: f32): f32 {
  counter = 0.;
  if (a > 5. || tick()) {
    counter = counter + 10.;
  }
  return counter;
}
export function pick(a: f32): f32 {
  counter = 0.;
  const r = a > 5. ? 1. : (tick() ? 2. : 3.);
  return counter * 10. + r;
}
export function sharedClause(a: i32): f32 {
  switch (a) {
    case 0:
    case 1:
      return 10.;
    case 2:
      return 20.;
    default:
      return 30.;
  }
}
`;

describe('a stepped call writes an inout argument back where the caller named it', () => {
  it('into a local', () => {
    expect(steppedResult(SOURCE, 'bumpLocal')).toBe(3);
  });

  it('into a field', () => {
    expect(steppedResult(SOURCE, 'bumpField')).toBe(3);
  });

  it('into an element', () => {
    expect(steppedResult(SOURCE, 'bumpElement')).toBe(3);
  });
});

describe('a stepped call writes a scalar inout argument back where the caller named it', () => {
  const arrayT: ShaderType = { kind: 'array', elem: f32T, n: 2 };
  const Q: ShaderType = { kind: 'struct', name: 'Q' };
  const structs = [{ name: 'Q', fields: [{ name: 'v', type: f32T }] }];
  const inc: FuncDecl = {
    name: 'inc',
    params: [{ name: 'a', type: f32T, mode: 'inout' }],
    ret: { kind: 'void' },
    body: [{ s: 'assign', target: ref('a'), expr: add(ref('a'), lit(1)) }],
  };
  const run = (body: Stmt[]): CpuValue | undefined => {
    const s = startDebugSession(
      moduleOfFuncs([{ name: 'fs', params: [], ret: f32T, body }, inc], structs),
      'fs',
      [],
    );
    s.continue();
    return s.result;
  };
  const incOf = (target: Expr): Stmt => ({
    s: 'call',
    expr: call('inc', [target], { kind: 'void' }),
  });

  it('into a local', () => {
    expect(
      run([
        { s: 'var', name: 'x', type: f32T, init: lit(1) },
        incOf(ref('x')),
        { s: 'return', expr: ref('x') },
      ]),
    ).toBe(2);
  });

  it('into a field', () => {
    expect(
      run([
        { s: 'var', name: 'q', type: Q, init: { op: 'construct', type: Q, args: [lit(1)] } },
        incOf(field(ref('q', Q), 'v')),
        { s: 'return', expr: field(ref('q', Q), 'v') },
      ]),
    ).toBe(2);
  });

  it('into an element', () => {
    const elem = (i: number): Expr => ({
      op: 'index',
      type: f32T,
      base: ref('a', arrayT),
      idx: lit(i, u32T),
    });
    expect(
      run([
        {
          s: 'var',
          name: 'a',
          type: arrayT,
          init: { op: 'construct', type: arrayT, args: [lit(1), lit(5)] },
        },
        incOf(elem(1)),
        { s: 'return', expr: add(mul(elem(1), lit(10)), elem(0)) },
      ]),
    ).toBe(61);
  });
});

describe('a stepped run evaluates only what the operators reach', () => {
  it('skips the right operand of && when the left is false, and runs it when true', () => {
    expect(steppedResult(SOURCE, 'andCalls', [1])).toBe(0);
    expect(steppedResult(SOURCE, 'andCalls', [9])).toBe(11);
  });

  it('skips the right operand of || when the left is true, and runs it when false', () => {
    expect(steppedResult(SOURCE, 'orCalls', [9])).toBe(10);
    expect(steppedResult(SOURCE, 'orCalls', [1])).toBe(11);
  });

  it('evaluates one arm of a conditional', () => {
    expect(steppedResult(SOURCE, 'pick', [9])).toBe(1);
    expect(steppedResult(SOURCE, 'pick', [1])).toBe(12);
  });
});

describe('a stepped select', () => {
  const choose = (cond: boolean): CpuValue | undefined => {
    const m = entryModule([
      {
        s: 'return',
        expr: {
          op: 'select',
          type: f32T,
          cond: { op: 'lit', type: boolT, value: cond },
          ifTrue: lit(1),
          ifFalse: call('dpdx', [param('x')]),
        },
      },
    ]);
    const s = startDebugSession(m, 'fs', [2]);
    s.continue();
    return s.result;
  };

  it('evaluates the chosen arm only, so the other arm cannot refuse', () => {
    expect(choose(true)).toBe(1);
    expect(() => choose(false)).toThrow(/dpdx/);
  });
});

describe('a stepped switch', () => {
  it('matches a clause that holds several selectors on each of them', () => {
    expect([0, 1, 2, 7].map((a) => steppedResult(SOURCE, 'sharedClause', [a]))).toEqual([
      10, 10, 20, 30,
    ]);
  });
});

describe('a stepped let stores an aggregate as a copy', () => {
  const P: ShaderType = { kind: 'struct', name: 'P' };
  const structs = [{ name: 'P', fields: [{ name: 'v', type: f32T }] }];

  it('so a later write to the source does not reach the name bound before it', () => {
    const m = entryModule(
      [
        { s: 'var', name: 'p', type: P, init: { op: 'construct', type: P, args: [lit(1)] } },
        { s: 'let', name: 'before', expr: ref('p', P) },
        { s: 'assign', target: field(ref('p', P), 'v'), expr: lit(2) },
        { s: 'return', expr: field(ref('before', P), 'v') },
      ],
      [{ name: 'x', type: f32T }],
      structs,
    );
    const session = startDebugSession(m, 'fs', [0]);
    session.continue();
    expect(session.result).toBe(1);
  });

  it('and so does an assignment to another name', () => {
    const m = entryModule(
      [
        { s: 'var', name: 'p', type: P, init: { op: 'construct', type: P, args: [lit(1)] } },
        { s: 'var', name: 'q', type: P, init: { op: 'construct', type: P, args: [lit(0)] } },
        { s: 'assign', target: ref('q', P), expr: ref('p', P) },
        { s: 'assign', target: field(ref('p', P), 'v'), expr: lit(2) },
        { s: 'return', expr: field(ref('q', P), 'v') },
      ],
      [{ name: 'x', type: f32T }],
      structs,
    );
    const session = startDebugSession(m, 'fs', [0]);
    session.continue();
    expect(session.result).toBe(1);
  });
});
