// ═══ Shader DSL — loop-invariant code motion (Optimization context) ═══
//
// A compound expression computed inside a loop body that depends ONLY on fn
// inputs (params / consts / bindings — no local, so it cannot change across
// iterations) is recomputed every iteration for nothing. Hoist it to a single
// `let` at the fn top (input-only ⇒ valid there) and replace each occurrence.
//
// MAXIMAL: gathers the largest input-only subexpression (if the whole expr is
// invariant, hoist it whole rather than its parts) — so hoisted exprs never nest.
// A fn containing a raw Stmt is skipped (raw WGSL is opaque). Correctness is
// pinned by oracle value-equality.
// A second, scoped step also accepts local inputs that are in scope immediately
// before a provably entered loop; see hoistLocalInputs for its narrower safety rules.

import type { Expr, Stmt, ModuleDecl, FuncDecl } from '../../ir/index.js';
import { mapStmtExpr } from '../../ir/visit.js';
import {
  bodyHasEffectfulCall,
  fnReads,
  fnWrites,
  type FnReads,
  type FnWrites,
} from '../effects.js';
import {
  keyOf,
  isCompound,
  refsLocal,
  mapChildren,
  bodyHasRaw,
  collectLocals,
  collectMutatedRoots,
  isWorthHoisting,
} from './expr-utils.js';

type ForStmt = Extract<Stmt, { s: 'for' }>;

/** A deliberately small proof that the body executes at least once. In particular,
 *  do not speculate local-dependent expressions across a zero-trip/dynamic loop. */
function entersLoop(s: ForStmt): boolean {
  const { init, cond } = s;
  if (init.s !== 'var' || init.init?.op !== 'lit') return false;
  if (init.type.kind !== 'scalar' || !['i32', 'u32'].includes(init.type.scalar)) return false;
  if (
    cond.op !== 'compare' ||
    cond.cop !== '<' ||
    cond.a.op !== 'varref' ||
    cond.a.name !== init.name ||
    cond.b.op !== 'lit'
  )
    return false;
  const start = init.init.value;
  const end = cond.b.value;
  const min = init.type.scalar === 'u32' ? 0 : -2147483648;
  const max = init.type.scalar === 'u32' ? 4294967295 : 2147483647;
  return (
    typeof start === 'number' &&
    typeof end === 'number' &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= min &&
    end <= max &&
    start < end
  );
}

/** Local inputs are available at a loop's preheader, even though they were not at
 *  the function top. Move only computations in the body's straight-line declaration
 *  prefix: a branch, store, break or return ends the prefix. Conditional expression
 *  operands keep their guards. All declarations and mutations anywhere in the loop
 *  (including nested scopes, update and hidden callee reads) exclude a dependency.
 *  The caller has already ruled out raw code and effectful/synchronising calls. */
function hoistLocalInputs(f: FuncDecl, writes: FnWrites, reads: FnReads): FuncDecl {
  const locals = new Set<string>();
  collectLocals(f.body, locals);
  let n = 0;
  let changed = false;
  for (const name of locals) {
    const match = /^_licm(\d+)$/.exec(name);
    if (match) n = Math.max(n, Number(match[1]) + 1);
  }
  const block = (body: readonly Stmt[], outer: ReadonlySet<string>): Stmt[] => {
    const visible = new Set(outer);
    const result: Stmt[] = [];
    for (let s of body) {
      if (s.s === 'for') {
        const inside = new Set(visible);
        if (s.init.s === 'var' || s.init.s === 'let') inside.add(s.init.name);
        s = { ...s, body: block(s.body, inside) };
        if (entersLoop(s)) {
          const excluded = new Set([...locals].filter((name) => !visible.has(name)));
          collectLocals([s], excluded);
          collectMutatedRoots([s], excluded, writes);
          const temps = new Map<string, string>();
          const replace = (e: Expr): Expr => {
            if (
              isCompound(e) &&
              isWorthHoisting(e) &&
              refsLocal(e, visible, reads) &&
              !refsLocal(e, excluded, reads)
            ) {
              const key = keyOf(e);
              let name = temps.get(key);
              if (name === undefined) {
                name = `_licm${n++}`;
                temps.set(key, name);
                locals.add(name);
                changed = true;
                result.push({ s: 'let', name, expr: e });
              }
              return { op: 'varref', type: e.type, name };
            }
            // These subexpressions may not run. Move a whole guarded expression
            // when invariant, but never extract a conditional operand on its own.
            if (e.op === 'logical') return { ...e, a: replace(e.a) };
            if (e.op === 'select') return { ...e, cond: replace(e.cond) };
            if (e.op === 'matchExpr') return { ...e, scrutinee: replace(e.scrutinee) };
            return mapChildren(e, replace);
          };
          let prefix = true;
          s = {
            ...s,
            body: s.body.map((stmt) => {
              if (!prefix) return stmt;
              if (stmt.s === 'let') return { ...stmt, expr: replace(stmt.expr) };
              if (stmt.s === 'var')
                return stmt.init === undefined ? stmt : { ...stmt, init: replace(stmt.init) };
              prefix = false;
              return stmt;
            }),
          };
        }
      } else if (s.s === 'if') {
        s = {
          ...s,
          arms: s.arms.map((a) => ({ ...a, body: block(a.body, visible) })),
          ...(s.elseBody ? { elseBody: block(s.elseBody, visible) } : {}),
        };
      } else if (s.s === 'switch') {
        s = {
          ...s,
          cases: s.cases.map((c) => ({ ...c, body: block(c.body, visible) })),
          ...(s.defaultBody ? { defaultBody: block(s.defaultBody, visible) } : {}),
        };
      }
      result.push(s);
      if (s.s === 'let' || s.s === 'var') visible.add(s.name);
    }
    return result;
  };
  const body = block(f.body, new Set());
  return changed ? { ...f, body } : f;
}

/** Collect the MAXIMAL input-only compound subexpressions of `e` into `out`. A call to a
 *  helper that reads a name the function writes is not input-only (`reads`): `h(x)` where `h`
 *  reads `gp` changes across iterations of a loop that writes `gp`, and hoisting it did. */
function gatherExpr(
  e: Expr,
  locals: ReadonlySet<string>,
  out: Map<string, Expr>,
  reads: FnReads,
): void {
  if (isCompound(e) && !refsLocal(e, locals, reads)) {
    out.set(keyOf(e), e);
    return;
  }
  switch (e.op) {
    case 'binop':
    case 'compare':
    case 'logical':
      gatherExpr(e.a, locals, out, reads);
      gatherExpr(e.b, locals, out, reads);
      break;
    case 'unop':
      gatherExpr(e.a, locals, out, reads);
      break;
    case 'call':
    case 'construct':
      for (const a of e.args) gatherExpr(a, locals, out, reads);
      break;
    case 'member':
      gatherExpr(e.base, locals, out, reads);
      break;
    case 'index':
      gatherExpr(e.base, locals, out, reads);
      gatherExpr(e.idx, locals, out, reads);
      break;
    case 'select':
      gatherExpr(e.cond, locals, out, reads);
      gatherExpr(e.ifTrue, locals, out, reads);
      gatherExpr(e.ifFalse, locals, out, reads);
      break;
    case 'matchExpr':
      gatherExpr(e.scrutinee, locals, out, reads);
      for (const [, v] of e.cases) gatherExpr(v, locals, out, reads);
      gatherExpr(e.default, locals, out, reads);
      break;
    default:
      break; // lit / constref / param / varref
  }
}

/** Walk stmts gathering invariants only from exprs that execute inside a loop. */
function gatherStmt(
  s: Stmt,
  inLoop: boolean,
  locals: ReadonlySet<string>,
  out: Map<string, Expr>,
  reads: FnReads,
): void {
  const ge = (e: Expr): void => {
    if (inLoop) gatherExpr(e, locals, out, reads);
  };
  switch (s.s) {
    case 'let':
      ge(s.expr);
      break;
    case 'var':
      if (s.init !== undefined) ge(s.init);
      break;
    case 'assign':
    case 'assignOp':
      ge(s.target);
      ge(s.expr);
      break;
    case 'return':
      if (s.expr !== undefined) ge(s.expr);
      break;
    case 'call':
      ge(s.expr);
      break;
    case 'if':
      for (const a of s.arms) {
        ge(a.cond);
        for (const b of a.body) gatherStmt(b, inLoop, locals, out, reads);
      }
      if (s.elseBody) for (const b of s.elseBody) gatherStmt(b, inLoop, locals, out, reads);
      break;
    case 'for':
      gatherExpr(s.cond, locals, out, reads); // the loop cond runs every iteration
      gatherStmt(s.init, inLoop, locals, out, reads); // init runs once
      gatherStmt(s.update, true, locals, out, reads);
      for (const b of s.body) gatherStmt(b, true, locals, out, reads);
      break;
    case 'switch':
      ge(s.scrut);
      for (const c of s.cases) for (const b of c.body) gatherStmt(b, inLoop, locals, out, reads);
      if (s.defaultBody) for (const b of s.defaultBody) gatherStmt(b, inLoop, locals, out, reads);
      break;
    default:
      break;
  }
}

function licmFn(f: FuncDecl, writes: FnWrites, reads: FnReads): FuncDecl {
  if (bodyHasRaw(f.body)) return f;
  // A call that writes a binding is not invariant, however constant its arguments: hoisting
  // it out of the loop would write once where the loop wrote every iteration (issue #47).
  if (bodyHasEffectfulCall(f.body, writes)) return f;
  // Non-invariant names: function locals AND any mutated name (incl. a read_write
  // binding written anywhere in the fn). A read of a mutated name is not loop-invariant.
  const noHoist = new Set<string>();
  collectLocals(f.body, noHoist);
  collectMutatedRoots(f.body, noHoist);

  const invariants = new Map<string, Expr>();
  for (const s of f.body) gatherStmt(s, false, noHoist, invariants, reads);
  if (invariants.size === 0) return hoistLocalInputs(f, writes, reads);

  const temp = new Map<string, string>();
  const lets: Stmt[] = [];
  // Seed past any existing `_licmN` (X-GIS #763 P2) — the fixpoint re-runs passes, and
  // a const/copy-prop round can expose a NEW hoistable compound after a first
  // hoist already emitted `_licm0`; a reset counter would redeclare it (backend
  // compile error — nothing re-validates post-optimize). Same seeding as cse/gvn.
  let n = 0;
  for (const existing of noHoist) {
    const mm = /^_licm(\d+)$/.exec(existing);
    if (mm) n = Math.max(n, Number(mm[1]) + 1);
  }
  for (const [k, e] of invariants) {
    const name = `_licm${n++}`;
    temp.set(k, name);
    lets.push({ s: 'let', name, expr: e });
  }

  const replace = (e: Expr): Expr => {
    const t = temp.get(keyOf(e));
    if (t !== undefined) return { op: 'varref', type: e.type, name: t };
    return mapChildren(e, replace);
  };
  const newBody = f.body.map((s) => mapStmtExpr(s, replace));
  return hoistLocalInputs({ ...f, body: [...lets, ...newBody] }, writes, reads);
}

/** Hoist loop-invariant input-only and scoped local-input expressions. Pure (module -> module). */
export function licm(m: ModuleDecl): ModuleDecl {
  const writes = fnWrites(m);
  const reads = fnReads(m);
  return { ...m, funcs: m.funcs.map((f) => licmFn(f, writes, reads)) };
}
