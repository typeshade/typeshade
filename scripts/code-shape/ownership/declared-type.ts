import ts from 'typescript';
import type { ShapeContext } from '../types.js';

export interface DeclaredType {
  name: string;
  at: string;
  anonymous: boolean;
  external: boolean;
}

const ANONYMOUS_SYMBOL_NAMES = new Set(['__type', '__object']);

export function lineOf(node: ts.Node): number {
  const source = node.getSourceFile();
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

export function isObjectLike(checker: ts.TypeChecker, type: ts.Type): boolean {
  if (type.isUnionOrIntersection()) return type.types.every((part) => isObjectLike(checker, part));
  if (!(type.flags & ts.TypeFlags.Object)) return false;
  return (
    !checker.isArrayType(type) &&
    !checker.isTupleType(type) &&
    type.getCallSignatures().length === 0
  );
}

export function declaredTypeOf(ctx: ShapeContext, type: ts.Type): DeclaredType | undefined {
  const parts = type.isUnionOrIntersection() ? type.types : [type];
  const symbol =
    type.aliasSymbol ??
    type.getSymbol() ??
    parts.map((part) => part.aliasSymbol ?? part.getSymbol()).find((found) => found !== undefined);
  const declaration = symbol?.declarations?.[0];
  if (symbol === undefined || declaration === undefined) return undefined;
  const anonymous = ANONYMOUS_SYMBOL_NAMES.has(symbol.name);
  const declaredIn = declaration.getSourceFile();
  return {
    external: declaredIn.isDeclarationFile || !ctx.rel(declaredIn).startsWith('src/'),
    name: anonymous ? '(anonymous)' : symbol.name,
    at: `${ctx.rel(declaration.getSourceFile())}:${lineOf(declaration)}`,
    anonymous,
  };
}
