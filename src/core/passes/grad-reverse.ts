// ═══ grad, reverse mode — the vector-Jacobian product of a function (change 0056) ═══
//
// `grad(m, 'f', ['k', 'p'], { mode: 'reverse' })` adds a function `f_vjp(params…, dy)` that
// returns a struct with one field for each name of `wrt`: `dy · ∂f/∂k`, `dy · ∂f/∂p`. One
// evaluation gives every field. It is an IR → IR pass, as forward mode is, so the WGSL writer,
// the GLSL writer and both CPU modules take the result as they take any function.
//
// THE TAPE IS THE FUNCTION'S OWN MEMORY (change 0056, item 1, M1). The derivative runs the
// forward body first, then sweeps it backward:
//
//   1. Every local is hoisted to a function-scope `var` under a name unique in the function, so
//      the backward sweep can read what the forward sweep computed. A `let` is written once.
//   2. Before an assignment overwrites a variable, the old value is copied into a fresh `var`
//      (a tape slot). The backward sweep restores it after it has taken the adjoint of the
//      assignment, so at each point of the backward sweep every variable holds the value it
//      held at the same point of the forward sweep. The count of slots is known at compile
//      time: one for each assignment of the body.
//   3. A branch records the arm it took in an `i32`. The backward sweep takes the same arm.
//   4. An early `return` stores its value and sets a flag, and the statements after it run
//      under `if (!done)`. That makes the body a sequence the sweep can reverse.
//
// The adjoint of an expression is propagated by `acc`, the transpose of the tangent rules of
// `grad.ts`. A component-wise builtin has a diagonal Jacobian, so its transpose is the same
// rule with the adjoint in place of the tangent, summed over a broadcast scalar. The other
// builtins (`dot`, `cross`, `length`, `distance`, `reflect`, `transpose`, `select`) and the
// matrix products have their own transpose here. A piecewise-constant builtin has a zero
// derivative in both modes (change 0056, item 7).
//
// A call to another function of the module goes through a helper `g_vjp(args…, dy)`, generated
// once for each callee, which returns a struct of the adjoints of `g`'s float parameters.
//
// This slice differentiates loop-free functions. A loop is refused by name: its reverse sweep
// needs the checkpoint schedule of change 0056, items 1 and 2, which the next slice adds.

import type { Expr, FuncDecl, ModuleDecl, Stmt, StructDecl } from '../ir/nodes.js';
import { type ShaderType, typeKey } from '../ir/types.js';
import { isKnownIntrinsic } from '../intrinsics.js';
import { mapExpr } from './opt/ir-transform.js';
import {
  F32,
  RULES,
  bin,
  call,
  collectNames,
  isDiffType,
  lit,
  neg,
  refuse,
  retarget,
  rootOf,
  shown,
  zero,
} from './grad.js';

/** What the reverse mode adds to the module: the derivative, its struct and the field each
 *  name of `wrt` landed in. */
export interface ReverseResult {
  readonly module: ModuleDecl;
  readonly name: string;
  readonly adjoints: Readonly<Record<string, string>>;
}

const I32: ShaderType = { kind: 'scalar', scalar: 'i32' };
const BOOL: ShaderType = { kind: 'scalar', scalar: 'bool' };
const ilit = (value: number): Expr => ({ op: 'lit', type: I32, value });
const vref = (name: string, type: ShaderType): Expr => ({ op: 'varref', type, name });
const assign = (target: Expr, expr: Expr): Stmt => ({ s: 'assign', target, expr });
const eq = (a: Expr, b: Expr): Expr => ({ op: 'compare', type: BOOL, cop: '==', a, b });
const COMPONENTS: Readonly<Record<string, number>> = {
  x: 0,
  y: 1,
  z: 2,
  w: 3,
  r: 0,
  g: 1,
  b: 2,
  a: 3,
};
const XYZW = 'xyzw';

const isMat = (t: ShaderType): boolean => t.kind === 'mat';
const isUserCall = (
  funcs: ReadonlyMap<string, FuncDecl>,
  e: Extract<Expr, { op: 'call' }>,
): FuncDecl | undefined =>
  e.declRef === undefined && isKnownIntrinsic(e.fn) ? undefined : funcs.get(e.fn);

/** Differentiate `fn` of `m` with respect to every name of `wrt`, in reverse mode. */
export function gradReverse(
  m: ModuleDecl,
  fn: string,
  wrt: readonly string[],
  name: string | undefined,
): ReverseResult {
  const f = m.funcs.find((g) => g.name === fn);
  if (f === undefined) throw refuse(`no function "${fn}" in the module`);
  if (!isDiffType(f.ret))
    throw refuse(
      `"${fn}" returns ${shown(f.ret)}; grad differentiates a function that returns f32, an f32 vector or an f32 matrix`,
    );
  if (wrt.length === 0) throw refuse(`reverse mode needs at least one name in wrt`);
  const seen = new Set<string>();
  for (const w of wrt) {
    if (seen.has(w)) throw refuse(`"${w}" appears twice in wrt`);
    seen.add(w);
    const p = f.params.find((q) => q.name === w);
    if (p === undefined)
      throw refuse(
        `"${fn}" has no parameter "${w}"; it takes ${f.params.map((q) => q.name).join(', ') || 'none'}`,
      );
    if (!isDiffType(p.type))
      throw refuse(
        `"${w}" of "${fn}" is ${shown(p.type)}; grad differentiates with respect to an f32, an f32 vector or an f32 matrix`,
      );
    if (p.mode !== undefined)
      throw refuse(`"${fn}" takes "${w}" by reference, which grad cannot differentiate through`);
  }
  const out = name ?? `${fn}_vjp`;
  const taken = new Set([...m.funcs.map((g) => g.name), ...m.structs.map((s) => s.name)]);
  if (taken.has(out))
    throw refuse(`the module already has a function "${out}"; pass another name as opts.name`);
  taken.add(out);
  const ctx = new ReverseContext(m, taken);
  const decl = ctx.derive(f, wrt, out);
  return {
    module: {
      ...m,
      structs: [...m.structs, ...ctx.structs],
      funcs: [...m.funcs, ...ctx.generated, decl],
    },
    name: out,
    adjoints: Object.fromEntries(wrt.map((w) => [w, w])),
  };
}

class ReverseContext {
  readonly generated: FuncDecl[] = [];
  readonly structs: StructDecl[] = [];
  readonly funcs: Map<string, FuncDecl>;
  private readonly vjps = new Map<string, { name: string; struct: StructDecl }>();
  private readonly inProgress = new Set<string>();

  constructor(
    m: ModuleDecl,
    private readonly taken: Set<string>,
  ) {
    this.funcs = new Map(m.funcs.map((g) => [g.name, g]));
  }

  private unique(base: string): string {
    let n = base;
    for (let i = 2; this.taken.has(n); i++) n = `${base}${i}`;
    this.taken.add(n);
    return n;
  }

  /** The derivative of `f` with respect to `wrt`, named `name`, with its result struct. */
  derive(f: FuncDecl, wrt: readonly string[], name: string): FuncDecl {
    const struct: StructDecl = {
      name: this.unique(`${name}_adjoints`),
      fields: wrt.map((w) => ({ name: w, type: f.params.find((p) => p.name === w)!.type })),
    };
    this.structs.push(struct);
    const body = new Reverse(this, f, new Set(wrt)).build(struct);
    return {
      name,
      params: [...f.params.map(({ name: n, type }) => ({ name: n, type })), body.dy],
      ret: { kind: 'struct', name: struct.name },
      body: body.stmts,
      ...(f.lintDisable !== undefined ? { lintDisable: f.lintDisable } : {}),
    };
  }

  /** The VJP helper of a callee: its name and its result struct, generated on first use. */
  vjpOf(g: FuncDecl): { name: string; struct: StructDecl } {
    const done = this.vjps.get(g.name);
    if (done !== undefined) return done;
    if (this.inProgress.has(g.name))
      throw refuse(`"${g.name}" calls itself; grad differentiates non-recursive functions only`);
    if (!isDiffType(g.ret))
      throw refuse(
        `"${g.name}" returns ${shown(g.ret)} and is called with an argument that depends on the parameter; grad differentiates through a function that returns f32, an f32 vector or an f32 matrix`,
      );
    this.inProgress.add(g.name);
    const wrt = g.params.filter((p) => isDiffType(p.type) && p.mode === undefined);
    const name = this.unique(`${g.name}_vjp`);
    const struct: StructDecl = {
      name: this.unique(`${name}_adjoints`),
      fields: wrt.map((p) => ({ name: p.name, type: p.type })),
    };
    this.structs.push(struct);
    const body = new Reverse(this, g, new Set(wrt.map((p) => p.name))).build(struct);
    this.generated.push({
      name,
      params: [...g.params.map(({ name: n, type }) => ({ name: n, type })), body.dy],
      ret: { kind: 'struct', name: struct.name },
      body: body.stmts,
      ...(g.lintDisable !== undefined ? { lintDisable: g.lintDisable } : {}),
    });
    const r = { name, struct };
    this.vjps.set(g.name, r);
    this.inProgress.delete(g.name);
    return r;
  }
}

// ── the normalized body ─────────────────────────────────────────────────────────────
//
// The forward body after hoisting: assignments, branches, switches and effect calls, each
// with the record the backward sweep needs.

type Node =
  | {
      readonly k: 'assign';
      readonly target: Expr;
      readonly expr: Expr;
      /** The first write of a hoisted local: nothing before it reads the old value, so it
       *  needs no tape slot. */
      readonly first: boolean;
    }
  | {
      readonly k: 'if';
      readonly arms: readonly { readonly cond: Expr; readonly body: readonly Node[] }[];
      readonly elseBody?: readonly Node[];
    }
  | {
      readonly k: 'switch';
      readonly scrut: Expr;
      readonly cases: readonly {
        readonly values: readonly number[];
        readonly body: readonly Node[];
      }[];
      readonly defaultBody?: readonly Node[];
    }
  | { readonly k: 'call'; readonly expr: Expr; readonly roots: readonly string[] }
  | { readonly k: 'stmt'; readonly stmt: Stmt };

class Reverse {
  /** Every name the derivative uses, so a generated one never collides. */
  private readonly names: Set<string>;
  /** The hoisted locals, in order, with their types. */
  private readonly locals = new Map<string, ShaderType>();
  /** The renaming in force: source name → hoisted name, innermost scope last. */
  private readonly scopes: Map<string, string>[] = [];
  /** Parameters the body writes: they are copied into locals first. */
  private readonly written = new Set<string>();
  /** Names whose value depends on a name of `wrt` (activity analysis). */
  private readonly active = new Set<string>();
  /** The adjoint `var` of each active name. */
  private readonly adj = new Map<string, string>();
  private readonly prologue: Stmt[] = [];
  private retName = '';
  private doneName = '';
  private doneRead = false;

  constructor(
    private readonly ctx: ReverseContext,
    private readonly f: FuncDecl,
    private readonly wrt: ReadonlySet<string>,
  ) {
    this.names = new Set(f.params.map((p) => p.name));
    collectNames(f.body, this.names);
    for (const g of ctx.funcs.keys()) this.names.add(g);
  }

  private fresh(base: string): string {
    let n = base;
    for (let i = 2; this.names.has(n); i++) n = `${base}_${i}`;
    this.names.add(n);
    return n;
  }

  build(struct: StructDecl): { stmts: Stmt[]; dy: { name: string; type: ShaderType } } {
    const f = this.f;
    for (const p of f.params) {
      if ((p.mode === 'inout' || p.mode === 'out') && this.wrt.has(p.name))
        throw refuse(
          `"${f.name}" takes "${p.name}" by reference, which grad cannot differentiate through`,
        );
    }
    collectWrittenParams(f.body, new Set(f.params.map((p) => p.name)), this.written);
    this.retName = this.fresh('result');
    this.locals.set(this.retName, f.ret);
    this.doneName = this.fresh('returned');
    this.locals.set(this.doneName, BOOL);
    // A parameter the body writes is copied into a local, which the tape can restore.
    const top = new Map<string, string>();
    const copies: Node[] = [];
    for (const p of f.params) {
      if (!this.written.has(p.name)) continue;
      const local = this.fresh(p.name);
      this.locals.set(local, p.type);
      top.set(p.name, local);
      copies.push({
        k: 'assign',
        target: vref(local, p.type),
        expr: { op: 'param', type: p.type, name: p.name },
        first: true,
      });
    }
    this.scopes.push(top);
    const body = [...copies, ...this.block(f.body).nodes];
    this.scopes.pop();
    const nodes = this.doneRead ? body : dropDone(body, this.doneName);
    if (!this.doneRead) this.locals.delete(this.doneName);

    // Activity: the names that depend on `wrt`, to a fixed point (a later branch can make a
    // name active that an earlier one read).
    for (const w of this.wrt) this.active.add(w);
    for (let before = -1; before !== this.active.size;) {
      before = this.active.size;
      this.activity(nodes);
    }
    for (const n of this.active) {
      const t = this.typeOf(n);
      if (isDiffType(t)) this.adj.set(n, this.fresh(`d_${n}`));
    }

    const dyName = this.fresh('dy');
    const backward: Stmt[] = [];
    const retAdj = this.adj.get(this.retName);
    if (retAdj !== undefined) backward.push(assign(vref(retAdj, f.ret), vref(dyName, f.ret)));
    const forward: Stmt[] = [];
    this.sweep(nodes, forward, backward);

    const decls: Stmt[] = [];
    for (const [n, t] of this.locals) decls.push({ s: 'var', name: n, type: t });
    for (const [n, d] of this.adj) {
      const t = this.typeOf(n);
      decls.push({ s: 'var', name: d, type: t, init: zero(t) });
    }
    const result: Expr = {
      op: 'construct',
      type: { kind: 'struct', name: struct.name },
      args: struct.fields.map((fl) => {
        const d = this.adj.get(fl.name);
        return d === undefined ? zero(fl.type) : vref(d, fl.type);
      }),
    };
    return {
      stmts: [...decls, ...this.prologue, ...forward, ...backward, { s: 'return', expr: result }],
      dy: { name: dyName, type: f.ret },
    };
  }

  private typeOf(n: string): ShaderType {
    const l = this.locals.get(n);
    if (l !== undefined) return l;
    const p = this.f.params.find((q) => q.name === n);
    if (p === undefined) throw refuse(`an internal name "${n}" grad cannot follow`);
    return p.type;
  }

  // ── normalization ────────────────────────────────────────────────────────────────

  private lookup(n: string): string | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const r = this.scopes[i]!.get(n);
      if (r !== undefined) return r;
    }
    return undefined;
  }

  /** `e` with every local renamed to its hoisted name and every written parameter read from
   *  its copy. */
  private rename(e: Expr): Expr {
    return mapExpr(e, (x) => {
      if (x.op === 'varref') {
        const r = this.lookup(x.name);
        return r === undefined ? x : { ...x, name: r };
      }
      if (x.op === 'param') {
        const r = this.lookup(x.name);
        return r === undefined ? x : { op: 'varref', type: x.type, name: r };
      }
      return x;
    });
  }

  private declare(name: string, type: ShaderType): string {
    // The first local of a name keeps it; a later one in another scope takes a fresh name.
    const local =
      !this.locals.has(name) && !this.f.params.some((p) => p.name === name)
        ? name
        : this.fresh(name);
    this.locals.set(local, type);
    this.scopes[this.scopes.length - 1]!.set(name, local);
    return local;
  }

  private block(body: readonly Stmt[]): { nodes: Node[]; returns: boolean } {
    const nodes: Node[] = [];
    for (let i = 0; i < body.length; i++) {
      const r = this.stmt(body[i]!);
      nodes.push(...r.nodes);
      if (r.ends) return { nodes, returns: true };
      if (r.returns && i < body.length - 1) {
        this.doneRead = true;
        this.scopes.push(new Map());
        const rest = this.block(body.slice(i + 1));
        this.scopes.pop();
        nodes.push({
          k: 'if',
          arms: [
            {
              cond: eq(vref(this.doneName, BOOL), { op: 'lit', type: BOOL, value: false }),
              body: rest.nodes,
            },
          ],
        });
        return { nodes, returns: true };
      }
      if (r.returns) return { nodes, returns: true };
    }
    return { nodes, returns: false };
  }

  private scoped(body: readonly Stmt[]): { nodes: Node[]; returns: boolean } {
    this.scopes.push(new Map());
    const r = this.block(body);
    this.scopes.pop();
    return r;
  }

  /** One statement: its nodes, whether it may return, and whether it always returns. */
  private stmt(s: Stmt): { nodes: Node[]; returns: boolean; ends?: boolean } {
    switch (s.s) {
      case 'let': {
        const expr = this.rename(s.expr);
        this.storable(s.expr.type, s.name);
        const local = this.declare(s.name, s.expr.type);
        return {
          nodes: [{ k: 'assign', target: vref(local, s.expr.type), expr, first: true }],
          returns: false,
        };
      }
      case 'var': {
        const init = s.init !== undefined ? this.rename(s.init) : undefined;
        this.storable(s.type, s.name);
        const local = this.declare(s.name, s.type);
        return {
          nodes:
            init === undefined
              ? []
              : [{ k: 'assign', target: vref(local, s.type), expr: init, first: true }],
          returns: false,
        };
      }
      case 'assign':
      case 'assignOp': {
        const target = this.rename(s.target);
        const value = this.rename(s.expr);
        const expr: Expr =
          s.s === 'assign'
            ? value
            : { op: 'binop', type: s.target.type, bop: s.bop, a: target, b: value };
        this.refuseByReference(expr, false);
        return { nodes: [{ k: 'assign', target, expr, first: false }], returns: false };
      }
      case 'if': {
        let returns = false;
        const arms = s.arms.map((a) => {
          const cond = this.rename(a.cond);
          this.refuseByReference(cond, false);
          const b = this.scoped(a.body);
          returns ||= b.returns;
          return { cond, body: b.nodes };
        });
        let elseBody: Node[] | undefined;
        if (s.elseBody !== undefined) {
          const b = this.scoped(s.elseBody);
          returns ||= b.returns;
          elseBody = b.nodes;
        }
        return {
          nodes: [{ k: 'if', arms, ...(elseBody !== undefined ? { elseBody } : {}) }],
          returns,
        };
      }
      case 'switch': {
        const scrut = this.rename(s.scrut);
        this.refuseByReference(scrut, false);
        let returns = false;
        const clause = (body: readonly Stmt[]): Node[] => {
          const last = body.length > 0 && body[body.length - 1]!.s === 'break';
          const inner = last ? body.slice(0, -1) : body;
          if (containsBreak(inner))
            throw refuse(
              `"${this.f.name}" leaves a switch clause before its end; reverse mode differentiates a clause that runs to its end or to a break at its end`,
            );
          const b = this.scoped(inner);
          returns ||= b.returns;
          return b.nodes;
        };
        const cases = s.cases.map((c) => ({ values: c.values, body: clause(c.body) }));
        const defaultBody = s.defaultBody !== undefined ? clause(s.defaultBody) : undefined;
        return {
          nodes: [
            {
              k: 'switch',
              scrut,
              cases,
              ...(defaultBody !== undefined ? { defaultBody } : {}),
            },
          ],
          returns,
        };
      }
      case 'return': {
        const nodes: Node[] = [];
        if (s.expr !== undefined) {
          const expr = this.rename(s.expr);
          this.refuseByReference(expr, false);
          nodes.push({ k: 'assign', target: vref(this.retName, this.f.ret), expr, first: true });
        }
        nodes.push({
          k: 'assign',
          target: vref(this.doneName, BOOL),
          expr: { op: 'lit', type: BOOL, value: true },
          first: true,
        });
        return { nodes, returns: true, ends: true };
      }
      case 'call': {
        const expr = this.rename(s.expr);
        const roots = this.refuseByReference(expr, true);
        return { nodes: [{ k: 'call', expr, roots }], returns: false };
      }
      case 'discard':
        return { nodes: [{ k: 'stmt', stmt: s }], returns: false };
      case 'for':
        throw refuse(
          `"${this.f.name}" has a loop; reverse mode differentiates a loop with the checkpoint schedule of change 0056, which is not delivered yet, so differentiate it in forward mode`,
        );
      case 'break':
      case 'continue':
        throw refuse(`"${this.f.name}" has a ${s.s} outside a loop grad can follow`);
      case 'raw':
      case 'placeholder':
        throw refuse(`"${this.f.name}" contains a ${s.s} statement, which grad cannot read`);
    }
  }

  /** A local the derivative hoists must have a type a `var` can hold. */
  private storable(t: ShaderType, name: string): void {
    if (
      t.kind === 'texture' ||
      t.kind === 'sampler' ||
      t.kind === 'storage-texture' ||
      t.kind === 'depth-texture' ||
      t.kind === 'sampler-comparison' ||
      t.kind === 'atomic'
    )
      throw refuse(
        `"${this.f.name}" keeps a ${shown(t)} in "${name}", which reverse mode cannot hold in a variable`,
      );
  }

  /** The roots a call passes by reference. Such a call is allowed only as a statement, since
   *  the backward sweep recomputes expressions and must not repeat its effect. */
  private refuseByReference(e: Expr, statement: boolean): string[] {
    const roots: string[] = [];
    const visit = (x: Expr, top: boolean): void => {
      if (x.op === 'call') {
        const g = isUserCall(this.ctx.funcs, x);
        if (g !== undefined)
          g.params.forEach((p, i) => {
            if (p.mode !== 'inout' && p.mode !== 'out') return;
            if (!(statement && top))
              throw refuse(
                `"${this.f.name}" calls "${g.name}", which writes "${p.name}" by reference, inside an expression; reverse mode follows such a call as a statement only`,
              );
            const r = rootOf(x.args[i]!);
            if (r !== undefined) roots.push(r);
          });
      }
      forChildren(x, (c) => visit(c, false));
    };
    visit(e, true);
    return roots;
  }

  // ── activity ─────────────────────────────────────────────────────────────────────

  /** Whether `e` carries a derivative: it reads an active name through a differentiable
   *  path. An integer, a boolean or a comparison carries none. */
  private act(e: Expr): boolean {
    switch (e.op) {
      case 'lit':
      case 'constref':
      case 'overrideref':
      case 'externref':
      case 'compare':
      case 'logical':
        return false;
      case 'param':
      case 'varref':
        return this.active.has(e.name) && carries(e.type);
      case 'binop':
        return isDiffType(e.type) && (this.act(e.a) || this.act(e.b));
      case 'unop':
        return carries(e.type) && this.act(e.a);
      case 'call':
        return carries(e.type) && e.args.some((a) => this.act(a));
      case 'member':
      case 'index':
        return carries(e.type) && this.act(e.base);
      case 'construct':
        return e.args.some((a) => this.act(a));
      case 'select':
        return this.act(e.ifTrue) || this.act(e.ifFalse);
      case 'matchExpr':
        return this.act(e.default) || e.cases.some(([, x]) => this.act(x));
    }
  }

  private activity(nodes: readonly Node[]): void {
    for (const n of nodes) {
      switch (n.k) {
        case 'assign': {
          const root = rootOf(n.target);
          if (root !== undefined && this.act(n.expr)) this.active.add(root);
          break;
        }
        case 'if':
          for (const a of n.arms) this.activity(a.body);
          if (n.elseBody) this.activity(n.elseBody);
          break;
        case 'switch':
          for (const c of n.cases) this.activity(c.body);
          if (n.defaultBody) this.activity(n.defaultBody);
          break;
        case 'call': {
          if (n.expr.op === 'call' && n.expr.args.some((a) => this.act(a))) {
            const g = isUserCall(this.ctx.funcs, n.expr);
            if (g !== undefined)
              throw refuse(
                `"${this.f.name}" calls "${n.expr.fn}" as a statement with an argument that depends on the parameter; grad differentiates a call's returned value, so use it in an expression`,
              );
          }
          break;
        }
        case 'stmt':
          break;
      }
    }
  }

  // ── the two sweeps ───────────────────────────────────────────────────────────────

  /** Emit the forward sweep of `nodes` into `fwd` and their backward sweep, last first, into
   *  `bwd`. */
  private sweep(nodes: readonly Node[], fwd: Stmt[], bwd: Stmt[]): void {
    const back: Stmt[][] = [];
    for (const n of nodes) {
      const b: Stmt[] = [];
      this.node(n, fwd, b);
      back.push(b);
    }
    for (let i = back.length - 1; i >= 0; i--) bwd.push(...back[i]!);
  }

  private node(n: Node, fwd: Stmt[], bwd: Stmt[]): void {
    switch (n.k) {
      case 'assign': {
        const root = rootOf(n.target)!;
        const rootType = this.typeOf(root);
        const valueActive = this.act(n.expr);
        if (valueActive && !isDiffType(rootType))
          throw refuse(
            `"${this.f.name}" stores a value that depends on the parameter in "${root}", a ${shown(rootType)}; grad carries a derivative through f32, float-vector and float-matrix values only`,
          );
        let slot: string | undefined;
        if (!n.first) {
          slot = this.fresh(`tape_${root}`);
          this.locals.set(slot, rootType);
          fwd.push(assign(vref(slot, rootType), vref(root, rootType)));
        }
        fwd.push(assign(n.target, n.expr));
        const d = this.adj.get(root);
        let a: string | undefined;
        if (d !== undefined) {
          const path = retarget(n.target, vref(d, rootType));
          if (valueActive) {
            a = this.fresh('a');
            bwd.push({ s: 'let', name: a, expr: path });
          }
          if (!n.first) bwd.push(assign(path, zero(n.target.type)));
        }
        if (slot !== undefined) bwd.push(assign(vref(root, rootType), vref(slot, rootType)));
        if (a !== undefined) this.acc(n.expr, vref(a, n.target.type), bwd);
        return;
      }
      case 'if': {
        const fwdArms: { cond: Expr; body: Stmt[] }[] = [];
        const bwdArms: Stmt[][] = [];
        for (const arm of n.arms) {
          const f: Stmt[] = [];
          const b: Stmt[] = [];
          this.sweep(arm.body, f, b);
          fwdArms.push({ cond: arm.cond, body: f });
          bwdArms.push(b);
        }
        let fElse: Stmt[] | undefined;
        if (n.elseBody !== undefined) {
          const f: Stmt[] = [];
          const b: Stmt[] = [];
          this.sweep(n.elseBody, f, b);
          fElse = f;
          bwdArms.push(b);
        }
        if (bwdArms.every((b) => b.length === 0)) {
          fwd.push({ s: 'if', arms: fwdArms, ...(fElse !== undefined ? { elseBody: fElse } : {}) });
          return;
        }
        const br = this.branch();
        fwdArms.forEach((arm, i) => arm.body.unshift(assign(vref(br, I32), ilit(i + 1))));
        fElse?.unshift(assign(vref(br, I32), ilit(fwdArms.length + 1)));
        fwd.push({ s: 'if', arms: fwdArms, ...(fElse !== undefined ? { elseBody: fElse } : {}) });
        bwd.push(this.replay(br, bwdArms));
        return;
      }
      case 'switch': {
        const bodies = [...n.cases.map((c) => c.body), ...(n.defaultBody ? [n.defaultBody] : [])];
        const fwds: Stmt[][] = [];
        const bwds: Stmt[][] = [];
        for (const body of bodies) {
          const f: Stmt[] = [];
          const b: Stmt[] = [];
          this.sweep(body, f, b);
          fwds.push(f);
          bwds.push(b);
        }
        const needs = bwds.some((b) => b.length > 0);
        const br = needs ? this.branch() : '';
        if (needs) fwds.forEach((f, i) => f.unshift(assign(vref(br, I32), ilit(i + 1))));
        fwd.push({
          s: 'switch',
          scrut: n.scrut,
          cases: n.cases.map((c, i) => ({ values: c.values, body: fwds[i]! })),
          ...(n.defaultBody !== undefined ? { defaultBody: fwds[n.cases.length]! } : {}),
        });
        if (needs) bwd.push(this.replay(br, bwds));
        return;
      }
      case 'call': {
        const slots = n.roots.map((r) => {
          const t = this.typeOf(r);
          const slot = this.fresh(`tape_${r}`);
          this.locals.set(slot, t);
          fwd.push(assign(vref(slot, t), vref(r, t)));
          return { r, slot, t };
        });
        fwd.push({ s: 'call', expr: n.expr });
        for (const { r, slot, t } of slots) bwd.push(assign(vref(r, t), vref(slot, t)));
        return;
      }
      case 'stmt':
        fwd.push(n.stmt);
        return;
    }
  }

  private branch(): string {
    const br = this.fresh('branch');
    this.locals.set(br, I32);
    return br;
  }

  /** The backward sweep of a branch: the arm the forward sweep recorded, by its number. */
  private replay(br: string, arms: readonly Stmt[][]): Stmt {
    const live = arms.map((body, i) => ({ cond: eq(vref(br, I32), ilit(i + 1)), body }));
    return { s: 'if', arms: live.filter((a) => a.body.length > 0) };
  }

  // ── adjoint propagation ──────────────────────────────────────────────────────────

  /** Bind `x` to a fresh `let` unless it is already a name or a literal. */
  private bind(x: Expr, out: Stmt[]): Expr {
    if (x.op === 'varref' || x.op === 'param' || x.op === 'lit') return x;
    const n = this.fresh('a');
    out.push({ s: 'let', name: n, expr: x });
    return vref(n, x.type);
  }

  /** Add the adjoint `a` (of `e`'s type) of `e` into the adjoints of the names `e` reads. */
  private acc(e: Expr, a0: Expr, out: Stmt[]): void {
    if (!this.act(e)) return;
    const a = this.bind(a0, out);
    const T = e.type;
    switch (e.op) {
      case 'param':
      case 'varref': {
        const d = this.adj.get(e.name)!;
        const dv = vref(d, T);
        out.push(assign(dv, bin('+', dv, a, T)));
        return;
      }
      case 'unop':
        this.acc(e.a, neg(a), out);
        return;
      case 'binop':
        this.binop(e, a, out);
        return;
      case 'member': {
        const B = e.base.type;
        if (B.kind !== 'vec')
          throw refuse(
            `"${this.f.name}" reads a field of a ${shown(B)} that depends on the parameter; grad carries a derivative through f32, float-vector and float-matrix values only`,
          );
        const comps = [...e.field].map((c) => COMPONENTS[c]!);
        const path = lvalue(e.base);
        if (path !== undefined && comps.length === 1) {
          const d = retarget(e, this.adjPath(path));
          out.push(assign(d, bin('+', d, a, T)));
          return;
        }
        const t = this.fresh('a');
        out.push({ s: 'var', name: t, type: B, init: zero(B) });
        comps.forEach((c, j) => {
          const slot: Expr = { op: 'member', type: F32, base: vref(t, B), field: XYZW[c]! };
          const part: Expr =
            comps.length === 1 ? a : { op: 'member', type: F32, base: a, field: XYZW[j]! };
          out.push(assign(slot, bin('+', slot, part, F32)));
        });
        this.acc(e.base, vref(t, B), out);
        return;
      }
      case 'index': {
        const B = e.base.type;
        if (B.kind !== 'vec' && B.kind !== 'mat')
          throw refuse(
            `"${this.f.name}" reads an element of a ${shown(B)} that depends on the parameter; grad carries a derivative through f32, float-vector and float-matrix values only`,
          );
        if (B.kind === 'mat') {
          // The column `a` lands in a matrix that is zero elsewhere, built whole: the CPU oracle
          // does not write through a matrix column.
          const col: ShaderType = { kind: 'vec', n: B.rows, elem: 'f32' };
          const cols = Array.from({ length: B.cols }, (_, j) =>
            e.idx.op === 'lit'
              ? Number(e.idx.value) === j
                ? a
                : zero(col)
              : call('select', [zero(col), a, eq(e.idx, { ...ilit(j), type: e.idx.type })], col),
          );
          this.acc(e.base, { op: 'construct', type: B, args: cols }, out);
          return;
        }
        const path = lvalue(e.base);
        if (path !== undefined) {
          const d = retarget(e, this.adjPath(path));
          out.push(assign(d, bin('+', d, a, T)));
          return;
        }
        const t = this.fresh('a');
        out.push({ s: 'var', name: t, type: B, init: zero(B) });
        out.push(assign({ ...e, base: vref(t, B) }, a));
        this.acc(e.base, vref(t, B), out);
        return;
      }
      case 'construct':
        this.construct(e, a, out);
        return;
      case 'select': {
        if (e.cond.type.kind === 'vec') {
          this.acc(e.ifTrue, call('select', [zero(T), a, e.cond], T), out);
          this.acc(e.ifFalse, call('select', [a, zero(T), e.cond], T), out);
          return;
        }
        const t: Stmt[] = [];
        const f: Stmt[] = [];
        this.acc(e.ifTrue, a, t);
        this.acc(e.ifFalse, a, f);
        out.push({ s: 'if', arms: [{ cond: e.cond, body: t }], elseBody: f });
        return;
      }
      case 'matchExpr': {
        const cases = e.cases.map(([v, x]) => {
          const body: Stmt[] = [];
          this.acc(x, a, body);
          return { values: [v], body };
        });
        const dflt: Stmt[] = [];
        this.acc(e.default, a, dflt);
        out.push({ s: 'switch', scrut: e.scrutinee, cases, defaultBody: dflt });
        return;
      }
      case 'call':
        this.callAdj(e, a, out);
        return;
      default:
        return;
    }
  }

  /** The adjoint of an lvalue path: the same path rooted at its root's adjoint. */
  private adjPath(path: Expr): Expr {
    const root = rootOf(path)!;
    const t = this.typeOf(root);
    return vref(this.adj.get(root)!, t);
  }

  /** Sum `x`, of type `T`, down to `U`: the transpose of a broadcast. */
  private unb(x: Expr, U: ShaderType): Expr {
    const T = x.type;
    if (typeKey(T) === typeKey(U)) return x;
    if (U.kind === 'scalar' && T.kind === 'vec')
      return call('dot', [x, { op: 'construct', type: T, args: [lit(1)] }], F32);
    if (U.kind === 'scalar' && T.kind === 'mat') {
      const col: ShaderType = { kind: 'vec', n: T.rows, elem: 'f32' };
      const ones: Expr = { op: 'construct', type: col, args: [lit(1)] };
      let s: Expr | null = null;
      for (let j = 0; j < T.cols; j++) {
        const term = call('dot', [{ op: 'index', type: col, base: x, idx: ilit(j) }, ones], F32);
        s = s === null ? term : bin('+', s, term, F32);
      }
      return s!;
    }
    throw refuse(`cannot sum a ${shown(T)} adjoint down to ${shown(U)}`);
  }

  private binop(e: Extract<Expr, { op: 'binop' }>, a: Expr, out: Stmt[]): void {
    const T = e.type;
    const A = e.a.type;
    const B = e.b.type;
    switch (e.bop) {
      case '+':
        this.acc(e.a, this.unb(a, A), out);
        this.acc(e.b, this.unb(a, B), out);
        return;
      case '-':
        this.acc(e.a, this.unb(a, A), out);
        this.acc(e.b, this.unb(neg(a), B), out);
        return;
      case '*': {
        if (isMat(A) && B.kind === 'vec') {
          this.acc(e.a, outer(a, e.b, A), out);
          this.acc(e.b, bin('*', call('transpose', [e.a], transposed(A)), a, B), out);
          return;
        }
        if (A.kind === 'vec' && isMat(B)) {
          this.acc(e.a, bin('*', e.b, a, A), out);
          this.acc(e.b, outer(e.a, a, B), out);
          return;
        }
        if (isMat(A) && isMat(B)) {
          this.acc(e.a, bin('*', a, call('transpose', [e.b], transposed(B)), A), out);
          this.acc(e.b, bin('*', call('transpose', [e.a], transposed(A)), a, B), out);
          return;
        }
        // Component-wise, with a scalar broadcast on either side.
        this.acc(e.a, this.unb(bin('*', a, e.b, T), A), out);
        this.acc(e.b, this.unb(bin('*', e.a, a, T), B), out);
        return;
      }
      case '/':
        if (isMat(A) || isMat(B))
          throw refuse(`"${this.f.name}" divides a matrix, which reverse mode has no rule for`);
        this.acc(e.a, this.unb(bin('/', a, e.b, T), A), out);
        this.acc(
          e.b,
          this.unb(neg(bin('/', bin('*', a, e.a, T), bin('*', e.b, e.b, B), T)), B),
          out,
        );
        return;
      case '%':
        this.acc(e.a, this.unb(a, A), out);
        this.acc(
          e.b,
          this.unb(neg(bin('*', a, call('trunc', [bin('/', e.a, e.b, T)], T), T)), B),
          out,
        );
        return;
      default:
        return;
    }
  }

  private construct(e: Extract<Expr, { op: 'construct' }>, a: Expr, out: Stmt[]): void {
    const T = e.type;
    if (!isDiffType(T))
      throw refuse(
        `"${this.f.name}" builds a ${shown(T)} from a value that depends on the parameter; grad carries a derivative through f32, float-vector and float-matrix values only`,
      );
    if (e.args.length === 1) {
      const x = e.args[0]!;
      if (x.type.kind === 'scalar') {
        if (T.kind === 'scalar') this.acc(x, a, out);
        else this.acc(x, this.unb(a, F32), out);
        return;
      }
      if (typeKey(x.type) === typeKey(T)) {
        this.acc(x, a, out);
        return;
      }
    }
    if (T.kind === 'vec') {
      let off = 0;
      for (const x of e.args) {
        const n = x.type.kind === 'vec' ? x.type.n : 1;
        const field = XYZW.slice(off, off + n);
        this.acc(
          x,
          { op: 'member', type: x.type.kind === 'vec' ? x.type : F32, base: a, field },
          out,
        );
        off += n;
      }
      return;
    }
    if (T.kind === 'mat') {
      const col: ShaderType = { kind: 'vec', n: T.rows, elem: 'f32' };
      const column = (j: number): Expr => ({ op: 'index', type: col, base: a, idx: ilit(j) });
      if (e.args.every((x) => x.type.kind === 'vec')) {
        e.args.forEach((x, j) => this.acc(x, column(j), out));
        return;
      }
      e.args.forEach((x, k) => {
        const j = Math.floor(k / T.rows);
        const r = k % T.rows;
        this.acc(x, { op: 'index', type: F32, base: column(j), idx: ilit(r) }, out);
      });
      return;
    }
    throw refuse(`"${this.f.name}" builds a ${shown(T)} reverse mode cannot follow`);
  }

  private callAdj(e: Extract<Expr, { op: 'call' }>, a: Expr, out: Stmt[]): void {
    const T = e.type;
    const g = isUserCall(this.ctx.funcs, e);
    if (g !== undefined) {
      if (!isDiffType(g.ret))
        throw refuse(
          `"${g.name}" returns ${shown(g.ret)} and is called with an argument that depends on the parameter; grad differentiates through a function that returns f32, an f32 vector or an f32 matrix`,
        );
      const { name, struct } = this.ctx.vjpOf(g);
      const st: ShaderType = { kind: 'struct', name: struct.name };
      const r = this.fresh('a');
      out.push({ s: 'let', name: r, expr: call(name, [...e.args, a], st) });
      g.params.forEach((p, i) => {
        if (!struct.fields.some((fl) => fl.name === p.name)) return;
        this.acc(e.args[i]!, { op: 'member', type: p.type, base: vref(r, st), field: p.name }, out);
      });
      return;
    }
    const args = e.args;
    switch (e.fn) {
      case 'dot': {
        const [x, y] = args as [Expr, Expr];
        this.acc(x, bin('*', y, a, x.type), out);
        this.acc(y, bin('*', x, a, y.type), out);
        return;
      }
      case 'cross': {
        const [x, y] = args as [Expr, Expr];
        this.acc(x, call('cross', [y, a], T), out);
        this.acc(y, call('cross', [a, x], T), out);
        return;
      }
      case 'length': {
        const [v] = args as [Expr];
        if (v.type.kind === 'scalar') this.acc(v, bin('*', call('sign', [v], F32), a, F32), out);
        else this.acc(v, bin('*', v, bin('/', a, call('length', [v], F32), F32), v.type), out);
        return;
      }
      case 'distance': {
        const [x, y] = args as [Expr, Expr];
        const diff = bin('-', x, y, x.type);
        const g0 =
          x.type.kind === 'scalar'
            ? bin('*', call('sign', [diff], F32), a, F32)
            : bin('*', diff, bin('/', a, call('distance', [x, y], F32), F32), x.type);
        const gx = this.bind(g0, out);
        this.acc(x, gx, out);
        this.acc(y, neg(gx), out);
        return;
      }
      case 'normalize': {
        // The Jacobian of normalize is symmetric, so its transpose is the forward rule.
        const [v] = args as [Expr];
        this.acc(v, RULES.normalize!([v], [a], T)!, out);
        return;
      }
      case 'reflect': {
        // reflect(i, n) = i - 2 dot(n, i) n
        const [i, n] = args as [Expr, Expr];
        const na = call('dot', [n, a], F32);
        this.acc(i, bin('-', a, bin('*', n, bin('*', lit(2), na, F32), T), T), out);
        const ni = call('dot', [n, i], F32);
        this.acc(
          n,
          neg(bin('*', bin('+', bin('*', i, na, T), bin('*', a, ni, T), T), lit(2), T)),
          out,
        );
        return;
      }
      case 'transpose':
        this.acc(args[0]!, call('transpose', [a], args[0]!.type), out);
        return;
      case 'select': {
        const [x, y, c] = args as [Expr, Expr, Expr];
        this.acc(x, call('select', [a, zero(T), c], T), out);
        this.acc(y, call('select', [zero(T), a, c], T), out);
        return;
      }
      default:
        break;
    }
    const rule = RULES[e.fn];
    if (rule === undefined)
      throw refuse(
        `"${this.f.name}" passes a value that depends on the parameter to ${e.fn}(), which has no derivative rule`,
      );
    // A component-wise builtin: its Jacobian is diagonal, so the transpose is the tangent rule
    // with the adjoint as the one non-zero tangent, summed over a broadcast scalar.
    args.forEach((x, i) => {
      if (!this.act(x)) return;
      const d = args.map((_, j) => (j === i ? a : null));
      const c = rule(args, d, T);
      if (c !== null) this.acc(x, this.unb(c, x.type), out);
    });
  }
}

/** Whether a value of `t` can carry a derivative, directly or inside a struct or array. */
function carries(t: ShaderType): boolean {
  return isDiffType(t) || t.kind === 'struct' || t.kind === 'array';
}

/** The outer product `u vᵀ` as the matrix type `M`: column `j` is `u * v[j]`. */
function outer(u: Expr, v: Expr, M: ShaderType): Expr {
  if (M.kind !== 'mat') throw refuse('an outer product needs a matrix type');
  const col: ShaderType = { kind: 'vec', n: M.rows, elem: 'f32' };
  return {
    op: 'construct',
    type: M,
    args: Array.from({ length: M.cols }, (_, j) =>
      bin('*', u, { op: 'index', type: F32, base: v, idx: ilit(j) }, col),
    ),
  };
}

function transposed(M: ShaderType): ShaderType {
  if (M.kind !== 'mat') return M;
  return { ...M, cols: M.rows, rows: M.cols };
}

/** `e` when it is a name, or a component or element path from one, else `undefined`. */
function lvalue(e: Expr): Expr | undefined {
  if (e.op === 'varref' || e.op === 'param') return e;
  if (e.op === 'index' && e.base.type.kind === 'vec')
    return lvalue(e.base) === undefined ? undefined : e;
  // A component of a matrix column (`m[j].x`) is not taken as a path: the CPU oracle does not
  // write through one, so the column is accumulated whole instead.
  if (
    e.op === 'member' &&
    e.base.type.kind === 'vec' &&
    e.field.length === 1 &&
    !(e.base.op === 'index' && e.base.base.type.kind === 'mat')
  )
    return lvalue(e.base) === undefined ? undefined : e;
  return undefined;
}

function forChildren(e: Expr, f: (c: Expr) => void): void {
  switch (e.op) {
    case 'binop':
    case 'compare':
    case 'logical':
      f(e.a);
      f(e.b);
      return;
    case 'unop':
      f(e.a);
      return;
    case 'call':
    case 'construct':
      e.args.forEach(f);
      return;
    case 'member':
      f(e.base);
      return;
    case 'index':
      f(e.base);
      f(e.idx);
      return;
    case 'select':
      f(e.cond);
      f(e.ifTrue);
      f(e.ifFalse);
      return;
    case 'matchExpr':
      f(e.scrutinee);
      e.cases.forEach(([, x]) => f(x));
      f(e.default);
      return;
    default:
      return;
  }
}

function containsBreak(body: readonly Stmt[]): boolean {
  return body.some(
    (s) =>
      s.s === 'break' ||
      (s.s === 'if' &&
        (s.arms.some((a) => containsBreak(a.body)) ||
          (s.elseBody !== undefined && containsBreak(s.elseBody)))),
  );
}

/** The parameters the body assigns to, which the derivative copies into locals. */
function collectWrittenParams(
  body: readonly Stmt[],
  params: ReadonlySet<string>,
  into: Set<string>,
): void {
  const shadowed = new Set<string>();
  const walk = (b: readonly Stmt[]): void => {
    for (const s of b) {
      if (s.s === 'let' || s.s === 'var') shadowed.add(s.name);
      else if (s.s === 'assign' || s.s === 'assignOp') {
        let t: Expr = s.target;
        while (t.op === 'member' || t.op === 'index') t = t.base;
        if (t.op === 'param' && params.has(t.name)) into.add(t.name);
      } else if (s.s === 'if') {
        s.arms.forEach((a) => walk(a.body));
        if (s.elseBody) walk(s.elseBody);
      } else if (s.s === 'switch') {
        s.cases.forEach((c) => walk(c.body));
        if (s.defaultBody) walk(s.defaultBody);
      } else if (s.s === 'for') {
        walk([s.init, s.update, ...s.body]);
      }
    }
  };
  walk(body);
  void shadowed;
}

/** `nodes` without the writes of the return flag, when no guard reads it. */
function dropDone(nodes: readonly Node[], done: string): Node[] {
  const out: Node[] = [];
  for (const n of nodes) {
    if (n.k === 'assign' && n.target.op === 'varref' && n.target.name === done) continue;
    if (n.k === 'if')
      out.push({
        ...n,
        arms: n.arms.map((a) => ({ cond: a.cond, body: dropDone(a.body, done) })),
        ...(n.elseBody !== undefined ? { elseBody: dropDone(n.elseBody, done) } : {}),
      });
    else if (n.k === 'switch')
      out.push({
        ...n,
        cases: n.cases.map((c) => ({ values: c.values, body: dropDone(c.body, done) })),
        ...(n.defaultBody !== undefined ? { defaultBody: dropDone(n.defaultBody, done) } : {}),
      });
    else out.push(n);
  }
  return out;
}
