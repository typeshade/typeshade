import ts from 'typescript';
import type { ShaderType } from '../../../../core/ir/types.js';
import { f32T } from '../../../../core/ir/types.js';
import { isIntegerLiteralTree } from '../../lit-coerce.js';
import { mapTsTypeToShaderType } from '../../type-map.js';
import { constructedLength, fillFormOf, unparenthesized } from './form.js';

function moduleConstInitializer(
  name: string,
  sourceFile: ts.SourceFile,
): ts.Expression | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
    for (const d of statement.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === name) return d.initializer;
    }
  }
  return undefined;
}

function writtenLength(e: ts.Expression, sourceFile: ts.SourceFile): number | undefined {
  const x = unparenthesized(e);
  if (ts.isNumericLiteral(x)) return Number(x.text);
  if (!ts.isIdentifier(x)) return undefined;
  const init = moduleConstInitializer(x.text, sourceFile);
  return init !== undefined && ts.isNumericLiteral(unparenthesized(init))
    ? Number((unparenthesized(init) as ts.NumericLiteral).text)
    : undefined;
}

function fromElement(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  elementOf: (e: ts.Expression, sourceFile: ts.SourceFile) => ShaderType | undefined,
): ShaderType | undefined {
  const fn = call.arguments[1] === undefined ? undefined : unparenthesized(call.arguments[1]);
  if (fn === undefined || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)))
    return undefined;
  if (fn.type !== undefined) return mapTsTypeToShaderType(fn.type, sourceFile, undefined);
  return ts.isBlock(fn.body) ? undefined : elementOf(fn.body, sourceFile);
}

export function constructedArrayType(
  e: ts.Expression,
  sourceFile: ts.SourceFile,
  elementOf: (e: ts.Expression, sourceFile: ts.SourceFile) => ShaderType | undefined,
): ShaderType | undefined {
  const length = constructedLength(e);
  const n = length === undefined ? undefined : writtenLength(length, sourceFile);
  if (n === undefined || !Number.isInteger(n) || n < 1) return undefined;
  const x = unparenthesized(e);
  let elem: ShaderType | undefined;
  if (ts.isNewExpression(x)) elem = f32T;
  else if (ts.isCallExpression(x) && fillFormOf(x) !== undefined) {
    const value = x.arguments[0];
    elem =
      value === undefined || isIntegerLiteralTree(value) ? undefined : elementOf(value, sourceFile);
  } else if (ts.isCallExpression(x)) elem = fromElement(x, sourceFile, elementOf);
  return elem === undefined ? undefined : { kind: 'array', elem, size: n };
}

export { isArrayConstructorExpression as isArrayConstructor } from './form.js';
