// Implements: Rule 8.22 (docs/language-design.md; traced in reqs/).
// ═══ The independence proof of a kernel function's loops (Rule 8.22, change 0013) ═══
//
// A kernel function (`FuncDecl.kernel`) is an exported function that takes an array with no size.
// Each `for` at the top level of its body is a CANDIDATE loop: when every iteration touches only
// what no other iteration touches, the iterations may run in any order, which is what a GPU
// dispatch does with them. This pass decides that, syntactically, on the IR:
//
//   R1  the loop is counted (Rule 7.5, the `for`'s `counted` fact) with an additive step;
//   R2  nothing leaves it early: no `return`, and no `break` that belongs to it;
//   R3  every write lands on a name declared in the body, an outer array at an index distinct per
//       iteration (`a*i + c`, `i*W + x` over a nested loop, or one index with a coefficient the
//       call checks), a texture at `vec2(i % W, i / W)`, a reduction variable (`s op= e`), or an
//       integer array combined with `op=` (a scatter reduction);
//   R4  an array the loop writes is read only at an index it writes, a reduction variable is not
//       read, and the value an atomic returns is not read;
//   R5  a function the body calls writes no module variable and no binding (its `inout`
//       arguments are writes at the call, under R3);
//   R6  no barrier, no workgroup memory and no `console` call.
//
// There is no solver and no alias analysis: the IR has no pointers and no recursion, and only
// bindings and `inout` arguments alias. The pass returns FACTS in IR names and spans; the front
// end, which still has the author's names and lines, turns a refusal into `TS8070`
// (src/compiler/ts/kernel-loops.ts).

import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/nodes.js';
import type { SourceSpan } from '../ir/span.js';
import { sourceSpanOf } from '../ir/span.js';
import { eachExpr } from '../ir/visit.js';
import { isAtomicIntrinsic, isBarrierIntrinsic } from '../intrinsics.js';
import { fnWrites } from './effects.js';

type ForStmt = Stmt & { s: 'for' };

/** Why a candidate loop runs on the CPU. `at` is the span of the statement that says so. */
export type LoopRefusal =
  | { readonly rule: 'R1'; readonly why: 'while'; readonly at?: SourceSpan }
  | { readonly rule: 'R1'; readonly why: 'step'; readonly at?: SourceSpan }
  | { readonly rule: 'R2'; readonly why: 'return' | 'break'; readonly at?: SourceSpan }
  /** `name` is written and read by another iteration. */
  | {
      readonly rule: 'R3';
      readonly why: 'carried';
      readonly name: string;
      readonly at?: SourceSpan;
    }
  /** `target` is an element two iterations can share. */
  | { readonly rule: 'R3'; readonly why: 'shared'; readonly target: Expr; readonly at?: SourceSpan }
  /** `read` reads an element another iteration writes. */
  | {
      readonly rule: 'R4';
      readonly why: 'reads-written';
      readonly read: Expr;
      readonly at?: SourceSpan;
    }
  /** The value `fn` returns is read, and depends on the order of the iterations. */
  | {
      readonly rule: 'R4';
      readonly why: 'atomic-result';
      readonly fn: string;
      readonly at?: SourceSpan;
    }
  | {
      readonly rule: 'R5';
      readonly callee: string;
      readonly writes: string;
      readonly at?: SourceSpan;
    }
  | {
      readonly rule: 'R6';
      readonly why: 'console' | 'barrier' | 'workgroup';
      /** The call or the variable. */
      readonly name: string;
      readonly at?: SourceSpan;
    };

/** How an accepted loop writes one outer array or texture. */
export type LoopWrite =
  /** At `a*i + c`: `a` nonzero, the same for every write, with each `c` in `[0, |a|)` or one `c`. */
  | {
      readonly kind: 'affine';
      readonly name: string;
      readonly a: number;
      readonly c: readonly number[];
    }
  /** At one index whose coefficient of `i` is loop-invariant, which the call checks is not 0. */
  | {
      readonly kind: 'scaled';
      readonly name: string;
      readonly index: Expr;
      readonly coefficient: Expr;
    }
  /** At `i*W + x`, over the nested loop of `x` from 0 to `< W`. */
  | { readonly kind: 'row-major'; readonly name: string; readonly width: Expr }
  /** A texture at `vec2(i % W, i / W)`. */
  | { readonly kind: 'texel'; readonly name: string; readonly width: Expr }
  /** An integer array combined with `op` at any index (a scatter reduction), or through atomics. */
  | { readonly kind: 'scatter'; readonly name: string; readonly op: string };

/** A variable an accepted loop combines, `s op= e`. */
export interface LoopReduction {
  readonly name: string;
  readonly op: '+' | '*' | '&' | '|' | '^' | 'min' | 'max';
}

/** The verdict on one candidate loop. */
export type LoopVerdict =
  | {
      readonly ok: true;
      readonly loop: ForStmt;
      readonly writes: readonly LoopWrite[];
      readonly reductions: readonly LoopReduction[];
    }
  | { readonly ok: false; readonly loop: ForStmt; readonly refusal: LoopRefusal };

/** Why a kernel function's body is not the shape the kernel call runs: scalar statements, then
 *  the loops, then a `return` of scalars. The whole function runs on the CPU. */
export type ShapeRefusal =
  /** A top-level statement that is not a loop writes an array or does something else only a
   *  loop may. `what` is the array it writes, when it writes one. */
  | { readonly why: 'outside'; readonly what?: string; readonly at?: SourceSpan }
  /** A later loop reads `name`, which an earlier loop reduces. */
  | {
      readonly why: 'split';
      readonly name: string;
      readonly reducedAt?: SourceSpan;
      readonly at?: SourceSpan;
    };

/** The proof of one kernel function. */
export interface KernelProof {
  readonly fn: string;
  /** Absent when the body is the kernel call's shape. */
  readonly shape?: ShapeRefusal;
  /** One per top-level loop, in order. */
  readonly loops: readonly LoopVerdict[];
}

/** Prove each kernel function of `m`. */
export function proveKernels(m: ModuleDecl): KernelProof[] {
  return m.funcs.filter((f) => f.kernel === true).map((f) => proveKernel(f, m));
}

// ─── the module the proof reads ──────────────────────────────────────────────────────────────

interface Ctx {
  readonly byName: ReadonlyMap<string, FuncDecl>;
  readonly writes: ReadonlyMap<string, ReadonlySet<string>>;
  /** Module variables and bindings: what R5 forbids a callee to write. */
  readonly moduleNames: ReadonlySet<string>;
  readonly workgroup: ReadonlySet<string>;
}

function ctxOf(m: ModuleDecl): Ctx {
  return {
    byName: new Map(m.funcs.map((f) => [f.name, f])),
    writes: fnWrites(m),
    moduleNames: new Set([...m.bindings.map((b) => b.name), ...(m.vars ?? []).map((v) => v.name)]),
    workgroup: new Set((m.vars ?? []).filter((v) => v.space === 'workgroup').map((v) => v.name)),
  };
}

// ─── the kernel's body ───────────────────────────────────────────────────────────────────────

function proveKernel(f: FuncDecl, m: ModuleDecl): KernelProof {
  const c = ctxOf(m);
  const loops: LoopVerdict[] = [];
  // A `let` at the top of the body is a name the loops may read through, as a constant.
  const lets = new Map<string, Expr>();
  const arrays = new Set(
    f.params.filter((p) => p.type.kind === 'array' && p.type.size === undefined).map((p) => p.name),
  );
  const bindings = new Set(m.bindings.map((b) => b.name));
  let shape: ShapeRefusal | undefined;
  // What each earlier loop reduces, for the loops after it.
  const reduced = new Map<string, SourceSpan | undefined>();
  f.body.forEach((st, index) => {
    if (st.s === 'for') {
      if (shape === undefined) {
        const late = firstRead(st, reduced);
        if (late !== undefined)
          shape = { why: 'split', name: late.name, reducedAt: reduced.get(late.name), at: late.at };
      }
      const v = proveLoop(st, f, lets, c);
      loops.push(v);
      if (v.ok) for (const r of v.reductions) reduced.set(r.name, sourceSpanOf(st));
      return;
    }
    if (st.s === 'let') lets.set(st.name, st.expr);
    if (shape !== undefined) return;
    // What only a loop may do: write an array, or anything but a plain scalar statement.
    const last = index === f.body.length - 1;
    if (st.s === 'return' && last) return;
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

/** The first read of a name an earlier loop reduced, in `loop`. */
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

// ─── one loop ────────────────────────────────────────────────────────────────────────────────

const REDUCE_BOPS = new Set(['+', '*', '&', '|', '^']);

/** One write the body makes, before it is classified. */
interface Write {
  /** The written place: `s`, `out[i]`, `ps[i].pos`, or a texture. */
  readonly target: Expr;
  readonly root: string;
  /** `s op= e` or `s = s op e`, with `e`; `min`/`max` as `s = min(s, e)`. */
  readonly combine?: { readonly op: LoopReduction['op']; readonly with: Expr };
  /** An atomic builtin's location, which lowers as a scatter. */
  readonly atomic?: string;
  /** A texture write's coordinate. */
  readonly texel?: Expr;
  readonly at?: SourceSpan;
}

function proveLoop(
  loop: ForStmt,
  f: FuncDecl,
  outerLets: ReadonlyMap<string, Expr>,
  c: Ctx,
): LoopVerdict {
  const refuse = (refusal: LoopRefusal): LoopVerdict => ({ ok: false, loop, refusal });
  // R1: counted, and by adding a constant.
  if (loop.counted === undefined)
    return refuse({ rule: 'R1', why: 'while', at: sourceSpanOf(loop) });
  if (loop.counted.op !== 'add')
    return refuse({ rule: 'R1', why: 'step', at: sourceSpanOf(loop.update) ?? sourceSpanOf(loop) });
  const i = loop.counted.name;

  // R2: nothing leaves the loop early.
  const early = earlyExit(loop.body);
  if (early !== undefined) return refuse(early);

  // R6 and R5, over the body and every function it calls.
  const effect = callEffects(loop.body, c);
  if (effect !== undefined) return refuse(effect);

  // What the body declares is per iteration; a `let` is read through as a constant.
  const local = new Set<string>();
  const lets = new Map(outerLets);
  walk(loop.body, (st) => {
    if (st.s === 'let') {
      local.add(st.name);
      lets.set(st.name, st.expr);
    } else if (st.s === 'var') local.add(st.name);
  });
  // The counters of the loops nested in it, and their bounds, for the row-major form.
  const inner = new Map<string, Expr | undefined>();
  walk(loop.body, (st) => {
    if (st.s === 'for' && st.counted !== undefined) {
      local.add(st.counted.name);
      if (st.counted.op === 'add' && st.counted.step === 1 && st.counted.start === 0)
        inner.set(st.counted.name, boundOf(st));
    }
  });

  // R3: every write, classified.
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
  for (const [root, ws] of byRoot) {
    const first = ws[0]!;
    const whole = ws.every((w) => isName(w.target));
    if (whole && first.target.type.kind !== 'array') {
      // (e) a reduction: every write combines with one op, and nothing else reads it.
      const op = first.combine?.op;
      if (op === undefined || ws.some((w) => w.combine?.op !== op || reads(w.combine.with, root)))
        return refuse({ rule: 'R3', why: 'carried', name: root, at: first.at });
      reductions.push({ name: root, op });
      continue;
    }
    if (ws.some((w) => isName(w.target)))
      return refuse({ rule: 'R3', why: 'shared', target: first.target, at: first.at });
    // (d) a texture at `vec2(i % W, i / W)`.
    if (ws.every((w) => w.texel !== undefined)) {
      const widths = ws.map((w) => texelWidth(w.texel!, i, lets));
      if (widths.some((x) => x === undefined) || !allSame(widths as Expr[]))
        return refuse({ rule: 'R3', why: 'shared', target: first.target, at: first.at });
      out.push({ kind: 'texel', name: root, width: widths[0]! });
      continue;
    }
    const indices = ws.map((w) => elementIndex(w.target));
    // (f) an integer array combined with one op anywhere, or through atomics.
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
      const bad = ws[0]!;
      return refuse({ rule: 'R3', why: 'shared', target: bad.target, at: bad.at });
    }
    out.push({ ...form, name: root } as LoopWrite);
    writtenAt.set(root, idx);
  }

  // R4: what the loop writes is read only where it writes it; a reduction is not read.
  const reducedNames = new Set(reductions.map((r) => r.name));
  const scattered = new Set(out.filter((w) => w.kind === 'scatter').map((w) => w.name));
  let bad: LoopRefusal | undefined;
  walk(loop.body, (st) => {
    if (bad !== undefined) return;
    // A reduction's own statement reads the variable it combines into, which is the combine.
    const combined =
      (st.s === 'assign' || st.s === 'assignOp') && reducedNames.has(rootName(st.target) ?? '')
        ? combineOf(st).combine
        : undefined;
    const readsHere =
      combined !== undefined ? readsOf({ s: 'call', expr: combined.with } as Stmt) : readsOf(st);
    for (const read of readsHere) {
      if (bad !== undefined) return;
      const root = rootName(read);
      if (root === undefined || local.has(root)) continue;
      if (reducedNames.has(root) || scattered.has(root)) {
        // Named on the write, which the message is about: the read is what makes it carry.
        bad = {
          rule: 'R3',
          why: 'carried',
          name: root,
          at: byRoot.get(root)?.[0]?.at ?? sourceSpanOf(st),
        };
        return;
      }
      const at = writtenAt.get(root);
      if (at === undefined) continue;
      const idx = elementIndex(read);
      if (idx === undefined || !at.some((w) => sameExpr(w, idx, lets))) {
        bad = { rule: 'R4', why: 'reads-written', read, at: sourceSpanOf(st) };
        return;
      }
    }
    // The value an atomic returns depends on the order of the iterations.
    if (st.s !== 'call') {
      exprsOf(st, (e) =>
        eachExpr(e, (x) => {
          if (
            bad === undefined &&
            x.op === 'call' &&
            isAtomicIntrinsic(x.fn) &&
            x.fn !== 'atomicStore'
          )
            bad = { rule: 'R4', why: 'atomic-result', fn: x.fn, at: sourceSpanOf(st) };
        }),
      );
    }
  });
  if (bad !== undefined) return refuse(bad);
  return { ok: true, loop, writes: out, reductions };
}

// ─── R2, R5, R6 ──────────────────────────────────────────────────────────────────────────────

/** A `return`, or a `break` that belongs to the loop: not one inside a nested loop or switch. */
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

/** R6 and R5: a console call, a barrier or workgroup memory in the body or in a function it
 *  calls, and a call whose callee writes a module variable or a binding. */
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

// ─── writes and reads ────────────────────────────────────────────────────────────────────────

/** Every write in `body`: assignments, `inout` arguments, atomics and texture stores. */
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
        if (isAtomicIntrinsic(x.fn) && x.fn !== 'atomicLoad') {
          const t = x.args[0];
          const root = t === undefined ? undefined : rootName(t);
          if (t !== undefined && root !== undefined)
            out.push({ target: t, root, atomic: x.fn, at });
          return;
        }
        if (x.fn === 'textureStore') {
          const t = x.args[0];
          const root = t === undefined ? undefined : rootName(t);
          if (t !== undefined && root !== undefined)
            out.push({ target: t, root, texel: x.args[1], at });
          return;
        }
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

/** `s op= e`, `s = s op e`, `s = e op s` (for a commutative op) and `s = min(s, e)`. */
function combineOf(st: Stmt & { s: 'assign' | 'assignOp' }): Pick<Write, 'combine'> {
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
  if (e.op === 'call' && (e.fn === 'min' || e.fn === 'max') && e.args.length === 2) {
    const [a, b] = e.args as [Expr, Expr];
    if (sameExpr(a, st.target)) return { combine: { op: e.fn, with: b } };
    if (sameExpr(b, st.target)) return { combine: { op: e.fn, with: a } };
  }
  return {};
}

/** What a statement reads: each array element, field and name it evaluates, outermost first,
 *  and not the place it assigns (an `assignOp` reads its target too, which its combine covers). */
function readsOf(st: Stmt): Expr[] {
  const out: Expr[] = [];
  const add = (e: Expr): void => {
    // The outermost place of each chain, which is what an index check reads.
    const visit = (x: Expr): void => {
      if (x.op === 'index' || x.op === 'member') {
        out.push(x);
        // The indices inside are reads of their own.
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
      forChildren(x, visit);
    };
    visit(e);
  };
  switch (st.s) {
    case 'assign':
      // The target's own indices are read; the place is not.
      indicesOf(st.target).forEach(add);
      add(st.expr);
      break;
    case 'assignOp':
      indicesOf(st.target).forEach(add);
      add(st.expr);
      break;
    default:
      exprsOf(st, (e) => {
        // A call's inout argument and an atomic's location are writes, classified by R3.
        if (e.op === 'call' && (isAtomicIntrinsic(e.fn) || e.fn === 'textureStore')) {
          e.args.slice(1).forEach(add);
          indicesOf(e.args[0]!).forEach(add);
          return;
        }
        add(e);
      });
  }
  return out;
}

/** The index expressions inside a place, `out[k].pos[j]` gives `k` and `j`. */
function indicesOf(e: Expr): Expr[] {
  const out: Expr[] = [];
  let b: Expr = e;
  while (b.op === 'index' || b.op === 'member') {
    if (b.op === 'index') out.push(b.idx);
    b = b.base;
  }
  return out;
}

/** The index of the outer array element a place names: `k` for `a[k]`, `a[k].pos` and `a[k][j]`
 *  on an array of arrays; undefined when the place is not an element. */
function elementIndex(e: Expr): Expr | undefined {
  let b: Expr = e;
  let last: Expr | undefined;
  while (b.op === 'index' || b.op === 'member') {
    if (b.op === 'index') last = b.idx;
    b = b.base;
  }
  return last;
}

/** The name at the root of a place: `out` for `out[i].pos`. */
function rootName(e: Expr): string | undefined {
  let b: Expr = e;
  while (b.op === 'index' || b.op === 'member') b = b.base;
  return isName(b) ? b.name : undefined;
}

// ─── the index forms of R3 ───────────────────────────────────────────────────────────────────

/** `a*i + c` with constants, through casts and constant `let`s. */
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
      // A unop is negation.
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

/** A cast (`u32(x)`, `i32(x)`) is transparent to an index. */
function transparent(e: Expr): Expr {
  if (
    (e.op === 'call' || e.op === 'construct') &&
    e.args.length === 1 &&
    e.type.kind === 'scalar' &&
    (e.type.scalar === 'u32' || e.type.scalar === 'i32') &&
    (e.op === 'construct' || e.fn === 'u32' || e.fn === 'i32')
  )
    return e.args[0]!;
  return e;
}

/** The index form of an array's writes, before it is given the array's name. */
type IndexForm =
  | { readonly kind: 'affine'; readonly a: number; readonly c: readonly number[] }
  | { readonly kind: 'scaled'; readonly index: Expr; readonly coefficient: Expr }
  | { readonly kind: 'row-major'; readonly width: Expr };

/** How the writes to one array are distinct per iteration, or undefined. */
function distinctForm(
  idx: readonly Expr[],
  i: string,
  lets: ReadonlyMap<string, Expr>,
  inner: ReadonlyMap<string, Expr | undefined>,
  local: ReadonlySet<string>,
): IndexForm | undefined {
  // (b) `a*i + c`.
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
  // (c) `i*W + x` over a nested loop of `x` from 0 to `< W`.
  const rows = idx.map((e) => rowMajor(e, i, lets, inner));
  if (rows.every((w) => w !== undefined) && allSame(rows as Expr[]))
    return { kind: 'row-major', width: rows[0]! };
  // (b') one index, the same at every write, whose coefficient of `i` is loop-invariant.
  if (allSame(idx)) {
    const k = scaledCoefficient(idx[0]!, i, local);
    if (k !== undefined) return { kind: 'scaled', index: idx[0]!, coefficient: k };
  }
  return undefined;
}

/** `W` for `i*W + x` (either order), with `x` a nested loop's counter bounded by `W`. */
function rowMajor(
  e: Expr,
  i: string,
  lets: ReadonlyMap<string, Expr>,
  inner: ReadonlyMap<string, Expr | undefined>,
): Expr | undefined {
  const x = transparent(e);
  if (x.op !== 'binop' || x.bop !== '+') return undefined;
  for (const [mul, add] of [
    [x.a, x.b],
    [x.b, x.a],
  ] as const) {
    const m = transparent(mul);
    const counter = transparent(add);
    if (m.op !== 'binop' || m.bop !== '*' || !isName(counter) || !inner.has(counter.name)) continue;
    const w =
      isName(transparent(m.a)) && (transparent(m.a) as { name: string }).name === i
        ? m.b
        : isName(transparent(m.b)) && (transparent(m.b) as { name: string }).name === i
          ? m.a
          : undefined;
    const bound = inner.get(counter.name);
    if (w !== undefined && bound !== undefined && sameExpr(w, bound, lets)) return w;
  }
  return undefined;
}

/** The coefficient `k` of `i*k` or `i*k + j` with `k` and `j` loop-invariant. */
function scaledCoefficient(e: Expr, i: string, local: ReadonlySet<string>): Expr | undefined {
  const invariant = (x: Expr): boolean => !reads(x, i) && !readsAny(x, local);
  let x = transparent(e);
  if (x.op === 'binop' && x.bop === '+') {
    if (invariant(x.b)) x = transparent(x.a);
    else if (invariant(x.a)) x = transparent(x.b);
    else return undefined;
  }
  if (x.op !== 'binop' || x.bop !== '*') return undefined;
  const a = transparent(x.a);
  const b = transparent(x.b);
  if (isName(a) && a.name === i && invariant(b)) return b;
  if (isName(b) && b.name === i && invariant(a)) return a;
  return undefined;
}

/** `W` for a texture coordinate `vec2(i % W, i / W)`. */
function texelWidth(coord: Expr, i: string, lets: ReadonlyMap<string, Expr>): Expr | undefined {
  if (coord.op !== 'construct' || coord.args.length !== 2) return undefined;
  const [x, y] = coord.args.map(transparent) as [Expr, Expr];
  if (x.op !== 'binop' || x.bop !== '%' || y.op !== 'binop' || y.bop !== '/') return undefined;
  const isI = (e: Expr): boolean => {
    const t = transparent(e);
    return isName(t) && t.name === i;
  };
  if (!isI(x.a) || !isI(y.a) || !sameExpr(x.b, y.b, lets)) return undefined;
  return x.b;
}

/** The one op an integer scatter combines with, when every write is `a[k] op= e` with one op or
 *  an atomic of one kind. */
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

// ─── expressions ─────────────────────────────────────────────────────────────────────────────

type NameExpr = Expr & { op: 'varref' | 'param' };
const isName = (e: Expr): e is NameExpr => e.op === 'varref' || e.op === 'param';

function reads(e: Expr, name: string): boolean {
  let hit = false;
  eachExpr(e, (x) => {
    if (isName(x) && x.name === name) hit = true;
  });
  return hit;
}

function readsAny(e: Expr, names: ReadonlySet<string>): boolean {
  let hit = false;
  eachExpr(e, (x) => {
    if (isName(x) && names.has(x.name)) hit = true;
  });
  return hit;
}

/** Structural equality of two expressions, through casts and constant `let`s. */
function sameExpr(a: Expr, b: Expr, lets?: ReadonlyMap<string, Expr>, depth = 0): boolean {
  if (depth > 16) return false;
  const x = transparent(a);
  const y = transparent(b);
  const same = (p: Expr, q: Expr): boolean => sameExpr(p, q, lets, depth + 1);
  if (isName(x) && isName(y) && x.name === y.name) return true;
  if (lets !== undefined) {
    if (isName(x) && lets.has(x.name)) return same(lets.get(x.name)!, y);
    if (isName(y) && lets.has(y.name)) return same(x, lets.get(y.name)!);
  }
  if (x.op !== y.op) return false;
  switch (x.op) {
    case 'lit':
      return x.value === (y as typeof x).value;
    case 'constref':
    case 'overrideref':
    case 'externref':
      return x.name === (y as typeof x).name;
    case 'binop': {
      const o = y as typeof x;
      return x.bop === o.bop && same(x.a, o.a) && same(x.b, o.b);
    }
    case 'compare': {
      const o = y as typeof x;
      return x.cop === o.cop && same(x.a, o.a) && same(x.b, o.b);
    }
    case 'unop': {
      const o = y as typeof x;
      return same(x.a, o.a);
    }
    case 'member': {
      const o = y as typeof x;
      return x.field === o.field && same(x.base, o.base);
    }
    case 'index': {
      const o = y as typeof x;
      return same(x.base, o.base) && same(x.idx, o.idx);
    }
    case 'call':
    case 'construct': {
      const o = y as typeof x;
      if (x.op === 'call' && x.fn !== (o as typeof x).fn) return false;
      return x.args.length === o.args.length && x.args.every((p, k) => same(p, o.args[k]!));
    }
    default:
      return false;
  }
}

const allSame = (xs: readonly Expr[]): boolean => xs.every((x) => sameExpr(x, xs[0]!));

function forChildren(e: Expr, f: (c: Expr) => void): void {
  switch (e.op) {
    case 'binop':
    case 'compare':
    case 'logical':
      f(e.a);
      f(e.b);
      break;
    case 'unop':
      f(e.a);
      break;
    case 'call':
    case 'construct':
      e.args.forEach(f);
      break;
    case 'member':
      f(e.base);
      break;
    case 'index':
      f(e.base);
      f(e.idx);
      break;
    case 'select':
      f(e.cond);
      f(e.ifTrue);
      f(e.ifFalse);
      break;
    case 'matchExpr':
      f(e.scrutinee);
      for (const [, v] of e.cases) f(v);
      f(e.default);
      break;
    default:
      break;
  }
}

// ─── statements ──────────────────────────────────────────────────────────────────────────────

/** Visit every statement in `body`, nested ones included, in order. */
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

/** The expressions a statement holds itself, not its nested statements'. */
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
