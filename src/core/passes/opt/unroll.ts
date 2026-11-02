// ═══ Shader DSL — small fixed-count loop unrolling (Optimization context) ═══
//
// unrollLoops(module) replaces a `for` loop with a COMPILE-TIME-CONSTANT trip
// count by its N straight-line iterations: each copy has the induction variable
// substituted with its per-iteration literal, and its body-declared locals
// alpha-renamed (`_u{k}_name`) so the flattened statements never redeclare a name
// — the same uniquifier inline-linear.ts uses when it lifts a helper's prelude.
// Addresses the "loop optimization: no unroll for small fixed-count loops" gap of
// X-GIS #627 (licm was the only loop pass). Pure (module -> module).
//
// SMALL ONLY. Blind unrolling bloats (a big body copied many times), so — in the
// same node-count unit auto-inline's exprCost uses — a loop unrolls iff its trip
// count is <= MAX_TRIP AND trip x body-node-cost <= MAX_UNROLLED_NODES. Anything
// larger stays a loop. A one-iteration loop grows nothing, so it unrolls whatever its
// body costs (#869). Nested loops unroll inner-first, so the outer budget sees
// the already-expanded body.
//
// INTEGER induction only (i32 / u32). A constant trip count is exact for an integer
// counter on every target; an f32 counter's last-iteration inclusion (and `!=`
// termination) can differ between this f64 oracle and real f32 hardware — the
// codebase's worst bug class — so f32 loops are left to a future pass gated by the
// real-GPU differential, not decided by this f32-blind one.
//
// A bound or start may be an integer module constant (`i < AA`, #869), read from the
// module's ConstDecl; any other non-literal stays unprovable.
//
// SKIPS (leave the loop; never unroll unsoundly):
//   • non-constant init / bound / step, or a trip count that doesn't terminate
//     within the small-loop cap → not a provable fixed-count loop;
//   • the induction var is reassigned or shadowed anywhere in the body → its
//     per-iteration literal would be wrong;
//   • a break / continue that targets THIS loop (one nested in an inner `for` is
//     that loop's, and fine) → no loop remains to carry it;
//   • an unconditional top-level return / discard → the loop runs <= 1 time, so the
//     later copies would be statically-unreachable code;
//   • a raw WGSL Stmt in the fn → opaque (same bail as licm / gvn).
//
// Bit-exact for integer counters (pure duplication + literal substitution — no
// float arithmetic is introduced), so no f32 differential gate is needed; pinned by
// oracle value-equality like cse / gvn / licm.
//
// In DEFAULT_PASSES since #845. After unrolling a block it promotes the vars the copies
// write to chains of `let`s (`promoteWrites`, ./promote-vars), so const-prop and const-fold
// carry the loop's state through the copies and DCE drops its last updates. Large loops
// (64-step ray marches and the like) stay loops: they exceed MAX_TRIP or MAX_UNROLLED_NODES.
// loop-load-reuse shares the bounded unrolling proof and rewrite below, but only
// expands a loop after proving that a small storage slice can be reused.

import type { CmpOp, Expr, Stmt, ModuleDecl, FuncDecl, ShaderType } from '../../ir/index.js';
import { mapExpr, mapStmt } from './ir-transform.js';
import { eachStmtExpr } from '../../ir/visit.js';
import { fnWrites, type FnWrites } from '../effects.js';
import { promoteWrites } from './promote-vars.js';
import { bodyHasRaw, collectLocals, collectMutatedRoots, eachExpr } from './expr-utils.js';

type ForStmt = Extract<Stmt, { s: 'for' }>;

// "Small": at most MAX_TRIP iterations, and the unrolled body (trip x node-cost)
// under MAX_UNROLLED_NODES — the growth budget. SIM_CAP bounds the trip-count
// simulation so a loop whose counter never reaches its bound is rejected outright,
// not enumerated forever (MAX_TRIP already bails long before it, in practice).
const MAX_TRIP = 8;
const MAX_UNROLLED_NODES = 64;
const SIM_CAP = 1024;

/** A plain numeric constant — a literal, or a negated literal (`unop` = negate). */
/** Integer module constants by name, for a loop bound such as `i < AA` (#869). */
export type IntConsts = ReadonlyMap<string, number>;
const NO_CONSTS: IntConsts = new Map();

function constNum(e: Expr, consts: IntConsts = NO_CONSTS): number | undefined {
  if (e.op === 'lit' && typeof e.value === 'number') return e.value;
  if (e.op === 'unop' && e.a.op === 'lit' && typeof e.a.value === 'number') return -e.a.value;
  if (e.op === 'constref') return consts.get(e.name);
  return undefined;
}

/** The module's `i32` / `u32` scalar constants whose value is one exact integer on every
 *  backend: a literal `valueExpr`, or a `wgslValue` equal to its `cpuValue`. */
export function intConsts(m: ModuleDecl): IntConsts {
  const out = new Map<string, number>();
  for (const c of m.consts) {
    const t = c.type;
    if (!(t.kind === 'scalar' && (t.scalar === 'i32' || t.scalar === 'u32'))) continue;
    const v =
      c.valueExpr === undefined
        ? c.wgslValue === c.cpuValue
          ? c.wgslValue
          : undefined
        : c.valueExpr.op === 'lit' && typeof c.valueExpr.value === 'number'
          ? c.valueExpr.value
          : undefined;
    if (v !== undefined && Number.isInteger(v)) out.set(c.name, v);
  }
  return out;
}

const isVar = (e: Expr, name: string): boolean => e.op === 'varref' && e.name === name;

/** `a <cop> b` restated as `b <flip> a` — for a cond with the counter on the right. */
function flipCmp(cop: CmpOp): CmpOp {
  switch (cop) {
    case '<':
      return '>';
    case '>':
      return '<';
    case '<=':
      return '>=';
    case '>=':
      return '<=';
    default:
      return cop; // == / != are symmetric
  }
}

function cmpHolds(cop: CmpOp, v: number, bound: number): boolean {
  switch (cop) {
    case '<':
      return v < bound;
    case '>':
      return v > bound;
    case '<=':
      return v <= bound;
    case '>=':
      return v >= bound;
    case '==':
      return v === bound;
    case '!=':
      return v !== bound;
  }
}

/** The counter compare `i <cop> bound` (normalised so `i` is on the left), or
 *  undefined if `cond` isn't a comparison of the counter against a constant. */
function readCond(
  cond: Expr,
  name: string,
  consts: IntConsts,
): { cop: CmpOp; bound: number } | undefined {
  if (cond.op !== 'compare') return undefined;
  if (isVar(cond.a, name)) {
    const bound = constNum(cond.b, consts);
    return bound === undefined ? undefined : { cop: cond.cop, bound };
  }
  if (isVar(cond.b, name)) {
    const bound = constNum(cond.a, consts);
    return bound === undefined ? undefined : { cop: flipCmp(cond.cop), bound };
  }
  return undefined;
}

/** The signed per-iteration step of `name` from `i = i + c` / `i = c + i` /
 *  `i = i - c` / `i += c` / `i -= c`, or undefined if `update` isn't that shape. */
function readStep(update: Stmt, name: string): number | undefined {
  if (update.s === 'assignOp') {
    if (!isVar(update.target, name)) return undefined;
    const c = constNum(update.expr);
    if (c === undefined) return undefined;
    if (update.bop === '+') return c;
    if (update.bop === '-') return -c;
    return undefined;
  }
  if (update.s === 'assign') {
    if (!isVar(update.target, name)) return undefined;
    const e = update.expr;
    if (e.op !== 'binop') return undefined;
    if (e.bop === '+') {
      if (isVar(e.a, name)) return constNum(e.b);
      if (isVar(e.b, name)) return constNum(e.a);
      return undefined;
    }
    if (e.bop === '-' && isVar(e.a, name)) {
      const c = constNum(e.b);
      return c === undefined ? undefined : -c;
    }
    return undefined;
  }
  return undefined;
}

interface LoopInfo {
  name: string;
  type: ShaderType;
  seq: readonly number[];
}

/** Prove `s` a small integer fixed-count loop and return its induction var name +
 *  type + the exact sequence of counter values, or undefined if unprovable / big.
 *  Internal shared proof for loop-load-reuse; not re-exported by the optimizer barrel. */
export function analyzeLoop(
  s: ForStmt,
  maxTrip = MAX_TRIP,
  consts: IntConsts = NO_CONSTS,
): LoopInfo | undefined {
  if (s.init.s !== 'var' || s.init.init === undefined) return undefined;
  const type = s.init.type;
  // Integer counter only — an f32 trip count can diverge on real f32 hardware.
  if (!(type.kind === 'scalar' && (type.scalar === 'i32' || type.scalar === 'u32')))
    return undefined;
  const name = s.init.name;
  const start = constNum(s.init.init, consts);
  if (start === undefined) return undefined;
  const cond = readCond(s.cond, name, consts);
  if (cond === undefined) return undefined;
  const step = readStep(s.update, name);
  if (step === undefined || step === 0) return undefined;

  // Simulate in the counter type's modular RANGE, not unbounded JS. A value that
  // leaves [lo, hi] wraps on i32 / u32 hardware — a u32 counter stepping below 0
  // becomes 0xffffffff, making `i >= 0u` an infinite loop the JS sim would instead
  // exit at −1 and "unroll" to a finite body. Reject such a loop rather than emit an
  // unsound trip count; this is what keeps the header's "exact for an integer counter
  // on every target" true.
  const lo = type.scalar === 'u32' ? 0 : -0x80000000;
  const hi = type.scalar === 'u32' ? 0xffffffff : 0x7fffffff;

  const seq: number[] = [];
  let v = start;
  for (let guard = 0; guard < SIM_CAP; guard++) {
    if (v < lo || v > hi) return undefined; // would wrap on hardware — the JS sim diverges
    if (!cmpHolds(cond.cop, v, cond.bound)) return { name, type, seq };
    seq.push(v);
    if (seq.length > maxTrip) return undefined; // not "small"
    v += step;
  }
  return undefined; // never terminated within the cap
}

/** A break / continue that belongs to THIS loop (one inside a nested `for` is that
 *  loop's — we don't descend into it). Conservatively also treats a switch-bound
 *  `break` as escaping (we descend into switch / if): the safe side skips a loop we
 *  could have unrolled, never unrolls one we shouldn't. */
function hasEscapingBreakContinue(body: readonly Stmt[]): boolean {
  for (const s of body) {
    if (s.s === 'break' || s.s === 'continue') return true;
    if (s.s === 'if') {
      if (s.arms.some((a) => hasEscapingBreakContinue(a.body))) return true;
      if (s.elseBody && hasEscapingBreakContinue(s.elseBody)) return true;
    } else if (s.s === 'switch') {
      if (s.cases.some((c) => hasEscapingBreakContinue(c.body))) return true;
      if (s.defaultBody && hasEscapingBreakContinue(s.defaultBody)) return true;
    }
    // 'for' — a nested loop captures its own break / continue; do not descend.
  }
  return false;
}

/** The induction literal can be substituted everywhere and the copies concatenated
 *  iff the body neither redefines the counter nor carries loop-level control flow. */
function bodyIsUnrollable(body: readonly Stmt[], name: string): boolean {
  const clobbered = new Set<string>();
  collectLocals(body, clobbered); // a shadowing `let i` / nested `for i`
  collectMutatedRoots(body, clobbered); // an `i = …` reassignment
  if (clobbered.has(name)) return false;
  // An unconditional top-level return / discard runs the loop <= 1x; the later
  // copies would be unreachable. (A return / discard nested in an `if` is
  // reachable when the branch isn't taken — allowed.)
  if (body.some((s) => s.s === 'return' || s.s === 'discard')) return false;
  if (hasEscapingBreakContinue(body)) return false;
  return true;
}

/** Expression-node count of a body — the growth-budget unit (auto-inline exprCost).
 *  eachStmtExpr already descends nested bodies, so an inner (already-unrolled)
 *  loop is counted, which is what bounds nested expansion. */
function bodyNodeCost(body: readonly Stmt[]): number {
  let n = 0;
  for (const s of body)
    eachStmtExpr(s, (e) =>
      eachExpr(e, () => {
        n++;
      }),
    );
  return n;
}

/** Rename every body-declared name (both its declaration and its references) via
 *  `ren`; references to names NOT in `ren` (params, outer accumulators, the counter
 *  itself) pass through untouched. */
function renameLocals(s: Stmt, ren: ReadonlyMap<string, string>): Stmt {
  const R = (e: Expr): Expr =>
    mapExpr(e, (x) =>
      (x.op === 'varref' || x.op === 'param') && ren.has(x.name)
        ? { ...x, name: ren.get(x.name)! }
        : x,
    );
  const nm = (name: string): string => ren.get(name) ?? name;
  switch (s.s) {
    case 'let':
      return { s: 'let', name: nm(s.name), expr: R(s.expr) };
    case 'var':
      return s.init !== undefined
        ? { s: 'var', name: nm(s.name), type: s.type, init: R(s.init) }
        : { s: 'var', name: nm(s.name), type: s.type };
    case 'assign':
    case 'assignOp':
      return { ...s, target: R(s.target), expr: R(s.expr) };
    case 'call':
      return { ...s, expr: R(s.expr) };
    case 'return':
      return s.expr !== undefined ? { ...s, expr: R(s.expr) } : s;
    case 'if':
      return {
        ...s,
        arms: s.arms.map((a) => ({
          cond: R(a.cond),
          body: a.body.map((b) => renameLocals(b, ren)),
        })),
        elseBody: s.elseBody?.map((b) => renameLocals(b, ren)),
      };
    case 'for':
      return {
        ...s,
        init: renameLocals(s.init, ren),
        cond: R(s.cond),
        update: renameLocals(s.update, ren),
        body: s.body.map((b) => renameLocals(b, ren)),
      };
    case 'switch':
      return {
        ...s,
        scrut: R(s.scrut),
        cases: s.cases.map((c) => ({
          values: c.values,
          body: c.body.map((b) => renameLocals(b, ren)),
        })),
        defaultBody: s.defaultBody?.map((b) => renameLocals(b, ren)),
      };
    default:
      return s; // break / continue / discard / placeholder / raw — no names / sub-exprs
  }
}

/** Replace the counter `name` with its per-iteration literal everywhere in `s`. */
function substCounter(s: Stmt, name: string, lit: Expr): Stmt {
  return mapStmt(s, (e) => (e.op === 'varref' && e.name === name ? lit : e));
}

/** Unroll a fixed-count loop into its concatenated iterations, or undefined if the
 *  loop isn't a small provable fixed-count loop this pass can flatten safely.
 *  loop-load-reuse supplies a bounded larger budget only after proving storage reuse. */
export function tryUnroll(
  s: ForStmt,
  counter: { n: number },
  maxNodes = MAX_UNROLLED_NODES,
  maxTrip = MAX_TRIP,
  consts: IntConsts = NO_CONSTS,
): Stmt[] | undefined {
  const info = analyzeLoop(s, maxTrip, consts);
  if (info === undefined) return undefined;
  if (!bodyIsUnrollable(s.body, info.name)) return undefined;
  // The budget bounds growth. One iteration copies the body once and drops the counter,
  // the compare and the step, so it grows nothing and is exempt (#869).
  if (info.seq.length > 1 && info.seq.length * bodyNodeCost(s.body) > maxNodes) return undefined;

  const locals = new Set<string>();
  collectLocals(s.body, locals);
  const out: Stmt[] = [];
  for (const v of info.seq) {
    const suf = counter.n++;
    const ren = new Map<string, string>();
    // Strip one leading underscore so `_u{suf}_` + `_cse0` doesn't form the GLSL-ES
    // reserved `__` join (same guard inline-linear.ts uses).
    for (const local of locals) ren.set(local, `_u${suf}_${local.replace(/^_/, '')}`);
    const lit: Expr = { op: 'lit', type: info.type, value: v };
    for (const st of s.body) {
      const renamed = ren.size > 0 ? renameLocals(st, ren) : st;
      out.push(substCounter(renamed, info.name, lit));
    }
  }
  return out;
}

/** Rebuild a block, unrolling each fixed-count `for` (inner loops first) and
 *  recursing through `if` / `switch` bodies. */
interface UnrollCx {
  readonly counter: { n: number };
  readonly writes: FnWrites;
  readonly taken: Set<string>;
  readonly consts: IntConsts;
}

function unrollBlock(body: readonly Stmt[], cx: UnrollCx): readonly Stmt[] {
  const out: Stmt[] = [];
  const written = new Set<string>();
  for (const s of body) {
    if (s.s === 'for') {
      const loop: ForStmt = { ...s, body: unrollBlock(s.body, cx) }; // inner-first
      const copies = tryUnroll(loop, cx.counter, MAX_UNROLLED_NODES, MAX_TRIP, cx.consts);
      if (copies !== undefined) {
        out.push(...copies);
        collectMutatedRoots(copies, written, cx.writes);
      } else out.push(loop);
    } else if (s.s === 'if') {
      out.push({
        ...s,
        arms: s.arms.map((a) => ({ cond: a.cond, body: unrollBlock(a.body, cx) })),
        elseBody: s.elseBody ? unrollBlock(s.elseBody, cx) : undefined,
      });
    } else if (s.s === 'switch') {
      out.push({
        ...s,
        cases: s.cases.map((c) => ({ values: c.values, body: unrollBlock(c.body, cx) })),
        defaultBody: s.defaultBody ? unrollBlock(s.defaultBody, cx) : undefined,
      });
    } else {
      out.push(s);
    }
  }
  // The state the copies carry from one to the next becomes values (#845, ./promote-vars).
  return written.size === 0 ? out : promoteWrites(out, written, cx.writes, cx.taken);
}

/** The next fresh `_u{k}_` suffix for `body` — past any suffix an EARLIER unroll pass
 *  already emitted. unrollLoops re-runs on the optimize()->emitModule() fixpoint (an
 *  enabling pass such as constProp can expose a newly-unrollable loop between runs), so
 *  a per-call reset to 0 would re-mint a `_u0_` that redeclares the first pass's
 *  flattened copy in the same fn scope — a naga / tint error the oracle's value-equality
 *  gate cannot see. Same guard cse.ts applies to its `_cseN` temps. */
export function seedSuffix(body: readonly Stmt[]): number {
  const names = new Set<string>();
  collectLocals(body, names);
  let n = 0;
  for (const name of names) {
    const mm = /^_u(\d+)_/.exec(name);
    if (mm) n = Math.max(n, Number(mm[1]) + 1);
  }
  return n;
}

/** Unroll small fixed-count loops throughout a module. Pure (module -> module). */
export function unrollLoops(m: ModuleDecl): ModuleDecl {
  const consts = intConsts(m);
  return {
    ...m,
    funcs: m.funcs.map((f): FuncDecl =>
      // A raw WGSL stmt is opaque (it may reference the counter textually) — bail
      // the whole fn, exactly as licm / gvn do.
      bodyHasRaw(f.body)
        ? f
        : {
            ...f,
            body: unrollBlock(f.body, {
              counter: { n: seedSuffix(f.body) },
              writes: fnWrites(m),
              taken: localNames(f),
              consts,
            }),
          },
    ),
  };
}

function localNames(f: FuncDecl): Set<string> {
  const taken = new Set<string>(f.params.map((p) => p.name));
  const scan = (s: Stmt): void => {
    if (s.s === 'let' || s.s === 'var') taken.add(s.name);
    eachStmtExpr(s, () => {}, scan);
  };
  for (const s of f.body) scan(s);
  return taken;
}
