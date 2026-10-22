// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
// Private input projection for change 0082. Authored modules and external layouts stay intact.
import type { Expr, FuncDecl, ModuleDecl, StructDecl } from '../ir/nodes.js';
import { eachExpr, eachStmtExpr, mapChildren, mapStmtExpr } from '../ir/visit.js';
import { bodyHasRaw, collectLocals } from './opt/expr-utils.js';
import type { KernelPlan } from './kernel-lower.js';

/** Project proved read-only scalar inputs in a private kernel module. Undefined keeps AoS. */
export function projectKernelInputs(plan: KernelPlan, kernel: FuncDecl): ModuleDecl | undefined {
  const m = plan.module;
  const names = new Set(
    kernel.params
      .filter((p) => p.type.kind === 'array')
      .map((p) => plan.bindingNames.get(p.name) ?? p.name),
  );
  // Written object arrays can alias the input's objects on the host. Keep the original plan.
  if (
    m.funcs.some((f) => bodyHasRaw(f.body)) ||
    m.bindings.some(
      (b) =>
        names.has(b.name) &&
        b.access === 'read_write' &&
        b.type.kind === 'array' &&
        b.type.elem.kind === 'struct',
    )
  )
    return undefined;
  const structs = new Map(m.structs.map((s) => [s.name, s]));
  const funcs = new Map(m.funcs.map((f) => [f.name, f]));
  const locals = new Map(
    m.funcs.map((f) => {
      const found = new Set<string>();
      collectLocals(f.body, found);
      return [f, found] as const;
    }),
  );
  const summaries = new Map<string, ReadonlySet<string> | null>();
  const summary = (f: FuncDecl | undefined, at: number): ReadonlySet<string> | null => {
    const p = f?.params[at];
    if (!f || !p || p.mode === 'inout' || locals.get(f)?.has(p.name)) return null;
    const key = `${f.name}:${at}`;
    if (summaries.has(key)) return summaries.get(key)!;
    summaries.set(key, null); // A recursive or unresolved helper observes the whole value.
    const target = (e: Expr): boolean => e.op === 'param' && e.name === p.name;
    const used = scan(f.body, target, target);
    summaries.set(key, used);
    return used;
  };
  function scan(
    body: FuncDecl['body'],
    target: (e: Expr) => boolean,
    bare: (e: Expr) => boolean,
  ): Set<string> | null {
    const used = new Set<string>();
    let opaque = false;
    const index = (e: Expr): void => {
      if (e.op !== 'index') return;
      // Rebuilding a by-value helper argument can read several fields at this index.
      // Do not duplicate a call, even if its current effect summary is empty.
      eachExpr(e.idx, (x) => {
        if (x.op === 'call') opaque = true;
      });
      visit(e.idx);
    };
    const visit = (e: Expr): void => {
      if (e.op === 'member' && target(e.base)) {
        used.add(e.field);
        index(e.base);
        return;
      }
      if (e.op === 'call') {
        if (e.fn === 'arrayLength' && !e.declRef && e.args.length === 1 && bare(e.args[0]!)) return;
        e.args.forEach((a, i) => {
          if (!target(a)) {
            visit(a);
            return;
          }
          const fields = summary(funcs.get(e.fn), i);
          if (fields === null) opaque = true;
          else for (const field of fields) used.add(field);
          index(a);
        });
        return;
      }
      if (target(e) || bare(e)) {
        opaque = true;
        return;
      }
      mapChildren(e, (child) => {
        visit(child);
        return child;
      });
    };
    for (const s of body) eachStmtExpr(s, visit);
    return opaque ? null : used;
  }
  const taken = new Set(
    [
      ...m.structs,
      ...m.funcs,
      ...m.bindings,
      ...m.consts,
      ...(m.vars ?? []),
      ...(m.overrides ?? []),
      ...(m.externs ?? []),
    ].map((d) => d.name),
  );
  const projected = new Map<string, { original: StructDecl; physical: StructDecl }>();
  for (const b of m.bindings) {
    if (
      !names.has(b.name) ||
      b.access !== 'read' ||
      b.type.kind !== 'array' ||
      b.type.elem.kind !== 'struct'
    )
      continue;
    const original = structs.get(b.type.elem.name);
    if (
      !original ||
      original.fields.some(
        (f) => f.type.kind !== 'scalar' || !['f32', 'i32', 'u32'].includes(f.type.scalar),
      )
    )
      continue;
    if (m.funcs.some((f) => locals.get(f)!.has(b.name))) continue;
    const bare = (e: Expr): boolean => e.op === 'varref' && e.name === b.name;
    const target = (e: Expr): boolean => e.op === 'index' && bare(e.base);
    const live = new Set<string>();
    let opaque = false;
    for (const f of m.funcs) {
      const used = scan(f.body, target, bare);
      if (used === null) {
        opaque = true;
        break;
      }
      for (const field of used) live.add(field);
    }
    if (
      opaque ||
      live.size === 0 ||
      live.size === original.fields.length ||
      [...live].some((name) => !original.fields.some((f) => f.name === name))
    )
      continue;
    let name = `${original.name}_projected`;
    for (let i = 1; taken.has(name); i++) name = `${original.name}_projected${i}`;
    taken.add(name);
    projected.set(b.name, {
      original,
      physical: { name, fields: original.fields.filter((f) => live.has(f.name)) },
    });
  }
  if (projected.size === 0) return undefined;
  const of = (e: Expr) =>
    e.op === 'index' && e.base.op === 'varref' ? projected.get(e.base.name) : undefined;
  const rewrite = (e: Expr): Expr => {
    if (e.op === 'member' && of(e.base)) {
      const b = e.base as Expr & { op: 'index' };
      const p = of(b)!;
      return { ...e, base: physicalIndex(b, p.physical) };
    }
    if (e.op === 'index') {
      const p = of(e);
      if (p) {
        const base = physicalIndex(e, p.physical);
        return {
          op: 'construct',
          type: e.type,
          args: p.original.fields.map((f) =>
            p.physical.fields.some((v) => v.name === f.name)
              ? { op: 'member', type: f.type, base, field: f.name }
              : { op: 'lit', type: f.type, value: 0 },
          ),
        };
      }
    }
    if (e.op === 'varref' && projected.has(e.name) && e.type.kind === 'array')
      return {
        ...e,
        type: { ...e.type, elem: { kind: 'struct', name: projected.get(e.name)!.physical.name } },
      };
    return mapChildren(e, rewrite);
  };
  const physicalIndex = (e: Expr & { op: 'index' }, s: StructDecl): Expr => {
    const type = { kind: 'struct' as const, name: s.name };
    return {
      ...e,
      type,
      base: { ...e.base, type: { kind: 'array', elem: type } },
      idx: rewrite(e.idx),
    };
  };
  return {
    ...m,
    structs: [...m.structs, ...[...projected.values()].map((p) => p.physical)],
    bindings: m.bindings.map((b) =>
      projected.has(b.name) && b.type.kind === 'array'
        ? {
            ...b,
            type: {
              ...b.type,
              elem: { kind: 'struct', name: projected.get(b.name)!.physical.name },
            },
          }
        : b,
    ),
    funcs: m.funcs.map((f) => ({ ...f, body: f.body.map((s) => mapStmtExpr(s, rewrite)) })),
  };
}
