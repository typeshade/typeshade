import type { Expr, FuncDecl, ModuleDecl, ShaderType, Stmt } from '../../ir/index.js';
import { eachExpr, eachStmtExpr } from '../../ir/visit.js';
import { exprHasEffect, fnReads, fnWrites, type FnReads, type FnWrites } from '../effects.js';
import { bodyHasRaw, collectMutatedRoots, refsLocal } from './expr-utils.js';
import { targetRoot } from './expr-utils/roots.js';
import { typeEq } from '../../ir/types.js';

const valueKinds: ReadonlySet<ShaderType['kind']> = new Set([
  'scalar',
  'vec',
  'mat',
  'struct',
  'array',
]);

function dropDeadInits(body: readonly Stmt[], writes: FnWrites, reads: FnReads): readonly Stmt[] {
  const nested = (s: Stmt): Stmt => {
    if (s.s === 'if')
      return {
        ...s,
        arms: s.arms.map((a) => ({ ...a, body: dropDeadInits(a.body, writes, reads) })),
        elseBody: s.elseBody && dropDeadInits(s.elseBody, writes, reads),
      };
    if (s.s === 'for') return { ...s, body: dropDeadInits(s.body, writes, reads) };
    if (s.s === 'switch')
      return {
        ...s,
        cases: s.cases.map((c) => ({ ...c, body: dropDeadInits(c.body, writes, reads) })),
        defaultBody: s.defaultBody && dropDeadInits(s.defaultBody, writes, reads),
      };
    return s;
  };
  const items = body.map(nested);
  const names = new Set<string>();
  const touches = (s: Stmt): boolean => {
    let yes = false;
    const walk = (x: Stmt): void =>
      eachStmtExpr(
        x,
        (e) => {
          if (!yes && refsLocal(e, names, reads)) yes = true;
        },
        walk,
      );
    walk(s);
    return yes;
  };
  const dropped = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    const decl = items[i]!;
    if (decl.s !== 'var' || (decl.init !== undefined && exprHasEffect(decl.init, writes))) continue;
    names.clear();
    names.add(decl.name);
    let j = i + 1;
    while (j < items.length && !touches(items[j]!)) j++;
    const write = items[j];
    if (
      write?.s === 'assign' &&
      write.target.op === 'varref' &&
      write.target.name === decl.name &&
      !refsLocal(write.expr, names, reads)
    ) {
      dropped.add(i);
      items[j] = { ...decl, init: write.expr, span: decl.span ?? write.span };
    }
  }
  return items.filter((_, i) => !dropped.has(i));
}

function inoutRoots(body: readonly Stmt[], m: ModuleDecl, out: Set<string>): void {
  const params = new Map(m.funcs.map((f) => [f.name, f.params]));
  const walk = (s: Stmt): void =>
    eachStmtExpr(
      s,
      (e) =>
        eachExpr(e, (x) => {
          if (x.op !== 'call') return;
          const ps = params.get(x.fn);
          x.args.forEach((arg, k) => {
            if (ps?.[k]?.mode === 'inout') {
              const root = targetRoot(arg);
              if (root !== undefined) out.add(root);
            }
          });
        }),
      walk,
    );
  for (const s of body) walk(s);
}

function promote(
  body: readonly Stmt[],
  frozen: (name: string) => boolean,
  holdsRuntimeValue: (init: Expr) => boolean,
): readonly Stmt[] {
  const letOf = (s: Stmt): Stmt => {
    if (s.s === 'if')
      return {
        ...s,
        arms: s.arms.map((a) => ({ ...a, body: promote(a.body, frozen, holdsRuntimeValue) })),
        elseBody: s.elseBody && promote(s.elseBody, frozen, holdsRuntimeValue),
      };
    if (s.s === 'for') return { ...s, body: promote(s.body, frozen, holdsRuntimeValue) };
    if (s.s === 'switch')
      return {
        ...s,
        cases: s.cases.map((c) => ({ ...c, body: promote(c.body, frozen, holdsRuntimeValue) })),
        defaultBody: s.defaultBody && promote(s.defaultBody, frozen, holdsRuntimeValue),
      };
    if (
      s.s === 'var' &&
      s.init !== undefined &&
      valueKinds.has(s.type.kind) &&
      typeEq(s.type, s.init.type) &&
      holdsRuntimeValue(s.init) &&
      frozen(s.name)
    ) {
      return { s: 'let', name: s.name, expr: s.init, span: s.span };
    }
    return s;
  };
  return body.map(letOf);
}

function convert(f: FuncDecl, m: ModuleDecl, writes: FnWrites, reads: FnReads): FuncDecl {
  const dropped = dropDeadInits(f.body, writes, reads);
  const mutated = new Set<string>();
  collectMutatedRoots(dropped, mutated, writes);
  inoutRoots(dropped, m, mutated);
  const userFns = new Set(m.funcs.map((g) => g.name));
  const holdsRuntimeValue = (init: Expr): boolean => {
    let runtime = false;
    eachExpr(init, (x) => {
      const leaf =
        x.op === 'varref' ||
        x.op === 'param' ||
        x.op === 'externref' ||
        x.op === 'overrideref' ||
        (x.op === 'call' && userFns.has(x.fn));
      if (leaf) runtime = true;
    });
    return runtime;
  };
  return { ...f, body: promote(dropped, (name) => !mutated.has(name), holdsRuntimeValue) };
}

let promoting = true;

export function setVarToLet(on: boolean): void {
  promoting = on;
}

export function varToLet(m: ModuleDecl): ModuleDecl {
  if (!promoting) return m;
  const writes = fnWrites(m);
  const reads = fnReads(m);
  return {
    ...m,
    funcs: m.funcs.map((f) => (bodyHasRaw(f.body) ? f : convert(f, m, writes, reads))),
  };
}
