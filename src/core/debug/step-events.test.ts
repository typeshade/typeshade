import { describe, expect, it } from 'vitest';
import type { CpuValue } from '../cpu-runtime.js';
import { f32T, matT, u32T, vec2fT, type FuncDecl, type Stmt } from '../ir/index.js';
import { autoVars } from '../passes/opt/index.js';
import { add, call, field, lit, moduleOfFuncs, ref } from '../testing/ir-shorthand.js';
import { moduleOf } from '../testing/stepped-run.js';
import { makeCtx, runFunction } from './interp.js';
import { startDebugSession } from './session.js';

const KERNEL = `"use typeshade";
declare const total: storage<atomic<u32>, "read_write">;
declare const out: storage<array<f32>, "read_write">;
let tile: workgroup<array<f32, 4>>;
@compute([1, 1, 1]) export function c(gid: builtin<"global_invocation_id">): void {
  atomicAdd(total, 1);
  out[0] = tile[2] + 1.;
}
`;

describe('a lockstep walk of a compute entry', () => {
  it('yields an atomic operation as a before event and an after event between its statements', () => {
    const m = autoVars(moduleOf(KERNEL));
    const ctx = { ...makeCtx(m, false), lockstep: true };
    ctx.bindings.total = 0;
    ctx.bindings.out = [7];
    const walk = runFunction(
      m.funcs.find((f) => f.name === 'c')!,
      [[0, 0, 0]],
      undefined,
      ctx,
    );
    const seen: string[] = [];
    for (let r = walk.next(); !r.done; r = walk.next()) {
      seen.push(r.value.atomic ?? r.value.stmt.s);
    }
    expect(seen).toEqual(['call', 'before', 'after', 'assign']);
  });
});

describe('a session over a compute entry', () => {
  it('reads workgroup memory as zero', () => {
    const bindings: Record<string, CpuValue> = { total: 0, out: [7] };
    startDebugSession(moduleOf(KERNEL), 'c', [[0, 0, 0]], { bindings }).continue();
    expect(bindings.out).toEqual([1]);
  });
});

describe('a stepped call with an inout argument that names a place', () => {
  const void_ = { kind: 'void' } as const;
  const arrayT = { kind: 'array', elem: f32T, size: 2 } as const;
  const matrixT = matT(2, 2);
  const index = (
    base: string,
    type: typeof arrayT | typeof matrixT,
    idx: ReturnType<typeof call>,
  ) => ({
    op: 'index' as const,
    type: type.kind === 'array' ? f32T : vec2fT,
    base: ref(base, type),
    idx,
  });
  const helpers: FuncDecl[] = [
    {
      name: 'which',
      params: [],
      ret: u32T,
      body: [{ s: 'return', expr: lit(1, u32T) }],
    },
    {
      name: 'inc',
      params: [{ name: 'a', type: f32T, mode: 'inout' }],
      ret: void_,
      body: [{ s: 'assign', target: ref('a'), expr: add(ref('a'), lit(1)) }],
    },
    {
      name: 'incX',
      params: [{ name: 'v', type: vec2fT, mode: 'inout' }],
      ret: void_,
      body: [
        {
          s: 'assign',
          target: field(ref('v', vec2fT), 'x'),
          expr: add(field(ref('v', vec2fT), 'x'), lit(1)),
        },
      ],
    },
  ];
  const session = (body: Stmt[]) => {
    const s = startDebugSession(
      moduleOfFuncs([{ name: 'fs', params: [], ret: f32T, body }, ...helpers]),
      'fs',
      [],
    );
    const names: string[] = [];
    while (s.pause) {
      names.push(s.pause.frames[0]!.fnName);
      s.stepIn();
    }
    return { names, result: s.result };
  };

  it('resolves the place once, so an index expression of it runs once', () => {
    const { names, result } = session([
      {
        s: 'var',
        name: 'a',
        type: arrayT,
        init: { op: 'construct', type: arrayT, args: [lit(1), lit(5)] },
      },
      {
        s: 'call',
        expr: call('inc', [index('a', arrayT, call('which', [], u32T))], void_),
      },
      { s: 'return', expr: index('a', arrayT, lit(1, u32T)) },
    ]);
    expect(names.filter((n) => n === 'which')).toHaveLength(1);
    expect(result).toBe(6);
  });

  it('writes a column of a matrix back as a column', () => {
    const { result } = session([
      { s: 'var', name: 'm', type: matrixT },
      { s: 'call', expr: call('incX', [index('m', matrixT, lit(1, u32T))], void_) },
      { s: 'return', expr: ref('m', matrixT) },
    ]);
    expect(result).toEqual([0, 0, 1, 0]);
  });
});
