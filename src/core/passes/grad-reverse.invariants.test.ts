import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { compileModule } from '../oracle.js';
import { compileModuleJs } from '../cpu-codegen.js';
import { TypeShadeError } from '../diagnostics/error.js';
import { grad } from './grad.js';
import type { Expr, ModuleDecl, Stmt } from '../ir/nodes.js';

type Fn = (...args: unknown[]) => unknown;

function moduleOf(src: string): ModuleDecl {
  const r = compile(`"use typeshade"\n${src}`);
  expect(r.diagnostics).toEqual([]);
  return r.module;
}

function refusalOf(thunk: () => unknown): string {
  try {
    thunk();
  } catch (e) {
    expect(e).toBeInstanceOf(TypeShadeError);
    expect((e as TypeShadeError).code).toBe('SD0118');
    return (e as TypeShadeError).message;
  }
  throw new Error('expected SD0118');
}

function markCounted(m: ModuleDecl): ModuleDecl {
  const f = m.funcs.find((g) => g.name === 'f')!;
  const body = f.body.map((st): Stmt =>
    st.s === 'for' ? { ...st, counted: { name: 'i', op: 'add', step: 1 } } : st,
  );
  return { ...m, funcs: m.funcs.map((g) => (g === f ? { ...f, body } : g)) };
}

function matchesFiniteDifference(
  src: string,
  wrt: readonly string[],
  point: number[],
  checkpoints?: number,
  declaredCounted = false,
): void {
  const m = declaredCounted ? markCounted(moduleOf(src)) : moduleOf(src);
  const d = grad(m, 'f', wrt, {
    mode: 'reverse',
    ...(checkpoints !== undefined ? { checkpoints } : {}),
  });
  const names = m.funcs.find((f) => f.name === 'f')!.params.map((p) => p.name);
  for (const make of [compileModule, compileModuleJs]) {
    const cm = make(d.module);
    const f = cm.fns['f'] as Fn;
    const df = cm.fns[d.name] as Fn;
    const got = df(...point, 1) as Record<string, number>;
    for (const w of wrt) {
      const at = names.indexOf(w);
      const h = 1e-6;
      const shift = (s: number) => point.map((v, i) => (i === at ? v + s : v));
      const expected = ((f(...shift(h)) as number) - (f(...shift(-h)) as number)) / (2 * h);
      expect(Math.abs(got[d.adjoints![w]!]! - expected)).toBeLessThan(
        1e-5 * Math.max(1, Math.abs(expected)),
      );
    }
  }
}

describe('grad reverse: the activity analysis follows a loop to a fixed point', () => {
  it('a name a later statement makes active is active where an earlier one reads it', () => {
    matchesFiniteDifference(
      `export function f(x: f32, k: f32): f32 {
  let a: f32 = 0.;
  let b: f32 = 1.;
  for (let i: i32 = 0; i < 3; i++) {
    b = b * a + k;
    a = x * b;
  }
  return b;
}`,
      ['x'],
      [0.7, 0.4],
    );
  });
});

describe('grad reverse: a loop whose count the header does not give', () => {
  it('a counter the body writes is not read from the header', () => {
    matchesFiniteDifference(
      `export function f(x: f32, k: f32): f32 {
  let acc: f32 = 1.;
  for (let i: i32 = 0; i < 6; i++) {
    acc = acc * x + k;
    i += 1;
  }
  return acc;
}`,
      ['x', 'k'],
      [1.1, 0.3],
    );
  });

  it('a bound that reads a variable the loop writes is not read from the header', () => {
    matchesFiniteDifference(
      `export function f(x: f32, k: f32): f32 {
  let acc: f32 = 1.;
  let n: i32 = 3;
  for (let i: i32 = 0; i < n; i++) {
    acc = acc * x + k;
    if (i == 0) {
      n += 5;
    }
  }
  return acc;
}`,
      ['x', 'k'],
      [1.1, 0.3],
      2,
      true,
    );
  });
});

describe('grad reverse: the record of a branch inside a loop', () => {
  it('an iteration that takes no arm does not replay the arm of the one before', () => {
    matchesFiniteDifference(
      `export function f(x: f32, k: f32): f32 {
  let acc: f32 = x;
  for (let i: i32 = 0; i < 4; i++) {
    if (i == 1) {
      acc = acc * k;
    }
    acc = acc + x;
  }
  return acc;
}`,
      ['x', 'k'],
      [0.6, 1.7],
    );
  });
});

describe('grad reverse: a call a loop would repeat', () => {
  it('a function that writes a module variable is refused inside a loop', () => {
    const m = moduleOf(`let counter: f32 = 0.;
function bump(): void {
  counter += 1.;
}
export function f(x: f32, k: f32): f32 {
  let acc: f32 = 0.;
  for (let i: i32 = 0; i < 3; i++) {
    bump();
    acc += x * k;
  }
  return acc;
}`);
    expect(refusalOf(() => grad(m, 'f', ['k'], { mode: 'reverse' }))).toContain(
      'which writes a module variable or a binding',
    );
  });
});

describe('grad reverse: a call that writes by reference', () => {
  it('is refused inside an expression', () => {
    const sequenced = moduleOf(`export function f(x: f32, k: f32): f32 {
  let total: f32 = 0.;
  const add = (v: f32): f32 => {
    total += v * k;
    return total;
  };
  return add(x) + 1.;
}`);
    const f = sequenced.funcs.find((g) => g.name === 'f')!;
    const hoisted = f.body.find((st) => st.s === 'let' && st.name === '_seq0') as {
      expr: Expr;
    };
    const ret = f.body.find((st) => st.s === 'return') as { expr: Expr & { a: Expr } };
    ret.expr.a = hoisted.expr;
    const inline: ModuleDecl = {
      ...sequenced,
      funcs: sequenced.funcs.map((g) =>
        g === f ? { ...f, body: f.body.filter((st) => st !== (hoisted as unknown as Stmt)) } : g,
      ),
    };
    expect(refusalOf(() => grad(inline, 'f', ['k'], { mode: 'reverse' }))).toContain(
      'inside an expression',
    );
  });
});

describe('grad reverse: the tape holds one slot for each overwrite', () => {
  it('a first write takes none and each later write takes one', () => {
    const bytes = (body: string) =>
      grad(
        moduleOf(`export function f(x: f32, k: f32): f32 {
  let a: f32 = x;
${body}
  return a;
}`),
        'f',
        ['x', 'k'],
        { mode: 'reverse' },
      ).tapeBytes!;
    expect(bytes('')).toBe(0);
    expect(bytes('  a = a * k;')).toBe(4);
    expect(bytes('  a = a * k;\n  a = a + x;')).toBe(8);
    expect(bytes('  a = a * k;\n  a = a + x;\n  a = a * a;')).toBe(12);
  });
});
