import ts from 'typescript';
import { writtenMemberName, emittedMemberName } from './member-names.js';
import { isStaticMember } from './member-modifiers.js';

const PRIVATE_STATICS = new WeakMap<ts.SourceFile, ReadonlySet<string>>();

export function privateStaticFields(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const cached = PRIVATE_STATICS.get(sourceFile);
  if (cached !== undefined) return cached;
  const out = new Set<string>();
  const walk = (n: ts.Node): void => {
    if (ts.isClassDeclaration(n) && n.name !== undefined) {
      for (const m of n.members) {
        if (ts.isPropertyDeclaration(m) && isStaticMember(m) && ts.isPrivateIdentifier(m.name)) {
          out.add(`${n.name.text}.${emittedMemberName(m.name.text)}`);
        }
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(sourceFile);
  PRIVATE_STATICS.set(sourceFile, out);
  return out;
}

export function shadowedStaticFields(cls: ts.ClassLikeDeclaration): Set<ts.PropertyDeclaration> {
  const seen = new Set<string>();
  const out = new Set<ts.PropertyDeclaration>();
  for (const m of cls.members) {
    if (!ts.isPropertyDeclaration(m) || !isStaticMember(m)) continue;
    const written = writtenMemberName(m.name);
    if (written === undefined) continue;
    const emitted = emittedMemberName(written);
    if (seen.has(emitted)) out.add(m);
    seen.add(emitted);
  }
  return out;
}

const STATIC_DECLS = new WeakMap<ts.SourceFile, ReadonlyMap<string, ts.PropertyDeclaration>>();

export function staticFieldDeclarations(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, ts.PropertyDeclaration> {
  const cached = STATIC_DECLS.get(sourceFile);
  if (cached !== undefined) return cached;
  const out = new Map<string, ts.PropertyDeclaration>();
  const walk = (n: ts.Node): void => {
    if (ts.isClassDeclaration(n) && n.name !== undefined) {
      for (const m of n.members) {
        if (!ts.isPropertyDeclaration(m) || !isStaticMember(m)) continue;
        const written = writtenMemberName(m.name);
        if (written !== undefined) out.set(`${n.name.text}.${written}`, m);
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(sourceFile);
  STATIC_DECLS.set(sourceFile, out);
  return out;
}
