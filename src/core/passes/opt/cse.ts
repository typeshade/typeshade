// ═══ Shader DSL — common-subexpression elimination (Optimization context) ═══
//
// Hoists a compound subexpression that occurs >= 2x and depends ONLY on fn
// inputs (params / consts / bindings — no local `let`) into a single `let`,
// replacing each occurrence with a varref. This is a PASS over the IR,
// not an authoring change (the critic's "hash-consing rebuilds authoring" risk
// does not apply — `new Node(...)` is untouched).
//
// This is the auto-cache that lets authors write plain inline expressions instead of
// hand `Let` bindings: a value reused N times is emitted ONCE here. Hoists the MAXIMAL
// repeated expr (the outermost — `sqrt(dot(p,p))`, not just the inner `dot(p,p)`), so a
// single temp subsumes the whole shared value the author would have bound by hand. The
// maximal set never nests itself, so there is no replacement-ordering interaction; a fn
// containing a raw Stmt is skipped (raw WGSL is opaque). Correctness is pinned by oracle
// value-equality. (Input-only is still the safe boundary: a repeat reading a MUTATED root
// is excluded — its value changes, so it is not shareable.)
//
// PLACEMENT — the `let` goes at the SHALLOWEST POINT THAT STILL DOMINATES EVERY USE,
// not at the fn top (#hillshade-perf). Dedup is a source-level win; running the value
// is a per-invocation COST, and a temp parked at the fn top is paid by every invocation
// even when all its uses sit inside one mutually-exclusive branch. A 5-way method
// dispatch (fs_hillshade) fn-top-hoisted this way makes every fragment execute all five
// methods' math — measured: `basic`, `standard` and `multidirectional` cost the SAME,
// and deleting the dispatch cut hillshade's fragment cost ~52%. So each temp is bound at
// the top of the innermost placement block containing all its uses, immediately before
// the first statement that uses it (later placement is never worse — it also lets an
// early `discard` skip the work). A `for` body is NEVER a placement block: a let inside
// a loop re-evaluates per iteration, strictly worse than the enclosing block, so a `for`
// is attributed whole to the statement it sits at (LICM owns loop-invariant motion).
// Every hoisted expr is input-only, so it is valid anywhere in the fn — placement can
// only trade WHERE it runs, never WHETHER its value is the same.
//
// MUTUALLY EXCLUSIVE ARMS (#841, N1). The block that dominates every use can still be the
// wrong place. Two uses in different arms of one `if` / `else if` chain or `switch` are
// never both evaluated, so a temp above the statement removes no evaluation on any path, and
// it adds one to every path through a branch that uses none: an arm without a use, or the
// missing `else` or `default`. The class-based Namek example evaluated two `Lettering_rect`
// calls for every glyph because glyphs 5 and 6 each used them once. So when every use sits
// inside the arms of one statement and some branch of it uses none, each arm is grouped on
// its own: an arm with two or more uses gets its own temp, and an arm with one keeps it
// inline. When every branch uses the value, each path evaluates it once either way, and the
// temp stays above the statement.

import type { Expr, Stmt, ModuleDecl, FuncDecl } from '../../ir/index.js';
import { eachStmtExpr, mapStmtExpr } from '../../ir/visit.js';
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
} from './expr-utils.js';
import {
  bodyHasEffectfulCall,
  fnReads,
  fnWrites,
  type FnReads,
  type FnWrites,
} from '../effects.js';

/** Where one occurrence of a subexpression lives: the placement BLOCK (a path of
 *  `${stmtIndex}#${childBlockId}` steps from the fn body) and the index, within that
 *  block, of the statement containing it. */
interface Occurrence {
  readonly bp: readonly string[];
  readonly idx: number;
}

/** Visit every expr node in `body`, tagged with its placement block + block-level
 *  statement index. `if` arms / `else` / `switch` cases are nested placement blocks;
 *  an arm's CONDITION belongs to the ENCLOSING block (that is where it is evaluated).
 *  A `for` is not descended into — its whole subtree reports at the `for` itself, so
 *  nothing is ever placed inside a loop. */
function eachOccurrence(
  body: readonly Stmt[],
  bp: readonly string[],
  visit: (e: Expr, bp: readonly string[], idx: number) => void,
): void {
  body.forEach((s, idx) => {
    const node = (e: Expr) => visit(e, bp, idx);
    switch (s.s) {
      case 'if':
        s.arms.forEach((a, ai) => {
          eachExpr(a.cond, node);
          eachOccurrence(a.body, [...bp, `${idx}#a${ai}`], visit);
        });
        if (s.elseBody) eachOccurrence(s.elseBody, [...bp, `${idx}#e`], visit);
        break;
      case 'switch':
        eachExpr(s.scrut, node);
        s.cases.forEach((c, ci) => eachOccurrence(c.body, [...bp, `${idx}#c${ci}`], visit));
        if (s.defaultBody) eachOccurrence(s.defaultBody, [...bp, `${idx}#d`], visit);
        break;
      default:
        // eachStmtExpr walks the nested bodies too (`for`), and eachExpr the
        // descendants of every Expr it hands back.
        eachStmtExpr(s, (e) => eachExpr(e, node));
        break;
    }
  });
}

/** The shallowest block dominating every occurrence, and the earliest statement index
 *  in it that leads to one — the insertion point. The common block is the longest
 *  common prefix of the occurrence block-paths; an occurrence deeper than that prefix
 *  contributes the statement index encoded in its next path step. */
function placementOf(list: readonly Occurrence[]): { bp: readonly string[]; idx: number } {
  let bp = list[0]!.bp;
  for (const o of list) {
    let n = 0;
    while (n < bp.length && n < o.bp.length && bp[n] === o.bp[n]) n++;
    bp = bp.slice(0, n);
  }
  let idx = Number.POSITIVE_INFINITY;
  for (const o of list) {
    const own = o.bp.length === bp.length ? o.idx : Number(o.bp[bp.length]!.split('#')[0]);
    if (own < idx) idx = own;
  }
  return { bp, idx };
}

/** The block a placement path names, read from the function body the way
 *  {@link eachOccurrence} builds the path. */
function blockAt(body: readonly Stmt[], bp: readonly string[]): readonly Stmt[] {
  let at = body;
  for (const step of bp) {
    const [i, branch] = step.split('#') as [string, string];
    const s = at[Number(i)]!;
    if (s.s === 'if') at = branch === 'e' ? s.elseBody! : s.arms[Number(branch.slice(1))]!.body;
    else if (s.s === 'switch')
      at = branch === 'd' ? s.defaultBody! : s.cases[Number(branch.slice(1))]!.body;
  }
  return at;
}

/** The path steps of every branch of statement `idx` of a block, with `undefined` standing for
 *  the branch the statement does not spell: an `if` without `else`, a `switch` without
 *  `default`. */
function branchesOf(s: Stmt, idx: number): readonly (string | undefined)[] {
  if (s.s === 'if')
    return [...s.arms.map((_, ai) => `${idx}#a${ai}`), s.elseBody ? `${idx}#e` : undefined];
  if (s.s === 'switch')
    return [...s.cases.map((_, ci) => `${idx}#c${ci}`), s.defaultBody ? `${idx}#d` : undefined];
  return [];
}

/** The occurrences that share one temp each. One group, placed by {@link placementOf}, unless
 *  no occurrence sits in the common block itself, they reach two or more arms of ONE `if` or
 *  `switch` below it, and some branch of that statement has none: those arms are mutually
 *  exclusive (see MUTUALLY EXCLUSIVE ARMS in the header), so each arm is grouped on its own,
 *  and an arm with a single occurrence keeps it. */
function groupsOf(list: readonly Occurrence[], body: readonly Stmt[]): Occurrence[][] {
  const { bp } = placementOf(list);
  if (list.some((o) => o.bp.length === bp.length)) return [[...list]];
  const byArm = new Map<string, Occurrence[]>();
  for (const o of list) {
    const step = o.bp[bp.length]!;
    const at = byArm.get(step);
    if (at) at.push(o);
    else byArm.set(step, [o]);
  }
  const statements = new Set([...byArm.keys()].map((step) => step.split('#')[0]));
  if (byArm.size < 2 || statements.size !== 1) return [[...list]];
  const idx = Number([...statements][0]);
  const unused = branchesOf(blockAt(body, bp)[idx]!, idx).some(
    (step) => step === undefined || !byArm.has(step),
  );
  if (!unused) return [[...list]];
  return [...byArm.values()].filter((arm) => arm.length >= 2).flatMap((arm) => groupsOf(arm, body));
}

function cseFn(f: FuncDecl, writes: FnWrites, reads: FnReads): FuncDecl {
  if (bodyHasRaw(f.body)) return f;
  // A call that writes a binding is not shareable: hoisting `store(i)` to one temp would
  // make two writes one (issue #47).
  if (bodyHasEffectfulCall(f.body, writes)) return f;
  // Non-invariant names: function locals AND any mutated name (incl. a read_write
  // binding written in this fn). A read of a mutated name is not safely shareable, and
  // neither is a call to a helper that reads one (`reads`): `h(x)` is not input-only when
  // `h` reads a `var<private>` this function writes.
  const noHoist = new Set<string>();
  collectLocals(f.body, noHoist);
  collectMutatedRoots(f.body, noHoist, writes);

  // Count occurrences of every compound, input-only subexpression — and record WHERE
  // each one occurs, so the temp can be bound at their common block instead of fn top.
  const counts = new Map<string, number>();
  const exemplar = new Map<string, Expr>();
  const sites = new Map<string, Occurrence[]>();
  eachOccurrence(f.body, [], (e, bp, idx) => {
    if (!isCompound(e) || !isWorthHoisting(e) || refsLocal(e, noHoist, reads)) return;
    const k = keyOf(e);
    counts.set(k, (counts.get(k) ?? 0) + 1);
    if (!exemplar.has(k)) exemplar.set(k, e);
    const at = sites.get(k);
    if (at) at.push({ bp, idx });
    else sites.set(k, [{ bp, idx }]);
  });
  const repeated = new Set<string>([...counts].filter(([, n]) => n >= 2).map(([k]) => k));
  if (repeated.size === 0) return f;

  // Keep only the MAXIMAL repeated exprs — those NOT nested inside another repeated
  // expr. Hoisting the outermost (e.g. `sqrt(dot(p,p))`) binds the whole shared value
  // the developer would have bound by hand, and its replacement subsumes every inner
  // repeat in one temp (vs the inner-only hoist that left `sqrt(_cse0)` repeated). The
  // maximal set never nests itself, so there is still no replacement-ordering interaction,
  // and every member is input-only (refsLocal filtered) so fn-top placement stays valid.
  const nestedInside = new Set<string>();
  for (const k of repeated) {
    eachExpr(exemplar.get(k)!, (sub) => {
      if (sub === exemplar.get(k)) return;
      const sk = keyOf(sub);
      if (repeated.has(sk)) nestedInside.add(sk);
    });
  }
  const maximal = [...repeated].filter((k) => !nestedInside.has(k));
  if (maximal.length === 0) return f;

  // Seed the temp index past any existing `_cseN` binding so a SECOND cse pass
  // cannot redeclare `_cse0`. cse runs TWICE on the optimize()->emitModule() path
  // (optimize includes cse; the WGSL backend's emit-time `optimize` is cse again),
  // and the maximal-only filter can leave a nested repeat un-hoisted when it ALSO
  // occurs standalone — the next pass then hoists it, and a per-call counter reset
  // would emit a colliding `let _cse0`. (noHoist already holds every local, incl.
  // the prior pass's _cseN, via collectLocals.)
  let base = 0;
  for (const n of noHoist) {
    const mm = /^_cse(\d+)$/.exec(n);
    if (mm) base = Math.max(base, Number(mm[1]) + 1);
  }

  // Assign a temp per group of each maximal key and file its `let` under the block +
  // statement index that dominates every use in the group (see PLACEMENT and MUTUALLY
  // EXCLUSIVE ARMS in the header). A temp replaces only the uses inside its block.
  const temps = new Map<string, { bp: readonly string[]; name: string }[]>();
  const plan = new Map<string, Map<number, Stmt[]>>();
  let next = base;
  for (const k of maximal) {
    for (const group of groupsOf(sites.get(k)!, f.body)) {
      const name = `_cse${next++}`;
      const { bp, idx } = placementOf(group);
      const forKey = temps.get(k);
      if (forKey) forKey.push({ bp, name });
      else temps.set(k, [{ bp, name }]);
      const blockKey = bp.join('|');
      let byIdx = plan.get(blockKey);
      if (!byIdx) plan.set(blockKey, (byIdx = new Map()));
      const at = byIdx.get(idx);
      const stmt: Stmt = { s: 'let', name, expr: exemplar.get(k)! };
      if (at) at.push(stmt);
      else byIdx.set(idx, [stmt]);
    }
  }
  if (temps.size === 0) return f;

  const within = (inner: readonly string[], outer: readonly string[]): boolean =>
    outer.length <= inner.length && outer.every((step, i) => step === inner[i]);
  const replace = (e: Expr, bp: readonly string[]): Expr => {
    const t = temps.get(keyOf(e))?.find((c) => within(bp, c.bp));
    if (t !== undefined) return { op: 'varref', type: e.type, name: t.name };
    return mapChildren(e, (x) => replace(x, bp));
  };

  // Rebuild the body, splicing each block's planned lets in before the statement they
  // were filed against. Block paths are constructed IDENTICALLY to eachOccurrence's.
  const rewriteBlock = (body: readonly Stmt[], bp: readonly string[]): Stmt[] => {
    const byIdx = plan.get(bp.join('|'));
    const out: Stmt[] = [];
    body.forEach((s, idx) => {
      const lets = byIdx?.get(idx);
      if (lets) out.push(...lets);
      out.push(rewriteStmt(s, bp, idx));
    });
    return out;
  };
  const rewriteStmt = (s: Stmt, bp: readonly string[], idx: number): Stmt => {
    switch (s.s) {
      case 'if':
        return {
          ...s,
          arms: s.arms.map((a, ai) => ({
            cond: replace(a.cond, bp),
            body: rewriteBlock(a.body, [...bp, `${idx}#a${ai}`]),
          })),
          elseBody: s.elseBody ? rewriteBlock(s.elseBody, [...bp, `${idx}#e`]) : undefined,
        };
      case 'switch':
        return {
          ...s,
          scrut: replace(s.scrut, bp),
          cases: s.cases.map((c, ci) => ({
            values: c.values,
            body: rewriteBlock(c.body, [...bp, `${idx}#c${ci}`]),
          })),
          defaultBody: s.defaultBody ? rewriteBlock(s.defaultBody, [...bp, `${idx}#d`]) : undefined,
        };
      default:
        // `for` included: mapStmtExpr replaces through its whole subtree, which is
        // exactly right — nothing was placed inside it.
        return mapStmtExpr(s, (e) => replace(e, bp));
    }
  };
  return { ...f, body: rewriteBlock(f.body, []) };
}

/**
 * Common-subexpression elimination. For every function in `m`, finds each compound
 * expression that appears two or more times and reads only the function's inputs
 * (parameters, constants and bindings; never a local variable or a name the function
 * writes to), binds it once to a `let`, and replaces every occurrence with a reference
 * to that `let`. The `let` is placed at the top of the innermost block that contains all
 * of the occurrences, just before the first statement that uses it, so a value used only
 * inside one branch is computed only when that branch runs. Occurrences in mutually exclusive
 * arms of one `if` or `switch` that some branch does not use are shared only within each
 * arm. A `let` is never placed
 * inside a loop body. Only the outermost repeated expression is hoisted: two occurrences
 * of `sqrt(dot(p, p))` become one temporary holding the whole value. A function whose
 * body contains raw shader text is returned unchanged.
 *
 * @param m The module to optimize.
 * @returns A new module with the rewritten functions; `m` is not modified.
 */
export function cse(m: ModuleDecl): ModuleDecl {
  const writes = fnWrites(m);
  const reads = fnReads(m);
  return { ...m, funcs: m.funcs.map((f) => cseFn(f, writes, reads)) };
}
