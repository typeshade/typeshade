import type { Expr, FuncDecl, ModuleVarDecl, Stmt } from '../../ir/nodes.js';
import type { ShaderType } from '../../ir/types.js';
import { u32T } from '../../ir/types.js';
import { mapChildren } from '../../ir/visit.js';
import { KERNEL_TREE } from '../../kernel-tree.js';
import { bin } from '../../kernel-workgroup.js';
import {
  argsOf,
  boolT,
  iterationOf,
  kRef,
  liveRef,
  mapBlock,
  mapStmt,
  placeRoot,
  type LoopCtx,
  type PushWord,
} from '../kernel-lower-ir.js';
import { computeEntry, kcRef, laneScaffold } from './entry.js';

const MOST_U32 = 4294967295;

export function pushEntries(
  c: LoopCtx,
  pushed: string,
  arrays: ReadonlySet<string>,
  word?: PushWord,
  saturating = false,
): {
  funcs: FuncDecl[];
  workgroup: ModuleVarDecl;
  binding: string;
  count: string;
  scan: string;
  store: string;
  iteration: number;
} {
  const base = `${c.f.name}_loop${c.j}`;
  const binding = `${base}_push`;
  const field = argsOf(c);
  const lit = (n: number): Expr => ({ op: 'lit', type: u32T, value: n });
  const minU = (a: Expr, b: Expr): Expr => ({ op: 'call', type: u32T, fn: 'min', args: [a, b] });
  const slots: ShaderType = { kind: 'array', elem: u32T };
  const slot = (at: Expr): Expr => ({
    op: 'index',
    type: u32T,
    base: { op: 'varref', type: slots, name: binding },
    idx: at,
  });
  const isPush = (st: Stmt): st is Stmt & { s: 'call'; expr: Expr & { op: 'call' } } =>
    st.s === 'call' &&
    st.expr.op === 'call' &&
    st.expr.fn === 'push' &&
    st.expr.declRef === undefined &&
    st.expr.args[0]?.op === 'param' &&
    st.expr.args[0].name === pushed;
  const plus1 = (name: string): Stmt => {
    const v: Expr = { op: 'varref', type: u32T, name };
    return { s: 'assign', target: v, expr: { op: 'binop', type: u32T, bop: '+', a: v, b: lit(1) } };
  };

  const plus = (a: Expr, b: Expr): Expr =>
    saturating
      ? bin('+', a, minU(b, { op: 'binop', type: u32T, bop: '-', a: lit(MOST_U32), b: a }))
      : { op: 'binop', type: u32T, bop: '+', a, b };
  const countUp = (name: string): Stmt => {
    const v: Expr = { op: 'varref', type: u32T, name };
    return { s: 'assign', target: v, expr: plus(v, lit(1)) };
  };
  const countBody = mapBlock(c.loop.body, (st) => {
    if (isPush(st)) return [countUp('_c')];
    if (st.s === 'assign' || st.s === 'assignOp') {
      const root = placeRoot(st.target);
      if (root.op === 'param' && arrays.has(root.name)) return [];
    }
    return undefined;
  });
  const cRef: Expr = { op: 'varref', type: u32T, name: '_c' };
  const counting = iterationOf({ ...c, loop: { ...c.loop, body: countBody } }, cRef, [
    { s: 'var', name: '_c', type: u32T, init: lit(0) },
  ]);
  const asParam = (e: Expr): Expr =>
    e.op === 'varref' && e.name === '_k'
      ? { op: 'param', type: u32T, name: '_k' }
      : mapChildren(e, asParam);
  const helper: FuncDecl = {
    name: `${base}_count`,
    params: [{ name: '_k', type: u32T }],
    ret: u32T,
    body: counting.map((st) => mapStmt(st, asParam)),
  };
  const n = field('_n', u32T);
  const countOf = (k: Expr): Expr => ({
    op: 'call',
    type: u32T,
    fn: helper.name,
    args: [k],
    declRef: helper,
  });
  const cntRef: Expr = { op: 'varref', type: u32T, name: '_cnt' };
  const counts: Stmt[] = c.skip
    ? [
        {
          s: 'if',
          arms: [
            { cond: liveRef, body: [{ s: 'assign', target: slot(kRef), expr: countOf(kRef) }] },
          ],
        },
      ]
    : [
        { s: 'let', name: '_cnt', expr: countOf(kcRef) },
        {
          s: 'if',
          arms: [{ cond: liveRef, body: [{ s: 'assign', target: slot(kRef), expr: cntRef }] }],
        },
      ];
  const countEntry = computeEntry(
    `${base}_counts`,
    [...laneScaffold(c.wg, n), ...counts],
    false,
    c.wg,
  );

  const wgName = `${base}_scan_runs`;
  const runs: ShaderType = { kind: 'array', elem: u32T, size: KERNEL_TREE };
  const run = (at: Expr): Expr => ({
    op: 'index',
    type: u32T,
    base: { op: 'varref', type: runs, name: wgName },
    idx: at,
  });
  const lid: Expr = { op: 'param', type: u32T, name: '_lid' };
  const ref = (name: string): Expr => ({ op: 'varref', type: u32T, name });
  const barrier: Stmt = {
    s: 'call',
    expr: { op: 'call', type: { kind: 'void' }, fn: 'workgroupBarrier', args: [] },
  };
  const length: Expr | undefined =
    word === undefined
      ? undefined
      : {
          op: 'index',
          type: u32T,
          base: { op: 'varref', type: slots, name: word.binding },
          idx: field(word.field, u32T),
        };
  const over = (counter: string, from: Expr, to: Expr, body: Stmt[]): Stmt => ({
    s: 'for',
    init: { s: 'var', name: counter, type: u32T, init: from },
    cond: { op: 'compare', type: boolT, cop: '<', a: ref(counter), b: to },
    update: plus1(counter),
    body,
  });
  const scanEntry = computeEntry(
    `${base}_scan`,
    [
      {
        s: 'let',
        name: '_run',
        expr: {
          op: 'binop',
          type: u32T,
          bop: '/',
          a: { op: 'binop', type: u32T, bop: '+', a: n, b: lit(KERNEL_TREE - 1) },
          b: lit(KERNEL_TREE),
        },
      },
      { s: 'let', name: '_lo', expr: minU(bin('*', lid, ref('_run')), n) },
      { s: 'let', name: '_hi', expr: minU(bin('+', ref('_lo'), ref('_run')), n) },
      { s: 'var', name: '_sum', type: u32T, init: lit(0) },
      over('_t', ref('_lo'), ref('_hi'), [
        {
          s: 'assign',
          target: ref('_sum'),
          expr: plus(ref('_sum'), slot(ref('_t'))),
        },
      ]),
      { s: 'assign', target: run(lid), expr: ref('_sum') },
      barrier,
      {
        s: 'if',
        arms: [
          {
            cond: { op: 'compare', type: boolT, cop: '==', a: lid, b: lit(0) },
            body: [
              { s: 'var', name: '_acc', type: u32T, init: length ?? lit(0) },
              over('_r', lit(0), lit(KERNEL_TREE), [
                { s: 'let', name: '_v', expr: run(ref('_r')) },
                { s: 'assign', target: run(ref('_r')), expr: ref('_acc') },
                {
                  s: 'assign',
                  target: ref('_acc'),
                  expr: plus(ref('_acc'), ref('_v')),
                },
              ]),
              ...(length !== undefined
                ? [{ s: 'assign', target: length, expr: ref('_acc') } as Stmt]
                : []),
            ],
          },
        ],
      },
      barrier,
      { s: 'var', name: '_at', type: u32T, init: run(lid) },
      over('_u', ref('_lo'), ref('_hi'), [
        { s: 'let', name: '_w', expr: slot(ref('_u')) },
        { s: 'assign', target: slot(ref('_u')), expr: ref('_at') },
        {
          s: 'assign',
          target: ref('_at'),
          expr: plus(ref('_at'), ref('_w')),
        },
      ]),
      {
        s: 'if',
        arms: [
          {
            cond: { op: 'compare', type: boolT, cop: '==', a: lid, b: lit(KERNEL_TREE - 1) },
            body: [{ s: 'assign', target: slot(n), expr: ref('_at') }],
          },
        ],
      },
    ],
    true,
  );

  const pRef = ref('_p');
  const storeBody = mapBlock(c.loop.body, (st) => {
    if (!isPush(st)) return undefined;
    const [arr, value] = st.expr.args as [Expr, Expr];
    return [
      {
        s: 'if',
        arms: [
          {
            cond: {
              op: 'compare',
              type: boolT,
              cop: '<',
              a: pRef,
              b: { op: 'call', type: u32T, fn: 'arrayLength', args: [arr] },
            },
            body: [
              {
                s: 'assign',
                target: { op: 'index', type: value.type, base: arr, idx: pRef },
                expr: value,
              },
            ],
          },
        ],
      },
      plus1('_p'),
    ];
  });
  const scaffold = laneScaffold(c.wg, n);
  const storing = iterationOf(
    { ...c, loop: { ...c.loop, body: storeBody } },
    undefined,
    [{ s: 'var', name: '_p', type: u32T, init: slot(kcRef) }],
    { k: kcRef, mask: liveRef, skip: c.skip },
  );
  const storeEntry = computeEntry(base, [...scaffold, ...storing], false, c.wg);
  return {
    funcs: [helper, countEntry, scanEntry, storeEntry],
    workgroup: { name: wgName, space: 'workgroup', type: runs },
    binding,
    count: countEntry.name,
    scan: scanEntry.name,
    store: storeEntry.name,
    iteration: scaffold.length,
  };
}
