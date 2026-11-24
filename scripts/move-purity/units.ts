import { createHash } from 'node:crypto';
import ts from 'typescript';

export interface Unit {
  readonly hash: string;
  readonly path: string;
  readonly line: number;
  readonly index: number;
  readonly names: readonly string[];
  readonly exported: boolean;
}

const isModuleLink = (statement: ts.Statement): boolean =>
  ts.isImportDeclaration(statement) ||
  ts.isImportEqualsDeclaration(statement) ||
  ts.isExportDeclaration(statement);

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

function unitOf(
  source: ts.SourceFile,
  text: string,
  statement: ts.Statement,
  from: number,
  to: number,
  index: number,
): Unit {
  const keyword = plainExportKeyword(statement);
  let body = text.slice(from, to);
  if (keyword) {
    const keywordStart = keyword.getStart(source);
    let keywordEnd = keyword.end;
    while (/\s/.test(text[keywordEnd] ?? '')) keywordEnd += 1;
    body = text.slice(from, keywordStart) + text.slice(keywordEnd, to);
  }
  const identity = body.replace(/^(?:[ \t]*\n)+/, '').trimEnd();
  return {
    hash: createHash('sha256').update(identity).digest('hex'),
    path: source.fileName,
    line: source.getLineAndCharacterOfPosition(statement.getStart(source)).line + 1,
    index,
    names: declaredNames(statement),
    exported: keyword !== undefined,
  };
}

export interface SourceAnalysis {
  readonly units: Unit[];
  readonly directives: string[];
}

const directiveOf = (statement: ts.Statement): string | undefined =>
  ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)
    ? statement.expression.text
    : undefined;

export function analyzeSource(path: string, rawText: string): SourceAnalysis {
  const text = normalizeLineEndings(rawText);
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const units: Unit[] = [];
  const directives: string[] = [];
  let inPrologue = true;
  let from = 0;
  for (const statement of source.statements) {
    const directive = inPrologue ? directiveOf(statement) : undefined;
    if (directive === undefined) inPrologue = false;
    else directives.push(directive);
    const trailing = ts.getTrailingCommentRanges(text, statement.end);
    const to = trailing?.length ? trailing[trailing.length - 1]!.end : statement.end;
    if (directive === undefined && !isModuleLink(statement))
      units.push(unitOf(source, text, statement, from, to, units.length));
    from = to;
  }
  return { units, directives };
}
