// ═══ Shader DSL — promoting the state of an unrolled loop (Optimization context) ═══
//
// An unrolled loop leaves its state in `var`s that each copy updates in turn:
//
//   var a: f32 = 0.5;          let a = 0.5;
//   s += a * f(q);       ->    let s_1 = (s + (a * f(q)));
//   a *= 0.5;                  let a_1 = (a * 0.5);
//
// promoteWrites turns each such `var` into a chain of `let`s, one per write, and makes every
// later read, in the block or nested in it, read the version current at that point. The other
// passes then do the work a `var` hides from them: const-prop and const-fold carry a literal
// through the chain, copy-prop forwards a copy, and DCE removes a version no one reads, which is
// the last update of the loop (#845). `unrollLoops` calls it on the block it unrolled a loop
// into, for the vars the copies write; no other `var` changes.
//
// A var is promoted only when the block that declares it is the only place that writes it, and
// only by `v = e` or `v op= e` at the top level of that block. It stays a `var` when a write
// is nested in an `if`, a loop or a `switch` (the value after it depends on the path), targets
// a field, a lane or an element, or reaches it through a call's `inout` parameter (the
// module's effect table); and when it has no initializer, or its type is not a scalar, a vector
// or a matrix.
//
// Each promoted write computes exactly what the assignment computed (`v op= e` is `v op e`, the
// expression WGSL defines it as), in the same order, so values are unchanged. Version names are
// `${name}_${k}`, unused anywhere in the function, so the function-wide unique-name premise of
// the other passes (`assertUniqueLocalNames`) holds.

import type { Expr, ShaderType, Stmt } from '../../ir/index.js';
import type { FnWrites } from '../effects.js';
import { collectMutatedRoots } from './expr-utils.js';
import { mapExpr, mapStmt } from './ir-transform.js';

const promotable = (t: ShaderType): boolean =>
  t.kind === 'scalar' || t.kind === 'vec' || t.kind === 'mat';

const wholeWrite = (s: Stmt, name: string): boolean =>
  (s.s === 'assign' || s.s === 'assignOp') && s.target.op === 'varref' && s.target.name === name;

function fresh(name: string, taken: Set<string>): string {
  let k = 1;
  while (taken.has(`${name}_${String(k)}`)) k++;
  const n = `${name}_${String(k)}`;
  taken.add(n);
  return n;
}

/** Promote the vars of `only` that `body` declares and alone writes, by whole writes at its top
 *  level, to chains of `let`s (see the header). `taken` holds every name of the function and
 *  receives the new ones. */
export function promoteWrites(
  body: readonly Stmt[],
  only: ReadonlySet<string>,
  writes: FnWrites,
  taken: Set<string>,
): readonly Stmt[] {
  const vars = new Map<string, ShaderType>();
  for (const s of body) {
    if (s.s === 'var' && only.has(s.name) && s.init !== undefined && promotable(s.type)) {
      vars.set(s.name, s.type);
    }
  }
  for (const s of body) {
    if (vars.size === 0) return body;
    const mutated = new Set<string>();
    collectMutatedRoots([s], mutated, writes);
    for (const name of mutated) if (vars.has(name) && !wholeWrite(s, name)) vars.delete(name);
  }
  if (vars.size === 0) return body;
  const current = new Map<string, string>();
  const read = (e: Expr): Expr => {
    if (e.op !== 'varref') return e;
    const now = current.get(e.name);
    return now === undefined || now === e.name ? e : { ...e, name: now };
  };
  const out: Stmt[] = [];
  for (const s of body) {
    if (s.s === 'var' && vars.has(s.name)) {
      out.push({ s: 'let', name: s.name, expr: mapExpr(s.init!, read), span: s.span });
      current.set(s.name, s.name);
      continue;
    }
    if ((s.s === 'assign' || s.s === 'assignOp') && s.target.op === 'varref') {
      const name = s.target.name;
      const type = vars.get(name);
      const before = current.get(name);
      if (type !== undefined && before !== undefined) {
        const rhs = mapExpr(s.expr, read);
        const expr: Expr =
          s.s === 'assign'
            ? rhs
            : { op: 'binop', type, bop: s.bop, a: { op: 'varref', type, name: before }, b: rhs };
        const next = fresh(name, taken);
        out.push({ s: 'let', name: next, expr, span: s.span });
        current.set(name, next);
        continue;
      }
    }
    out.push(current.size === 0 ? s : mapStmt(s, read));
  }
  return out;
}
