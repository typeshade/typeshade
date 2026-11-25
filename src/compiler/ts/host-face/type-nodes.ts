import ts from 'typescript';

export function isFunctionType(t: ts.TypeNode | undefined, sf: ts.SourceFile): boolean {
  if (t === undefined) return false;
  if (ts.isFunctionTypeNode(t)) return true;
  if (ts.isParenthesizedTypeNode(t)) return isFunctionType(t.type, sf);
  if (ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName)) {
    const name = t.typeName.text;
    for (const s of sf.statements)
      if (ts.isTypeAliasDeclaration(s) && s.name.text === name) return isFunctionType(s.type, sf);
  }
  return false;
}
