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

import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/index.js'
import { eachExpr, eachStmtExpr } from '../ir/visit.js'
import { ATOMIC_INTRINSICS, isAtomicIntrinsic } from '../intrinsics.js'
import { collectLocals } from './opt/expr-utils.js'

/** Intrinsic ids whose call has an effect beyond its value: the atomic builtins, `atomicLoad`
 *  included, since two loads must not be shared across a store to the same location. The
 *  `workgroupBarrier`, `storageBarrier` and `textureStore` names join it when they are
 *  authorable. */
export const EFFECTFUL_INTRINSICS: ReadonlySet<string> = new Set<string>(
  Object.keys(ATOMIC_INTRINSICS),
)

/** The module-level names each function writes, itself or through the functions it calls. */
export type FnWrites = ReadonlyMap<string, ReadonlySet<string>>

const memo = new WeakMap<ModuleDecl, FnWrites>()

const targetRoot = (e: Expr): Expr =>
  e.op === 'index' || e.op === 'member' ? targetRoot(e.base) : e

/** The name an atomic builtin call writes: the root of its location argument, for every
 *  atomic but `atomicLoad`. `undefined` for any other expression, and for a call that resolved
 *  to a function the module declares under an atomic's name. */
export function atomicWriteRoot(x: Expr): string | undefined {
  if (x.op !== 'call' || x.declRef !== undefined || !isAtomicIntrinsic(x.fn)) return undefined
  if (x.fn === 'atomicLoad' || x.args[0] === undefined) return undefined
  const root = targetRoot(x.args[0])
  return root.op === 'varref' || root.op === 'param' ? root.name : undefined
}

function directWrites(f: FuncDecl, out: Set<string>): void {
  const owned = new Set<string>(f.params.map((p) => p.name))
  collectLocals(f.body, owned)
  const walk = (body: readonly Stmt[]): void => {
    for (const s of body) {
      // An atomic store or read-modify-write anywhere in the statement's own expressions
      // writes the binding at its location's root, the way an `assign` to it would.
      eachStmtExpr(
        s,
        (e) => {
          eachExpr(e, (x) => {
            const root = atomicWriteRoot(x)
            if (root !== undefined && !owned.has(root)) out.add(root)
          })
        },
        () => {},
      )
      if (s.s === 'assign' || s.s === 'assignOp') {
        const root = targetRoot(s.target)
        if ((root.op === 'varref' || root.op === 'param') && !owned.has(root.name))
          out.add(root.name)
      } else if (s.s === 'if') {
        for (const a of s.arms) walk(a.body)
        if (s.elseBody) walk(s.elseBody)
      } else if (s.s === 'for') {
        walk([s.init, s.update])
        walk(s.body)
      } else if (s.s === 'switch') {
        for (const c of s.cases) walk(c.body)
        if (s.defaultBody) walk(s.defaultBody)
      }
    }
  }
  walk(f.body)
}

function calleesOf(f: FuncDecl, declared: ReadonlySet<string>, out: Set<string>): void {
  for (const s of f.body) {
    eachStmtExpr(s, (e) => {
      eachExpr(e, (x) => {
        if (x.op === 'call' && (x.declRef !== undefined || declared.has(x.fn))) out.add(x.fn)
      })
    })
  }
}

/** Hand `to` the effect table already computed for `from`, when `to` is a view of the same
 *  module: the fixpoint optimizes each function in a module holding that function alone, and
 *  every pass returns a new module object, so without this a pass would see a table computed
 *  from one function and take every call to a helper for a pure one. A stale table is only
 *  ever an over-approximation (no pass adds a binding write to a function that had none), so
 *  carrying it forward is safe. */
export function inheritEffects(from: ModuleDecl, to: ModuleDecl): void {
  if (to === from || memo.has(to)) return
  const table = memo.get(from)
  if (table !== undefined) memo.set(to, table)
}

/** The names each function of `m` writes, transitively. Cached per module object; the IR is
 *  immutable, so a pass that rewrites builds a new module and gets a fresh answer, unless
 *  {@link inheritEffects} handed it the table of the module it is a view of. */
export function fnWrites(m: ModuleDecl): FnWrites {
  const hit = memo.get(m)
  if (hit !== undefined) return hit
  const declared = new Set(m.funcs.map((f) => f.name))
  const writes = new Map<string, Set<string>>()
  const callees = new Map<string, Set<string>>()
  for (const f of m.funcs) {
    const w = new Set<string>()
    directWrites(f, w)
    writes.set(f.name, w)
    const c = new Set<string>()
    calleesOf(f, declared, c)
    callees.set(f.name, c)
  }
  // Fixpoint over the call graph: a function inherits what its callees write.
  let changed = true
  while (changed) {
    changed = false
    for (const f of m.funcs) {
      const w = writes.get(f.name)!
      for (const callee of callees.get(f.name)!) {
        for (const name of writes.get(callee) ?? []) {
          if (!w.has(name)) {
            w.add(name)
            changed = true
          }
        }
      }
    }
  }
  memo.set(m, writes)
  return writes
}

/** Does evaluating `e` do anything besides produce a value: a call to a function that writes
 *  a binding, or to an intrinsic in {@link EFFECTFUL_INTRINSICS}? */
export function exprHasEffect(e: Expr, writes: FnWrites): boolean {
  let found = false
  eachExpr(e, (x) => {
    if (x.op !== 'call') return
    if (EFFECTFUL_INTRINSICS.has(x.fn)) found = true
    const w = writes.get(x.fn)
    if (w !== undefined && w.size > 0) found = true
  })
  return found
}

/** Does any statement of `body`, nested blocks included, contain an effectful call? The
 *  value-hoisting passes leave such a function alone: deduping or moving a call that writes
 *  a binding would change how many times, or when, it writes. */
export function bodyHasEffectfulCall(body: readonly Stmt[], writes: FnWrites): boolean {
  let found = false
  const walk = (s: Stmt): void => {
    if (found) return
    eachStmtExpr(
      s,
      (e) => {
        if (!found && exprHasEffect(e, writes)) found = true
      },
      walk,
    )
  }
  for (const s of body) walk(s)
  return found
}

/** The module names the calls inside one statement's own expressions write (not its nested
 *  blocks, which `collectMutatedRoots` recurses into itself). */
export function calleeWritesOf(s: Stmt, writes: FnWrites, out: Set<string>): void {
  eachStmtExpr(
    s,
    (e) => {
      eachExpr(e, (x) => {
        if (x.op !== 'call') return
        for (const name of writes.get(x.fn) ?? []) out.add(name)
        const root = atomicWriteRoot(x)
        if (root !== undefined) out.add(root)
      })
    },
    () => {},
  )
}
