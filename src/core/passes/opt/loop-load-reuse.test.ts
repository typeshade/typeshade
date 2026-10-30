import { describe, expect, it } from 'vitest';
import { compile } from '../../../compiler/ts/compile.js';
import { compileModule } from '../../oracle.js';
import { eachStmtExpr } from '../../ir/visit.js';
import type { ModuleDecl, Stmt } from '../../ir/index.js';
import { loopLoadReuse } from './loop-load-reuse.js';

function fixture(
  body = 'values[k] += input[r] * f32(k + r + 1);',
  outer = '6',
  inner = '3',
  prelude = '',
) {
  const r = compile(`"use typeshade";
    declare const input: storage<array<f32>, "read_write">;
    declare const other: storage<array<f32>, "read_write">;
    ${prelude}
    export function f(n: u32): array<f32, 6> {
      let values: array<f32, 6> = [0., 0., 0., 0., 0., 0.];
      for (let k: u32 = 0; k < ${outer}; k++) {
        for (let r: u32 = 0; r < ${inner}; r++) { ${body} }
      }
      return values;
    }`);
  expect(r.diagnostics).toEqual([]);
  return r.module;
}

function hoists(m: ModuleDecl): Stmt[] {
  const result: Stmt[] = [];
  const visit = (s: Stmt): void => {
    if (s.s === 'let' && s.name.startsWith('_load')) result.push(s);
    eachStmtExpr(s, () => {}, visit);
  };
  for (const f of m.funcs) for (const s of f.body) visit(s);
  return result;
}

describe('reuse a storage slice across a small loop nest', () => {
  it('reads three values once, keeping the per-output arithmetic order', () => {
    const m = fixture(),
      out = loopLoadReuse(m);
    expect(hoists(out)).toHaveLength(3);
    const before = compileModule(m),
      after = compileModule(out);
    for (const input of [
      [1, 2, 3],
      [1e10, 0.125, -1e10],
      [-0, -2.25, 7.75],
    ]) {
      before.setBinding('input', input);
      after.setBinding('input', input);
      expect(after.fns.f!(6)).toEqual(before.fns.f!(6));
    }
    expect(loopLoadReuse(out)).toEqual(out);
  });

  it('instruments the IR storage reads: eighteen before, three after', () => {
    const m = fixture();
    const counts: number[] = [];
    const values: unknown[] = [];
    for (const variant of [m, loopLoadReuse(m)]) {
      let loads = 0;
      const input = new Proxy([1, 2, 3], {
        get(target, key, receiver) {
          if (typeof key === 'string' && /^\d+$/.test(key)) loads++;
          return Reflect.get(target, key, receiver);
        },
      });
      const cpu = compileModule(variant);
      cpu.setBinding('input', input);
      values.push(cpu.fns.f!(6));
      counts.push(loads);
    }
    expect(counts).toEqual([18, 3]);
    expect(values[0]).toEqual(values[1]);
  });

  it.each([
    ['values[k] += input[r]; input[r] += 1.;', '6', '3'],
    ['values[k] += input[r]; other[r] += 1.;', '6', '3'],
    ['values[k] += input[r + k];', '6', '3'],
    ['if (k > 0) { values[k] += input[r]; }', '6', '3'],
    ['values[k] += k > 0 ? input[r] : 0.;', '6', '3'],
    ['values[k] += input[r]; workgroupBarrier();', '6', '3'],
    ['values[k] += input[r]; break;', '6', '3'],
    ['values[k] += input[r]; r++;', '6', '3'],
    ['values[k] += input[r]; k++;', '6', '3'],
    ['values[k] += input[r];', '0', '3'],
    ['values[k] += input[r];', '1', '3'],
    ['values[k] += input[r];', 'n', '3'],
    ['values[k] += input[r];', '6', '0'],
    ['values[k] += input[r];', '6', 'n'],
  ])(
    'rejects writes, guards, changing counters and unproved reuse: %s (%s, %s)',
    (body, outer, inner) => {
      expect(hoists(loopLoadReuse(fixture(body, outer, inner)))).toHaveLength(0);
    },
  );

  it('rejects hidden writes and synchronisation in callees', () => {
    for (const effect of ['other[0] = 1.;', 'workgroupBarrier();']) {
      const m = fixture(
        'values[k] += input[r] + effect();',
        '6',
        '3',
        `function effect(): f32 { ${effect} return 0.; }`,
      );
      expect(hoists(loopLoadReuse(m))).toHaveLength(0);
    }
  });

  it('keeps reads within the enclosing guard', () => {
    const m = fixture(),
      f = m.funcs[0]!;
    const guarded: ModuleDecl = {
      ...m,
      funcs: [
        {
          ...f,
          body: f.body.map((s) =>
            s.s !== 'for'
              ? s
              : {
                  s: 'if',
                  arms: [
                    {
                      cond: { op: 'lit', type: { kind: 'scalar', scalar: 'bool' }, value: false },
                      body: [s],
                    },
                  ],
                },
          ),
        },
      ],
    };
    const out = loopLoadReuse(guarded);
    expect(hoists(out)).toHaveLength(3);
    expect(out.funcs[0]!.body.some((s) => s.s === 'let' && s.name.startsWith('_load'))).toBe(false);
    expect(compileModule(out).fns.f!(6)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
