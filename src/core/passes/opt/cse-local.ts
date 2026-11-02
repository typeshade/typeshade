// ═══ Shader DSL — statement-local common-subexpression elimination ═══
//
// The fn-top `cse` pass only hoists INPUT-ONLY repeats — it places the temp at the
// fn top, where function locals are not yet in scope, so it MUST exclude any expr that
// reads a local/var. That leaves the most common redundancy uncaught: a subexpression
// that touches a local/var but repeats WITHIN A SINGLE STATEMENT. Examples the authors
// had to hand-`Let`:
//   • `apply_log_depth(clip, fc).x/.y/.z/.w`  — 4× in one `return`; `clip` is a var
//   • a raymarch `normalize(p)` across 3 lighting dot-products in one assignment
//   • a per-iteration `hash(cell + g)` — the loop counters are vars
//
// SAFE because nothing mutates DURING a single statement's expression evaluation
// (assignments are statements, never expressions). So a subexpr that repeats within one
// statement holds the SAME value at every occurrence; binding it to a `let` inserted
// immediately BEFORE that statement (in the same block) preserves both the value and
// every dependency — nothing runs between the new let and the statement. Done per block
// and per NESTED block (if-arms / loop body), so a loop-body repeat is bound once per
// iteration (the let lands inside the loop).
//
// CONSERVATISM: a candidate is hoisted only if EVERY occurrence is UNCONDITIONALLY
// evaluated — never under a `&&`/`||` short-circuit RHS, a `select` branch, or a
// `matchExpr` arm — so the pass never lifts a guarded computation out of its guard.
// Only the value side of let/var/assign/return is rewritten (control-flow conditions
// and loop heads are left alone: a for-cond repeat would mis-bind once, not per-iter).
//
// A GUARDED REPEAT (#868). A repeat inside the right operand of a `&&` / `||` that is
// itself evaluated unconditionally is still refused above. When that operand repeats a
// value, the statement is split so the operand gets a statement of its own:
//
//   return ok && f(d.x) <= f(d.y)        // d = r.pixel - b, written twice in the operand
//   ->
//   var _sc0: bool = ok;
//   if (_sc0) { _sc0 = f(d.x) <= f(d.y); }   // the repeat is bound in here, once
//   return _sc0;
//
// (`||` tests `_sc0 == false`.) The operand still runs only when the authored code ran it,
// once, and the left operand still runs first. Nothing else of the statement runs before
// the split moves the operator ahead of it: the statement has no effect (checked above),
// so the order of its other pure operands is unobservable. The `if` is the control flow
// the short circuit already is, so uniformity does not change. A split is made only when
// it lets a repeat be bound; any other `&&` stays an expression.
//
// Bit-exact (pure dedup — no float arithmetic is changed), so no f32 differential gate
// is needed; pinned by oracle value-equality like the sibling fn-top `cse`.

import type { Expr, Stmt, ModuleDecl, FuncDecl } from '../../ir/index.js';
import {
  keyOf,
  isCompound,
  eachExpr,
  mapChildren,
  bodyHasRaw,
  collectLocals,
  collectMutatedRoots,
  refsLocal,
  isWorthHoisting,
  mapStmtValue,
} from './expr-utils.js';
import { exprHasEffect, fnReads, fnWrites, type FnReads, type FnWrites } from '../effects.js';

interface Tally {
  counts: Map<string, number>;
  condKeys: Set<string>; // keys with ≥1 conditionally-evaluated occurrence
  exemplar: Map<string, Expr>;
}

// Walk `e`, tallying compound + worth-hoisting + LOCAL-touching subexprs, propagating a
// `cond` flag through short-circuit / branch operands so guarded repeats are excluded.
function tally(
  e: Expr,
  cond: boolean,
  localSet: ReadonlySet<string>,
  t: Tally,
  loadRoots: ReadonlySet<string>,
  reads: FnReads,
): void {
  if (isCompound(e) && isWorthHoisting(e, loadRoots) && refsLocal(e, localSet, reads)) {
    const k = keyOf(e);
    t.counts.set(k, (t.counts.get(k) ?? 0) + 1);
    if (cond) t.condKeys.add(k);
    if (!t.exemplar.has(k)) t.exemplar.set(k, e);
  }
  switch (e.op) {
    case 'logical':
      tally(e.a, cond, localSet, t, loadRoots, reads);
      tally(e.b, true, localSet, t, loadRoots, reads);
      break; // RHS short-circuits
    case 'select':
      tally(e.cond, cond, localSet, t, loadRoots, reads);
      tally(e.ifTrue, true, localSet, t, loadRoots, reads);
      tally(e.ifFalse, true, localSet, t, loadRoots, reads);
      break;
    case 'matchExpr':
      tally(e.scrutinee, cond, localSet, t, loadRoots, reads);
      for (const [, v] of e.cases) tally(v, true, localSet, t, loadRoots, reads);
      tally(e.default, true, localSet, t, loadRoots, reads);
      break;
    case 'binop':
    case 'compare':
      tally(e.a, cond, localSet, t, loadRoots, reads);
      tally(e.b, cond, localSet, t, loadRoots, reads);
      break;
    case 'unop':
      tally(e.a, cond, localSet, t, loadRoots, reads);
      break;
    case 'call':
    case 'construct':
      for (const a of e.args) tally(a, cond, localSet, t, loadRoots, reads);
      break;
    case 'member':
      tally(e.base, cond, localSet, t, loadRoots, reads);
      break;
    case 'index':
      tally(e.base, cond, localSet, t, loadRoots, reads);
      tally(e.idx, cond, localSet, t, loadRoots, reads);
      break;
    default:
      break; // leaf
  }
}

// The exprs of a statement that are evaluated UNCONDITIONALLY, i.e. the ones a temp
// may be hoisted ahead of. NOT the lvalue target.
//
// An `if`'s FIRST arm condition is one of them (X-GIS #1886). It runs whenever the statement
// runs, exactly like a `let` initialiser, so a `let` placed before the `if` costs
// nothing — and `processBody` already splices this pass's temps in ahead of the
// statement they came from, so the placement needs no new machinery. It used to be
// absent: `default: []` covered every control-flow statement and only the nested
// BODIES were recursed. Measured on the baked corpus after gvn got the same fix, the
// leftovers are almost all here — 119 within-statement repeats inside control-flow
// headers against 4 inside plain statements.
//
// Still absent, each because the expr is not evaluated once per execution:
//   • `arms[1..]` — an `else if` runs only when every earlier arm failed, the same
//     reason `tally` already refuses a `&&`/`||` RHS and a `select` branch;
//   • `for` cond — re-evaluated per iteration, so lifting it is loop invariance (licm);
//   • `switch` scrut — unconditional and sound to add, but 26 headers in the whole
//     production corpus against 2363 `if`s, so it waits for a measurement of its own.
function valueExprs(s: Stmt): readonly Expr[] {
  switch (s.s) {
    case 'let':
      return [s.expr];
    case 'var':
      return s.init !== undefined ? [s.init] : [];
    case 'assign':
    case 'assignOp':
      return [s.expr]; // NOT the lvalue target
    case 'return':
      return s.expr !== undefined ? [s.expr] : [];
    case 'if':
      return s.arms.length > 0 ? [s.arms[0]!.cond] : [];
    default:
      return [];
  }
}

/** Keys of `e` that repeat when `e` is evaluated unconditionally (the hoistable repeats). */
function unconditionalRepeats(
  e: Expr,
  localSet: ReadonlySet<string>,
  loadRoots: ReadonlySet<string>,
  reads: FnReads,
): boolean {
  const t: Tally = { counts: new Map(), condKeys: new Set(), exemplar: new Map() };
  tally(e, false, localSet, t, loadRoots, reads);
  return [...t.counts].some(([k, n]) => n >= 2 && !t.condKeys.has(k));
}

/** The first `&&` / `||` that `e` evaluates unconditionally and whose right operand holds a
 *  repeat this pass could bind, outermost first; undefined when there is none. */
function guardedSplitSite(
  e: Expr,
  localSet: ReadonlySet<string>,
  loadRoots: ReadonlySet<string>,
  reads: FnReads,
): Extract<Expr, { op: 'logical' }> | undefined {
  switch (e.op) {
    case 'logical':
      if (unconditionalRepeats(e.b, localSet, loadRoots, reads)) return e;
      return guardedSplitSite(e.a, localSet, loadRoots, reads); // the RHS is conditional
    case 'select':
      return guardedSplitSite(e.cond, localSet, loadRoots, reads);
    case 'matchExpr':
      return guardedSplitSite(e.scrutinee, localSet, loadRoots, reads);
    case 'binop':
    case 'compare':
      return (
        guardedSplitSite(e.a, localSet, loadRoots, reads) ??
        guardedSplitSite(e.b, localSet, loadRoots, reads)
      );
    case 'unop':
      return guardedSplitSite(e.a, localSet, loadRoots, reads);
    case 'call':
    case 'construct':
      for (const a of e.args) {
        const hit = guardedSplitSite(a, localSet, loadRoots, reads);
        if (hit !== undefined) return hit;
      }
      return undefined;
    case 'member':
      return guardedSplitSite(e.base, localSet, loadRoots, reads);
    case 'index':
      return (
        guardedSplitSite(e.base, localSet, loadRoots, reads) ??
        guardedSplitSite(e.idx, localSet, loadRoots, reads)
      );
    default:
      return undefined;
  }
}

// Hoist within-statement repeats of `s` → { the new `let` temps, the rewritten s }.
function hoistInStatement(
  s: Stmt,
  localSet: ReadonlySet<string>,
  next: { n: number },
  loadRoots: ReadonlySet<string>,
  reads: FnReads,
  writes: FnWrites,
): { lets: Stmt[]; stmt: Stmt } {
  const exprs = valueExprs(s);
  if (exprs.length === 0) return { lets: [], stmt: s };
  // A statement whose own expressions call something that writes (or synchronises) is left
  // as it is: deduping such a call would change how many times it writes (issue #47), and a
  // repeat around it may read what it writes. Every other statement still evaluates with
  // nothing changing under it, which is all this pass needs, whatever the rest of the
  // function calls. Before, one such call anywhere in the function turned the pass off for
  // the whole function, so `b.bump(1.); return vec4f(b.sum());` spelled the call four times.
  if (exprs.some((e) => exprHasEffect(e, writes))) return { lets: [], stmt: s };

  // A guarded repeat: split the short circuit into a statement of its own (#868).
  for (const e of exprs) {
    const site = guardedSplitSite(e, localSet, loadRoots, reads);
    if (site === undefined) continue;
    const name = `_sc${next.n++}`;
    const ref: Expr = { op: 'varref', type: site.type, name };
    const cond: Expr =
      site.lop === '&&'
        ? ref
        : {
            op: 'compare',
            type: site.type,
            cop: '==',
            a: ref,
            b: { op: 'lit', type: site.type, value: false },
          };
    const arm = processBody(
      [{ s: 'assign', target: ref, expr: site.b }],
      localSet,
      next,
      loadRoots,
      reads,
      writes,
    );
    const split: Stmt[] = [
      { s: 'var', name, type: site.type, init: site.a },
      { s: 'if', arms: [{ cond, body: arm }] },
    ];
    const replace = (x: Expr): Expr => (x === site ? ref : mapChildren(x, replace));
    const rest = hoistInStatement(
      mapStmtValue(s, replace),
      localSet,
      next,
      loadRoots,
      reads,
      writes,
    );
    return { lets: [...split, ...rest.lets], stmt: rest.stmt };
  }

  const t: Tally = { counts: new Map(), condKeys: new Set(), exemplar: new Map() };
  for (const e of exprs) tally(e, false, localSet, t, loadRoots, reads);

  const repeated = [...t.counts].filter(([k, n]) => n >= 2 && !t.condKeys.has(k)).map(([k]) => k);
  if (repeated.length === 0) return { lets: [], stmt: s };

  // Keep only the MAXIMAL repeats (outermost): hoisting `normalize(p)` subsumes its inner
  // `p`, so a single temp covers the whole shared value (mirrors cse.ts).
  const repSet = new Set(repeated);
  const nested = new Set<string>();
  for (const k of repeated) {
    eachExpr(t.exemplar.get(k)!, (sub) => {
      if (sub === t.exemplar.get(k)) return;
      const sk = keyOf(sub);
      if (repSet.has(sk)) nested.add(sk);
    });
  }
  const maximal = repeated.filter((k) => !nested.has(k));
  if (maximal.length === 0) return { lets: [], stmt: s };

  const temp = new Map<string, string>();
  const lets: Stmt[] = [];
  for (const k of maximal) {
    const name = `_lc${next.n++}`;
    temp.set(k, name);
    lets.push({ s: 'let', name, expr: t.exemplar.get(k)! });
  }
  const replace = (e: Expr): Expr => {
    const nm = temp.get(keyOf(e));
    if (nm !== undefined) return { op: 'varref', type: e.type, name: nm };
    return mapChildren(e, replace);
  };
  return { lets, stmt: mapStmtValue(s, replace) };
}

// Process a statement list: recurse into nested blocks FIRST (so inner statements get
// their own local-cse), then hoist within each statement, splicing the temps in ahead.
function processBody(
  body: readonly Stmt[],
  localSet: ReadonlySet<string>,
  next: { n: number },
  loadRoots: ReadonlySet<string>,
  reads: FnReads,
  writes: FnWrites,
): Stmt[] {
  const out: Stmt[] = [];
  for (const s of body) {
    const rec = recurseBlocks(s, localSet, next, loadRoots, reads, writes);
    const { lets, stmt } = hoistInStatement(rec, localSet, next, loadRoots, reads, writes);
    out.push(...lets, stmt);
  }
  return out;
}

// Rebuild a control-flow statement with its nested bodies processed; simple statements
// pass through (their own exprs are handled by hoistInStatement).
function recurseBlocks(
  s: Stmt,
  localSet: ReadonlySet<string>,
  next: { n: number },
  loadRoots: ReadonlySet<string>,
  reads: FnReads,
  writes: FnWrites,
): Stmt {
  switch (s.s) {
    case 'if':
      return {
        ...s,
        arms: s.arms.map((a) => ({
          cond: a.cond,
          body: processBody(a.body, localSet, next, loadRoots, reads, writes),
        })),
        elseBody: s.elseBody
          ? processBody(s.elseBody, localSet, next, loadRoots, reads, writes)
          : undefined,
      };
    case 'for':
      return { ...s, body: processBody(s.body, localSet, next, loadRoots, reads, writes) };
    case 'switch':
      return {
        ...s,
        cases: s.cases.map((c) => ({
          values: c.values,
          body: processBody(c.body, localSet, next, loadRoots, reads, writes),
        })),
        defaultBody: s.defaultBody
          ? processBody(s.defaultBody, localSet, next, loadRoots, reads, writes)
          : undefined,
      };
    default:
      return s;
  }
}

function cseLocalFn(
  f: FuncDecl,
  loadRoots: ReadonlySet<string>,
  writes: FnWrites,
  reads: FnReads,
): FuncDecl {
  if (bodyHasRaw(f.body)) return f; // raw WGSL is opaque
  // A call that writes a binding is not a repeat to hoist (issue #47): hoistInStatement
  // leaves each statement that holds one as it is.
  // "local" = every binding name AND every mutated root — exactly the set the fn-top cse
  // refuses to hoist. Targeting these makes this pass the complement of that one; `reads`
  // keeps it so for a call whose callee reads a mutated module name, which cse now refuses.
  const localSet = new Set<string>();
  collectLocals(f.body, localSet);
  collectMutatedRoots(f.body, localSet, writes);
  // Seed the temp counter past any existing `_lcN` so a second fixpoint pass cannot
  // redeclare `_lc0` (cse-local runs repeatedly inside fixpoint).
  let base = 0;
  for (const n of localSet) {
    const mm = /^_(?:lc|sc)(\d+)$/.exec(n);
    if (mm) base = Math.max(base, Number(mm[1]) + 1);
  }
  const next = { n: base };
  return { ...f, body: processBody(f.body, localSet, next, loadRoots, reads, writes) };
}

/** Hoist statement-local repeated subexpressions to a `let` before their statement.
 *  Pure (module → module); complements the fn-top `cse`. */
export function cseLocal(m: ModuleDecl): ModuleDecl {
  // Indexing one of these is a memory load, not free addressing (X-GIS #1886).
  const loadRoots = new Set(m.bindings.map((b) => b.name));
  const writes = fnWrites(m);
  const reads = fnReads(m);
  return { ...m, funcs: m.funcs.map((f) => cseLocalFn(f, loadRoots, writes, reads)) };
}
