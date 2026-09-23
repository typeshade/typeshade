// ═══ Shader DSL — cross-statement global value numbering (GVN) ═══
//
// Completes the CSE family. `cse` hoists fn-top INPUT-ONLY repeats; `cse-local`
// hoists repeats WITHIN A SINGLE statement that touch a local/var. The gap
// (X-GIS #627): a subexpression that touches a local/var and repeats ACROSS statements
// in the same block — e.g.
//
//   let a = hash(cell + g);      // statement i
//   ...
//   let b = hash(cell + g) * 2;  // statement j   (cell/g are locals)
//
// SAFE only with reassignment-awareness. This pass is deliberately conservative:
// it numbers one STRAIGHT-LINE block at a time, and it hoists a repeat to a single
// `let` before its FIRST occurrence ONLY when:
//   • the key is COMPOUND, worth-hoisting (computes), and touches a local/var
//     (input-only repeats are already cse's job — this is its complement),
//   • EVERY occurrence in the block is unconditionally evaluated (never under a
//     `&&`/`||` RHS, a `select` branch, or a `matchExpr` arm — same guard as cse-local),
//     so the `let` computes nothing on a path the authored code did not, AND
//   • EITHER it occurs in >= 2 statements of the block and NO statement in the span
//     [first, last) mutates ANY root the expr reads (assignment target root, a
//     read_write store, or a same-name redeclaration) — `r = f(r); y = f(r)` mutates
//     `r` at the first statement, so the two `f(r)` differ and are not numbered
//     together —
//   • OR a NESTED block reads it before any root moves (below).
//
// CROSS-BLOCK DOMINANCE. A `let` placed before statement i is evaluated on every path
// into the nested blocks of statement i and of every later statement, so an inner
// occurrence can read it instead of recomputing, for as long as nothing has written a
// root the value reads. The fp64 escape loops are the shape this is for:
//
//   if (df64_le(df64_add(df64_mul(zx, zx, G), df64_mul(zy, zy, G), G), R)) {
//     let n = df64_add(df64_sub(df64_mul(zx, zx, G), df64_mul(zy, zy, G), G), c, G);
//     zy = …; zx = n;
//   }
//
// computed zx² and zy² twice per iteration. The condition runs on every path into the
// arm, and the arm reads zx*zx BEFORE it writes zx, so binding both products before the
// `if` is legal. The pass missed it twice over: it minted a temp only for a key in >= 2
// statements of one block (the arm is another block), and it handed an arm no enclosing
// temp whose root the `if` wrote ANYWHERE (this arm writes zx). What is and is not
// shared, exactly:
//   • SHARED into every arm of an `if` (the `else if` arms and the `else` too) and every
//     case of a `switch`, WITHOUT asking whether the statement writes the root somewhere:
//     the conditions and the scrutinee are pure and run before any arm, exactly one arm
//     runs, top-down, once — and the arm's own walk retires the temp after the first of
//     ITS statements that writes a root (recursing, so an inner `if`/`for` that writes one
//     is caught). A use in the arm before that statement reads the temp; one after it
//     recomputes. The conditions of the later arms (`else if`) read it as well.
//   • SHARED into a `for` body only when NOTHING in the whole loop (header or body) writes
//     a root: the back edge means iteration 2 reads what iteration 1 wrote.
//   • MINTED for the dominance alone only when the first occurrence is unconditional in
//     this block (an `else if` condition is not, and neither is a `||` RHS), a nested read
//     is reached under exactly those rules, the key overlaps no same-block repeat the block
//     keeps (a larger temp for the arm must not split a repeat's occurrences), and no
//     enclosing temp still holds the value (that one is read, not minted again). The reach
//     check proposes; a count of the rewritten function decides: a temp read fewer than
//     twice is denied for that block and the function numbered again without it (`gvnFn`),
//     so no temp ever stands in for a single use.
//   • NOT shared: into a nested block past a write (the arm's walk, or the loop filter,
//     retires it), across a `let`/`var` that shadows a root (its own name counts as a
//     write), from a key first seen in an `else if` condition, a `for` header, a `switch`
//     scrutinee or a guarded operand, and nothing at all in a function with a raw statement
//     or an effectful call. That last rule is also what covers an `inout` argument:
//     `collectMutatedRoots` does not count `f(x)` as a write to `x` (the callee's write set
//     names its own parameter), but the callee writes something, so the call is effectful.
//   • NOT shared across a write to a module name a CALLED function reads. A root is not only
//     a name the expression spells: `h(b)` where `h` returns `q * gp` reads `gp` too, and
//     `rootsOf` adds every name the callee reads, transitively (`fnReads` in ../effects.ts),
//     so `gp = 5.` retires it like `b = 5.` would. Before that, this change reached the hole
//     the same-block rule already had: `if (h(b) > 0.) { gp = 5.; r = h(b) }` became
//     `let _gv0 = h(b); if (_gv0 > 0.) { gp = 5.; r = _gv0; }`, 4 where O0 returns 20.
//
// MEASURED over the baked corpus (every WGSL and GLSL golden, 287 files), before vs after:
// 14 files move, all fp64 escape loops (fp64-julia, fp64-mandelbrot, fp64-burning-ship,
// fp64-mandelbrot-de, their "use typeshade" twins, WGSL and fragment GLSL), and nothing
// else in the corpus moves. df64_mul call sites 362 -> 334, binary operators in function
// bodies 7772 -> 7744, df64_add unchanged at 366 (the sum the condition compares and the
// difference the arm builds are different values). Per iteration that takes the arm, counted
// as f32 arithmetic operators (+ - * /; comparisons and negation not counted) through the
// df64 helper bodies, where one df64_mul is 37: the df64 loop body goes 351 -> 277 in julia,
// mandelbrot and burning-ship, 362 -> 288 in mandelbrot-de; each example's f32 loop (the
// same escape test in plain f32) goes 11 -> 9, 19 -> 17 in mandelbrot-de. The reach check
// never proposed a temp the count then denied: across three emits of all 107 examples,
// 5973 function numberings, 0 retries. Compile time over those three emits, medians of 12
// interleaved runs on an otherwise idle machine, before this change / with it / with the
// read table of ../effects.ts added too: gvn 362 / 417 / 422 ms, the whole emit 2211 / 2281
// / 2383 ms.
//
// Bit-exact (pure dedup — no float arithmetic changes), so no f32 differential
// gate is needed; pinned by oracle value-equality like cse / cse-local.
//
// WIRED into DEFAULT_PASSES and O1 (X-GIS #1865). It sat available-but-unwired for a
// long time because turning it on changes production WGSL bytes and every
// byte-stable snapshot has to be regenerated; the measurement settled it — 208 of
// 6008 IR ops across the production modules, concentrated in the two per-fragment
// hot paths (line 1546 -> 1465, hillshade 657 -> 613). Being pure dedup it is in
// O1 too: the re-bake moved bytes, never pixels.

import type { Expr, Stmt, ModuleDecl, FuncDecl } from '../../ir/index.js'
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
} from './expr-utils.js'
import { eachStmtExpr } from '../../ir/visit.js'
import { bodyHasEffectfulCall, fnReads, fnWrites, type FnReads, type FnWrites } from '../effects.js'

/** The root names an expression reads: every op that names a storage location (a local,
 *  a parameter, a binding, a host global — the set `refsLocal` in expr-utils treats as one),
 *  so a write to any of them retires a temp that reads it. A module constant lands here
 *  too and is harmless: nothing ever writes one, so it never meets a mutated set.
 *
 *  `constref` and `externref` are here because `collectMutatedRoots` counts an assignment to
 *  either as a write (expr-utils `rootName`), so `refsLocal` tallies a key that reads a written
 *  one, and a root set without them would never see that write. No front end assigns to
 *  either today — a module constant and a host global are read-only on both surfaces — so
 *  only a hand-built module shows it (gvn.test.ts pins one).
 *
 *  A CALL adds every module name its callee reads (`reads`, {@link fnReads}): `load(j)` where
 *  `load` returns `buf[i] * 2.` reads `buf` as surely as `buf[j] * 2.` does, and a temp for
 *  it that crossed `buf[j] = 10.` into the arm returned 4 where O0 returns 22. */
function rootsOf(e: Expr, reads: FnReads): Set<string> {
  const out = new Set<string>()
  eachExpr(e, (x) => {
    if (x.op === 'varref' || x.op === 'param' || x.op === 'constref' || x.op === 'externref')
      out.add(x.name)
    else if (x.op === 'call') for (const n of reads.get(x.fn) ?? []) out.add(n)
  })
  return out
}

/** Does `mut` (a statement's mutated names) write any of `roots`? */
function touches(mut: ReadonlySet<string>, roots: ReadonlySet<string>): boolean {
  if (mut.size === 0) return false
  for (const r of roots) if (mut.has(r)) return true
  return false
}

/** The exprs of a statement this block evaluates UNCONDITIONALLY (never the lvalue
 *  target).
 *
 *  An `if`'s FIRST arm condition belongs here (X-GIS #1886): it runs on every path through
 *  this block, exactly like a `let` initialiser, so binding a repeat inside it to a
 *  temp placed before the statement adds no work on any path. It used to be absent —
 *  `default: []` covered every control-flow statement under the note "handled by
 *  recursion", which is true of the BODIES and false of the CONDITIONS. `cse`
 *  (../cse.ts, the input-only half of the family) has always walked `a.cond` and
 *  `s.scrut`; this is the same traversal for the local-touching half.
 *
 *  WORTH 6 CALL SITES ON ITS OWN — measured, not estimated: over the 87-source baked
 *  corpus, before vs after a real build + bake, raw call sites went 12239 -> 12233.
 *  The value is as the PREREQUISITE for cross-block dominance (X-GIS #1886), where 144 of
 *  the 241 remaining repeats sit: the outer occurrence that dominates an inner
 *  recompute is usually the `if` condition, so until it is tallied there is no outer
 *  temp for the inner block to reuse. Do not quote a bigger number for this pass
 *  alone — the issue's opening figures came from a corpus that had 12 unrelated
 *  files in it and are corrected in its comments.
 *
 *  DELIBERATELY still absent, each because the expr is NOT evaluated once per
 *  execution of this block:
 *    • `arms[1..]` — an `else if` runs only when every earlier arm failed, so a temp
 *      before the `if` would compute it on paths the authored code does not. Same
 *      rule the `cond` flag in `tally` already applies to a `&&`/`||` RHS. Those
 *      conditions are still REWRITTEN against the temps in scope (`mapReads`): reading
 *      a value that is already bound adds no work on any path, which is the whole
 *      difference between reusing a temp and minting one.
 *    • `for` cond/init/update — re-evaluated per iteration; lifting one is loop
 *      invariance, which is licm's job and needs a proof gvn does not have.
 *    • `switch` scrut — unconditional, so it is sound to add, but the whole
 *      production corpus has 26 `switch` headers against 2363 `if`s; it is left out
 *      rather than shipped on an argument instead of a measurement. */
function valueExprs(s: Stmt): readonly Expr[] {
  switch (s.s) {
    case 'let':
      return [s.expr]
    case 'var':
      return s.init !== undefined ? [s.init] : []
    case 'assign':
    case 'assignOp':
      return [s.expr]
    case 'return':
      return s.expr !== undefined ? [s.expr] : []
    case 'if':
      return s.arms.length > 0 ? [s.arms[0]!.cond] : []
    default:
      return [] // for / switch / break / continue / discard — see the note above
  }
}

/** Names mutated by ONE statement: assignment-target roots (recursing into nested
 *  bodies, so an intervening if/for that writes a root is caught) PLUS a let/var's
 *  own declared name (a same-name redeclaration invalidates an earlier numbering) and a
 *  `for` counter's, which shadows an outer name of the same spelling for the header and
 *  the body alike (the update usually writes the counter and names it anyway; the declared
 *  name covers a loop whose update writes something else). Binding names are unique per
 *  function today (the builder auto-names, the front end renames a second declaration
 *  `i_1`), so neither redeclaration occurs in the corpus; they are here because a temp that
 *  crosses into a nested block is only as sound as this set is complete. */
function mutatedBy(s: Stmt): Set<string> {
  const out = new Set<string>()
  collectMutatedRoots([s], out)
  if (s.s === 'let' || s.s === 'var') out.add(s.name)
  else if (s.s === 'for' && (s.init.s === 'let' || s.init.s === 'var')) out.add(s.init.name)
  return out
}

/** Rewrite every position of `s` that reads the temps in scope: the value positions
 *  `mapStmtValue` names (exactly the ones `valueExprs` tallies), plus the conditions of an
 *  `if`'s LATER arms. Those are not tallied — an `else if` does not run on every path, so
 *  no temp is minted FROM one — but every condition runs before any arm body and after
 *  nothing else, so a temp bound before the `if` holds at each of them. */
function mapReads(s: Stmt, f: (e: Expr) => Expr): Stmt {
  const t = mapStmtValue(s, f)
  if (t.s !== 'if' || t.arms.length < 2) return t
  return { ...t, arms: t.arms.map((a, i) => (i === 0 ? a : { ...a, cond: f(a.cond) })) }
}

/** The positions `mapReads` rewrites, listed rather than rebuilt: `valueExprs` (which names
 *  `mapStmtValue`'s set — the contract the tally already rests on) plus the later `if`
 *  conditions `mapReads` adds. The reach check below walks these for every candidate key in
 *  every nested block, so it must not allocate a statement per look. */
function readExprs(s: Stmt): readonly Expr[] {
  const own = valueExprs(s)
  if (s.s !== 'if' || s.arms.length < 2) return own
  return [...own, ...s.arms.slice(1).map((a) => a.cond)]
}

/** Does `e` hold a subexpression keyed `k`? */
function mentions(e: Expr, k: string): boolean {
  let found = false
  eachExpr(e, (x) => {
    if (!found && keyOf(x) === k) found = true
  })
  return found
}

interface Occur {
  stmts: Set<number> // distinct statement indices with an UNCONDITIONAL occurrence
  exemplar: Expr
}

// Walk a value expr, recording unconditional compound/worth/local-touching keys at
// statement `idx`; any key seen under a guard (cond=true) is excluded outright.
function tally(
  e: Expr,
  idx: number,
  cond: boolean,
  localSet: ReadonlySet<string>,
  occ: Map<string, Occur>,
  condKeys: Set<string>,
  loadRoots: ReadonlySet<string>,
  reads: FnReads,
): void {
  if (isCompound(e) && isWorthHoisting(e, loadRoots) && refsLocal(e, localSet, reads)) {
    const k = keyOf(e)
    if (cond) {
      condKeys.add(k)
    } else {
      const o = occ.get(k)
      if (o) o.stmts.add(idx)
      else occ.set(k, { stmts: new Set([idx]), exemplar: e })
    }
  }
  switch (e.op) {
    case 'logical':
      tally(e.a, idx, cond, localSet, occ, condKeys, loadRoots, reads)
      tally(e.b, idx, true, localSet, occ, condKeys, loadRoots, reads)
      break
    case 'select':
      tally(e.cond, idx, cond, localSet, occ, condKeys, loadRoots, reads)
      tally(e.ifTrue, idx, true, localSet, occ, condKeys, loadRoots, reads)
      tally(e.ifFalse, idx, true, localSet, occ, condKeys, loadRoots, reads)
      break
    case 'matchExpr':
      tally(e.scrutinee, idx, cond, localSet, occ, condKeys, loadRoots, reads)
      for (const [, v] of e.cases) tally(v, idx, true, localSet, occ, condKeys, loadRoots, reads)
      tally(e.default, idx, true, localSet, occ, condKeys, loadRoots, reads)
      break
    case 'binop':
    case 'compare':
      tally(e.a, idx, cond, localSet, occ, condKeys, loadRoots, reads)
      tally(e.b, idx, cond, localSet, occ, condKeys, loadRoots, reads)
      break
    case 'unop':
      tally(e.a, idx, cond, localSet, occ, condKeys, loadRoots, reads)
      break
    case 'call':
    case 'construct':
      for (const a of e.args) tally(a, idx, cond, localSet, occ, condKeys, loadRoots, reads)
      break
    case 'member':
      tally(e.base, idx, cond, localSet, occ, condKeys, loadRoots, reads)
      break
    case 'index':
      tally(e.base, idx, cond, localSet, occ, condKeys, loadRoots, reads)
      tally(e.idx, idx, cond, localSet, occ, condKeys, loadRoots, reads)
      break
    default:
      break // leaf
  }
}

/** A value an ENCLOSING block already bound to a temp, offered to nested blocks.
 *  `roots` travels with it so a mutation can retire it without re-deriving them. */
interface Avail {
  readonly name: string
  readonly roots: ReadonlySet<string>
}

/** The entries of `live` a LOOP body may still trust.
 *
 *  `mutatedBy` recurses into nested bodies and reads the header, so one filter covers
 *  every way the value could have moved on by the time an iteration runs: an assignment
 *  anywhere in the loop, and a `let`/`var` (or the counter) that SHADOWS a root, which
 *  would silently make the inner expression a different one.
 *
 *  Only a `for` goes through this. Its back edge means iteration 2 reads what iteration 1
 *  wrote, so a temp bound before the loop is stale from the second pass on even when the
 *  write sits AFTER the use in the body. An `if` arm and a `switch` case have no back edge:
 *  each runs top-down, once, after conditions that are pure, so `gvnBlock` hands them the
 *  whole `live` set and lets the arm's own walk retire a temp at the statement that writes
 *  its root. That used to go through this filter as well, "one filter against a whole class
 *  of reasoning about which arm ran" — and the class it removed was the fp64 escape loop,
 *  whose arm reads zx*zx and THEN writes zx: the write anywhere in the arm dropped the temp
 *  from the arm entirely. */
function availableIn(s: Stmt, live: ReadonlyMap<string, Avail>): Map<string, Avail> {
  if (live.size === 0) return new Map()
  const mut = mutatedBy(s)
  const out = new Map<string, Avail>()
  for (const [k, a] of live) if (!touches(mut, a.roots)) out.set(k, a)
  return out
}

// ─── The reach check: would a temp bound before statement `from` be READ inside? ───
//
// The same rules the rewrite (step 7 of `gvnBlock`) follows, walked without rewriting:
// an `if`'s later conditions and its arms, a `switch`'s cases, a `for` body only when the
// whole loop leaves the roots alone; inside a nested block, statement by statement until
// the first one that writes a root (whose OWN value positions still read the old value —
// an assignment's right-hand side runs before its write). It is a proposal, not a proof of
// profit: a read it counts can still be masked in the rewrite (by an enclosing temp for a
// LARGER expression that holds this one, which `replace` takes first), and `gvnFn`'s count
// of the real output is what finally keeps or denies a temp.

/** Is a temp for `k` read by an `if`'s later conditions or by a nested block of `s`? */
function readInside(s: Stmt, k: string, roots: ReadonlySet<string>): boolean {
  switch (s.s) {
    case 'if':
      return (
        s.arms.some((a, i) => (i > 0 && mentions(a.cond, k)) || readIn(a.body, k, roots)) ||
        (s.elseBody !== undefined && readIn(s.elseBody, k, roots))
      )
    case 'switch':
      return (
        s.cases.some((c) => readIn(c.body, k, roots)) ||
        (s.defaultBody !== undefined && readIn(s.defaultBody, k, roots))
      )
    case 'for':
      return !touches(mutatedBy(s), roots) && readIn(s.body, k, roots)
    default:
      return false
  }
}

/** Is a temp for `k`, live on entry to the nested block `body`, read before it retires? */
function readIn(body: readonly Stmt[], k: string, roots: ReadonlySet<string>): boolean {
  for (const s of body) {
    if (readExprs(s).some((e) => mentions(e, k)) || readInside(s, k, roots)) return true
    if (touches(mutatedBy(s), roots)) return false
  }
  return false
}

/** Every key an `if`'s later condition or a nested block of `body` mentions at all — the
 *  cheap filter in front of `readInside`, which only the keys in it have to pay for. */
function keysInside(body: readonly Stmt[]): Set<string> {
  const out = new Set<string>()
  const add = (e: Expr): void => eachExpr(e, (x) => void out.add(keyOf(x)))
  const inBody = (b: readonly Stmt[]): void => {
    for (const s of b) {
      for (const e of readExprs(s)) add(e)
      inside(s)
    }
  }
  const inside = (s: Stmt): void => {
    if (s.s === 'if') {
      s.arms.forEach((a, i) => {
        if (i > 0) add(a.cond)
        inBody(a.body)
      })
      if (s.elseBody) inBody(s.elseBody)
    } else if (s.s === 'for') inBody(s.body)
    else if (s.s === 'switch') {
      for (const c of s.cases) inBody(c.body)
      if (s.defaultBody) inBody(s.defaultBody)
    }
  }
  for (const s of body) inside(s)
  return out
}

/** Per-function state shared by every block `gvnFn` numbers in one attempt. */
interface Ctx {
  readonly localSet: ReadonlySet<string>
  readonly loadRoots: ReadonlySet<string>
  /** The module's read table: a call's roots include what its callee reads. */
  readonly reads: FnReads
  readonly next: { n: number }
  /** Keys a previous attempt minted in that block and found read fewer than twice. */
  readonly deny: ReadonlyMap<readonly Stmt[], ReadonlySet<string>>
  /** Every temp this attempt minted: its name, the block it was minted in, its key. */
  readonly minted: Map<string, { readonly block: readonly Stmt[]; readonly key: string }>
}

/** The candidates not nested inside another candidate's exemplar. */
function maximal(cands: ReadonlyArray<[string, Occur]>): Array<[string, Occur]> {
  const candSet = new Set(cands.map(([k]) => k))
  const nested = new Set<string>()
  for (const [, o] of cands) {
    eachExpr(o.exemplar, (sub) => {
      if (sub === o.exemplar) return
      const sk = keyOf(sub)
      if (candSet.has(sk)) nested.add(sk)
    })
  }
  return cands.filter(([k]) => !nested.has(k))
}

/** GVN one straight-line block: its OWN statements, then each nested block with the
 *  temps this one has bound so far in scope (X-GIS #1886).
 *
 *  Nested blocks used to be numbered FIRST and in isolation, so a value the enclosing
 *  block had already computed was recomputed from scratch inside an `if`. Handing the
 *  binding down is free by construction — the outer `let` is evaluated on every path
 *  that reaches the inner block, so the inner read replaces work rather than adding
 *  it. That also makes it sound for a GUARDED inner occurrence, which minting a fresh
 *  temp never is: nothing new is computed, the value is simply already there. */
function gvnBlock(
  body: readonly Stmt[],
  ctx: Ctx,
  env: ReadonlyMap<string, Avail> = new Map(),
): Stmt[] {
  const { localSet, loadRoots, reads } = ctx
  // 1. Tally cross-statement candidates over this block's value exprs. Recursion now
  //    happens in step 7 instead, so the temps minted here are in scope for it;
  //    `valueExprs` reads only this block's own statements, which recursion never
  //    rewrites, so nothing is lost by tallying before it.
  const rec = body
  const occ = new Map<string, Occur>()
  const condKeys = new Set<string>()
  rec.forEach((s, idx) => {
    for (const e of valueExprs(s)) tally(e, idx, false, localSet, occ, condKeys, loadRoots, reads)
  })
  const muts = rec.map(mutatedBy)
  const denied = ctx.deny.get(body)
  const first = (o: Occur): number => Math.min(...o.stmts)

  // 2. A key an enclosing temp still holds at its first occurrence here is READ, not
  //    re-minted: step 7 rewrites every occurrence to the enclosing temp until a root moves,
  //    and a second temp would recompute what the first already holds. (Before `if` arms
  //    received `live` unfiltered this was rare enough to leave to the next fixpoint round,
  //    which rewrites the duplicate `let` to a copy for copy-prop and DCE to remove.)
  const inherited = (k: string, o: Occur): boolean => {
    const a = env.get(k)
    if (a === undefined) return false
    const f = first(o)
    for (let m = 0; m < f; m++) if (touches(muts[m]!, a.roots)) return false
    return true
  }

  // 3. Every key unconditional here that neither a previous attempt denied nor an
  //    enclosing temp already holds. No early return when empty: a block that mints nothing
  //    must still recurse, and with `env` it may now be the block that USES an enclosing temp.
  const eligible = [...occ.entries()].filter(
    ([k, o]) => !condKeys.has(k) && denied?.has(k) !== true && !inherited(k, o),
  )

  // 4. SAME-BLOCK repeats: keys in >= 2 distinct statements, maximal only — drop a key nested
  //    inside another candidate's exemplar (the outer temp subsumes it; a later fixpoint pass
  //    picks up any standalone inner repeat).
  const repeats = maximal(eligible.filter(([, o]) => o.stmts.size >= 2))

  // 5. Reassignment check: drop a key if any statement in [first, last) mutates a root it reads.
  const chosen = new Set(
    repeats
      .filter(([, o]) => {
        const idxs = [...o.stmts].sort((a, b) => a - b)
        const last = idxs[idxs.length - 1]!
        const roots = rootsOf(o.exemplar, reads)
        for (let m = idxs[0]!; m < last; m++) if (touches(muts[m]!, roots)) return false
        return true
      })
      .map(([k]) => k),
  )

  // 5b. DOMINANCE: a key whose first occurrence here is read again by a nested block or a
  //     later `if` condition before a root moves (the reach check above). It must not
  //     overlap a repeat step 5 kept, in either direction: a repeat claims the expressions
  //     inside it and would be split by a larger temp around it (a temp for `normalize(v).x`
  //     that an arm reads must not take `normalize(v)` away from the two statements that
  //     share it).
  //     The next fixpoint round sees the repeat's temp and asks again.
  //     Among themselves, maximal only, as in step 4: when the arm reads both a value and a
  //     part of it (normalize(v).x, and normalize(v) for its .y), binding both would put the
  //     larger first — tally order — with its own copy of the part, and the path that skips
  //     the arm would compute the part twice where the authored code computes it once. The
  //     larger is bound; the arm numbers its own repeat of the part. (The escape loop does
  //     not exercise this: the sum its condition compares is never read in the arm, so it is
  //     no candidate, and zx*zx and zy*zy are disjoint.)
  //     Only a block with a nested statement pays for any of it: `keysInside` is empty
  //     otherwise, and it is the cheap filter every candidate meets first.
  if (rec.some((s) => s.s === 'if' || s.s === 'for' || s.s === 'switch')) {
    const inside = keysInside(rec)
    const reusedInside = (k: string, o: Occur): boolean => {
      const roots = rootsOf(o.exemplar, reads)
      for (let j = first(o); j < rec.length; j++) {
        if (readInside(rec[j]!, k, roots)) return true
        if (touches(muts[j]!, roots)) return false
      }
      return false
    }
    const claimed = new Set<string>()
    for (const [k, o] of repeats)
      if (chosen.has(k))
        eachExpr(o.exemplar, (sub) => {
          if (sub !== o.exemplar) claimed.add(keyOf(sub))
        })
    const holdsChosen = (o: Occur): boolean => {
      let yes = false
      eachExpr(o.exemplar, (sub) => {
        if (!yes && sub !== o.exemplar && chosen.has(keyOf(sub))) yes = true
      })
      return yes
    }
    const dominating = eligible.filter(
      ([k, o]) =>
        inside.has(k) && !chosen.has(k) && !claimed.has(k) && !holdsChosen(o) && reusedInside(k, o),
    )
    for (const [k] of maximal(dominating)) chosen.add(k)
  }
  // In tally order, so the `_gvN` sequence reads top-down as it always has.
  const safe = eligible.filter(([k]) => chosen.has(k))

  // 6. Assign a temp per safe key + record where its `let` lands (before its first stmt).
  const insertBefore = new Map<number, Array<{ name: string; expr: Expr }>>()
  for (const [k, o] of safe) {
    const at = first(o)
    const lets = insertBefore.get(at) ?? []
    const name = `_gv${ctx.next.n++}`
    lets.push({ name, expr: o.exemplar })
    ctx.minted.set(name, { block: body, key: k })
    insertBefore.set(at, lets)
  }

  // 7. ONE ordered walk: splice each `let` in, rewrite the statement against everything
  //    bound so far (this block's temps plus the enclosing ones `env` handed down),
  //    recurse into nested blocks with that same set, then retire whatever the
  //    statement moved on from. Order matters: a temp minted AT idx is live for
  //    statement idx itself — which is how an `if` whose condition holds the first
  //    occurrence can offer it to its own arms.
  const live = new Map<string, Avail>(env)
  const out: Stmt[] = []
  const replace = (e: Expr): Expr => {
    const a = live.get(keyOf(e))
    if (a !== undefined) return { op: 'varref', type: e.type, name: a.name }
    return mapChildren(e, replace)
  }
  rec.forEach((s, idx) => {
    for (const l of insertBefore.get(idx) ?? []) {
      // The temp's own initialiser reads what is already bound (its CHILDREN — the whole
      // expression is the key being defined). Without this a temp minted here for
      // `k + 1` recomputed an enclosing `k` until the next fixpoint round, and the use
      // count `gvnFn` takes would miss that read.
      out.push({ s: 'let', name: l.name, expr: mapChildren(l.expr, replace) })
      live.set(keyOf(l.expr), { name: l.name, roots: rootsOf(l.expr, reads) })
    }
    // The RHS of an assign is evaluated BEFORE the write, so rewriting statement idx
    // against the pre-statement `live` is right; the retirement below is for idx+1 on.
    out.push(mapReads(recurseBlocks(s, ctx, live), replace))
    const mut = muts[idx]!
    if (mut.size > 0) for (const [k, a] of [...live]) if (touches(mut, a.roots)) live.delete(k)
  })
  return out
}

// Rebuild a control-flow statement with each nested body GVN'd as its own block. An `if`
// arm and a `switch` case receive `live` whole (see `availableIn` for why only a loop is
// filtered); each nested `gvnBlock` copies it before its own walk retires anything.
function recurseBlocks(s: Stmt, ctx: Ctx, live: ReadonlyMap<string, Avail>): Stmt {
  switch (s.s) {
    case 'if':
      return {
        ...s,
        arms: s.arms.map((a) => ({ cond: a.cond, body: gvnBlock(a.body, ctx, live) })),
        elseBody: s.elseBody ? gvnBlock(s.elseBody, ctx, live) : undefined,
      }
    case 'for':
      return { ...s, body: gvnBlock(s.body, ctx, availableIn(s, live)) }
    case 'switch':
      return {
        ...s,
        cases: s.cases.map((c) => ({ values: c.values, body: gvnBlock(c.body, ctx, live) })),
        defaultBody: s.defaultBody ? gvnBlock(s.defaultBody, ctx, live) : undefined,
      }
    default:
      return s
  }
}

/** How many times each name in `names` is READ in `body` (a `let` binding it is not). */
function readCounts(
  body: readonly Stmt[],
  names: ReadonlyMap<string, unknown>,
): Map<string, number> {
  const out = new Map<string, number>()
  const visit = (e: Expr): void =>
    eachExpr(e, (x) => {
      if (x.op === 'varref' && names.has(x.name)) out.set(x.name, (out.get(x.name) ?? 0) + 1)
    })
  for (const s of body) eachStmtExpr(s, visit)
  return out
}

/** GVN one function.
 *
 *  A temp is only worth its `let` if it is read at least twice. A same-block repeat
 *  guarantees that by construction (two statements, no write between), but a temp minted
 *  for a NESTED read rests on the reach check, which cannot see every way the rewrite
 *  masks a read (an enclosing temp for a larger expression that holds this one is taken
 *  first). So the answer is taken from the output rather than predicted: number the
 *  function, count each new temp's reads, deny every temp read fewer than twice FOR THE
 *  BLOCK THAT MINTED IT, and number again from the original body. The deny set only grows
 *  and a denied key is never minted in that block again, so this terminates; in the corpus
 *  it is one attempt everywhere (the measurement is in the header). Re-numbering
 *  from scratch rather than inlining the temp back keeps the `_gvN` sequence dense and lets
 *  a key the denied one had shadowed as non-maximal (step 4) be numbered in its place. */
function gvnFn(
  f: FuncDecl,
  loadRoots: ReadonlySet<string>,
  writes: FnWrites,
  reads: FnReads,
): FuncDecl {
  if (bodyHasRaw(f.body)) return f // raw WGSL is opaque
  // A call that writes a binding is not a value to number: two `store(i)` are two writes,
  // and a read between them sees the first (issue #47).
  if (bodyHasEffectfulCall(f.body, writes)) return f
  const localSet = new Set<string>()
  collectLocals(f.body, localSet)
  collectMutatedRoots(f.body, localSet, writes)
  // Seed past any existing `_gvN` so a second fixpoint pass can't redeclare `_gv0`.
  let base = 0
  for (const n of localSet) {
    const mm = /^_gv(\d+)$/.exec(n)
    if (mm) base = Math.max(base, Number(mm[1]) + 1)
  }
  const deny = new Map<readonly Stmt[], Set<string>>()
  for (;;) {
    const minted: Ctx['minted'] = new Map()
    const body = gvnBlock(f.body, { localSet, loadRoots, reads, next: { n: base }, deny, minted })
    if (minted.size === 0) return { ...f, body }
    const counts = readCounts(body, minted)
    let again = false
    for (const [name, m] of minted) {
      if ((counts.get(name) ?? 0) >= 2) continue
      let set = deny.get(m.block)
      if (set === undefined) deny.set(m.block, (set = new Set()))
      set.add(m.key)
      again = true
    }
    if (!again) return { ...f, body }
  }
}

/** Cross-statement value numbering of local-touching repeats. Pure (module → module). */
export function gvn(m: ModuleDecl): ModuleDecl {
  // Indexing one of these is a memory load, not free addressing (X-GIS #1886).
  const loadRoots = new Set(m.bindings.map((b) => b.name))
  const writes = fnWrites(m)
  const reads = fnReads(m)
  return { ...m, funcs: m.funcs.map((f) => gvnFn(f, loadRoots, writes, reads)) }
}
