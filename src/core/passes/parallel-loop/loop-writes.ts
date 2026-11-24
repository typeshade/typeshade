import type { Expr, FuncDecl, Stmt } from '../../ir/nodes.js';
import { sourceSpanOf } from '../../ir/span.js';
import { eachExpr } from '../../ir/visit.js';
import { callArgAccess, eachOperand, writesPlace } from '../access.js';
import { isName, reads, sameExpr } from './expression-equality.js';
import type { LoopReduction, Ctx, Write } from './types.js';
import { rootName, walk, exprsOf } from './statement-walk.js';
import { indicesOf } from './index-forms.js';

const REDUCE_BOPS = new Set(['+', '*', '&', '|', '^']);

export function writesIn(body: readonly Stmt[], c: Ctx): Write[] {
  const out: Write[] = [];
  walk(body, (st) => {
    const at = sourceSpanOf(st);
    if (st.s === 'assign' || st.s === 'assignOp') {
      const root = rootName(st.target);
      if (root !== undefined) out.push({ target: st.target, root, at, ...combineOf(st) });
    }
    exprsOf(st, (e) =>
      eachExpr(e, (x) => {
        if (x.op !== 'call') return;
        let builtin = false;
        x.args.forEach((t, k) => {
          const access = callArgAccess(x, k);
          if (!writesPlace(access)) return;
          builtin = true;
          const root = rootName(t);
          if (root === undefined) return;
          out.push(
            access === 'texel-write'
              ? { target: t, root, texel: x.args[k + 1], at }
              : access === 'append'
                ? { target: t, root, push: true, at }
                : { target: t, root, atomic: x.fn, at },
          );
        });
        if (builtin) return;
        const decl = c.byName.get(x.fn);
        if (decl === undefined) return;
        decl.params.forEach((p, k) => {
          const a = x.args[k];
          if (p.mode !== 'inout' || a === undefined) return;
          const root = rootName(a);
          if (root !== undefined) out.push({ target: a, root, at });
        });
      }),
    );
  });
  return out;
}

export function combineOf(st: Stmt & { s: 'assign' | 'assignOp' }): Pick<Write, 'combine'> {
  if (st.s === 'assignOp') {
    return REDUCE_BOPS.has(st.bop)
      ? { combine: { op: st.bop as LoopReduction['op'], with: st.expr } }
      : {};
  }
  const e = st.expr;
  if (e.op === 'binop' && REDUCE_BOPS.has(e.bop)) {
    if (sameExpr(e.a, st.target))
      return { combine: { op: e.bop as LoopReduction['op'], with: e.b } };
    if (sameExpr(e.b, st.target))
      return { combine: { op: e.bop as LoopReduction['op'], with: e.a } };
  }
  if (
    e.op === 'call' &&
    e.declRef === undefined &&
    (e.fn === 'min' || e.fn === 'max') &&
    e.args.length === 2
  ) {
    const [a, b] = e.args as [Expr, Expr];
    if (sameExpr(a, st.target)) return { combine: { op: e.fn, with: b } };
    if (sameExpr(b, st.target)) return { combine: { op: e.fn, with: a } };
  }
  return {};
}

export function readsOf(st: Stmt): Expr[] {
  const out: Expr[] = [];
  const add = (e: Expr): void => {
    const visit = (x: Expr): void => {
      if (x.op === 'index' || x.op === 'member') {
        out.push(x);
        let b: Expr = x;
        while (b.op === 'index' || b.op === 'member') {
          if (b.op === 'index') visit(b.idx);
          b = b.base;
        }
        return;
      }
      if (isName(x)) {
        out.push(x);
        return;
      }
      eachOperand(x, (operand, access) => {
        if (access === 'value') visit(operand);
        else if (access !== 'length') indicesOf(operand).forEach(visit);
      });
    };
    visit(e);
  };
  switch (st.s) {
    case 'assign':
      indicesOf(st.target).forEach(add);
      add(st.expr);
      break;
    case 'assignOp':
      indicesOf(st.target).forEach(add);
      add(st.expr);
      break;
    default:
      exprsOf(st, add);
  }
  return out;
}

export function scatterOf(ws: readonly Write[]): string | undefined {
  const ops = ws.map((w) =>
    w.atomic !== undefined
      ? w.atomic
      : w.combine !== undefined && !reads(w.combine.with, w.root)
        ? w.combine.op
        : undefined,
  );
  if (ops.some((o) => o === undefined)) return undefined;
  return ops.every((o) => o === ops[0]) ? ops[0] : undefined;
}

export function isF32ParamArray(target: Expr, root: string, f: FuncDecl): boolean {
  const p = f.params.find((x) => x.name === root);
  return (
    p !== undefined &&
    p.type.kind === 'array' &&
    target.type.kind === 'scalar' &&
    target.type.scalar === 'f32'
  );
}

export function isIndexOfName(e: Expr, name: string): boolean {
  return e.op === 'index' && isName(e.base) && e.base.name === name;
}

export function isIntegerArray(target: Expr, root: string, f: FuncDecl): boolean {
  const scalar =
    target.type.kind === 'scalar'
      ? target.type.scalar
      : target.type.kind === 'atomic'
        ? target.type.elem
        : undefined;
  void root;
  void f;
  return scalar === 'u32' || scalar === 'i32';
}
