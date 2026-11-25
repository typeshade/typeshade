import ts from 'typescript';

export function enclosingClasses(node: ts.Node): ts.ClassLikeDeclaration[] {
  const out: ts.ClassLikeDeclaration[] = [];
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if (ts.isClassDeclaration(at) || ts.isClassExpression(at)) out.push(at);
  }
  return out;
}

export function privateMemberOf(
  cls: ts.ClassLikeDeclaration,
  written: string,
): ts.ClassElement | undefined {
  return cls.members.find(
    (m) => m.name !== undefined && ts.isPrivateIdentifier(m.name) && m.name.text === written,
  );
}

export function privateOwner(
  node: ts.Node,
  written: string,
): { cls: ts.ClassLikeDeclaration; member: ts.ClassElement } | undefined {
  for (const cls of enclosingClasses(node)) {
    const member = privateMemberOf(cls, written);
    if (member !== undefined) return { cls, member };
  }
  return undefined;
}
