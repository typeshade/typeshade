// ═══ grad — forward-mode differentiation of a function's IR (roadmap 0.7 item 18) ═══
//
// `grad(m, 'f', 'k')` adds a function to the module that returns the derivative of `f`'s
// result with respect to its parameter `k`, at the same arguments. It is an IR → IR pass and
// nothing else: the new function is ordinary IR, so the WGSL writer, the GLSL writer and the
// CPU oracle take it as they take any other function, and the oracle can check it against a
// finite difference.
//
// FORWARD MODE, as dual numbers written out. Every value of a differentiable type (`f32`, an
// `f32` vector, an `f32` matrix) gets a TANGENT beside it: `let y = x * x` becomes
// `let y = x * x; let d_y = d_x * x + x * d_x`. The primal statements stay, since the tangent
// of a product reads the primal operands, and the optimizer drops the ones nothing reads. The
// language has no pointers, no recursion and only bounded loops, so one walk over the body is
// the whole transform: `if`, `switch` and `for` keep their primal conditions and carry the
// tangents through their bodies.
//
// A tangent is `null` where it is known to be zero: a literal, a constant, a binding, an
// integer, a comparison. That keeps the generated function as small as the dependence on `k`
// actually is, and it is what lets the pass refuse precisely: a construct with no derivative
// rule is refused only when a non-zero tangent reaches it (SD0118), never given a zero
// derivative silently.
//
// A call to another function of the module is differentiated through a JVP helper,
// `g_jvp(args…, d_args…)`, which takes a tangent for each differentiable parameter and
// returns the tangent of `g`'s result. Helpers are generated once per callee, callee first,
// and appended after the module's own functions.
//
// Piecewise-constant builtins (`floor`, `ceil`, `round`, `trunc`, `sign`, `step`) have a zero
// derivative, which is the derivative almost everywhere; the docs say so.

import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/nodes.js';
import { type ShaderType, typeKey } from '../ir/types.js';
import { isKnownIntrinsic } from '../intrinsics.js';
import { dslError } from '../diagnostics/error.js';

/** Options for {@link grad}.
 *
 *  Exported from `typeshade`. */
export interface GradOptions {
  /** The name of the generated function. Defaults to `<fn>_d_<param>`. */
  readonly name?: string;
  /** The direction to differentiate along when the parameter is a vector: the generated
   *  function returns the directional derivative, the Jacobian times this vector. Required
   *  for a vector parameter, refused for a scalar one. */
  readonly direction?: readonly number[];
}

/** What {@link grad} returns: the module with the derivative function added, and its name.
 *
 *  Exported from `typeshade`. */
export interface GradResult {
  /** The input module plus the derivative function and the JVP helpers it calls. */
  readonly module: ModuleDecl;
  /** The name of the derivative function in {@link GradResult.module}. */
  readonly name: string;
}

/** Differentiate a function of a module with respect to one of its parameters, in forward
 *  mode, and add the derivative as a new function.
 *
 *  The new function takes the same parameters as `fn` and returns `d fn / d param` at them,
 *  with the type of `fn`'s result. It differentiates `f32`, float-vector and float-matrix
 *  arithmetic, the component-wise builtins (`sin`, `exp`, `pow`, `mix`, `smoothstep`, `dot`,
 *  `length`, `normalize` and the rest), `if`, `switch` and `for`, and calls to other functions
 *  of the module. `floor`, `ceil`, `round`, `trunc`, `sign` and `step` have a zero derivative.
 *  A construct with no derivative rule, a texture sample or a derivative builtin among them, is
 *  refused by name when the parameter reaches it, never given a zero derivative.
 *
 *  Exported from `typeshade`.
 *
 *  @param m - the module holding `fn`.
 *  @param fn - the name of the function to differentiate. It must return `f32`, an `f32`
 *    vector or an `f32` matrix.
 *  @param param - the name of the parameter to differentiate with respect to: an `f32`, or an
 *    `f32` vector with `opts.direction`.
 *  @param opts - the generated name and, for a vector parameter, the direction.
 *  @returns the module with the derivative added, and the derivative's name.
 *  @throws `SD0118` when the function, the parameter or a construct the parameter reaches
 *    cannot be differentiated; the message names it.
 *
 *  @example
 *  ```ts
 *  import { compile, compileModule, grad } from 'typeshade'
 *
 *  const { module } = compile(`"use typeshade"
 *  export function f(x: f32, k: f32): f32 {
 *    return sin(k * x) * k
 *  }`)
 *  const d = grad(module, 'f', 'k')
 *  compileModule(d.module).fns[d.name]!(0.5, 2) // cos(1) * 0.5 * 2 + sin(1)
 *  ```
 */
export function grad(m: ModuleDecl, fn: string, param: string, opts?: GradOptions): GradResult {
  const f = m.funcs.find((g) => g.name === fn);
  if (f === undefined) throw refuse(`no function "${fn}" in the module`);
  if (!isDiffType(f.ret))
    throw refuse(
      `"${fn}" returns ${shown(f.ret)}; grad differentiates a function that returns f32, an f32 vector or an f32 matrix`,
    );
  const p = f.params.find((q) => q.name === param);
  if (p === undefined)
    throw refuse(
      `"${fn}" has no parameter "${param}"; it takes ${f.params.map((q) => q.name).join(', ') || 'none'}`,
    );
  const seed = seedFor(fn, param, p.type, opts?.direction);
  const name = opts?.name ?? `${fn}_d_${param}`;
  const taken = new Set(m.funcs.map((g) => g.name));
  if (taken.has(name))
    throw refuse(`the module already has a function "${name}"; pass another name as opts.name`);
  taken.add(name);

  const ctx = new GradContext(m, taken);
  const env = new Map<string, Expr | null>();
  for (const q of f.params) env.set(q.name, q.name === param ? seed : null);
  const body = ctx.transform(f, env);
  const out: FuncDecl = {
    name,
    params: f.params.map(({ name: n, type }) => ({ name: n, type })),
    ret: f.ret,
    body,
    ...(f.allowEarlyReturn !== undefined ? { allowEarlyReturn: f.allowEarlyReturn } : {}),
    ...(f.lintDisable !== undefined ? { lintDisable: f.lintDisable } : {}),
  };
  return { module: { ...m, funcs: [...m.funcs, ...ctx.generated, out] }, name };
}

// ── types ────────────────────────────────────────────────────────────────────────────

const isDiffType = (t: ShaderType): boolean =>
  (t.kind === 'scalar' && t.scalar === 'f32') ||
  (t.kind === 'vec' && t.elem === 'f32') ||
  (t.kind === 'mat' && t.elem === 'f32');

const F32: ShaderType = { kind: 'scalar', scalar: 'f32' };
const BOOL: ShaderType = { kind: 'scalar', scalar: 'bool' };

const refuse = (detail: string) => dslError('SD0118', detail);

/** A type as an author wrote it: a struct by its name, anything else by its WGSL key. */
const shown = (t: ShaderType): string => (t.kind === 'struct' ? t.name : typeKey(t));

// ── expression builders ─────────────────────────────────────────────────────────────
//
// Every builder takes the result type explicitly: the tangent of an expression has the type of
// the expression, so the caller always knows it, and nothing here re-derives a type.

const lit = (value: number): Expr => ({ op: 'lit', type: F32, value });
const bin = (bop: '+' | '-' | '*' | '/', a: Expr, b: Expr, type: ShaderType): Expr => ({
  op: 'binop',
  type,
  bop,
  a,
  b,
});
const neg = (a: Expr): Expr => ({ op: 'unop', type: a.type, a });
const call = (fn: string, args: readonly Expr[], type: ShaderType): Expr => ({
  op: 'call',
  type,
  fn,
  args,
});
const cmp = (cop: '<' | '>', a: Expr, b: Expr): Expr => ({
  op: 'compare',
  type: a.type.kind === 'vec' ? { kind: 'vec', n: a.type.n, elem: 'bool' } : BOOL,
  cop,
  a,
  b,
});
const pick = (cond: Expr, ifTrue: Expr, ifFalse: Expr): Expr => ({
  op: 'select',
  type: ifTrue.type,
  cond,
  ifTrue,
  ifFalse,
});

/** The zero of a differentiable type, or of the `f32` type of a non-float scalar or vector's
 *  shape (a converting constructor's integer argument has a zero `f32` tangent). */
function zero(t: ShaderType): Expr {
  if (t.kind === 'scalar') return lit(0);
  if (t.kind === 'vec') {
    const v: ShaderType = { kind: 'vec', n: t.n, elem: 'f32' };
    return { op: 'construct', type: v, args: [lit(0)] };
  }
  if (t.kind === 'mat') {
    // WGSL has no scalar-diagonal matrix constructor and GLSL has no zero-argument one, so the
    // zero matrix is written as its zero columns, which both spell.
    const col: ShaderType = { kind: 'vec', n: t.rows, elem: 'f32' };
    return {
      op: 'construct',
      type: t,
      args: Array.from({ length: t.cols }, () => zero(col)),
    };
  }
  throw refuse(`no zero tangent for ${shown(t)}`);
}

/** Widen a scalar tangent to the vector type an operation broadcast it to. */
function fit(x: Expr, type: ShaderType): Expr {
  if (typeKey(x.type) === typeKey(type)) return x;
  if (x.type.kind === 'scalar' && type.kind === 'vec') return { op: 'construct', type, args: [x] };
  throw refuse(`cannot widen a ${shown(x.type)} tangent to ${shown(type)}`);
}

/** Null-aware sum and difference of tangents: `null` is a zero tangent. */
const add = (x: Expr | null, y: Expr | null, type: ShaderType): Expr | null =>
  x === null
    ? y === null
      ? null
      : fit(y, type)
    : y === null
      ? fit(x, type)
      : bin('+', x, y, type);
const sub = (x: Expr | null, y: Expr | null, type: ShaderType): Expr | null =>
  x === null
    ? y === null
      ? null
      : neg(fit(y, type))
    : y === null
      ? fit(x, type)
      : bin('-', x, y, type);
/** `x * y` where `y` is a tangent that may be zero. */
const scale = (x: Expr, y: Expr | null, type: ShaderType): Expr | null =>
  y === null ? null : bin('*', x, y, type);

// ── the transform ───────────────────────────────────────────────────────────────────

class GradContext {
  readonly generated: FuncDecl[] = [];
  private readonly funcs: Map<string, FuncDecl>;
  private readonly jvpNames = new Map<string, string>();
  private readonly inProgress = new Set<string>();

  constructor(
    m: ModuleDecl,
    private readonly taken: Set<string>,
  ) {
    this.funcs = new Map(m.funcs.map((g) => [g.name, g]));
  }

  /** The tangent body of `f` under `env`, the tangent of each parameter. */
  transform(f: FuncDecl, env: Map<string, Expr | null>): Stmt[] {
    for (const p of f.params) {
      if (p.mode === 'inout' && env.get(p.name) != null)
        throw refuse(
          `"${f.name}" takes "${p.name}" by reference, which grad cannot differentiate through`,
        );
    }
    const names = new Set<string>(f.params.map((p) => p.name));
    collectNames(f.body, names);
    return new FnTransform(this, f, env, names).stmts(f.body);
  }

  /** The user function a call reaches, if it reaches one. */
  callee(e: Extract<Expr, { op: 'call' }>): FuncDecl | undefined {
    if (e.declRef === undefined && isKnownIntrinsic(e.fn)) return undefined;
    return this.funcs.get(e.fn);
  }

  /** The name of `g`'s JVP helper, generating it on first use. */
  jvpOf(g: FuncDecl): string {
    const done = this.jvpNames.get(g.name);
    if (done !== undefined) return done;
    if (this.inProgress.has(g.name))
      throw refuse(`"${g.name}" calls itself; grad differentiates non-recursive functions only`);
    if (!isDiffType(g.ret))
      throw refuse(
        `"${g.name}" returns ${shown(g.ret)} and is called with an argument that depends on the parameter; grad differentiates through a function that returns f32, an f32 vector or an f32 matrix`,
      );
    this.inProgress.add(g.name);
    let name = `${g.name}_jvp`;
    for (let i = 2; this.taken.has(name); i++) name = `${g.name}_jvp${i}`;
    this.taken.add(name);
    const params: { name: string; type: ShaderType }[] = g.params.map(({ name: n, type }) => ({
      name: n,
      type,
    }));
    const env = new Map<string, Expr | null>();
    const used = new Set(g.params.map((p) => p.name));
    collectNames(g.body, used);
    for (const p of g.params) {
      if (!isDiffType(p.type)) {
        env.set(p.name, null);
        continue;
      }
      let t = `d_${p.name}`;
      for (let i = 2; used.has(t); i++) t = `d_${p.name}${i}`;
      used.add(t);
      params.push({ name: t, type: p.type });
      env.set(p.name, { op: 'param', type: p.type, name: t });
    }
    const body = this.transform(g, env);
    const decl: FuncDecl = {
      name,
      params,
      ret: g.ret,
      body,
      ...(g.allowEarlyReturn !== undefined ? { allowEarlyReturn: g.allowEarlyReturn } : {}),
      ...(g.lintDisable !== undefined ? { lintDisable: g.lintDisable } : {}),
    };
    this.generated.push(decl);
    this.jvpNames.set(g.name, name);
    this.inProgress.delete(g.name);
    return name;
  }
}

function collectNames(body: readonly Stmt[], into: Set<string>): void {
  for (const s of body) {
    if (s.s === 'let' || s.s === 'var') into.add(s.name);
    else if (s.s === 'if') {
      for (const a of s.arms) collectNames(a.body, into);
      if (s.elseBody) collectNames(s.elseBody, into);
    } else if (s.s === 'for') {
      collectNames([s.init], into);
      collectNames(s.body, into);
    } else if (s.s === 'switch') {
      for (const c of s.cases) collectNames(c.body, into);
      if (s.defaultBody) collectNames(s.defaultBody, into);
    }
  }
}

/** The root name an assignment target writes through: `v` of `v`, `v.x`, `v[i]`, `v[i].y`. */
function rootOf(e: Expr): string | undefined {
  if (e.op === 'varref' || e.op === 'param') return e.name;
  if (e.op === 'member' || e.op === 'index') return rootOf(e.base);
  return undefined;
}

/** The same access path as `target`, rooted at `tangent` instead. */
function retarget(target: Expr, tangent: Expr): Expr {
  if (target.op === 'varref' || target.op === 'param') return tangent;
  if (target.op === 'member') return { ...target, base: retarget(target.base, tangent) };
  if (target.op === 'index') return { ...target, base: retarget(target.base, tangent) };
  throw refuse('an assignment target grad cannot follow');
}

class FnTransform {
  constructor(
    private readonly ctx: GradContext,
    private readonly f: FuncDecl,
    private readonly env: Map<string, Expr | null>,
    private readonly names: Set<string>,
  ) {}

  private fresh(base: string): string {
    let n = `d_${base}`;
    for (let i = 2; this.names.has(n); i++) n = `d_${base}${i}`;
    this.names.add(n);
    return n;
  }

  stmts(body: readonly Stmt[]): Stmt[] {
    const out: Stmt[] = [];
    for (const s of body) this.stmt(s, out);
    return out;
  }

  private stmt(s: Stmt, out: Stmt[]): void {
    switch (s.s) {
      case 'let': {
        out.push(s);
        const t = this.d(s.expr);
        if (t === null) {
          this.env.set(s.name, null);
          return;
        }
        const name = this.fresh(s.name);
        out.push({ s: 'let', name, expr: t });
        this.env.set(s.name, { op: 'varref', type: s.expr.type, name });
        return;
      }
      case 'var': {
        out.push(s);
        if (!isDiffType(s.type)) {
          if (s.init !== undefined) this.refuseCarrier(s.init, s.name, s.type);
          this.env.set(s.name, null);
          return;
        }
        // Every float variable gets a tangent variable, even one that starts at a zero tangent:
        // a later assignment may give it one.
        const name = this.fresh(s.name);
        const init = s.init !== undefined ? this.d(s.init) : null;
        out.push({ s: 'var', name, type: s.type, init: init ?? zero(s.type) });
        this.env.set(s.name, { op: 'varref', type: s.type, name });
        return;
      }
      case 'assign':
      case 'assignOp': {
        const value: Expr =
          s.s === 'assign'
            ? s.expr
            : { op: 'binop', type: s.target.type, bop: s.bop, a: s.target, b: s.expr };
        const t = this.d(value);
        const root = rootOf(s.target);
        const tangent = root !== undefined ? this.env.get(root) : undefined;
        if (tangent !== undefined && tangent !== null && tangent.op !== 'param') {
          // The tangent is written first: the tangent of `x = x * x` reads the OLD `x`.
          out.push({
            s: 'assign',
            target: retarget(s.target, tangent),
            expr: t ?? zero(s.target.type),
          });
        } else if (t !== null) {
          throw refuse(
            `"${this.f.name}" writes a value that depends on the parameter to ${root !== undefined ? `"${root}"` : 'a location'}, which is ${this.describeCarrier(root)}; grad carries a derivative through f32, float-vector and float-matrix locals only`,
          );
        }
        out.push(s);
        return;
      }
      case 'if':
        out.push({
          ...s,
          arms: s.arms.map((a) => ({ cond: a.cond, body: this.stmts(a.body) })),
          ...(s.elseBody !== undefined ? { elseBody: this.stmts(s.elseBody) } : {}),
        });
        return;
      case 'for': {
        const init = this.stmts([s.init]);
        const update = this.stmts([s.update]);
        if (init.length !== 1 || update.length !== 1)
          throw refuse(
            `"${this.f.name}" has a loop whose counter is a float; grad differentiates a loop over an integer counter — count with an i32 and derive the float from it`,
          );
        out.push({ ...s, init: init[0]!, update: update[0]!, body: this.stmts(s.body) });
        return;
      }
      case 'switch':
        out.push({
          ...s,
          cases: s.cases.map((c) => ({ values: c.values, body: this.stmts(c.body) })),
          ...(s.defaultBody !== undefined ? { defaultBody: this.stmts(s.defaultBody) } : {}),
        });
        return;
      case 'return':
        if (s.expr === undefined) {
          out.push(s);
          return;
        }
        out.push({ s: 'return', expr: this.d(s.expr) ?? zero(s.expr.type) });
        return;
      case 'call': {
        const e = s.expr;
        if (
          e.op === 'call' &&
          this.ctx.callee(e) !== undefined &&
          e.args.some((a) => this.d(a) !== null)
        )
          throw refuse(
            `"${this.f.name}" calls "${e.fn}" as a statement with an argument that depends on the parameter; grad differentiates a call's returned value, so use it in an expression`,
          );
        out.push(s);
        return;
      }
      case 'break':
      case 'continue':
      case 'discard':
        out.push(s);
        return;
      case 'raw':
      case 'placeholder':
        throw refuse(`"${this.f.name}" contains a ${s.s} statement, which grad cannot read`);
    }
  }

  private describeCarrier(root: string | undefined): string {
    if (root === undefined) return 'not a local';
    if (!this.env.has(root)) return 'a module variable or a binding';
    return 'a struct, an array or a parameter';
  }

  /** Refuse a struct or array value that would carry a non-zero tangent. */
  private refuseCarrier(e: Expr, name: string, type: ShaderType): void {
    if (this.d(e) !== null)
      throw refuse(
        `"${this.f.name}" stores a value that depends on the parameter in "${name}", a ${shown(type)}; grad carries a derivative through f32, float-vector and float-matrix values only`,
      );
  }

  /** The tangent of `e`: an expression of `e`'s type, or `null` for a zero tangent. */
  d(e: Expr): Expr | null {
    switch (e.op) {
      case 'lit':
      case 'constref':
      case 'overrideref':
      case 'externref':
      case 'compare':
      case 'logical':
        return null;
      case 'param':
      case 'varref':
        return isDiffType(e.type) ? (this.env.get(e.name) ?? null) : null;
      case 'binop':
        return this.binop(e);
      case 'unop': {
        const a = this.d(e.a);
        return a === null ? null : neg(a);
      }
      case 'call':
        return this.call(e);
      case 'member': {
        if (!isDiffType(e.type)) return null;
        const b = this.d(e.base);
        return b === null ? null : { ...e, base: b };
      }
      case 'index': {
        if (!isDiffType(e.type)) return null;
        const b = this.d(e.base);
        return b === null ? null : { ...e, base: b };
      }
      case 'construct': {
        const ts = e.args.map((a) => this.d(a));
        if (ts.every((t) => t === null)) return null;
        if (!isDiffType(e.type))
          throw refuse(
            `"${this.f.name}" builds a ${shown(e.type)} from a value that depends on the parameter; grad carries a derivative through f32, float-vector and float-matrix values only`,
          );
        return { ...e, args: e.args.map((a, i) => ts[i] ?? zero(a.type)) };
      }
      case 'select': {
        const t = this.d(e.ifTrue);
        const f = this.d(e.ifFalse);
        if (t === null && f === null) return null;
        return { ...e, ifTrue: t ?? zero(e.type), ifFalse: f ?? zero(e.type) };
      }
      case 'matchExpr': {
        const cs = e.cases.map(([v, x]) => [v, this.d(x)] as const);
        const dflt = this.d(e.default);
        if (dflt === null && cs.every(([, x]) => x === null)) return null;
        return {
          ...e,
          cases: cs.map(([v, x]) => [v, x ?? zero(e.type)] as const),
          default: dflt ?? zero(e.type),
        };
      }
    }
  }

  private binop(e: Extract<Expr, { op: 'binop' }>): Expr | null {
    if (!isDiffType(e.type)) return null;
    const da = this.d(e.a);
    const db = this.d(e.b);
    if (da === null && db === null) return null;
    const T = e.type;
    switch (e.bop) {
      case '+':
        return add(da, db, T);
      case '-':
        return sub(da, db, T);
      case '*':
        return add(
          da === null ? null : bin('*', da, e.b, T),
          db === null ? null : bin('*', e.a, db, T),
          T,
        );
      case '/':
        // d(a / b) = da / b - a * db / (b * b)
        return sub(
          da === null ? null : bin('/', da, e.b, T),
          db === null ? null : bin('/', bin('*', e.a, db, T), bin('*', e.b, e.b, e.b.type), T),
          T,
        );
      case '%':
        // A float `%` truncates: a % b = a - b * trunc(a / b), and trunc has a zero derivative.
        return sub(
          da,
          db === null ? null : bin('*', db, call('trunc', [bin('/', e.a, e.b, T)], T), T),
          T,
        );
      default:
        return null;
    }
  }

  private call(e: Extract<Expr, { op: 'call' }>): Expr | null {
    const ts = e.args.map((a) => this.d(a));
    if (ts.every((t) => t === null)) return null;
    // An integer or boolean result is piecewise constant in its arguments, whoever computes it.
    if (!isDiffType(e.type)) return null;
    const g = this.ctx.callee(e);
    if (g !== undefined) {
      const name = this.ctx.jvpOf(g);
      const tangents = g.params.flatMap((p, i) =>
        isDiffType(p.type) ? [ts[i] ?? zero(p.type)] : [],
      );
      return call(name, [...e.args, ...tangents], e.type);
    }
    const rule = RULES[e.fn];
    if (rule === undefined)
      throw refuse(
        `"${this.f.name}" passes a value that depends on the parameter to ${e.fn}(), which has no derivative rule`,
      );
    return rule(e.args, ts, e.type);
  }
}

// ── derivative rules ────────────────────────────────────────────────────────────────
//
// One entry per builtin id: the primal arguments, their tangents (`null` is zero) and the
// result type, to the tangent of the result. Each is the textbook derivative, written with the
// builtins both targets spell.

type Rule = (a: readonly Expr[], d: readonly (Expr | null)[], T: ShaderType) => Expr | null;

/** A rule for a component-wise function of one argument: `f'(x) * dx`. */
const unary =
  (dfdx: (x: Expr, T: ShaderType) => Expr): Rule =>
  (a, d, T) =>
    scale(dfdx(a[0]!, T), d[0]!, T);

const c1 = (fn: string) => (x: Expr, T: ShaderType) => call(fn, [x], T);
const sq = (x: Expr, T: ShaderType) => bin('*', x, x, T);
/** A rule with a zero derivative almost everywhere. */
const flat: Rule = () => null;

const RULES: Readonly<Record<string, Rule>> = {
  f32: (_a, d) => d[0]!,
  sin: unary(c1('cos')),
  cos: unary((x, T) => neg(call('sin', [x], T))),
  tan: unary((x, T) => bin('/', lit(1), sq(call('cos', [x], T), T), T)),
  asin: unary((x, T) => bin('/', lit(1), call('sqrt', [bin('-', lit(1), sq(x, T), T)], T), T)),
  acos: unary((x, T) => neg(bin('/', lit(1), call('sqrt', [bin('-', lit(1), sq(x, T), T)], T), T))),
  atan: unary((x, T) => bin('/', lit(1), bin('+', lit(1), sq(x, T), T), T)),
  sinh: unary(c1('cosh')),
  cosh: unary(c1('sinh')),
  tanh: unary((x, T) => bin('-', lit(1), sq(call('tanh', [x], T), T), T)),
  asinh: unary((x, T) => bin('/', lit(1), call('sqrt', [bin('+', sq(x, T), lit(1), T)], T), T)),
  acosh: unary((x, T) => bin('/', lit(1), call('sqrt', [bin('-', sq(x, T), lit(1), T)], T), T)),
  atanh: unary((x, T) => bin('/', lit(1), bin('-', lit(1), sq(x, T), T), T)),
  exp: unary(c1('exp')),
  exp2: unary((x, T) => bin('*', call('exp2', [x], T), lit(Math.LN2), T)),
  log: unary((x, T) => bin('/', lit(1), x, T)),
  log2: unary((x, T) => bin('/', lit(1), bin('*', x, lit(Math.LN2), T), T)),
  sqrt: unary((x, T) => bin('/', lit(0.5), call('sqrt', [x], T), T)),
  inverseSqrt: unary((x, T) => bin('/', bin('*', lit(-0.5), call('inverseSqrt', [x], T), T), x, T)),
  abs: unary(c1('sign')),
  fract: (_a, d) => d[0]!,
  radians: unary(() => lit(Math.PI / 180)),
  degrees: unary(() => lit(180 / Math.PI)),
  floor: flat,
  ceil: flat,
  round: flat,
  trunc: flat,
  sign: flat,
  step: flat,
  // saturate(x) = clamp(x, 0, 1): dx inside the interval, zero outside it.
  saturate: (a, d, T) =>
    d[0] === null
      ? null
      : pick(
          cmp('>', call('abs', [bin('-', a[0]!, lit(0.5), T)], T), splat(0.5, T)),
          zero(T),
          d[0],
        ),
  clamp: (a, d, T) => {
    const [x, lo, hi] = a as [Expr, Expr, Expr];
    const inner = pick(cmp('>', x, hi), d[2] ?? zero(T), d[0] ?? zero(T));
    return pick(cmp('<', x, lo), d[1] ?? zero(T), inner);
  },
  min: (a, d, T) => pick(cmp('<', a[0]!, a[1]!), d[0] ?? zero(T), d[1] ?? zero(T)),
  max: (a, d, T) => pick(cmp('>', a[0]!, a[1]!), d[0] ?? zero(T), d[1] ?? zero(T)),
  mix: (a, d, T) => {
    const [x, y, s] = a as [Expr, Expr, Expr];
    return add(
      add(scale(bin('-', lit(1), s, s.type), d[0]!, T), scale(s, d[1]!, T), T),
      scale(bin('-', y, x, T), d[2]!, T),
      T,
    );
  },
  smoothstep: (a, d, T) => {
    // u = saturate(t), t = (x - e0) / (e1 - e0); the result is u * u * (3 - 2u), whose
    // derivative 6u(1 - u) * dt is already zero wherever the saturate clamps.
    const [e0, e1, x] = a as [Expr, Expr, Expr];
    const w = bin('-', e1, e0, e1.type);
    const t = bin('/', bin('-', x, e0, T), w, T);
    const dt = sub(sub(d[2]!, d[0]!, T), scale(t, sub(d[1]!, d[0]!, T), T), T);
    if (dt === null) return null;
    const u = call('saturate', [t], T);
    const k = bin('*', bin('*', lit(6), u, T), bin('-', lit(1), u, T), T);
    return bin('*', k, bin('/', dt, w, T), T);
  },
  pow: (a, d, T) => {
    const [x, y] = a as [Expr, Expr];
    return add(
      scale(bin('*', y, call('pow', [x, bin('-', y, lit(1), T)], T), T), d[0]!, T),
      scale(bin('*', call('pow', [x, y], T), call('log', [x], T), T), d[1]!, T),
      T,
    );
  },
  atan2: (a, d, T) => {
    // d atan2(y, x) = (x dy - y dx) / (x² + y²)
    const [y, x] = a as [Expr, Expr];
    const num = sub(scale(x, d[0]!, T), scale(y, d[1]!, T), T);
    return num === null ? null : bin('/', num, bin('+', sq(x, T), sq(y, T), T), T);
  },
  fma: (a, d, T) => {
    const [x, y] = a as [Expr, Expr, Expr];
    return add(add(scale(y, d[0]!, T), scale(x, d[1]!, T), T), d[2]!, T);
  },
  mod: (a, d, T) => {
    // Floor modulo: a - b * floor(a / b), and floor has a zero derivative.
    const [x, y] = a as [Expr, Expr];
    return sub(d[0]!, scale(call('floor', [bin('/', x, y, T)], T), d[1]!, T), T);
  },
  dot: (a, d, T) => {
    const [x, y] = a as [Expr, Expr];
    return add(
      d[0] === null ? null : call('dot', [d[0], y], T),
      d[1] === null ? null : call('dot', [x, d[1]], T),
      T,
    );
  },
  cross: (a, d, T) => {
    const [x, y] = a as [Expr, Expr];
    return add(
      d[0] === null ? null : call('cross', [d[0], y], T),
      d[1] === null ? null : call('cross', [x, d[1]], T),
      T,
    );
  },
  length: (a, d, T) => {
    const [v] = a as [Expr];
    if (v.type.kind === 'scalar') return scale(call('sign', [v], T), d[0]!, T);
    return bin('/', call('dot', [v, d[0]!], T), call('length', [v], T), T);
  },
  distance: (a, d, T) => {
    const [x, y] = a as [Expr, Expr];
    const dd = sub(d[0]!, d[1]!, x.type);
    if (dd === null) return null;
    const diff = bin('-', x, y, x.type);
    if (x.type.kind === 'scalar') return bin('*', call('sign', [diff], T), dd, T);
    return bin('/', call('dot', [diff, dd], T), call('distance', [x, y], T), T);
  },
  normalize: (a, d, T) => {
    // (dv - n dot(n, dv)) / length(v), n = normalize(v)
    const [v] = a as [Expr];
    const dv = d[0]!;
    const n = call('normalize', [v], T);
    const along = bin('*', n, call('dot', [n, dv], F32), T);
    return bin('/', bin('-', dv, along, T), call('length', [v], F32), T);
  },
  reflect: (a, d, T) => {
    // reflect(i, n) = i - 2 dot(n, i) n
    const [i, n] = a as [Expr, Expr];
    const dDot = add(
      d[1] === null ? null : call('dot', [d[1], i], F32),
      d[0] === null ? null : call('dot', [n, d[0]], F32),
      F32,
    );
    return sub(
      sub(d[0]!, dDot === null ? null : bin('*', bin('*', lit(2), dDot, F32), n, T), T),
      scale(bin('*', lit(2), call('dot', [n, i], F32), F32), d[1]!, T),
      T,
    );
  },
  transpose: (_a, d, T) => call('transpose', [d[0]!], T),
  select: (a, d, T) => call('select', [d[0] ?? zero(T), d[1] ?? zero(T), a[2]!], T),
};

/** A scalar broadcast to `T`'s shape, for a comparison against a vector. */
function splat(v: number, T: ShaderType): Expr {
  return T.kind === 'vec' ? { op: 'construct', type: T, args: [lit(v)] } : lit(v);
}

function seedFor(
  fn: string,
  param: string,
  type: ShaderType,
  direction: readonly number[] | undefined,
): Expr {
  if (type.kind === 'scalar' && type.scalar === 'f32') {
    if (direction !== undefined)
      throw refuse(`"${param}" of "${fn}" is an f32; a direction applies to a vector parameter`);
    return lit(1);
  }
  if (type.kind === 'vec' && type.elem === 'f32') {
    if (direction === undefined || direction.length !== type.n)
      throw refuse(
        `"${param}" of "${fn}" is ${shown(type)}; pass opts.direction with ${type.n} numbers, the direction to differentiate along`,
      );
    return { op: 'construct', type, args: direction.map(lit) };
  }
  throw refuse(
    `"${param}" of "${fn}" is ${shown(type)}; grad differentiates with respect to an f32 or an f32 vector`,
  );
}
