// ═══ The types a module writes (change 0142, rule 6) ═══
//
// An object of a type that the program never writes after the object is built cannot be told
// from a copy of it: `===` on objects is refused, and nothing can show the two names apart. So a
// store or a name that rules 2 and 4 would refuse is a copy there. This file answers which types
// the module writes, on the lowered IR of every function, so the answer does not depend on names.
//
// A struct or array type is WRITTEN when a store reaches a field or an element through a value of
// that type: for the target `root.a.b[i].c`, the types of `root`, `root.a`, `root.a.b` and
// `root.a.b[i]` are written. An atomic or a texture store, and `push` and `fill` (which lower to
// stores), count the same way. What this file cannot read is written.
//
// Construction: in a constructor, a store whose target root is the constructor's own object
// builds it, so the type of that root is not written by it. The types below the root on the
// chain still are (`this.c.x = 1` writes the type of `this.c`).

import type { FuncDecl, Expr, Stmt, StructDecl } from '../../core/ir/nodes.js';
import type { ShaderType } from '../../core/ir/types.js';
import { typeKey } from '../../core/ir/types.js';
import { isAtomicIntrinsic } from '../../core/intrinsics.js';
import { eachExpr, eachStmtExpr } from '../../core/ir/visit.js';
import { optionalDeclOf, optionalInner } from './optional.js';

export interface WrittenTypes {
  /** Whether `t`, or a struct or an array nested in it, is written. */
  writes(t: ShaderType): boolean;
}

export function writtenTypes(
  funcs: readonly FuncDecl[],
  constructors: ReadonlySet<FuncDecl>,
  structs: readonly StructDecl[],
  /** Types a refused statement wrote, which no IR carries. */
  also: readonly ShaderType[] = [],
): WrittenTypes {
  const written = new Set<string>();
  let everything = false;
  const mark = (t: ShaderType): void => {
    if (t.kind === 'struct' || t.kind === 'array') written.add(typeKey(t));
  };
  const fieldsOf = (name: string): readonly { readonly type: ShaderType }[] | undefined =>
    structs.find((s) => s.name === name)?.fields ?? optionalDeclOf(name)?.fields;

  /** The target's chain: the holders from the root up to the value written. */
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
      // The constructor's own object is being built, not written.
      if (building && i === 0 && root.op === 'varref' && root.name.startsWith('self_')) return;
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
            // An atomic or a texture store writes through its first argument.
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
      // A struct that cannot be read is written.
      return fields === undefined || fields.some((fd) => nestedWritten(fd.type, seen));
    }
    return false;
  };
  return { writes: (t) => everything || nestedWritten(t, new Set()) };
}
