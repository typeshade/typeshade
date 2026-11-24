// Implements: Rule 7.10 (docs/language-design.md; traced in reqs/).

import ts from 'typescript';
import type { ShaderType } from '../../core/ir/types.js';
import { typeKey } from '../../core/ir/types.js';
import { optionalAbsence, logicalTypeKey, optionalInner } from './optional/registry.js';
export { usedOptionalDecls, orderedStructDecls, typesOfFunctions } from './optional/order.js';
export {
  optionalWithin,
  refusedOptionalPosition,
  refuseOptionalAt,
  optionalDeclaredType,
  markOmittableField,
  isOmittableField,
} from './optional/positions.js';
export type { OptionalWithin } from './optional/positions.js';
export {
  zeroOfInner,
  absentOf,
  presentOf,
  valueOf,
  presentFlagOf,
  notOf,
} from './optional/values.js';
export type { StructLookup } from './optional/values.js';
export {
  optionalAbsence,
  logicalTypeKey,
  optionalStructName,
  optionalT,
  optionalInner,
  isOptional,
  optionalDeclOf,
  mayBeOptional,
} from './optional/registry.js';
export type { Absence } from './optional/registry.js';

export function isUndefinedLiteral(node: ts.Node): boolean {
  let x: ts.Node = node;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  return ts.isIdentifier(x) && x.text === 'undefined';
}

export function optionalTestOperand(node: ts.BinaryExpression): ts.Expression | undefined {
  const op = node.operatorToken.kind;
  const loose =
    op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken;
  if (
    !loose &&
    op !== ts.SyntaxKind.EqualsEqualsEqualsToken &&
    op !== ts.SyntaxKind.ExclamationEqualsEqualsToken
  ) {
    return undefined;
  }
  const literal = (e: ts.Expression): boolean => {
    let x = e;
    while (ts.isParenthesizedExpression(x)) x = x.expression;
    return isUndefinedLiteral(x) || x.kind === ts.SyntaxKind.NullKeyword;
  };
  return literal(node.right) ? node.left : literal(node.left) ? node.right : undefined;
}

export function writesUndefinedUnion(type: ts.TypeNode | undefined): boolean {
  let t = type;
  while (t !== undefined && ts.isParenthesizedTypeNode(t)) t = t.type;
  return (
    t !== undefined &&
    ts.isUnionTypeNode(t) &&
    t.types.some((m) => m.kind === ts.SyntaxKind.UndefinedKeyword)
  );
}

export function absentRemedyValue(inner: ShaderType, spell: (t: ShaderType) => string): string {
  const k = typeKey(inner);
  if (k === 'f32') return '0.';
  if (k === 'i32' || k === 'u32') return '0';
  if (k === 'bool') return 'false';
  if (inner.kind === 'vec') return `${spell(inner).replace(/<.*$/, '')}()`;
  return `${spell(inner)}()`;
}

export function absentLiteral(node: ts.Expression): 1 | 2 | undefined {
  let x = node;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  return isUndefinedLiteral(x) ? 1 : x.kind === ts.SyntaxKind.NullKeyword ? 2 : undefined;
}

export function presenceTest(name: string, type: ShaderType): string {
  const mask = optionalAbsence(type);
  return `${name} ${mask === 3 ? '!= null' : mask === 2 ? '!== null' : '!== undefined'}`;
}

export function fitsOptional(from: ShaderType, to: ShaderType | undefined): boolean {
  const inner = optionalInner(to);
  if (inner === undefined) return false;
  return (
    logicalTypeKey(optionalInner(from) ?? from) === logicalTypeKey(inner) &&
    ((optionalAbsence(from) ?? 0) & optionalAbsence(to)!) === (optionalAbsence(from) ?? 0)
  );
}
