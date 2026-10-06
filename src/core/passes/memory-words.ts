// ═══ A phase function's memory, as 32-bit words (change 0054, the WebGL2 execution model) ═══
//
// On WebGL2 a storage buffer and a workgroup variable are textures of 32-bit words, laid out as
// std430 lays the binding out, so a texel holds the same bits a WebGPU buffer would. A pass reads
// a word from the texture as it was when the pass began, or from the invocation's own write log;
// it writes a word to that log, and the scatter applies the log once every invocation has run.
//
// This pass rewrites a split entry (`phase-split.ts`) to that model, so an executor sees memory
// only as words:
//
//   - every read of memory becomes `_phLoad(root, word)` calls, one per 32-bit lane, assembled
//     into the value's type (a `bitcastF32` for an `f32` lane, an `i32` conversion for an `i32`
//     one, which reinterprets the bits as WGSL's does);
//   - every write becomes one `_phStore(root, word, bits)` statement per lane;
//   - `arrayLength(root)` becomes the private `_ph_len_<root>`, which the executor sets;
//   - each atomic request becomes a root, a word and the operands, over state variables.
//
// `root` is the index of the memory name in `WordPlan.roots`. A word is the lane's byte offset
// over four. The two calls exist only between this pass and an executor: the CPU model of the GL
// executor (`core/testing/gl-model.ts`) runs them, and the GLSL writer spells them.

import type { Expr, FuncDecl, Stmt, StructDecl } from '../ir/nodes.js';
import { u32T, type ShaderType } from '../ir/types.js';
import { mapChildren } from '../ir/visit.js';
import { typeLayout, wgslLayout } from '../reflect.js';
import type { PhaseCut, PhasePlan } from './phase-split.js';

/** One memory name: a storage binding, or a workgroup variable (one copy per workgroup). */
export interface WordRoot {
  readonly name: string;
  readonly space: 'storage' | 'workgroup';
  readonly type: ShaderType;
  /** The words one element of a runtime-sized array takes, and the words before it; for a
   *  fixed size, the whole value's words in `fixed`. */
  readonly fixed: number;
  readonly stride: number;
}

/** An atomic request in words. */
export interface WordRequest {
  readonly fn: string;
  readonly root: number;
  /** The word, an expression over state variables and literals. */
  readonly word: Expr;
  readonly elem: 'u32' | 'i32';
  readonly operands: readonly Expr[];
  readonly result: string | undefined;
}

/** A split entry whose memory is words. */
export interface WordPlan extends PhasePlan {
  readonly roots: readonly WordRoot[];
  /** The atomic request of each resume point an atomic cut leads to. */
  readonly requests: ReadonlyMap<number, WordRequest>;
}

export class MemoryWordsError extends Error {}

export const LOAD = '_phLoad';
export const STORE = '_phStore';

const lit = (v: number): Expr => ({ op: 'lit', type: u32T, value: v });
const add = (a: Expr, b: Expr): Expr =>
  a.op === 'lit' && a.value === 0
    ? b
    : b.op === 'lit' && b.value === 0
      ? a
      : a.op === 'lit' && b.op === 'lit'
        ? lit((a.value as number) + (b.value as number))
        : { op: 'binop', type: u32T, bop: '+', a, b };
const mul = (a: Expr, k: number): Expr =>
  k === 1
    ? a
    : a.op === 'lit'
      ? lit((a.value as number) * k)
      : { op: 'binop', type: u32T, bop: '*', a, b: lit(k) };
const asU32 = (e: Expr): Expr =>
  e.type.kind === 'scalar' && e.type.scalar === 'u32'
    ? e
    : e.op === 'lit'
      ? lit(e.value as number)
      : { op: 'call', type: u32T, fn: 'u32', args: [e] };

const FIELD = 'xyzw';

/** Rewrite the memory of `plan`'s module to words. */
export function lowerMemoryWords(plan: PhasePlan): WordPlan {
  const m = plan.module;
  const structs = new Map(m.structs.map((s) => [s.name, s]));
  const roots: WordRoot[] = [];
  const rootOf = new Map<string, number>();
  const add_root = (name: string, space: WordRoot['space'], type: ShaderType): void => {
    const w = new Words(structs);
    const { fixed, stride } = w.extent(type);
    rootOf.set(name, roots.length);
    roots.push({ name, space, type, fixed, stride });
  };
  for (const b of m.bindings) if (b.space === 'storage') add_root(b.name, 'storage', b.type);
  for (const v of m.vars ?? []) if (v.space === 'workgroup') add_root(v.name, 'workgroup', v.type);
  const byName = new Map(m.funcs.map((f) => [f.name, f]));
  const words = new Words(structs, rootOf, byName);
  const lengths = new Set<string>();
  // The entry and what it still calls: a function the splitter inlined has no caller left.
  const reached = new Set<string>([plan.entry]);
  const pending = [plan.entry];
  while (pending.length > 0) {
    const f = byName.get(pending.pop()!)!;
    const visit = (x: unknown): void => {
      if (x === null || typeof x !== 'object') return;
      if (Array.isArray(x)) return x.forEach(visit);
      const o = x as { op?: unknown; fn?: unknown };
      if (o.op === 'call' && typeof o.fn === 'string' && byName.has(o.fn) && !reached.has(o.fn)) {
        reached.add(o.fn);
        pending.push(o.fn);
      }
      for (const v of Object.values(o)) visit(v);
    };
    visit(f.body);
  }
  const funcs = m.funcs
    .filter((f) => reached.has(f.name))
    .map((f) => words.lowerFunction(f, f.name === plan.entry, lengths));
  const requests = new Map<number, WordRequest>();
  const cuts = new Map<number, PhaseCut>();
  for (const [pc, cut] of plan.cuts) {
    cuts.set(pc, cut);
    if (cut.kind !== 'atomic') continue;
    const place = words.place(cut.request.args[0]!);
    if (place === undefined)
      throw new MemoryWordsError(`${cut.request.fn}'s location is not memory`);
    const t = cut.request.args[0]!.type;
    requests.set(pc, {
      fn: cut.request.fn,
      root: place.root,
      word: place.word,
      elem: t.kind === 'atomic' ? t.elem : 'u32',
      operands: cut.request.args.slice(1),
      result: cut.result,
    });
  }
  const lengthVars = [...lengths].map((name) => ({
    name: `_ph_len_${name}`,
    space: 'private' as const,
    type: u32T,
  }));
  return {
    ...plan,
    module: { ...m, funcs, vars: [...(m.vars ?? []), ...lengthVars] },
    cuts,
    roots,
    requests,
  };
}

class Words {
  private temps = 0;
  constructor(
    private readonly structs: ReadonlyMap<string, StructDecl>,
    private readonly roots: ReadonlyMap<string, number> = new Map(),
    private readonly funcs: ReadonlyMap<string, FuncDecl> = new Map(),
  ) {}

  private layout(t: ShaderType): { size: number; align: number } {
    return typeLayout(t, 'std430', this.structs);
  }

  /** The words between consecutive elements of an array of `t`. */
  stride(t: ShaderType): number {
    const { size, align } = this.layout(t);
    return (Math.ceil(size / align) * align) / 4;
  }

  /** How many words a value of `t` takes; for a runtime-sized array, its element stride. */
  extent(t: ShaderType): { fixed: number; stride: number } {
    if (t.kind === 'array' && t.size === undefined)
      return { fixed: 0, stride: this.stride(t.elem) };
    if (t.kind === 'struct') {
      const decl = this.structs.get(t.name)!;
      const last = decl.fields.at(-1);
      if (last !== undefined && last.type.kind === 'array' && last.type.size === undefined) {
        const off = wgslLayout(decl, 'std430', this.structs).fields.at(-1)!.offset / 4;
        return { fixed: off, stride: this.stride(last.type.elem) };
      }
    }
    return { fixed: this.layout(t).size / 4, stride: 0 };
  }

  private fieldWord(t: ShaderType & { kind: 'struct' }, field: string): number {
    const decl = this.structs.get(t.name);
    if (decl === undefined) throw new MemoryWordsError(`struct '${t.name}' not declared`);
    const f = wgslLayout(decl, 'std430', this.structs).fields.find((x) => x.name === field);
    if (f === undefined) throw new MemoryWordsError(`no field '${field}' in '${t.name}'`);
    return f.offset / 4;
  }

  /** The root and word of a memory place, or undefined when `e` is not one. */
  place(e: Expr): { root: number; word: Expr } | undefined {
    if (e.op === 'varref' || e.op === 'param') {
      const root = this.roots.get(e.name);
      return root === undefined ? undefined : { root, word: lit(0) };
    }
    if (e.op === 'member') {
      const base = this.place(e.base);
      if (base === undefined || (e.field.length !== 1 && e.base.type.kind !== 'struct'))
        return undefined;
      const t = e.base.type;
      if (t.kind === 'struct')
        return { root: base.root, word: add(base.word, lit(this.fieldWord(t, e.field))) };
      return { root: base.root, word: add(base.word, lit(FIELD.indexOf(e.field))) };
    }
    if (e.op === 'index') {
      const base = this.place(e.base);
      if (base === undefined) return undefined;
      const t = e.base.type;
      const step =
        t.kind === 'array'
          ? this.stride(t.elem)
          : t.kind === 'mat'
            ? this.stride({ kind: 'vec', n: t.rows, elem: 'f32' })
            : 1;
      return { root: base.root, word: add(base.word, mul(asU32(this.lowerExpr(e.idx)), step)) };
    }
    return undefined;
  }

  /** The value of type `t` at `word` of `root`, from its lanes. */
  private load(t: ShaderType, root: number, word: Expr): Expr {
    const lane = (w: Expr): Expr => ({
      op: 'call',
      type: u32T,
      fn: '_phLoad',
      args: [lit(root), w],
    });
    switch (t.kind) {
      case 'scalar':
      case 'atomic': {
        const s = t.kind === 'scalar' ? t.scalar : t.elem;
        const bits = lane(word);
        if (s === 'u32') return bits;
        if (s === 'f32') return { op: 'call', type: t, fn: 'bitcastF32', args: [bits] };
        if (s === 'i32')
          return { op: 'call', type: { kind: 'scalar', scalar: 'i32' }, fn: 'i32', args: [bits] };
        throw new MemoryWordsError(`a ${s} has no storage layout`);
      }
      case 'vec': {
        const s: ShaderType = { kind: 'scalar', scalar: t.elem };
        return {
          op: 'construct',
          type: t,
          args: Array.from({ length: t.n }, (_, k) => this.load(s, root, add(word, lit(k)))),
        };
      }
      case 'mat': {
        const col: ShaderType = { kind: 'vec', n: t.rows, elem: 'f32' };
        const cs = this.stride(col);
        return {
          op: 'construct',
          type: t,
          args: Array.from({ length: t.cols }, (_, c) =>
            this.load(col, root, add(word, lit(c * cs))),
          ),
        };
      }
      case 'struct': {
        const decl = this.structs.get(t.name)!;
        return {
          op: 'construct',
          type: t,
          args: decl.fields.map((f) =>
            this.load(f.type, root, add(word, lit(this.fieldWord(t, f.name)))),
          ),
        };
      }
      case 'array': {
        if (t.size === undefined) throw new MemoryWordsError('a runtime-sized array is read whole');
        const st = this.stride(t.elem);
        return {
          op: 'construct',
          type: t,
          args: Array.from({ length: t.size }, (_, i) =>
            this.load(t.elem, root, add(word, lit(i * st))),
          ),
        };
      }
      default:
        throw new MemoryWordsError(`a ${t.kind} has no storage layout`);
    }
  }

  /** `e` with every read of memory as words, and `arrayLength` of a root as its length. */
  lowerExpr(e: Expr, lengths?: Set<string>): Expr {
    if (e.op === 'call' && e.declRef === undefined && e.fn === 'arrayLength') {
      const a = e.args[0]!;
      const r = a.op === 'varref' || a.op === 'param' ? a.name : undefined;
      if (r !== undefined && this.roots.has(r)) {
        lengths?.add(r);
        return { op: 'varref', type: u32T, name: `_ph_len_${r}` };
      }
    }
    // A swizzle of a memory vector reads each lane it names.
    if (e.op === 'member' && e.field.length > 1 && e.base.type.kind === 'vec') {
      const base = this.place(e.base);
      if (base !== undefined) {
        const s: ShaderType = { kind: 'scalar', scalar: e.base.type.elem };
        return {
          op: 'construct',
          type: e.type,
          args: [...e.field].map((c) =>
            this.load(s, base.root, add(base.word, lit(FIELD.indexOf(c)))),
          ),
        };
      }
    }
    const p = this.place(e);
    if (p !== undefined) return this.load(e.type, p.root, p.word);
    return mapChildren(e, (c) => this.lowerExpr(c, lengths));
  }

  /** The statements that write `value` (a lane-sized value) to the memory place `target`. */
  private stores(target: Expr, value: Expr): Stmt[] {
    const p = this.place(target);
    if (p === undefined)
      throw new MemoryWordsError('a write to memory through a place with no word');
    const t = target.type;
    if (value.op === 'varref') return this.storeValue(p.root, p.word, t, value);
    const name = `_ph_w${this.temps++}`;
    return [
      { s: 'let', name, expr: value },
      ...this.storeValue(p.root, p.word, t, { op: 'varref', type: t, name }),
    ];
  }

  /** The `_phStore` statements that write the value `v` of type `t` at `word` of `root`, one per
   *  lane: a struct field by field, an array element by element, a matrix column by column. */
  private storeValue(root: number, word: Expr, t: ShaderType, v: Expr): Stmt[] {
    const bits = (x: Expr, s: string): Expr =>
      s === 'u32'
        ? x
        : s === 'f32'
          ? { op: 'call', type: u32T, fn: 'bitcastU32', args: [x] }
          : { op: 'call', type: u32T, fn: 'u32', args: [x] };
    const store = (w: Expr, b: Expr): Stmt => ({
      s: 'call',
      expr: { op: 'call', type: { kind: 'void' }, fn: '_phStore', args: [lit(root), w, b] },
    });
    switch (t.kind) {
      case 'scalar':
      case 'atomic':
        return [store(word, bits(v, t.kind === 'scalar' ? t.scalar : t.elem))];
      case 'vec':
        return Array.from({ length: t.n }, (_, k) =>
          store(
            add(word, lit(k)),
            bits(
              { op: 'member', type: { kind: 'scalar', scalar: t.elem }, base: v, field: FIELD[k]! },
              t.elem,
            ),
          ),
        );
      case 'mat': {
        const col: ShaderType = { kind: 'vec', n: t.rows, elem: 'f32' };
        const cs = this.stride(col);
        return Array.from({ length: t.cols }, (_, c) =>
          this.storeValue(root, add(word, lit(c * cs)), col, {
            op: 'index',
            type: col,
            base: v,
            idx: lit(c),
          }),
        ).flat();
      }
      case 'struct': {
        const decl = this.structs.get(t.name)!;
        return decl.fields.flatMap((f) =>
          this.storeValue(root, add(word, lit(this.fieldWord(t, f.name))), f.type, {
            op: 'member',
            type: f.type,
            base: v,
            field: f.name,
          }),
        );
      }
      case 'array': {
        if (t.size === undefined)
          throw new MemoryWordsError('a runtime-sized array is written whole');
        const st = this.stride(t.elem);
        return Array.from({ length: t.size }, (_, i) =>
          this.storeValue(root, add(word, lit(i * st)), t.elem, {
            op: 'index',
            type: t.elem,
            base: v,
            idx: lit(i),
          }),
        ).flat();
      }
      default:
        throw new MemoryWordsError(`a ${t.kind} has no storage layout`);
    }
  }

  /** Each call in `s`'s own expressions whose `inout` argument is memory takes a local copy
   *  instead: the copy is loaded before `s` and stored back after it, as GLSL's copy-in,
   *  copy-out `inout` does. */
  private inoutCopies(s: Stmt, lengths: Set<string>): { pre: Stmt[]; s: Stmt; post: Stmt[] } {
    const pre: Stmt[] = [];
    const post: Stmt[] = [];
    const rewrite = (e: Expr): Expr => {
      const inner = mapChildren(e, rewrite);
      if (inner.op !== 'call') return inner;
      const callee = this.funcs.get(inner.fn);
      if (callee === undefined) return inner;
      let changed = false;
      const args = inner.args.map((a, i) => {
        if (callee.params[i]?.mode !== 'inout' || this.place(a) === undefined) return a;
        const name = `_ph_io${this.temps++}`;
        const place = this.lowerPlace(a, lengths);
        pre.push({ s: 'var', name, type: a.type, init: this.lowerExpr(a, lengths) });
        const copy: Expr = { op: 'varref', type: a.type, name };
        post.push(...this.stores(place, copy));
        changed = true;
        return copy;
      });
      return changed ? { ...inner, args } : inner;
    };
    if (s.s === 'call') return { pre, s: { ...s, expr: rewrite(s.expr) }, post };
    if (s.s === 'let') return { pre, s: { ...s, expr: rewrite(s.expr) }, post };
    if (s.s === 'assign' || s.s === 'assignOp')
      return { pre, s: { ...s, expr: rewrite(s.expr) }, post };
    return { pre, s, post };
  }

  private lowerStmts(body: readonly Stmt[], writes: boolean, lengths: Set<string>): Stmt[] {
    return body.flatMap((s) => this.lowerStmt(s, writes, lengths));
  }

  private lowerStmt(s0: Stmt, writes: boolean, lengths: Set<string>): Stmt[] {
    const { pre, s, post } = writes ? this.inoutCopies(s0, lengths) : { pre: [], s: s0, post: [] };
    if (pre.length > 0) return [...pre, ...this.lowerOne(s, writes, lengths), ...post];
    return this.lowerOne(s, writes, lengths);
  }

  private lowerOne(s: Stmt, writes: boolean, lengths: Set<string>): Stmt[] {
    const E = (e: Expr): Expr => this.lowerExpr(e, lengths);
    const B = (b: readonly Stmt[]): Stmt[] => this.lowerStmts(b, writes, lengths);
    switch (s.s) {
      case 'assign':
      case 'assignOp': {
        if (this.place(s.target) === undefined)
          return [{ ...s, target: this.lowerTarget(s.target, lengths), expr: E(s.expr) }];
        if (!writes) throw new MemoryWordsError('a function other than the entry writes memory');
        const value: Expr =
          s.s === 'assign'
            ? E(s.expr)
            : { op: 'binop', type: s.target.type, bop: s.bop, a: E(s.target), b: E(s.expr) };
        // The place's indices are read once, before the stores, as the backends evaluate them.
        return this.stores(this.lowerPlace(s.target, lengths), value);
      }
      case 'let':
        return [{ ...s, expr: E(s.expr) }];
      case 'var':
        return [s.init ? { ...s, init: E(s.init) } : s];
      case 'call':
        return [{ ...s, expr: E(s.expr) }];
      case 'return':
        return [s.expr ? { ...s, expr: E(s.expr) } : s];
      case 'if':
        return [
          {
            ...s,
            arms: s.arms.map((a) => ({ cond: E(a.cond), body: B(a.body) })),
            ...(s.elseBody ? { elseBody: B(s.elseBody) } : {}),
          },
        ];
      case 'for': {
        const one = (x: Stmt): Stmt => {
          const r = this.lowerStmt(x, writes, lengths);
          if (r.length !== 1) throw new MemoryWordsError("a loop's init or update writes memory");
          return r[0]!;
        };
        return [
          { ...s, init: one(s.init), cond: E(s.cond), update: one(s.update), body: B(s.body) },
        ];
      }
      case 'switch':
        return [
          {
            ...s,
            scrut: E(s.scrut),
            cases: s.cases.map((c) => ({ values: c.values, body: B(c.body) })),
            ...(s.defaultBody ? { defaultBody: B(s.defaultBody) } : {}),
          },
        ];
      default:
        return [s];
    }
  }

  /** A place that is memory, with its indices lowered (they may read memory too). */
  private lowerPlace(e: Expr, lengths: Set<string>): Expr {
    if (e.op === 'index')
      return { ...e, base: this.lowerPlace(e.base, lengths), idx: this.lowerExpr(e.idx, lengths) };
    if (e.op === 'member') return { ...e, base: this.lowerPlace(e.base, lengths) };
    return e;
  }

  /** An assignment target that is not memory: its indices may still read memory. */
  private lowerTarget(e: Expr, lengths: Set<string>): Expr {
    if (e.op === 'index')
      return { ...e, base: this.lowerTarget(e.base, lengths), idx: this.lowerExpr(e.idx, lengths) };
    if (e.op === 'member') return { ...e, base: this.lowerTarget(e.base, lengths) };
    return e;
  }

  lowerFunction(f: FuncDecl, writes: boolean, lengths: Set<string>): FuncDecl {
    return { ...f, body: this.lowerStmts(f.body, writes, lengths) };
  }
}
