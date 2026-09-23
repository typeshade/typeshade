// === A conditional on a composite is an `if`, because neither target has an operator ===
//
// The IR's `select` is a value chosen by a condition, whatever the type. Emitting it needs an
// operator, and for a struct or a fixed-length array neither target has one. Measured on the
// real backends (issue #113), on a module that compiled with zero diagnostics:
//
//   WGSL   select(Ray, Ray, bool)          Tint: "no matching call to 'select(Ray, Ray, bool)'"
//                                          — `select` is declared for a scalar or a vector, and
//                                          WGSL has no ternary at all
//   GLSL   ((c) ? r1 : r2) on a struct     WebGL2: "'?:' : ternary operator is not allowed for
//          ((c) ? xs : ys) on an array      structures in ESSL 1.0 and webgl" / "…for arrays"
//
// The GLSL half corrects a guess: the ES 3.00 spec's ternary takes any two operands of one
// type, so a reading of the spec says a struct is fine. A real WebGL2 driver says otherwise,
// and the driver is what the emitted code has to satisfy.
//
// So the conditional is hoisted into a slot and an `if`, exactly as `match-lower.ts` hoists a
// multi-arm conditional EXPRESSION into a slot and a `switch`, and for the same reason: the
// targets have the statement, not the expression.
//
//   var _sel0: Ray;
//   if (c) { _sel0 = r1; } else { _sel0 = r2; }
//   … _sel0 …
//
// A helper function would have been shorter to write and WRONG. Its arguments are evaluated
// before the call, so both arms would run; `glsl-legalize.test.ts` has the case that makes that
// visible, an arm holding a call that discards, and a conditional discard becoming an
// unconditional one is worse than the bug. The `if` keeps each arm on its own branch, which is
// what the source says and what the CPU oracle already does.
//
// Neutral, so the shared pre-emit pipeline runs it and both targets get it. The CPU backends
// read the IR, where the conditional is still a conditional, and need none of it.

import type { Expr, ModuleDecl, Stmt } from '../ir/nodes.js';
import type { ShaderType } from '../ir/types.js';
import { eachExpr, eachStmtExpr, mapStmtExpr } from '../ir/visit.js';
import { mapExpr } from './opt/ir-transform.js';

interface Counter {
  n: number;
}

/** Whether a target has an operator for a conditional of this type: a scalar or a vector, which
 *  WGSL's `select` builtin takes and GLSL's ternary is allowed for. Everything else is a
 *  composite, and is hoisted. */
const hasOperator = (t: ShaderType): boolean =>
  t.kind === 'scalar' || t.kind === 'vec' || t.kind === 'f64' || t.kind === 'vec64';

/** Whether `e` is a conditional this pass hoists: a composite value, chosen by a scalar
 *  condition. A componentwise select has a vector condition and a vector value, so it keeps the
 *  operator; a shape neither branch expects is left alone and reaches the backend, which fails
 *  loudly rather than being guessed at here. */
const isComposite = (e: Expr): boolean =>
  e.op === 'select' && !hasOperator(e.type) && e.cond.type.kind === 'scalar';

/** Rewrite every composite conditional in `m` into a slot and an `if`. Identity for a module
 *  whose conditionals are all on scalars and vectors, which is every module in the corpus but
 *  the one that carries the shape on purpose. */
export function selectComposite(m: ModuleDecl): ModuleDecl {
  if (!m.funcs.some((f) => f.body.some(holdsComposite))) return m;
  return {
    ...m,
    funcs: m.funcs.map((f) => ({ ...f, body: lowerStmtList(f.body, { n: 0 }) })),
  };
}

/** Whether a statement, its own expressions or its nested blocks, holds one. */
function holdsComposite(s: Stmt): boolean {
  let found = false;
  eachStmtExpr(
    s,
    (e) => {
      eachExpr(e, (x) => {
        if (isComposite(x)) found = true;
      });
    },
    (b) => {
      if (holdsComposite(b)) found = true;
    },
  );
  return found;
}

function lowerStmtList(stmts: readonly Stmt[], counter: Counter): Stmt[] {
  const out: Stmt[] = [];
  for (const s of stmts) {
    // A nested block hoists INSIDE itself: a slot lifted out of a loop body and assigned each
    // iteration would run the arms where the loop does not. `match-lower.ts` splits the same
    // way, for the same reason.
    const nested = lowerSubStmts(s, counter);
    const { hoisted, rewritten } = hoistComposites(nested, counter);
    out.push(...hoisted, rewritten);
  }
  return out;
}

function lowerSubStmts(s: Stmt, counter: Counter): Stmt {
  switch (s.s) {
    case 'for':
      return { ...s, body: lowerStmtList(s.body, counter) };
    case 'if':
      return {
        ...s,
        arms: s.arms.map((arm) => ({ ...arm, body: lowerStmtList(arm.body, counter) })),
        elseBody: s.elseBody ? lowerStmtList(s.elseBody, counter) : undefined,
      };
    case 'switch':
      return {
        ...s,
        cases: s.cases.map((c) => ({ ...c, body: lowerStmtList(c.body, counter) })),
        defaultBody: s.defaultBody ? lowerStmtList(s.defaultBody, counter) : undefined,
      };
    default:
      return s;
  }
}

function hoistComposites(s: Stmt, counter: Counter): { hoisted: Stmt[]; rewritten: Stmt } {
  const hoisted: Stmt[] = [];
  // Bottom-up, so a composite inside a composite's arm hoists deepest first and the outer one
  // sees a slot read where its arm was. `mapExpr` is the shared bottom-up rewrite.
  const visit = (walked: Expr): Expr => {
    if (!isComposite(walked) || walked.op !== 'select') return walked;
    const name = `_sel${String(counter.n++)}`;
    const slot: Expr = { op: 'varref', type: walked.type, name };
    hoisted.push(
      { s: 'var', name, type: walked.type },
      {
        s: 'if',
        arms: [{ cond: walked.cond, body: [{ s: 'assign', target: slot, expr: walked.ifTrue }] }],
        elseBody: [{ s: 'assign', target: slot, expr: walked.ifFalse }],
      },
    );
    return slot;
  };
  // Only this statement's OWN expressions: its nested blocks were lowered by `lowerSubStmts`
  // above, and hoisting out of one would move the arms to where the block does not run.
  const rewritten = mapStmtExpr(
    s,
    (e) => mapExpr(e, visit),
    (b) => b,
  );
  return { hoisted, rewritten };
}
