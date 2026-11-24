import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../../ir/nodes.js';
import type { ShaderType } from '../../ir/types.js';
import { u32T } from '../../ir/types.js';
import { eachExpr, eachStmtExpr } from '../../ir/visit.js';
import { bin, u } from '../../kernel-workgroup.js';
import {
  argsOf,
  boolT,
  entryRewrite,
  iterationOf,
  liveRef,
  mapStmt,
  placeRoot,
  tripWord,
  writesThroughCall,
  type ForStmt,
  type KernelLoopPlan,
  type LoopCtx,
} from '../kernel-lower-ir.js';
import { computeEntry, kcRef, laneScaffold } from '../kernel-push/entry.js';
import { readsElements } from '../kernel-stores.js';
import type { KernelProof } from '../parallel-loop.js';

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
