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
// A LOOP runs under the checkpoint schedule of change 0056, items 1 and 2 (`loopSweep`). Its
// trip count `N` comes from the header of a counted `for`, or from a count sweep. Its state is
// saved every `K = ceil(N / C)` iterations into `C` slots of a function-memory array, and the
// backward sweep takes the segments last first: it runs each again from its slot, saves the
// states of its iterations into a second array of `C` slots, and sweeps each iteration backward
// after running it once more with its tape. A segment longer than `C` (`N > C²`) reaches each
// iteration from the segment's slot instead, so the time grows as `N² / C` there.

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
  readonly tapeBytes: number;
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
/** `cond ? ifTrue : ifFalse`, component-wise for a vector condition. */
const sel = (cond: Expr, ifTrue: Expr, ifFalse: Expr): Expr => ({
  op: 'select',
  type: ifTrue.type,
  cond,
  ifTrue,
  ifFalse,
});

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
  checkpoints = 32,
  custom: Readonly<Record<string, string>> = {},
): ReverseResult {
  if (!Number.isInteger(checkpoints) || checkpoints < 1 || checkpoints > 4096)
    throw refuse(
      `opts.checkpoints is ${checkpoints}; pass a whole number of checkpoint slots from 1 to 4096`,
    );
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
  const ctx = new ReverseContext(m, taken, checkpoints, custom);
  const decl = ctx.derive(f, wrt, out);
  return {
    module: {
      ...m,
      structs: [...m.structs, ...ctx.structs],
      funcs: [...m.funcs, ...ctx.generated, decl],
    },
    name: out,
    adjoints: Object.fromEntries(wrt.map((w) => [w, w])),
    tapeBytes: ctx.bytes.get(out)!,
  };
}

class ReverseContext {
  readonly generated: FuncDecl[] = [];
  readonly structs: StructDecl[] = [];
  readonly funcs: Map<string, FuncDecl>;
  private readonly vjps = new Map<string, { name: string; struct: StructDecl }>();
  private readonly inProgress = new Set<string>();
  /** The tape bytes of each generated function, its helpers' deepest chain included. */
  readonly bytes = new Map<string, number>();
  readonly structDecls: Map<string, StructDecl>;

  constructor(
    m: ModuleDecl,
    private readonly taken: Set<string>,
    readonly slots: number,
    private readonly custom: Readonly<Record<string, string>>,
  ) {
    this.funcs = new Map(m.funcs.map((g) => [g.name, g]));
    for (const [g, adj] of Object.entries(custom)) {
      if (!this.funcs.has(g))
        throw refuse(`opts.custom names "${g}", which is not a function of the module`);
      if (!this.funcs.has(adj))
        throw refuse(
          `opts.custom gives "${adj}" as the adjoint of "${g}", which is not a function of the module`,
        );
    }
    this.structDecls = new Map(m.structs.map((d) => [d.name, d]));
  }

  private record(name: string, r: Reverse): void {
    let deepest = 0;
    for (const c of r.callees) deepest = Math.max(deepest, this.bytes.get(c) ?? 0);
    this.bytes.set(name, r.tapeWords() * 4 + deepest);
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
    const rev = new Reverse(this, f, new Set(wrt), this.slots);
    const body = rev.build(struct);
    this.record(name, rev);
    return {
      name,
      params: [...f.params.map(({ name: n, type }) => ({ name: n, type })), body.dy],
      ret: { kind: 'struct', name: struct.name },
      body: body.stmts,
      ...(f.lintDisable !== undefined ? { lintDisable: f.lintDisable } : {}),
    };
  }

  /** An author-written adjoint (change 0056, item 1.5): it takes `g`'s parameters and `dy`,
   *  and returns a struct with a field of the same name and type for each float parameter. */
  private authored(g: FuncDecl, adj: FuncDecl): { name: string; struct: StructDecl } {
    const bad = (why: string) =>
      refuse(`"${adj.name}", the adjoint opts.custom gives "${g.name}", ${why}`);
    const n = g.params.length;
    if (adj.params.length !== n + 1)
      throw bad(
        `takes ${adj.params.length} parameters; it takes the ${n} of "${g.name}" and then dy`,
      );
    g.params.forEach((p, i) => {
      if (typeKey(adj.params[i]!.type) !== typeKey(p.type))
        throw bad(`takes ${shown(adj.params[i]!.type)} where "${g.name}" takes ${shown(p.type)}`);
    });
    if (typeKey(adj.params[n]!.type) !== typeKey(g.ret))
      throw bad(
        `takes dy as ${shown(adj.params[n]!.type)}; it is ${shown(g.ret)}, the result of "${g.name}"`,
      );
    const st = adj.ret.kind === 'struct' ? this.structDecls.get(adj.ret.name) : undefined;
    if (st === undefined) throw bad(`returns ${shown(adj.ret)}; it returns a struct of adjoints`);
    for (const p of g.params) {
      if (!isDiffType(p.type) || p.mode !== undefined) continue;
      const fl = st.fields.find((f) => f.name === p.name);
      if (fl === undefined || typeKey(fl.type) !== typeKey(p.type))
        throw bad(`returns ${st.name}, which has no field "${p.name}" of type ${shown(p.type)}`);
    }
    return { name: adj.name, struct: st };
  }

  /** The VJP helper of a callee: its name and its result struct, generated on first use. */
  vjpOf(g: FuncDecl): { name: string; struct: StructDecl } {
    const done = this.vjps.get(g.name);
    if (done !== undefined) return done;
    const own = this.custom[g.name];
    if (own !== undefined) {
      const r = this.authored(g, this.funcs.get(own)!);
      this.vjps.set(g.name, r);
      this.bytes.set(r.name, 0);
      return r;
    }
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
    const rev = new Reverse(this, g, new Set(wrt.map((p) => p.name)), this.slots);
    const body = rev.build(struct);
    this.record(name, rev);
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
  | {
      readonly k: 'call';
      readonly expr: Expr;
      readonly roots: readonly string[];
      /** Inside a loop, whose iterations the backward sweep runs again. */
      readonly inLoop: boolean;
    }
  | { readonly k: 'stmt'; readonly stmt: Stmt; readonly inLoop: boolean }
  | {
      readonly k: 'loop';
      /** The condition, with the break and return flags folded in. */
      readonly cond: Expr;
      /** One iteration: the reset of the continue flag, the body and the update. */
      readonly body: readonly Node[];
      /** The loop-carried state: every variable the iteration writes that lives past it. */
      readonly state: readonly string[];
      /** The trip count from the header of a counted loop, read before the first iteration.
       *  Absent for a loop whose count the count sweep measures. */
      readonly trips?: Expr;
    };

/** The variables of one loop's checkpoint schedule. */
interface LoopVars {
  readonly n: string;
  readonly k: string;
  readonly j: string;
  readonly t: string;
  readonly seg: string;
  readonly lo: string;
  readonly hi: string;
  readonly plain: string;
}

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
  /** The flags of the loops around the statement being normalized, innermost last. */
  private readonly loops: { brk: string; cont: string; brkUsed: boolean; contUsed: boolean }[] = [];
  /** The variables the derivative adds for its tape: slots, records, flags, checkpoints. */
  private readonly tape = new Set<string>();
  /** The VJP helpers this derivative calls. */
  readonly callees = new Set<string>();
  private readonly loopVars = new Map<Node, LoopVars>();

  constructor(
    private readonly ctx: ReverseContext,
    private readonly f: FuncDecl,
    private readonly wrt: ReadonlySet<string>,
    private readonly slots: number,
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
    this.tape.add(this.doneName);
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
    if (!this.doneRead) {
      this.locals.delete(this.doneName);
      this.tape.delete(this.doneName);
    }

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

  /** The words of function memory the tape takes (change 0056, M1). */
  tapeWords(): number {
    let w = 0;
    for (const n of this.tape) {
      const t = this.locals.get(n);
      if (t !== undefined) w += words(t, this.ctx.structDecls);
    }
    return w;
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

  /** `!(f1 || f2 …)` over the flags, spelled as comparisons both targets take. */
  private notAny(flags: Iterable<string>): Expr {
    let e: Expr | undefined;
    for (const fl of flags) {
      if (fl === this.doneName) this.doneRead = true;
      const t = eq(vref(fl, BOOL), { op: 'lit', type: BOOL, value: false });
      e = e === undefined ? t : { op: 'logical', type: BOOL, lop: '&&', a: e, b: t };
    }
    return e!;
  }

  /** A block: its nodes and the flags its statements may set, which make the rest of an
   *  enclosing block skip. The statements after one that may set a flag run under a guard. */
  private block(body: readonly Stmt[]): { nodes: Node[]; exits: Set<string> } {
    const nodes: Node[] = [];
    const exits = new Set<string>();
    for (let i = 0; i < body.length; i++) {
      const r = this.stmt(body[i]!);
      nodes.push(...r.nodes);
      for (const x of r.exits) exits.add(x);
      if (r.ends) return { nodes, exits };
      if (r.exits.size > 0 && i < body.length - 1) {
        this.scopes.push(new Map());
        const rest = this.block(body.slice(i + 1));
        this.scopes.pop();
        for (const x of rest.exits) exits.add(x);
        nodes.push({ k: 'if', arms: [{ cond: this.notAny(r.exits), body: rest.nodes }] });
        return { nodes, exits };
      }
    }
    return { nodes, exits };
  }

  private scoped(body: readonly Stmt[]): { nodes: Node[]; exits: Set<string> } {
    this.scopes.push(new Map());
    const r = this.block(body);
    this.scopes.pop();
    return r;
  }

  private flag(name: string): Node {
    return {
      k: 'assign',
      target: vref(name, BOOL),
      expr: { op: 'lit', type: BOOL, value: true },
      first: true,
    };
  }

  /** One statement: its nodes, the flags it may set, and whether it always leaves its block. */
  private stmt(s: Stmt): { nodes: Node[]; exits: Set<string>; ends?: boolean } {
    const none = new Set<string>();
    const inLoop = this.loops.length > 0;
    switch (s.s) {
      case 'let': {
        const expr = this.rename(s.expr);
        this.storable(s.expr.type, s.name);
        const local = this.declare(s.name, s.expr.type);
        return {
          nodes: [{ k: 'assign', target: vref(local, s.expr.type), expr, first: true }],
          exits: none,
        };
      }
      case 'var': {
        const init = s.init !== undefined ? this.rename(s.init) : undefined;
        this.storable(s.type, s.name);
        const local = this.declare(s.name, s.type);
        // A hoisted variable keeps its value from one iteration to the next, so a declaration
        // without a value writes the zero value the source gives it each time it runs.
        return {
          nodes: [
            {
              k: 'assign',
              target: vref(local, s.type),
              expr: init ?? this.zeroOf(s.type),
              first: true,
            },
          ],
          exits: none,
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
        return { nodes: [{ k: 'assign', target, expr, first: false }], exits: none };
      }
      case 'if': {
        const exits = new Set<string>();
        const arms = s.arms.map((a) => {
          const cond = this.rename(a.cond);
          this.refuseByReference(cond, false);
          const b = this.scoped(a.body);
          for (const x of b.exits) exits.add(x);
          return { cond, body: b.nodes };
        });
        let elseBody: Node[] | undefined;
        if (s.elseBody !== undefined) {
          const b = this.scoped(s.elseBody);
          for (const x of b.exits) exits.add(x);
          elseBody = b.nodes;
        }
        return {
          nodes: [{ k: 'if', arms, ...(elseBody !== undefined ? { elseBody } : {}) }],
          exits,
        };
      }
      case 'switch': {
        const scrut = this.rename(s.scrut);
        this.refuseByReference(scrut, false);
        const exits = new Set<string>();
        const clause = (body: readonly Stmt[]): Node[] => {
          const last = body.length > 0 && body[body.length - 1]!.s === 'break';
          const inner = last ? body.slice(0, -1) : body;
          if (containsBreak(inner))
            throw refuse(
              `"${this.f.name}" leaves a switch clause before its end; reverse mode differentiates a clause that runs to its end or to a break at its end`,
            );
          const b = this.scoped(inner);
          for (const x of b.exits) exits.add(x);
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
          exits,
        };
      }
      case 'return': {
        const nodes: Node[] = [];
        if (s.expr !== undefined) {
          const expr = this.rename(s.expr);
          this.refuseByReference(expr, false);
          nodes.push({ k: 'assign', target: vref(this.retName, this.f.ret), expr, first: true });
        }
        nodes.push(this.flag(this.doneName));
        return { nodes, exits: new Set([this.doneName]), ends: true };
      }
      case 'call': {
        const expr = this.rename(s.expr);
        const roots = this.refuseByReference(expr, true);
        return { nodes: [{ k: 'call', expr, roots, inLoop }], exits: none };
      }
      case 'discard':
        return { nodes: [{ k: 'stmt', stmt: s, inLoop }], exits: none };
      case 'break':
      case 'continue': {
        const loop = this.loops[this.loops.length - 1];
        if (loop === undefined)
          throw refuse(`"${this.f.name}" has a ${s.s} outside a loop grad can follow`);
        const fl = s.s === 'break' ? loop.brk : loop.cont;
        if (s.s === 'break') loop.brkUsed = true;
        else loop.contUsed = true;
        return { nodes: [this.flag(fl)], exits: new Set([fl]), ends: true };
      }
      case 'for':
        return this.loop(s);
      case 'raw':
      case 'placeholder':
        throw refuse(`"${this.f.name}" contains a ${s.s} statement, which grad cannot read`);
    }
  }

  /** A zero value of any type a variable holds: a literal for a float, an integer or a
   *  boolean, else a variable never written, which both targets zero. */
  private zeroOf(t: ShaderType): Expr {
    if (isDiffType(t)) return zero(t);
    if (t.kind === 'scalar') return { op: 'lit', type: t, value: t.scalar === 'bool' ? false : 0 };
    const key = `zero_${typeKey(t).replace(/[^A-Za-z0-9]/g, '_')}`;
    let n = this.zeros.get(key);
    if (n === undefined) {
      n = this.fresh(key);
      this.zeros.set(key, n);
      this.locals.set(n, t);
    }
    return vref(n, t);
  }
  private readonly zeros = new Map<string, string>();

  /** A loop: the nodes of its header's first statement, then the loop node. */
  private loop(s: Extract<Stmt, { s: 'for' }>): {
    nodes: Node[];
    exits: Set<string>;
  } {
    this.scopes.push(new Map());
    const init = this.stmt(s.init);
    const loop = {
      brk: this.fresh('broke'),
      cont: this.fresh('skipped'),
      brkUsed: false,
      contUsed: false,
    };
    this.loops.push(loop);
    const cond0 = this.rename(s.cond);
    this.refuseByReference(cond0, false);
    const declared = new Set(this.locals.keys());
    const body = this.scoped(s.body);
    const update = this.stmt(s.update);
    this.loops.pop();
    this.scopes.pop();
    const inner = new Set([...this.locals.keys()].filter((n) => !declared.has(n)));

    const nodes: Node[] = [...init.nodes];
    const iteration: Node[] = [];
    if (loop.contUsed) {
      this.locals.set(loop.cont, BOOL);
      this.tape.add(loop.cont);
      iteration.push({
        k: 'assign',
        target: vref(loop.cont, BOOL),
        expr: { op: 'lit', type: BOOL, value: false },
        first: true,
      });
    }
    iteration.push(...body.nodes, ...update.nodes);
    const stops: string[] = [];
    if (loop.brkUsed) {
      this.locals.set(loop.brk, BOOL);
      this.tape.add(loop.brk);
      nodes.push({
        k: 'assign',
        target: vref(loop.brk, BOOL),
        expr: { op: 'lit', type: BOOL, value: false },
        first: true,
      });
      stops.push(loop.brk);
    }
    const returns = body.exits.has(this.doneName);
    if (returns) stops.push(this.doneName);
    const cond: Expr =
      stops.length === 0
        ? cond0
        : { op: 'logical', type: BOOL, lop: '&&', a: cond0, b: this.notAny(stops) };

    // The loop-carried state: what an iteration writes that was declared before it.
    const written = new Set<string>();
    writtenRoots(iteration, written);
    const state = [...written].filter((n) => !inner.has(n) && n !== loop.cont);
    for (const st of stops) if (!state.includes(st)) state.push(st);

    const trips =
      !loop.brkUsed && !returns ? this.headerTrips(s, cond0, iteration, state) : undefined;
    nodes.push({
      k: 'loop',
      cond,
      body: iteration,
      state,
      ...(trips !== undefined ? { trips } : {}),
    });
    return { nodes, exits: returns ? new Set([this.doneName]) : new Set() };
  }

  /** The trip count of a counted `for` over an `i32` counter with a positive constant step and
   *  a bound the loop does not write, read from its header before the first iteration. */
  private headerTrips(
    s: Extract<Stmt, { s: 'for' }>,
    cond: Expr,
    iteration: readonly Node[],
    state: readonly string[],
  ): Expr | undefined {
    const c = s.counted;
    if (c === undefined || c.op !== 'add' || !(c.step > 0) || !Number.isInteger(c.step))
      return undefined;
    if (cond.op !== 'compare' || (cond.cop !== '<' && cond.cop !== '<=')) return undefined;
    const i = cond.a;
    if (i.op !== 'varref' || i.type.kind !== 'scalar' || i.type.scalar !== 'i32') return undefined;
    // The counter is written by the update alone, and the bound reads nothing the loop writes.
    const inBody = new Set<string>();
    writtenRoots(
      iteration.filter((_n, k) => k < iteration.length - 1),
      inBody,
    );
    if (inBody.has(i.name)) return undefined;
    const reads = new Set<string>();
    readNames(cond.b, reads);
    if (state.some((st) => st !== i.name && reads.has(st)) || reads.has(i.name)) return undefined;
    const step = ilit(c.step);
    const span = bin('-', cond.b, i, I32);
    const n =
      cond.cop === '<'
        ? bin('/', bin('+', span, ilit(c.step - 1), I32), step, I32)
        : bin('+', bin('/', span, step, I32), ilit(1), I32);
    return {
      op: 'select',
      type: I32,
      cond: { op: 'compare', type: BOOL, cop: cond.cop, a: i, b: cond.b },
      ifTrue: n,
      ifFalse: ilit(0),
    };
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
        case 'loop':
          this.activity(n.body);
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
        if (!this.locals.has(root))
          throw refuse(
            `"${this.f.name}" writes "${root}", a module variable or a binding; reverse mode runs the body again in its backward sweep, so it differentiates a function that writes only its own variables`,
          );
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
          this.tape.add(slot);
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
          // The adjoint of the overwritten value starts at zero. In a loop a local written
          // once per iteration needs this too, since its adjoint variable outlives the iteration.
          bwd.push(assign(path, zero(n.target.type)));
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
        // The record is cleared first: in a loop it still holds the previous iteration's arm.
        fwd.push(assign(vref(br, I32), ilit(0)));
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
        if (needs) {
          fwd.push(assign(vref(br, I32), ilit(0)));
          fwds.forEach((f, i) => f.unshift(assign(vref(br, I32), ilit(i + 1))));
        }
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
        if (n.inLoop) this.refuseEffectInLoop(n.expr);
        const slots = n.roots.map((r) => {
          const t = this.typeOf(r);
          const slot = this.fresh(`tape_${r}`);
          this.locals.set(slot, t);
          this.tape.add(slot);
          fwd.push(assign(vref(slot, t), vref(r, t)));
          return { r, slot, t };
        });
        fwd.push({ s: 'call', expr: n.expr });
        for (const { r, slot, t } of slots) bwd.push(assign(vref(r, t), vref(slot, t)));
        return;
      }
      case 'stmt':
        if (n.inLoop)
          throw refuse(
            `"${this.f.name}" has a ${n.stmt.s} in a loop; reverse mode runs a loop's iterations again in its backward sweep, which would repeat it`,
          );
        fwd.push(n.stmt);
        return;
      case 'loop':
        this.loopSweep(n, fwd, bwd);
        return;
    }
  }

  /** A call statement in a loop runs again in the backward sweep: only a call to a function
   *  of the module that writes nothing but its own variables and its reference arguments
   *  can. */
  private refuseEffectInLoop(e: Expr): void {
    if (e.op !== 'call') return;
    const g = isUserCall(this.ctx.funcs, e);
    const why =
      g === undefined
        ? `${e.fn}(), whose effect`
        : writesOutside(g, this.ctx.funcs, new Set())
          ? `"${g.name}", which writes a module variable or a binding, and the write`
          : undefined;
    if (why !== undefined)
      throw refuse(
        `"${this.f.name}" calls ${why} would repeat when reverse mode runs the loop's iterations again in its backward sweep`,
      );
  }

  private branch(): string {
    const br = this.fresh('branch');
    this.locals.set(br, I32);
    this.tape.add(br);
    return br;
  }

  private local(base: string, t: ShaderType): string {
    const n = this.fresh(base);
    this.locals.set(n, t);
    this.tape.add(n);
    return n;
  }

  /** The statements of `nodes` as the source runs them: no tape, no records. */
  private plain(nodes: readonly Node[]): Stmt[] {
    const out: Stmt[] = [];
    for (const n of nodes) {
      switch (n.k) {
        case 'assign':
          out.push(assign(n.target, n.expr));
          break;
        case 'if':
          out.push({
            s: 'if',
            arms: n.arms.map((a) => ({ cond: a.cond, body: this.plain(a.body) })),
            ...(n.elseBody !== undefined ? { elseBody: this.plain(n.elseBody) } : {}),
          });
          break;
        case 'switch':
          out.push({
            s: 'switch',
            scrut: n.scrut,
            cases: n.cases.map((c) => ({ values: c.values, body: this.plain(c.body) })),
            ...(n.defaultBody !== undefined ? { defaultBody: this.plain(n.defaultBody) } : {}),
          });
          break;
        case 'call':
          out.push({ s: 'call', expr: n.expr });
          break;
        case 'stmt':
          out.push(n.stmt);
          break;
        case 'loop': {
          const v = this.varsOf(n);
          const j = vref(v.plain, I32);
          out.push(
            forLoop(assign(j, ilit(0)), n.cond, assign(j, bin('+', j, ilit(1), I32)), [
              ...this.plain(n.body),
            ]),
          );
          break;
        }
      }
    }
    return out;
  }

  private varsOf(n: Node): LoopVars {
    let v = this.loopVars.get(n);
    if (v === undefined) {
      v = {
        n: this.local('trips', I32),
        k: this.local('stride', I32),
        j: this.local('iter', I32),
        t: this.local('replay', I32),
        seg: this.local('segment', I32),
        lo: this.local('first_iter', I32),
        hi: this.local('end_iter', I32),
        plain: this.local('pass', I32),
      };
      this.loopVars.set(n, v);
    }
    return v;
  }

  /** A loop under the checkpoint schedule (change 0056, items 1 and 2).
   *
   *  Forward: the trip count `N` comes from the header, or from a count sweep that runs the
   *  loop once and restores its state. The loop then runs with its state saved every
   *  `K = ceil(N / C)` iterations into `C` checkpoint slots.
   *
   *  Backward: the segments, last first. Each is run again from its checkpoint, its states
   *  saved into a second array of `C` slots, and its iterations swept backward from those,
   *  each run once more with its tape. When `K > C` a segment does not fit the second array,
   *  and each iteration is reached again from the segment's checkpoint instead. */
  private loopSweep(n: Extract<Node, { k: 'loop' }>, fwd: Stmt[], bwd: Stmt[]): void {
    const C = this.slots;
    const v = this.varsOf(n);
    const N = vref(v.n, I32);
    const K = vref(v.k, I32);
    const j = vref(v.j, I32);
    const t = vref(v.t, I32);
    const seg = vref(v.seg, I32);
    const lo = vref(v.lo, I32);
    const hi = vref(v.hi, I32);
    const state = n.state.map((name) => {
      const type = this.typeOf(name);
      const arr: ShaderType = { kind: 'array', elem: type, size: C };
      return {
        x: vref(name, type),
        s0: vref(this.local(`start_${name}`, type), type),
        ck: vref(this.local(`checkpoint_${name}`, arr), arr),
        st: vref(this.local(`state_${name}`, arr), arr),
        type,
      };
    });
    const at = (a: Expr, i: Expr, type: ShaderType): Expr => ({
      op: 'index',
      type,
      base: a,
      idx: i,
    });
    const save = (slot: (s: (typeof state)[number]) => Expr) =>
      state.map((s) => assign(slot(s), s.x));
    const load = (slot: (s: (typeof state)[number]) => Expr) =>
      state.map((s) => assign(s.x, slot(s)));
    const inc = (x: Expr) => assign(x, bin('+', x, ilit(1), I32));
    const dec = (x: Expr) => assign(x, bin('-', x, ilit(1), I32));
    const lt = (a: Expr, b: Expr): Expr => ({ op: 'compare', type: BOOL, cop: '<', a, b });
    const ge = (a: Expr, b: Expr): Expr => ({ op: 'compare', type: BOOL, cop: '>=', a, b });
    const le = (a: Expr, b: Expr): Expr => ({ op: 'compare', type: BOOL, cop: '<=', a, b });
    const plainIter = () => this.plain(n.body);

    // ── forward ──
    fwd.push(...save((s) => s.s0));
    if (n.trips !== undefined) fwd.push(assign(N, n.trips));
    else {
      fwd.push(forLoop(assign(j, ilit(0)), n.cond, inc(j), plainIter()));
      fwd.push(assign(N, j));
      fwd.push(...load((s) => s.s0));
    }
    fwd.push(
      assign(K, call('max', [ilit(1), bin('/', bin('+', N, ilit(C - 1), I32), ilit(C), I32)], I32)),
    );
    fwd.push(
      forLoop(assign(j, ilit(0)), lt(j, N), inc(j), [
        {
          s: 'if',
          arms: [
            {
              cond: eq({ op: 'binop', type: I32, bop: '%', a: j, b: K }, ilit(0)),
              body: save((s) => at(s.ck, bin('/', j, K, I32), s.type)),
            },
          ],
        },
        ...plainIter(),
      ]),
    );

    // ── backward ──
    const f: Stmt[] = [];
    const b: Stmt[] = [];
    this.sweep(n.body, f, b);
    const fits = le(K, ilit(C));
    bwd.push(
      forLoop(
        assign(
          seg,
          bin('-', bin('/', bin('+', N, bin('-', K, ilit(1), I32), I32), K, I32), ilit(1), I32),
        ),
        ge(seg, ilit(0)),
        dec(seg),
        [
          ...load((s) => at(s.ck, seg, s.type)),
          assign(lo, bin('*', seg, K, I32)),
          assign(hi, call('min', [N, bin('+', lo, K, I32)], I32)),
          {
            s: 'if',
            arms: [
              {
                cond: fits,
                body: [
                  forLoop(assign(j, lo), lt(j, hi), inc(j), [
                    ...save((s) => at(s.st, bin('-', j, lo, I32), s.type)),
                    ...plainIter(),
                  ]),
                ],
              },
            ],
          },
          forLoop(assign(j, bin('-', hi, ilit(1), I32)), ge(j, lo), dec(j), [
            {
              s: 'if',
              arms: [{ cond: fits, body: load((s) => at(s.st, bin('-', j, lo, I32), s.type)) }],
              elseBody: [
                ...load((s) => at(s.ck, seg, s.type)),
                forLoop(assign(t, lo), lt(t, j), inc(t), plainIter()),
              ],
            },
            ...f,
            ...b,
          ]),
        ],
      ),
    );
    bwd.push(...load((s) => s.s0));
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
          const cols: Expr[] = Array.from({ length: B.cols }, (_, j): Expr =>
            e.idx.op === 'lit'
              ? Number(e.idx.value) === j
                ? a
                : zero(col)
              : {
                  op: 'select',
                  type: col,
                  cond: eq(e.idx, { ...ilit(j), type: e.idx.type }),
                  ifTrue: a,
                  ifFalse: zero(col),
                },
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
          this.acc(e.ifTrue, sel(e.cond, a, zero(T)), out);
          this.acc(e.ifFalse, sel(e.cond, zero(T), a), out);
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
      this.callees.add(name);
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
        this.acc(x, sel(c, zero(T), a), out);
        this.acc(y, sel(c, a, zero(T)), out);
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
    else if (n.k === 'loop')
      out.push({ ...n, body: dropDone(n.body, done), state: n.state.filter((x) => x !== done) });
    else out.push(n);
  }
  return out;
}

const forLoop = (init: Stmt, cond: Expr, update: Stmt, body: Stmt[]): Stmt => ({
  s: 'for',
  init,
  cond,
  update,
  body,
});

/** The roots `nodes` write, at any depth. */
function writtenRoots(nodes: readonly Node[], into: Set<string>): void {
  for (const n of nodes) {
    switch (n.k) {
      case 'assign': {
        const r = rootOf(n.target);
        if (r !== undefined) into.add(r);
        break;
      }
      case 'call':
        for (const r of n.roots) into.add(r);
        break;
      case 'if':
        for (const a of n.arms) writtenRoots(a.body, into);
        if (n.elseBody) writtenRoots(n.elseBody, into);
        break;
      case 'switch':
        for (const c of n.cases) writtenRoots(c.body, into);
        if (n.defaultBody) writtenRoots(n.defaultBody, into);
        break;
      case 'loop':
        writtenRoots(n.body, into);
        break;
      case 'stmt':
        break;
    }
  }
}

/** The names `e` reads. */
function readNames(e: Expr, into: Set<string>): void {
  if (e.op === 'varref' || e.op === 'param') into.add(e.name);
  forChildren(e, (c) => readNames(c, into));
}

/** Whether `g`, or a function it calls, writes a module variable or a binding. */
function writesOutside(
  g: FuncDecl,
  funcs: ReadonlyMap<string, FuncDecl>,
  seen: Set<string>,
): boolean {
  if (seen.has(g.name)) return false;
  seen.add(g.name);
  const own = new Set(g.params.map((p) => p.name));
  collectNames(g.body, own);
  let found = false;
  const expr = (e: Expr): void => {
    if (found) return;
    if (e.op === 'call') {
      const h = isUserCall(funcs, e);
      if (h !== undefined && writesOutside(h, funcs, seen)) found = true;
      else if (
        h === undefined &&
        /^(atomic|texture(Store)|store|workgroupBarrier|storageBarrier)/.test(e.fn)
      )
        found = true;
    }
    forChildren(e, expr);
  };
  const walk = (b: readonly Stmt[]): void => {
    for (const s of b) {
      if (found) return;
      switch (s.s) {
        case 'assign':
        case 'assignOp': {
          const r = rootOf(s.target);
          if (r === undefined || !own.has(r)) found = true;
          expr(s.expr);
          break;
        }
        case 'let':
          expr(s.expr);
          break;
        case 'var':
          if (s.init) expr(s.init);
          break;
        case 'call':
        case 'return':
          if (s.expr) expr(s.expr);
          break;
        case 'if':
          s.arms.forEach((a) => {
            expr(a.cond);
            walk(a.body);
          });
          if (s.elseBody) walk(s.elseBody);
          break;
        case 'switch':
          s.cases.forEach((c) => walk(c.body));
          if (s.defaultBody) walk(s.defaultBody);
          break;
        case 'for':
          walk([s.init, s.update, ...s.body]);
          break;
        default:
          break;
      }
    }
  };
  walk(g.body);
  return found;
}

/** The 32-bit words a value of `t` takes in function memory. */
function words(t: ShaderType, structs: ReadonlyMap<string, StructDecl>): number {
  switch (t.kind) {
    case 'scalar':
      return 1;
    case 'vec':
      return t.n;
    case 'mat':
      return t.cols * t.rows;
    case 'array':
      return (t.size ?? 0) * words(t.elem, structs);
    case 'struct':
      return (structs.get(t.name)?.fields ?? []).reduce((a, f) => a + words(f.type, structs), 0);
    default:
      return 1;
  }
}
