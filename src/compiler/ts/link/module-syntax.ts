import ts from 'typescript';
import { findUseTypeshadeDirective, isUseTypeshadeDirective } from '../directive.js';

export function hasModuleReference(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(
    (s) =>
      ts.isImportDeclaration(s) ||
      (ts.isExportDeclaration(s) && s.moduleSpecifier !== undefined) ||
      (ts.isImportEqualsDeclaration(s) && ts.isExternalModuleReference(s.moduleReference)),
  );
}

export function beginsWithDirective(fileName: string, text: string): boolean {
  const probe = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );
  return findUseTypeshadeDirective(probe) !== undefined;
}

export function pureAliasSpecifier(sf: ts.SourceFile): string | undefined {
  const [directive, star] = sf.statements;
  return sf.statements.length === 2 &&
    directive !== undefined &&
    isUseTypeshadeDirective(directive) &&
    star !== undefined &&
    ts.isExportDeclaration(star) &&
    !star.isTypeOnly &&
    star.exportClause === undefined &&
    star.attributes === undefined &&
    star.assertClause === undefined &&
    star.moduleSpecifier !== undefined &&
    ts.isStringLiteral(star.moduleSpecifier)
    ? star.moduleSpecifier.text
    : undefined;
}
