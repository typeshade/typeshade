import type { Expr, ModuleDecl, Stmt } from '../ir/nodes.js';
import type { ShaderType } from '../ir/types.js';
import { u32T } from '../ir/types.js';
import { eachExpr, eachStmtExpr, mapChildren, mapStmtExpr } from '../ir/visit.js';
import { treeIdentity } from '../kernel-tree.js';
import { bin, u } from '../kernel-workgroup.js';
import { EFFECTFUL_INTRINSICS } from './effects.js';
import { combineOf as writeCombine, type LoopReduction } from './parallel-loop.js';
import type { ForStmt, KernelLoopPlan, LoopCtx } from './kernel-lower-ir/types.js';
export type {
  ForStmt,
  KernelLoopPlan,
  KernelPlan,
  PushWord,
  KernelCollection,
  KernelLookup,
  LowerOptions,
  LoopCtx,
} from './kernel-lower-ir/types.js';

export function entryRewrite(
  c: LoopCtx,
  field: (name: string, type: ShaderType) => Expr = argsOf(c),
): (e: Expr) => Expr {
  const scalarSet = new Set(c.scalars);
  const arraySet = new Set(c.arrays);
  const rewrite = (e: Expr): Expr => {
    if (e.op === 'param' && scalarSet.has(e.name)) return field(e.name, e.type);
    if (e.op === 'param' && arraySet.has(e.name))
      return { op: 'varref', type: e.type, name: c.bindingNames.get(e.name) ?? e.name };
    const pushed = e.op === 'call' && e.fn === 'pushCount' ? e.args[0] : undefined;
    const word = pushed?.op === 'param' ? c.words?.get(pushed.name) : undefined;
    if (word !== undefined)
      return {
        op: 'index',
        type: u32T,
        base: { op: 'varref', type: { kind: 'array', elem: u32T }, name: word.binding },
        idx: field(word.field, u32T),
      };
    return mapChildren(e, rewrite);
  };
  return rewrite;
}

export function declaredNames(m: ModuleDecl): Set<string> {
  const names = new Set<string>([
    ...m.consts.map((c) => c.name),
    ...m.bindings.map((b) => b.name),
    ...(m.overrides ?? []).map((o) => o.name),
    ...(m.vars ?? []).map((v) => v.name),
    ...m.structs.flatMap((s) => [s.name, ...s.fields.map((x) => x.name)]),
    ...m.funcs.map((x) => x.name),
  ]);
  const collect = (body: readonly Stmt[]): void => {
    for (const st of body) {
      if (st.s === 'let' || st.s === 'var') names.add(st.name);
      mapStmtExpr(
        st,
        (e) => e,
        (child) => {
          collect([child]);
          return child;
        },
      );
    }
  };
  for (const fn of m.funcs) {
    fn.params.forEach((p) => names.add(p.name));
    collect(fn.body);
  }
  return names;
}

export function spellArrayBindings(
  params: readonly string[],
  declared: ReadonlySet<string>,
  reserved: (name: string) => boolean,
): ReadonlyMap<string, string> {
  const used = new Set(declared);
  const out = new Map<string, string>();
  for (const name of params) {
    if (!reserved(name)) continue;
    for (let i = 0; ; i++) {
      const candidate = i === 0 ? `${name}_` : `${name}_${i}`;
      if (!reserved(candidate) && !used.has(candidate)) {
        used.add(candidate);
        out.set(name, candidate);
        break;
      }
    }
  }
  return out;
}

export const boolT: ShaderType = { kind: 'scalar', scalar: 'bool' };

export const kRef: Expr = { op: 'varref', type: u32T, name: '_k' };

export const liveRef: Expr = { op: 'varref', type: boolT, name: '_live' };

interface Lane {
  readonly k: Expr;
  readonly mask: Expr;
  readonly skip: boolean;
}

function maskWrites(sts: readonly Stmt[], mask: Expr, outer: ReadonlySet<string>): Stmt[] {
  const writes = (st: Stmt): boolean => {
    if (st.s === 'assign' || st.s === 'assignOp') {
      const root = placeRoot(st.target);
      return (root.op === 'varref' || root.op === 'param') && outer.has(root.name);
    }
    return st.s === 'call' && st.expr.op === 'call' && EFFECTFUL_INTRINSICS.has(st.expr.fn);
  };
  const visit = (st: Stmt): Stmt =>
    writes(st) ? { s: 'if', arms: [{ cond: mask, body: [st] }] } : mapStmtExpr(st, (e) => e, visit);
  return sts.map(visit);
}

export function tripWord(c: LoopCtx, k: number): Expr {
  return {
    op: 'index',
    type: u32T,
    base: { op: 'varref', type: { kind: 'array', elem: u32T }, name: c.trips!.binding },
    idx: u(c.trips!.at + k),
  };
}

function tripStart(c: LoopCtx): Expr {
  const w = tripWord(c, 0);
  const t = c.counterType;
  return t.kind === 'scalar' && t.scalar === 'u32'
    ? w
    : { op: 'call', type: t, fn: typeKey(t), args: [w] };
}

export function argsOf(c: LoopCtx): (name: string, type: ShaderType) => Expr {
  const args: Expr = {
    op: 'varref',
    type: { kind: 'struct', name: c.argsStruct },
    name: c.argsBinding,
  };
  return (name, type) => ({ op: 'member', type, base: args, field: name });
}

export function iterationOf(
  c: LoopCtx,
  ret: Expr | undefined,
  reset: readonly Stmt[],
  lane?: Lane,
): Stmt[] {
  const field = argsOf(c);
  const start = c.trips === undefined ? field('_start', c.counterType) : tripStart(c);
  const kAs: Expr = {
    op: 'call',
    type: c.counterType,
    fn: typeKey(c.counterType),
    args: [lane?.k ?? kRef],
  };
  const stepLit: Expr = { op: 'lit', type: c.counterType, value: Math.abs(c.step) };
  const i: Expr = {
    op: 'binop',
    type: c.counterType,
    bop: c.step < 0 ? '-' : '+',
    a: start,
    b: { op: 'binop', type: c.counterType, bop: '*', a: kAs, b: stepLit },
  };
  const rewrite = entryRewrite(c, field);
  const deferred: DeferredScatter[] = [];
  const body = ownContinuesReturn(c.loop.body, ret);
  let rest = [
    ...c.prelude,
    ...reset,
    ...(c.subgroupScatter === true
      ? deferScatters(body, c.scatter, deferred)
      : body.map((st) => toAtomics(st, c.scatter))),
  ].map((st) => mapStmt(st, rewrite));
  if (lane?.skip === true) rest = [{ s: 'if', arms: [{ cond: lane.mask, body: rest }] }];
  else if (lane !== undefined) {
    const outer = new Set(c.arrays.flatMap((n) => [n, c.bindingNames.get(n) ?? n]));
    rest = maskWrites(rest, lane.mask, outer);
  }
  return [
    { s: 'let', name: c.counter, expr: i },
    ...deferred.flatMap(scatterSlots),
    ...rest,
    ...deferred.flatMap((d) => scatterFold(d).map((st) => mapStmt(st, rewrite))),
    ...(ret !== undefined ? [{ s: 'return', expr: ret } as Stmt] : []),
  ];
}

export const SUBGROUP_FOLD_OF: Readonly<Record<LoopReduction['op'], string>> = {
  '+': 'subgroupAdd',
  '*': 'subgroupMul',
  '&': 'subgroupAnd',
  '|': 'subgroupOr',
  '^': 'subgroupXor',
  min: 'subgroupMin',
  max: 'subgroupMax',
};

interface DeferredScatter {
  readonly i: number;
  readonly op: LoopReduction['op'];
  readonly array: Expr;
  readonly elem: ShaderType;
}

const scatterRef = (d: DeferredScatter, what: 'w' | 'k' | 'v' | 'p'): Expr => ({
  op: 'varref',
  type: what === 'w' || what === 'p' ? boolT : what === 'k' ? u32T : d.elem,
  name: `_sg${what}${d.i}`,
});

function deferScatters(
  sts: readonly Stmt[],
  scatter: ReadonlySet<string>,
  deferred: DeferredScatter[],
): Stmt[] {
  return mapBlock(sts, (st): Stmt[] | undefined => {
    if (st.s !== 'assign' && st.s !== 'assignOp') return undefined;
    const t = st.target;
    if (t.op !== 'index' || t.base.op !== 'param' || !scatter.has(t.base.name)) return undefined;
    const combine = writeCombine(st).combine;
    if (combine === undefined) return undefined;
    const at = atomicArray(t.base.type);
    const d: DeferredScatter = {
      i: deferred.length,
      op: combine.op,
      array: { ...t.base, type: at },
      elem: { kind: 'scalar', scalar: (at as { elem: { elem: 'u32' | 'i32' } }).elem.elem },
    };
    deferred.push(d);
    const key: Expr =
      t.idx.type.kind === 'scalar' && t.idx.type.scalar === 'u32'
        ? t.idx
        : { op: 'call', type: u32T, fn: 'u32', args: [t.idx] };
    return [
      { s: 'assign', target: scatterRef(d, 'w'), expr: liveRef },
      { s: 'assign', target: scatterRef(d, 'k'), expr: key },
      { s: 'assign', target: scatterRef(d, 'v'), expr: combine.with },
    ];
  });
}

function scatterIdentity(d: DeferredScatter): Expr {
  const scalar = (d.elem as { scalar: 'u32' | 'i32' }).scalar;
  return { op: 'lit', type: d.elem, value: treeIdentity(d.op, scalar) as number };
}

function scatterSlots(d: DeferredScatter): Stmt[] {
  return [
    { s: 'var', name: `_sgw${d.i}`, type: boolT, init: { op: 'lit', type: boolT, value: false } },
    { s: 'var', name: `_sgk${d.i}`, type: u32T, init: u(0) },
    { s: 'var', name: `_sgv${d.i}`, type: d.elem, init: scatterIdentity(d) },
  ];
}

function scatterFold(d: DeferredScatter): Stmt[] {
  const w = scatterRef(d, 'w');
  const k = scatterRef(d, 'k');
  const v = scatterRef(d, 'v');
  const p = scatterRef(d, 'p');
  const j: Expr = { op: 'varref', type: u32T, name: `_sgj${d.i}` };
  const key: Expr = { op: 'varref', type: u32T, name: `_sgkey${d.i}` };
  const mine: Expr = { op: 'varref', type: boolT, name: `_sgm${d.i}` };
  const sum: Expr = { op: 'varref', type: d.elem, name: `_sgs${d.i}` };
  const atomicT = (d.array.type as { elem: ShaderType }).elem;
  const none = u(0xffffffff);
  return [
    { s: 'var', name: `_sgp${d.i}`, type: boolT, init: w },
    {
      s: 'for',
      init: { s: 'var', name: `_sgj${d.i}`, type: u32T, init: u(0) },
      cond: { op: 'compare', type: boolT, cop: '<', a: j, b: u(SUBGROUP_MAX) },
      update: { s: 'assign', target: j, expr: bin('+', j, u(1)) },
      body: [
        {
          s: 'if',
          arms: [
            {
              cond: { op: 'call', type: boolT, fn: 'subgroupAny', args: [p] },
              body: [
                {
                  s: 'let',
                  name: `_sgkey${d.i}`,
                  expr: {
                    op: 'call',
                    type: u32T,
                    fn: 'subgroupMin',
                    args: [{ op: 'select', type: u32T, cond: p, ifTrue: k, ifFalse: none }],
                  },
                },
                {
                  s: 'let',
                  name: `_sgm${d.i}`,
                  expr: {
                    op: 'logical',
                    type: boolT,
                    lop: '&&',
                    a: p,
                    b: { op: 'compare', type: boolT, cop: '==', a: k, b: key },
                  },
                },
                {
                  s: 'let',
                  name: `_sgs${d.i}`,
                  expr: {
                    op: 'call',
                    type: d.elem,
                    fn: SUBGROUP_FOLD_OF[d.op],
                    args: [
                      {
                        op: 'select',
                        type: d.elem,
                        cond: mine,
                        ifTrue: v,
                        ifFalse: scatterIdentity(d),
                      },
                    ],
                  },
                },
                {
                  s: 'if',
                  arms: [
                    {
                      cond: { op: 'call', type: boolT, fn: 'subgroupElect', args: [] },
                      body: [
                        {
                          s: 'call',
                          expr: {
                            op: 'call',
                            type: d.elem,
                            fn: ATOMIC_OF[d.op]!,
                            args: [{ op: 'index', type: atomicT, base: d.array, idx: key }, sum],
                          },
                        },
                      ],
                    },
                  ],
                },
                {
                  s: 'assign',
                  target: p,
                  expr: {
                    op: 'select',
                    type: boolT,
                    cond: mine,
                    ifTrue: { op: 'lit', type: boolT, value: false },
                    ifFalse: p,
                  },
                },
              ],
            },
          ],
          elseBody: [{ s: 'break' }],
        },
      ],
    },
  ];
}

/* Why: WGSL fixes the subgroup size at most 128 lanes, and the fold serves at least one key a
 * turn, so its loop ends within this many turns. */
const SUBGROUP_MAX = 128;

function ownContinuesReturn(body: readonly Stmt[], ret?: Expr): Stmt[] {
  const visit = (st: Stmt): Stmt => {
    switch (st.s) {
      case 'continue':
        return {
          s: 'return',
          ...(ret !== undefined ? { expr: ret } : {}),
          ...(st.span !== undefined ? { span: st.span } : {}),
        };
      case 'if':
        return {
          ...st,
          arms: st.arms.map((a) => ({ ...a, body: a.body.map(visit) })),
          ...(st.elseBody !== undefined ? { elseBody: st.elseBody.map(visit) } : {}),
        };
      case 'switch':
        return {
          ...st,
          cases: st.cases.map((c) => ({ ...c, body: c.body.map(visit) })),
          ...(st.defaultBody !== undefined ? { defaultBody: st.defaultBody.map(visit) } : {}),
        };
      default:
        return st;
    }
  };
  return body.map(visit);
}

export function mapStmt(st: Stmt, f: (e: Expr) => Expr): Stmt {
  const S = (x: Stmt): Stmt => mapStmt(x, f);
  switch (st.s) {
    case 'let':
      return { ...st, expr: f(st.expr) };
    case 'var':
      return st.init !== undefined ? { ...st, init: f(st.init) } : st;
    case 'assign':
    case 'assignOp':
      return { ...st, target: f(st.target), expr: f(st.expr) };
    case 'call':
      return { ...st, expr: f(st.expr) };
    case 'return':
      return st.expr !== undefined ? { ...st, expr: f(st.expr) } : st;
    case 'if':
      return {
        ...st,
        arms: st.arms.map((a) => ({ cond: f(a.cond), body: a.body.map(S) })),
        ...(st.elseBody !== undefined ? { elseBody: st.elseBody.map(S) } : {}),
      };
    case 'for':
      return {
        ...st,
        init: S(st.init),
        cond: f(st.cond),
        update: S(st.update),
        body: st.body.map(S),
      };
    case 'switch':
      return {
        ...st,
        scrut: f(st.scrut),
        cases: st.cases.map((c) => ({ ...c, body: c.body.map(S) })),
        ...(st.defaultBody !== undefined ? { defaultBody: st.defaultBody.map(S) } : {}),
      };
    default:
      return st;
  }
}

export const ATOMIC_OF: Readonly<Record<string, string>> = {
  '+': 'atomicAdd',
  '&': 'atomicAnd',
  '|': 'atomicOr',
  '^': 'atomicXor',
  min: 'atomicMin',
  max: 'atomicMax',
};

export function atomicArray(t: ShaderType): ShaderType {
  const elem = (t as { elem: ShaderType }).elem as { scalar: 'u32' | 'i32' };
  return { kind: 'array', elem: { kind: 'atomic', elem: elem.scalar } };
}

function toAtomics(st: Stmt, scatter: ReadonlySet<string>): Stmt {
  if (scatter.size === 0) return st;
  const inner = mapStmtExpr(
    st,
    (e) => e,
    (b) => toAtomics(b, scatter),
  );
  if (inner.s !== 'assign' && inner.s !== 'assignOp') return inner;
  const t = inner.target;
  if (t.op !== 'index' || t.base.op !== 'param' || !scatter.has(t.base.name)) return inner;
  const combine = writeCombine(inner).combine;
  if (combine === undefined) return inner;
  const at = atomicArray(t.base.type);
  const atomicT = (at as { elem: ShaderType }).elem;
  const place: Expr = { ...t, type: atomicT, base: { ...t.base, type: at } };
  return {
    s: 'call',
    expr: {
      op: 'call',
      type: t.type,
      fn: ATOMIC_OF[combine.op]!,
      args: [place, combine.with],
    },
    ...(inner.span !== undefined ? { span: inner.span } : {}),
  };
}

export function rangeOf(
  loop: ForStmt,
): { start: Expr; bound: Expr; cop: KernelLoopPlan['cop']; type: ShaderType } | undefined {
  const c = loop.counted;
  if (c === undefined || loop.init.s !== 'var' || loop.init.init === undefined) return undefined;
  const cond = loop.cond;
  if (cond.op !== 'compare') return undefined;
  const flip = { '<': '>', '<=': '>=', '>': '<', '>=': '<=' } as const;
  const isCounter = (e: Expr): boolean =>
    (e.op === 'varref' || e.op === 'param') && e.name === c.name;
  let cop: KernelLoopPlan['cop'];
  let bound: Expr;
  if (isCounter(cond.a) && cond.cop in flip) {
    cop = cond.cop as KernelLoopPlan['cop'];
    bound = cond.b;
  } else if (isCounter(cond.b) && cond.cop in flip) {
    cop = flip[cond.cop as keyof typeof flip];
    bound = cond.a;
  } else return undefined;
  if ((cop === '<' || cop === '<=') !== c.step > 0) return undefined;
  return { start: loop.init.init, bound, cop, type: loop.init.type };
}

export const typeKey = (t: ShaderType): string => (t.kind === 'scalar' ? t.scalar : t.kind);

export function mapBlock(sts: readonly Stmt[], f: (st: Stmt) => Stmt[] | undefined): Stmt[] {
  const block = (b: readonly Stmt[]): Stmt[] => mapBlock(b, f);
  return sts.flatMap((st): Stmt[] => {
    const own = f(st);
    if (own !== undefined) return own;
    switch (st.s) {
      case 'if':
        return [
          {
            ...st,
            arms: st.arms.map((a) => ({ ...a, body: block(a.body) })),
            ...(st.elseBody !== undefined ? { elseBody: block(st.elseBody) } : {}),
          },
        ];
      case 'for':
        return [{ ...st, body: block(st.body) }];
      case 'switch':
        return [
          {
            ...st,
            cases: st.cases.map((c) => ({ ...c, body: block(c.body) })),
            ...(st.defaultBody !== undefined ? { defaultBody: block(st.defaultBody) } : {}),
          },
        ];
      default:
        return [st];
    }
  });
}

export function placeRoot(e: Expr): Expr {
  return e.op === 'index' || e.op === 'member' ? placeRoot(e.base) : e;
}

export function forEachChild(e: Expr, f: (c: Expr) => void): void {
  mapChildren(e, (c) => {
    f(c);
    return c;
  });
}

export const isRuntimeArray = (t: ShaderType): boolean =>
  t.kind === 'array' && t.size === undefined;

export function writesThroughCall(loop: Stmt, array: string, m: ModuleDecl): boolean {
  const byName = new Map(m.funcs.map((g) => [g.name, g]));
  let found = false;
  eachStmtExpr(loop, (e) =>
    eachExpr(e, (x) => {
      if (found || x.op !== 'call') return;
      const callee = byName.get(x.fn);
      if (callee === undefined) return;
      callee.params.forEach((p, i) => {
        if (p.mode !== 'inout' || x.args[i] === undefined) return;
        let root: Expr = x.args[i]!;
        while (root.op === 'index' || root.op === 'member') root = root.base;
        if ((root.op === 'varref' || root.op === 'param') && root.name === array) found = true;
      });
    }),
  );
  return found;
}
