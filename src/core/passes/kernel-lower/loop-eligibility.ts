import type { Expr, ModuleDecl, Stmt } from '../../ir/nodes.js';
import type { ShaderType } from '../../ir/types.js';
import { eachStmtExpr, mapStmtExpr } from '../../ir/visit.js';
import { eachOperand, isAtomicAccess } from '../access.js';
import { forEachChild, mapStmt, placeRoot } from '../kernel-lower-ir.js';
import type { LoopReduction } from '../parallel-loop.js';

export function subgroupFoldable(r: LoopReduction): boolean {
  const t = r.type;
  const elem = t.kind === 'scalar' ? t.scalar : t.kind === 'vec' ? t.elem : undefined;
  if (elem === 'u32' || elem === 'i32') return true;
  if (elem === 'f32') return r.op === 'min' || r.op === 'max';
  return false;
}

export function scattersAtMostOnce(body: readonly Stmt[], scatter: ReadonlySet<string>): boolean {
  const writesInto = (sts: readonly Stmt[]): boolean => {
    let found = false;
    for (const st of sts)
      eachStmtExpr(
        st,
        () => undefined,
        (inner) => {
          if (
            (inner.s === 'assign' || inner.s === 'assignOp') &&
            inner.target.op === 'index' &&
            inner.target.base.op === 'param' &&
            scatter.has(inner.target.base.name)
          )
            found = true;
        },
      );
    return found;
  };
  let ok = true;
  const visit = (st: Stmt): void => {
    if (st.s === 'for') {
      if (writesInto([st])) ok = false;
      return;
    }
    mapStmtExpr(
      st,
      (e) => e,
      (b) => {
        visit(b);
        return b;
      },
    );
  };
  body.forEach(visit);
  return ok;
}

export function notReducible(t: ShaderType): string | undefined {
  if (t.kind === 'f64' || t.kind === 'vec64') return undefined;
  const scalar = t.kind === 'scalar' ? t.scalar : t.kind === 'vec' ? t.elem : undefined;
  if (scalar === undefined) return `a ${t.kind}, which the GPU does not fold`;
  if (scalar === 'f32' || scalar === 'i32' || scalar === 'u32') return undefined;
  if (scalar === 'bool') return 'a bool, which no buffer holds';
  return `an ${scalar}, which the call does not fold on the GPU`;
}

export function firstName(sts: readonly Stmt[], names: ReadonlySet<string>): string | undefined {
  if (names.size === 0) return undefined;
  let found: string | undefined;
  const visit = (e: Expr): void => {
    if (found !== undefined) return;
    if ((e.op === 'varref' || e.op === 'param') && names.has(e.name)) {
      found = e.name;
      return;
    }
    forEachChild(e, visit);
  };
  for (const st of sts)
    mapStmt(st, (e) => {
      visit(e);
      return e;
    });
  return found;
}

export function hasOwnContinue(body: readonly Stmt[]): boolean {
  return body.some((st) => {
    switch (st.s) {
      case 'continue':
        return true;
      case 'if':
        return (
          st.arms.some((a) => hasOwnContinue(a.body)) ||
          (st.elseBody !== undefined && hasOwnContinue(st.elseBody))
        );
      case 'switch':
        return (
          st.cases.some((c) => hasOwnContinue(c.body)) ||
          (st.defaultBody !== undefined && hasOwnContinue(st.defaultBody))
        );
      default:
        return false;
    }
  });
}

export function readsOutsideAtomics(sts: readonly Stmt[], name: string): boolean {
  let found = false;
  const visit = (e: Expr): void => {
    if (found) return;
    if ((e.op === 'varref' || e.op === 'param') && e.name === name) {
      found = true;
      return;
    }
    eachOperand(e, (c, access) => {
      if (access === 'value') visit(c);
      else if (isAtomicAccess(access)) {
        for (let b = c; b.op === 'index' || b.op === 'member'; b = b.base)
          if (b.op === 'index') visit(b.idx);
      }
    });
  };
  for (const st of sts)
    mapStmt(st, (e) => {
      if (st.s === 'assign' || st.s === 'assignOp') {
        if (e === st.target) return e;
      }
      visit(e);
      return e;
    });
  return found;
}

export function stillPlain(sts: readonly Stmt[], name: string): boolean {
  let found = false;
  const walk = (st: Stmt): void => {
    if ((st.s === 'assign' || st.s === 'assignOp') && rootOf(st.target) === name) found = true;
    mapStmtExpr(
      st,
      (e) => e,
      (b) => {
        walk(b);
        return b;
      },
    );
  };
  sts.forEach(walk);
  return found;
}

function rootOf(e: Expr): string | undefined {
  const b = placeRoot(e);
  return b.op === 'varref' || b.op === 'param' ? b.name : undefined;
}

export function isTextureParam(t: ShaderType): boolean {
  return t.kind === 'texture' || t.kind === 'storage-texture';
}

export function readsArraysByLengthOnly(sts: readonly Stmt[], names: readonly string[]): boolean {
  const set = new Set(names);
  let ok = true;
  const visit = (e: Expr): void => {
    if (!ok) return;
    if ((e.op === 'param' || e.op === 'varref') && set.has(e.name)) {
      ok = false;
      return;
    }
    eachOperand(e, (c, access) => {
      if (access !== 'length') visit(c);
    });
  };
  const walk = (st: Stmt): void => {
    mapStmt(st, (e) => {
      visit(e);
      return e;
    });
  };
  sts.forEach(walk);
  return ok;
}

export function notUniform(t: ShaderType, m: ModuleDecl): string | undefined {
  return notShareable(t, m, new Set());
}

export function notStorage(t: ShaderType, m: ModuleDecl): string | undefined {
  return notShareable(t, m, new Set());
}

function notShareable(t: ShaderType, m: ModuleDecl, seen: Set<string>): string | undefined {
  switch (t.kind) {
    case 'scalar':
      return t.scalar === 'bool' ? 'a bool, which no buffer holds' : undefined;
    case 'vec':
      return t.elem === 'bool' ? 'a bool vector, which no buffer holds' : undefined;
    case 'mat':
      return t.elem === 'f64' ? 'a matrix of f64, which has no host value yet' : undefined;
    case 'f64':
    case 'vec64':
      return undefined;
    case 'array':
      return t.size === undefined ? 'an array with no size' : notShareable(t.elem, m, seen);
    case 'struct': {
      if (seen.has(t.name)) return undefined;
      seen.add(t.name);
      const s = m.structs.find((x) => x.name === t.name);
      if (s === undefined) return `struct ${t.name}, which is not declared`;
      for (const fl of s.fields) {
        const why = notShareable(fl.type, m, seen);
        if (why !== undefined) return why;
      }
      return undefined;
    }
    default:
      return `a ${t.kind}, which the call does not pack yet`;
  }
}
