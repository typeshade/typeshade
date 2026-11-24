import { describe, expect, it } from 'vitest';
import type { CmpOp, Expr, Stmt } from '../../core/ir/nodes.js';
import { boolT, f32T, i32T, type ShaderType } from '../../core/ir/types.js';
import { compile } from './compile.js';
import type { Binding, LoweringScope } from './context.js';
import { bothRefuse } from '../../core/testing/both-halves.js';
import { analyzeCountedFor, boundWrittenIn, openLoopError } from './loop-bound.js';

const lit = (value: number, type: ShaderType = i32T): Expr => ({ op: 'lit', type, value });
const ref = (name: string, type: ShaderType = i32T): Expr => ({ op: 'varref', type, name });
const bin = (bop: '+' | '-' | '*' | '/', a: Expr, b: Expr): Expr => ({
  op: 'binop',
  type: i32T,
  bop,
  a,
  b,
});
const compare = (cop: CmpOp, a: Expr, b: Expr): Expr => ({
  op: 'compare',
  type: boolT,
  cop,
  a,
  b,
});
const scopeOf = (table: Record<string, Partial<Binding>>): LoweringScope =>
  ({ resolveIr: (name: string) => table[name] }) as unknown as LoweringScope;

const I = ref('i');
const initOf = (start: Expr, type: ShaderType = i32T): Stmt => ({
  s: 'var',
  name: 'i',
  type,
  init: start,
});
const addAssign = (bop: '+' | '-' | '*' | '/', by: Expr): Stmt => ({
  s: 'assignOp',
  target: I,
  bop,
  expr: by,
});
const reassign = (expr: Expr): Stmt => ({ s: 'assign', target: I, expr });

const analyze = (
  start: Expr,
  cop: CmpOp,
  bound: Expr,
  update: Stmt,
  scope: LoweringScope = scopeOf({}),
  type: ShaderType = i32T,
) => analyzeCountedFor(initOf(start, type), compare(cop, I, bound), update, scope);

const loopOf = (r: ReturnType<typeof analyze>) => {
  if (!r.ok) throw new Error(r.message);
  return r.loop;
};
const refusalOf = (r: ReturnType<typeof analyze>) => {
  if (r.ok) throw new Error('counted');
  return { message: r.message, code: r.code, endless: r.endless };
};

describe('the step of a counted for', () => {
  it('reads i = i + c, i = c + i and i = i - c, and no other assignment', () => {
    const n = lit(10);
    expect(loopOf(analyze(lit(0), '<', n, reassign(bin('+', I, lit(2))))).step).toBe(2);
    expect(loopOf(analyze(lit(0), '<', n, reassign(bin('+', lit(3), I)))).step).toBe(3);
    expect(loopOf(analyze(lit(10), '>', lit(0), reassign(bin('-', I, lit(2))))).step).toBe(-2);
    const constantDifference = reassign(bin('-', lit(5), lit(3)));
    expect(analyze(lit(10), '>', lit(0), constantDifference).ok).toBe(false);
  });

  it('reads no multiplication in an assignment, and no exit that compares the counter to itself', () => {
    const times = reassign(bin('*', I, lit(2)));
    expect(refusalOf(analyze(lit(1), '<', lit(100), times)).message).toBe(
      'for-update must be i++ / i += <const>, or i *= / /= <const>.',
    );
    const selfBound = analyzeCountedFor(
      initOf(lit(1)),
      compare('>', bin('*', I, lit(2)), I),
      addAssign('+', lit(1)),
      scopeOf({}),
    );
    expect(refusalOf(selfBound).code).toBe('TS8006');
  });

  it('counts the trips of each comparison, rounding the last partial step down', () => {
    expect(loopOf(analyze(lit(0), '<', lit(10), addAssign('+', lit(4)))).trips).toBe(3);
    expect(loopOf(analyze(lit(0), '<=', lit(10), addAssign('+', lit(4)))).trips).toBe(3);
    expect(loopOf(analyze(lit(10), '>', lit(0), addAssign('-', lit(4)))).trips).toBe(3);
    expect(loopOf(analyze(lit(0), '<', lit(12), addAssign('+', lit(4)))).trips).toBe(3);
  });

  it('keeps a runtime header counted, with the facts it knows', () => {
    const scope = scopeOf({ n: { mutable: true } });
    expect(loopOf(analyze(lit(0), '<', ref('n'), addAssign('+', lit(1)), scope))).toEqual({
      name: 'i',
      op: 'add',
      start: 0,
      step: 1,
    });
  });

  it('counts a division on a negative counter by truncation, as the targets do', () => {
    const loop = loopOf(analyze(lit(-9), '<', lit(0), addAssign('/', lit(2))));
    expect(loop.trips).toBe(4);
  });

  it('counts a factor that climbs slowly, within 64 checks', () => {
    const loop = loopOf(analyze(lit(1), '<', lit(1073741824), addAssign('*', lit(1.5, f32T))));
    expect(loop.trips).toBe(52);
  });

  it('refuses a runtime factor that is not a whole number, even above 2', () => {
    const scope = scopeOf({ n: { mutable: true } });
    const refused = analyze(lit(1), '<', ref('n'), addAssign('*', lit(2.5, f32T)), scope);
    expect(refusalOf(refused)).toEqual({
      message:
        'for step "i *= 2.5" with a runtime start or bound needs a whole factor of 2 or more, so its direction is known.',
      code: 'TS8006',
      endless: false,
    });
  });
});

describe('the header of a counted for', () => {
  it('names the counter as the author spelled it, not its IR name', () => {
    const scope = scopeOf({ i: { name: 'j' } });
    const refused = analyze(lit(0), '<', lit(4), addAssign('+', lit(0)), scope);
    expect(refusalOf(refused).message).toBe(
      'for step "j += 0" never advances "j": a step of 0 leaves it where it is.',
    );
  });

  it('marks as endless a stalled step over a constant header only', () => {
    const stall = addAssign('+', lit(0));
    expect(refusalOf(analyze(lit(0), '<', lit(4), stall)).endless).toBe(true);
    const scope = scopeOf({ n: { mutable: true } });
    expect(refusalOf(analyze(lit(0), '<', ref('n'), stall, scope)).endless).toBe(false);
  });

  it('refuses a start outside the counter type', () => {
    const refused = analyze(lit(5000000000), '<', lit(10), addAssign('+', lit(1)));
    expect(refusalOf(refused)).toEqual({
      message:
        'for (i = 5000000000; i < 10; i += 1) walks "i" outside the range of i32 before the condition fails.',
      code: 'TS8006',
      endless: true,
    });
  });

  it('counts != as landing on the bound, and refuses a step that cannot land', () => {
    expect(loopOf(analyze(lit(0), '!=', lit(9), addAssign('+', lit(3)))).trips).toBe(3);
    const stepsOver = analyze(lit(0), '!=', lit(10), addAssign('+', lit(3)));
    expect(refusalOf(stepsOver).message).toBe('for (i = 0; i != 10; i += 3) does not exit.');
    const awayFromIt = analyze(lit(10), '!=', lit(4), addAssign('+', lit(3)));
    expect(refusalOf(awayFromIt).message).toBe('for (i = 10; i != 4; i += 3) does not exit.');
  });

  it('counts == as one trip unless the step cannot move off the bound', () => {
    expect(loopOf(analyze(lit(5), '==', lit(5), addAssign('+', lit(1)))).trips).toBe(1);
    const tiny = analyze(lit(5), '==', lit(5), addAssign('+', lit(1e-20, f32T)));
    expect(refusalOf(tiny).message).toBe('for (i = 5; i == 5; i += 1e-20) does not exit.');
  });

  it('refuses ==, != and a step toward the wrong side against a runtime bound, each in its own words', () => {
    const scope = scopeOf({ n: { mutable: true } });
    const n = ref('n');
    expect(refusalOf(analyze(lit(0), '!=', n, addAssign('+', lit(2)), scope))).toEqual({
      message:
        'for exit "i != <bound>" with a runtime bound exits only if "i += 2" lands on it exactly. Compare with <, <=, > or >=.',
      code: 'TS8006',
      endless: false,
    });
    expect(refusalOf(analyze(lit(0), '<', n, addAssign('-', lit(1)), scope)).message).toBe(
      'for step "i -= 1" moves "i" away from a bound it compares with <, so the loop does not exit once it starts.',
    );
  });
});

describe('the body of a counted for', () => {
  const written = (target: Expr, scope: LoweringScope): string | undefined =>
    boundWrittenIn(compare('<', I, ref('n_1')), 'i', scope, [
      { s: 'assign', target, expr: lit(0) },
    ]);

  it('names the bound it writes as the author spelled it', () => {
    const scope = scopeOf({ n_1: { name: 'n' } });
    expect(written(ref('n_1'), scope)).toBe('n');
    expect(written(ref('other'), scope)).toBeUndefined();
  });

  it('sees a write to a host global the bound reads', () => {
    const scope = scopeOf({});
    const bound = { op: 'externref', type: i32T, name: 'g' } as Expr;
    const body: Stmt[] = [{ s: 'assign', target: bound, expr: lit(0) }];
    expect(boundWrittenIn(compare('<', I, bound), 'i', scope, body)).toBe('g');
  });
});

describe('the open while', () => {
  const whileOver = (cond: string): string => `"use typeshade"
const A: i32 = 1
const B: i32 = 2
export function f(): i32 {
  let n: i32 = 0
  while (${cond}) { n += 1 }
  return n
}
`;

  it('refuses a condition that is constantly true over integer arithmetic', () => {
    bothRefuse(
      whileOver('A + B > 0'),
      'TS8007',
      'while (A + B > 0) has no break or return in its body, so it never ends. Leave it with a break, or write the exit into the condition.',
    );
  });

  it('leaves a body that can exit alone, and refuses without it', () => {
    const cond = compare('>', bin('+', ref('A'), ref('B')), lit(0));
    const scope = scopeOf({ A: { constValue: 1 }, B: { constValue: 2 } });
    expect(openLoopError(cond, scope, true, 'while (x)')).toBeUndefined();
    expect(openLoopError(cond, scope, false, 'while (x)')?.code).toBe('TS8007');
  });
});

describe('a bound that reads an array length', () => {
  const kernel = `"use typeshade";
declare const xs: storage<array<f32>, "read_write">;
@compute([64]) export function main(gid: builtin<"global_invocation_id">): void {
  for (let i = 0; i < xs.length; i++) { xs[i] = f32(i); }
}
`;

  it('stays a counted loop when the body writes the elements', () => {
    const c = compile(kernel);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const loop = c.module.funcs.flatMap((fn) => fn.body).find((st) => st.s === 'for');
    expect(loop?.s === 'for' && loop.counted !== undefined).toBe(true);
  });
});
