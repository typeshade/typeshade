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
//   - `arrayLength(root)` becomes the private `_phx_len_<root>`, which the executor sets;
//   - each atomic request becomes a root, a word and the operands, over state variables.
//
// `root` is the index of the memory name in `WordPlan.roots`. A word is the lane's byte offset
// over four. The two calls exist only between this pass and an executor: the CPU model of the GL
// executor (`core/testing/gl-model.ts`) runs them, and the GLSL writer spells them.

import type { Expr, FuncDecl, Stmt, StructDecl } from '../ir/nodes.js';
import { i32T, storageTexel, u32T, type ShaderType } from '../ir/types.js';
import { mapChildren } from '../ir/visit.js';
import { collectLocals } from './opt/expr-utils.js';
import { typeLayout, wgslLayout } from '../reflect.js';
import type { PhaseCut, PhasePlan } from './phase-split.js';

/** One memory name: a storage binding, a workgroup variable (one copy per workgroup), or a 2D
 *  storage texture, whose texel `(x, y)` is `channels` words from word `(y × width + x) ×
 *  channels`, each the bits of one channel of its texel type. */
export interface WordRoot {
  readonly name: string;
  readonly space: 'storage' | 'workgroup' | 'texture';
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

/** The words one texel of a storage texture of `format` takes: one per channel. */
export function textureChannels(format: string): number {
  return format.startsWith('rgba') || format.startsWith('bgra')
    ? 4
    : format.startsWith('rg')
      ? 2
      : 1;
}

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
  const byName = new Map(m.funcs.map((f) => [f.name, f]));
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
  // Memory is what the entry and its callees name: a binding only another entry reaches has no
  // root, so the host gives it no words.
  // An atomic operation the splitter cut out names its location in the cut's request.
  const named = referenced(
    m.funcs.filter((f) => reached.has(f.name)),
    [...plan.cuts.values()],
  );
  for (const b of m.bindings)
    if (b.space === 'storage' && named.has(b.name)) add_root(b.name, 'storage', b.type);
  for (const v of m.vars ?? [])
    if (v.space === 'workgroup' && named.has(v.name)) add_root(v.name, 'workgroup', v.type);
  // A storage texture is words too, a texel's channels in a row; its width and height are its
  // length word, `width | height << 16`, which the executor sets as it sets an array's length.
  const lengths = new Set<string>();
  const textures = new Map<string, TextureRoot>();
  for (const b of m.bindings) {
    if (b.type.kind !== 'storage-texture' || !named.has(b.name)) continue;
    if (b.type.dim !== '2d')
      throw new MemoryWordsError(`the storage texture "${b.name}" is an array of layers`);
    const channels = textureChannels(b.type.format);
    textures.set(b.name, {
      root: roots.length,
      channels,
      texel: storageTexel(b.type.format),
    });
    rootOf.set(b.name, roots.length);
    roots.push({ name: b.name, space: 'texture', type: b.type, fixed: 0, stride: channels });
    lengths.add(b.name);
  }
  const words = new Words(structs, rootOf, byName, textures);
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
    name: `_phx_len_${name}`,
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

/** A storage texture's root, the words of a texel, and the scalar of its texel type. */
interface TextureRoot {
  readonly root: number;
  readonly channels: number;
  readonly texel: 'f32' | 'i32' | 'u32';
}

const u32Of = (e: Expr): Expr =>
  e.type.kind === 'scalar' && e.type.scalar === 'u32'
    ? e
    : { op: 'call', type: u32T, fn: 'u32', args: [e] };
const bin = (bop: '&' | '>>' | '*' | '+' | '-', a: Expr, b: Expr): Expr => ({
  op: 'binop',
  type: a.type,
  bop,
  a,
  b,
});
const comp = (base: Expr, k: number): Expr => ({
  op: 'member',
  type: base.type.kind === 'vec' ? { kind: 'scalar', scalar: base.type.elem } : base.type,
  base,
  field: FIELD[k]!,
});

class Words {
  private temps = 0;
  /** The names the function being lowered declares, which hide a binding of the same name: the
   *  `out` an array method's helper fills is its own array, not the storage `out`. */
  private shadowed: ReadonlySet<string> = new Set();
  constructor(
    private readonly structs: ReadonlyMap<string, StructDecl>,
    private readonly roots: ReadonlyMap<string, number> = new Map(),
    private readonly funcs: ReadonlyMap<string, FuncDecl> = new Map(),
    private readonly textures: ReadonlyMap<string, TextureRoot> = new Map(),
  ) {}

  /** The storage texture a handle argument names, with its name. */
  private textureOf(e: Expr | undefined): (TextureRoot & { name: string }) | undefined {
    if (e === undefined || (e.op !== 'varref' && e.op !== 'param') || this.shadowed.has(e.name))
      return undefined;
    const t = this.textures.get(e.name);
    return t === undefined ? undefined : { ...t, name: e.name };
  }

  /** A storage texture's width and height, from its length word. */
  private dims(name: string): { w: Expr; h: Expr } {
    const len: Expr = { op: 'varref', type: u32T, name: `_phx_len_${name}` };
    return { w: bin('&', len, lit(0xffff)), h: bin('>>', len, lit(16)) };
  }

  /** The first word of texel `(x, y)` (two `u32`s inside the texture) of `t`. */
  private texelWord(t: TextureRoot & { name: string }, x: Expr, y: Expr): Expr {
    return mul(add(bin('*', y, this.dims(t.name).w), x), t.channels);
  }

  /** `textureLoad(t, coords)` of a storage texture: the texel's channels from its words, the
   *  coordinates clamped into the texture, as Tint's robustness clamps them on WebGPU; a
   *  channel the format lacks is 0, and alpha 1. */
  private textureLoad(t: TextureRoot & { name: string }, coords: Expr, type: ShaderType): Expr {
    const { w, h } = this.dims(t.name);
    const c = this.lowerExpr(coords);
    const signed = c.type.kind === 'vec' && c.type.elem === 'i32';
    const clamp = (v: Expr, size: Expr): Expr =>
      signed
        ? u32Of({
            op: 'call',
            type: i32T,
            fn: 'clamp',
            args: [
              v,
              { op: 'lit', type: i32T, value: 0 },
              bin(
                '-',
                { op: 'call', type: i32T, fn: 'i32', args: [size] },
                { op: 'lit', type: i32T, value: 1 },
              ),
            ],
          })
        : { op: 'call', type: u32T, fn: 'min', args: [v, bin('-', size, lit(1))] };
    const word = this.texelWord(t, clamp(comp(c, 0), w), clamp(comp(c, 1), h));
    const scalar: ShaderType = { kind: 'scalar', scalar: t.texel };
    const one = (v: number): Expr => ({ op: 'lit', type: scalar, value: v });
    return {
      op: 'construct',
      type,
      args: Array.from({ length: 4 }, (_, k) =>
        k < t.channels ? this.load(scalar, t.root, add(word, lit(k))) : one(k === 3 ? 1 : 0),
      ),
    };
  }

  /** `textureStore(t, coords, value)` of a storage texture: the value's channels into the
   *  texel's words, and nothing where the coordinates are outside the texture, as Tint's
   *  robustness drops such a store on WebGPU. */
  private textureStore(t: TextureRoot & { name: string }, coords: Expr, value: Expr): Stmt[] {
    const { w, h } = this.dims(t.name);
    const at = `_phx_tc${this.temps++}`;
    const v = `_phx_tv${this.temps++}`;
    const c: Expr = { op: 'varref', type: coords.type, name: at };
    const val: Expr = { op: 'varref', type: value.type, name: v };
    const x = u32Of(comp(c, 0));
    const y = u32Of(comp(c, 1));
    const word = this.texelWord(t, x, y);
    const scalar: ShaderType = { kind: 'scalar', scalar: t.texel };
    const inside: Expr = {
      op: 'logical',
      type: { kind: 'scalar', scalar: 'bool' },
      lop: '&&',
      a: { op: 'compare', type: { kind: 'scalar', scalar: 'bool' }, cop: '<', a: x, b: w },
      b: { op: 'compare', type: { kind: 'scalar', scalar: 'bool' }, cop: '<', a: y, b: h },
    };
    return [
      { s: 'let', name: at, expr: this.lowerExpr(coords) },
      { s: 'let', name: v, expr: this.lowerExpr(value) },
      {
        s: 'if',
        arms: [
          {
            cond: inside,
            body: Array.from({ length: t.channels }, (_, k) =>
              this.storeValue(t.root, add(word, lit(k)), scalar, comp(val, k)),
            ).flat(),
          },
        ],
      },
    ];
  }

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
      const root = this.shadowed.has(e.name) ? undefined : this.roots.get(e.name);
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
    if (e.op === 'call' && e.declRef === undefined) {
      const t = this.textureOf(e.args[0]);
      if (t !== undefined && e.fn === 'textureDimensions') {
        const { w, h } = this.dims(t.name);
        return { op: 'construct', type: e.type, args: [w, h] };
      }
      if (t !== undefined && e.fn === 'textureLoad') return this.textureLoad(t, e.args[1]!, e.type);
    }
    if (e.op === 'call' && e.declRef === undefined && e.fn === 'arrayLength') {
      const a = e.args[0]!;
      const r = a.op === 'varref' || a.op === 'param' ? a.name : undefined;
      if (r !== undefined && !this.shadowed.has(r) && this.roots.has(r)) {
        lengths?.add(r);
        return { op: 'varref', type: u32T, name: `_phx_len_${r}` };
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
    const name = `_phx_w${this.temps++}`;
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
        const name = `_phx_io${this.temps++}`;
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
      case 'call': {
        const x = s.expr;
        const t =
          x.op === 'call' && x.fn === 'textureStore' ? this.textureOf(x.args[0]) : undefined;
        if (t !== undefined && x.op === 'call') {
          if (!writes) throw new MemoryWordsError('a function other than the entry writes memory');
          return this.textureStore(t, x.args[1]!, x.args[2]!);
        }
        return [{ ...s, expr: E(s.expr) }];
      }
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
    const own = new Set(f.params.map((p) => p.name));
    collectLocals(f.body, own);
    this.shadowed = own;
    try {
      return { ...f, body: this.lowerStmts(f.body, writes, lengths) };
    } finally {
      this.shadowed = new Set();
    }
  }
}

/** The module-scope names the expressions of `funcs`, and of `more`, refer to (`varref`): a name
 *  a function declares itself, a parameter or a local, hides the binding of that name there. */
export function referenced(funcs: readonly FuncDecl[], more: readonly unknown[] = []): Set<string> {
  const names = new Set<string>();
  const visit = (x: unknown, own: ReadonlySet<string>): void => {
    if (x === null || typeof x !== 'object') return;
    if (Array.isArray(x)) return x.forEach((y) => visit(y, own));
    const o = x as { op?: unknown; name?: unknown };
    if (o.op === 'varref' && typeof o.name === 'string' && !own.has(o.name)) names.add(o.name);
    for (const v of Object.values(o)) visit(v, own);
  };
  for (const f of funcs) {
    const own = new Set(f.params.map((p) => p.name));
    collectLocals(f.body, own);
    visit(f.body, own);
  }
  visit(more, new Set());
  return names;
}
