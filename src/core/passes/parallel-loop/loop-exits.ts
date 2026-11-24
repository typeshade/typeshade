import type { Stmt } from '../../ir/nodes.js';
import type { SourceSpan } from '../../ir/span.js';
import { sourceSpanOf } from '../../ir/span.js';
import { eachExpr } from '../../ir/visit.js';
import { isBarrierIntrinsic } from '../../intrinsics.js';
import { isName } from './expression-equality.js';
import type { LoopRefusal, Ctx } from './types.js';
import { walk, exprsOf } from './statement-walk.js';

export function earlyExit(body: readonly Stmt[]): LoopRefusal | undefined {
  const visit = (sts: readonly Stmt[], nested: boolean): LoopRefusal | undefined => {
    for (const st of sts) {
      switch (st.s) {
        case 'return':
          return { rule: 'R2', why: 'return', at: sourceSpanOf(st) };
        case 'break':
          if (!nested) return { rule: 'R2', why: 'break', at: sourceSpanOf(st) };
          break;
        case 'if':
          for (const a of st.arms) {
            const r = visit(a.body, nested);
            if (r !== undefined) return r;
          }
          if (st.elseBody !== undefined) {
            const r = visit(st.elseBody, nested);
            if (r !== undefined) return r;
          }
          break;
        case 'for': {
          const r = visit(st.body, true);
          if (r !== undefined) return r;
          break;
        }
        case 'switch': {
          for (const cse of st.cases) {
            const r = visit(cse.body, true);
            if (r !== undefined) return r;
          }
          if (st.defaultBody !== undefined) {
            const r = visit(st.defaultBody, true);
            if (r !== undefined) return r;
          }
          break;
        }
        default:
          break;
      }
    }
    return undefined;
  };
  return visit(body, false);
}

export function callEffects(body: readonly Stmt[], c: Ctx): LoopRefusal | undefined {
  let found: LoopRefusal | undefined;
  const seen = new Set<string>();
  const inFn = (fn: string, at: SourceSpan | undefined): void => {
    if (seen.has(fn)) return;
    seen.add(fn);
    const decl = c.byName.get(fn);
    if (decl === undefined) return;
    walk(decl.body, (st) => scan(st, at));
  };
  const scan = (st: Stmt, at: SourceSpan | undefined): void => {
    if (found !== undefined) return;
    exprsOf(st, (e) =>
      eachExpr(e, (x) => {
        if (found !== undefined) return;
        if (isName(x) && c.workgroup.has(x.name)) {
          found = { rule: 'R6', why: 'workgroup', name: x.name, at };
          return;
        }
        if (x.op !== 'call') return;
        if (x.fn.startsWith('console.')) {
          found = { rule: 'R6', why: 'console', name: x.fn, at };
          return;
        }
        if (isBarrierIntrinsic(x.fn)) {
          found = { rule: 'R6', why: 'barrier', name: x.fn, at };
          return;
        }
        const decl = c.byName.get(x.fn);
        if (decl === undefined) return;
        const own = new Set(decl.params.filter((p) => p.mode === 'inout').map((p) => p.name));
        for (const n of c.writes.get(x.fn) ?? []) {
          if (!own.has(n) && c.moduleNames.has(n)) {
            found = { rule: 'R5', callee: x.fn, writes: n, at };
            return;
          }
        }
        inFn(x.fn, at);
      }),
    );
  };
  walk(body, (st) => scan(st, sourceSpanOf(st)));
  return found;
}
