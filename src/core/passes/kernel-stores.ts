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
import { eachExpr, eachStmtExpr } from '../ir/visit.js';
import { eachOperand } from './access.js';
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

/** `st`, a store into an element of an array parameter of `arrays`, guarded by the array's
 *  length: `if (u32(k) < arrayLength(a)) { a[k] = e; }`, after a `let` that reads an index with
 *  an effect once. Undefined when `st` is no such store. `name` gives each fresh local. */
function guardOne(
  st: Stmt,
  params: readonly { readonly name: string; readonly type: ShaderType }[],
  arrays: ReadonlySet<string>,
  name: () => string,
): Stmt[] | undefined {
  if (st.s !== 'assign' && st.s !== 'assignOp') return undefined;
  const element = elementOf(st.target, arrays);
  if (element === undefined) return undefined;
  const span = st.span !== undefined ? { span: st.span } : {};
  let idx = element.idx;
  const lead: Stmt[] = [];
  if (hasEffect(idx)) {
    const n = name();
    lead.push({ s: 'let', name: n, expr: idx, ...span });
    idx = { op: 'varref', type: idx.type, name: n };
  }
  const array = params.find((p) => p.name === element.array)!;
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
}

/** `st`, a call statement that passes an element of an array parameter of `arrays` as an
 *  `@inout` or `@out` argument (Rule 8.25), guarded by each such array's length, so a callee that
 *  would write past the array's end does not run (change 0094, decision S3-5). Undefined for any
 *  other statement, and for an index whose reading has an effect, which runs as written. */
function guardCall(
  st: Stmt,
  params: readonly { readonly name: string; readonly type: ShaderType }[],
  arrays: ReadonlySet<string>,
): Stmt[] | undefined {
  if (st.s !== 'call' || st.expr.op !== 'call' || st.expr.declRef === undefined) return undefined;
  const call = st.expr;
  const conds: Expr[] = [];
  call.declRef!.params.forEach((p, i) => {
    const a = call.args[i];
    if ((p.mode !== 'inout' && p.mode !== 'out') || a === undefined) return;
    const element = elementOf(a, arrays);
    if (element === undefined || hasEffect(element.idx)) return;
    const array = params.find((x) => x.name === element.array)!;
    conds.push({
      op: 'compare',
      type: boolT,
      cop: '<',
      a: asU32(element.idx),
      b: {
        op: 'call',
        type: u32T,
        fn: 'arrayLength',
        args: [{ op: 'param', type: array.type, name: array.name }],
      },
    });
  });
  if (conds.length === 0) return undefined;
  const cond = conds.reduce((a, b) => ({ op: 'logical', type: boolT, lop: '&&', a, b }) as Expr);
  return [
    { s: 'if', arms: [{ cond, body: [st] }], ...(st.span !== undefined ? { span: st.span } : {}) },
  ];
}

/** The array parameters of `f`, by name: the runtime-sized ones a kernel function takes. */
function arrayParams(f: Pick<FuncDecl, 'params'>): Set<string> {
  return new Set(
    f.params.filter((p) => p.type.kind === 'array' && p.type.size === undefined).map((p) => p.name),
  );
}

/** A namer of fresh locals `_st0`, `_st1`, ..., avoiding every name `f` declares. */
function freshNames(f: Pick<FuncDecl, 'params' | 'body'>): () => string {
  const taken = namesOf(f.params, f.body);
  let fresh = 0;
  return () => {
    let n: string;
    do n = `_st${String(fresh++)}`;
    while (taken.has(n));
    taken.add(n);
    return n;
  };
}

/**
 * `f`'s body with each store after its last loop into an element of an array parameter guarded
 * by the array's length (change 0094). A function with no loop has all of its statements after
 * its last loop (decision D7). A store before the last loop is left as it is: the proof refuses
 * it (`TS8070`), and the function runs on the CPU tier as written.
 */
export function guardStoresAfterLoops(f: Pick<FuncDecl, 'params' | 'body'>): Stmt[] {
  const arrays = arrayParams(f);
  if (arrays.size === 0) return [...f.body];
  const last = lastLoopOf(f.body);
  const name = freshNames(f);
  return f.body.flatMap((st, i): Stmt[] =>
    i <= last ? [st] : (guardOne(st, f.params, arrays, name) ?? [st]),
  );
}

/** Whether `sts` read an element of an array of `arrays`, or the length of an array a loop
 *  pushes onto (`pushCount`): anything of an array but `arrayLength`, which measures it (#348). */
export function readsElements(sts: readonly Stmt[], arrays: ReadonlySet<string>): boolean {
  let found = false;
  const visit = (e: Expr): void => {
    if (found) return;
    if ((e.op === 'param' || e.op === 'varref') && arrays.has(e.name)) {
      found = true;
      return;
    }
    eachOperand(e, (c, access) => {
      if (access !== 'length') visit(c);
    });
  };
  const walk = (st: Stmt): void => eachStmtExpr(st, visit, walk);
  sts.forEach(walk);
  return found;
}

/** The loop's header as statements a walk reads: its start, its condition and its update. */
function headerOf(loop: Stmt & { s: 'for' }): Stmt[] {
  return [loop.init, { s: 'call', expr: loop.cond } as Stmt];
}

/**
 * The top-level loops of `f`, by index, whose range the device holds (change 0094, part 1): the
 * statements before the loop, its start or its bound read an element of an array parameter, or
 * the length of an array a loop pushes onto. The call cannot compute such a range before anything
 * runs: on WebGPU a range entry computes it, and on the CPU tier the function runs as written.
 */
export function deviceRangeLoops(f: Pick<FuncDecl, 'params' | 'body'>): Set<number> {
  const arrays = arrayParams(f);
  const out = new Set<number>();
  if (arrays.size === 0) return out;
  const before: Stmt[] = [];
  let j = 0;
  for (const st of f.body) {
    if (st.s !== 'for') {
      if (st.s !== 'return') before.push(st);
      continue;
    }
    if (readsElements([...before, ...headerOf(st)], arrays)) out.add(j);
    j++;
  }
  return out;
}

/**
 * `body` with each store into an element of an array parameter guarded by the array's length, at
 * any depth, in the form {@link guardStoresAfterLoops} writes (change 0094, decision D2): the
 * body of a loop whose range the device holds, whose writes past an array's end are dropped on
 * every tier, since the host cannot check them before the loop runs.
 */
function guardWritesIn(
  body: readonly Stmt[],
  f: Pick<FuncDecl, 'params'>,
  arrays: ReadonlySet<string>,
  name: () => string,
): Stmt[] {
  const visit = (st: Stmt): Stmt[] => {
    const own = guardOne(st, f.params, arrays, name) ?? guardCall(st, f.params, arrays);
    if (own !== undefined) return own;
    switch (st.s) {
      case 'if':
        return [
          {
            ...st,
            arms: st.arms.map((a) => ({ ...a, body: a.body.flatMap(visit) })),
            ...(st.elseBody !== undefined ? { elseBody: st.elseBody.flatMap(visit) } : {}),
          },
        ];
      case 'for':
        return [{ ...st, body: st.body.flatMap(visit) }];
      case 'switch':
        return [
          {
            ...st,
            cases: st.cases.map((c) => ({ ...c, body: c.body.flatMap(visit) })),
            ...(st.defaultBody !== undefined ? { defaultBody: st.defaultBody.flatMap(visit) } : {}),
          },
        ];
      default:
        return [st];
    }
  };
  return body.flatMap(visit);
}

/**
 * `f`'s body as a kernel function runs it on every tier (change 0094): each store after its last
 * loop guarded by its array's length ({@link guardStoresAfterLoops}), and each store of a loop
 * whose range the device holds ({@link deviceRangeLoops}) guarded the same way. A function with no
 * such loop and no such store keeps its body.
 */
export function guardKernelBody(f: Pick<FuncDecl, 'params' | 'body'>): Stmt[] {
  const body = guardStoresAfterLoops(f);
  const device = deviceRangeLoops(f);
  if (device.size === 0) return body;
  const arrays = arrayParams(f);
  const name = freshNames({ params: f.params, body });
  let j = 0;
  return body.map((st) => {
    if (st.s !== 'for') return st;
    return device.has(j++) ? { ...st, body: guardWritesIn(st.body, f, arrays, name) } : st;
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
