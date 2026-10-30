// Cache a small read-only storage slice reused by an outer fixed-count loop.
// Unroll only the inner loop that exposes the reuse, keeping arithmetic order.
// No storage access declaration changes: even different bindings may alias, so
// any write to a non-local root, barrier or effectful call rejects the loop.
import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../../ir/index.js';
import { eachExpr, eachStmtExpr, mapChildren } from '../../ir/visit.js';
import {
  bodyHasEffectfulCall,
  fnReads,
  fnWrites,
  type FnReads,
  type FnWrites,
} from '../effects.js';
import {
  bodyHasRaw,
  collectLocals,
  collectMutatedRoots,
  keyOf,
  mapStmtValue,
  refsLocal,
  rootName,
} from './expr-utils.js';
import { mapExpr } from './ir-transform.js';
import { analyzeLoop, seedSuffix, tryUnroll } from './unroll.js';

type Loop = Extract<Stmt, { s: 'for' }>;

function reuseInFunction(
  f: FuncDecl,
  storage: ReadonlySet<string>,
  writes: FnWrites,
  reads: FnReads,
): FuncDecl {
  if (bodyHasRaw(f.body)) return f;
  const locals = new Set<string>();
  collectLocals(f.body, locals);
  const counter = { n: seedSuffix(f.body) };
  let next = 0;
  const taken = new Set([...locals, ...f.params.map((p) => p.name)]);
  for (const s of f.body)
    eachStmtExpr(s, (e) =>
      eachExpr(e, (x) => {
        const name = rootName(x);
        if (name !== undefined) taken.add(name);
      }),
    );
  for (const name of taken) {
    const match = /^_load(\d+)$/.exec(name);
    if (match) next = Math.max(next, Number(match[1]) + 1);
  }
  const tryReuse = (outer: Loop): Stmt[] | undefined => {
    if (outer.body.length !== 1 || outer.body[0]!.s !== 'for') return undefined;
    const inner = outer.body[0];
    const a = analyzeLoop(outer),
      b = analyzeLoop(inner);
    if (!a || !b || a.seq.length < 2 || b.seq.length < 2 || b.seq.length > 4 || a.name === b.name)
      return undefined;
    if (
      !inner.body.every(
        (s) => s.s === 'assign' || s.s === 'assignOp' || s.s === 'let' || s.s === 'var',
      )
    )
      return undefined;
    if (bodyHasEffectfulCall([outer], writes)) return undefined;
    const mutated = new Set<string>(),
      declared = new Set<string>();
    collectMutatedRoots(outer.body, mutated, writes);
    collectLocals(outer.body, declared);
    if (
      mutated.has(a.name) ||
      declared.has(a.name) ||
      [...mutated].some((name) => !locals.has(name))
    )
      return undefined;
    // Reject even a differently named storage write; no no-alias assumption.
    if ([...mutated].some((name) => storage.has(name))) return undefined;
    collectLocals(inner.body, declared);
    mutated.delete(b.name);
    declared.delete(b.name);
    const excluded = new Set([...mutated, ...declared, a.name]);
    const innerCounter = new Set([b.name]);
    const candidates = new Map<string, Expr>();
    const gather = (e: Expr): Expr => {
      if (
        e.op === 'index' &&
        storage.has(rootName(e.base) ?? '') &&
        (e.type.kind === 'scalar' || e.type.kind === 'vec') &&
        refsLocal(e, innerCounter, reads) &&
        !refsLocal(e, excluded, reads)
      ) {
        let calls = false;
        eachExpr(e, (x) => {
          if (x.op === 'call') calls = true;
        });
        if (!calls) {
          candidates.set(keyOf(e), e);
          return e;
        }
      }
      // Only unconditionally evaluated reads may be moved to the preheader.
      if (e.op === 'logical') {
        gather(e.a);
        return e;
      }
      if (e.op === 'select') {
        gather(e.cond);
        return e;
      }
      if (e.op === 'matchExpr') {
        gather(e.scrutinee);
        return e;
      }
      return mapChildren(e, gather);
    };
    for (const s of inner.body) mapStmtValue(s, gather);
    if (candidates.size === 0 || candidates.size * b.seq.length > 8) return undefined;
    const expanded = tryUnroll(inner, counter, 192);
    if (!expanded) return undefined;
    const cached = new Map<string, Expr>(),
      preheader: Stmt[] = [];
    for (const e of candidates.values())
      for (const value of b.seq) {
        const load = mapExpr(e, (x) =>
          x.op === 'varref' && x.name === b.name ? { op: 'lit', type: b.type, value } : x,
        );
        const name = `_load${next++}`;
        cached.set(keyOf(load), { op: 'varref', type: e.type, name });
        preheader.push({ s: 'let', name, expr: load });
      }
    const replace = (e: Expr): Expr => cached.get(keyOf(e)) ?? mapChildren(e, replace);
    return [...preheader, { ...outer, body: expanded.map((s) => mapStmtValue(s, replace)) }];
  };
  const block = (body: readonly Stmt[]): Stmt[] =>
    body.flatMap((s): Stmt[] => {
      if (s.s === 'for') {
        const reused = tryReuse(s);
        return reused ?? [{ ...s, body: block(s.body) }];
      }
      if (s.s === 'if')
        return [
          {
            ...s,
            arms: s.arms.map((a) => ({ ...a, body: block(a.body) })),
            elseBody: s.elseBody && block(s.elseBody),
          },
        ];
      if (s.s === 'switch')
        return [
          {
            ...s,
            cases: s.cases.map((c) => ({ ...c, body: block(c.body) })),
            defaultBody: s.defaultBody && block(s.defaultBody),
          },
        ];
      return [s];
    });
  return { ...f, body: block(f.body) };
}

export function loopLoadReuse(m: ModuleDecl): ModuleDecl {
  const storage = new Set(m.bindings.filter((b) => b.space === 'storage').map((b) => b.name));
  const writes = fnWrites(m),
    reads = fnReads(m);
  return { ...m, funcs: m.funcs.map((f) => reuseInFunction(f, storage, writes, reads)) };
}
