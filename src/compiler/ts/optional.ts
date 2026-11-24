// Implements: Rule 7.10 (docs/language-design.md; traced in reqs/).

import ts from 'typescript';
import type { Expr, FuncDecl, Stmt, StructDecl } from '../../core/ir/nodes.js';
import { eachExpr, eachStmtExpr } from '../../core/ir/visit.js';
import type { ShaderType } from '../../core/ir/types.js';
import { typeKey } from '../../core/ir/types.js';
import {
  optionalAbsence,
  logicalTypeKey,
  optionalInner,
  optionalDeclOf,
  collectOptionalNames,
} from './optional/registry.js';
export {
  optionalWithin,
  refusedOptionalPosition,
  refuseOptionalAt,
  optionalDeclaredType,
  markOmittableField,
  isOmittableField,
} from './optional/positions.js';
export type { OptionalWithin } from './optional/positions.js';
export {
  zeroOfInner,
  absentOf,
  presentOf,
  valueOf,
  presentFlagOf,
  notOf,
} from './optional/values.js';
export type { StructLookup } from './optional/values.js';
export {
  optionalAbsence,
  logicalTypeKey,
  optionalStructName,
  optionalT,
  optionalInner,
  isOptional,
  optionalDeclOf,
  mayBeOptional,
} from './optional/registry.js';
export type { Absence } from './optional/registry.js';

export function isUndefinedLiteral(node: ts.Node): boolean {
  let x: ts.Node = node;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  return ts.isIdentifier(x) && x.text === 'undefined';
}

export function optionalTestOperand(node: ts.BinaryExpression): ts.Expression | undefined {
  const op = node.operatorToken.kind;
  const loose =
    op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken;
  if (
    !loose &&
    op !== ts.SyntaxKind.EqualsEqualsEqualsToken &&
    op !== ts.SyntaxKind.ExclamationEqualsEqualsToken
  ) {
    return undefined;
  }
  const literal = (e: ts.Expression): boolean => {
    let x = e;
    while (ts.isParenthesizedExpression(x)) x = x.expression;
    return isUndefinedLiteral(x) || x.kind === ts.SyntaxKind.NullKeyword;
  };
  return literal(node.right) ? node.left : literal(node.left) ? node.right : undefined;
}

export function writesUndefinedUnion(type: ts.TypeNode | undefined): boolean {
  let t = type;
  while (t !== undefined && ts.isParenthesizedTypeNode(t)) t = t.type;
  return (
    t !== undefined &&
    ts.isUnionTypeNode(t) &&
    t.types.some((m) => m.kind === ts.SyntaxKind.UndefinedKeyword)
  );
}

export function absentRemedyValue(inner: ShaderType, spell: (t: ShaderType) => string): string {
  const k = typeKey(inner);
  if (k === 'f32') return '0.';
  if (k === 'i32' || k === 'u32') return '0';
  if (k === 'bool') return 'false';
  if (inner.kind === 'vec') return `${spell(inner).replace(/<.*$/, '')}()`;
  return `${spell(inner)}()`;
}

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

export function absentLiteral(node: ts.Expression): 1 | 2 | undefined {
  let x = node;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  return isUndefinedLiteral(x) ? 1 : x.kind === ts.SyntaxKind.NullKeyword ? 2 : undefined;
}

export function presenceTest(name: string, type: ShaderType): string {
  const mask = optionalAbsence(type);
  return `${name} ${mask === 3 ? '!= null' : mask === 2 ? '!== null' : '!== undefined'}`;
}

export function fitsOptional(from: ShaderType, to: ShaderType | undefined): boolean {
  const inner = optionalInner(to);
  if (inner === undefined) return false;
  return (
    logicalTypeKey(optionalInner(from) ?? from) === logicalTypeKey(inner) &&
    ((optionalAbsence(from) ?? 0) & optionalAbsence(to)!) === (optionalAbsence(from) ?? 0)
  );
}
