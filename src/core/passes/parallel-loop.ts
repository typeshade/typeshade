// Implements: Rule 8.22 (docs/language-design.md; traced in reqs/).

import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/nodes.js';
import type { SourceSpan } from '../ir/span.js';
import { sourceSpanOf } from '../ir/span.js';
import { eachExpr } from '../ir/visit.js';
import { isBarrierIntrinsic } from '../intrinsics.js';
import { callArgAccess, eachOperand, readsAtomic, writesPlace } from './access.js';
import { fnWrites } from './effects.js';
import { lastLoopOf, storeAfterLoops } from './kernel-stores.js';
import {
  transparent,
  isName,
  reads,
  readsAny,
  sameExpr,
  allSame,
} from './parallel-loop/expression-equality.js';
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
  IndexForm,
} from './parallel-loop/types.js';
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

const REDUCE_BOPS = new Set(['+', '*', '&', '|', '^']);

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

function earlyExit(body: readonly Stmt[]): LoopRefusal | undefined {
  const visit = (sts: readonly Stmt[], nested: boolean): LoopRefusal | undefined => {
    for (const st of sts) {
      switch (st.s) {
        case 'return':
          return { rule: 'R2', why: 'return', at: sourceSpanOf(st) };
        case 'break':
          if (!nested) return { rule: 'R2', why: 'break', at: sourceSpanOf(st) };
          break;
        case 'if':
          for (const a of st.arms) {
            const r = visit(a.body, nested);
            if (r !== undefined) return r;
          }
          if (st.elseBody !== undefined) {
            const r = visit(st.elseBody, nested);
            if (r !== undefined) return r;
          }
          break;
        case 'for': {
          const r = visit(st.body, true);
          if (r !== undefined) return r;
          break;
        }
        case 'switch': {
          for (const cse of st.cases) {
            const r = visit(cse.body, true);
            if (r !== undefined) return r;
          }
          if (st.defaultBody !== undefined) {
            const r = visit(st.defaultBody, true);
            if (r !== undefined) return r;
          }
          break;
        }
        default:
          break;
      }
    }
    return undefined;
  };
  return visit(body, false);
}

function callEffects(body: readonly Stmt[], c: Ctx): LoopRefusal | undefined {
  let found: LoopRefusal | undefined;
  const seen = new Set<string>();
  const inFn = (fn: string, at: SourceSpan | undefined): void => {
    if (seen.has(fn)) return;
    seen.add(fn);
    const decl = c.byName.get(fn);
    if (decl === undefined) return;
    walk(decl.body, (st) => scan(st, at));
  };
  const scan = (st: Stmt, at: SourceSpan | undefined): void => {
    if (found !== undefined) return;
    exprsOf(st, (e) =>
      eachExpr(e, (x) => {
        if (found !== undefined) return;
        if (isName(x) && c.workgroup.has(x.name)) {
          found = { rule: 'R6', why: 'workgroup', name: x.name, at };
          return;
        }
        if (x.op !== 'call') return;
        if (x.fn.startsWith('console.')) {
          found = { rule: 'R6', why: 'console', name: x.fn, at };
          return;
        }
        if (isBarrierIntrinsic(x.fn)) {
          found = { rule: 'R6', why: 'barrier', name: x.fn, at };
          return;
        }
        const decl = c.byName.get(x.fn);
        if (decl === undefined) return;
        const own = new Set(decl.params.filter((p) => p.mode === 'inout').map((p) => p.name));
        for (const n of c.writes.get(x.fn) ?? []) {
          if (!own.has(n) && c.moduleNames.has(n)) {
            found = { rule: 'R5', callee: x.fn, writes: n, at };
            return;
          }
        }
        inFn(x.fn, at);
      }),
    );
  };
  walk(body, (st) => scan(st, sourceSpanOf(st)));
  return found;
}

function writesIn(body: readonly Stmt[], c: Ctx): Write[] {
  const out: Write[] = [];
  walk(body, (st) => {
    const at = sourceSpanOf(st);
    if (st.s === 'assign' || st.s === 'assignOp') {
      const root = rootName(st.target);
      if (root !== undefined) out.push({ target: st.target, root, at, ...combineOf(st) });
    }
    exprsOf(st, (e) =>
      eachExpr(e, (x) => {
        if (x.op !== 'call') return;
        let builtin = false;
        x.args.forEach((t, k) => {
          const access = callArgAccess(x, k);
          if (!writesPlace(access)) return;
          builtin = true;
          const root = rootName(t);
          if (root === undefined) return;
          out.push(
            access === 'texel-write'
              ? { target: t, root, texel: x.args[k + 1], at }
              : access === 'append'
                ? { target: t, root, push: true, at }
                : { target: t, root, atomic: x.fn, at },
          );
        });
        if (builtin) return;
        const decl = c.byName.get(x.fn);
        if (decl === undefined) return;
        decl.params.forEach((p, k) => {
          const a = x.args[k];
          if (p.mode !== 'inout' || a === undefined) return;
          const root = rootName(a);
          if (root !== undefined) out.push({ target: a, root, at });
        });
      }),
    );
  });
  return out;
}

export function combineOf(st: Stmt & { s: 'assign' | 'assignOp' }): Pick<Write, 'combine'> {
  if (st.s === 'assignOp') {
    return REDUCE_BOPS.has(st.bop)
      ? { combine: { op: st.bop as LoopReduction['op'], with: st.expr } }
      : {};
  }
  const e = st.expr;
  if (e.op === 'binop' && REDUCE_BOPS.has(e.bop)) {
    if (sameExpr(e.a, st.target))
      return { combine: { op: e.bop as LoopReduction['op'], with: e.b } };
    if (sameExpr(e.b, st.target))
      return { combine: { op: e.bop as LoopReduction['op'], with: e.a } };
  }
  if (
    e.op === 'call' &&
    e.declRef === undefined &&
    (e.fn === 'min' || e.fn === 'max') &&
    e.args.length === 2
  ) {
    const [a, b] = e.args as [Expr, Expr];
    if (sameExpr(a, st.target)) return { combine: { op: e.fn, with: b } };
    if (sameExpr(b, st.target)) return { combine: { op: e.fn, with: a } };
  }
  return {};
}

function readsOf(st: Stmt): Expr[] {
  const out: Expr[] = [];
  const add = (e: Expr): void => {
    const visit = (x: Expr): void => {
      if (x.op === 'index' || x.op === 'member') {
        out.push(x);
        let b: Expr = x;
        while (b.op === 'index' || b.op === 'member') {
          if (b.op === 'index') visit(b.idx);
          b = b.base;
        }
        return;
      }
      if (isName(x)) {
        out.push(x);
        return;
      }
      eachOperand(x, (operand, access) => {
        if (access === 'value') visit(operand);
        else if (access !== 'length') indicesOf(operand).forEach(visit);
      });
    };
    visit(e);
  };
  switch (st.s) {
    case 'assign':
      indicesOf(st.target).forEach(add);
      add(st.expr);
      break;
    case 'assignOp':
      indicesOf(st.target).forEach(add);
      add(st.expr);
      break;
    default:
      exprsOf(st, add);
  }
  return out;
}

function indicesOf(e: Expr): Expr[] {
  const out: Expr[] = [];
  let b: Expr = e;
  while (b.op === 'index' || b.op === 'member') {
    if (b.op === 'index') out.push(b.idx);
    b = b.base;
  }
  return out;
}

function elementIndex(e: Expr): Expr | undefined {
  let b: Expr = e;
  let last: Expr | undefined;
  while (b.op === 'index' || b.op === 'member') {
    if (b.op === 'index') last = b.idx;
    b = b.base;
  }
  return last;
}

function rootName(e: Expr): string | undefined {
  let b: Expr = e;
  while (b.op === 'index' || b.op === 'member') b = b.base;
  return isName(b) ? b.name : undefined;
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

function affine(
  e: Expr,
  i: string,
  lets: ReadonlyMap<string, Expr>,
  depth = 0,
): { a: number; c: number } | undefined {
  if (depth > 16) return undefined;
  const r = (x: Expr): { a: number; c: number } | undefined => affine(x, i, lets, depth + 1);
  const inner = transparent(e);
  if (inner !== e) return r(inner);
  switch (e.op) {
    case 'lit':
      return typeof e.value === 'number' ? { a: 0, c: e.value } : undefined;
    case 'varref':
    case 'param': {
      if (e.name === i) return { a: 1, c: 0 };
      const bound = lets.get(e.name);
      return bound === undefined ? undefined : r(bound);
    }
    case 'unop': {
      const x = r(e.a);
      return x === undefined ? undefined : { a: -x.a, c: -x.c };
    }
    case 'binop': {
      const x = r(e.a);
      const y = r(e.b);
      if (x === undefined || y === undefined) return undefined;
      if (e.bop === '+') return { a: x.a + y.a, c: x.c + y.c };
      if (e.bop === '-') return { a: x.a - y.a, c: x.c - y.c };
      if (e.bop === '*') {
        if (x.a === 0) return { a: x.c * y.a, c: x.c * y.c };
        if (y.a === 0) return { a: y.c * x.a, c: y.c * x.c };
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

function isCounter(idx: Expr | undefined, i: string, lets: ReadonlyMap<string, Expr>): boolean {
  const form = idx === undefined ? undefined : affine(idx, i, lets);
  return form !== undefined && form.a === 1 && form.c === 0;
}

function distinctForm(
  idx: readonly Expr[],
  i: string,
  lets: ReadonlyMap<string, Expr>,
  inner: ReadonlyMap<string, Expr | undefined>,
  local: ReadonlySet<string>,
): IndexForm | undefined {
  const forms = idx.map((e) => affine(e, i, lets));
  if (forms.every((f) => f !== undefined)) {
    const fs = forms as { a: number; c: number }[];
    const a = fs[0]!.a;
    if (a !== 0 && fs.every((f) => f.a === a)) {
      const cs = fs.map((f) => f.c);
      const oneC = cs.every((x) => x === cs[0]);
      const inStride = cs.every((x) => x >= 0 && x < Math.abs(a));
      if (oneC || inStride) return { kind: 'affine', a, c: [...new Set(cs)] };
    }
    return undefined;
  }
  const rows = idx.map((e) => rowMajor(e, i, lets, inner, local));
  if (rows.every((w) => w !== undefined) && allSame(rows as Expr[]))
    return { kind: 'row-major', width: rows[0]! };
  if (allSame(idx)) {
    const k = scaledCoefficient(idx[0]!, i, local);
    if (k !== undefined) return { kind: 'scaled', index: idx[0]!, coefficient: k };
  }
  return undefined;
}

function through(e: Expr, lets: ReadonlyMap<string, Expr>, depth = 0): Expr {
  const x = transparent(e);
  if (depth < 16 && isName(x) && lets.has(x.name))
    return through(lets.get(x.name)!, lets, depth + 1);
  return x;
}

function rowMajor(
  e: Expr,
  i: string,
  lets: ReadonlyMap<string, Expr>,
  inner: ReadonlyMap<string, Expr | undefined>,
  local: ReadonlySet<string>,
): Expr | undefined {
  const x = through(e, lets);
  if (x.op !== 'binop' || x.bop !== '+') return undefined;
  const isI = (y: Expr): boolean => {
    const z = through(y, lets);
    return isName(z) && z.name === i;
  };
  const invariant = (y: Expr): boolean => loopInvariant(y, i, lets, local);
  for (const [mul, add] of [
    [x.a, x.b],
    [x.b, x.a],
  ] as const) {
    const m = through(mul, lets);
    const counter = through(add, lets);
    if (m.op !== 'binop' || m.bop !== '*' || !isName(counter) || !inner.has(counter.name)) continue;
    const w = isI(m.a) ? m.b : isI(m.b) ? m.a : undefined;
    const bound = inner.get(counter.name);
    if (
      w !== undefined &&
      bound !== undefined &&
      invariant(w) &&
      invariant(bound) &&
      sameExpr(w, bound, lets)
    )
      return w;
  }
  return undefined;
}

function loopInvariant(
  e: Expr,
  i: string,
  lets: ReadonlyMap<string, Expr>,
  local: ReadonlySet<string>,
  depth = 0,
): boolean {
  if (depth > 16) return false;
  let ok = true;
  eachExpr(e, (x) => {
    if (!ok || !isName(x)) return;
    if (x.name === i) ok = false;
    else if (lets.has(x.name)) ok = loopInvariant(lets.get(x.name)!, i, lets, local, depth + 1);
    else if (local.has(x.name)) ok = false;
  });
  return ok;
}

function mutableNames(f: FuncDecl): Set<string> {
  const counters = new Set<string>();
  const vars = new Set<string>();
  walk(f.body, (st) => {
    if (st.s === 'for' && st.counted !== undefined) counters.add(st.counted.name);
    if (st.s === 'var') vars.add(st.name);
  });
  for (const n of counters) vars.delete(n);
  return vars;
}

function scaledCoefficient(e: Expr, i: string, local: ReadonlySet<string>): Expr | undefined {
  const invariant = (x: Expr): boolean => !reads(x, i) && !readsAny(x, local);
  let x = transparent(e);
  if (x.op === 'binop' && x.bop === '+') {
    if (invariant(x.b)) x = transparent(x.a);
    else if (invariant(x.a)) x = transparent(x.b);
    else return undefined;
  }
  if (isName(x) && x.name === i) return { op: 'lit', type: x.type, value: 1 };
  if (x.op !== 'binop' || x.bop !== '*') return undefined;
  const a = transparent(x.a);
  const b = transparent(x.b);
  if (isName(a) && a.name === i && invariant(b)) return b;
  if (isName(b) && b.name === i && invariant(a)) return a;
  return undefined;
}

function texelWidth(
  coord: Expr,
  i: string,
  lets: ReadonlyMap<string, Expr>,
  local: ReadonlySet<string>,
): Expr | undefined {
  if (coord.op !== 'construct' || coord.args.length !== 2) return undefined;
  const [x, y] = coord.args.map(transparent) as [Expr, Expr];
  if (x.op !== 'binop' || x.bop !== '%' || y.op !== 'binop' || y.bop !== '/') return undefined;
  const isI = (e: Expr): boolean => {
    const t = transparent(e);
    return isName(t) && t.name === i;
  };
  if (!isI(x.a) || !isI(y.a) || !sameExpr(x.b, y.b, lets)) return undefined;
  if (!loopInvariant(x.b, i, lets, local)) return undefined;
  return x.b;
}

function scatterOf(ws: readonly Write[]): string | undefined {
  const ops = ws.map((w) =>
    w.atomic !== undefined
      ? w.atomic
      : w.combine !== undefined && !reads(w.combine.with, w.root)
        ? w.combine.op
        : undefined,
  );
  if (ops.some((o) => o === undefined)) return undefined;
  return ops.every((o) => o === ops[0]) ? ops[0] : undefined;
}

function isF32ParamArray(target: Expr, root: string, f: FuncDecl): boolean {
  const p = f.params.find((x) => x.name === root);
  return (
    p !== undefined &&
    p.type.kind === 'array' &&
    target.type.kind === 'scalar' &&
    target.type.scalar === 'f32'
  );
}

function isIndexOfName(e: Expr, name: string): boolean {
  return e.op === 'index' && isName(e.base) && e.base.name === name;
}

function isIntegerArray(target: Expr, root: string, f: FuncDecl): boolean {
  const scalar =
    target.type.kind === 'scalar'
      ? target.type.scalar
      : target.type.kind === 'atomic'
        ? target.type.elem
        : undefined;
  void root;
  void f;
  return scalar === 'u32' || scalar === 'i32';
}

function boundOf(loop: ForStmt): Expr | undefined {
  const c = loop.cond;
  if (c.op !== 'compare' || c.cop !== '<' || loop.counted === undefined) return undefined;
  const a = transparent(c.a);
  return isName(a) && a.name === loop.counted.name ? c.b : undefined;
}

function walk(body: readonly Stmt[], visit: (st: Stmt) => void): void {
  for (const st of body) {
    visit(st);
    switch (st.s) {
      case 'if':
        for (const a of st.arms) walk(a.body, visit);
        if (st.elseBody !== undefined) walk(st.elseBody, visit);
        break;
      case 'for':
        visit(st.init);
        visit(st.update);
        walk(st.body, visit);
        break;
      case 'switch':
        for (const c of st.cases) walk(c.body, visit);
        if (st.defaultBody !== undefined) walk(st.defaultBody, visit);
        break;
      default:
        break;
    }
  }
}

function exprsOf(st: Stmt, visit: (e: Expr) => void): void {
  switch (st.s) {
    case 'let':
      visit(st.expr);
      break;
    case 'var':
      if (st.init !== undefined) visit(st.init);
      break;
    case 'assign':
    case 'assignOp':
      visit(st.target);
      visit(st.expr);
      break;
    case 'call':
      visit(st.expr);
      break;
    case 'return':
      if (st.expr !== undefined) visit(st.expr);
      break;
    case 'if':
      for (const a of st.arms) visit(a.cond);
      break;
    case 'for':
      visit(st.cond);
      break;
    case 'switch':
      visit(st.scrut);
      break;
    default:
      break;
  }
}
