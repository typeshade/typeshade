import ts from 'typescript';
import { importEdges } from '../imports.js';
import { isFacade, moduleDirectoryOf } from '../home/exempt.js';
import type { Finding, ShapeContext } from '../types.js';

export const TINY_FILE_LINES = 12;

export interface TinyFile {
  file: ts.SourceFile;
  lines: number;
  declaration: string;
  line: number;
  importers: string[];
  importerIsFacade: boolean;
  importerIsParent: boolean;
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

function importersByFile(ctx: ShapeContext): Map<ts.SourceFile, Set<ts.SourceFile>> {
  const map = new Map<ts.SourceFile, Set<ts.SourceFile>>();
  for (const from of ctx.product) {
    for (const edge of importEdges(ctx.checker, from)) {
      if (edge.target === from) continue;
      const set = map.get(edge.target) ?? new Set<ts.SourceFile>();
      set.add(from);
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
    const sources = [...(importers.get(file) ?? [])].sort((a, b) =>
      ctx.rel(a).localeCompare(ctx.rel(b)),
    );
    const [sole] = sources;
    const soleRel = sole === undefined ? undefined : ctx.rel(sole);
    found.push({
      file,
      lines,
      declaration: name,
      line: file.getLineAndCharacterOfPosition(only.getStart(file)).line + 1,
      importers: sources.map((source) => ctx.rel(source)),
      importerIsFacade: sole !== undefined && isFacade(sole),
      importerIsParent:
        soleRel !== undefined && ctx.rel(file).startsWith(`${moduleDirectoryOf(soleRel)}/`),
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
        importerIsFacade: entry.importerIsFacade,
        importerIsParent: entry.importerIsParent,
      },
      remedy: 'give the rule to its owner',
    }));
}
