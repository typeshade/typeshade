import type {
  Expr,
  FuncDecl,
  ModuleDecl,
  ModuleVarDecl,
  Stmt,
  StructDecl,
} from '../../ir/nodes.js';
import type { ShaderType } from '../../ir/types.js';
import { u32T } from '../../ir/types.js';
import { eachExpr, eachStmtExpr, mapChildren } from '../../ir/visit.js';
import { KERNEL_TREE, treeIdentity } from '../../kernel-tree.js';
import { bin, invocationIndex, nwg, u, vec3u, x, y } from '../../kernel-workgroup.js';
export {
  subgroupFoldable,
  scattersAtMostOnce,
  notReducible,
  firstName,
  hasOwnContinue,
  readsOutsideAtomics,
  stillPlain,
  isTextureParam,
  readsArraysByLengthOnly,
  notUniform,
  notStorage,
} from './loop-eligibility.js';
import {
  argsOf,
  boolT,
  entryRewrite,
  iterationOf,
  kRef,
  liveRef,
  mapStmt,
  placeRoot,
  SUBGROUP_FOLD_OF,
  tripWord,
  writesThroughCall,
  type ForStmt,
  type KernelLoopPlan,
  type LoopCtx,
} from '../kernel-lower-ir.js';
import { computeEntry, kcRef, laneScaffold } from '../kernel-push/entry.js';
import { readsElements } from '../kernel-stores.js';
import type { KernelProof, LoopReduction } from '../parallel-loop.js';

export const TRIP_WORDS = 8;

export function deviceGap(
  v: Extract<KernelProof['loops'][number], { ok: true }>,
  j: number,
  loop: ForStmt,
  prelude: readonly Stmt[],
  m: ModuleDecl,
): string | undefined {
  const at = `loop ${j + 1}`;
  const over = 'over a trip count it reads from an array';
  const pushed = v.writes.find((w) => w.kind === 'append');
  if (pushed !== undefined)
    return `${at} pushes onto "${pushed.name}" ${over}, and the call sizes the counts of a push from a trip count the host knows`;
  if (v.reductions.length > 0)
    return `${at} reduces "${v.reductions[0]!.name}" ${over}, and the call sizes the partials of a reduction from a trip count the host knows`;
  for (const w of v.writes) {
    if (w.kind === 'texel')
      return `${at} stores into the texture "${w.name}" ${over}, and the call checks a texture's rows against a trip count the host knows`;
    if (writesThroughCall(loop, w.name, m))
      return `${at} writes "${w.name}" through a reference a call takes, ${over}, and the GPU runs only an assignment over such a count`;
    if (readsElements(prelude, new Set([w.name])))
      return `${at} writes "${w.name}", which the statements before it read, and each of its invocations runs those statements again`;
  }
  return undefined;
}

export function rangeEntryFor(
  c: LoopCtx,
  header: { start: Expr; bound: Expr; cop: KernelLoopPlan['cop']; type: ShaderType },
  out: string,
): FuncDecl {
  const at = c.trips!.at;
  const rewrite = entryRewrite(c);
  const t = header.type;
  const isU = t.kind === 'scalar' && t.scalar === 'u32';
  const ref = (name: string, type: ShaderType): Expr => ({ op: 'varref', type, name });
  const asU = (e: Expr): Expr => (isU ? e : { op: 'call', type: u32T, fn: 'u32', args: [e] });
  const sub = (a: Expr, b: Expr): Expr => ({ op: 'binop', type: u32T, bop: '-', a, b });
  const div = (a: Expr, b: Expr): Expr => ({ op: 'binop', type: u32T, bop: '/', a, b });
  const ceilDiv = (target: string, a: Expr, by: number): Stmt[] => [
    { s: 'assign', target: ref(target, u32T), expr: div(a, u(by)) },
    {
      s: 'if',
      arms: [
        {
          cond: {
            op: 'compare',
            type: boolT,
            cop: '!=',
            a: { op: 'binop', type: u32T, bop: '%', a, b: u(by) },
            b: u(0),
          },
          body: [
            {
              s: 'assign',
              target: ref(target, u32T),
              expr: bin('+', ref(target, u32T), u(1)),
            },
          ],
        },
      ],
    },
  ];
  const s = ref('_rs', t);
  const b = ref('_rb', t);
  const up = header.cop === '<' || header.cop === '<=';
  const inclusive = header.cop === '<=' || header.cop === '>=';
  const span0 = up ? sub(asU(b), asU(s)) : sub(asU(s), asU(b));
  const span = inclusive ? bin('+', span0, u(1)) : span0;
  const store = (k: number, e: Expr): Stmt => ({
    s: 'assign',
    target: {
      op: 'index',
      type: u32T,
      base: ref(out, { kind: 'array', elem: u32T }),
      idx: u(at + k),
    },
    expr: e,
  });
  const body: Stmt[] = [
    ...c.prelude.map((st) => mapStmt(st, rewrite)),
    { s: 'let', name: '_rs', expr: rewrite(header.start) },
    { s: 'let', name: '_rb', expr: rewrite(header.bound) },
    { s: 'var', name: '_rn', type: u32T, init: u(0) },
    {
      s: 'if',
      arms: [
        {
          cond: { op: 'compare', type: boolT, cop: header.cop, a: s, b },
          body: [
            { s: 'let', name: '_span', expr: span },
            ...ceilDiv('_rn', ref('_span', u32T), Math.abs(c.step)),
          ],
        },
      ],
    },
    { s: 'var', name: '_rg', type: u32T, init: u(0) },
    ...ceilDiv('_rg', ref('_rn', u32T), c.wg),
    {
      s: 'let',
      name: '_rx',
      expr: {
        op: 'call',
        type: u32T,
        fn: 'max',
        args: [u(1), { op: 'call', type: u32T, fn: 'min', args: [ref('_rg', u32T), u(65535)] }],
      },
    },
    {
      s: 'let',
      name: '_ry',
      expr: div(sub(bin('+', ref('_rg', u32T), ref('_rx', u32T)), u(1)), ref('_rx', u32T)),
    },
    store(0, asU(s)),
    store(1, ref('_rn', u32T)),
    store(2, ref('_rx', u32T)),
    store(3, ref('_ry', u32T)),
    store(4, u(1)),
  ];
  return computeEntry(`${c.f.name}_range${c.j}`, body, false, 1);
}

export function laneSkips(
  v: Extract<KernelProof['loops'][number], { ok: true }>,
  body: readonly Stmt[],
  arrays: ReadonlySet<string>,
): boolean {
  if (v.stores.some((st) => st.readBack)) return true;
  const stored = new Set(v.writes.filter((w) => w.kind === 'texel').map((w) => w.name));
  let found = false;
  const see = (e: Expr): void =>
    eachExpr(e, (x) => {
      if (x.op !== 'call') return;
      const first = x.args[0];
      if (x.fn === 'textureLoad' && first?.op === 'param' && stored.has(first.name)) found = true;
      x.declRef?.params.forEach((p, i) => {
        const a = x.args[i];
        if (p.mode !== 'inout' || a === undefined) return;
        const root = placeRoot(a);
        if (root.op === 'param' && arrays.has(root.name)) found = true;
      });
    });
  const visit = (st: Stmt): void => eachStmtExpr(st, see, visit);
  body.forEach(visit);
  return found;
}

export function entryFor(c: LoopCtx): { entry: FuncDecl; iteration: number } {
  const n = c.trips === undefined ? argsOf(c)('_n', u32T) : tripWord(c, 1);
  const scaffold = laneScaffold(c.wg, n);
  const body: Stmt[] = [
    ...scaffold,
    ...iterationOf(c, undefined, [], { k: kcRef, mask: liveRef, skip: c.skip }),
  ];
  return {
    entry: computeEntry(
      `${c.f.name}_loop${c.j}`,
      body,
      false,
      c.wg,
      c.subgroupScatter === true ? 'scatter' : undefined,
    ),
    iteration: scaffold.length,
  };
}

export function reductionEntries(
  c: LoopCtx,
  reductions: readonly LoopReduction[],
): {
  funcs: FuncDecl[];
  struct: StructDecl;
  workgroup: ModuleVarDecl[];
  vars: (LoopReduction & { binding: string })[];
  entry: string;
  reduceEntry: string;
  iterate: string;
} {
  const base = `${c.f.name}_loop${c.j}`;
  const field = argsOf(c);
  const struct: StructDecl = {
    name: `${base}_Sums`,
    fields: reductions.map((r) => ({ name: r.name, type: r.type })),
  };
  const structT: ShaderType = { kind: 'struct', name: struct.name };
  const vars = reductions.map((r) => ({ ...r, binding: `${base}_${r.name}` }));
  const shared = (r: LoopReduction): string => `${base}_tree_${r.name}`;
  const workgroup: ModuleVarDecl[] = reductions.map((r) => ({
    name: shared(r),
    space: 'workgroup',
    type: { kind: 'array', elem: r.type, size: KERNEL_TREE },
  }));
  const sums: Expr = {
    op: 'construct',
    type: structT,
    args: reductions.map((r) => ({ op: 'varref', type: r.type, name: r.name })),
  };
  const liveParam: Expr = { op: 'param', type: boolT, name: '_live' };
  const iterate = iterationOf(
    c,
    sums,
    reductions.map((r): Stmt => ({
      s: 'assign',
      target: { op: 'varref', type: r.type, name: r.name },
      expr: identityOf(r),
    })),
    { k: kRef, mask: liveParam, skip: false },
  );
  const asParam = (e: Expr): Expr =>
    e.op === 'varref' && e.name === '_k'
      ? { op: 'param', type: u32T, name: '_k' }
      : mapChildren(e, asParam);
  const helper: FuncDecl = {
    name: `${base}_iteration`,
    params: [
      { name: '_k', type: u32T },
      { name: '_live', type: boolT },
    ],
    ret: structT,
    body: iterate.map((st) => mapStmt(st, asParam)),
  };
  const lid: Expr = { op: 'param', type: u32T, name: '_lid' };
  const wid: Expr = { op: 'param', type: vec3u, name: '_wid' };
  const slot = (r: LoopReduction, at: Expr): Expr => ({
    op: 'index',
    type: r.type,
    base: {
      op: 'varref',
      type: { kind: 'array', elem: r.type, size: KERNEL_TREE },
      name: shared(r),
    },
    idx: at,
  });
  const part = (r: LoopReduction & { binding: string }, at: Expr): Expr => ({
    op: 'index',
    type: r.type,
    base: { op: 'varref', type: { kind: 'array', elem: r.type }, name: r.binding },
    idx: at,
  });
  const barrier: Stmt = {
    s: 'call',
    expr: { op: 'call', type: { kind: 'void' }, fn: 'workgroupBarrier', args: [] },
  };
  const inRange: Expr = { op: 'compare', type: boolT, cop: '<', a: kRef, b: field('_n', u32T) };
  const tree: Stmt[] = [barrier];
  for (let stride = KERNEL_TREE >> 1; stride > 0; stride >>= 1) {
    tree.push({
      s: 'if',
      arms: [
        {
          cond: { op: 'compare', type: boolT, cop: '<', a: lid, b: u(stride) },
          body: reductions.map((r): Stmt => ({
            s: 'assign',
            target: slot(r, lid),
            expr: combineOf(r, slot(r, lid), slot(r, bin('+', lid, u(stride)))),
          })),
        },
      ],
    });
    if (stride > 1) tree.push(barrier);
  }
  const group = bin('+', x(wid), bin('*', y(wid), x(nwg)));
  const store = (at: Expr): Stmt => ({
    s: 'if',
    arms: [
      {
        cond: { op: 'compare', type: boolT, cop: '==', a: lid, b: u(0) },
        body: vars.map((r): Stmt => ({ s: 'assign', target: part(r, at), expr: slot(r, u(0)) })),
      },
    ],
  });
  const sumsRef: Expr = { op: 'varref', type: structT, name: '_sums' };
  const n = field('_n', u32T);
  const runOf = (k: Expr): Expr => ({
    op: 'call',
    type: structT,
    fn: helper.name,
    args: [k, liveRef],
    declRef: helper,
  });
  const ranRef: Expr = { op: 'varref', type: structT, name: '_ran' };
  const iteration: Stmt[] = c.skip
    ? [
        {
          s: 'if',
          arms: [{ cond: liveRef, body: [{ s: 'assign', target: sumsRef, expr: runOf(kRef) }] }],
        },
      ]
    : [
        { s: 'let', name: '_ran', expr: runOf(kcRef) },
        {
          s: 'if',
          arms: [{ cond: liveRef, body: [{ s: 'assign', target: sumsRef, expr: ranRef }] }],
        },
      ];
  const subgroupFold = (value: (r: LoopReduction) => Expr): Stmt[] => {
    const sgi: Expr = { op: 'param', type: u32T, name: '_sgi' };
    const sgid: Expr = { op: 'param', type: u32T, name: '_sgid' };
    const nsg: Expr = { op: 'param', type: u32T, name: '_nsg' };
    const fold = (r: LoopReduction): Expr => ({
      op: 'varref',
      type: r.type,
      name: `_sg_${r.name}`,
    });
    const acc = (r: LoopReduction): Expr => ({
      op: 'varref',
      type: r.type,
      name: `_acc_${r.name}`,
    });
    const j: Expr = { op: 'varref', type: u32T, name: '_sgj' };
    return [
      ...reductions.map((r): Stmt => ({
        s: 'let',
        name: `_sg_${r.name}`,
        expr: { op: 'call', type: r.type, fn: SUBGROUP_FOLD_OF[r.op], args: [value(r)] },
      })),
      {
        s: 'if',
        arms: [
          {
            cond: { op: 'compare', type: boolT, cop: '==', a: sgi, b: u(0) },
            body: reductions.map((r): Stmt => ({
              s: 'assign',
              target: slot(r, sgid),
              expr: fold(r),
            })),
          },
        ],
      },
      barrier,
      {
        s: 'if',
        arms: [
          {
            cond: { op: 'compare', type: boolT, cop: '==', a: lid, b: u(0) },
            body: [
              ...reductions.map((r): Stmt => ({
                s: 'var',
                name: `_acc_${r.name}`,
                type: r.type,
                init: identityOf(r),
              })),
              {
                s: 'for',
                init: { s: 'var', name: '_sgj', type: u32T, init: u(0) },
                cond: { op: 'compare', type: boolT, cop: '<', a: j, b: nsg },
                update: { s: 'assign', target: j, expr: bin('+', j, u(1)) },
                body: reductions.map((r): Stmt => ({
                  s: 'assign',
                  target: acc(r),
                  expr: combineOf(r, acc(r), slot(r, j)),
                })),
              },
              ...reductions.map((r): Stmt => ({
                s: 'assign',
                target: slot(r, u(0)),
                expr: acc(r),
              })),
            ],
          },
        ],
      },
    ];
  };
  const subgroup = c.subgroup === true;
  const loopEntry = computeEntry(
    base,
    [
      ...laneScaffold(KERNEL_TREE, n),
      {
        s: 'var',
        name: '_sums',
        type: structT,
        init: { op: 'construct', type: structT, args: reductions.map(identityOf) },
      },
      ...iteration,
      ...(subgroup
        ? subgroupFold((r) => ({ op: 'member', type: r.type, base: sumsRef, field: r.name }))
        : [
            ...reductions.map((r): Stmt => ({
              s: 'assign',
              target: slot(r, lid),
              expr: { op: 'member', type: r.type, base: sumsRef, field: r.name },
            })),
            ...tree,
          ]),
      store(group),
    ],
    true,
    undefined,
    subgroup ? 'reduce' : undefined,
  );
  const reduceEntry = computeEntry(
    `${base}_fold`,
    [
      invocationIndex(KERNEL_TREE),
      ...vars.flatMap((r): Stmt[] => [
        { s: 'var', name: `_v_${r.name}`, type: r.type, init: identityOf(r) },
        {
          s: 'if',
          arms: [
            {
              cond: inRange,
              body: [
                {
                  s: 'assign',
                  target: { op: 'varref', type: r.type, name: `_v_${r.name}` },
                  expr: part(r, bin('+', field('_in', u32T), kRef)),
                },
              ],
            },
          ],
        },
        ...(subgroup
          ? []
          : [
              {
                s: 'assign',
                target: slot(r, lid),
                expr: { op: 'varref', type: r.type, name: `_v_${r.name}` },
              } as Stmt,
            ]),
      ]),
      ...(subgroup
        ? subgroupFold((r) => ({ op: 'varref', type: r.type, name: `_v_${r.name}` }))
        : tree),
      store(bin('+', field('_out', u32T), group)),
    ],
    true,
    undefined,
    subgroup ? 'reduce' : undefined,
  );
  return {
    funcs: [helper, loopEntry, reduceEntry],
    struct,
    workgroup,
    vars,
    entry: loopEntry.name,
    reduceEntry: reduceEntry.name,
    iterate: helper.name,
  };
}

function combineOf(r: LoopReduction, a: Expr, b: Expr): Expr {
  return r.op === 'min' || r.op === 'max'
    ? { op: 'call', type: r.type, fn: r.op, args: [a, b] }
    : { op: 'binop', type: r.type, bop: r.op, a, b };
}

export function combineInto(r: LoopReduction, t: Expr): Stmt {
  const target: Expr = { op: 'varref', type: r.type, name: r.name };
  return { s: 'assign', target, expr: combineOf(r, target, t) };
}

export function identityOf(r: LoopReduction): Expr {
  const t = r.type;
  if (t.kind === 'f64' || t.kind === 'vec64') {
    // Why: an infinity is no literal Tint takes, so the `min` and `max` of an emulated double start
    // from the largest finite f32, as an `f32` one does.
    const one = treeIdentity(r.op, 'f64') as number;
    const value = Number.isFinite(one) ? one : one > 0 ? F32_MAX_VALUE : -F32_MAX_VALUE;
    const e: Expr = { op: 'lit', type: { kind: 'f64' }, value };
    return t.kind === 'vec64'
      ? { op: 'construct', type: t, args: new Array<Expr>(t.n).fill(e) }
      : e;
  }
  const scalar = (t.kind === 'vec' ? t.elem : (t as { scalar: string }).scalar) as 'f32';
  const one = treeIdentity(r.op, scalar) as number;
  const st: ShaderType = { kind: 'scalar', scalar };
  let e: Expr;
  if (scalar === 'f32' && (Object.is(one, -0) || Math.abs(one) > 1e38)) {
    const bits = Object.is(one, -0) ? 0x80000000 : one > 0 ? 0x7f7fffff : 0xff7fffff;
    e = { op: 'call', type: st, fn: 'bitcastF32', args: [u(bits)] };
  } else e = { op: 'lit', type: st, value: one };
  return t.kind === 'vec' ? { op: 'construct', type: t, args: new Array<Expr>(t.n).fill(e) } : e;
}

const F32_MAX_VALUE = 3.4028234663852886e38;
