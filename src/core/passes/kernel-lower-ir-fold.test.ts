import { describe, expect, it } from 'vitest';
import type { Stmt } from '../ir/nodes.js';
import { boolT } from '../ir/types.js';
import { iterationOf } from './kernel-lower-ir.js';
import { ctx, idx, lit, loopOver, param, ref, u32Array } from './kernel-lower-ir-fixtures.js';

describe('the fold of a deferred scatter write', () => {
  const foldLoop = (): Stmt & { s: 'for' } => {
    const body: Stmt[] = [
      { s: 'assignOp', target: idx(param('array', u32Array), ref('i')), bop: '+', expr: lit(1) },
    ];
    const c = ctx({
      loop: loopOver(body),
      arrays: ['array'],
      scatter: new Set(['array']),
      subgroupScatter: true,
    });
    return iterationOf(c, undefined, []).at(-1) as Stmt & { s: 'for' };
  };
  const flag = (name: string) => ref(name, boolT);

  it('serves the least pending key a turn and ends when no lane is pending', () => {
    const loop = foldLoop();
    const turn = loop.body[0] as Stmt & { s: 'if' };
    expect(turn.arms[0]!.cond).toMatchObject({
      op: 'call',
      fn: 'subgroupAny',
      args: [{ op: 'varref', name: '_sgp0' }],
    });
    expect(turn.elseBody).toEqual([{ s: 'break' }]);
  });

  it('takes the least key of the pending lanes, with the largest u32 for the others', () => {
    const turn = foldLoop().body[0] as Stmt & { s: 'if' };
    expect(turn.arms[0]!.body[0]).toMatchObject({
      s: 'let',
      name: '_sgkey0',
      expr: {
        op: 'call',
        fn: 'subgroupMin',
        args: [
          {
            op: 'select',
            cond: { op: 'varref', name: '_sgp0' },
            ifTrue: { op: 'varref', name: '_sgk0' },
            ifFalse: lit(0xffffffff),
          },
        ],
      },
    });
  });

  it('marks the pending lanes that hold the key and folds only their values', () => {
    const body = (foldLoop().body[0] as Stmt & { s: 'if' }).arms[0]!.body;
    expect(body[1]).toMatchObject({
      s: 'let',
      name: '_sgm0',
      expr: {
        op: 'logical',
        lop: '&&',
        a: { name: '_sgp0' },
        b: { op: 'compare', cop: '==', a: { name: '_sgk0' }, b: { name: '_sgkey0' } },
      },
    });
    expect(body[2]).toMatchObject({
      s: 'let',
      name: '_sgs0',
      expr: {
        fn: 'subgroupAdd',
        args: [
          {
            op: 'select',
            cond: { name: '_sgm0' },
            ifTrue: { name: '_sgv0' },
            ifFalse: lit(0),
          },
        ],
      },
    });
  });

  it('adds the fold to the element once, by the elected lane', () => {
    const body = (foldLoop().body[0] as Stmt & { s: 'if' }).arms[0]!.body;
    expect(body[3]).toMatchObject({
      s: 'if',
      arms: [
        {
          cond: { op: 'call', fn: 'subgroupElect', args: [] },
          body: [
            {
              s: 'call',
              expr: {
                fn: 'atomicAdd',
                args: [
                  { op: 'index', base: { name: 'array' }, idx: { name: '_sgkey0' } },
                  { name: '_sgs0' },
                ],
              },
            },
          ],
        },
      ],
    });
  });

  it('clears the pending flag of the lanes that were served and keeps the others', () => {
    const body = (foldLoop().body[0] as Stmt & { s: 'if' }).arms[0]!.body;
    expect(body[4]).toEqual({
      s: 'assign',
      target: flag('_sgp0'),
      expr: {
        op: 'select',
        type: boolT,
        cond: { op: 'varref', type: boolT, name: '_sgm0' },
        ifTrue: { op: 'lit', type: boolT, value: false },
        ifFalse: flag('_sgp0'),
      },
    });
  });
});
