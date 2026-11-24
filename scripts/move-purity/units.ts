import { createHash } from 'node:crypto';
import ts from 'typescript';
import { textWithoutKnownEdges, LAYER_POLICY_PATH } from './known-edges.js';

export interface Unit {
  readonly hash: string;
  readonly path: string;
  readonly line: number;
  readonly index: number;
  readonly names: readonly string[];
  readonly exported: boolean;
  readonly node: ts.Statement;
  readonly from: number;
  readonly to: number;
}

export interface SourceAnalysis {
  readonly units: Unit[];
  readonly directives: string[];
  readonly bom: boolean;
  readonly shebang: string | undefined;
  readonly byNode: Map<ts.Node, Unit>;
}

export const isModuleLink = (statement: ts.Statement): boolean =>
  ts.isImportDeclaration(statement) ||
  (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined) ||
  (ts.isImportEqualsDeclaration(statement) &&
    ts.isExternalModuleReference(statement.moduleReference));

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
  );
}

export function declaredNames(statement: ts.Statement): string[] {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((d) => bindingNames(d.name));
  }
  if (ts.isExportDeclaration(statement)) {
    const clause = statement.exportClause;
    return clause && ts.isNamedExports(clause) ? clause.elements.map((e) => e.name.text) : [];
  }
  if (ts.isExportAssignment(statement)) return [statement.isExportEquals ? 'export=' : 'default'];
  const name = 'name' in statement ? (statement.name as ts.Node | undefined) : undefined;
  if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) return [name.text];
  return [];
}

function plainExportKeyword(statement: ts.Statement): ts.Modifier | undefined {
  const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
  if (modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) return undefined;
  return modifiers?.find((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

const directiveOf = (statement: ts.Statement): string | undefined =>
  ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)
    ? statement.expression.text
    : undefined;

function unitOf(
  source: ts.SourceFile,
  path: string,
  statement: ts.Statement,
  from: number,
  to: number,
  index: number,
): Unit {
  const text = source.text;
  const keyword = plainExportKeyword(statement);
  let body =
    (path === LAYER_POLICY_PATH ? textWithoutKnownEdges(source, statement, from, to) : undefined) ??
    text.slice(from, to);
  if (keyword) {
    const keywordStart = keyword.getStart(source);
    let keywordEnd = keyword.end;
    while (/\s/.test(text[keywordEnd] ?? '')) keywordEnd += 1;
    body = text.slice(from, keywordStart) + text.slice(keywordEnd, to);
  }
  const identity = normalizeLineEndings(body)
    .replace(/^(?:[ \t]*\n)+/, '')
    .trimEnd();
  return {
    hash: createHash('sha256').update(identity).digest('hex'),
    path,
    line: source.getLineAndCharacterOfPosition(statement.getStart(source)).line + 1,
    index,
    names: declaredNames(statement),
    exported: keyword !== undefined,
    node: statement,
    from,
    to,
  };
}

const analyses = new WeakMap<ts.SourceFile, SourceAnalysis>();

export function analyzeSource(source: ts.SourceFile, path: string): SourceAnalysis {
  const cached = analyses.get(source);
  if (cached) return cached;
  const text = source.text;
  const bom = text.startsWith('﻿');
  let from = bom ? 1 : 0;
  let shebang: string | undefined;
  if (text.startsWith('#!', from)) {
    const end = text.indexOf('\n', from);
    const stop = end < 0 ? text.length : end;
    shebang = text.slice(from, stop).replace(/\r$/, '');
    from = stop;
  }
  const units: Unit[] = [];
  const directives: string[] = [];
  const byNode = new Map<ts.Node, Unit>();
  let inPrologue = true;
  for (const statement of source.statements) {
    const directive = inPrologue ? directiveOf(statement) : undefined;
    if (directive === undefined) inPrologue = false;
    else directives.push(directive);
    const trailing = ts.getTrailingCommentRanges(text, statement.end);
    const to = trailing?.length ? trailing[trailing.length - 1]!.end : statement.end;
    if (directive === undefined && !isModuleLink(statement)) {
      const unit = unitOf(source, path, statement, from, to, units.length);
      units.push(unit);
      byNode.set(statement, unit);
    }
    from = to;
  }
  const analysis = { units, directives, bom, shebang, byNode };
  analyses.set(source, analysis);
  return analysis;
}
