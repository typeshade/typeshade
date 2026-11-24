import type { FuseBare } from '../../../core/host-kernel.js';
import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../../../core/ir/nodes.js';
import { sourceSpanOf, type SourceSpan } from '../../../core/ir/span.js';
import { eachExpr, eachStmtExpr } from '../../../core/ir/visit.js';
import { calleesOf, closureOf } from '../../../core/manifest/reach.js';
import { callArgAccess } from '../../../core/passes/access.js';
import type { KernelLoopPlan, KernelPlan } from '../../../core/passes/kernel-lower.js';
import { describeRead } from '../kernel-loops.js';

export function dispatched({
  iterates: _iterates,
  iteration: _iteration,
  continues: _continues,
  ...loop
}: KernelLoopPlan): Omit<KernelLoopPlan, 'iterates' | 'iteration' | 'continues'> {
  return loop;
}

export function bareArrays(
  f: FuncDecl,
  plan: KernelPlan,
  l: KernelLoopPlan,
  params: readonly string[],
): FuseBare[] {
  const found = new Map<string, { place: Expr; at: SourceSpan | undefined }>();
  const walk = (st: Stmt): void =>
    eachStmtExpr(
      st,
      (e) =>
        eachExpr(e, (x) => {
          if (x.op !== 'call' || callArgAccess(x, 0) !== 'length') return;
          const named = x.args[0];
          if (named?.op !== 'varref' && named?.op !== 'param') return;
          if (params.includes(named.name) && !found.has(named.name))
            found.set(named.name, { place: x, at: sourceSpanOf(st) });
        }),
      walk,
    );
  plan.module.funcs
    .find((g) => g.name === l.iterates)
    ?.body.slice(l.iteration)
    .forEach(walk);
  return params.flatMap((param) => {
    const first = describeRead(f, { first: found.get(param) });
    return first === undefined ? [] : [{ param, first }];
  });
}

export function reachedBy(m: ModuleDecl): ModuleDecl {
  const helpers = new Set(m.funcs.filter((g) => g.stage === undefined).map((g) => g.name));
  const callees = new Map(m.funcs.map((g) => [g.name, calleesOf(g, helpers)]));
  const keep = new Set<string>();
  for (const g of m.funcs)
    if (g.stage !== undefined) for (const name of closureOf(g.name, callees)) keep.add(name);
  return {
    ...m,
    funcs: m.funcs
      .filter((g) => keep.has(g.name))
      .map(({ span: _span, nameSpan: _nameSpan, ...g }): FuncDecl => g),
  };
}
