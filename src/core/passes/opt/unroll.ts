import type { Stmt, ModuleDecl, FuncDecl } from '../../ir/index.js';
import { eachStmtExpr } from '../../ir/visit.js';
import { fnWrites, type FnWrites } from '../effects.js';
import { promoteWrites } from './promote-vars.js';
import { bodyHasRaw, collectMutatedRoots } from './expr-utils.js';
import { seedSuffix, tryUnroll } from './unroll/copies.js';
import { intConsts, type ForStmt, type IntConsts } from './unroll/trip-count.js';

export { seedSuffix, tryUnroll } from './unroll/copies.js';
export { analyzeLoop, intConsts, type IntConsts } from './unroll/trip-count.js';

interface FnScope {
  readonly counter: { n: number };
  readonly writes: FnWrites;
  readonly taken: Set<string>;
  readonly consts: IntConsts;
}

function unrollInnerLoopsFirst(body: readonly Stmt[], scope: FnScope): readonly Stmt[] {
  const out: Stmt[] = [];
  const writtenByCopies = new Set<string>();
  for (const s of body) {
    if (s.s === 'for') {
      const loop: ForStmt = { ...s, body: unrollInnerLoopsFirst(s.body, scope) };
      const copies = tryUnroll(loop, scope.counter, undefined, undefined, scope.consts);
      if (copies !== undefined) {
        out.push(...copies);
        collectMutatedRoots(copies, writtenByCopies, scope.writes);
      } else out.push(loop);
    } else if (s.s === 'if') {
      out.push({
        ...s,
        arms: s.arms.map((a) => ({ cond: a.cond, body: unrollInnerLoopsFirst(a.body, scope) })),
        elseBody: s.elseBody ? unrollInnerLoopsFirst(s.elseBody, scope) : undefined,
      });
    } else if (s.s === 'switch') {
      out.push({
        ...s,
        cases: s.cases.map((c) => ({
          values: c.values,
          body: unrollInnerLoopsFirst(c.body, scope),
        })),
        defaultBody: s.defaultBody ? unrollInnerLoopsFirst(s.defaultBody, scope) : undefined,
      });
    } else {
      out.push(s);
    }
  }
  return writtenByCopies.size === 0
    ? out
    : promoteWrites(out, writtenByCopies, scope.writes, scope.taken);
}

function namesTheFunctionDeclares(f: FuncDecl): Set<string> {
  const taken = new Set<string>(f.params.map((p) => p.name));
  const scan = (s: Stmt): void => {
    if (s.s === 'let' || s.s === 'var') taken.add(s.name);
    eachStmtExpr(s, () => {}, scan);
  };
  for (const s of f.body) scan(s);
  return taken;
}

export function unrollLoops(m: ModuleDecl): ModuleDecl {
  const consts = intConsts(m);
  return {
    ...m,
    funcs: m.funcs.map((f): FuncDecl =>
      bodyHasRaw(f.body)
        ? f
        : {
            ...f,
            body: unrollInnerLoopsFirst(f.body, {
              counter: { n: seedSuffix(f.body) },
              writes: fnWrites(m),
              taken: namesTheFunctionDeclares(f),
              consts,
            }),
          },
    ),
  };
}
