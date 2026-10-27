// Implements: Rule 8.22, a kernel function's stores after its loops (docs/language-design.md; traced in reqs/).
// ═══ A kernel function's stores after its loops (change 0094, part 3) ═══
//
// After its last loop a kernel function may store into an element of an array parameter:
// `sums[0] = s`, `count[0] = n`. A store past the end of the array is dropped on every tier
// (change 0094, decision D2 and its record). The drop is one guard in the IR, which every tier
// reads: the front end wraps each such store in
//
//     if (u32(k) < arrayLength(a)) { a[k] = e; }
//
// and the CPU tier, the oracle and the entry the lowering builds for the stores all run that
// statement. So a store past the end writes nothing anywhere, and `a.length` after it is the
// array's length on the CPU tier too, where an array is a JavaScript array that a store past its
// end would grow. The guard reads the index a second time, which changes nothing for an index with
// no effect. An index whose reading has an effect (a call that writes through an `@inout`
// argument, an atomic) is read once, into a `let` before the guard, so the guard and the store see
// one value, read before the stored value as ECMAScript reads `a[k] = e`.
//
// The proof (`parallel-loop.ts`) accepts the guarded form after the last loop and no other store
// outside a loop, and the lowering (`kernel-lower.ts`) finds the stores by the same form. The
// builder and the reader are in this file so that they agree.

import type { Expr, FuncDecl, Stmt } from '../ir/nodes.js';
import type { ShaderType } from '../ir/types.js';
import { u32T } from '../ir/types.js';
import { eachExpr } from '../ir/visit.js';
import { EFFECTFUL_INTRINSICS } from './effects.js';

const boolT: ShaderType = { kind: 'scalar', scalar: 'bool' };

/** A store after the loops, as the guard holds it: the array parameter, and the store. */
export interface StoreAfterLoops {
  readonly array: string;
  readonly store: Stmt & { s: 'assign' | 'assignOp' };
}

/** The index of the last top-level loop of `body`, or -1 when it has none. */
export function lastLoopOf(body: readonly Stmt[]): number {
  let at = -1;
  body.forEach((st, i) => {
    if (st.s === 'for') at = i;
  });
  return at;
}

/** The element access a written place starts at, `a[k]` in `a[k].f`, when its root is an array
 *  parameter in `arrays`: the parameter, the index, and the place with the index replaced. */
function elementOf(
  place: Expr,
  arrays: ReadonlySet<string>,
): { readonly array: string; readonly idx: Expr; readonly at: (idx: Expr) => Expr } | undefined {
  if (place.op === 'index' && place.base.op === 'param' && arrays.has(place.base.name))
    return { array: place.base.name, idx: place.idx, at: (idx) => ({ ...place, idx }) };
  if (place.op === 'index' || place.op === 'member') {
    const inner = elementOf(place.base, arrays);
    if (inner === undefined) return undefined;
    return { ...inner, at: (idx) => ({ ...place, base: inner.at(idx) }) };
  }
  return undefined;
}

/** `k` as the `u32` the guard compares: a literal as a `u32` literal, an `i32` through `u32()`,
 *  whose bits a negative index leaves past every array's length. */
function asU32(k: Expr): Expr {
  if (k.type.kind === 'scalar' && k.type.scalar === 'u32') return k;
  if (k.op === 'lit' && typeof k.value === 'number' && k.value >= 0)
    return { op: 'lit', type: u32T, value: k.value };
  return { op: 'call', type: u32T, fn: 'u32', args: [k] };
}

/** Whether reading `k` a second time could change what it reads or what anything else holds: a
 *  call that writes through an `@inout` argument (Rule 8.25), or a builtin with an effect. */
function hasEffect(k: Expr): boolean {
  let found = false;
  eachExpr(k, (x) => {
    if (x.op !== 'call') return;
    if (x.declRef?.params.some((p) => p.mode === 'inout') === true) found = true;
    else if (x.declRef === undefined && EFFECTFUL_INTRINSICS.has(x.fn) && x.fn !== 'pushCount')
      found = true;
  });
  return found;
}

/** Every name `body` declares, at any depth, and the names of `params`. */
function namesOf(params: readonly { readonly name: string }[], body: readonly Stmt[]): Set<string> {
  const out = new Set(params.map((p) => p.name));
  const walk = (sts: readonly Stmt[]): void => {
    for (const st of sts) {
      if (st.s === 'let' || st.s === 'var') out.add(st.name);
      if (st.s === 'for') {
        walk([st.init]);
        walk(st.body);
      } else if (st.s === 'if') {
        for (const a of st.arms) walk(a.body);
        if (st.elseBody !== undefined) walk(st.elseBody);
      } else if (st.s === 'switch') {
        for (const c of st.cases) walk(c.body);
        if (st.defaultBody !== undefined) walk(st.defaultBody);
      }
    }
  };
  walk(body);
  return out;
}

/**
 * `f`'s body with each store after its last loop into an element of an array parameter guarded
 * by the array's length (change 0094). A function with no loop has all of its statements after
 * its last loop (decision D7). A store before the last loop is left as it is: the proof refuses
 * it (`TS8070`), and the function runs on the CPU tier as written.
 */
export function guardStoresAfterLoops(f: Pick<FuncDecl, 'params' | 'body'>): Stmt[] {
  const arrays = new Set(
    f.params.filter((p) => p.type.kind === 'array' && p.type.size === undefined).map((p) => p.name),
  );
  if (arrays.size === 0) return [...f.body];
  const last = lastLoopOf(f.body);
  const taken = namesOf(f.params, f.body);
  let fresh = 0;
  const name = (): string => {
    let n: string;
    do n = `_st${String(fresh++)}`;
    while (taken.has(n));
    taken.add(n);
    return n;
  };
  return f.body.flatMap((st, i): Stmt[] => {
    if (i <= last || (st.s !== 'assign' && st.s !== 'assignOp')) return [st];
    const element = elementOf(st.target, arrays);
    if (element === undefined) return [st];
    const span = st.span !== undefined ? { span: st.span } : {};
    let idx = element.idx;
    const lead: Stmt[] = [];
    if (hasEffect(idx)) {
      const n = name();
      lead.push({ s: 'let', name: n, expr: idx, ...span });
      idx = { op: 'varref', type: idx.type, name: n };
    }
    const array = f.params.find((p) => p.name === element.array)!;
    const length: Expr = {
      op: 'call',
      type: u32T,
      fn: 'arrayLength',
      args: [{ op: 'param', type: array.type, name: array.name }],
    };
    const store = { ...st, target: element.at(idx) } as Stmt;
    return [
      ...lead,
      {
        s: 'if',
        arms: [
          {
            cond: { op: 'compare', type: boolT, cop: '<', a: asU32(idx), b: length },
            body: [store],
          },
        ],
        ...span,
      },
    ];
  });
}

/** Whether two expressions are the same expression, field by field, whatever the spans and the
 *  callee objects: the guard and its store read one index. */
function sameIndex(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = (o: object): string[] =>
    Object.keys(o).filter((k) => k !== 'span' && k !== 'declRef');
  const [ka, kb] = [keys(a), keys(b)];
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      kb.includes(k) &&
      sameIndex((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/** The index the guard compares, through the `u32()` or the literal `asU32` made of it. */
function guardedIndex(e: Expr): Expr {
  return e.op === 'call' && e.fn === 'u32' && e.args.length === 1 ? e.args[0]! : e;
}

/**
 * The store `st` guards, when `st` is the guarded form `guardStoresAfterLoops` writes: an `if`
 * with one arm and no `else`, whose condition is `k < arrayLength(a)` for an array parameter `a`
 * in `arrays` and whose body is one store into `a[k]`. Undefined for any other statement.
 */
export function storeAfterLoops(
  st: Stmt,
  arrays: ReadonlySet<string>,
): StoreAfterLoops | undefined {
  if (st.s !== 'if' || st.arms.length !== 1 || st.elseBody !== undefined) return undefined;
  const arm = st.arms[0]!;
  const c = arm.cond;
  if (c.op !== 'compare' || c.cop !== '<' || arm.body.length !== 1) return undefined;
  const len = c.b;
  if (len.op !== 'call' || len.fn !== 'arrayLength' || len.args.length !== 1) return undefined;
  const a = len.args[0]!;
  if (a.op !== 'param' || !arrays.has(a.name)) return undefined;
  const store = arm.body[0]!;
  if (store.s !== 'assign' && store.s !== 'assignOp') return undefined;
  const element = elementOf(store.target, new Set([a.name]));
  if (element === undefined || element.array !== a.name) return undefined;
  const k = guardedIndex(c.a);
  const sameLiteral =
    k.op === 'lit' && element.idx.op === 'lit' && Number(k.value) === Number(element.idx.value);
  if (!sameLiteral && !sameIndex(k, element.idx)) return undefined;
  return { array: a.name, store };
}
