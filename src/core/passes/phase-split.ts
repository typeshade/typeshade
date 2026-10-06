// ═══ A compute entry split into phases (change 0054, the WebGL2 execution model) ═══
//
// WebGL2 has no compute stage. Change 0054 runs a dispatch there as a sequence of passes: each
// pass runs every live invocation once, reads memory as it was when the pass began (plus the
// invocation's own writes, from its write log), and writes through a log that a scatter pass
// applies once every invocation has run. A pass cannot wait for another invocation, so the
// entry is cut wherever WGSL makes it wait or makes it depend on an order:
//
//   - at a barrier (`workgroupBarrier`, `storageBarrier`, `textureBarrier`, and either side of
//     `workgroupUniformLoad`), which the executor releases when every live invocation of the
//     workgroup has reached it;
//   - before an atomic operation, which the executor's resolve pass performs for every
//     invocation that requested one, in invocation index order, before the next pass;
//   - where the write log could be full: before a write that would make more than
//     `logEntries` entries since the pass began.
//
// This pass turns the entry into one function that runs from a resume point to the next cut.
// The statements that hold a cut, a write to memory, a `return`, or a `break` or `continue`
// that leaves them are taken apart into blocks; every other statement stays as it is, inside
// its block. The function is a loop over a `switch` on the resume point, `_ph_pc`: a block
// sets the next resume point and either falls back into the loop or, at a cut, returns. A
// local that lives in a taken-apart region becomes a private variable, which is the state the
// executor keeps from one pass to the next (on WebGL2, the state texture). A function the
// entry calls that holds a cut or a write is inlined, so its cuts are the entry's.
//
// The CPU executor of the result is `core/debug/phased.ts`; the GL executor (step 2 of the
// change) reads the same plan.

import type { Expr, FuncDecl, ModuleDecl, ModuleVarDecl, Stmt, StructDecl } from '../ir/nodes.js';
import { boolT, i32T, u32T, type ShaderType } from '../ir/types.js';
import { stageOf } from '../ir/index.js';
import { mapChildren } from '../ir/visit.js';
import { isAtomicIntrinsic, isBarrierIntrinsic } from '../intrinsics.js';

/** Why a pass ends at a resume point, and what the executor does before the next pass. */
export type PhaseCut =
  | {
      /** A barrier: the invocation waits until every live invocation of its workgroup has
       *  reached the same resume point. `stmt` is the barrier, for the message a divergent
       *  workgroup gets. */
      readonly kind: 'barrier';
      readonly fn: string;
      readonly stmt: Stmt | undefined;
    }
  | {
      /** An atomic operation: the resolve pass evaluates `request`, an atomic call whose
       *  location and operands read only private variables, for each invocation in index
       *  order, and stores its value in the private variable `result`, if any. */
      readonly kind: 'atomic';
      readonly request: Expr & { readonly op: 'call' };
      readonly result: string | undefined;
      readonly stmt: Stmt | undefined;
    }
  | {
      /** The write log could be full: the next pass starts with an empty one. */
      readonly kind: 'log';
    };

/** An entry split into phases: what an executor runs and what it keeps between passes. */
export interface PhasePlan {
  /** The module with the entry replaced by its phase function, which has the entry's name,
   *  parameters and attributes, and with the state added as `private` variables. */
  readonly module: ModuleDecl;
  readonly entry: string;
  /** The private variable that holds the resume point: 0 at the start, {@link done} at the
   *  end. */
  readonly pc: string;
  readonly done: number;
  /** Each resume point a pass can stop at, with the cut that stops it there. */
  readonly cuts: ReadonlyMap<number, PhaseCut>;
  /** The variables this pass added, the resume point first: with the module's own private
   *  variables, the state an invocation keeps between passes. */
  readonly state: readonly ModuleVarDecl[];
  /** The write log's size, in entries of at most four lanes. */
  readonly logEntries: number;
}

/** Thrown for an entry this pass cannot split yet; the message says what and where. */
export class PhaseSplitError extends Error {}

const PC = '_ph_pc';

/** The four lanes of one write log entry hold a scalar, a vector or a matrix column. */
const isLaneSized = (t: ShaderType): boolean =>
  t.kind === 'scalar' || t.kind === 'vec' || t.kind === 'atomic';

/** Split the `@compute` entry `entry` of `m` into phases. `m` is a module the CPU oracle runs:
 *  validated, with `autoVars` applied. `logEntries` is the write log's size (change 0054,
 *  decision 4: four). */
export function splitPhases(
  m: ModuleDecl,
  entry: string,
  opts?: { readonly logEntries?: number },
): PhasePlan {
  const logEntries = opts?.logEntries ?? 4;
  const decl = m.funcs.find((f) => f.name === entry);
  if (decl === undefined) throw new PhaseSplitError(`no function "${entry}" in the module`);
  if (stageOf(decl) !== 'compute') {
    throw new PhaseSplitError(`"${entry}" is not a @compute entry`);
  }
  const funcs = new Map(m.funcs.map((f) => [f.name, f]));
  const structs = new Map(m.structs.map((s) => [s.name, s]));
  const memory = new Set<string>([
    ...m.bindings.map((b) => b.name),
    ...(m.vars ?? []).filter((v) => v.space === 'workgroup').map((v) => v.name),
  ]);
  const heavy = heavyFunctions(m, memory);
  const b = new Builder(funcs, structs, memory, heavy, logEntries);
  b.lowerFunctionBody(decl);
  b.insertLogCuts();
  const { body, cuts, done } = b.emit();
  const phase: FuncDecl = { ...decl, body };
  const state: ModuleVarDecl[] = [
    { name: PC, space: 'private', type: u32T, init: { op: 'lit', type: u32T, value: 0 } },
    ...b.state.map((v) => ({ name: v.name, space: 'private' as const, type: v.type })),
  ];
  return {
    module: {
      ...m,
      funcs: m.funcs.map((f) => (f === decl ? phase : f)),
      vars: [...(m.vars ?? []), ...state],
    },
    entry,
    pc: PC,
    done,
    cuts,
    state,
    logEntries,
  };
}

// ── Which functions must be inlined ──

/** The names a function declares: its parameters and every `let` and `var` in its body. */
function localsOf(f: FuncDecl): Set<string> {
  const out = new Set(f.params.map((p) => p.name));
  const walk = (body: readonly Stmt[]): void => {
    for (const s of body) {
      if (s.s === 'let' || s.s === 'var') out.add(s.name);
      else if (s.s === 'if') {
        for (const a of s.arms) walk(a.body);
        if (s.elseBody) walk(s.elseBody);
      } else if (s.s === 'for') walk([s.init, s.update, ...s.body]);
      else if (s.s === 'switch') {
        for (const c of s.cases) walk(c.body);
        if (s.defaultBody) walk(s.defaultBody);
      }
    }
  };
  walk(f.body);
  return out;
}

/** The variable a write lands in: `buf` for `buf[i].x`. */
function rootOf(target: Expr): string | undefined {
  let e = target;
  for (;;) {
    if (e.op === 'varref' || e.op === 'param') return e.name;
    if (e.op === 'member' || e.op === 'index') e = e.base;
    else return undefined;
  }
}

const isCutIntrinsic = (fn: string): boolean =>
  isBarrierIntrinsic(fn) || isAtomicIntrinsic(fn) || fn === 'workgroupUniformLoad';

const isIntrinsicCall = (e: Expr): e is Expr & { op: 'call' } =>
  e.op === 'call' && e.declRef === undefined;

/** Every expression a statement holds directly (not those of nested statements). */
function ownExprs(s: Stmt): Expr[] {
  switch (s.s) {
    case 'let':
      return [s.expr];
    case 'var':
      return s.init ? [s.init] : [];
    case 'assign':
    case 'assignOp':
      return [s.target, s.expr];
    case 'call':
      return [s.expr];
    case 'return':
      return s.expr ? [s.expr] : [];
    case 'if':
      return s.arms.map((a) => a.cond);
    case 'for':
      return [s.cond];
    case 'switch':
      return [s.scrut];
    default:
      return [];
  }
}

/** The statements nested in `s`, one level down. */
function childStmts(s: Stmt): readonly Stmt[] {
  switch (s.s) {
    case 'if':
      return [...s.arms.flatMap((a) => a.body), ...(s.elseBody ?? [])];
    case 'for':
      return [s.init, s.update, ...s.body];
    case 'switch':
      return [...s.cases.flatMap((c) => c.body), ...(s.defaultBody ?? [])];
    default:
      return [];
  }
}

function someExpr(e: Expr, test: (e: Expr) => boolean): boolean {
  if (test(e)) return true;
  let hit = false;
  mapChildren(e, (c) => {
    if (!hit && someExpr(c, test)) hit = true;
    return c;
  });
  return hit;
}

/** The functions an entry must inline: those that reach a cut or write memory, directly or
 *  through a call. */
function heavyFunctions(m: ModuleDecl, memory: ReadonlySet<string>): Set<string> {
  const heavy = new Set<string>();
  const direct = (f: FuncDecl): boolean => {
    const locals = localsOf(f);
    const writesMemory = (t: Expr): boolean => {
      const r = rootOf(t);
      return r !== undefined && !locals.has(r) && memory.has(r);
    };
    const visit = (s: Stmt): boolean =>
      ((s.s === 'assign' || s.s === 'assignOp') && writesMemory(s.target)) ||
      ownExprs(s).some((e) =>
        someExpr(
          e,
          (x) =>
            x.op === 'call' &&
            ((x.declRef === undefined && (isCutIntrinsic(x.fn) || x.fn === 'textureStore')) ||
              heavy.has(x.fn)),
        ),
      ) ||
      childStmts(s).some(visit);
    return f.body.some(visit);
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const f of m.funcs) {
      if (stageOf(f) !== undefined || heavy.has(f.name)) continue;
      if (direct(f)) {
        heavy.add(f.name);
        changed = true;
      }
    }
  }
  return heavy;
}

// ── The control-flow graph ──

type Term =
  | { readonly t: 'goto'; readonly to: number }
  | { readonly t: 'branch'; readonly cond: Expr; readonly then: number; readonly else: number }
  | {
      readonly t: 'switch';
      readonly scrut: Expr;
      readonly cases: readonly { readonly values: readonly number[]; readonly to: number }[];
      readonly dflt: number;
    }
  | { readonly t: 'cut'; readonly cut: PhaseCut; readonly to: number }
  | { readonly t: 'done' };

interface Block {
  stmts: Stmt[];
  term: Term | undefined;
}

/** Where `break`, `continue` and `return` go inside the region being taken apart. */
interface Targets {
  readonly brk: number | undefined;
  readonly cont: number | undefined;
  /** In an inlined function: the variable its value goes to and the block after the call. In
   *  the entry: undefined, and a `return` ends the invocation. */
  readonly ret: { readonly value: string | undefined; readonly to: number } | undefined;
  /** The names of the function being lowered, mapped to their names in the phase function. */
  readonly names: Map<string, string>;
}

const varref = (name: string, type: ShaderType): Expr => ({ op: 'varref', type, name });
const lit = (type: ShaderType, value: number | boolean): Expr => ({ op: 'lit', type, value });

class Builder {
  readonly blocks: Block[] = [];
  readonly state: { name: string; type: ShaderType }[] = [];
  private cur = 0;
  private temps = 0;
  private inlines = 0;

  constructor(
    private readonly funcs: ReadonlyMap<string, FuncDecl>,
    private readonly structs: ReadonlyMap<string, StructDecl>,
    private readonly memory: ReadonlySet<string>,
    private readonly heavy: ReadonlySet<string>,
    private readonly logEntries: number,
  ) {}

  private block(): number {
    this.blocks.push({ stmts: [], term: undefined });
    return this.blocks.length - 1;
  }

  private emitStmt(s: Stmt): void {
    this.blocks[this.cur]!.stmts.push(s);
  }

  /** End the current block at `cut` and continue in a new block, where the next pass resumes. */
  private cutTo(cut: PhaseCut): void {
    const next = this.block();
    this.end({ t: 'cut', cut, to: next }, next);
  }

  /** End the current block with `term` and continue in `next`. */
  private end(term: Term, next: number): void {
    const b = this.blocks[this.cur]!;
    if (b.term === undefined) b.term = term;
    this.cur = next;
  }

  private stateVar(name: string, type: ShaderType): string {
    this.state.push({ name, type });
    return name;
  }

  private temp(type: ShaderType): string {
    return this.stateVar(`_ph_t${this.temps++}`, type);
  }

  lowerFunctionBody(decl: FuncDecl): void {
    this.cur = this.block();
    const names = new Map<string, string>();
    const t: Targets = { brk: undefined, cont: undefined, ret: undefined, names };
    this.lowerBody(decl.body, t);
    this.end({ t: 'done' }, this.block());
  }

  // ── Names ──

  private rename(e: Expr, names: ReadonlyMap<string, string>): Expr {
    if ((e.op === 'varref' || e.op === 'param') && names.has(e.name)) {
      return { op: 'varref', type: e.type, name: names.get(e.name)! };
    }
    return mapChildren(e, (c) => this.rename(c, names));
  }

  private renameStmt(s: Stmt, names: ReadonlyMap<string, string>): Stmt {
    const E = (e: Expr): Expr => this.rename(e, names);
    const S = (x: Stmt): Stmt => this.renameStmt(x, names);
    const n = (name: string): string => names.get(name) ?? name;
    switch (s.s) {
      case 'let':
        return { ...s, name: n(s.name), expr: E(s.expr) };
      case 'var':
        return { ...s, name: n(s.name), ...(s.init ? { init: E(s.init) } : {}) };
      case 'assign':
      case 'assignOp':
        return { ...s, target: E(s.target), expr: E(s.expr) };
      case 'call':
        return { ...s, expr: E(s.expr) };
      case 'return':
        return s.expr ? { ...s, expr: E(s.expr) } : s;
      case 'if':
        return {
          ...s,
          arms: s.arms.map((a) => ({ cond: E(a.cond), body: a.body.map(S) })),
          ...(s.elseBody ? { elseBody: s.elseBody.map(S) } : {}),
        };
      case 'for':
        return { ...s, init: S(s.init), cond: E(s.cond), update: S(s.update), body: s.body.map(S) };
      case 'switch':
        return {
          ...s,
          scrut: E(s.scrut),
          cases: s.cases.map((c) => ({ values: c.values, body: c.body.map(S) })),
          ...(s.defaultBody ? { defaultBody: s.defaultBody.map(S) } : {}),
        };
      default:
        return s;
    }
  }

  // ── What must be taken apart ──

  private writesMemory(target: Expr, names: ReadonlyMap<string, string>): boolean {
    const r = rootOf(target);
    return r !== undefined && !names.has(r) && this.memory.has(r);
  }

  private hasCutCall(e: Expr): boolean {
    return someExpr(
      e,
      (x) =>
        x.op === 'call' &&
        ((x.declRef === undefined && isCutIntrinsic(x.fn)) || this.heavy.has(x.fn)),
    );
  }

  /** Whether `s` must be taken apart rather than kept whole inside a block. `escapes` says
   *  whether a `break` or `continue` at this level leaves the statement being asked about,
   *  for a loop or a switch that is itself taken apart. */
  private needsCfg(s: Stmt, names: ReadonlyMap<string, string>, escapes: boolean): boolean {
    switch (s.s) {
      case 'return':
        return true;
      case 'break':
      case 'continue':
        return escapes;
      case 'assign':
      case 'assignOp':
        if (this.writesMemory(s.target, names)) return true;
        break;
      case 'call':
        if (s.expr.op === 'call' && isIntrinsicCall(s.expr) && s.expr.fn === 'textureStore') {
          return true;
        }
        break;
      default:
        break;
    }
    if (ownExprs(s).some((e) => this.hasCutCall(e) || this.inoutWrites(e, names) > 0)) {
      return true;
    }
    if (s.s === 'for') {
      return [s.init, s.update, ...s.body].some((c) => this.needsCfgInLoop(c, names, 'loop'));
    }
    if (s.s === 'switch') {
      return childStmts(s).some((c) => this.needsCfgInLoop(c, names, 'switch'));
    }
    return childStmts(s).some((c) => this.needsCfg(c, names, escapes));
  }

  /** {@link needsCfg} for a statement inside a loop or a switch that is kept whole: its own
   *  `break` (and, in a loop, `continue`) stays inside. */
  private needsCfgInLoop(
    s: Stmt,
    names: ReadonlyMap<string, string>,
    owner: 'loop' | 'switch',
  ): boolean {
    if (s.s === 'break') return false;
    if (s.s === 'continue') return owner === 'switch';
    if (s.s === 'for') return this.needsCfg(s, names, false);
    if (s.s === 'switch' && owner === 'loop') {
      // A `continue` in a switch inside the loop still belongs to the loop.
      return (
        ownExprs(s).some((e) => this.hasCutCall(e) || this.inoutWrites(e, names) > 0) ||
        childStmts(s).some((c) => this.needsCfgInLoop(c, names, 'loop'))
      );
    }
    if (s.s === 'if') {
      return (
        ownExprs(s).some((e) => this.hasCutCall(e) || this.inoutWrites(e, names) > 0) ||
        childStmts(s).some((c) => this.needsCfgInLoop(c, names, owner))
      );
    }
    return this.needsCfg(s, names, false);
  }

  /** How many log entries the `inout` arguments of the calls in `e` write back to memory. */
  private inoutWrites(e: Expr, names: ReadonlyMap<string, string>): number {
    let n = 0;
    someExpr(e, (x) => {
      if (x.op !== 'call') return false;
      const callee = this.funcs.get(x.fn);
      if (callee === undefined || this.heavy.has(x.fn)) return false;
      callee.params.forEach((p, i) => {
        const a = x.args[i];
        if (p.mode === 'inout' && a !== undefined && this.writesMemory(a, names)) {
          n += this.entriesOf(a.type);
        }
      });
      return false;
    });
    return n;
  }

  /** How many log entries a write of a value of type `t` takes. */
  entriesOf(t: ShaderType): number {
    switch (t.kind) {
      case 'mat':
        return t.cols;
      case 'struct': {
        const s = this.structs.get(t.name);
        return s ? s.fields.reduce((n, f) => n + this.entriesOf(f.type), 0) : 1;
      }
      case 'array':
        return (t.size ?? 1) * this.entriesOf(t.elem);
      default:
        return 1;
    }
  }

  // ── Lowering ──

  private lowerBody(body: readonly Stmt[], t: Targets): void {
    for (const s of body) this.lowerStmt(s, t);
  }

  private lowerStmt(s: Stmt, t: Targets): void {
    if (!this.needsCfg(s, t.names, true)) {
      this.keepWhole(s, t);
      return;
    }
    switch (s.s) {
      case 'let':
      case 'var': {
        const type = s.s === 'let' ? s.expr.type : s.type;
        const name = this.stateVar(this.hoistedName(s.name, t), type);
        t.names.set(s.name, name);
        const init = s.s === 'let' ? s.expr : s.init;
        const value = init ? this.hoist(init, t) : this.zero(type);
        this.emitStmt({ s: 'assign', target: varref(name, type), expr: value });
        return;
      }
      case 'assign':
      case 'assignOp': {
        // The value first, then the place, in the order the CPU backends evaluate them.
        const value = this.hoist(s.expr, t);
        const target = this.hoistPlace(s.target, t);
        if (
          s.s === 'assign' &&
          this.writesMemory(s.target, t.names) &&
          !isLaneSized(s.target.type)
        ) {
          this.writePieces(target, value, s.target.type);
        } else this.emitStmt({ ...s, target, expr: value });
        return;
      }
      case 'call': {
        if (s.expr.op === 'call' && this.isCut(s.expr)) {
          this.lowerCutCall(s.expr, t, s, false);
          return;
        }
        this.emitStmt({ ...s, expr: this.hoist(s.expr, t) });
        return;
      }
      case 'return': {
        const value = s.expr ? this.hoist(s.expr, t) : undefined;
        if (t.ret === undefined) {
          this.end({ t: 'done' }, this.block());
          return;
        }
        if (t.ret.value !== undefined && value !== undefined) {
          this.emitStmt({ s: 'assign', target: varref(t.ret.value, value.type), expr: value });
        }
        this.end({ t: 'goto', to: t.ret.to }, this.block());
        return;
      }
      case 'break':
        if (t.brk === undefined) throw new PhaseSplitError('a break with no loop or switch');
        this.end({ t: 'goto', to: t.brk }, this.block());
        return;
      case 'continue':
        if (t.cont === undefined) throw new PhaseSplitError('a continue with no loop');
        this.end({ t: 'goto', to: t.cont }, this.block());
        return;
      case 'if': {
        const join = this.block();
        for (const arm of s.arms) {
          const cond = this.hoist(arm.cond, t);
          const then = this.block();
          const next = this.block();
          this.end({ t: 'branch', cond, then, else: next }, then);
          this.lowerBody(arm.body, t);
          this.end({ t: 'goto', to: join }, next);
        }
        if (s.elseBody) this.lowerBody(s.elseBody, t);
        this.end({ t: 'goto', to: join }, join);
        return;
      }
      case 'for': {
        this.lowerStmt(s.init, t);
        const head = this.block();
        const body = this.block();
        const update = this.block();
        const exit = this.block();
        this.end({ t: 'goto', to: head }, head);
        const cond = this.hoist(s.cond, t);
        this.end({ t: 'branch', cond, then: body, else: exit }, body);
        this.lowerBody(s.body, { ...t, brk: exit, cont: update });
        this.end({ t: 'goto', to: update }, update);
        this.lowerStmt(s.update, t);
        this.end({ t: 'goto', to: head }, exit);
        return;
      }
      case 'switch': {
        const scrut = this.hoist(s.scrut, t);
        const join = this.block();
        const cases = s.cases.map((c) => ({ values: c.values, to: this.block(), body: c.body }));
        const dflt = this.block();
        this.end(
          { t: 'switch', scrut, cases: cases.map(({ values, to }) => ({ values, to })), dflt },
          join,
        );
        for (const c of cases) {
          this.cur = c.to;
          this.lowerBody(c.body, { ...t, brk: join });
          this.end({ t: 'goto', to: join }, join);
        }
        this.cur = dflt;
        if (s.defaultBody) this.lowerBody(s.defaultBody, { ...t, brk: join });
        this.end({ t: 'goto', to: join }, join);
        return;
      }
      case 'discard':
        throw new PhaseSplitError('a compute entry has no discard');
      default:
        throw new PhaseSplitError(`a ${s.s} statement cannot be split into phases`);
    }
  }

  /** A statement with nothing to take apart: renamed, and kept whole in the current block. */
  private keepWhole(s: Stmt, t: Targets): void {
    if (s.s === 'let' || s.s === 'var') {
      // A local of a region that is taken apart can live across a cut, so it becomes state.
      const type = s.s === 'let' ? s.expr.type : s.type;
      const name = this.stateVar(this.hoistedName(s.name, t), type);
      const init = s.s === 'let' ? s.expr : s.init;
      const value = init ? this.rename(init, t.names) : this.zero(type);
      t.names.set(s.name, name);
      this.emitStmt({ s: 'assign', target: varref(name, type), expr: value, ...spanOf(s) });
      return;
    }
    this.emitStmt(this.renameStmt(s, t.names));
  }

  /** The state variable a local becomes: the name an inlined function's locals were given, or
   *  the entry's own name with a prefix. */
  private hoistedName(name: string, t: Targets): string {
    return t.names.get(name) ?? `_ph_${name}`;
  }

  private isCut(e: Expr & { op: 'call' }): boolean {
    return (e.declRef === undefined && isCutIntrinsic(e.fn)) || this.heavy.has(e.fn);
  }

  /** Rewrite `e` so it holds no cut: each atomic, barrier or inlined call it makes is lowered
   *  first, in evaluation order, and replaced by the variable that holds its value. */
  private hoist(e: Expr, t: Targets): Expr {
    if (!this.hasCutCall(e)) return this.rename(e, t.names);
    if (e.op === 'logical' || e.op === 'select' || e.op === 'matchExpr') {
      throw new PhaseSplitError(
        `an atomic operation, a barrier or a call that writes memory inside a ${e.op === 'logical' ? '&& or ||' : 'conditional expression'} cannot be split into phases yet`,
      );
    }
    if (e.op === 'call' && this.isCut(e)) {
      return this.lowerCutCall(e, t, undefined, true) ?? lit(u32T, 0);
    }
    return mapChildren(e, (c) => this.hoist(c, t));
  }

  /** The place an assignment writes, with each index that is not a literal evaluated once
   *  into state, so a write taken apart into pieces, or past a cut, lands where it started. */
  private hoistPlace(target: Expr, t: Targets): Expr {
    if (target.op === 'index') {
      const base = this.hoistPlace(target.base, t);
      const idx = this.hoist(target.idx, t);
      const stable = idx.op === 'lit' || idx.op === 'constref';
      if (stable || !this.writesMemory(target, t.names)) return { ...target, base, idx };
      const tmp = this.temp(idx.type);
      this.emitStmt({ s: 'assign', target: varref(tmp, idx.type), expr: idx });
      return { ...target, base, idx: varref(tmp, idx.type) };
    }
    if (target.op === 'member') return { ...target, base: this.hoistPlace(target.base, t) };
    return this.rename(target, t.names);
  }

  /** Write `value` to the memory place `target` one log entry at a time. */
  private writePieces(target: Expr, value: Expr, type: ShaderType): void {
    if (isLaneSized(type)) {
      this.emitStmt({ s: 'assign', target, expr: value });
      return;
    }
    let src = value;
    if (value.op !== 'varref') {
      const tmp = this.temp(type);
      this.emitStmt({ s: 'assign', target: varref(tmp, type), expr: value });
      src = varref(tmp, type);
    }
    if (type.kind === 'struct') {
      const decl = this.structs.get(type.name);
      if (decl === undefined) throw new PhaseSplitError(`struct '${type.name}' not declared`);
      for (const f of decl.fields) {
        this.writePieces(
          { op: 'member', type: f.type, base: target, field: f.name },
          { op: 'member', type: f.type, base: src, field: f.name },
          f.type,
        );
      }
      return;
    }
    if (type.kind === 'array' || type.kind === 'mat') {
      const count = type.kind === 'array' ? type.size : type.cols;
      if (count === undefined) throw new PhaseSplitError('a runtime-sized array is written whole');
      const elem: ShaderType =
        type.kind === 'array' ? type.elem : { kind: 'vec', n: type.rows, elem: 'f32' };
      for (let i = 0; i < count; i++) {
        const idx = lit(u32T, i);
        this.writePieces(
          { op: 'index', type: elem, base: target, idx },
          { op: 'index', type: elem, base: src, idx },
          elem,
        );
      }
      return;
    }
    throw new PhaseSplitError(`a write of a ${type.kind} cannot be split into log entries`);
  }

  /** Lower one atomic, barrier or inlined call. Returns the variable that holds its value when
   *  `wantValue`. */
  private lowerCutCall(
    e: Expr & { op: 'call' },
    t: Targets,
    stmt: Stmt | undefined,
    wantValue: boolean,
  ): Expr | undefined {
    if (e.declRef === undefined && isBarrierIntrinsic(e.fn)) {
      this.cutTo({ kind: 'barrier', fn: e.fn, stmt });
      return undefined;
    }
    if (e.declRef === undefined && e.fn === 'workgroupUniformLoad') {
      // A read with a barrier on each side (wgsl.txt:26057).
      const loc = this.hoist(e.args[0]!, t);
      const barrier: PhaseCut = { kind: 'barrier', fn: e.fn, stmt };
      this.cutTo(barrier);
      const tmp = this.temp(e.type);
      this.emitStmt({ s: 'assign', target: varref(tmp, e.type), expr: loc });
      this.cutTo(barrier);
      return varref(tmp, e.type);
    }
    if (e.declRef === undefined && isAtomicIntrinsic(e.fn)) {
      const loc = this.requestPlace(e.args[0]!, t);
      const operands = e.args.slice(1).map((a) => this.requestValue(a, t));
      const result = wantValue && e.type.kind !== 'void' ? this.temp(e.type) : undefined;
      const request = { ...e, args: [loc, ...operands] };
      this.cutTo({ kind: 'atomic', request, result, stmt });
      return result === undefined ? undefined : varref(result, e.type);
    }
    return this.inline(e, t, wantValue);
  }

  /** An atomic's location, with each index that is not a literal saved to state. */
  private requestPlace(loc: Expr, t: Targets): Expr {
    if (loc.op === 'index') {
      return { ...loc, base: this.requestPlace(loc.base, t), idx: this.requestValue(loc.idx, t) };
    }
    if (loc.op === 'member') return { ...loc, base: this.requestPlace(loc.base, t) };
    return this.rename(loc, t.names);
  }

  /** An atomic's operand, saved to state unless it is a literal or a constant. */
  private requestValue(e: Expr, t: Targets): Expr {
    const v = this.hoist(e, t);
    if (v.op === 'lit' || v.op === 'constref' || v.op === 'overrideref') return v;
    const tmp = this.temp(v.type);
    this.emitStmt({ s: 'assign', target: varref(tmp, v.type), expr: v });
    return varref(tmp, v.type);
  }

  /** Inline a call to a function that reaches a cut or writes memory. */
  private inline(e: Expr & { op: 'call' }, t: Targets, wantValue: boolean): Expr | undefined {
    const callee = this.funcs.get(e.fn);
    if (callee === undefined) throw new PhaseSplitError(`unknown function '${e.fn}'`);
    if (callee.params.some((p) => p.mode === 'inout')) {
      throw new PhaseSplitError(
        `'${e.fn}' takes an inout parameter and reaches a barrier, an atomic operation or a memory write; it cannot be inlined into phases yet`,
      );
    }
    const k = this.inlines++;
    const names = new Map<string, string>();
    const args = e.args.map((a) => this.hoist(a, t));
    callee.params.forEach((p, i) => {
      const name = this.stateVar(`_ph${k}_${p.name}`, p.type);
      names.set(p.name, name);
      this.emitStmt({ s: 'assign', target: varref(name, p.type), expr: args[i]! });
    });
    for (const local of localsOf(callee)) {
      if (!names.has(local)) names.set(local, `_ph${k}_${local}`);
    }
    const value = callee.ret.kind !== 'void' ? this.stateVar(`_ph${k}_ret`, callee.ret) : undefined;
    const after = this.block();
    const inner: Targets = {
      brk: undefined,
      cont: undefined,
      ret: { value, to: after },
      names,
    };
    this.lowerBody(callee.body, inner);
    this.end({ t: 'goto', to: after }, after);
    return wantValue && value !== undefined ? varref(value, callee.ret) : undefined;
  }

  /** The zero value of `type`, as an expression. */
  private zero(type: ShaderType): Expr {
    switch (type.kind) {
      case 'scalar':
        return lit(type, type.scalar === 'bool' ? false : 0);
      case 'vec':
        return {
          op: 'construct',
          type,
          args: [lit({ kind: 'scalar', scalar: type.elem }, type.elem === 'bool' ? false : 0)],
        };
      case 'mat':
        return {
          op: 'construct',
          type,
          args: Array.from({ length: type.cols * type.rows }, () =>
            lit({ kind: 'scalar', scalar: 'f32' }, 0),
          ),
        };
      case 'struct': {
        const decl = this.structs.get(type.name);
        if (decl === undefined) throw new PhaseSplitError(`struct '${type.name}' not declared`);
        return { op: 'construct', type, args: decl.fields.map((f) => this.zero(f.type)) };
      }
      case 'array':
        if (type.size === undefined) throw new PhaseSplitError('a runtime-sized local array');
        return {
          op: 'construct',
          type,
          args: Array.from({ length: type.size }, () => this.zero(type.elem)),
        };
      default:
        throw new PhaseSplitError(`a local of kind ${type.kind} cannot be kept between passes`);
    }
  }

  // ── The write log ──

  /** How many log entries `s` writes. */
  private writesOf(s: Stmt): number {
    if ((s.s === 'assign' || s.s === 'assignOp') && this.writesMemory(s.target, new Map())) {
      return 1;
    }
    if (
      s.s === 'call' &&
      s.expr.op === 'call' &&
      isIntrinsicCall(s.expr) &&
      s.expr.fn === 'textureStore'
    ) {
      return 1;
    }
    return ownExprs(s).reduce((n, e) => n + this.inoutWrites(e, new Map()), 0);
  }

  /** Cut before every write that would make more than `logEntries` entries since the pass
   *  began, on any path. */
  insertLogCuts(): void {
    for (;;) {
      const n = this.blocks.length;
      const inCount = new Array<number>(n).fill(-1);
      inCount[0] = 0;
      const cap = this.logEntries + 1;
      const out = (b: number): number => {
        let c = inCount[b]!;
        for (const s of this.blocks[b]!.stmts) c = Math.min(cap, c + this.writesOf(s));
        return c;
      };
      for (let changed = true; changed;) {
        changed = false;
        for (let b = 0; b < n; b++) {
          if (inCount[b]! < 0) continue;
          const o = out(b);
          for (const [succ, reset] of successors(this.blocks[b]!.term)) {
            const v = reset ? 0 : o;
            if (v > inCount[succ]!) {
              inCount[succ] = v;
              changed = true;
            }
          }
        }
      }
      let split = false;
      for (let b = 0; b < n && !split; b++) {
        if (inCount[b]! < 0) continue;
        let c = inCount[b]!;
        const stmts = this.blocks[b]!.stmts;
        for (let i = 0; i < stmts.length; i++) {
          const w = this.writesOf(stmts[i]!);
          if (w > this.logEntries) {
            throw new PhaseSplitError(
              `one statement writes ${w} log entries, more than the log's ${this.logEntries}`,
            );
          }
          if (c + w > this.logEntries) {
            const rest = this.block();
            this.blocks[rest]!.stmts = stmts.slice(i);
            this.blocks[rest]!.term = this.blocks[b]!.term;
            this.blocks[b]!.stmts = stmts.slice(0, i);
            this.blocks[b]!.term = { t: 'cut', cut: { kind: 'log' }, to: rest };
            split = true;
            break;
          }
          c += w;
        }
      }
      if (!split) return;
    }
  }

  // ── The phase function ──

  emit(): { body: Stmt[]; cuts: Map<number, PhaseCut>; done: number } {
    const done = this.blocks.length;
    const pc = varref(PC, u32T);
    const setPc = (to: number): Stmt => ({ s: 'assign', target: pc, expr: lit(u32T, to) });
    const cuts = new Map<number, PhaseCut>();
    const cases = this.blocks.map((blk, id) => {
      const term = blk.term ?? { t: 'done' as const };
      const tail: Stmt[] = [];
      switch (term.t) {
        case 'goto':
          tail.push(setPc(term.to));
          break;
        case 'branch':
          tail.push({
            s: 'if',
            arms: [{ cond: term.cond, body: [setPc(term.then)] }],
            elseBody: [setPc(term.else)],
          });
          break;
        case 'switch':
          tail.push({
            s: 'switch',
            scrut: term.scrut,
            cases: term.cases.map((c) => ({ values: c.values, body: [setPc(c.to)] })),
            defaultBody: [setPc(term.dflt)],
          });
          break;
        case 'cut':
          cuts.set(term.to, term.cut);
          tail.push(setPc(term.to), { s: 'return' });
          break;
        case 'done':
          tail.push(setPc(done), { s: 'return' });
          break;
      }
      return { values: [id], body: [...blk.stmts, ...tail] };
    });
    const w = varref('_ph_w', i32T);
    const loop: Stmt = {
      s: 'for',
      init: { s: 'var', name: '_ph_w', type: i32T, init: lit(i32T, 0) },
      cond: lit(boolT, true),
      update: {
        s: 'assign',
        target: w,
        expr: { op: 'binop', type: i32T, bop: '+', a: w, b: lit(i32T, 1) },
      },
      body: [{ s: 'switch', scrut: pc, cases, defaultBody: [{ s: 'return' }] }],
    };
    return { body: [loop], cuts, done };
  }
}

/** The blocks a terminator leads to, each with whether a pass ends on the way. */
function successors(term: Term | undefined): [number, boolean][] {
  if (term === undefined) return [];
  switch (term.t) {
    case 'goto':
      return [[term.to, false]];
    case 'branch':
      return [
        [term.then, false],
        [term.else, false],
      ];
    case 'switch':
      return [...term.cases.map((c): [number, boolean] => [c.to, false]), [term.dflt, false]];
    case 'cut':
      return [[term.to, true]];
    case 'done':
      return [];
  }
}

function spanOf(s: Stmt): { span?: Stmt['span'] } {
  return s.span ? { span: s.span } : {};
}
