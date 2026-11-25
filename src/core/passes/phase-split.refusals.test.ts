import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import type { Expr, ModuleDecl } from '../ir/index.js';
import { boolT, u32T } from '../ir/types.js';
import { autoVars } from './opt/index.js';
import { PhaseSplitError, splitPhases, type PhaseCut, type PhasePlan } from './phase-split.js';

const moduleOf = (src: string): ModuleDecl => {
  const r = compile(src);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return r.module;
};

const planOf = (src: string): PhasePlan => splitPhases(autoVars(moduleOf(src)), 'main');
const cutsOf = (plan: PhasePlan): PhaseCut[] => [...plan.cuts.values()];
const kindsOf = (plan: PhasePlan): string[] => cutsOf(plan).map((c) => c.kind);

const HEAD = `"use typeshade";
declare const out: storage<array<u32>, "read_write">;
declare const total: storage<atomic<u32>, "read_write">;
declare const other: storage<atomic<u32>, "read_write">;
let shared: workgroup<array<u32, 4>>;
`;
const ENTRY = `@compute([4, 1, 1]) export function main(li: builtin<"local_invocation_index">): void {`;
const entry = (body: string): string => `${HEAD}\n${ENTRY}\n${body}\n}\n`;

describe('the order of a write that holds two cuts (change 0054)', () => {
  it('takes the cut of the value before the cut of the place', () => {
    const m = moduleOf(entry('out[li] = atomicAdd(other, 1);'));
    const both = JSON.parse(JSON.stringify(m), (_k, v) =>
      v !== null && typeof v === 'object' && v.op === 'index' && v.base.name === 'out'
        ? {
            ...v,
            idx: {
              op: 'call',
              type: u32T,
              fn: 'atomicAdd',
              args: [
                { op: 'varref', type: v.base.type, name: 'total' },
                { op: 'lit', type: u32T, value: 1 },
              ],
            },
          }
        : v,
    ) as ModuleDecl;
    const plan = splitPhases(autoVars(both), 'main');
    const targets = cutsOf(plan).flatMap((c) =>
      c.kind === 'atomic' && c.request.op === 'call' && c.request.args[0]!.op === 'varref'
        ? [c.request.args[0]!.name]
        : [],
    );
    expect(targets).toEqual(['other', 'total']);
  });
});

describe('a cut inside a conditional expression (change 0054)', () => {
  const wrapped = (wrap: (call: Expr) => Expr): ModuleDecl => {
    const m = moduleOf(entry('out[li] = atomicAdd(total, 1);'));
    return JSON.parse(JSON.stringify(m), (_k, v) =>
      v !== null && typeof v === 'object' && v.op === 'call' && v.fn === 'atomicAdd' ? wrap(v) : v,
    ) as ModuleDecl;
  };
  const yes: Expr = { op: 'lit', type: boolT, value: true };
  const zero: Expr = { op: 'lit', type: u32T, value: 0 };
  const refusal = (m: ModuleDecl): string => {
    try {
      splitPhases(autoVars(m), 'main');
    } catch (e) {
      expect(e).toBeInstanceOf(PhaseSplitError);
      return (e as PhaseSplitError).message;
    }
    throw new Error('expected a PhaseSplitError');
  };

  it('refuses an atomic operation inside && and ||', () => {
    for (const lop of ['&&', '||'] as const) {
      const m = wrapped((call) => ({ op: 'logical', type: boolT, lop, a: yes, b: call }));
      expect(refusal(m)).toMatch(/inside a && or \|\|/);
    }
  });

  it('refuses an atomic operation in an arm of a select', () => {
    const m = wrapped((call) => ({
      op: 'select',
      type: u32T,
      cond: yes,
      ifTrue: call,
      ifFalse: zero,
    }));
    expect(refusal(m)).toMatch(/inside a conditional expression/);
  });

  it('refuses an atomic operation in an arm of a match', () => {
    const m = wrapped((call) => ({
      op: 'matchExpr',
      type: u32T,
      scrutinee: zero,
      cases: [[1, call]],
      default: zero,
    }));
    expect(refusal(m)).toMatch(/inside a conditional expression/);
  });

  it('takes the same atomic operation outside a conditional expression', () => {
    expect(kindsOf(planOf(entry('out[li] = atomicAdd(total, 1);')))).toEqual(['atomic']);
  });
});
