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
//
// === A conditional whose arm is costly is an `if` too (Rule 7.2, change 0097) ===
//
// `select` and the ternary evaluate both arms. A scalar or vector conditional whose arm holds a
// call of a function of the module, a texture read, or 8 or more operations by the measure
// below is hoisted the same way, so the arm not taken does not run. A cheap arm keeps the
// operator, which keeps the lanes of a workgroup together. An arm that holds a derivative, an
// implicit-LOD sample, a barrier, or a call of a function that reaches one keeps the operator
// too: the uniformity analysis (Rule 8.5) ran in the front end on the `select`, and an `if` on
// a non-uniform condition would put the collective operation outside uniform control flow.

import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/nodes.js';
import type { ShaderType } from '../ir/types.js';
import { eachExpr, eachStmtExpr, mapStmtExpr } from '../ir/visit.js';
import { BARRIER_INTRINSICS, DERIVATIVE_INTRINSICS } from '../intrinsics.js';
import { mapExpr } from './opt/ir-transform.js';

interface Counter {
  n: number;
}

/** An arm at or above this cost is hoisted (change 0097, decision D1). */
export const COSTLY_ARM = 8;

/** The cost of an expression by the measure of change 0097: a call of a function of the module
 *  16, a texture builtin 8, any other builtin call 2, an operation or a constructor 1, a
 *  literal, a name, a member or an index 0. `declared` is the set of the module's function
 *  names. */
export function armCost(e: Expr, declared: ReadonlySet<string>): number {
  let cost = 0;
  eachExpr(e, (x) => {
    switch (x.op) {
      case 'call':
        cost +=
          declared.has(x.fn) || x.declRef !== undefined ? 16 : x.fn.startsWith('texture') ? 8 : 2;
        break;
      case 'binop':
      case 'compare':
      case 'logical':
      case 'unop':
      case 'construct':
      case 'select':
      case 'matchExpr':
        cost += 1;
        break;
      default:
        break;
    }
  });
  return cost;
}

/** Whether `e` calls a collective operation (a derivative, an implicit-LOD sample, a barrier)
 *  or a function of `collective`, the module's functions that reach one. */
function holdsCollective(e: Expr, collective: ReadonlySet<string>): boolean {
  let found = false;
  eachExpr(e, (x) => {
    if (x.op !== 'call') return;
    if (DERIVATIVE_INTRINSICS.has(x.fn) || BARRIER_INTRINSICS.has(x.fn) || collective.has(x.fn))
      found = true;
  });
  return found;
}

/** The names of the module's functions that hold a collective operation, directly or through a
 *  function they call: an `if` the pass adds must not hold a call of one. */
export function collectiveFunctions(m: ModuleDecl): ReadonlySet<string> {
  const out = new Set<string>();
  const direct = (f: FuncDecl): boolean => {
    let found = false;
    const visitStmt = (s: Stmt): void =>
      eachStmtExpr(
        s,
        (e) => {
          if (holdsCollective(e, out)) found = true;
        },
        (b) => visitStmt(b),
      );
    f.body.forEach(visitStmt);
    return found;
  };
  // To a fixed point: a function that calls a collective one is collective too.
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of m.funcs) {
      if (!out.has(f.name) && direct(f)) {
        out.add(f.name);
        grew = true;
      }
    }
  }
  return out;
}

/** Whether a target has an operator for a conditional of this type: a scalar or a vector, which
 *  WGSL's `select` builtin takes and GLSL's ternary is allowed for. Everything else is a
 *  composite, and is hoisted. */
const hasOperator = (t: ShaderType): boolean =>
  t.kind === 'scalar' || t.kind === 'vec' || t.kind === 'f64' || t.kind === 'vec64';

/** What the pass knows of the module while it walks a function (change 0097). */
interface Cx {
  readonly counter: Counter;
  readonly declared: ReadonlySet<string>;
  readonly collective: ReadonlySet<string>;
}

/** Whether `e` is a conditional this pass hoists: a composite value chosen by a scalar
 *  condition, or a scalar or vector conditional with a costly arm and no collective operation
 *  in either arm (change 0097). A componentwise select has a vector condition and a vector
 *  value, so it keeps the operator; a shape neither branch expects is left alone and reaches
 *  the backend, which fails loudly rather than being guessed at here. */
function isHoisted(e: Expr, cx: Cx): boolean {
  if (e.op !== 'select' || e.cond.type.kind !== 'scalar') return false;
  if (!hasOperator(e.type)) return true;
  if (armCost(e.ifTrue, cx.declared) < COSTLY_ARM && armCost(e.ifFalse, cx.declared) < COSTLY_ARM)
    return false;
  return !holdsCollective(e.ifTrue, cx.collective) && !holdsCollective(e.ifFalse, cx.collective);
}

/** Rewrite every composite conditional in `m`, and every scalar or vector conditional with a
 *  costly arm (change 0097), into a slot and an `if`. Identity for a module with neither. */
export function selectComposite(m: ModuleDecl): ModuleDecl {
  const cx: Cx = {
    counter: { n: 0 },
    declared: new Set(m.funcs.map((f) => f.name)),
    collective: collectiveFunctions(m),
  };
  if (!m.funcs.some((f) => f.body.some((s) => holdsHoisted(s, cx)))) return m;
  return {
    ...m,
    funcs: m.funcs.map((f) => ({ ...f, body: lowerStmtList(f.body, cx) })),
  };
}

/** Whether a statement, its own expressions or its nested blocks, holds one. */
function holdsHoisted(s: Stmt, cx: Cx): boolean {
  let found = false;
  eachStmtExpr(
    s,
    (e) => {
      eachExpr(e, (x) => {
        if (isHoisted(x, cx)) found = true;
      });
    },
    (b) => {
      if (holdsHoisted(b, cx)) found = true;
    },
  );
  return found;
}

function lowerStmtList(stmts: readonly Stmt[], cx: Cx): Stmt[] {
  const out: Stmt[] = [];
  for (const s of stmts) {
    // A nested block hoists INSIDE itself: a slot lifted out of a loop body and assigned each
    // iteration would run the arms where the loop does not. `match-lower.ts` splits the same
    // way, for the same reason.
    const nested = lowerSubStmts(s, cx);
    const { hoisted, rewritten } = hoistComposites(nested, cx);
    out.push(...hoisted, rewritten);
  }
  return out;
}

function lowerSubStmts(s: Stmt, cx: Cx): Stmt {
  switch (s.s) {
    case 'for':
      return { ...s, body: lowerStmtList(s.body, cx) };
    case 'if':
      return {
        ...s,
        arms: s.arms.map((arm) => ({ ...arm, body: lowerStmtList(arm.body, cx) })),
        elseBody: s.elseBody ? lowerStmtList(s.elseBody, cx) : undefined,
      };
    case 'switch':
      return {
        ...s,
        cases: s.cases.map((c) => ({ ...c, body: lowerStmtList(c.body, cx) })),
        defaultBody: s.defaultBody ? lowerStmtList(s.defaultBody, cx) : undefined,
      };
    default:
      return s;
  }
}

function hoistComposites(s: Stmt, cx: Cx): { hoisted: Stmt[]; rewritten: Stmt } {
  const hoisted: Stmt[] = [];
  const counter = cx.counter;
  // Bottom-up, so a composite inside a composite's arm hoists deepest first and the outer one
  // sees a slot read where its arm was. `mapExpr` is the shared bottom-up rewrite.
  const visit = (walked: Expr): Expr => {
    if (!isHoisted(walked, cx) || walked.op !== 'select') return walked;
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
