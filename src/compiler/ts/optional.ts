// Implements: Rule 7.10 (docs/language-design.md; traced in reqs/).

import ts from 'typescript';
import type { Expr, FuncDecl, Stmt, StructDecl } from '../../core/ir/nodes.js';
import { eachExpr, eachStmtExpr } from '../../core/ir/visit.js';
import type { ShaderType } from '../../core/ir/types.js';
import { typeKey } from '../../core/ir/types.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { makeDiagnostic } from './diagnostic.js';
import { TS_CODES } from './codes.js';
import {
  optionalAbsence,
  logicalTypeKey,
  optionalT,
  optionalInner,
  optionalDeclOf,
  mayBeOptional,
  collectOptionalNames,
  type Absence,
} from './optional/registry.js';
import type { StructLookup } from './optional/values.js';
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

export interface OptionalWithin {
  readonly opt: ShaderType;
  readonly inner: ShaderType;
  readonly path: string;
}

export function optionalWithin(
  t: ShaderType | undefined,
  structs: StructLookup,
  seen: Set<string> = new Set(),
): OptionalWithin | undefined {
  if (t === undefined) return undefined;
  const inner = optionalInner(t);
  if (inner !== undefined) return { opt: t, inner, path: '' };
  if (t.kind === 'array') {
    const w = optionalWithin(t.elem, structs, seen);
    return w === undefined ? undefined : { ...w, path: `[i]${w.path}` };
  }
  if (t.kind === 'struct') {
    if (seen.has(t.name)) return undefined;
    seen.add(t.name);
    for (const f of structs(t.name)?.fields ?? []) {
      const w = optionalWithin(f.type, structs, seen);
      if (w !== undefined) return { ...w, path: `.${f.name}${w.path}` };
    }
  }
  return undefined;
}

// Why: WGSL forbids a `bool` in host-shareable memory, so the remedy names a `u32` flag.
export function refusedOptionalPosition(
  written: string,
  position: string,
  inner: string,
  holder?: { readonly type: string; readonly path: string },
  remedy: (inner: string) => string = (i) => `Carry a u32 flag beside the value, "${i}".`,
): string {
  const subject =
    holder === undefined
      ? `"${written}" holds`
      : `"${holder.type}" holds "${holder.path.replace(/^\./, '')}: ${written}",`;
  return (
    `${subject} a value and a flag saying whether it is there, which a local, a parameter, a ` +
    `function's result, a struct field or an array element may hold; ${position} may not. ` +
    remedy(inner)
  );
}

export function refuseOptionalAt(
  type: ShaderType | undefined,
  node: ts.Node,
  position: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[] | undefined,
  spell: (t: ShaderType) => string,
  structs: StructLookup = () => undefined,
  remedy?: (inner: string) => string,
): boolean {
  const within = optionalWithin(type, structs);
  if (within === undefined) return false;
  const mask = optionalAbsence(within.opt)!;
  const written = `${spell(within.inner)}${mask & 2 ? ' | null' : ''}${mask & 1 ? ' | undefined' : ''}`;
  diagnostics?.push(
    makeDiagnostic(
      sourceFile,
      node,
      refusedOptionalPosition(
        written,
        position,
        spell(within.inner),
        within.path === '' ? undefined : { type: spell(type!), path: within.path },
        remedy,
      ),
      TS_CODES.UNKNOWN_TYPE,
    ),
  );
  return true;
}

export function optionalDeclaredType(
  mapped: ShaderType | undefined,
  questionToken: ts.QuestionToken | undefined,
  subject: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  spell: (t: ShaderType) => string,
): ShaderType | undefined {
  if (mapped === undefined || questionToken === undefined) return mapped;
  const inner = optionalInner(mapped);
  if (inner !== undefined) return optionalT(inner, (optionalAbsence(mapped)! | 1) as Absence);
  if (mayBeOptional(mapped)) return optionalT(mapped);
  const name = spell(mapped);
  diagnostics.push(
    makeDiagnostic(
      sourceFile,
      questionToken,
      `${subject} would hold ${/^[aeiofAEIOF]/.test(name) ? 'an' : 'a'} ${name} and a flag ` +
        `saying whether it is there, and an optional holds what a function-scope struct field ` +
        `may: a scalar, a vector, a matrix, an array with a size or a struct.`,
      TS_CODES.UNKNOWN_TYPE,
    ),
  );
  return undefined;
}

const OMITTABLE = new WeakMap<ts.SourceFile, Set<string>>();

export function markOmittableField(sourceFile: ts.SourceFile, struct: string, field: string): void {
  let set = OMITTABLE.get(sourceFile);
  if (set === undefined) {
    set = new Set();
    OMITTABLE.set(sourceFile, set);
  }
  set.add(`${struct}.${field}`);
}

export function isOmittableField(
  sourceFile: ts.SourceFile,
  struct: string,
  field: string,
): boolean {
  return OMITTABLE.get(sourceFile)?.has(`${struct}.${field}`) ?? false;
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
