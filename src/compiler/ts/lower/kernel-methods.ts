// Implements: Rule 8.22 (docs/language-design.md; traced in reqs/).
// ═══ An array's methods on a kernel function's array (change 0079) ═══
//
// `xs.forEach(f)`, `xs.reduce(f, init)`, `xs.some(p)` and `xs.every(p)` on a kernel function's
// array parameter lower, as on any array, to a call of a function made for the method
// (`array-methods.ts`). That function reads the kernel function's own parameter, so it is no
// function of the module: this file writes its body into the kernel function's body, where its
// loop stands at the statement the call was in. A loop at the top level is a candidate loop, which
// the proof (Rule 8.22) runs on the GPU when it accepts it, and one inside a loop is a loop inside
// each iteration.
//
// The function handed to the method is written in too, so the proof reads its body as the body of
// the loop: `(a, x) => a + x` becomes `acc = acc + xs[i]`, R3's reduction form. A value the call
// hands it is a `let`, or the variable itself where the function writes through it (`inout`) or
// where it is a name the function does not assign. The function's own names are renamed so they
// meet none of the kernel function's.

import type { Expr, FuncDecl, Stmt } from '../../../core/ir/nodes.js';
import { mapChildren, mapStmtExpr } from '../../../core/ir/visit.js';
import { KERNEL_LOOPS } from './array-methods.js';

/** The functions a method on a kernel function's array handed its elements to, written into a
 *  kernel function's body. */
const WRITTEN_IN = new WeakSet<FuncDecl>();

/** `funcs` without the functions that exist only to be written into a kernel function's body: a
 *  method's loop, and a function it hands the elements to that takes a kernel function's array,
 *  which no target can emit. Any other function handed over stays, as it is today. */
export function withoutKernelLoops(funcs: readonly FuncDecl[]): FuncDecl[] {
  return funcs.filter(
    (f) =>
      !KERNEL_LOOPS.has(f) &&
      !(
        WRITTEN_IN.has(f) &&
        f.params.some((p) => p.type.kind === 'array' && p.type.size === undefined)
      ),
  );
}

/** Why a call could not be written into the kernel function's body, for the caller to word. */
export interface KernelInlineGap {
  readonly fn: string;
  readonly why: 'return' | 'header';
}

/** `body` with every call of a function made for a method on a kernel function's array written
 *  into it, and each function such a call hands its elements to. `params` are the kernel
 *  function's parameters; `gaps` collects each call that could not be written in. */
export function inlineKernelMethods(
  body: readonly Stmt[],
  params: readonly string[],
  gaps: KernelInlineGap[],
  names: Map<string, string>,
): Stmt[] {
  const taken = new Set(params);
  const visit = (x: Expr): Expr => {
    if (x.op === 'varref') taken.add(x.name);
    return mapChildren(x, visit);
  };
  const declared = (s: Stmt): Stmt => {
    if (s.s === 'let' || s.s === 'var') taken.add(s.name);
    return mapStmtExpr(s, visit, declared);
  };
  body.forEach(declared);
  const fresh = (base: string): string => {
    let name = `${base}_k`;
    for (let n = 1; taken.has(name); n++) name = `${base}_k${String(n)}`;
    taken.add(name);
    return name;
  };
  return block(body, new Set(), { fresh, gaps, names });
}

interface Ctx {
  readonly fresh: (base: string) => string;
  readonly gaps: KernelInlineGap[];
  /** Each name this file makes, as the author wrote it, for `TS8070` (Rule 8.22). */
  readonly names: Map<string, string>;
}

/** The calls to write in: a method's loop, and inside one, the function it calls. */
const inlined = (e: Expr, callbacks: ReadonlySet<FuncDecl>): FuncDecl | undefined =>
  e.op === 'call' &&
  e.declRef !== undefined &&
  (KERNEL_LOOPS.has(e.declRef) || callbacks.has(e.declRef))
    ? e.declRef
    : undefined;

function block(sts: readonly Stmt[], callbacks: ReadonlySet<FuncDecl>, c: Ctx): Stmt[] {
  const out: Stmt[] = [];
  for (const st of sts) out.push(...statement(st, callbacks, c));
  return out;
}

function statement(st: Stmt, callbacks: ReadonlySet<FuncDecl>, c: Ctx): Stmt[] {
  const nested = (sts: readonly Stmt[]): Stmt[] => block(sts, callbacks, c);
  // The bodies inside it first.
  let s: Stmt = st;
  if (s.s === 'if') {
    s = {
      ...s,
      arms: s.arms.map((a) => ({ cond: a.cond, body: nested(a.body) })),
      ...(s.elseBody !== undefined ? { elseBody: nested(s.elseBody) } : {}),
    };
  } else if (s.s === 'for') {
    // A call in the header runs on every iteration, where no statement can stand before it.
    const header =
      [s.init, s.update].some((h) => callsIn(h, callbacks)) || hasCall(s.cond, callbacks);
    if (header) {
      const fn = firstCall([s.init, s.update], s.cond, callbacks);
      if (fn !== undefined) c.gaps.push({ fn: fn.name, why: 'header' });
    }
    s = { ...s, body: nested(s.body) };
  } else if (s.s === 'switch') {
    s = {
      ...s,
      cases: s.cases.map((c) => ({ values: c.values, body: nested(c.body) })),
      ...(s.defaultBody !== undefined ? { defaultBody: nested(s.defaultBody) } : {}),
    };
  }
  if (s.s === 'for') return [s];

  // `let x = xs.reduce(…)`: the method's own running value becomes `x`.
  if ((s.s === 'let' || s.s === 'var') && (s.s === 'let' ? s.expr : s.init) !== undefined) {
    const value = s.s === 'let' ? s.expr : s.init!;
    const fn = inlined(value, callbacks);
    if (fn !== undefined) {
      const w = written(value as Expr & { op: 'call' }, fn, callbacks, c);
      if (w === undefined) return [s];
      const result = w.result;
      const own = result?.op === 'varref' ? w.declared.get(result.name) : undefined;
      if (own !== undefined && result !== undefined && result.op === 'varref') {
        c.names.delete(result.name);
        return w.before.map((b) => rename(b, result.name, s.name));
      }
      if (result !== undefined)
        return [
          ...w.before,
          { ...s, ...(s.s === 'let' ? { expr: result } : { init: result }) } as Stmt,
        ];
    }
  }

  // Every other place: each call's statements go before the statement, and its value stands
  // where the call stood.
  const before: Stmt[] = [];
  const rewrite = (e: Expr): Expr => {
    const x = mapChildren(e, rewrite);
    const fn = inlined(x, callbacks);
    if (fn === undefined) return x;
    const w = written(x as Expr & { op: 'call' }, fn, callbacks, c);
    if (w === undefined) return x;
    before.push(...w.before);
    if (w.result === undefined) return VOID;
    return w.result;
  };
  const shallow = mapStmtExpr(s, rewrite, (b) => b);
  // A call that was a statement of its own leaves its statements alone.
  if (shallow.s === 'call' && shallow.expr === VOID) return before;
  return [...before, shallow];
}

/** What a written-in void call leaves where it stood, which only a call statement holds. */
const VOID: Expr = { op: 'lit', type: { kind: 'void' }, value: 0 } as unknown as Expr;

function callsIn(s: Stmt, callbacks: ReadonlySet<FuncDecl>): boolean {
  let found = false;
  mapStmtExpr(s, (e) => {
    if (hasCall(e, callbacks)) found = true;
    return e;
  });
  return found;
}

function hasCall(e: Expr, callbacks: ReadonlySet<FuncDecl>): boolean {
  let found = false;
  const visit = (x: Expr): Expr => {
    if (inlined(x, callbacks) !== undefined) found = true;
    return mapChildren(x, visit);
  };
  visit(e);
  return found;
}

function firstCall(
  sts: readonly Stmt[],
  cond: Expr,
  callbacks: ReadonlySet<FuncDecl>,
): FuncDecl | undefined {
  let fn: FuncDecl | undefined;
  const visit = (x: Expr): Expr => {
    fn ??= inlined(x, callbacks);
    return mapChildren(x, visit);
  };
  for (const s of sts) mapStmtExpr(s, visit);
  visit(cond);
  return fn;
}

/** The statements a call of `fn` is, written in, and the value it gives. */
function written(
  call: Expr & { op: 'call' },
  fn: FuncDecl,
  callbacks: ReadonlySet<FuncDecl>,
  c: Ctx,
): { before: Stmt[]; result: Expr | undefined; declared: Map<string, Stmt> } | undefined {
  const last = fn.body[fn.body.length - 1];
  const tail = last?.s === 'return' ? last.expr : undefined;
  const lead = last?.s === 'return' ? fn.body.slice(0, -1) : fn.body;
  const fresh = c.fresh;
  if (lead.some(returns)) {
    c.gaps.push({ fn: fn.name, why: 'return' });
    return undefined;
  }
  // The values the call hands over.
  const assigned = assignedNames(fn.body);
  const subst = new Map<string, Expr>();
  const before: Stmt[] = [];
  fn.params.forEach((p, k) => {
    const arg = call.args[k];
    if (arg === undefined) return;
    const name =
      arg.op === 'varref' || arg.op === 'param' || arg.op === 'lit' || arg.op === 'constref';
    if (p.mode === 'inout' || (name && !assigned.has(p.name))) {
      subst.set(p.name, arg);
      // A method's running value reads as the name the function handed over gives it.
      if (arg.op === 'varref' && arg.name.startsWith('_') && !c.names.has(arg.name))
        c.names.set(arg.name, p.name);
      return;
    }
    const local = fresh(p.name);
    c.names.set(local, p.name);
    before.push(
      assigned.has(p.name)
        ? { s: 'var', name: local, type: p.type, init: arg }
        : { s: 'let', name: local, expr: arg },
    );
    subst.set(p.name, { op: 'varref', type: p.type, name: local });
  });
  // The function's own names, renamed.
  const locals = new Map<string, string>();
  const declared = new Map<string, Stmt>();
  const collect = (sts: readonly Stmt[]): void => {
    for (const s of sts) {
      if (s.s === 'let' || s.s === 'var') {
        // A method's own names start with `_`, which `TS8070` reads as no name the author wrote.
        const made = KERNEL_LOOPS.has(fn);
        const to = fresh(made ? `_${s.name}` : s.name);
        if (!made) c.names.set(to, s.name);
        locals.set(s.name, to);
        if (sts === lead) declared.set(to, s);
      }
      if (s.s === 'if') {
        s.arms.forEach((a) => collect(a.body));
        if (s.elseBody !== undefined) collect(s.elseBody);
      } else if (s.s === 'for') {
        collect([s.init]);
        collect(s.body);
      } else if (s.s === 'switch') {
        s.cases.forEach((c) => collect(c.body));
        if (s.defaultBody !== undefined) collect(s.defaultBody);
      }
    }
  };
  collect(lead);
  const expr = (e: Expr): Expr => {
    const x = mapChildren(e, expr);
    if (x.op === 'param' && subst.has(x.name)) return subst.get(x.name)!;
    if (x.op === 'varref' && locals.has(x.name)) return { ...x, name: locals.get(x.name)! };
    return x;
  };
  // A method's statements carry the span of the call, so `TS8070` names its line.
  const at = KERNEL_LOOPS.has(fn) ? call.span : undefined;
  const stmt = (s: Stmt): Stmt => {
    const t0 = mapStmtExpr(s, expr, stmt);
    const t = at !== undefined && t0.span === undefined ? ({ ...t0, span: at } as Stmt) : t0;
    if ((t.s === 'let' || t.s === 'var') && locals.has(t.name))
      return { ...t, name: locals.get(t.name)! };
    if (t.s === 'for' && t.counted !== undefined && locals.has(t.counted.name))
      return { ...t, counted: { ...t.counted, name: locals.get(t.counted.name)! } };
    return t;
  };
  const body = lead.map(stmt);
  // A call this function's own body makes of the function the method was handed is written in
  // too, so the proof reads it as the body of the loop.
  const handed = new Set(callbacks);
  if (KERNEL_LOOPS.has(fn))
    for (const c of calledIn(fn.body)) {
      handed.add(c);
      WRITTEN_IN.add(c);
    }
  before.push(...block(body, handed, c));
  let result = tail === undefined ? undefined : expr(tail);
  if (result !== undefined && hasCall(result, handed)) {
    const st = statement({ s: 'let', name: fresh('_r'), expr: result }, handed, c);
    const lastSt = st[st.length - 1]!;
    before.push(...st.slice(0, -1));
    if (lastSt.s === 'let') result = lastSt.expr;
    else before.push(lastSt);
  }
  const declaredOut = new Map<string, Stmt>();
  for (const [name, s] of declared) declaredOut.set(name, s);
  return { before, result, declared: declaredOut };
}

/** The functions a body calls by a declaration. */
function calledIn(body: readonly Stmt[]): FuncDecl[] {
  const out: FuncDecl[] = [];
  const visit = (x: Expr): Expr => {
    if (x.op === 'call' && x.declRef !== undefined) out.push(x.declRef);
    return mapChildren(x, visit);
  };
  const stmt = (s: Stmt): Stmt => mapStmtExpr(s, visit, stmt);
  body.forEach(stmt);
  return out;
}

function returns(s: Stmt): boolean {
  if (s.s === 'return') return true;
  if (s.s === 'if')
    return s.arms.some((a) => a.body.some(returns)) || (s.elseBody?.some(returns) ?? false);
  if (s.s === 'for') return s.body.some(returns);
  if (s.s === 'switch')
    return s.cases.some((c) => c.body.some(returns)) || (s.defaultBody?.some(returns) ?? false);
  return false;
}

/** The parameters a body assigns. */
function assignedNames(body: readonly Stmt[]): Set<string> {
  const out = new Set<string>();
  const root = (e: Expr): Expr => (e.op === 'index' || e.op === 'member' ? root(e.base) : e);
  const stmt = (s: Stmt): Stmt => {
    if (s.s === 'assign' || s.s === 'assignOp') {
      const r = root(s.target);
      if (r.op === 'param') out.add(r.name);
    }
    return mapStmtExpr(s, (e) => e, stmt);
  };
  body.forEach(stmt);
  return out;
}

/** `s` with the variable `from` named `to`: its declaration and every read and write of it. */
function rename(s: Stmt, from: string, to: string): Stmt {
  const expr = (e: Expr): Expr => {
    const x = mapChildren(e, expr);
    return x.op === 'varref' && x.name === from ? { ...x, name: to } : x;
  };
  const stmt = (t: Stmt): Stmt => {
    const u = mapStmtExpr(t, expr, stmt);
    return (u.s === 'let' || u.s === 'var') && u.name === from ? { ...u, name: to } : u;
  };
  return stmt(s);
}
