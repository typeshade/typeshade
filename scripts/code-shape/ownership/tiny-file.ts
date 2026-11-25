import ts from 'typescript';
import { importEdges } from '../imports.js';
import type { Finding, ShapeContext } from '../types.js';

export const TINY_FILE_LINES = 12;

export interface TinyFile {
  file: ts.SourceFile;
  lines: number;
  declaration: string;
  line: number;
  importers: string[];
}

function declarationName(statement: ts.Statement): string | undefined {
  if (ts.isVariableStatement(statement)) {
    const [first] = statement.declarationList.declarations;
    return first !== undefined && ts.isIdentifier(first.name) ? first.name.text : undefined;
  }
  const named =
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement);
  return named ? statement.name?.text : undefined;
}

const isPlumbing = (statement: ts.Statement): boolean =>
  ts.isImportDeclaration(statement) ||
  ts.isExportDeclaration(statement) ||
  ts.isExportAssignment(statement);

const lineCount = (source: ts.SourceFile): number =>
  source.text.replace(/\n$/, '').split('\n').length;

function importersByFile(ctx: ShapeContext): Map<ts.SourceFile, Set<string>> {
  const map = new Map<ts.SourceFile, Set<string>>();
  for (const from of ctx.all) {
    for (const edge of importEdges(ctx.checker, from)) {
      if (edge.target === from) continue;
      const set = map.get(edge.target) ?? new Set<string>();
      set.add(ctx.rel(from));
      map.set(edge.target, set);
    }
  }
  return map;
}

export function tinyFiles(ctx: ShapeContext): TinyFile[] {
  const importers = importersByFile(ctx);
  const found: TinyFile[] = [];
  for (const file of ctx.analysed) {
    const lines = lineCount(file);
    if (lines > TINY_FILE_LINES || ctx.rel(file).endsWith('/index.ts')) continue;
    const [only, ...rest] = file.statements.filter((statement) => !isPlumbing(statement));
    const name = only === undefined ? undefined : declarationName(only);
    if (only === undefined || rest.length > 0 || name === undefined) continue;
    found.push({
      file,
      lines,
      declaration: name,
      line: file.getLineAndCharacterOfPosition(only.getStart(file)).line + 1,
      importers: [...(importers.get(file) ?? [])].sort(),
    });
  }
  return found;
}

export function tinyFileFindings(ctx: ShapeContext): Finding[] {
  return tinyFiles(ctx)
    .filter((entry) => entry.importers.length === 1)
    .map((entry) => ({
      signal: 'ownership',
      file: ctx.rel(entry.file),
      line: entry.line,
      kind: 'tiny-file',
      evidence: {
        lines: entry.lines,
        declaration: entry.declaration,
        importer: entry.importers[0]!,
      },
      remedy: 'give the rule to its owner',
    }));
}
