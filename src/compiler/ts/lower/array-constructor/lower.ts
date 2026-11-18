import ts from 'typescript';
import type { Expr } from '../../../../core/ir/nodes.js';
import type { ShaderType } from '../../../../core/ir/types.js';
import { f32T } from '../../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../../source-file.js';
import type { LoweringScope } from '../../context.js';
import { TS_CODES } from '../../codes.js';
import { fillArray } from '../../array-ops.js';
import { foldConstNumber } from '../../loop-bound.js';
import { isIntegerLiteralTree, retargetDeclaredIntLit } from '../../lit-coerce.js';
import { logicalTypeKey as typeKey } from '../../optional.js';
import { lowerExpression } from '../expression.js';
import { lowerCall } from '../expression-call.js';
import { lowerNew } from '../class-methods.js';
import { push } from '../array-methods.js';
import { isNewObject, isObjectType } from '../../new-object.js';
import {
  fillFormOf,
  fillValueUsed,
  fromFormOf,
  isFloat32ArrayNew,
  shortText,
  type FillForm,
} from './form.js';
import { lowerFrom, repeatedValue } from './from.js';
import { lowerMade, madeDeclarationAt } from '../made-array/lower.js';

export interface Lowering {
  readonly sourceFile: ts.SourceFile;
  readonly scope: LoweringScope;
  readonly diagnostics: TsCompilerDiagnostic[];
}

export function lowerNewOrArray(
  node: ts.NewExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const length = node.arguments?.length === 1 ? node.arguments[0] : undefined;
  if (!isFloat32ArrayNew(node) || length === undefined)
    return lowerNew(node, sourceFile, scope, diagnostics);
  const made = madeDeclarationAt(node, scope);
  if (made !== undefined)
    return lowerMade(made, node, length, undefined, { sourceFile, scope, diagnostics });
  const n = constantLength(node, length, { sourceFile, scope, diagnostics });
  return n === undefined ? undefined : fillArray(f32T, n, { op: 'lit', type: f32T, value: 0 });
}

export function lowerCallOrArray(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  contextual?: ShaderType,
): Expr | undefined {
  const at: Lowering = { sourceFile, scope, diagnostics };
  const fill = fillFormOf(node);
  if (fill !== undefined) return lowerNewFill(fill, at, contextual);
  if (fromFormOf(node) !== undefined) {
    const made = madeDeclarationAt(node, scope);
    return made === undefined
      ? lowerFrom(node, at)
      : lowerMade(made, node, undefined, undefined, at);
  }
  if (fillValueUsed(node, sourceFile, diagnostics)) return undefined;
  return lowerCall(node, sourceFile, scope, diagnostics);
}

export function constantLength(
  form: ts.Node,
  length: ts.Expression,
  { sourceFile, scope, diagnostics }: Lowering,
): number | undefined {
  const written = shortText(form);
  const lowered = lowerExpression(length, sourceFile, scope, diagnostics);
  if (lowered === undefined) return undefined;
  const n = lowered.type.kind === 'scalar' ? foldConstNumber(lowered, scope) : undefined;
  if (n === undefined) {
    return push(
      diagnostics,
      sourceFile,
      length,
      `"${written}" takes its length from "${shortText(length)}", which is no constant, and an ` +
        `array whose length is known only when the shader runs is not supported yet here. ` +
        `Write a constant length: an integer literal or a module constant.`,
      TS_CODES.UNSUPPORTED,
    );
  }
  if (!Number.isInteger(n) || n < 0) {
    return push(
      diagnostics,
      sourceFile,
      length,
      `"${written}" throws a RangeError in JavaScript: its length is ${String(n)}, and a length ` +
        `is a whole number of 0 or more.`,
      TS_CODES.TYPE_MISMATCH,
    );
  }
  if (n === 0) {
    return push(
      diagnostics,
      sourceFile,
      length,
      `"${written}" is an array of length 0, which is not supported yet: a shader array has ` +
        `at least one element.`,
      TS_CODES.UNSUPPORTED,
    );
  }
  return n;
}

function lowerNewFill(
  { call, made, length }: FillForm,
  at: Lowering,
  contextual: ShaderType | undefined,
): Expr | undefined {
  const { sourceFile, scope, diagnostics } = at;
  const shown = `new Array(${shortText(length)}).fill`;
  const args = call.arguments;
  if (args.length !== 1) {
    return push(
      diagnostics,
      sourceFile,
      args.length === 0 ? call : args[1]!,
      args.length === 0
        ? `"${shown}" takes the value to store.`
        : `"${shown}" takes one argument here, the value. The index to start or stop at is not ` +
            `taken in this version.`,
      TS_CODES.ARITY_MISMATCH,
    );
  }
  const madeHere = madeDeclarationAt(call, scope);
  if (madeHere !== undefined) return lowerMade(madeHere, call, length, args[0]!, at);
  const n = constantLength(made, length, at);
  if (n === undefined) return undefined;
  const arg = args[0]!;
  const want = contextual?.kind === 'array' ? contextual.elem : undefined;
  if (want === undefined && isIntegerLiteralTree(arg)) {
    const v = shortText(arg);
    return push(
      diagnostics,
      sourceFile,
      arg,
      `"${shortText(call)}" fills its array with an integer-written number, whose element type ` +
        `its uses will decide; that is not supported yet. Write the element's type: ` +
        `fill(f32(${v})), fill(i32(${v})) or fill(u32(${v})).`,
      TS_CODES.UNSUPPORTED,
    );
  }
  const lowered = lowerExpression(arg, sourceFile, scope, diagnostics, want);
  if (lowered === undefined) return undefined;
  const value = want === undefined ? lowered : retargetDeclaredIntLit(lowered, arg, want);
  const elem = want !== undefined && typeKey(value.type) === typeKey(want) ? want : value.type;
  if (elem.kind === 'void') {
    return push(
      diagnostics,
      sourceFile,
      arg,
      `"${shortText(arg)}" returns nothing, so "${shown}" has no value to store.`,
      TS_CODES.TYPE_MISMATCH,
    );
  }
  if (isObjectType(elem) && !isNewObject(arg, sourceFile)) {
    return push(
      diagnostics,
      sourceFile,
      call,
      `"${shortText(call)}" puts one object in every element, and the elements are then one ` +
        `object. One object under two names is not supported yet (change 0142, stage 3). Build ` +
        `each element in a loop.`,
      TS_CODES.UNSUPPORTED,
    );
  }
  return repeatedValue(elem, n, value, call, at);
}
