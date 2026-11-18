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
    // `array(1., 2., 3.)` INFERS both type arguments from the elements, as WGSL does
    // (wgsl.txt:20133: "the element type and count are inferred"). The elements must agree —
    // an array has one element type — and there must be at least one to read it from.
    return inferredArray(node, node.arguments, sourceFile, scope, diagnostics);
  }
  const fakeRef = ts.factory.createTypeReferenceNode('array', [...typeArgs]);
  const mapped = mapTsTypeToShaderType(fakeRef, sourceFile, diagnostics);
  if (!mapped || mapped.kind !== 'array') return undefined;
  const n = mapped.size;
  // `array<T, N>()` is WGSL's zero value of the array (§17.1.1, change 0047), written out one
  // element at a time as `vec3()` and `matCxR()` are, so every backend and the oracle see an
  // ordinary constructor. An array with no size has no zero value in WGSL.
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
    // `mapped.elem` is the position each element sits in, so an object-literal element knows
    // which struct it builds: `array<A, 2>({ … }, { … })` is two DECLARED positions, spelled
    // in the constructor's own type argument rather than on a variable (#8 A11).
    const lowered = lowerExpression(arg, sourceFile, scope, diagnostics, mapped.elem);
    if (!lowered) return undefined;
    // Each argument takes the element type by the rule the list form uses, so the two
    // spellings stay one program: `array<i32, 3>(1, 2, 3)` emitted `(1.0, 2.0, 3.0)` before
    // this, which neither target accepts, while `array<i32, 3> = [1, 2, 3]` emitted integers.
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

/** `array(e1, e2, …)` with no type arguments (#150): the element type and the count come from
 *  the elements themselves. Refused when they disagree, because an array has ONE element type
 *  and guessing which one the author meant would move the emit of a program silently; the
 *  message names the explicit form, which settles it.
 *
 *  A bare integer literal is left alone here. It lowers to an `f32` on this surface, so
 *  `array(1, 2, 3)` infers `array<f32, 3>` — the same type `const x = 1` gives (Rule 5.1). */
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

/** A list infers an array only as the source of an array binding (change 0086).
 *  Share the constructor's homogeneous element inference and its f32 literal default. */
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

/** `[a, b, c]` written where an `array<T, N>` is declared, e.g.
 *  `const xs: array<f32, 3> = [1., 2., 3.]` (#8 A16). It builds the SAME `construct` node the
 *  `array<f32, 3>(1., 2., 3.)` call builds, so the two spellings are one program — pinned by a
 *  test that compares the two bodies. The list form carries no type of its own, which is why it
 *  is only accepted where one is declared and why `target` is passed in rather than inferred.
 *
 *  Each element is checked against `target`'s element type by {@link typeArrayElement}, the
 *  helper the call form shares. A bare numeric literal is retyped to the element type first — the same retarget the
 *  scalar declaration does for `const x: i32 = 1` — so `array<i32, 3> = [1, 2, 3]` emits
 *  `array<i32, 3>(1, 2, 3)` rather than the float literals an i32 array cannot take. */
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
    // An array OF arrays, refused for the reason `module-const.ts` already refuses one: the
    // GLSL ES 3.00 writer spells the element type inline and ANGLE answers "arrays of arrays
    // supported in GLSL ES 3.10 and above only", while Tint accepts the WGSL. Measured through
    // the compile gate on both spellings of the same program: `[[1., 2.], [3., 4.]]` and
    // `array<array<f32, 2>, 2>(...)` each pass Tint and each fail the WebGL2 context, so
    // accepting the list here would ship a declaration that compiles on one target and not the
    // other. The call form is refused nowhere yet and is a separate gap.
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `array<${authorTypeText(target.elem)}, ${target.size ?? node.elements.length}> is an array of arrays, which GLSL ES 3.00 does not have. Flatten it: one array<${authorTypeText(target.elem.elem)}, N> indexed by row * width + column.`,
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
  // Checked before the count: `[...xs]` is one element syntactically, so counting it first
  // would report an arity the author never wrote.
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
    // A list as an ELEMENT is named here rather than left to the generic "a list is only an
    // initializer" refusal, which reads as if the declaration were missing when it is the
    // element type that does not take one. The only element type that could take a list is
    // another array, and that is refused above, so this arm says which type is wanted.
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

/** `[...a, 3.]`: a spread in a list, which a shader array does not do, since its length is its
 *  type's. semantic.ts refuses each one wherever it is written (TS8013); here, where the operand's
 *  type is known, the sentence is given the elements to write in its place, `a[0], a[1]`. A
 *  position that holds a list asks this first, before the count or the annotation it would
 *  otherwise ask for, so the spread is the list's one sentence (Rule 12.4). Returns whether the
 *  list holds a spread. */
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

/** The elements a spread's operand stands for, as an author writes them: `a[0], a[1]` for a
 *  sized array, `v.x, v.y, v.z` for a vector. Undefined for anything else, a struct, a scalar or
 *  a name nothing declares, which has no elements to name. */
function spreadElements(
  spread: ts.SpreadElement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
): string | undefined {
  const operand = spread.expression;
  // Only its type is read; what the operand itself may be refused for is not this mistake.
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
  // The value takes the element type by the rule `array<T, N>(…)` gives each element (#498):
  // `fill<u32, 4>(0)` emitted four `0.0` into an `array<u32, 4>`, which Tint refuses.
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
  // What each call of the function passes ahead of its own arguments: the variables a local
  // function captures (Rule 8.17).
  let leading: Expr[] = [];
  for (const arg of node.arguments) {
    // An arrow function written as the callback (Rule 8.18): a local function of this body,
    // typed by the arrays before it, `any(xs, (x) => x > k)`.
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
      // A local function or a parameter that takes a function, which the body declares, is
      // what its name means there, whatever builtin shares it (Rule 9.5).
      const local = namesLocalFunction(arg);
      if (decl && !local && isValueConstructor(arg.text)) {
        // The precedence `lowerCall` applies, applied here too (Rule 9.5): a callback follows the
        // call, and a call of a value constructor's name builds the value even when the file
        // declares a function of that name. There is no constructor-valued callback in a fold, so
        // the honest answer is a diagnostic that names the rule; a builtin function's name, which
        // a declaration wins over, hands the declaration over as any other function is.
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
        // What it returns, which its body says when it writes no return type (Rule 8.19).
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

/** What the function a fold is handed takes and returns, read off the arrays lowered ahead of
 *  it: an element for a predicate, which answers a bool, and one of each for `zip`, whose
 *  function's return is its own to say. Undefined for a fold that takes no function, or when
 *  the arrays are not there yet. */
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
