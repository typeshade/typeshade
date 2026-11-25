import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { dispatchCompute } from '../debug/dispatch.js';
import { dispatchPhased } from '../debug/phased.js';
import type { CpuValue } from '../cpu-runtime.js';
import type { ModuleDecl } from '../ir/index.js';
import { autoVars } from './opt/index.js';
import { PhaseSplitError, splitPhases, type PhaseCut, type PhasePlan } from './phase-split.js';

const moduleOf = (src: string): ModuleDecl => {
  const r = compile(src);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return r.module;
};

const planOf = (src: string, opts?: { logEntries?: number }): PhasePlan =>
  splitPhases(autoVars(moduleOf(src)), 'main', opts);

const cutsOf = (plan: PhasePlan): PhaseCut[] => [...plan.cuts.values()];
const kindsOf = (plan: PhasePlan): string[] => cutsOf(plan).map((c) => c.kind);
const bodyText = (plan: PhasePlan): string =>
  JSON.stringify(plan.module.funcs.find((f) => f.name === plan.entry)!.body);

const HEAD = `"use typeshade";
declare const out: storage<array<u32>, "read_write">;
declare const total: storage<atomic<u32>, "read_write">;
declare const other: storage<atomic<u32>, "read_write">;
let shared: workgroup<array<u32, 4>>;
`;
const ENTRY = `@compute([4, 1, 1]) export function main(li: builtin<"local_invocation_index">): void {`;

const entry = (body: string, helpers = ''): string => `${HEAD}${helpers}\n${ENTRY}\n${body}\n}\n`;

const phasedMatchesLockstep = (src: string, make: () => Record<string, CpuValue>): void => {
  const m = moduleOf(src);
  const lockstep = make();
  dispatchCompute(m, 'main', 1, lockstep, { order: 'lockstep' });
  const phased = make();
  dispatchPhased(m, 'main', 1, phased);
  expect(phased).toEqual(lockstep);
};

describe('the cuts of a phase plan (change 0054)', () => {
  it('cuts each side of workgroupUniformLoad with a barrier', () => {
    const plan = planOf(entry('out[li] = workgroupUniformLoad(shared[0]);'));
    expect(cutsOf(plan).map((c) => [c.kind, c.kind === 'barrier' ? c.fn : ''])).toEqual([
      ['barrier', 'workgroupUniformLoad'],
      ['barrier', 'workgroupUniformLoad'],
    ]);
  });

  it('cuts at storageBarrier as a barrier', () => {
    const plan = planOf(entry('out[li] = 1;\nstorageBarrier();\nout[li] = 2;'));
    expect(kindsOf(plan)).toEqual(['barrier']);
  });

  it('keeps the atomic result only when its value is used', () => {
    const plan = planOf(entry('atomicAdd(total, 1);\nout[li] = atomicAdd(total, 2);'));
    const atomics = cutsOf(plan).flatMap((c) => (c.kind === 'atomic' ? [c] : []));
    expect(atomics.map((c) => c.result === undefined)).toEqual([true, false]);
  });

  it('saves a computed atomic operand to state and keeps a literal as it is', () => {
    const plan = planOf(entry('atomicAdd(total, li + 1);\natomicAdd(total, 5);'));
    const requests = cutsOf(plan).flatMap((c) => (c.kind === 'atomic' ? [c.request] : []));
    const operand = (i: number): string => {
      const r = requests[i]!;
      return r.op === 'call' ? r.args[1]!.op : '';
    };
    expect(operand(0)).toBe('varref');
    expect(operand(1)).toBe('lit');
  });

  it('saves a computed index of an atomic location to state', () => {
    const plan = planOf(
      `"use typeshade";
declare const counts: storage<array<atomic<u32>>, "read_write">;
${ENTRY}
  atomicAdd(counts[li + 1], 1);
  atomicAdd(counts[2], 1);
}
`,
    );
    const locations = cutsOf(plan).flatMap((c) =>
      c.kind === 'atomic' && c.request.op === 'call' ? [c.request.args[0]!] : [],
    );
    const idxOp = (i: number): string => {
      const l = locations[i]!;
      return l.op === 'index' ? l.idx.op : '';
    };
    expect(idxOp(0)).toBe('varref');
    expect(idxOp(1)).toBe('lit');
  });

  it('evaluates a computed index of a split write once, into state', () => {
    const plan = planOf(entry('out[li + 1] = atomicAdd(total, 1);'));
    expect(bodyText(plan)).toMatch(
      /"target":\{"op":"index"[^]*?"name":"out"[^]*?"idx":\{"op":"varref"[^]*?"name":"_phx_t\d+"/,
    );
  });
});

describe('the write log of a phase plan (change 0054, decision 4)', () => {
  const writes = (n: number): string =>
    Array.from({ length: n }, (_, i) => `out[li + ${String(i)}] = ${String(i)};`).join('\n');

  it('cuts before the write that would make more than four entries', () => {
    expect(kindsOf(planOf(entry(writes(4))))).toEqual([]);
    expect(kindsOf(planOf(entry(writes(5))))).toEqual(['log']);
    expect(kindsOf(planOf(entry(writes(9))))).toEqual(['log', 'log']);
  });

  it('takes the size of the log from logEntries and returns it in the plan', () => {
    const plan = planOf(entry(writes(5)), { logEntries: 8 });
    expect(plan.logEntries).toBe(8);
    expect(kindsOf(plan)).toEqual([]);
    expect(planOf(entry(writes(3)), { logEntries: 2 }).logEntries).toBe(2);
    expect(kindsOf(planOf(entry(writes(3)), { logEntries: 2 }))).toEqual(['log']);
  });

  it('defaults the log to four entries', () => {
    expect(planOf(entry(writes(1))).logEntries).toBe(4);
  });

  it('counts the writes of the longest path to a statement', () => {
    const body = `if (li > 1) {
  ${writes(3)}
} else {
  out[0] = 1;
}
out[li + 9] = 1;
out[li + 8] = 1;`;
    expect(kindsOf(planOf(entry(body)))).toEqual(['log']);
  });

  it('restarts the count after a barrier', () => {
    const body = `${writes(4)}\nworkgroupBarrier();\n${writes(4)}`;
    expect(kindsOf(planOf(entry(body)))).toEqual(['barrier']);
  });

  it('restarts the count after an atomic operation', () => {
    const body = `${writes(4)}\natomicAdd(total, 1);\n${writes(4)}`;
    expect(kindsOf(planOf(entry(body)))).toEqual(['atomic']);
  });

  it('refuses one statement that writes more entries than the log holds', () => {
    const src = `"use typeshade";
declare const rows: storage<array<array<u32, 5>>, "read_write">;
function fill(a: array<u32, 5>): void {
  a[0] = 1;
}
${ENTRY}
  fill(rows[li]);
}
`;
    expect(() => planOf(src, { logEntries: 4 })).toThrow(PhaseSplitError);
    expect(() => planOf(src, { logEntries: 4 })).toThrow(
      "one statement writes 5 log entries, more than the log's 4",
    );
    expect(() => planOf(src, { logEntries: 5 })).not.toThrow();
  });

  it('counts a write of an array as one entry for each element', () => {
    const src = `"use typeshade";
declare const rows: storage<array<array<u32, 5>>, "read_write">;
declare const out: storage<array<u32>, "read_write">;
${ENTRY}
  const r: array<u32, 5> = [1, 2, 3, 4, 5];
  rows[li] = r;
  out[li] = 1;
}
`;
    expect(kindsOf(planOf(src, { logEntries: 8 }))).toEqual([]);
    expect(kindsOf(planOf(src, { logEntries: 5 }))).toEqual(['log']);
  });

  it('writes a struct field by field', () => {
    const src = `"use typeshade";
class P { a: u32; b: u32; c: u32; }
declare const ps: storage<array<P>, "read_write">;
${ENTRY}
  ps[li] = { a: 1, b: 2, c: 3 };
  ps[li + 1].a = 4;
}
`;
    expect(kindsOf(planOf(src, { logEntries: 4 }))).toEqual([]);
    expect(kindsOf(planOf(src, { logEntries: 3 }))).toEqual(['log']);
  });
});

describe('the phase function of a plan (change 0054)', () => {
  const src = entry('const a: u32 = li * 2;\nworkgroupBarrier();\nout[li] = a;');

  it('keeps the name, the parameters and the stage of the entry', () => {
    const before = autoVars(moduleOf(src));
    const plan = splitPhases(before, 'main');
    const was = before.funcs.find((f) => f.name === 'main')!;
    const now = plan.module.funcs.find((f) => f.name === 'main')!;
    expect(now.params).toEqual(was.params);
    expect(now.attrs).toEqual(was.attrs);
    expect(plan.entry).toBe('main');
  });

  it('holds the resume point first in the state, as a private u32 that starts at 0', () => {
    const plan = planOf(src);
    expect(plan.state[0]).toMatchObject({
      name: plan.pc,
      space: 'private',
      type: { kind: 'scalar', scalar: 'u32' },
      init: { op: 'lit', value: 0 },
    });
    expect(plan.module.vars!.map((v) => v.name)).toEqual(
      expect.arrayContaining(plan.state.map((v) => v.name)),
    );
    expect(plan.done).toBeGreaterThan(Math.max(...plan.cuts.keys()));
  });

  it('turns every local of the entry into a private state variable', () => {
    const plan = planOf(src);
    expect(plan.state.some((v) => /^_phv\d+_a$/.test(v.name))).toBe(true);
    expect(bodyText(plan)).not.toContain('"name":"a"');
  });

  it('names a hoisted local without leading, trailing or doubled underscores', () => {
    const plan = planOf(
      entry('const __a__b_: u32 = li;\nconst _: u32 = 2;\nout[li] = __a__b_ + _;'),
    );
    const names = plan.state.map((v) => v.name).filter((n) => n.startsWith('_phv'));
    expect(names).toEqual(['_phv0_a_b', '_phv1_v']);
    for (const n of plan.state.map((v) => v.name)) expect(n).not.toContain('__');
  });

  it('gives two locals of the same name two names', () => {
    const plan = planOf(
      entry(
        'if (li > 1) {\n  const t: u32 = 1;\n  atomicAdd(total, t);\n  out[li] = t;\n} else {\n  const t: u32 = 2;\n  atomicAdd(total, t);\n  out[li] = t;\n}',
      ),
    );
    const names = plan.state.map((v) => v.name).filter((n) => /^_phv\d+_t/.test(n));
    expect(names).toEqual(['_phv0_t', '_phv1_t_1']);
  });

  it('refuses a missing entry and a function that is not a compute entry', () => {
    const m = autoVars(moduleOf(entry('out[li] = 1;', 'function helper(): u32 {\n  return 1;\n}')));
    expect(() => splitPhases(m, 'nope')).toThrow(PhaseSplitError);
    expect(() => splitPhases(m, 'helper')).toThrow(/is not a @compute entry/);
  });
});

describe('the functions a phase plan inlines (change 0054)', () => {
  const callsOf = (plan: PhasePlan, fn: string): boolean => bodyText(plan).includes(`"fn":"${fn}"`);

  it('inlines a helper that writes memory and keeps a pure helper as a call', () => {
    const helpers = `function store(i: u32): void {
  out[i] = 7;
}
function double(x: u32): u32 {
  return x * 2;
}`;
    const plan = planOf(entry('store(li);\nout[li + 4] = double(li);', helpers));
    expect(callsOf(plan, 'store')).toBe(false);
    expect(callsOf(plan, 'double')).toBe(true);
  });

  it('inlines a helper that reaches a cut only through another helper', () => {
    const helpers = `function inner(): void {
  workgroupBarrier();
}
function outer(): void {
  inner();
}`;
    const plan = planOf(entry('outer();\nout[li] = 1;', helpers));
    expect(callsOf(plan, 'outer')).toBe(false);
    expect(callsOf(plan, 'inner')).toBe(false);
    expect(kindsOf(plan)).toEqual(['barrier']);
  });

  it('writes a place passed to an inlined helper back after the call, by its pinned index', () => {
    const helpers = `function bump(a: array<u32, 4>): void {
  a[0] = a[0] + 1;
  workgroupBarrier();
  a[1] = a[1] + 1;
}`;
    const src = `"use typeshade";
declare const tabs: storage<array<array<u32, 4>>, "read_write">;
${ENTRY}
  bump(tabs[li + 1]);
}
`;
    const plan = planOf(src.replace(ENTRY, `${helpers}\n${ENTRY}`));
    expect(bodyText(plan)).toMatch(
      /"target":\{"op":"index"[^]*?"name":"tabs"[^]*?"idx":\{"op":"varref"[^]*?"name":"_phx_t\d+"/,
    );
  });

  it('keeps a loop whole when only a continue in its switch leaves the switch', () => {
    const loop = (arm: string): string => `let acc: u32 = 0;
for (let k: u32 = 0; k < 6; k++) {
  switch (k) {
    case 1: {
      ${arm}
      break;
    }
    default: {
      acc += k;
    }
  }
}
out[li] = acc;`;
    const withContinue = planOf(entry(loop('continue;')));
    const withoutContinue = planOf(entry(loop('acc += 1;')));
    expect(withContinue.done).toBe(withoutContinue.done);
    expect(withContinue.cuts.size).toBe(0);
  });

  it('keeps a continue inside a switch in a loop for the loop', () => {
    const body = `let acc: u32 = 0;
for (let k: u32 = 0; k < 6; k++) {
  switch (k) {
    case 1: {
      continue;
    }
    case 4: {
      break;
    }
    default: {
      acc += k;
    }
  }
  atomicAdd(total, 1);
  acc += 100;
}
out[li] = acc;`;
    phasedMatchesLockstep(entry(body), () => ({ total: 0, out: new Array(4).fill(0) }));
  });
});
