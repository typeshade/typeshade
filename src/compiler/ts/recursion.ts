// === WGSL has no call stack: reject a call CYCLE at the call site that closes it ===
//
// A recursive `"use typeshade"` function compiled with zero diagnostics and emitted WGSL that
// Tint refuses (`cyclic dependency found: 'fact' -> 'fact'`) — issue #48. The repository
// already carried a `noRecursion` lint rule, but it is not in `CORE_RULES`, so `validate()`
// never ran it, and the front end ran nothing on its own call graph.
//
// WHY A FRONT-END GRAPH WALK RATHER THAN ADDING THAT RULE TO `CORE_RULES`. Two reasons, and
// the second is the one that decided it:
//
//   1. POSITION. A core-rule failure reaches `compile()` as the single `TS8015` backend
//      diagnostic anchored on the first statement — the file's `"use typeshade"` directive —
//      which tells an author that something is wrong with the file, not which call to delete.
//      Here the diagnostic lands on the offending call expression.
//   2. REACH. `noRecursion` tests `e.op === 'call' && e.fn === fn.name`: a function calling
//      ITSELF. Mutual recursion — `a` calls `b`, `b` calls `a` — is invisible to it, and
//      compiles and emits today just as readily. Tint rejects that too
//      (`cyclic dependency found: 'a' -> 'b' -> 'a'`), so a check that only saw self-calls
//      would close half of #48 and leave the other half looking fixed.
//
// The lint rule is left exactly as it is, and the `fn()` EDSL surface is therefore still open
// at emit time for BOTH shapes, not just the mutual one: `noRecursion` is lint-only, so
// `validate()` is silent and `emitModule` happily emits `fn rec(n: i32) -> i32 { return rec(n); }`
// for a direct self-call too (`lint(m, RULES)` reports it; `lint(m, CORE_RULES)` is empty).
// Closing that is a decision about `CORE_RULES` and belongs with whoever makes it, not a silent
// widening from here.
//
// ═══ A CALL IN STATICALLY DEAD CODE IS STILL A CYCLE ═══
//
// This walks the SYNTAX TREE, and the emitter does not. `optimize.ts`'s `deadBranch` drops a
// branch whose condition folds to false, and DCE drops an unread binding, so on `main` all of
// these compiled and emitted a NON-recursive `fn f` that Tint accepted:
//
//   if (false) { return f(n - 1) }      if (1 > 2) { return f(n - 1) }
//   if (false) { … } else { return n }  const unused = f(n - 1)
//
// They are rejected here. That is deliberate, and it is a rejection of programs that used to
// work — the one place this check is stricter than the target language rather than equal to it.
//
// The alternative was to match the emitter and skip edges under a literal-`false` condition.
// It was not taken, because it makes the rule depend on which folds the optimizer happens to
// do, and the optimizer does not fold what an author would expect. Measured:
//
//   if (false)  { return f(n - 1) }              folded — the call never reaches the emit
//   const DEBUG: bool = false; if (DEBUG) { … }  NOT folded — emits genuinely recursive WGSL
//
// Under the matching rule those two spellings of one idea would get opposite answers, for a
// reason no author could predict from their own source. A syntactic rule is worse in exactly
// one case (dead code that names a cycle) and predictable in every other, which is the trade
// taken here. `docs/use-typeshade-surface.md` §4 says so too, because its "Tint rejects the
// module outright" justification does NOT hold for this class.

import ts from 'typescript';
import type { FuncDecl } from '../../core/ir/nodes.js';
import type { SourceSpan } from '../../core/ir/span.js';
import { eachExpr, eachStmtExpr } from '../../core/ir/visit.js';
import { TS_CODES } from './codes.js';
import { diagnosticAtSpan, makeDiagnostic } from './diagnostic.js';
import type { TsCompilerDiagnostic } from './source-file.js';

/** One node of the call graph, as the caller's own compile path already knows it.
 *
 *  `resolve` is what keeps this usable from both entry points: the single-file path calls a
 *  function by the name it is declared under, while the multi-file path calls it by whatever
 *  local name the `import` bound (`module.ts` already holds that map). Passing the mapping in
 *  rather than re-deriving it here means this module never has to know about imports. */
export interface RecursionNode {
  /** The canonical graph key — the name the emitted WGSL function will carry. */
  readonly name: string;
  /** The name a diagnostic gives it when an author writes it otherwise: `N.f` for the class
   *  static `N_f`. */
  readonly shown?: string;
  readonly decl: ts.FunctionLikeDeclarationBase;
  readonly sourceFile: ts.SourceFile;
  /** A called identifier's text to the canonical name it refers to, or `undefined` when it is
   *  not a user function in this graph (an intrinsic, a constructor, an unknown name). */
  readonly resolve: (callee: string) => string | undefined;
  /** Calls this body makes that are not written in it: a default filled into a call is
   *  spliced in at lowering, so the syntax tree never shows the calls it carries (roadmap 0.3
   *  item T7, #92). Each `to` is already a canonical graph key. */
  readonly filled?: readonly { readonly to: string; readonly node: ts.Node }[];
}

interface Edge {
  readonly to: string;
  readonly node: ts.Node;
  readonly sourceFile: ts.SourceFile;
}

/** Every call this function makes to another graph node, in source order, each paired with the
 *  call expression to anchor a diagnostic on. Nested functions are not a thing the surface has,
 *  so the whole body is one scope to walk. */
/** The name a callee is written under when it is an identifier or a chain of them, joined the
 *  way a namespace's members are flattened: `f`, `A.f` as `A_f`, `A.B.f` as `A_B_f`. */
function dottedName(expr: ts.Expression): string | undefined {
  const parts: string[] = [];
  let node: ts.Expression = expr;
  for (;;) {
    if (ts.isIdentifier(node)) {
      parts.unshift(node.text);
      return parts.join('_');
    }
    if (!ts.isPropertyAccessExpression(node)) return undefined;
    parts.unshift(node.name.text);
    node = node.expression;
  }
}

function edgesOf(fn: RecursionNode): Edge[] {
  const edges: Edge[] = [];
  const body = fn.decl.body;
  if (!body) return edges;
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      // A bare call, and a call through a chain of identifiers, which is how a namespace's
      // function is written (`A.f()`, `A.B.f()`) and how the module names it (`A_f`,
      // `A_B_f`) (roadmap 0.3 item T4, #92). A call on a VALUE has a receiver that is not a
      // chain of identifiers and is not in this graph; Tint still refuses its cycle.
      const written = dottedName(node.expression);
      const to = written === undefined ? undefined : fn.resolve(written);
      if (to !== undefined) edges.push({ to, node, sourceFile: fn.sourceFile });
    }
    ts.forEachChild(node, walk);
  };
  walk(body);
  for (const f of fn.filled ?? []) {
    edges.push({ to: f.to, node: f.node, sourceFile: fn.sourceFile });
  }
  return edges;
}

/** The cycle, arrow-joined the way Tint reports one (`'a' -> 'b' -> 'a'`) but with the DOUBLE
 *  quotes every other diagnostic in this compiler uses for a name. The arrows are Tint's; the
 *  quoting is the house style, and the two differ on purpose. */
function renderCycle(names: readonly string[]): string {
  return names.map((n) => `"${n}"`).join(' -> ');
}

/** A cycle's identity, independent of where the walk happened to enter it, so `a -> b -> a` and
 *  `b -> a -> b` are reported once rather than once per entry point. Rotating to the
 *  lexicographically smallest member is enough: a simple cycle has one such rotation. */
function cycleKey(names: readonly string[]): string {
  let best = 0;
  for (let i = 1; i < names.length; i++) if (names[i]! < names[best]!) best = i;
  return [...names.slice(best), ...names.slice(0, best)].join(' ');
}

/**
 * Report every call cycle in `nodes` as an error on the call that closes it.
 *
 * Depth-first with the usual three colours: a back-edge into a function still on the stack is
 * a cycle, and the stack slice from that function to the current one IS the cycle. Each
 * distinct cycle is reported once, at the call site that closes it — the place an author can
 * actually edit — with the whole cycle named so a two-hop one is not a mystery.
 *
 * @param nodes - the call graph, one entry per user function.
 * @param diagnostics - collector; one error is pushed per distinct cycle.
 */
export function checkRecursion(
  nodes: readonly RecursionNode[],
  diagnostics: TsCompilerDiagnostic[],
): void {
  // Same-named nodes ACCUMULATE their edges rather than the first one winning. Two files can
  // each declare `helper` — `sources.ts` and `module.ts` both check duplicates per file only,
  // so a cross-file DUPLICATE_SYMBOL check is the real missing piece and is not this change's
  // to add — and keeping only the first meant the second's calls left the graph entirely, so a
  // recursive second `helper` reported nothing. The emit is already invalid in that case (Tint:
  // `redeclaration of 'helper'`), but losing a node silently is not how this should fail.
  const outgoing = new Map<string, Edge[]>();
  for (const n of nodes) {
    const prior = outgoing.get(n.name);
    if (prior) prior.push(...edgesOf(n));
    else outgoing.set(n.name, edgesOf(n));
  }

  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  for (const name of outgoing.keys()) colour.set(name, WHITE);
  const stack: string[] = [];
  const reported = new Set<string>();
  const shown = new Map(nodes.map((n) => [n.name, n.shown ?? n.name] as const));

  const visit = (name: string): void => {
    colour.set(name, GREY);
    stack.push(name);
    for (const edge of outgoing.get(name) ?? []) {
      const state = colour.get(edge.to);
      if (state === undefined) continue; // not a graph node after all
      if (state === GREY) {
        const from = stack.lastIndexOf(edge.to);
        const cycle = stack.slice(from);
        const key = cycleKey(cycle);
        if (!reported.has(key)) {
          reported.add(key);
          diagnostics.push(
            makeDiagnostic(
              edge.sourceFile,
              edge.node,
              `Recursive call: ${renderCycle([...cycle, edge.to].map((n) => shown.get(n)!))}. WGSL has no call stack, so a function must not take part in a call cycle.`,
              TS_CODES.RECURSION,
            ),
          );
        }
        continue;
      }
      if (state === WHITE) visit(edge.to);
    }
    stack.pop();
    colour.set(name, BLACK);
  };

  // Declaration order, so the diagnostics of a file with several cycles are stable.
  for (const n of nodes) if (colour.get(n.name) === WHITE) visit(n.name);
}

/**
 * Report the call cycles only the lowered bodies show (Rule 8.4): one that runs through a call
 * on a value (`this.g(n)`, `o.m()`), a getter, a setter or `new`, none of which names a function
 * in its text for `checkRecursion` to follow. Tint was the first to refuse such a module.
 *
 * The same walk, on the calls each body lowered to. A cycle every hop of which `nodes` has too
 * is `checkRecursion`'s, which has said one already. The rest are said here, once per call that
 * closes one: a body a class inherits is lowered once more for that class, and the cycle it
 * closes there is the same mistake in the same place (Rule 12.4), and so is the cycle each
 * instance of a generic function closes. A cycle is named the way an author writes its members,
 * `"N.f" -> "N.g" -> "N.f"`, through `shownOf`.
 */
export function checkLoweredRecursion(
  nodes: readonly RecursionNode[],
  funcs: readonly FuncDecl[],
  shownOf: ReadonlyMap<string, string>,
  nodeOf: ReadonlyMap<string, ts.Node>,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  const written = new Set<string>();
  for (const n of nodes) for (const e of edgesOf(n)) written.add(`${n.name} ${e.to}`);
  const outgoing = new Map<string, { to: string; span: SourceSpan | undefined }[]>();
  for (const f of funcs) {
    const calls: { to: string; span: SourceSpan | undefined }[] = [];
    for (const st of f.body) {
      eachStmtExpr(st, (e) =>
        eachExpr(e, (x) => {
          if (x.op === 'call') calls.push({ to: x.fn, span: (x as { span?: SourceSpan }).span });
        }),
      );
    }
    outgoing.set(f.name, calls);
  }
  const colour = new Map<string, 'grey' | 'black'>();
  const stack: string[] = [];
  const said = new Set<number>();
  const visit = (name: string): void => {
    colour.set(name, 'grey');
    stack.push(name);
    for (const edge of outgoing.get(name) ?? []) {
      if (!outgoing.has(edge.to)) continue; // an intrinsic
      const state = colour.get(edge.to);
      if (state === undefined) visit(edge.to);
      if (state !== 'grey') continue;
      const cycle = [...stack.slice(stack.lastIndexOf(edge.to)), edge.to];
      const hops = cycle.slice(1).map((to, i) => `${cycle[i]} ${to}`);
      const at = edge.span?.start ?? -1;
      if (hops.every((h) => written.has(h)) || said.has(at)) continue;
      said.add(at);
      diagnostics.push(
        diagnosticAtSpan(
          sourceFile,
          edge.span,
          nodeOf.get(name),
          `Recursive call: ${renderCycle(cycle.map((n) => shownOf.get(n) ?? n))}. ` +
            `WGSL has no call stack, so a function must not take part in a call cycle.`,
          TS_CODES.RECURSION,
        ),
      );
    }
    stack.pop();
    colour.set(name, 'black');
  };
  for (const f of funcs) if (!colour.has(f.name)) visit(f.name);
}
