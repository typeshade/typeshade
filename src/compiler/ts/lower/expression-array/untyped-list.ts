import ts from 'typescript';
import type { Expr } from '../../../../core/ir/nodes.js';
import type { ShaderType } from '../../../../core/ir/types.js';
import { f32T } from '../../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../../source-file.js';
import { authorTypeText, type LoweringScope } from '../../context.js';
import { peekingReads } from '../../abstract-const.js';
import { isIntegerLiteralTree } from '../../lit-coerce.js';
import { logicalTypeKey as typeKey } from '../../optional.js';
import { TS_CODES } from '../../codes.js';
import { lowerExpression } from '../expression.js';
import { lowerArrayLiteral, pushDiag } from '../expression-array.js';

export interface ListDeclaration {
  readonly said: string;
  readonly head: string;
  readonly at: ts.Node;
}

export interface ListLowering {
  readonly sourceFile: ts.SourceFile;
  readonly scope: LoweringScope;
  readonly diagnostics: TsCompilerDiagnostic[];
}

const NUMERIC_SCALARS = new Set(['f32', 'f64', 'i32', 'u32']);

export function untypedListOf(
  initializer: ts.Expression,
  readonly: boolean,
): ts.ArrayLiteralExpression | undefined {
  if (ts.isArrayLiteralExpression(initializer)) return initializer;
  if (
    readonly &&
    ts.isAsExpression(initializer) &&
    ts.isTypeReferenceNode(initializer.type) &&
    initializer.type.typeName.getText() === 'const' &&
    ts.isArrayLiteralExpression(initializer.expression)
  ) {
    return initializer.expression;
  }
  return undefined;
}

export function lowerUntypedList(
  list: ts.ArrayLiteralExpression,
  declared: ListDeclaration,
  { sourceFile, scope, diagnostics }: ListLowering,
): Expr | undefined {
  const refuse = (message: string): undefined => {
    pushDiag(diagnostics, sourceFile, declared.at, message, TS_CODES.UNKNOWN_TYPE);
    return undefined;
  };
  const count = list.elements.length;
  if (count === 0) {
    return refuse(
      `${declared.said} takes its type and its length from its list, and an empty list has ` +
        `neither: a shader array has at least one element. Write its elements.`,
    );
  }
  const found: (ShaderType | 'integer' | 'hole' | 'refused')[] = [];
  for (const element of list.elements) {
    if (ts.isOmittedExpression(element)) {
      found.push('hole');
      continue;
    }
    const type = peekingReads(() => lowerExpression(element, sourceFile, scope, []))?.type;
    if (type === undefined) lowerExpression(element, sourceFile, scope, diagnostics);
    found.push(type === undefined ? 'refused' : isIntegerLiteralTree(element) ? 'integer' : type);
  }
  if (found.includes('refused')) return undefined;
  const typedAt = found.findIndex((f) => typeof f !== 'string');
  const integerAt = found.indexOf('integer');
  if (typedAt < 0) {
    if (integerAt < 0)
      return lowerArrayLiteral(list, arrayOf(f32T, count), sourceFile, scope, diagnostics);
    return refuse(
      `${declared.said} needs an array type annotation to take a list, e.g. ` +
        `${declared.head}: array<f32, ${String(count)}> = [...].`,
    );
  }
  const elem = found[typedAt] as ShaderType;
  const elemText = authorTypeText(elem);
  const oddAt = found.findIndex((f) => typeof f !== 'string' && typeKey(f) !== typeKey(elem));
  const shared = `${declared.said} takes its type from its list, whose elements must share one type:`;
  if (oddAt >= 0) {
    const odd = authorTypeText(found[oddAt] as ShaderType);
    return refuse(
      `${shared} element ${String(typedAt)} is ${elemText} and element ${String(oddAt)} is ${odd}.`,
    );
  }
  if (integerAt >= 0) {
    const [first, second] =
      integerAt < typedAt
        ? [
            `element ${String(integerAt)} is an integer-written number`,
            `element ${String(typedAt)} is ${elemText}`,
          ]
        : [
            `element ${String(typedAt)} is ${elemText}`,
            `element ${String(integerAt)} is an integer-written number`,
          ];
    const remedy = NUMERIC_SCALARS.has(typeKey(elem))
      ? ` Declare the type: ${declared.head}: array<${elemText}, ${String(count)}> = [...].`
      : '';
    return refuse(`${shared} ${first} and ${second}.${remedy}`);
  }
  return lowerArrayLiteral(list, arrayOf(elem, count), sourceFile, scope, diagnostics);
}

function arrayOf(elem: ShaderType, size: number): ShaderType {
  return { kind: 'array', elem, size };
}
