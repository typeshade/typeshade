// A local aggregate copied immediately before a branch need not be copied on a
// path that overwrites the whole value. Keep the snapshot on the other path.
import type { ModuleDecl, Stmt } from '../../ir/index.js';
import { exprHasEffect, fnReads, fnWrites } from '../effects.js';
import { bodyHasRaw, refsLocal } from './expr-utils.js';

export function sinkAggregateInit(m: ModuleDecl): ModuleDecl {
  const writes = fnWrites(m),
    reads = fnReads(m);
  const block = (body: readonly Stmt[]): Stmt[] => {
    const nested = (s: Stmt): Stmt => {
      if (s.s === 'if')
        return {
          ...s,
          arms: s.arms.map((a) => ({ ...a, body: block(a.body) })),
          elseBody: s.elseBody && block(s.elseBody),
        };
      if (s.s === 'for') return { ...s, body: block(s.body) };
      if (s.s === 'switch')
        return {
          ...s,
          cases: s.cases.map((c) => ({ ...c, body: block(c.body) })),
          defaultBody: s.defaultBody && block(s.defaultBody),
        };
      return s;
    };
    const out = body.map(nested);
    for (let i = 0; i + 1 < out.length; i++) {
      const decl = out[i]!,
        branch = out[i + 1]!;
      if (
        decl.s !== 'var' ||
        decl.init?.op !== 'varref' ||
        (decl.type.kind !== 'struct' && decl.type.kind !== 'array') ||
        decl.init.name === decl.name ||
        branch.s !== 'if' ||
        branch.arms.length !== 1
      )
        continue;
      const arm = branch.arms[0]!,
        first = arm.body[0];
      const destination = new Set([decl.name]);
      // The condition must neither observe the old destination nor change the
      // source before the delayed copy. Whole assignment, never a field store.
      if (
        refsLocal(arm.cond, destination, reads) ||
        exprHasEffect(arm.cond, writes) ||
        first?.s !== 'assign' ||
        first.target.op !== 'varref' ||
        first.target.name !== decl.name ||
        refsLocal(first.expr, destination, reads)
      )
        continue;
      out[i] = { ...decl, init: undefined };
      out[i + 1] = {
        ...branch,
        elseBody: [
          { s: 'assign', target: first.target, expr: decl.init },
          ...(branch.elseBody ?? []),
        ],
      };
    }
    return out;
  };
  return {
    ...m,
    funcs: m.funcs.map((f) => (bodyHasRaw(f.body) ? f : { ...f, body: block(f.body) })),
  };
}
