import type { Expr, FuncDecl, Stmt, StructDecl } from '../../../core/ir/nodes.js';
import { eachExpr, eachStmtExpr } from '../../../core/ir/visit.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { optionalInner, optionalDeclOf, collectOptionalNames } from './registry.js';

export function usedOptionalDecls(types: Iterable<ShaderType>): StructDecl[] {
  const names = new Set<string>();
  for (const t of types) collectOptionalNames(t, names);
  return [...names].map((n) => optionalDeclOf(n)).filter((d): d is StructDecl => d !== undefined);
}

function structNamesOf(t: ShaderType, out: Set<string> = new Set()): Set<string> {
  if (t.kind === 'struct') out.add(t.name);
  else if (t.kind === 'array') structNamesOf(t.elem, out);
  return out;
}

export function orderedStructDecls<S extends { readonly decl: StructDecl }>(
  declared: readonly S[],
  optionals: readonly StructDecl[],
  wrap: (decl: StructDecl) => S,
): S[] {
  const out: S[] = [];
  const placed = new Set<string>();
  const declaredNames = new Set(declared.map((s) => s.decl.name));
  const optional = new Map(optionals.map((d) => [d.name, d]));
  const waiting = new Map<string, StructDecl[]>();
  const place = (name: string): void => {
    const decl = optional.get(name);
    if (decl === undefined || placed.has(name)) return;
    const inner = optionalInner({ kind: 'struct', name })!;
    for (const dep of structNamesOf(inner)) {
      if (declaredNames.has(dep) && !placed.has(dep)) {
        const list = waiting.get(dep) ?? [];
        if (!list.includes(decl)) list.push(decl);
        waiting.set(dep, list);
        return;
      }
    }
    placed.add(name);
    out.push(wrap(decl));
  };
  for (const s of declared) {
    const held = new Set<string>();
    for (const f of s.decl.fields) collectOptionalNames(f.type, held);
    for (const name of held) place(name);
    placed.add(s.decl.name);
    out.push(s);
    for (const d of waiting.get(s.decl.name) ?? []) place(d.name);
    waiting.delete(s.decl.name);
  }
  for (const d of optionals) place(d.name);
  for (const list of waiting.values())
    for (const d of list)
      if (!placed.has(d.name)) {
        placed.add(d.name);
        out.push(wrap(d));
      }
  return out;
}

export function typesOfFunctions(funcs: readonly FuncDecl[]): ShaderType[] {
  const out: ShaderType[] = [];
  const visitExpr = (e: Expr): void => eachExpr(e, (x) => out.push(x.type));
  const visitStmt = (s: Stmt): void => {
    if (s.s === 'var') out.push(s.type);
    eachStmtExpr(s, visitExpr, visitStmt);
  };
  for (const f of funcs) {
    for (const p of f.params) out.push(p.type);
    out.push(f.ret);
    for (const st of f.body) visitStmt(st);
  }
  return out;
}
