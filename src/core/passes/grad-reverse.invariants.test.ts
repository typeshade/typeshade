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

describe('grad reverse: a component of a matrix column', () => {
  it('is no path, and the column is accumulated whole', () => {
    matchesFiniteDifference(
      `export function f(x: f32, k: f32): f32 {
  const m = mat2(vec2(x, k), vec2(k * x, 1.));
  return m[1].x * m[0].y + m[0].x * m[1].y;
}`,
      ['x', 'k'],
      [0.7, 1.3],
    );
  });

  it('a dynamic column index lands in the column it names', () => {
    const src = `export function f(x: f32, k: f32, i: i32): f32 {
  const m = mat2(vec2(x, k), vec2(k * x, x * x));
  return dot(m[i], vec2(2., 3.)) + m[0].x * k;
}`;
    matchesFiniteDifference(src, ['x', 'k'], [0.7, 1.3, 0]);
    matchesFiniteDifference(src, ['x', 'k'], [0.7, 1.3, 1]);
  });
});

describe('grad reverse: the locals of a function', () => {
  it('a declaration without a value is zero again in each iteration', () => {
    const src = `export function f(x: f32, k: f32): f32 {
  let acc: f32 = 0.;
  for (let i: i32 = 0; i < 4; i++) {
    let t: f32 = 7.;
    if (i == 1) {
      t = x * k;
    }
    acc += t * t + x;
  }
  return acc;
}`;
    const withoutValue = (m: ModuleDecl): ModuleDecl => {
      const strip = (body: readonly Stmt[]): Stmt[] =>
        body.map((st): Stmt => {
          if (st.s === 'var' && st.name === 't') return { s: 'var', name: st.name, type: st.type };
          if (st.s === 'for') return { ...st, body: strip(st.body) };
          return st;
        });
      return { ...m, funcs: m.funcs.map((g) => ({ ...g, body: strip(g.body) })) };
    };
    const m = withoutValue(moduleOf(src));
    const d = grad(m, 'f', ['x', 'k'], { mode: 'reverse' });
    const cm = compileModule(d.module);
    const got = (cm.fns[d.name] as Fn)(0.7, 1.3, 1) as Record<string, number>;
    const f = compileModule(m).fns['f'] as Fn;
    const h = 1e-6;
    const dx = ((f(0.7 + h, 1.3) as number) - (f(0.7 - h, 1.3) as number)) / (2 * h);
    expect(f(0.7, 1.3)).toBeCloseTo(4 * 0.7 + (0.7 * 1.3) ** 2, 9);
    expect(got[d.adjoints!['x']!]!).toBeCloseTo(dx, 4);
  });

  it('a parameter the body writes is copied to a local first', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): f32 {
  x = x * k;
  x = x * x + k;
  return x;
}`);
    const f = m.funcs.find((g) => g.name === 'f')!;
    const rewritten = JSON.parse(JSON.stringify(f.body.slice(1)), (_k, v) =>
      v !== null && typeof v === 'object' && v.op === 'varref' && v.name === 'x_1'
        ? { ...v, op: 'param', name: 'x' }
        : v,
    ) as Stmt[];
    const writing: ModuleDecl = {
      ...m,
      funcs: m.funcs.map((g) => (g === f ? { ...f, body: rewritten } : g)),
    };
    const d = grad(writing, 'f', ['x', 'k'], { mode: 'reverse' });
    const fn = compileModule(m).fns['f'] as Fn;
    const df = compileModule(d.module).fns[d.name] as Fn;
    const got = df(0.7, 1.3, 1) as Record<string, number>;
    const h = 1e-6;
    const dx = ((fn(0.7 + h, 1.3) as number) - (fn(0.7 - h, 1.3) as number)) / (2 * h);
    const dk = ((fn(0.7, 1.3 + h) as number) - (fn(0.7, 1.3 - h) as number)) / (2 * h);
    expect(got[d.adjoints!['x']!]!).toBeCloseTo(dx, 4);
    expect(got[d.adjoints!['k']!]!).toBeCloseTo(dk, 4);
  });

  const duplicated = (renames: Record<string, string>) => {
    const m = moduleOf(`export function f(x: f32, k: f32): f32 {
  let acc: f32 = x;
  if (k > 0.) {
    const t: vec2 = vec2(x, k);
    acc = acc * dot(t, t);
  } else {
    const t: f32 = x + k;
    acc = acc * t;
  }
  if (k > 5.) {
    const x: f32 = k * 3.;
    acc = acc * x;
  }
  return acc;
}`);
    const same = JSON.parse(JSON.stringify(m), (_k, v) =>
      v !== null &&
      typeof v === 'object' &&
      (v.s === 'let' || v.op === 'varref') &&
      renames[v.name] !== undefined
        ? { ...v, name: renames[v.name] }
        : v,
    ) as ModuleDecl;
    const d = grad(same, 'f', ['x', 'k'], { mode: 'reverse' });
    const fn = compileModule(m).fns['f'] as Fn;
    const only: ModuleDecl = {
      ...d.module,
      funcs: d.module.funcs.filter((g) => g.name === d.name),
    };
    const df = compileModule(only).fns[d.name] as Fn;
    const declared = only.funcs[0]!.body.flatMap((st) => (st.s === 'var' ? [st] : []));
    expect(new Set(declared.map((v) => v.name)).size).toBe(declared.length);
    for (const k of [1.3, -0.5, 6]) {
      const got = df(0.7, k, 1) as Record<string, number>;
      const h = 1e-6;
      const dx = ((fn(0.7 + h, k) as number) - (fn(0.7 - h, k) as number)) / (2 * h);
      const dk = ((fn(0.7, k + h) as number) - (fn(0.7, k - h) as number)) / (2 * h);
      expect(got[d.adjoints!['x']!]!).toBeCloseTo(dx, 3);
      expect(got[d.adjoints!['k']!]!).toBeCloseTo(dk, 3);
    }
    return declared;
  };

  it('a second local of one name in another scope has its own variable', () => {
    const declared = duplicated({ t_1: 't' });
    expect(
      declared
        .filter((v) => /^t(_\d+)?$/.test(v.name))
        .map((v) => v.type.kind)
        .sort(),
    ).toEqual(['scalar', 'vec']);
  });

  it('a local named as a parameter does not take the parameter name', () => {
    duplicated({ x_1: 'x' });
  });
});

describe('grad reverse: the checkpoint count', () => {
  const strideOf = (c: number): ((trips: number) => number) => {
    const m = moduleOf(`export function f(x: f32, k: f32): f32 {
  let acc: f32 = 1.;
  for (let i: i32 = 0; i < 5; i++) {
    acc = acc * x + k;
  }
  return acc;
}`);
    const d = grad(m, 'f', ['x', 'k'], { mode: 'reverse', checkpoints: c });
    const body = d.module.funcs.find((g) => g.name === d.name)!.body;
    let found: Expr | undefined;
    JSON.stringify(body, (_k, v) => {
      if (v?.s === 'assign' && v.target.name === 'stride') found = v.expr;
      return v;
    });
    const type = found!.type;
    const expr = JSON.parse(JSON.stringify(found), (_k, v) =>
      v?.op === 'varref' && v.name === 'trips' ? { ...v, op: 'param' } : v,
    ) as Expr;
    const f = m.funcs.find((g) => g.name === 'f')!;
    const g = {
      ...f,
      name: 'g',
      params: [{ ...f.params[0]!, name: 'trips', type }],
      ret: type,
      body: [{ s: 'return', expr }] as Stmt[],
    };
    return compileModule({ ...m, funcs: [g] }).fns['g'] as (trips: number) => number;
  };

  it('is the trip count divided by the slots and rounded up, and at least one', () => {
    for (const c of [2, 3, 4]) {
      const stride = strideOf(c);
      for (let n = 0; n <= 13; n++) expect(stride(n)).toBe(Math.max(1, Math.ceil(n / c)));
    }
  });
});
