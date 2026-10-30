// Module-level call specialization, before fp64/ABI lowering. Generated helpers
// are shared by call-site requirements, not by the author's method boundaries.
// Keep this outside the per-function optimizer fixpoint: it needs the call graph.
import { stageOf } from '../ir/index.js';
import type { Expr, FuncDecl, ModuleDecl, ShaderType, Stmt } from '../ir/index.js';
import { eachExpr, eachStmtExpr, mapChildren, mapStmtExpr } from '../ir/visit.js';
import { collectFnRefs } from '../ir/collect-refs.js';
import { bodyHasEffectfulCall, fnWrites, inheritEffects } from './effects.js';
import { bodyHasRaw, collectLocals, collectMutatedRoots } from './opt/expr-utils.js';
import { mapStmt } from './opt/ir-transform.js';
import { constProp } from './opt/const-prop.js';
import { deadBranch } from './opt/dead-branch.js';
import { dce } from './opt/dce.js';
import { memberFold } from './opt/member-fold.js';
import { fixpoint } from './opt/optimize.js';

type Call = Extract<Expr, { op: 'call' }>;
const CLEANUP = [constProp, deadBranch, trimUnreachable, memberFold, dce];
const MAX_VARIANTS = 16;
const MAX_NODES = 4096;

export function rewriteBlocks(body: readonly Stmt[], rewrite: (s: Stmt) => Stmt[]): Stmt[] {
  const out: Stmt[] = [];
  for (let s of body) {
    if (s.s === 'if')
      s = {
        ...s,
        arms: s.arms.map((a) => ({ ...a, body: rewriteBlocks(a.body, rewrite) })),
        elseBody: s.elseBody && rewriteBlocks(s.elseBody, rewrite),
      };
    else if (s.s === 'for') s = { ...s, body: rewriteBlocks(s.body, rewrite) };
    else if (s.s === 'switch')
      s = {
        ...s,
        cases: s.cases.map((c) => ({ ...c, body: rewriteBlocks(c.body, rewrite) })),
        defaultBody: s.defaultBody && rewriteBlocks(s.defaultBody, rewrite),
      };
    const replaced = rewrite(s);
    out.push(...replaced);
    const last = replaced.at(-1);
    if (
      last &&
      (last.s === 'return' || last.s === 'break' || last.s === 'continue' || last.s === 'discard')
    )
      break;
  }
  return out;
}

function trimUnreachable(m: ModuleDecl): ModuleDecl {
  return { ...m, funcs: m.funcs.map((f) => ({ ...f, body: rewriteBlocks(f.body, (s) => [s]) })) };
}

// Decompose immutable local struct constructors into snapshots of their fields.
// Each initializer is evaluated once, at its original position and in order.
// Whole-value uses reconstruct the object; field uses fold to the snapshots.
function splitStructLocals(f: FuncDecl, m: ModuleDecl, fresh: (label: string) => string): FuncDecl {
  const mutated = new Set<string>();
  collectMutatedRoots(f.body, mutated, fnWrites(m));
  const replacements = new Map<string, Expr>();
  const rewrite = (e: Expr): Expr =>
    e.op === 'varref' && replacements.has(e.name)
      ? replacements.get(e.name)!
      : mapChildren(e, rewrite);
  const body = rewriteBlocks(f.body, (s) => {
    if (s.s !== 'let' && s.s !== 'var') return [s];
    const init = s.s === 'let' ? s.expr : s.init;
    if (mutated.has(s.name) || init?.op !== 'construct' || init.type.kind !== 'struct') return [s];
    const type = init.type;
    const struct = m.structs.find((t) => t.name === type.name);
    if (!struct || struct.fields.length !== init.args.length) return [s];
    const args: Expr[] = [];
    const values = init.args.map((expr): Stmt => {
      const name = fresh('field');
      args.push({ op: 'varref', name, type: expr.type });
      return { s: 'let', name, expr };
    });
    replacements.set(s.name, { ...init, args });
    return values;
  });
  const stmt = (s: Stmt): Stmt => mapStmtExpr(s, rewrite, stmt);
  return { ...f, body: body.map(stmt) };
}

function cost(f: FuncDecl): number {
  let n = 0;
  for (const s of f.body) eachStmtExpr(s, (e) => eachExpr(e, () => n++));
  return n;
}

/** Internal O2 emit stage. No entry signature or externally bound layout changes. */
export function specializeCalls(input: ModuleDecl): ModuleDecl {
  // Helpers alone may be externally called by name. Raw code hides call edges.
  if (
    !input.funcs.some((f) => stageOf(f) !== undefined) ||
    input.funcs.some((f) => bodyHasRaw(f.body))
  )
    return input;
  let m = input;
  const names = new Set([
    ...m.funcs.map((f) => f.name),
    ...m.structs.map((s) => s.name),
    ...m.bindings.map((b) => b.name),
    ...m.consts.map((c) => c.name),
    ...(m.vars ?? []).map((v) => v.name),
    ...(m.externs ?? []).map((v) => v.name),
    ...(m.overrides ?? []).map((v) => v.name),
  ]);
  for (const f of m.funcs) {
    collectLocals(f.body, names);
    for (const p of f.params) names.add(p.name);
    for (const s of f.body)
      eachStmtExpr(s, (e) =>
        eachExpr(e, (x) => {
          if ('name' in x) names.add(x.name);
        }),
      );
  }
  let serial = 0,
    variants = 0,
    nodes = 0;
  const fresh = (label: string): string => {
    let name: string;
    do {
      name = `_spec${serial++}_${label}`;
    } while (names.has(name));
    names.add(name);
    return name;
  };
  const replaced = new Set<string>();
  const generated = new Set<string>();
  const cache = new Map<string, FuncDecl>();
  const eligible = (f: FuncDecl): boolean =>
    stageOf(f) === undefined &&
    !f.kernel &&
    !f.opaque &&
    !generated.has(f.name) &&
    !f.params.some((p) => p.mode === 'inout') &&
    cost(f) <= 768;
  const make = (
    key: string,
    source: FuncDecl,
    build: (name: string) => FuncDecl,
  ): FuncDecl | undefined => {
    const hit = cache.get(key);
    if (hit) return hit;
    if (variants >= MAX_VARIANTS || nodes + cost(source) > MAX_NODES) return undefined;
    const built = build(fresh(source.name));
    const draft = splitStructLocals(built, { ...m, funcs: [...m.funcs, built] }, fresh);
    // Shared analyses see the whole module, including this new declaration.
    const whole = { ...m, funcs: [...m.funcs, draft] };
    const view = { ...whole, funcs: [draft] };
    inheritEffects(whole, view);
    const fn = fixpoint(view, CLEANUP).funcs[0]!;
    cache.set(key, fn);
    generated.add(fn.name);
    replaced.add(source.name);
    variants++;
    nodes += cost(source);
    m = { ...m, funcs: [...m.funcs, fn] };
    return fn;
  };

  // A literal boolean argument has no evaluation effect. Substitute it only if
  // the parameter is immutable. Other arguments retain their order and count.
  // Multiple rounds expose constants forwarded through another helper.
  for (let round = 0; round < 3; round++) {
    const before = m;
    const byName = new Map(m.funcs.map((f) => [f.name, f]));
    const writes = fnWrites(m);
    const rewritten = before.funcs.map((f): FuncDecl => ({
      ...f,
      body: f.body.map((s) =>
        mapStmt(s, (e) => {
          if (e.op !== 'call') return e;
          const callee = byName.get(e.fn);
          if (
            !callee ||
            !eligible(callee) ||
            e.args.length !== callee.params.length ||
            bodyHasEffectfulCall(callee.body, writes) ||
            (writes.get(callee.name)?.size ?? 0) > 0
          )
            return e;
          // Recursive call graphs are not candidates for specialization growth.
          const seen = new Set<string>();
          const recursive = (name: string): boolean => {
            if (seen.has(name)) return false;
            seen.add(name);
            const target = byName.get(name);
            if (!target) return false;
            return [...collectFnRefs(target).calls].some((n) => n === callee.name || recursive(n));
          };
          if (recursive(callee.name)) return e;
          const mutated = new Set<string>();
          collectMutatedRoots(callee.body, mutated, writes);
          const fixed = new Map<number, Extract<Expr, { op: 'lit' }>>();
          callee.params.forEach((p, i) => {
            const a = e.args[i]!;
            if (
              p.type.kind === 'scalar' &&
              p.type.scalar === 'bool' &&
              a.op === 'lit' &&
              typeof a.value === 'boolean' &&
              !mutated.has(p.name)
            )
              fixed.set(i, a);
          });
          if (fixed.size === 0) return e;
          const key = `${callee.name}:bool:${[...fixed].map(([i, a]) => `${i}=${a.value}`).join(',')}`;
          const fn = make(key, callee, (name) => {
            const subst = new Map([...fixed].map(([i, a]) => [callee.params[i]!.name, a]));
            return {
              ...callee,
              name,
              params: callee.params.filter((_, i) => !fixed.has(i)),
              body: callee.body.map((b) =>
                mapStmt(b, (x) =>
                  (x.op === 'param' || x.op === 'varref') && subst.has(x.name)
                    ? subst.get(x.name)!
                    : x,
                ),
              ),
            };
          });
          return fn
            ? { ...e, fn: fn.name, declRef: fn, args: e.args.filter((_, i) => !fixed.has(i)) }
            : e;
        }),
      ),
    }));
    m = { ...m, funcs: [...rewritten, ...m.funcs.slice(before.funcs.length)] };
    if (m.funcs.length === before.funcs.length) break;
  }

  // A call result that never escapes and is used only via selected struct fields
  // can have a smaller return type. Clone its complete control flow: validity
  // predicates and early returns survive even when their intermediates aren't returned.
  const before = m;
  const byName = new Map(m.funcs.map((f) => [f.name, f]));
  const writes = fnWrites(m);
  const rewritten = before.funcs.map((caller): FuncDecl => {
    const bindings = new Map<string, Call>();
    const collect = (s: Stmt): void => {
      if (s.s === 'let' && s.expr.op === 'call' && s.expr.type.kind === 'struct')
        bindings.set(s.name, s.expr);
      eachStmtExpr(s, () => {}, collect);
    };
    for (const s of caller.body) collect(s);
    const changes = new Map<string, { fn: FuncDecl; type: ShaderType }>();
    const mutated = new Set<string>();
    collectMutatedRoots(caller.body, mutated, writes);
    for (const [local, call] of bindings) {
      const callee = byName.get(call.fn);
      if (
        !callee ||
        !eligible(callee) ||
        mutated.has(local) ||
        bodyHasEffectfulCall(callee.body, writes) ||
        (writes.get(callee.name)?.size ?? 0) > 0
      )
        continue;
      if (callee.ret.kind !== 'struct') continue;
      const retName = callee.ret.name;
      const struct = m.structs.find((s) => s.name === retName);
      if (!struct || struct.fields.some((f) => f.attr || f.builtin || f.location !== undefined))
        continue;
      let escapes = false;
      const used = new Set<string>();
      const inspect = (e: Expr): Expr => {
        if (e.op === 'member' && e.base.op === 'varref' && e.base.name === local) {
          used.add(e.field);
          return e;
        }
        if (e.op === 'varref' && e.name === local) escapes = true;
        return mapChildren(e, inspect);
      };
      for (const s of caller.body) eachStmtExpr(s, inspect);
      const fields = struct.fields.filter((f) => used.has(f.name));
      if (escapes || fields.length === 0 || fields.length >= struct.fields.length) continue;
      const key = `${callee.name}:fields:${fields.map((f) => f.name).join(',')}`;
      const fn = make(key, callee, (name) => {
        const ret: ShaderType = { kind: 'struct', name: fresh('result') };
        m = { ...m, structs: [...m.structs, { name: ret.name, fields }] };
        const body = rewriteBlocks(callee.body, (s): Stmt[] => {
          if (s.s === 'return' && s.expr) {
            const temp = fresh('returned');
            const base: Expr = { op: 'varref', name: temp, type: callee.ret };
            return [
              { s: 'let', name: temp, expr: s.expr },
              {
                ...s,
                expr: {
                  op: 'construct',
                  type: ret,
                  args: fields.map((f): Expr => ({
                    op: 'member',
                    type: f.type,
                    base,
                    field: f.name,
                  })),
                },
              },
            ];
          }
          return [s];
        });
        return { ...callee, name, ret, body };
      });
      if (fn) changes.set(local, { fn, type: fn.ret });
    }
    if (changes.size === 0) return caller;
    const walk = (x: Expr): Expr =>
      x.op === 'varref' && changes.has(x.name)
        ? { ...x, type: changes.get(x.name)!.type }
        : mapChildren(x, walk);
    const rewrite = (s: Stmt): Stmt => {
      if (s.s === 'let' && changes.has(s.name)) {
        const c = changes.get(s.name)!;
        return {
          ...s,
          expr: {
            ...bindings.get(s.name)!,
            args: bindings.get(s.name)!.args.map(walk),
            fn: c.fn.name,
            declRef: c.fn,
            type: c.type,
          },
        };
      }
      return mapStmtExpr(s, walk, rewrite);
    };
    return { ...caller, body: caller.body.map(rewrite) };
  });
  m = { ...m, funcs: [...rewritten, ...m.funcs.slice(before.funcs.length)] };
  if (variants === 0) return input;
  // Only prune declarations involved in this transform; unrelated shared preludes
  // stay intact. Reachability includes all entry points, not just the first one.
  const all = new Map(m.funcs.map((f) => [f.name, f]));
  const reached = new Set<string>();
  const visit = (name: string): void => {
    if (reached.has(name)) return;
    reached.add(name);
    const f = all.get(name);
    if (f) for (const n of collectFnRefs(f).calls) visit(n);
  };
  for (const f of m.funcs) if (stageOf(f) !== undefined) visit(f.name);
  // Retained prelude helpers may still call a replaced function.
  for (const f of m.funcs) if (!replaced.has(f.name) && !generated.has(f.name)) visit(f.name);
  return { ...m, funcs: m.funcs.filter((f) => reached.has(f.name)) };
}
