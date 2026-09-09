// ═══ rewriteExprsInFunc / renameVarrefsInFunc — content-blind expression
//     rewriting over a function body ═══
//
// Host modules sometimes need to re-point references AFTER a module is
// assembled — e.g. deriving a variant of a module whose uniform block was
// split into several: DSL-built reads are `member` chains rooted at the
// block's binding `varref`, and compiler-spliced paint expressions carry the
// block alias INSIDE a dotted `varref` name (`u.zoom`) that backends emit
// verbatim. Both live in IR as plain data, so only an IR walk can re-point
// them.
//
// `rewriteExprsInFunc` maps a caller-supplied Expr rewrite over every
// expression in a FuncDecl's body — all statement and expression shapes.
// The rewrite sees every node post-order; subtrees it RETURNS are not
// re-walked (they are the caller's finished output).
//
// IDENTITY IS PART OF THE CONTRACT (#2042 INC-4b's vanished-fills incident).
// A derived module goes back through emitModule's optimizer, whose auto-var
// pass correlates a mutable value's declaration, assignments, and reads by
// Expr OBJECT IDENTITY (auto-vars.ts header: "Runs BEFORE lower/cse (which
// clone exprs and would break identity)"). The first version of this walker
// was built on mapStmt/mapExpr, which clone every ancestor of a change PER
// OCCURRENCE — one shared assign-target/read object became N distinct
// clones, auto-vars minted a var per clone, every READ matched no target
// and collapsed to the (zero) initializer, and each split-draw vertex
// landed at (0,0,0,0): valid draws, empty frames, no validation error.
// So this walker guarantees, by construction:
//   • UNCHANGED subtrees come back as the ORIGINAL objects (identity no-op);
//   • a CHANGED shared subtree maps to ONE new object, reused at every
//     occurrence (per-function memo keyed on the source object).
// The regression is pinned in rename-varrefs.test.ts (shared-object
// contract) and map's polygon-split-emit suite (no auto-var fission).
//
// `renameVarrefsInFunc` is the common special case: rename `varref` names
// (undefined = keep).

import type { Expr, FuncDecl, Stmt } from '../ir/nodes.js'
import { mapChildren } from './opt/expr-utils.js'

/**
 * Applies `rewrite` to every expression in the body of `f` and returns the
 * rewritten function.
 *
 * The walk visits every statement and expression shape in the body. Each
 * expression is passed to `rewrite` after its children have been rewritten,
 * and whatever `rewrite` returns is taken as finished output: it is not
 * walked again.
 *
 * Object identity is preserved wherever possible. A subtree that `rewrite`
 * leaves alone comes back as the original object, and `f` itself is returned
 * when nothing in the body changed. An expression object that appears at
 * several places in the body is rewritten once, and the same new object is
 * used at every occurrence, so passes that correlate a variable's
 * declaration, assignments and reads by object identity keep working on the
 * result.
 *
 * @param f The function whose body is rewritten.
 * @param rewrite Called once per expression. Return the expression unchanged
 *   to keep it, or a new expression to replace it.
 * @returns A copy of `f` with the rewritten body, or `f` itself when no
 *   expression changed.
 *
 * @example
 * ```ts
 * // Replace every literal `0` with `1`.
 * const g = rewriteExprsInFunc(f, (e) =>
 *   e.op === 'lit' && e.value === 0 ? { ...e, value: 1 } : e,
 * )
 * ```
 */
export function rewriteExprsInFunc(f: FuncDecl, rewrite: (e: Expr) => Expr): FuncDecl {
  let changed = false
  /** source object → rewritten object; shared subtrees stay shared. */
  const memo = new Map<Expr, Expr>()

  const walk = (e: Expr): Expr => {
    const hit = memo.get(e)
    if (hit !== undefined) return hit
    let childChanged = false
    const rebuilt = mapChildren(e, (c) => {
      const rc = walk(c)
      if (rc !== c) childChanged = true
      return rc
    })
    // mapChildren clones unconditionally — take the clone only when a child
    // actually changed, else keep the ORIGINAL object (the identity contract).
    const out = rewrite(childChanged ? rebuilt : e)
    if (out !== e) changed = true
    memo.set(e, out)
    return out
  }

  const walkBlock = (body: readonly Stmt[]): readonly Stmt[] => {
    let blockChanged = false
    const mapped = body.map((s) => {
      const rs = walkStmt(s)
      if (rs !== s) blockChanged = true
      return rs
    })
    return blockChanged ? mapped : body
  }

  const walkStmt = (s: Stmt): Stmt => {
    switch (s.s) {
      case 'let': {
        const e = walk(s.expr)
        return e === s.expr ? s : { ...s, expr: e }
      }
      case 'var': {
        if (s.init === undefined) return s
        const init = walk(s.init)
        return init === s.init ? s : { ...s, init }
      }
      case 'assign':
      case 'assignOp': {
        const target = walk(s.target)
        const expr = walk(s.expr)
        return target === s.target && expr === s.expr ? s : { ...s, target, expr }
      }
      case 'return': {
        if (s.expr === undefined) return s
        const e = walk(s.expr)
        return e === s.expr ? s : { ...s, expr: e }
      }
      case 'if': {
        let armsChanged = false
        const arms = s.arms.map((arm) => {
          const cond = walk(arm.cond)
          const body = walkBlock(arm.body)
          if (cond === arm.cond && body === arm.body) return arm
          armsChanged = true
          return { cond, body: body as Stmt[] }
        })
        const elseBody = s.elseBody ? walkBlock(s.elseBody) : undefined
        return !armsChanged && elseBody === s.elseBody
          ? s
          : { ...s, arms, elseBody: elseBody as Stmt[] | undefined }
      }
      case 'for': {
        const init = walkStmt(s.init)
        const cond = walk(s.cond)
        const update = walkStmt(s.update)
        const body = walkBlock(s.body)
        return init === s.init && cond === s.cond && update === s.update && body === s.body
          ? s
          : { ...s, init, cond, update, body: body as Stmt[] }
      }
      case 'switch': {
        const scrut = walk(s.scrut)
        let casesChanged = false
        const cases = s.cases.map((c) => {
          const body = walkBlock(c.body)
          if (body === c.body) return c
          casesChanged = true
          return { value: c.value, body: body as Stmt[] }
        })
        const defaultBody = s.defaultBody ? walkBlock(s.defaultBody) : undefined
        return scrut === s.scrut && !casesChanged && defaultBody === s.defaultBody
          ? s
          : { ...s, scrut, cases, defaultBody: defaultBody as Stmt[] | undefined }
      }
      default:
        return s // break / continue / discard / raw / placeholder — no sub-Exprs
    }
  }

  const body = walkBlock(f.body)
  return changed ? { ...f, body: body as Stmt[] } : f
}

/**
 * Renames variable references in the body of `f`.
 *
 * Every variable reference (an expression with `op: 'varref'`) is passed to
 * `rename` by name. When `rename` returns a string, the reference is
 * re-pointed at that name; when it returns `undefined`, the reference is
 * kept as is. Unchanged references keep their original objects, and `f`
 * itself is returned when no name changed (see {@link rewriteExprsInFunc}).
 *
 * @param f The function whose body is rewritten.
 * @param rename Maps a current variable name to its new name, or returns
 *   `undefined` to keep the current name.
 * @returns A copy of `f` with the renamed body, or `f` itself when no
 *   reference was renamed.
 *
 * @example
 * ```ts
 * // Point reads of the `u` uniform block at `u_split`.
 * const g = renameVarrefsInFunc(f, (name) =>
 *   name === 'u' ? 'u_split' : undefined,
 * )
 * ```
 */
export function renameVarrefsInFunc(
  f: FuncDecl,
  rename: (name: string) => string | undefined,
): FuncDecl {
  return rewriteExprsInFunc(f, (x) => {
    if (x.op !== 'varref') return x
    const to = rename(x.name)
    return to === undefined || to === x.name ? x : { ...x, name: to }
  })
}
