import ts from 'typescript';
import { TS_CODES, type TsCode } from '../../codes.js';
import { declarationOf } from '../closures.js';
import { makeDiagnostic } from '../../diagnostic.js';
import { membersNamed } from '../../source-types.js';
import type { TsCompilerDiagnostic } from '../../source-file.js';

export const ARRAY_CONSTRUCTORS: readonly string[] = ['Array', 'Float32Array'];

const unparen = (e: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(e) ? unparen(e.expression) : e;

const short = (node: ts.Node): string => {
  const text = node.getText().replace(/\s+/g, ' ');
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
};

function namesLibrary(e: ts.Expression, name: string): e is ts.Identifier {
  const x = unparen(e);
  return ts.isIdentifier(x) && x.text === name && declarationOf(x) === undefined;
}

export interface FillForm {
  readonly call: ts.CallExpression;
  readonly made: ts.NewExpression;
  readonly length: ts.Expression;
}

export interface FromForm {
  readonly call: ts.CallExpression;
}

export function fillFormOf(call: ts.CallExpression): FillForm | undefined {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'fill') return undefined;
  const made = unparen(callee.expression);
  if (!ts.isNewExpression(made) || !namesLibrary(made.expression, 'Array')) return undefined;
  const length = made.arguments?.length === 1 ? made.arguments[0] : undefined;
  return length === undefined ? undefined : { call, made, length };
}

export function fromFormOf(call: ts.CallExpression): FromForm | undefined {
  const callee = call.expression;
  return ts.isPropertyAccessExpression(callee) &&
    callee.name.text === 'from' &&
    namesLibrary(callee.expression, 'Array')
    ? { call }
    : undefined;
}

export function isFloat32ArrayNew(node: ts.NewExpression): boolean {
  return namesLibrary(node.expression, 'Float32Array');
}

function isFilled(made: ts.NewExpression): boolean {
  let at: ts.Node = made;
  while (ts.isParenthesizedExpression(at.parent)) at = at.parent;
  const access = at.parent;
  return (
    ts.isPropertyAccessExpression(access) &&
    access.expression === at &&
    access.name.text === 'fill' &&
    ts.isCallExpression(access.parent) &&
    access.parent.expression === access
  );
}

export function arrayReadAsConstructor(id: ts.Identifier): boolean {
  const p = id.parent;
  return (
    id.text === 'Array' &&
    ts.isPropertyAccessExpression(p) &&
    p.expression === id &&
    ts.isCallExpression(p.parent) &&
    p.parent.expression === p &&
    fromFormOf(p.parent) !== undefined
  );
}

export type NewVerdict =
  'built-here' | { readonly message: string; readonly code: TsCode } | undefined;

export function arrayNewVerdict(node: ts.NewExpression): NewVerdict {
  const count = node.arguments?.length ?? 0;
  if (isFloat32ArrayNew(node)) {
    return count === 1
      ? 'built-here'
      : {
          message:
            `"${short(node)}" is not supported yet: a Float32Array is built here as ` +
            `new Float32Array(N), N zeros of f32, with a constant N.`,
          code: TS_CODES.UNSUPPORTED,
        };
  }
  if (!namesLibrary(node.expression, 'Array') || count !== 1) return undefined;
  if (isFilled(node)) return 'built-here';
  const length = node.arguments![0]!.getText();
  return {
    message:
      `"${short(node)}" makes an array of holes in JavaScript, and a hole is not supported ` +
      `yet. Fill it: new Array(${length}).fill(v).`,
    code: TS_CODES.UNSUPPORTED,
  };
}

export function isArrayConstructorExpression(e: ts.Expression): boolean {
  const x = unparen(e);
  if (ts.isNewExpression(x)) return isFloat32ArrayNew(x);
  return ts.isCallExpression(x) && (fillFormOf(x) !== undefined || fromFormOf(x) !== undefined);
}

export function constructedLength(form: ts.Expression): ts.Expression | undefined {
  const x = unparen(form);
  if (ts.isNewExpression(x)) return x.arguments?.length === 1 ? x.arguments[0] : undefined;
  if (!ts.isCallExpression(x)) return undefined;
  const fill = fillFormOf(x);
  if (fill !== undefined) return fill.length;
  const shape = x.arguments[0];
  if (shape === undefined || !ts.isObjectLiteralExpression(shape)) return undefined;
  if (shape.properties.length !== 1) return undefined;
  const only = shape.properties[0]!;
  if (ts.isPropertyAssignment(only) && only.name.getText() === 'length') return only.initializer;
  if (ts.isShorthandPropertyAssignment(only) && only.name.text === 'length') return only.name;
  return undefined;
}

export { short as shortText, unparen as unparenthesized };

export function fillValueUsed(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'fill') return false;
  if (membersNamed('fill', sourceFile).length > 0) return false;
  let at: ts.Node = call;
  while (ts.isParenthesizedExpression(at.parent)) at = at.parent;
  if (ts.isExpressionStatement(at.parent) || ts.isArrowFunction(at.parent)) return false;
  const receiver = callee.expression;
  diagnostics.push(
    makeDiagnostic(
      sourceFile,
      call,
      `"${short(call)}" gives back the array it fills, and a use of that value is not ` +
        `supported yet. Call it on its own line, then use "${short(receiver)}".`,
      TS_CODES.UNSUPPORTED,
    ),
  );
  return true;
}
