import ts from 'typescript';
import { isStaticMember } from '../../class-names.js';

export function namedStatics(decl: ts.ClassDeclaration): ts.ClassElement[] {
  return decl.members.filter(
    (m) => isStaticMember(m) && m.name !== undefined && ts.isIdentifier(m.name),
  );
}

export function isStaticsOnly(decl: ts.ClassDeclaration): boolean {
  const instanceField = decl.members.some((m) => ts.isPropertyDeclaration(m) && !isStaticMember(m));
  return !instanceField && namedStatics(decl).length > 0;
}

export function firstStatic(decl: ts.ClassDeclaration): ts.ClassElement | undefined {
  const statics = namedStatics(decl);
  return statics.find(ts.isPropertyDeclaration) ?? statics[0];
}

export function namespaceStaticSentence(shown: string, className: string, member: string): string {
  return (
    `"${shown}" is a class inside a namespace, and a shader does not read the static members ` +
    `of one ("${shown}.${member}"). Declare "${className}" at the top level of the file and ` +
    `use "${className}.${member}".`
  );
}
