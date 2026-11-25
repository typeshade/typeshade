import ts from 'typescript';
import type { CompileTsSourceResult } from '../../compiler/ts/source-file.js';
import type { DeclaredSymbol } from '../../compiler/ts/symbols.js';
import { nodeAt } from './node-at.js';
import type { HoverProgram, HoverPrograms } from './types.js';
import { typesOf } from './spell-type.js';

interface OneSymbol {
  readonly symbol: DeclaredSymbol;
  readonly oneOwner: boolean;
}

export function oneOf(at: readonly DeclaredSymbol[], field: boolean): OneSymbol | undefined {
  const ofKind = at.filter((s) => (s.kind === 'field') === field);
  const among = ofKind.length > 0 ? ofKind : at;
  const first = among[0];
  if (first === undefined) return undefined;
  if (!among.every((s) => s.kind === first.kind && typesOf(s) === typesOf(first))) return undefined;
  return { symbol: first, oneOwner: among.every((s) => s.struct === first.struct) };
}

export function declaredSymbolAt(
  analysis: CompileTsSourceResult,
  uri: string,
  defs: readonly ts.DefinitionInfo[],
  field: boolean,
): OneSymbol | undefined {
  for (const def of defs) {
    if (def.fileName !== uri) continue;
    const at = analysis.symbols.filter((s) => s.start === def.textSpan.start);
    if (at.length > 0) return oneOf(at, field);
  }
  return undefined;
}

export interface ImportedSymbol extends OneSymbol {
  readonly sourceFile: ts.SourceFile;
  readonly start: number;
  readonly moduleVar: boolean;
  readonly program: HoverProgram;
  readonly binding: CompileTsSourceResult['bindings'][number] | undefined;
}

export function readsFromCompiler(kind: DeclaredSymbol['kind'], name: ts.Node): boolean {
  const decl = name.parent;
  if (kind === 'field') return true;
  if (kind === 'function') return ts.isFunctionDeclaration(decl) && ts.isSourceFile(decl.parent);
  if (kind === 'const' || kind === 'binding' || kind === 'override')
    return (
      ts.isVariableDeclaration(decl) &&
      ts.isVariableDeclarationList(decl.parent) &&
      ts.isVariableStatement(decl.parent.parent) &&
      ts.isSourceFile(decl.parent.parent.parent)
    );
  return false;
}

export function unlinkedSymbolAt(
  defs: readonly ts.DefinitionInfo[],
  uri: string,
  programs: HoverPrograms,
  sourceFileOf: (fileName: string) => ts.SourceFile | undefined,
  field: boolean,
): ImportedSymbol | undefined {
  for (const def of defs) {
    if (def.fileName === uri) continue;
    const declaring = programs.of(def.fileName);
    const sourceFile = sourceFileOf(def.fileName);
    if (declaring === undefined || sourceFile === undefined) continue;
    const one = declaredSymbolAt(declaring.analysis, def.fileName, [def], field);
    const name = nodeAt(sourceFile, def.textSpan.start);
    if (one === undefined || name === undefined || !ts.isIdentifier(name)) continue;
    const { symbol } = one;
    return {
      ...one,
      sourceFile,
      start: def.textSpan.start,
      moduleVar: declaring.analysis.vars.some((v) => v.name === symbol.name),
      program: declaring,
      binding: undefined,
    };
  }
  return undefined;
}

export function implementationsOf(
  defs: readonly ts.DefinitionInfo[],
  sourceFileOf: (fileName: string) => ts.SourceFile | undefined,
): readonly ts.DefinitionInfo[] {
  return defs.map((def) => {
    const sourceFile = sourceFileOf(def.fileName);
    const name = sourceFile && nodeAt(sourceFile, def.textSpan.start);
    const decl = name?.parent;
    if (
      name === undefined ||
      !ts.isIdentifier(name) ||
      decl === undefined ||
      !ts.isFunctionDeclaration(decl) ||
      decl.body !== undefined
    )
      return def;
    const container = decl.parent;
    const statements: readonly ts.Statement[] =
      ts.isSourceFile(container) || ts.isModuleBlock(container) ? container.statements : [];
    const body = statements
      .filter(ts.isFunctionDeclaration)
      .find((st) => st.body !== undefined && st.name?.text === name.text);
    if (body?.name === undefined) return def;
    const start = body.name.getStart(sourceFile);
    return { ...def, textSpan: { start, length: body.name.getWidth(sourceFile) } };
  });
}
