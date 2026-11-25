import { posix } from 'node:path';
import ts from 'typescript';
import type { ShapeContext } from '../types.js';

export const FACADE_SHARE = 0.8;

export const ENTRY_NAMES: readonly string[] = ['index.ts', 'register.ts'];

export type ExemptRule = 'entry name' | 'parent of its module directory' | 'facade';

export const EXEMPT_RULES: readonly ExemptRule[] = [
  'entry name',
  'parent of its module directory',
  'facade',
];

const isListingStatement = (statement: ts.Statement): boolean =>
  ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement);

export function isFacade(source: ts.SourceFile): boolean {
  const total = source.statements.length;
  if (total === 0) return false;
  const listing = source.statements.filter(isListingStatement).length;
  const hasExport = source.statements.some(ts.isExportDeclaration);
  return hasExport && listing / total >= FACADE_SHARE;
}

export const moduleDirectoryOf = (rel: string): string =>
  posix.join(posix.dirname(rel), posix.basename(rel, '.ts'));

export function ownsModuleDirectory(ctx: ShapeContext, rel: string): boolean {
  const directory = moduleDirectoryOf(rel);
  return ctx.product.some((other) => ctx.rel(other).startsWith(`${directory}/`));
}

export function exemptRuleOf(ctx: ShapeContext, source: ts.SourceFile): ExemptRule | undefined {
  const rel = ctx.rel(source);
  if (ENTRY_NAMES.includes(posix.basename(rel))) return 'entry name';
  if (ownsModuleDirectory(ctx, rel)) return 'parent of its module directory';
  if (isFacade(source)) return 'facade';
  return undefined;
}
