import ts from 'typescript';

export const isStaticMember = (node: ts.Node): boolean =>
  (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some(
    (m) => m.kind === ts.SyntaxKind.StaticKeyword,
  ) ?? false;

export const isReadonlyMember = (node: ts.Node): boolean =>
  (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some(
    (m) => m.kind === ts.SyntaxKind.ReadonlyKeyword,
  ) ?? false;

export type KeywordAccess = 'private' | 'protected';

export function keywordAccessOf(node: ts.Node): KeywordAccess | undefined {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  if (mods?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword)) return 'private';
  if (mods?.some((m) => m.kind === ts.SyntaxKind.ProtectedKeyword)) return 'protected';
  return undefined;
}
