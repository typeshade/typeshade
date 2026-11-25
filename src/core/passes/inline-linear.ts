import { stageOf } from '../ir/index.js';
import type { Expr, Stmt, ModuleDecl, FuncDecl } from '../ir/index.js';
import { eachStmtExpr } from '../ir/visit.js';
import { mapExpr } from './opt/ir-transform.js';
import { bodyHasRaw } from './opt/dce.js';
import { fixpoint, LEVEL_PASSES, type OptPass } from './opt/optimize.js';
import { inlineFn } from './inline.js';

const isEntry = (f: FuncDecl): boolean => stageOf(f) !== undefined;

function preludeBlocker(
  stmts: readonly Stmt[],
  loopDepth: number,
  switchDepth: number,
): string | undefined {
  for (const s of stmts) {
    switch (s.s) {
      case 'let':
      case 'var':
      case 'assign':
      case 'assignOp':
        break;
      case 'if': {
        for (const a of s.arms) {
          const b = preludeBlocker(a.body, loopDepth, switchDepth);
          if (b !== undefined) return b;
        }
        const b = preludeBlocker(s.elseBody ?? [], loopDepth, switchDepth);
        if (b !== undefined) return b;
        break;
      }
      case 'for': {
        const b =
          preludeBlocker([s.init], loopDepth, switchDepth) ??
          preludeBlocker(s.body, loopDepth + 1, switchDepth);
        if (b !== undefined) return b;
        break;
      }
      case 'switch': {
        for (const c of s.cases) {
          const b = preludeBlocker(c.body, loopDepth, switchDepth + 1);
          if (b !== undefined) return b;
        }
        const b = preludeBlocker(s.defaultBody ?? [], loopDepth, switchDepth + 1);
        if (b !== undefined) return b;
        break;
      }
      case 'return':
        return 'nested-return';
      case 'discard':
        return 'discard';
      case 'call':
        return 'effect-call';
      case 'raw':
        return 'raw';
      case 'break':
        if (loopDepth === 0 && switchDepth === 0) return 'free-break';
        break;
      case 'continue':
        if (loopDepth === 0) return 'free-continue';
        break;
      default:
        return 'unknown-stmt';
    }
  }
  return undefined;
}

function liftableBody(f: FuncDecl): { prelude: readonly Stmt[]; ret: Expr } | undefined {
  const body = f.body;
  if (body.length === 0) return undefined;
  const last = body[body.length - 1]!;
  if (last.s !== 'return' || last.expr === undefined) return undefined;
  const prelude = body.slice(0, -1);
  return preludeBlocker(prelude, 0, 0) === undefined ? { prelude, ret: last.expr } : undefined;
}

function exprCallsName(e: Expr, name: string): boolean {
  let found = false;
  mapExpr(e, (x) => {
    if (x.op === 'call' && x.fn === name) found = true;
    return x;
  });
  return found;
}

function stmtOwnExprCallsName(s: Stmt, name: string): boolean {
  switch (s.s) {
    case 'let':
      return exprCallsName(s.expr, name);
    case 'var':
      return s.init !== undefined && exprCallsName(s.init, name);
    case 'assign':
    case 'assignOp':
      return exprCallsName(s.target, name) || exprCallsName(s.expr, name);
    case 'return':
      return s.expr !== undefined && exprCallsName(s.expr, name);
    case 'call':
      return exprCallsName(s.expr, name);
    default:
      return false;
  }
}

function calledInForHeader(m: ModuleDecl, name: string): boolean {
  let found = false;
  const walk = (stmts: readonly Stmt[]): void => {
    for (const s of stmts) {
      if (s.s === 'for') {
        if (
          stmtOwnExprCallsName(s.init, name) ||
          exprCallsName(s.cond, name) ||
          stmtOwnExprCallsName(s.update, name)
        )
          found = true;
        walk(s.body);
      } else if (s.s === 'if') {
        for (const a of s.arms) walk(a.body);
        if (s.elseBody) walk(s.elseBody);
      } else if (s.s === 'switch') {
        for (const c of s.cases) walk(c.body);
        if (s.defaultBody) walk(s.defaultBody);
      }
    }
  };
  for (const f of m.funcs) walk(f.body);
  return found;
}

function moduleCallsName(m: ModuleDecl, name: string): boolean {
  return m.funcs.some((f) => f.body.some((s) => stmtDeepCallsName(s, name)));
}
function stmtDeepCallsName(s: Stmt, name: string): boolean {
  if (stmtOwnExprCallsName(s, name)) return true;
  switch (s.s) {
    case 'if':
      return (
        s.arms.some(
          (a) => exprCallsName(a.cond, name) || a.body.some((b) => stmtDeepCallsName(b, name)),
        ) ||
        (s.elseBody?.some((b) => stmtDeepCallsName(b, name)) ?? false)
      );
    case 'for':
      return (
        stmtOwnExprCallsName(s.init, name) ||
        exprCallsName(s.cond, name) ||
        stmtOwnExprCallsName(s.update, name) ||
        s.body.some((b) => stmtDeepCallsName(b, name))
      );
    case 'switch':
      return (
        exprCallsName(s.scrut, name) ||
        s.cases.some((c) => c.body.some((b) => stmtDeepCallsName(b, name))) ||
        (s.defaultBody?.some((b) => stmtDeepCallsName(b, name)) ?? false)
      );
    default:
      return false;
  }
}

function isInlinable(m: ModuleDecl, f: FuncDecl, requireMultiStatement: boolean): boolean {
  if (isEntry(f) || f.opaque === true) return false;
  const lb = liftableBody(f);
  if (lb === undefined) return false;
  if (requireMultiStatement !== lb.prelude.length > 0) return false;
  if (exprCallsName(lb.ret, f.name) || lb.prelude.some((s) => stmtDeepCallsName(s, f.name)))
    return false;
  if (!moduleCallsName(m, f.name)) return false;
  if (requireMultiStatement && calledInForHeader(m, f.name)) return false;
  return true;
}

export function inlineLinearFn(m: ModuleDecl, name: string, counter: { n: number }): ModuleDecl {
  const target = m.funcs.find((f) => f.name === name);
  const lb = target && liftableBody(target);
  if (!target || !lb) return m;

  const usedParams = new Set<string>();
  const probeParam = (e: Expr): void => {
    mapExpr(e, (x) => {
      if ((x.op === 'param' || x.op === 'varref') && target.params.some((p) => p.name === x.name))
        usedParams.add(x.name);
      return x;
    });
  };
  for (const s of lb.prelude) eachStmtExpr(s, probeParam);
  probeParam(lb.ret);

  const liftCalls = (e: Expr, lifted: Stmt[]): Expr =>
    mapExpr(e, (x) => {
      if (x.op !== 'call' || x.fn !== name) return x;
      const p = `_inl${counter.n++}_`;
      const subst = new Map<string, Expr>();
      target.params.forEach((param, i) => {
        if (!usedParams.has(param.name)) return;
        const argTmp = `${p}a${i}`;
        lifted.push({ s: 'let', name: argTmp, expr: x.args[i]! });
        subst.set(param.name, { op: 'varref', type: param.type, name: argTmp });
      });
      const localRen = new Map<string, string>();
      for (const name of declaredNamesDeep(lb.prelude))
        localRen.set(name, `${p}${name.replace(/^_/, '')}`);
      const rw = (ex: Expr): Expr =>
        mapExpr(ex, (y) => {
          if (y.op === 'param' || y.op === 'varref') {
            if (subst.has(y.name)) return subst.get(y.name)!;
            if (localRen.has(y.name)) return { ...y, name: localRen.get(y.name)! };
          }
          return y;
        });
      for (const st of lb.prelude) lifted.push(renameStmt(st, localRen, rw));
      const retTmp = `${p}ret`;
      lifted.push({ s: 'let', name: retTmp, expr: rw(lb.ret) });
      return { op: 'varref', type: target.ret, name: retTmp };
    });

  const inlineInBlock = (stmts: readonly Stmt[]): Stmt[] => {
    const out: Stmt[] = [];
    for (const s of stmts) {
      const lifted: Stmt[] = [];
      const L = (e: Expr): Expr => liftCalls(e, lifted);
      let s2: Stmt;
      switch (s.s) {
        case 'let':
          s2 = { ...s, expr: L(s.expr) };
          break;
        case 'var':
          s2 = s.init !== undefined ? { ...s, init: L(s.init) } : s;
          break;
        case 'assign':
        case 'assignOp':
          s2 = { ...s, target: L(s.target), expr: L(s.expr) };
          break;
        case 'return':
          s2 = s.expr !== undefined ? { ...s, expr: L(s.expr) } : s;
          break;
        case 'call':
          s2 = { ...s, expr: L(s.expr) };
          break;
        case 'if':
          s2 = {
            ...s,
            arms: s.arms.map((a) => ({ cond: L(a.cond), body: inlineInBlock(a.body) })),
            elseBody: s.elseBody ? inlineInBlock(s.elseBody) : undefined,
          };
          break;
        case 'for':
          s2 = { ...s, body: inlineInBlock(s.body) };
          break;
        case 'switch':
          s2 = {
            ...s,
            scrut: L(s.scrut),
            cases: s.cases.map((c) => ({ ...c, body: inlineInBlock(c.body) })),
            defaultBody: s.defaultBody ? inlineInBlock(s.defaultBody) : undefined,
          };
          break;
        default:
          s2 = s;
      }
      out.push(...lifted, s2);
    }
    return out;
  };

  const others = m.funcs
    .filter((f) => f !== target)
    .map((f): FuncDecl => ({ ...f, body: inlineInBlock(f.body) }));
  const stillCalled = others.some((f) => f.body.some((s) => stmtDeepCallsName(s, name)));
  return { ...m, funcs: stillCalled ? [target, ...others] : others };
}

export function declaredNamesDeep(stmts: readonly Stmt[]): Set<string> {
  const out = new Set<string>();
  const walk = (body: readonly Stmt[]): void => {
    for (const s of body) {
      if (s.s === 'let' || s.s === 'var') out.add(s.name);
      else if (s.s === 'if') {
        for (const a of s.arms) walk(a.body);
        walk(s.elseBody ?? []);
      } else if (s.s === 'for') {
        walk([s.init]);
        walk(s.body);
      } else if (s.s === 'switch') {
        for (const c of s.cases) walk(c.body);
        walk(s.defaultBody ?? []);
      }
    }
  };
  walk(stmts);
  return out;
}

function renameStmt(s: Stmt, localRen: ReadonlyMap<string, string>, rw: (e: Expr) => Expr): Stmt {
  const sub = (body: readonly Stmt[]): Stmt[] => body.map((b) => renameStmt(b, localRen, rw));
  switch (s.s) {
    case 'let':
      return { s: 'let', name: localRen.get(s.name) ?? s.name, expr: rw(s.expr) };
    case 'var':
      return {
        s: 'var',
        name: localRen.get(s.name) ?? s.name,
        type: s.type,
        ...(s.init !== undefined ? { init: rw(s.init) } : {}),
      };
    case 'assign':
      return { ...s, target: rw(s.target), expr: rw(s.expr) };
    case 'assignOp':
      return { ...s, target: rw(s.target), expr: rw(s.expr) };
    case 'call':
      return { ...s, expr: rw(s.expr) };
    case 'if':
      return {
        ...s,
        arms: s.arms.map((a) => ({ cond: rw(a.cond), body: sub(a.body) })),
        ...(s.elseBody !== undefined ? { elseBody: sub(s.elseBody) } : {}),
      };
    case 'for':
      return {
        ...s,
        init: renameStmt(s.init, localRen, rw),
        cond: rw(s.cond),
        update: renameStmt(s.update, localRen, rw),
        body: sub(s.body),
      };
    case 'switch':
      return {
        ...s,
        scrut: rw(s.scrut),
        cases: s.cases.map((c) => ({ ...c, body: sub(c.body) })),
        ...(s.defaultBody !== undefined ? { defaultBody: sub(s.defaultBody) } : {}),
      };
    default:
      return s;
  }
}

const CLEANUP: readonly OptPass[] = LEVEL_PASSES.O1;

export function inlineLinearAll(m: ModuleDecl, counter: { n: number } = { n: 0 }): ModuleDecl {
  if (m.funcs.some((f) => bodyHasRaw(f.body))) return m;
  let cur = m;
  for (let i = 0; i <= m.funcs.length; i++) {
    const single = cur.funcs.find((f) => isInlinable(cur, f, false));
    if (single) {
      cur = inlineFn(cur, single.name);
      continue;
    }
    const linear = cur.funcs.find((f) => isInlinable(cur, f, true));
    if (linear) {
      cur = inlineLinearFn(cur, linear.name, counter);
      continue;
    }
    break;
  }
  return cur === m ? m : fixpoint(cur, CLEANUP);
}
