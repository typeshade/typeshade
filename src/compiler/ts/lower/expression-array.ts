import ts from 'typescript';
import { peekingReads } from '../abstract-const.js';
import { logicalTypeKey as typeKey } from '../optional.js';
import type { Expr, FuncDecl } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { authorTypeText, type LoweringScope } from '../context.js';
import { fillArray, unrollMinMax, unrollZip } from '../array-ops.js';
import { mapTsTypeToShaderType } from '../type-map.js';
import { constructorCallbackMessage, isValueConstructor } from './constructors.js';
import { lowerExpression } from './expression.js';
import { makeDiagnostic } from '../diagnostic.js';
import { TS_CODES, type TsCode } from '../codes.js';
import { captureArguments, namesLocalFunction } from './local-functions.js';
import { nameListSpread } from '../semantic.js';
import type { FunctionShape } from './function-types.js';
import { liftWritten } from './function-args.js';
import { typeArrayElement, zeroOfArrayElement } from './expression-array/element.js';
import { madeDeclarationAt } from './made-array/lower.js';
import { lowerGrown } from './made-array/grown.js';

export function lowerArrayCtor(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const typeArgs = node.typeArguments;
  if (!typeArgs || typeArgs.length < 1) {
    return inferredArray(node, node.arguments, sourceFile, scope, diagnostics);
  }
  const fakeRef = ts.factory.createTypeReferenceNode('array', [...typeArgs]);
  const mapped = mapTsTypeToShaderType(fakeRef, sourceFile, diagnostics);
  if (!mapped || mapped.kind !== 'array') return undefined;
  const n = mapped.size;
  if (node.arguments.length === 0) {
    const written = node.getText(sourceFile);
    if (n === undefined) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `${written} has no zero value: an array with no size lives only in a storage binding, ` +
          `which the host fills. Give it a size: ${written.replace(/\(\)$/, '').replace(/>$/, ', 4>()')}.`,
        TS_CODES.UNSUPPORTED,
      );
      return undefined;
    }
    const zero = zeroOfArrayElement(mapped, scope);
    if (!zero) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `${written} has no zero-value form here: its element ${authorTypeText(mapped.elem)} has ` +
          `no zero literal on this path. Write the ${String(n)} elements out.`,
        TS_CODES.ARITY_MISMATCH,
      );
      return undefined;
    }
    return zero;
  }
  const args: Expr[] = [];
  for (const arg of node.arguments) {
    const lowered = lowerExpression(arg, sourceFile, scope, diagnostics, mapped.elem);
    if (!lowered) return undefined;
    const typed = typeArrayElement(
      arg,
      lowered,
      mapped.elem,
      n,
      args.length,
      sourceFile,
      diagnostics,
    );
    if (!typed) return undefined;
    args.push(typed);
  }
  if (n !== undefined && args.length !== n) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `array constructor expects ${n} element(s), got ${args.length}.`,
      TS_CODES.ARITY_MISMATCH,
    );
    return undefined;
  }
  return { op: 'construct', type: mapped, args };
}

function inferredArray(
  node: ts.Node,
  elements: readonly ts.Expression[],
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (elements.length === 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'array() has no elements to infer from: the element type and the count come from them. ' +
        'Give it elements, or write both out with the values: array<f32, 4>(0., 0., 0., 0.).',
      TS_CODES.UNKNOWN_TYPE,
    );
    return undefined;
  }
  const args: Expr[] = [];
  for (const arg of elements) {
    const lowered = lowerExpression(arg, sourceFile, scope, diagnostics);
    if (!lowered) return undefined;
    args.push(lowered);
  }
  const elem = args[0]!.type;
  const odd = args.findIndex((a) => typeKey(a.type) !== typeKey(elem));
  if (odd > 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      elements[odd]!,
      `array(...) infers one element type from its elements; element 0 is ${authorTypeText(elem)} ` +
        `and element ${odd} is ${authorTypeText(args[odd]!.type)}. Cast the odd one, or write the ` +
        `type out: array<${authorTypeText(elem)}, ${args.length}>(...).`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  return { op: 'construct', type: { kind: 'array', elem, size: args.length }, args };
}

export function lowerInferredBindingArray(
  node: ts.ArrayLiteralExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (refuseListSpread(node, sourceFile, scope, diagnostics)) return undefined;
  for (const element of node.elements) {
    if (ts.isOmittedExpression(element)) {
      pushDiag(
        diagnostics,
        sourceFile,
        element,
        'An array literal element must be a value; a spread or a hole is not supported.',
        TS_CODES.UNSUPPORTED,
      );
      return undefined;
    }
  }
  return inferredArray(node, node.elements, sourceFile, scope, diagnostics);
}

export function lowerArrayLiteral(
  node: ts.ArrayLiteralExpression,
  target: ShaderType,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (target.kind !== 'array') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `An array literal needs a declared array type, got ${authorTypeText(target)}.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  if (target.elem.kind === 'array') {
    // Why: ANGLE refuses an array of arrays in GLSL ES 3.00 ("supported in GLSL ES 3.10 and above
    // only") while Tint accepts the WGSL; both spellings fail the WebGL2 context.
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `array<${authorTypeText(target.elem)}, ${target.size ?? node.elements.length}> is an array of arrays, which the compiler does not flatten yet. Flatten it: one array<${authorTypeText(target.elem.elem)}, N> indexed by row * width + column.`,
      TS_CODES.UNSUPPORTED,
    );
    return undefined;
  }
  if (target.size === undefined) {
    const grown = node.elements.length === 0 ? madeDeclarationAt(node, scope) : undefined;
    if (grown !== undefined)
      return lowerGrown(grown, node, target, { sourceFile, scope, diagnostics });
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `A list needs a fixed size to fill: write the size, e.g. array<${authorTypeText(target.elem)}, ${node.elements.length}>.`,
      TS_CODES.UNKNOWN_TYPE,
    );
    return undefined;
  }
  if (refuseListSpread(node, sourceFile, scope, diagnostics)) return undefined;
  for (const element of node.elements) {
    if (ts.isOmittedExpression(element)) {
      pushDiag(
        diagnostics,
        sourceFile,
        element,
        'An array literal element must be a value; a spread or a hole is not supported.',
        TS_CODES.UNSUPPORTED,
      );
      return undefined;
    }
  }
  if (node.elements.length !== target.size) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `array<${authorTypeText(target.elem)}, ${target.size}> takes ${target.size} element(s), got ${node.elements.length}.`,
      TS_CODES.ARITY_MISMATCH,
    );
    return undefined;
  }
  const args: Expr[] = [];
  for (const [i, element] of node.elements.entries()) {
    if (ts.isArrayLiteralExpression(element)) {
      pushDiag(
        diagnostics,
        sourceFile,
        element,
        `array<${authorTypeText(target.elem)}, ${target.size}> element ${i} must be ${authorTypeText(target.elem)}, and a list is not one.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    const lowered = lowerExpression(element, sourceFile, scope, diagnostics, target.elem);
    if (!lowered) return undefined;
    const typed = typeArrayElement(
      element,
      lowered,
      target.elem,
      target.size,
      i,
      sourceFile,
      diagnostics,
    );
    if (!typed) return undefined;
    args.push(typed);
  }
  return { op: 'construct', type: target, args };
}

export function refuseListSpread(
  node: ts.ArrayLiteralExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  const spreads = node.elements.filter(ts.isSpreadElement);
  for (const spread of spreads) {
    nameListSpread(spread, spreadElements(spread, sourceFile, scope), sourceFile, diagnostics);
  }
  return spreads.length > 0;
}

function spreadElements(
  spread: ts.SpreadElement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
): string | undefined {
  const operand = spread.expression;
  const type = peekingReads(() => lowerExpression(operand, sourceFile, scope, []))?.type;
  const written = operand.getText(sourceFile);
  const shown =
    ts.isIdentifier(operand) ||
    ts.isPropertyAccessExpression(operand) ||
    ts.isElementAccessExpression(operand) ||
    ts.isCallExpression(operand)
      ? written
      : `(${written})`;
  if (type?.kind === 'vec' || type?.kind === 'vec64') {
    return ['x', 'y', 'z', 'w']
      .slice(0, type.n)
      .map((c) => `${shown}.${c}`)
      .join(', ');
  }
  if (type?.kind !== 'array' || type.size === undefined) return undefined;
  const at = (i: number): string => `${shown}[${String(i)}]`;
  const n = type.size;
  const each =
    n <= 4
      ? Array.from({ length: n }, (_, i) => at(i)).join(', ')
      : `${at(0)}, ${at(1)}, …, ${at(n - 1)}`;
  const alone = ts.isArrayLiteralExpression(spread.parent) && spread.parent.elements.length === 1;
  const values = type.elem.kind !== 'struct' && type.elem.kind !== 'array';
  return alone && values ? `${each}, or ${shown}.slice() for a copy of the whole array` : each;
}

export function lowerFill(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const typeArgs = node.typeArguments;
  if (!typeArgs || typeArgs.length < 2) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'fill<T, N>(v) needs type arguments.',
      TS_CODES.UNKNOWN_TYPE,
    );
    return undefined;
  }
  const fakeRef = ts.factory.createTypeReferenceNode('array', [...typeArgs]);
  const mapped = mapTsTypeToShaderType(fakeRef, sourceFile, diagnostics);
  if (!mapped || mapped.kind !== 'array' || mapped.size === undefined) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'fill<T, N>(v) needs a fixed N.',
      TS_CODES.UNKNOWN_TYPE,
    );
    return undefined;
  }
  if (node.arguments.length !== 1) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'fill<T, N>(v) expects 1 value.',
      TS_CODES.ARITY_MISMATCH,
    );
    return undefined;
  }
  const arg = node.arguments[0]!;
  const lowered = lowerExpression(arg, sourceFile, scope, diagnostics, mapped.elem);
  if (!lowered) return undefined;
  const v = typeArrayElement(arg, lowered, mapped.elem, mapped.size, 0, sourceFile, diagnostics);
  if (!v) return undefined;
  return fillArray(mapped.elem, mapped.size, v);
}

export function lowerArrayFold(
  name: string,
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined | 'fallback' {
  if (name === 'min' || name === 'max') {
    if (node.arguments.length !== 1) return 'fallback';
  }
  const args: Expr[] = [];
  const predDecls: FuncDecl[] = [];
  let leading: Expr[] = [];
  for (const arg of node.arguments) {
    if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
      const shape = foldCallbackShape(name, args);
      if (shape !== undefined) {
        const decl = liftWritten(arg, shape, name, scope, sourceFile, diagnostics);
        if (decl === undefined) return undefined;
        const captured = captureArguments(decl, name, arg, sourceFile, scope, diagnostics);
        if (captured === undefined) return undefined;
        predDecls.push(decl);
        leading = captured;
        continue;
      }
    }
    if (ts.isIdentifier(arg)) {
      const decl = scope.resolveCallee(arg.text);
      const local = namesLocalFunction(arg);
      if (decl && !local && isValueConstructor(arg.text)) {
        pushDiag(
          diagnostics,
          sourceFile,
          arg,
          constructorCallbackMessage(arg.text, name),
          TS_CODES.TYPE_MISMATCH,
        );
        return undefined;
      }
      if (decl) {
        const captured = captureArguments(decl, arg.text, arg, sourceFile, scope, diagnostics);
        if (captured === undefined) return undefined;
        if (!scope.calleeReady(decl, arg, sourceFile, diagnostics)) return undefined;
        predDecls.push(decl);
        leading = captured;
        continue;
      }
    }
    const lowered = lowerExpression(arg, sourceFile, scope, diagnostics);
    if (!lowered) return undefined;
    args.push(lowered);
  }
  const first = args[0];
  const asArray = first && first.type.kind === 'array';
  if ((name === 'min' || name === 'max') && asArray && args.length === 1) {
    const out = unrollMinMax(name, first!);
    if (typeof out === 'string') {
      pushDiag(diagnostics, sourceFile, node, out, TS_CODES.TYPE_MISMATCH);
      return undefined;
    }
    return out;
  }
  if (name === 'zip') {
    if (args.length !== 2 || predDecls.length !== 1) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        'zip(xs, ys, fn) needs two arrays and a function.',
        TS_CODES.ARITY_MISMATCH,
      );
      return undefined;
    }
    const out = unrollZip(args[0]!, args[1]!, predDecls[0]!, leading);
    if (typeof out === 'string') {
      pushDiag(diagnostics, sourceFile, node, out, TS_CODES.TYPE_MISMATCH);
      return undefined;
    }
    return out;
  }
  return 'fallback';
}

function foldCallbackShape(name: string, arrays: readonly Expr[]): FunctionShape | undefined {
  const elem = (e: Expr | undefined): ShaderType | undefined =>
    e !== undefined && e.type.kind === 'array' ? e.type.elem : undefined;
  if (name === 'zip') {
    const a = elem(arrays[0]);
    const b = elem(arrays[1]);
    return a === undefined || b === undefined
      ? undefined
      : {
          params: [a, b],
          ret: undefined,
          text: `(a: ${authorTypeText(a)}, b: ${authorTypeText(b)}) => …`,
        };
  }
  return undefined;
}

export function pushDiag(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code));
}
