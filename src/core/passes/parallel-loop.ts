// Implements: Rule 8.22 (docs/language-design.md; traced in reqs/).

import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/nodes.js';
import type { SourceSpan } from '../ir/span.js';
import { sourceSpanOf } from '../ir/span.js';
import { eachExpr } from '../ir/visit.js';
import { callArgAccess, readsAtomic } from './access.js';
import { fnWrites } from './effects.js';
import { lastLoopOf, storeAfterLoops } from './kernel-stores.js';
import { isName, reads, readsAny, sameExpr, allSame } from './parallel-loop/expression-equality.js';
import type {
  ForStmt,
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
  Ctx,
  Write,
} from './parallel-loop/types.js';
import { rootName, mutableNames, boundOf, walk, exprsOf } from './parallel-loop/statement-walk.js';
import { elementIndex, affine, distinctForm, texelWidth } from './parallel-loop/index-forms.js';
import { earlyExit, callEffects } from './parallel-loop/loop-exits.js';
import {
  writesIn,
  combineOf,
  readsOf,
  scatterOf,
  isF32ParamArray,
  isIndexOfName,
  isIntegerArray,
} from './parallel-loop/loop-writes.js';
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

function proveLoop(
  loop: ForStmt,
  f: FuncDecl,
  outerLets: ReadonlyMap<string, Expr>,
  c: Ctx,
  opts?: ProofOptions,
): LoopVerdict {
  const refuse = (refusal: LoopRefusal): LoopVerdict => ({ ok: false, loop, refusal });
  if (loop.counted === undefined)
    return refuse({ rule: 'R1', why: 'while', at: sourceSpanOf(loop) });
  if (loop.counted.op !== 'add')
    return refuse({ rule: 'R1', why: 'step', at: sourceSpanOf(loop.update) ?? sourceSpanOf(loop) });
  const i = loop.counted.name;

  const early = earlyExit(loop.body);
  if (early !== undefined) return refuse(early);

  const effect = callEffects(loop.body, c);
  if (effect !== undefined) return refuse(effect);

  const local = new Set<string>();
  const lets = new Map(outerLets);
  const mutable = mutableNames(f);
  walk(loop.body, (st) => {
    if (st.s === 'let') {
      local.add(st.name);
      if (!readsAny(st.expr, mutable)) lets.set(st.name, st.expr);
    } else if (st.s === 'var') local.add(st.name);
  });
  const inner = new Map<string, Expr | undefined>();
  walk(loop.body, (st) => {
    if (st.s === 'for' && st.counted !== undefined) {
      local.add(st.counted.name);
      if (st.counted.op === 'add' && st.counted.step === 1 && st.counted.start === 0)
        inner.set(st.counted.name, boundOf(st));
    }
  });

  const writes = writesIn(loop.body, c);
  for (const w of writes) {
    if (w.root === i) return refuse({ rule: 'R3', why: 'carried', name: i, at: w.at });
  }
  const outer = writes.filter((w) => !local.has(w.root));
  const byRoot = new Map<string, Write[]>();
  for (const w of outer) byRoot.set(w.root, [...(byRoot.get(w.root) ?? []), w]);

  const reductions: LoopReduction[] = [];
  const out: LoopWrite[] = [];
  const writtenAt = new Map<string, Expr[]>();
  const texelAt = new Map<string, Expr[]>();
  const pushed = new Set<string>();
  for (const [root, ws] of byRoot) {
    const first = ws[0]!;
    if (ws.some((w) => w.push === true)) {
      const other = ws.find((w) => w.push !== true);
      if (other !== undefined)
        return refuse({ rule: 'R3', why: 'push-mixed', name: root, at: other.at });
      out.push({ kind: 'append', name: root });
      pushed.add(root);
      continue;
    }
    if (ws.every((w) => w.texel !== undefined)) {
      const widths = ws.map((w) => texelWidth(w.texel!, i, lets, local));
      if (widths.some((x) => x === undefined) || !allSame(widths as Expr[]))
        return refuse({ rule: 'R3', why: 'shared', target: first.target, at: first.at });
      out.push({ kind: 'texel', name: root, width: widths[0]! });
      texelAt.set(
        root,
        ws.map((w) => w.texel!),
      );
      continue;
    }
    const whole = ws.every((w) => isName(w.target));
    if (whole && first.target.type.kind !== 'array') {
      const op = first.combine?.op;
      if (op === undefined || ws.some((w) => w.combine?.op !== op || reads(w.combine.with, root)))
        return refuse({ rule: 'R3', why: 'carried', name: root, at: first.at });
      reductions.push({ name: root, op, type: first.target.type });
      continue;
    }
    if (ws.some((w) => isName(w.target)))
      return refuse({ rule: 'R3', why: 'shared', target: first.target, at: first.at });
    const indices = ws.map((w) => elementIndex(w.target));
    const scatterOp = scatterOf(ws);
    if (scatterOp !== undefined && isIntegerArray(first.target, root, f)) {
      out.push({ kind: 'scatter', name: root, op: scatterOp });
      continue;
    }
    if (indices.some((x) => x === undefined))
      return refuse({ rule: 'R3', why: 'shared', target: first.target, at: first.at });
    const idx = indices as Expr[];
    const form = distinctForm(idx, i, lets, inner, local);
    if (form === undefined) {
      if (
        opts?.cpuScatterF32 === true &&
        scatterOp === '+' &&
        isF32ParamArray(first.target, root, f) &&
        ws.every(
          (w) => w.atomic === undefined && w.combine !== undefined && isIndexOfName(w.target, root),
        )
      ) {
        out.push({ kind: 'scatter', name: root, op: '+', float: true });
        continue;
      }
      const bad = ws[0]!;
      return refuse({ rule: 'R3', why: 'shared', target: bad.target, at: bad.at });
    }
    out.push({ ...form, name: root } as LoopWrite);
    writtenAt.set(root, idx);
  }

  const reducedNames = new Set(reductions.map((r) => r.name));
  const scattered = new Set(out.filter((w) => w.kind === 'scatter').map((w) => w.name));
  const combinedNames = new Set([
    ...reducedNames,
    ...out.filter((w) => w.kind === 'scatter' && w.float !== true).map((w) => w.name),
  ]);
  const arrayParams = new Set(
    f.params.filter((p) => p.type.kind === 'array' && p.type.size === undefined).map((p) => p.name),
  );
  const readAt = new Map<
    string,
    {
      atI: boolean;
      first?: LoopAccess;
      forms: { a: number; c: number; guards?: readonly LoopGuard[] }[];
    }
  >();
  const guardsAt = guardsByStatement(loop.body, i, lets, local);
  const readBack = new Set<string>();
  let bad: LoopRefusal | undefined;
  walk(loop.body, (st) => {
    if (bad !== undefined) return;
    const combined =
      (st.s === 'assign' || st.s === 'assignOp') && combinedNames.has(rootName(st.target) ?? '')
        ? combineOf(st).combine
        : undefined;
    const readsHere =
      combined !== undefined && (st.s === 'assign' || st.s === 'assignOp')
        ? readsOf({ ...st, expr: combined.with })
        : readsOf(st);
    if (st.s === 'assignOp') {
      const written = rootName(st.target);
      if (written !== undefined && writtenAt.has(written)) readBack.add(written);
    }
    exprsOf(st, (e) =>
      eachExpr(e, (x) => {
        if (bad !== undefined || x.op !== 'call' || x.fn === 'textureStore') return;
        if (x.fn.startsWith('textureDimensions')) return;
        const t = x.args[0];
        const root = t === undefined ? undefined : rootName(t);
        const at = root === undefined ? undefined : texelAt.get(root);
        if (at === undefined) return;
        const coord = x.args[1];
        if (coord === undefined || !at.some((w) => sameExpr(w, coord, lets)))
          bad = { rule: 'R4', why: 'reads-written', read: x, at: sourceSpanOf(st) };
      }),
    );
    exprsOf(st, (e) =>
      eachExpr(e, (x) => {
        const counted = x.op === 'call' && x.fn === 'pushCount' ? x.args[0] : undefined;
        const root = counted === undefined ? undefined : rootName(counted);
        if (bad === undefined && root !== undefined && pushed.has(root))
          bad = { rule: 'R4', why: 'reads-pushed', name: root, read: x, at: sourceSpanOf(st) };
        if (
          bad === undefined &&
          x.op === 'call' &&
          x.declRef === undefined &&
          x.fn === 'push' &&
          !(st.s === 'call' && st.expr === x)
        )
          bad = { rule: 'R4', why: 'push-result', at: sourceSpanOf(st) };
      }),
    );
    if (bad !== undefined) return;
    if (bad !== undefined) return;
    for (const read of readsHere) {
      if (bad !== undefined) return;
      const root = rootName(read);
      if (root === undefined || local.has(root) || texelAt.has(root)) continue;
      if (pushed.has(root)) {
        bad = { rule: 'R4', why: 'reads-pushed', name: root, read, at: sourceSpanOf(st) };
        return;
      }
      if (reducedNames.has(root) || scattered.has(root)) {
        bad = {
          rule: 'R3',
          why: 'carried',
          name: root,
          at: byRoot.get(root)?.[0]?.at ?? sourceSpanOf(st),
        };
        return;
      }
      const at = writtenAt.get(root);
      if (at === undefined) {
        if (arrayParams.has(root)) {
          const here = isCounter(elementIndex(read), i, lets);
          const seen = readAt.get(root) ?? { atI: true, forms: [] };
          if (!here && seen.first === undefined) seen.first = { place: read, at: sourceSpanOf(st) };
          seen.atI &&= here;
          const idx = elementIndex(read);
          const form = idx === undefined ? undefined : affine(idx, i, lets);
          const guards = guardsAt.get(st) ?? [];
          if (
            form !== undefined &&
            !seen.forms.some(
              (f) => f.a === form.a && f.c === form.c && sameGuards(f.guards ?? [], guards),
            )
          )
            seen.forms.push(guards.length > 0 ? { ...form, guards } : form);
          readAt.set(root, seen);
        }
        continue;
      }
      const idx = elementIndex(read);
      if (idx === undefined || !at.some((w) => sameExpr(w, idx, lets))) {
        bad = { rule: 'R4', why: 'reads-written', read, at: sourceSpanOf(st) };
        return;
      }
      readBack.add(root);
    }
    if (st.s !== 'call') {
      exprsOf(st, (e) =>
        eachExpr(e, (x) => {
          if (
            bad === undefined &&
            x.op === 'call' &&
            x.args.some((_, k) => readsAtomic(callArgAccess(x, k)))
          )
            bad = { rule: 'R4', why: 'atomic-result', fn: x.fn, at: sourceSpanOf(st) };
        }),
      );
    }
  });
  if (bad !== undefined) return refuse(bad);
  const readFacts: LoopRead[] = [...readAt].map(([name, r]) => ({ name, ...r }));
  const stores: LoopStore[] = [];
  for (const w of out) {
    if (!arrayParams.has(w.name)) continue;
    const off = byRoot.get(w.name)!.find((x) => !isCounter(elementIndex(x.target), i, lets));
    stores.push({
      name: w.name,
      atI: off === undefined,
      readBack: readBack.has(w.name),
      ...(off !== undefined ? { first: { place: off.target, at: off.at } } : {}),
    });
  }
  return { ok: true, loop, writes: out, reductions, reads: readFacts, stores };
}

const FLIPPED = { '<': '>', '<=': '>=', '>': '<', '>=': '<=' } as const;
const NEGATED = { '<': '>=', '<=': '>', '>': '<=', '>=': '<' } as const;

function guardsOf(
  cond: Expr,
  i: string,
  lets: ReadonlyMap<string, Expr>,
  local: ReadonlySet<string>,
  negate = false,
): LoopGuard[] {
  if (cond.op === 'logical' && cond.lop === '&&' && !negate)
    return [
      ...guardsOf(cond.a, i, lets, local, negate),
      ...guardsOf(cond.b, i, lets, local, negate),
    ];
  if (cond.op !== 'compare') return [];
  const cop = cond.cop;
  if (cop !== '<' && cop !== '<=' && cop !== '>' && cop !== '>=') return [];
  const invariant = (x: Expr): boolean => !reads(x, i) && !readsAny(x, local);
  const make = (c: keyof typeof NEGATED, bound: Expr): LoopGuard[] => [
    { cop: negate ? NEGATED[c] : c, bound },
  ];
  if (isCounter(cond.a, i, lets) && invariant(cond.b)) return make(cop, cond.b);
  if (isCounter(cond.b, i, lets) && invariant(cond.a)) return make(FLIPPED[cop], cond.a);
  return [];
}

function guardsByStatement(
  body: readonly Stmt[],
  i: string,
  lets: ReadonlyMap<string, Expr>,
  local: ReadonlySet<string>,
): Map<Stmt, readonly LoopGuard[]> {
  const out = new Map<Stmt, readonly LoopGuard[]>();
  const visit = (stmts: readonly Stmt[], inherited: readonly LoopGuard[]): void => {
    for (const st of stmts) {
      if (inherited.length > 0) out.set(st, inherited);
      if (st.s === 'if') {
        let earlier: LoopGuard[] = [];
        for (const arm of st.arms) {
          visit(arm.body, [...inherited, ...earlier, ...guardsOf(arm.cond, i, lets, local)]);
          earlier = [...earlier, ...guardsOf(arm.cond, i, lets, local, true)];
        }
        if (st.elseBody !== undefined) visit(st.elseBody, [...inherited, ...earlier]);
      } else if (st.s === 'for') visit(st.body, inherited);
      else if (st.s === 'switch') {
        for (const c of st.cases) visit(c.body, inherited);
        if (st.defaultBody !== undefined) visit(st.defaultBody, inherited);
      }
    }
  };
  visit(body, []);
  return out;
}

function sameGuards(a: readonly LoopGuard[], b: readonly LoopGuard[]): boolean {
  return (
    a.length === b.length &&
    a.every((g, k) => g.cop === b[k]!.cop && sameExpr(g.bound, b[k]!.bound))
  );
}

function isCounter(idx: Expr | undefined, i: string, lets: ReadonlyMap<string, Expr>): boolean {
  const form = idx === undefined ? undefined : affine(idx, i, lets);
  return form !== undefined && form.a === 1 && form.c === 0;
}
