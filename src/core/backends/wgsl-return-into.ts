// === WGSL: a struct a call returns into a local is written there (Rule 8.28, change 0104) ===
//
// `best = probe(p, k)` builds a `Hit` in `probe` and copies it into `best`. When `best` is a
// local `var` (or a field or an element of one), the call can write its result there itself:
// `probe_into(&best, p, k)`, a copy of `probe` that takes the destination as a pointer and whose
// every `return e;` is `*_dst = e; return;`. `var h: Hit = probe(p, k);` is `var h: Hit;`
// followed by the same call.
//
// The call keeps its copy when an argument reads the destination's root, since the callee
// would then read through one name what it writes through another. The destination's root is a
// local, which no callee can name, so nothing else can reach it during the call.
//
// WGSL only (Decision D1 of change 0103's sibling 0104): GLSL ES 3.00's `out` parameter is a
// copy back at return, so it would remove nothing there. Run in `postLower`, after the
// optimizer and before `pointerSpaces`, which spells the new parameter as a pointer.

import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/nodes.js';
import { stageOf } from '../ir/nodes.js';
import { eachExpr, eachStmtExpr, mapChildren, mapStmtExpr } from '../ir/visit.js';
import { voidT } from '../ir/types.js';
import { bodyHasRaw } from '../passes/opt/dce.js';

/** The root name of a place, `best` for `best.n.x`, when the path is members and indices. */
function rootName(e: Expr): string | undefined {
  let at = e;
  for (;;) {
    if (at.op === 'varref' || at.op === 'param') return at.name;
    if (at.op === 'member' || at.op === 'index') {
      at = at.base;
      continue;
    }
    return undefined;
  }
}

/** Whether `f` returns a struct or a fixed-size array that a caller may have written into a
 *  place: a function of the module, not an entry point, with no raw text. The fp64 lowering's
 *  `vec64` and `mat64` structs are a vector and a matrix in the source and are left out. */
const returnsAggregate = (f: FuncDecl): boolean =>
  stageOf(f) === undefined &&
  !bodyHasRaw(f.body) &&
  ((f.ret.kind === 'struct' &&
    !f.ret.name.startsWith('DF64Vec') &&
    !f.ret.name.startsWith('DF64Mat')) ||
    (f.ret.kind === 'array' && f.ret.size !== undefined));

/** The names a function declares with `var`, which WGSL can take the address of. */
function varsOf(f: FuncDecl): ReadonlySet<string> {
  const vars = new Set<string>();
  const lets = new Set<string>();
  const visit = (s: Stmt): void => {
    if (s.s === 'var') vars.add(s.name);
    if (s.s === 'let') lets.add(s.name);
    eachStmtExpr(s, () => {}, visit);
  };
  for (const s of f.body) visit(s);
  for (const n of lets) vars.delete(n);
  for (const p of f.params) vars.delete(p.name);
  return vars;
}

/** `s` with each block it holds rebuilt by `block`. */
function eachBlock(s: Stmt, block: (body: readonly Stmt[]) => Stmt[]): Stmt {
  switch (s.s) {
    case 'if':
      return {
        ...s,
        arms: s.arms.map((a) => ({ ...a, body: block(a.body) })),
        elseBody: s.elseBody ? block(s.elseBody) : undefined,
      };
    case 'for':
      return { ...s, body: block(s.body) };
    case 'switch':
      return {
        ...s,
        cases: s.cases.map((c) => ({ ...c, body: block(c.body) })),
        defaultBody: s.defaultBody ? block(s.defaultBody) : undefined,
      };
    default:
      return s;
  }
}

/** `body` with each `return e;` turned into `*dst = e; return;`. */
function returnsInto(body: readonly Stmt[], dst: Expr): Stmt[] {
  const out: Stmt[] = [];
  for (const s of body) {
    if (s.s === 'return' && s.expr !== undefined) {
      out.push({ s: 'assign', target: dst, expr: s.expr }, { s: 'return' });
      continue;
    }
    out.push(eachBlock(s, (b) => returnsInto(b, dst)));
  }
  return out;
}

/** Every `return e` value of `body`, nested blocks included. */
function returnValues(body: readonly Stmt[]): Expr[] {
  const out: Expr[] = [];
  const visit = (s: Stmt): void => {
    if (s.s === 'return' && s.expr !== undefined) out.push(s.expr);
    eachStmtExpr(s, () => {}, visit);
  };
  for (const s of body) visit(s);
  return out;
}

/** Whether `e` reads a place: a name, or a field or an element of one. */
const isPlace = (e: Expr): boolean => rootName(e) !== undefined;

/** `e` with every read of the name `name` replaced by `to`. */
function renameIn(e: Expr, name: string, to: Expr): Expr {
  if ((e.op === 'varref' || e.op === 'param') && e.name === name) return to;
  return mapChildren(e, (c) => renameIn(c, name, to));
}

/** The local `var` every `return` of `f` returns, when there is one, declared once at the top of
 *  the body with an initializer: the callee can build its result in the destination itself. */
function returnedLocal(f: FuncDecl): string | undefined {
  const values = returnValues(f.body);
  if (values.length === 0) return undefined;
  const first = values[0]!;
  if (first.op !== 'varref') return undefined;
  if (!values.every((v) => v.op === 'varref' && v.name === first.name)) return undefined;
  const decls = f.body.filter((s) => s.s === 'var' && s.name === first.name);
  if (decls.length !== 1 || (decls[0] as { init?: Expr }).init === undefined) return undefined;
  let nested = 0;
  const visit = (s: Stmt): void => {
    if ((s.s === 'var' || s.s === 'let') && s.name === first.name) nested++;
    eachStmtExpr(s, () => {}, visit);
  };
  for (const s of f.body) visit(s);
  return nested === 1 ? first.name : undefined;
}

/** Whether writing `f`'s result through a pointer saves a copy: it builds the result in a local
 *  it returns (which becomes the destination), or it returns values that are no place (a
 *  constructor, an operation, a call), which it then writes straight there. Returning another
 *  place would only move the copy from the caller into the callee. */
const savesCopy = (f: FuncDecl): boolean =>
  returnedLocal(f) !== undefined || returnValues(f.body).every((v) => !isPlace(v));

/** `body` without a bare `return;` as its last statement, which a function returning nothing
 *  does not need. */
function dropTrailingReturn(body: Stmt[]): Stmt[] {
  const last = body[body.length - 1];
  return last !== undefined && last.s === 'return' && last.expr === undefined
    ? body.slice(0, -1)
    : body;
}

/** The body of `f` writing its result through `dst`. A local every `return` returns becomes
 *  the destination itself; otherwise each `return e;` stores `e` there. */
function intoBody(f: FuncDecl, dst: Expr): Stmt[] {
  const local = returnedLocal(f);
  if (local === undefined) return returnsInto(f.body, dst);
  const rename = (body: readonly Stmt[]): Stmt[] =>
    body.map((s) => {
      if (s.s === 'var' && s.name === local)
        return { s: 'assign', target: dst, expr: renameIn(s.init!, local, dst) } as Stmt;
      if (s.s === 'return' && s.expr !== undefined) return { s: 'return' } as Stmt;
      return eachBlock(
        mapStmtExpr(
          s,
          (e) => renameIn(e, local, dst),
          (inner) => inner,
        ),
        rename,
      );
    });
  return rename(f.body);
}

/** The functions of `funcs` that some call names. */
function calledIn(funcs: readonly FuncDecl[]): Set<string> {
  const out = new Set<string>();
  for (const f of funcs)
    for (const s of f.body)
      eachStmtExpr(s, (e) =>
        eachExpr(e, (x) => {
          if (x.op === 'call') out.add(x.fn);
        }),
      );
  return out;
}

/** Write each struct a call returns into a local `var` through a pointer. See the header. */
export function returnInto(m: ModuleDecl): ModuleDecl {
  const byName = new Map(m.funcs.map((f) => [f.name, f]));
  const taken = new Set(m.funcs.map((f) => f.name));
  const made = new Map<string, FuncDecl>();
  const into = (f: FuncDecl): FuncDecl => {
    const hit = made.get(f.name);
    if (hit !== undefined) return hit;
    let name = `${f.name}_into`;
    for (let n = 2; taken.has(name); n++) name = `${f.name}_into_${n}`;
    taken.add(name);
    let dstName = '_dst';
    const used = new Set(f.params.map((p) => p.name));
    for (let n = 2; used.has(dstName); n++) dstName = `_dst${n}`;
    const dst: Expr = { op: 'param', type: f.ret, name: dstName };
    const copy: FuncDecl = {
      ...f,
      name,
      ret: voidT,
      params: [{ name: dstName, type: f.ret, mode: 'inout' }, ...f.params],
      body: dropTrailingReturn(intoBody(f, dst)),
    };
    made.set(f.name, copy);
    return copy;
  };

  /** The call that writes `target`'s value, when it can write it through a pointer. */
  const rewrite = (target: Expr, value: Expr, vars: ReadonlySet<string>): Stmt | undefined => {
    if (value.op !== 'call') return undefined;
    const callee = byName.get(value.fn);
    if (callee === undefined || !returnsAggregate(callee) || !savesCopy(callee)) return undefined;
    const root = rootName(target);
    if (root === undefined || !vars.has(root)) return undefined;
    let reads = false;
    for (const a of value.args) {
      eachExpr(a, (x) => {
        if ((x.op === 'varref' || x.op === 'param') && x.name === root) reads = true;
      });
    }
    if (reads) return undefined;
    const copy = into(callee);
    return {
      s: 'call',
      expr: { ...value, fn: copy.name, declRef: copy, type: voidT, args: [target, ...value.args] },
    };
  };

  let changed = false;
  /** `f` with each call that returns into one of `dests` writing there. */
  const walk = (f: FuncDecl, dests: ReadonlySet<string>): FuncDecl => {
    if (bodyHasRaw(f.body)) return f;
    const block = (body: readonly Stmt[]): Stmt[] => {
      const out: Stmt[] = [];
      for (const s0 of body) {
        const s = eachBlock(s0, block);
        if (s.s === 'assign') {
          const call = rewrite(s.target, s.expr, dests);
          if (call !== undefined) {
            changed = true;
            out.push(call);
            continue;
          }
        }
        if (s.s === 'var' && s.init !== undefined) {
          const target: Expr = { op: 'varref', type: s.type, name: s.name };
          const call = rewrite(target, s.init, dests);
          if (call !== undefined) {
            changed = true;
            out.push({ s: 'var', name: s.name, type: s.type }, call);
            continue;
          }
        }
        out.push(s);
      }
      return out;
    };
    return { ...f, body: block(f.body) };
  };
  const funcs = m.funcs.map((f) => walk(f, varsOf(f)));
  // An `_into` copy writes through its `_dst`, which every call of it points at a local of its
  // caller, so a call inside it that returns into `*_dst` can write there too. A parameter an
  // author declared `@inout` may point at a module variable the callee reads by name, so it is
  // never a destination. Walked until no new copy appears.
  const walked = new Set<string>();
  for (;;) {
    const pending = [...made.values()].filter((c) => !walked.has(c.name));
    if (pending.length === 0) break;
    for (const c of pending) {
      walked.add(c.name);
      const dests = new Set([...varsOf(c), c.params[0]!.name]);
      const done = walk(c, dests);
      const origin = [...made.entries()].find(([, v]) => v === c)![0];
      made.set(origin, done);
      walked.add(done.name);
    }
  }
  if (!changed) return m;
  // Each `_into` copy goes right after the function it copies. A function that every call now
  // reaches through its copy is dropped: no call names it any more.
  const before = calledIn(m.funcs);
  const all: FuncDecl[] = [];
  for (const f of funcs) {
    all.push(f);
    const copy = made.get(f.name);
    if (copy !== undefined) all.push(copy);
  }
  const after = calledIn(all);
  const ordered = all.filter(
    (f) => !(made.has(f.name) && before.has(f.name) && !after.has(f.name)),
  );
  return { ...m, funcs: ordered };
}
