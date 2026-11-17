import ts from 'typescript';
import type { ShaderType } from '../../../../core/ir/types.js';
import { TS_CODES } from '../../codes.js';
import { inferFrom, typeSuffix } from '../../generics.js';
import type { TsCompilerDiagnostic } from '../../source-file.js';
import { mapTsTypeToShaderType } from '../../type-map.js';
import { functionTypeOf } from '../function-types.js';
import { pushDiag } from '../function.js';

export function arrayLengthParameters(decl: ts.FunctionDeclaration): ts.TypeParameterDeclaration[] {
  const used = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isTypeReferenceNode(node) &&
      ts.isIdentifier(node.typeName) &&
      node.typeName.text === 'array'
    ) {
      const length = node.typeArguments?.[1];
      if (
        length !== undefined &&
        ts.isTypeReferenceNode(length) &&
        ts.isIdentifier(length.typeName)
      )
        used.add(length.typeName.text);
    }
    ts.forEachChild(node, visit);
  };
  for (const parameter of decl.parameters) if (parameter.type !== undefined) visit(parameter.type);
  if (decl.type !== undefined) visit(decl.type);
  return decl.typeParameters?.filter((parameter) => used.has(parameter.name.text)) ?? [];
}

export function typeArgumentsFor(
  decl: ts.FunctionDeclaration,
  order: readonly string[],
  node: ts.CallExpression,
  argTypes: readonly (ShaderType | undefined)[],
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  named: ReadonlyMap<
    number,
    { readonly params: readonly ShaderType[]; readonly ret: ShaderType }
  > = new Map(),
): Map<string, ShaderType> | undefined {
  if (order.length === 0) return new Map();
  const shown = decl.name?.text ?? 'this function';
  const out = new Map<string, ShaderType>();
  const written = node.typeArguments ?? [];
  if (written.length > 0) {
    if (written.length !== order.length) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"${shown}" takes ${String(order.length)} type argument(s), got ${String(written.length)}.`,
        TS_CODES.ARITY_MISMATCH,
      );
      return undefined;
    }
    for (const [i, typeNode] of written.entries()) {
      const mapped = mapTsTypeToShaderType(typeNode, sourceFile, diagnostics);
      if (!mapped) return undefined;
      out.set(order[i]!, mapped);
    }
    return out;
  }
  const names = new Set(order);
  for (const [i, p] of decl.parameters.entries()) {
    const fnType = functionTypeOf(p.type);
    const handed = named.get(i);
    if (fnType !== undefined) {
      if (handed === undefined) continue;
      fnType.parameters.forEach((fp, j) => {
        const actual = handed.params[j];
        if (fp.type !== undefined && actual !== undefined) inferFrom(fp.type, actual, names, out);
      });
      if (fnType.type.kind !== ts.SyntaxKind.VoidKeyword) {
        inferFrom(fnType.type, handed.ret, names, out);
      }
      continue;
    }
    const actual = argTypes[i];
    if (p.type === undefined || actual === undefined) continue;
    inferFrom(p.type, actual, names, out);
  }
  const missing = order.filter((n) => !out.has(n));
  if (missing.length > 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `This call does not say what ${missing.map((n) => `"${n}"`).join(' and ')} ` +
        `${missing.length === 1 ? 'is' : 'are'} in "${shown}". A type argument is read off an ` +
        `argument whose parameter is written as it, or as array<it, N>; write it instead, as ` +
        `"${shown}<${order.map((n) => (out.get(n) === undefined ? 'f32' : typeSuffix(out.get(n)!))).join(', ')}>(…)".`,
      TS_CODES.UNKNOWN_TYPE,
    );
    return undefined;
  }
  return out;
}
