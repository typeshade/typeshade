import ts from 'typescript';

const K = ts.SyntaxKind;

export const ACCEPTED_STATEMENT_KINDS: readonly ts.SyntaxKind[] = [
  K.ClassDeclaration,
  K.EnumDeclaration,
  K.ExportAssignment,
  K.ExportDeclaration,
  K.FunctionDeclaration,
  K.InterfaceDeclaration,
  K.TypeAliasDeclaration,
  K.VariableStatement,
];

export const ACCEPTED_EXPRESSION_KINDS: readonly ts.SyntaxKind[] = [
  K.ArrayLiteralExpression,
  K.ArrowFunction,
  K.AsExpression,
  K.BigIntLiteral,
  K.BinaryExpression,
  K.CallExpression,
  K.ClassExpression,
  K.ConditionalExpression,
  K.FalseKeyword,
  K.FunctionExpression,
  K.Identifier,
  K.NewExpression,
  K.NoSubstitutionTemplateLiteral,
  K.NonNullExpression,
  K.NullKeyword,
  K.NumericLiteral,
  K.ObjectLiteralExpression,
  K.OmittedExpression,
  K.ParenthesizedExpression,
  K.PrefixUnaryExpression,
  K.PropertyAccessExpression,
  K.RegularExpressionLiteral,
  K.SatisfiesExpression,
  K.StringLiteral,
  K.TemplateExpression,
  K.TrueKeyword,
  K.TypeAssertionExpression,
  K.TypeOfExpression,
  K.VoidExpression,
];

export const ACCEPTED_CLASS_MEMBER_KINDS: readonly ts.SyntaxKind[] = [
  K.Constructor,
  K.GetAccessor,
  K.IndexSignature,
  K.MethodDeclaration,
  K.PropertyDeclaration,
  K.SemicolonClassElement,
  K.SetAccessor,
];

export const ACCEPTED_OBJECT_MEMBER_KINDS: readonly ts.SyntaxKind[] = [
  K.GetAccessor,
  K.MethodDeclaration,
  K.PropertyAssignment,
  K.SetAccessor,
  K.ShorthandPropertyAssignment,
];

export function kindName(kind: ts.SyntaxKind): string {
  const names = Object.keys(ts.SyntaxKind).filter(
    (name) => (ts.SyntaxKind as unknown as Record<string, unknown>)[name] === kind,
  );
  return names.find((name) => !/^(?:First|Last)/.test(name)) ?? names[0]!;
}

export const acceptedKindNames = (kinds: readonly ts.SyntaxKind[]): string[] =>
  kinds.map(kindName).sort();

export const isAccepted = (kinds: readonly ts.SyntaxKind[], node: ts.Node): boolean =>
  kinds.includes(node.kind);
