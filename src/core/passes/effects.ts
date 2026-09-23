// ═══ Shader DSL — which functions have an effect (Optimization context) ═══
//
// The optimizer's premise is that expressions are pure: CSE, GVN and LICM dedupe and hoist
// them, DCE drops an unread binding. A `call` statement exists precisely because a call can
// have an effect (a storage write inside the callee today; a barrier, `textureStore` or an
// atomic later), so the passes need one answer to "does this call do anything besides
// produce a value?". This file is that answer, computed once per module and cached on it.
//
// An effect is a write to a name the function does not own: a module binding (a
// `read_write` storage array) reached through an `assign`/`assignOp` whose target root is
// neither a param nor a local. It propagates through the call graph to a fixpoint, so a
// function that only calls a writer is a writer too. Intrinsics with an effect are listed
// in `EFFECTFUL_INTRINSICS`: the atomic builtins today (roadmap 0.2 item 4); barriers and
// `textureStore` add their names on the commit that makes them authorable.

import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/index.js';
import { eachExpr, eachStmtExpr } from '../ir/visit.js';
import { ATOMIC_INTRINSICS, BARRIER_INTRINSICS, isAtomicIntrinsic } from '../intrinsics.js';
import { collectLocals } from './opt/expr-utils.js';

/** Intrinsic ids whose call has an effect beyond its value: the atomic builtins, `atomicLoad`
 *  included, since two loads must not be shared across a store to the same location; the two
 *  barriers, which order every read and write around them and must never be dropped, merged or
 *  moved; and `textureStore`, which writes a texel and returns nothing, so an optimizer that
 *  treated it as a pure call would drop every one of them (roadmap 0.4 item 10). */
export const EFFECTFUL_INTRINSICS: ReadonlySet<string> = new Set<string>([
  ...Object.keys(ATOMIC_INTRINSICS),
  ...BARRIER_INTRINSICS,
  'textureStore',
]);

/** The module-level names each function writes, itself or through the functions it calls. */
export type FnWrites = ReadonlyMap<string, ReadonlySet<string>>;

const memo = new WeakMap<ModuleDecl, FnWrites>();

/** The parameters of every function a table was computed over, keyed by the table itself, so a
 *  per-function view that inherits the table ({@link inheritEffects}) can still translate a
 *  callee's write through one of its own `inout` parameters into the argument passed there.
 *  The view holds one function; the table, and so this, describes them all. */
const paramsOf = new WeakMap<FnWrites, ReadonlyMap<string, FuncDecl['params']>>();

const targetRoot = (e: Expr): Expr =>
  e.op === 'index' || e.op === 'member' ? targetRoot(e.base) : e;

/** The name an atomic builtin call writes: the root of its location argument, for every
 *  atomic but `atomicLoad`. Also the storage texture a `textureStore` writes, which is the same
 *  shape — the binding is the call's first argument (roadmap 0.4 item 10). `undefined` for any
 *  other expression, and for a call that resolved to a function the module declares under one
 *  of those names. */
export function atomicWriteRoot(x: Expr): string | undefined {
  if (x.op !== 'call' || x.declRef !== undefined) return undefined;
  if (x.fn === 'textureStore') {
    const target = x.args[0];
    if (target === undefined) return undefined;
    const root = targetRoot(target);
    return root.op === 'varref' || root.op === 'param' ? root.name : undefined;
  }
  if (!isAtomicIntrinsic(x.fn)) return undefined;
  if (x.fn === 'atomicLoad' || x.args[0] === undefined) return undefined;
  const root = targetRoot(x.args[0]);
  return root.op === 'varref' || root.op === 'param' ? root.name : undefined;
}

function directWrites(f: FuncDecl, out: Set<string>): void {
  // A parameter the callee writes THROUGH (`mode: 'inout'`) is not owned: the write lands in
  // the caller's own value, which is the whole point of it. Writing to any other parameter is
  // local and invisible outside. Before `inout` existed every parameter was owned, and a
  // method that changed its object took it by value and returned it, so this list was complete.
  const owned = new Set<string>(f.params.filter((p) => p.mode !== 'inout').map((p) => p.name));
  collectLocals(f.body, owned);
  const walk = (body: readonly Stmt[]): void => {
    for (const s of body) {
      // An atomic store or read-modify-write anywhere in the statement's own expressions
      // writes the binding at its location's root, the way an `assign` to it would.
      eachStmtExpr(
        s,
        (e) => {
          eachExpr(e, (x) => {
            const root = atomicWriteRoot(x);
            if (root !== undefined && !owned.has(root)) out.add(root);
          });
        },
        () => {},
      );
      if (s.s === 'assign' || s.s === 'assignOp') {
        const root = targetRoot(s.target);
        if ((root.op === 'varref' || root.op === 'param') && !owned.has(root.name))
          out.add(root.name);
      } else if (s.s === 'if') {
        for (const a of s.arms) walk(a.body);
        if (s.elseBody) walk(s.elseBody);
      } else if (s.s === 'for') {
        walk([s.init, s.update]);
        walk(s.body);
      } else if (s.s === 'switch') {
        for (const c of s.cases) walk(c.body);
        if (s.defaultBody) walk(s.defaultBody);
      }
    }
  };
  walk(f.body);
}

/** What one call adds to its CALLER's write set, given what the callee writes.
 *
 *  A name the callee writes that is one of its own `inout` parameters means nothing to the
 *  caller — `self_` is the callee's word for it — so it is translated into the root of the
 *  argument passed there: `ps[gid.x].tick(dt)` writes `ps`, because `tick` writes its receiver
 *  and the receiver is reached through `ps`. Every other name the callee writes is a module
 *  name already, and passes through as it is.
 *
 *  A translated name the caller owns (its own local) is dropped from what the caller writes,
 *  because a write to a local is invisible outside it. The CALL still has an effect — the
 *  callee's own write set is non-empty, which is what {@link exprHasEffect} reads — so the
 *  statement is never dropped. */
function inheritedWrites(
  call: Expr & { op: 'call' },
  callee: FuncDecl,
  calleeWrites: ReadonlySet<string>,
  ownedByCaller: ReadonlySet<string>,
  out: Set<string>,
): void {
  const throughParam = new Map<string, string | undefined>();
  for (const [i, p] of callee.params.entries()) {
    if (p.mode !== 'inout') continue;
    const arg = call.args[i];
    const root = arg === undefined ? undefined : targetRoot(arg);
    throughParam.set(
      p.name,
      root !== undefined && (root.op === 'varref' || root.op === 'param') ? root.name : undefined,
    );
  }
  for (const name of calleeWrites) {
    if (!throughParam.has(name)) {
      out.add(name);
      continue;
    }
    const here = throughParam.get(name);
    if (here !== undefined && !ownedByCaller.has(here)) out.add(here);
  }
}

function calleesOf(f: FuncDecl, declared: ReadonlySet<string>, out: Set<string>): void {
  for (const s of f.body) {
    eachStmtExpr(s, (e) => {
      eachExpr(e, (x) => {
        if (x.op === 'call' && (x.declRef !== undefined || declared.has(x.fn))) out.add(x.fn);
      });
    });
  }
}

/** Hand `to` the effect table already computed for `from`, when `to` is a view of the same
 *  module: the fixpoint optimizes each function in a module holding that function alone, and
 *  every pass returns a new module object, so without this a pass would see a table computed
 *  from one function and take every call to a helper for a pure one. A stale table is only
 *  ever an over-approximation (no pass adds a binding write to a function that had none), so
 *  carrying it forward is safe. */
export function inheritEffects(from: ModuleDecl, to: ModuleDecl): void {
  if (to === from || memo.has(to)) return;
  const table = memo.get(from);
  if (table !== undefined) memo.set(to, table);
}

/** The names each function of `m` writes, transitively. Cached per module object; the IR is
 *  immutable, so a pass that rewrites builds a new module and gets a fresh answer, unless
 *  {@link inheritEffects} handed it the table of the module it is a view of. */
export function fnWrites(m: ModuleDecl): FnWrites {
  const hit = memo.get(m);
  if (hit !== undefined) return hit;
  const declared = new Set(m.funcs.map((f) => f.name));
  const writes = new Map<string, Set<string>>();
  const callees = new Map<string, Set<string>>();
  const byName = new Map(m.funcs.map((f) => [f.name, f]));
  for (const f of m.funcs) {
    const w = new Set<string>();
    directWrites(f, w);
    writes.set(f.name, w);
    const c = new Set<string>();
    calleesOf(f, declared, c);
    callees.set(f.name, c);
  }
  // What each function owns, for translating a callee's parameter writes below.
  const owned = new Map<string, Set<string>>();
  for (const f of m.funcs) {
    const o = new Set<string>(f.params.filter((p) => p.mode !== 'inout').map((p) => p.name));
    collectLocals(f.body, o);
    owned.set(f.name, o);
  }
  // Fixpoint over the call graph: a function inherits what its callees write, with a name a
  // callee writes through one of its own `inout` parameters translated into the argument this
  // caller passed there.
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of m.funcs) {
      const w = writes.get(f.name)!;
      const before = w.size;
      for (const s of f.body) {
        eachStmtExpr(s, (e) => {
          eachExpr(e, (x) => {
            if (x.op !== 'call') return;
            const callee = byName.get(x.fn);
            if (callee === undefined) return;
            inheritedWrites(x, callee, writes.get(x.fn) ?? new Set(), owned.get(f.name)!, w);
          });
        });
      }
      // A call inside a nested block reaches the walk above through `eachStmtExpr`'s own
      // recursion into the statement's expressions only, so the plain-name inheritance below
      // keeps a callee's MODULE writes flowing through a branch or a loop.
      for (const callee of callees.get(f.name)!) {
        const decl = byName.get(callee);
        const through = new Set(
          (decl?.params ?? []).filter((p) => p.mode === 'inout').map((p) => p.name),
        );
        for (const name of writes.get(callee) ?? []) {
          if (!through.has(name)) w.add(name);
        }
      }
      if (w.size !== before) changed = true;
    }
  }
  memo.set(m, writes);
  paramsOf.set(writes, new Map(m.funcs.map((f) => [f.name, f.params])));
  return writes;
}

/** The names one call writes, in its CALLER's words: what the callee writes of the module, the
 *  root of each argument it writes through (`Random_gen(&rng)` writes `rng`, since the callee's
 *  `self_` is that argument), and the location an atomic or `textureStore` writes. Empty for a
 *  call that writes nothing, `atomicLoad` included, which reads. The callee's own word for an
 *  `inout` parameter means nothing where the call stands and is never returned. */
export function callWrites(x: Expr & { op: 'call' }, writes: FnWrites): ReadonlySet<string> {
  const out = new Set<string>();
  const params = paramsOf.get(writes)?.get(x.fn);
  for (const name of writes.get(x.fn) ?? []) {
    const at = params?.findIndex((p) => p.mode === 'inout' && p.name === name) ?? -1;
    if (at < 0) {
      out.add(name);
      continue;
    }
    const arg = x.args[at];
    const root = arg === undefined ? undefined : targetRoot(arg);
    if (root !== undefined && (root.op === 'varref' || root.op === 'param')) out.add(root.name);
  }
  const root = atomicWriteRoot(x);
  if (root !== undefined) out.add(root);
  return out;
}

/** Does evaluating `e` WRITE something: a call to a function that writes a module name or its
 *  caller's value through an `inout` parameter, or an atomic or `textureStore` that writes a
 *  location? Narrower than {@link exprHasEffect}, which also counts `atomicLoad` and the
 *  barriers: a read and a fence order what is around them, and only a write leaves something
 *  behind that dropping the expression would lose. */
export function exprWrites(e: Expr, writes: FnWrites): boolean {
  let found = false;
  eachExpr(e, (x) => {
    if (found || x.op !== 'call') return;
    if ((writes.get(x.fn)?.size ?? 0) > 0 || atomicWriteRoot(x) !== undefined) found = true;
  });
  return found;
}

/** Does evaluating `e` do anything besides produce a value: a call to a function that writes
 *  a binding, or to an intrinsic in {@link EFFECTFUL_INTRINSICS}? */
export function exprHasEffect(e: Expr, writes: FnWrites): boolean {
  let found = false;
  eachExpr(e, (x) => {
    if (x.op !== 'call') return;
    if (EFFECTFUL_INTRINSICS.has(x.fn)) found = true;
    const w = writes.get(x.fn);
    if (w !== undefined && w.size > 0) found = true;
  });
  return found;
}

/** Does any statement of `body`, nested blocks included, contain an effectful call? The
 *  value-hoisting passes leave such a function alone: deduping or moving a call that writes
 *  a binding would change how many times, or when, it writes. */
export function bodyHasEffectfulCall(body: readonly Stmt[], writes: FnWrites): boolean {
  let found = false;
  const walk = (s: Stmt): void => {
    if (found) return;
    eachStmtExpr(
      s,
      (e) => {
        if (!found && exprHasEffect(e, writes)) found = true;
      },
      walk,
    );
  };
  for (const s of body) walk(s);
  return found;
}

/** The names the calls inside one statement's own expressions write (not its nested blocks,
 *  which `collectMutatedRoots` recurses into itself), each as the caller knows it
 *  ({@link callWrites}). Until the translation, a method that changes its object reported the
 *  callee's `self_` here rather than the receiver, so `const before = p; p.bump()` let copy
 *  propagation read `p` where `before` was written: the GPU saw the bumped value, the oracle the
 *  one before it. */
export function calleeWritesOf(s: Stmt, writes: FnWrites, out: Set<string>): void {
  eachStmtExpr(
    s,
    (e) => {
      eachExpr(e, (x) => {
        if (x.op !== 'call') return;
        for (const name of callWrites(x, writes)) out.add(name);
      });
    },
    () => {},
  );
}
