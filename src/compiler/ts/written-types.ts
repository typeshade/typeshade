// Implements: Rule 8.8 (docs/language-design.md; traced in reqs/).

import type { FuncDecl, Expr, Stmt, StructDecl } from '../../core/ir/nodes.js';
import type { ShaderType } from '../../core/ir/types.js';
import { typeKey } from '../../core/ir/types.js';
import { isAtomicIntrinsic } from '../../core/intrinsics.js';
import { eachExpr, eachStmtExpr } from '../../core/ir/visit.js';
import { optionalDeclOf, optionalInner } from './optional.js';

export interface WrittenTypes {
  writes(t: ShaderType): boolean;
}

export function writtenTypes(
  funcs: readonly FuncDecl[],
  constructors: ReadonlySet<FuncDecl>,
  structs: readonly StructDecl[],
  also: readonly ShaderType[] = [],
): WrittenTypes {
  const written = new Set<string>();
  let everything = false;
  const mark = (t: ShaderType): void => {
    if (t.kind === 'struct' || t.kind === 'array') written.add(typeKey(t));
  };
  const fieldsOf = (name: string): readonly { readonly type: ShaderType }[] | undefined =>
    structs.find((s) => s.name === name)?.fields ?? optionalDeclOf(name)?.fields;

  const store = (target: Expr, building: boolean): void => {
    const holders: Expr[] = [];
    let at: Expr = target;
    while (at.op === 'member' || at.op === 'index') {
      at = at.base;
      holders.unshift(at);
    }
    const root = at;
    if (
      root.op !== 'varref' &&
      root.op !== 'param' &&
      root.op !== 'externref' &&
      root.op !== 'constref'
    ) {
      everything = true;
      return;
    }
    holders.forEach((h, i) => {
      if (
        building &&
        i === 0 &&
        (root.op === 'varref' || root.op === 'param') &&
        root.name === 'self_'
      )
        return;
      mark(h.type);
    });
  };

  also.forEach(mark);
  for (const f of funcs) {
    const building = constructors.has(f);
    const visitStmt = (s: Stmt): void => {
      if (s.s === 'assign' || s.s === 'assignOp') store(s.target, building);
      eachStmtExpr(
        s,
        (e) =>
          eachExpr(e, (x) => {
            if (
              x.op === 'call' &&
              (isAtomicIntrinsic(x.fn) || x.fn.startsWith('textureStore')) &&
              x.args[0] !== undefined
            ) {
              if (x.args[0].op === 'member' || x.args[0].op === 'index') store(x.args[0], false);
            }
          }),
        visitStmt,
      );
    };
    for (const s of f.body as readonly Stmt[]) visitStmt(s);
  }

  const nestedWritten = (t: ShaderType, seen: Set<string>): boolean => {
    const key = typeKey(t);
    if (seen.has(key)) return false;
    seen.add(key);
    const inner = optionalInner(t);
    if (inner !== undefined && nestedWritten(inner, seen)) return true;
    if (t.kind === 'array') return written.has(key) || nestedWritten(t.elem, seen);
    if (t.kind === 'struct') {
      if (written.has(key)) return true;
      const fields = fieldsOf(t.name);
      return fields === undefined || fields.some((fd) => nestedWritten(fd.type, seen));
    }
    return false;
  };
  return { writes: (t) => everything || nestedWritten(t, new Set()) };
}
