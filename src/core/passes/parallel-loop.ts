import { proveLoop } from './parallel-loop/loop-proof.js';
// Implements: Rule 8.22 (docs/language-design.md; traced in reqs/).

import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/nodes.js';
import type { SourceSpan } from '../ir/span.js';
import { sourceSpanOf } from '../ir/span.js';
import { eachExpr } from '../ir/visit.js';
import { fnWrites } from './effects.js';
import { lastLoopOf, storeAfterLoops } from './kernel-stores.js';
import { isName, readsAny } from './parallel-loop/expression-equality.js';
import type {
  ForStmt,
  ProofOptions,
  LoopReduction,
  LoopVerdict,
  ShapeRefusal,
  KernelProof,
  TreeLoop,
  Ctx,
} from './parallel-loop/types.js';
import { rootName, mutableNames, walk, exprsOf } from './parallel-loop/statement-walk.js';
export { combineOf } from './parallel-loop/loop-writes.js';
export type {
  LoopRefusal,
  LoopWrite,
  ProofOptions,
  LoopReduction,
  LoopAccess,
  LoopGuard,
  LoopRead,
  LoopStore,
  LoopVerdict,
  ShapeRefusal,
  KernelProof,
  TreeLoop,
} from './parallel-loop/types.js';

export function proveKernels(m: ModuleDecl, opts?: ProofOptions): KernelProof[] {
  return m.funcs.filter((f) => f.kernel === true).map((f) => proveKernel(f, m, opts));
}

export function treeLoops(source: ModuleDecl, target: ModuleDecl): ReadonlyMap<Stmt, TreeLoop> {
  const out = new Map<Stmt, TreeLoop>();
  if (!source.funcs.some((f) => f.kernel === true)) return out;
  for (const proof of proveKernels(source, { cpuScatterF32: true })) {
    const f = target.funcs.find((x) => x.name === proof.fn);
    if (f === undefined) continue;
    const loops = f.body.filter((st) => st.s === 'for');
    proof.loops.forEach((v, j) => {
      const loop = loops[j];
      if (!v.ok || loop === undefined) return;
      const scatters = v.writes.flatMap((w) => (w.kind === 'scatter' && w.float ? [w.name] : []));
      if (v.reductions.length > 0 || scatters.length > 0)
        out.set(loop, { reductions: v.reductions, scatters });
    });
  }
  return out;
}

export function treeCombine(r: LoopReduction, f32: boolean): Expr {
  const a: Expr = { op: 'varref', type: r.type, name: '$ta' };
  const b: Expr = { op: 'varref', type: r.type, name: '$tb' };
  const e: Expr =
    r.op === 'min' || r.op === 'max'
      ? { op: 'call', type: r.type, fn: r.op, args: [a, b] }
      : { op: 'binop', type: r.type, bop: r.op, a, b };
  const elem = r.type.kind === 'scalar' ? r.type.scalar : r.type.kind === 'vec' ? r.type.elem : '';
  return f32 && elem === 'f32' ? { op: 'call', type: r.type, fn: '__fround', args: [e] } : e;
}

function ctxOf(m: ModuleDecl): Ctx {
  return {
    byName: new Map(m.funcs.map((f) => [f.name, f])),
    writes: fnWrites(m),
    moduleNames: new Set([...m.bindings.map((b) => b.name), ...(m.vars ?? []).map((v) => v.name)]),
    workgroup: new Set((m.vars ?? []).filter((v) => v.space === 'workgroup').map((v) => v.name)),
  };
}

function proveKernel(f: FuncDecl, m: ModuleDecl, opts?: ProofOptions): KernelProof {
  const c = ctxOf(m);
  const loops: LoopVerdict[] = [];
  const lets = new Map<string, Expr>();
  const mutable = mutableNames(f);
  const arrays = new Set(
    f.params.filter((p) => p.type.kind === 'array' && p.type.size === undefined).map((p) => p.name),
  );
  const bindings = new Set(m.bindings.map((b) => b.name));
  let shape: ShapeRefusal | undefined;
  const reduced = new Map<string, SourceSpan | undefined>();
  const lastLoop = lastLoopOf(f.body);
  f.body.forEach((st, index) => {
    if (st.s === 'for') {
      if (shape === undefined) {
        const late = firstRead(st, reduced);
        if (late !== undefined)
          shape = { why: 'split', name: late.name, reducedAt: reduced.get(late.name), at: late.at };
      }
      const v = proveLoop(st, f, lets, c, opts);
      loops.push(v);
      if (v.ok) for (const r of v.reductions) reduced.set(r.name, sourceSpanOf(st));
      return;
    }
    if (st.s === 'let' && !readsAny(st.expr, mutable)) lets.set(st.name, st.expr);
    if (shape !== undefined) return;
    const last = index === f.body.length - 1;
    if (st.s === 'return' && last) return;
    if (index > lastLoop && storeAfterLoops(st, arrays) !== undefined) return;
    if (st.s === 'let' || st.s === 'var' || st.s === 'assign' || st.s === 'assignOp') {
      const written = st.s === 'assign' || st.s === 'assignOp' ? rootName(st.target) : undefined;
      if (written !== undefined && (arrays.has(written) || bindings.has(written)))
        shape = { why: 'outside', what: written, at: sourceSpanOf(st) };
      return;
    }
    shape = { why: 'outside', at: sourceSpanOf(st) };
  });
  return { fn: f.name, ...(shape !== undefined ? { shape } : {}), loops };
}

function firstRead(
  loop: ForStmt,
  reduced: ReadonlyMap<string, SourceSpan | undefined>,
): { name: string; at?: SourceSpan } | undefined {
  if (reduced.size === 0) return undefined;
  let found: { name: string; at?: SourceSpan } | undefined;
  walk(loop.body, (st) => {
    if (found !== undefined) return;
    exprsOf(st, (e) =>
      eachExpr(e, (x) => {
        if (found === undefined && isName(x) && reduced.has(x.name))
          found = { name: x.name, at: sourceSpanOf(st) };
      }),
    );
  });
  if (found === undefined)
    eachExpr(loop.cond, (x) => {
      if (found === undefined && isName(x) && reduced.has(x.name))
        found = { name: x.name, at: sourceSpanOf(loop) };
    });
  return found;
}
