// Scalar replacement inside a synthesized, effect-free helper. Small fixed arrays
// and plain structs become field snapshots; full-value uses reconstruct a value.
import type { Expr, FuncDecl, ModuleDecl, ShaderType, Stmt } from '../ir/index.js';
import { eachExpr, eachStmtExpr, mapChildren, mapStmtExpr } from '../ir/visit.js';
import { bodyHasEffectfulCall, fnWrites } from './effects.js';
import { bodyHasRaw, collectLocals } from './opt/expr-utils.js';
import { seedSuffix, tryUnroll } from './opt/unroll.js';
import { rewriteBlocks } from './specialize-calls.js';

type Piece = { name: string; type: ShaderType; field: string | number };

export function scalarizeLocals(
  f: FuncDecl,
  m: ModuleDecl,
  fresh: (label: string) => string,
): FuncDecl {
  if (bodyHasRaw(f.body) || bodyHasEffectfulCall(f.body, fnWrites(m))) return f;
  const parts = new Map<string, { type: ShaderType; pieces: Piece[]; mutable: boolean }>();
  const collect = (s: Stmt): void => {
    if (s.s === 'var' || s.s === 'let') {
      const t = s.s === 'var' ? s.type : s.expr.type;
      const fields =
        t.kind === 'struct' ? m.structs.find((x) => x.name === t.name)?.fields : undefined;
      const types =
        fields?.map((p) => ({ field: p.name, type: p.type })) ??
        (t.kind === 'array' &&
        t.sizeOverride === undefined &&
        typeof t.size === 'number' &&
        t.size > 0 &&
        t.size <= 16
          ? Array.from({ length: t.size }, (_, i) => ({ field: i, type: t.elem }))
          : []);
      if (
        types.length > 0 &&
        types.length <= 16 &&
        types.every((p) => ['scalar', 'vec', 'f64', 'vec64'].includes(p.type.kind))
      )
        parts.set(s.name, {
          type: t,
          pieces: types.map((p) => ({ ...p, name: fresh('part') })),
          mutable: s.s === 'var',
        });
    }
    eachStmtExpr(s, () => {}, collect);
  };
  for (const s of f.body) collect(s);
  // A for header cannot expand one aggregate assignment/declaration into a
  // sequence. Leave aggregates referenced there intact; body stores are handled below.
  const headers = (s: Stmt): void => {
    if (s.s === 'for') {
      if (s.init.s === 'let' || s.init.s === 'var') parts.delete(s.init.name);
      for (const h of [s.init, s.update])
        eachStmtExpr(h, (e) =>
          eachExpr(e, (x) => {
            if (x.op === 'varref') parts.delete(x.name);
          }),
        );
    }
    eachStmtExpr(s, () => {}, headers);
  };
  for (const s of f.body) headers(s);
  if (!parts.size) return f;
  const taken = new Set(f.params.map((p) => p.name));
  collectLocals(f.body, taken);
  for (const x of [
    ...m.funcs,
    ...m.bindings,
    ...m.consts,
    ...(m.vars ?? []),
    ...(m.externs ?? []),
    ...(m.overrides ?? []),
  ])
    taken.add(x.name);
  const counter = { n: seedSuffix(f.body) };
  // Expand only a bounded loop writing one of these local arrays. This exposes
  // the producer's constant elements without unrolling unrelated numeric loops.
  const unrolled = rewriteBlocks(f.body, (s) => {
    if (s.s !== 'for') return [s];
    let writesArray = false;
    const scan = (b: Stmt): void => {
      if (
        (b.s === 'assign' || b.s === 'assignOp') &&
        b.target.op === 'index' &&
        b.target.base.op === 'varref' &&
        parts.get(b.target.base.name)?.type.kind === 'array'
      )
        writesArray = true;
      eachStmtExpr(b, () => {}, scan);
    };
    for (const b of s.body) scan(b);
    if (!writesArray) return [s];
    const expanded = tryUnroll(s, counter, 256, 16);
    if (!expanded) return [s];
    const locals = new Set<string>();
    collectLocals(expanded, locals);
    if ([...locals].some((n) => taken.has(n))) return [s];
    for (const n of locals) taken.add(n);
    return expanded;
  });
  // A dynamic index needs the original array. Never replace it with a guessed
  // component or with a select tree that changes bounds behaviour.
  for (const s of unrolled)
    eachStmtExpr(s, (e) =>
      eachExpr(e, (x) => {
        if (x.op === 'index' && x.base.op === 'varref' && parts.has(x.base.name)) {
          const p = parts.get(x.base.name)!;
          const index = x.idx.op === 'lit' ? x.idx.value : undefined;
          if (
            x.idx.op !== 'lit' ||
            typeof x.idx.value !== 'number' ||
            !p.pieces.some((v) => v.field === index)
          )
            parts.delete(x.base.name);
        }
      }),
    );
  const ref = (p: Piece): Expr => ({ op: 'varref', type: p.type, name: p.name });
  const rw = (e: Expr): Expr => {
    if ((e.op === 'member' || e.op === 'index') && e.base.op === 'varref') {
      const key = e.op === 'member' ? e.field : e.idx.op === 'lit' ? e.idx.value : undefined;
      const p = parts.get(e.base.name)?.pieces.find((p) => p.field === key);
      if (p) return ref(p);
    }
    if (e.op === 'varref' && parts.has(e.name)) {
      const p = parts.get(e.name)!;
      return { op: 'construct', type: p.type, args: p.pieces.map(ref) };
    }
    return mapChildren(e, rw);
  };
  const values = (e: Expr, p: { type: ShaderType; pieces: Piece[] }, prefix: Stmt[]): Expr[] => {
    const x = rw(e);
    if (x.op === 'construct' && x.args.length === p.pieces.length) return [...x.args];
    const name = fresh('whole');
    prefix.push({ s: 'let', name, expr: x });
    const base: Expr = { op: 'varref', name, type: p.type };
    return p.pieces.map((v): Expr =>
      typeof v.field === 'string'
        ? { op: 'member', type: v.type, base, field: v.field }
        : {
            op: 'index',
            type: v.type,
            base,
            idx: { op: 'lit', type: { kind: 'scalar', scalar: 'u32' }, value: v.field },
          },
    );
  };
  const body = rewriteBlocks(unrolled, (s) => {
    if ((s.s === 'let' || s.s === 'var') && parts.has(s.name)) {
      const p = parts.get(s.name)!,
        init = s.s === 'let' ? s.expr : s.init;
      const prefix: Stmt[] = [];
      const vs = init ? values(init, p, prefix) : [];
      return [
        ...prefix,
        ...p.pieces.map((v, i): Stmt =>
          p.mutable
            ? { s: 'var', name: v.name, type: v.type, init: vs[i] }
            : { s: 'let', name: v.name, expr: vs[i]! },
        ),
      ];
    }
    if (s.s === 'assign' && s.target.op === 'varref' && parts.has(s.target.name)) {
      const p = parts.get(s.target.name)!,
        prefix: Stmt[] = [];
      const vs = values(s.expr, p, prefix);
      // Snapshot EVERY RHS component before the first destination write, so
      // `pair = Pair(pair.y, pair.x)` remains a simultaneous value assignment.
      const snapshots = vs.map((expr) => {
        const name = fresh('copy');
        prefix.push({ s: 'let', name, expr });
        return { op: 'varref', type: expr.type, name } as Expr;
      });
      return [
        ...prefix,
        ...p.pieces.map((v, i): Stmt => ({ s: 'assign', target: ref(v), expr: snapshots[i]! })),
      ];
    }
    // Nested bodies have already been rebuilt by rewriteBlocks.
    return [mapStmtExpr(s, rw, (nested) => nested)];
  });
  return { ...f, body };
}
