import ts from 'typescript';
import type { Expr, FuncDecl } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { boolT, typeKey } from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import type { LoweringScope } from '../context.js';
import { fillArray, noneOf, unrollMinMax, unrollPred, unrollSum, unrollZip } from '../array-ops.js';
import { mapTsTypeToShaderType } from '../type-map.js';
import { foldNumericLit, isIntScalar, retargetDeclaredIntLit } from '../lit-coerce.js';
import { USER_FIRST_BUILTINS, isCanonicalMathFn } from '../math-alias.js';
import { lowerExpression } from './expression.js';
import { makeDiagnostic } from '../diagnostic.js';
import { TS_CODES, type TsCode } from '../codes.js';
import { captureArguments, declaresFunction } from './local-functions.js';
import { declarationOf, functionAround } from './closures.js';
import type { FunctionShape } from './function-types.js';

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
    return inferredArrayCtor(node, sourceFile, scope, diagnostics);
  }
  const fakeRef = ts.factory.createTypeReferenceNode('array', [...typeArgs]);
  const mapped = mapTsTypeToShaderType(fakeRef, sourceFile, diagnostics);
  if (!mapped || mapped.kind !== 'array') return undefined;
  const n = mapped.size;
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
 *  `array(1, 2, 3)` infers `array<f32, 3>` — the same type `const x = 1` gives, and changing
 *  that is #148's decision, not this one's. */
function inferredArrayCtor(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (node.arguments.length === 0) {
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
  for (const arg of node.arguments) {
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
      node.arguments[odd]!,
      `array(...) infers one element type from its elements; element 0 is ${typeKey(elem)} ` +
        `and element ${odd} is ${typeKey(args[odd]!.type)}. Cast the odd one, or write the ` +
        `type out: array<${typeKey(elem)}, ${args.length}>(...).`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  return { op: 'construct', type: { kind: 'array', elem, size: args.length }, args };
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
      `An array literal needs a declared array type, got ${typeKey(target)}.`,
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
      `array<${typeKey(target.elem)}, ${target.size ?? node.elements.length}> is an array of arrays, which GLSL ES 3.00 does not have. Flatten it: one array<${typeKey(target.elem.elem)}, N> indexed by row * width + column.`,
      TS_CODES.UNSUPPORTED,
    );
    return undefined;
  }
  if (target.size === undefined) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `A list needs a fixed size to fill: write the size, e.g. array<${typeKey(target.elem)}, ${node.elements.length}>.`,
      TS_CODES.UNKNOWN_TYPE,
    );
    return undefined;
  }
  for (const element of node.elements) {
    // Checked before the count: `[...xs]` is one element syntactically, so counting it first
    // would report an arity the author never wrote.
    if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) {
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
      `array<${typeKey(target.elem)}, ${target.size}> takes ${target.size} element(s), got ${node.elements.length}.`,
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
        `array<${typeKey(target.elem)}, ${target.size}> element ${i} must be ${typeKey(target.elem)}, and a list is not one.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    const lowered = lowerExpression(element, sourceFile, scope, diagnostics);
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

/** One element of an `array<T, N>`, list or call, given the element type it sits in. Shared by
 *  {@link lowerArrayLiteral} and {@link lowerArrayCtor} so the two spellings cannot drift.
 *
 *  An element takes the element type by exactly the rule a scalar declaration uses, which is
 *  `retargetDeclaredIntLit` itself (#8 A3): what is WRITTEN as an integer and FITS is retyped,
 *  and a single literal written as a float but valued as a whole number is kept, the way
 *  `const x: i32 = 1.` is. Everything else is left alone and reported by the element check
 *  below, so `[1.5, 2]`, `[-1, 2]` into a u32 array and `[3000000000, 2]` get the element
 *  message rather than reaching the backend as an unspellable literal. `i32(2)` states its own
 *  type and is not a literal waiting for one, so it stays i32 and is reported against an f32
 *  element, the same line `const x: f32 = i32(2)` draws. */
function typeArrayElement(
  node: ts.Expression,
  lowered: Expr,
  elem: ShaderType,
  size: number | undefined,
  i: number,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  let out = retargetDeclaredIntLit(lowered, node, elem);
  if (isBareNumericLiteral(node) && isNumericScalar(elem)) {
    // Folded first, so a leading minus is part of the number: `-1.` reaches here as a unop
    // over a literal, and an f64 array would otherwise be told its element is an f32. Only
    // where the retarget above declined, which for a float element type is always.
    const folded = foldNumericLit(out);
    if (folded.op === 'lit' && typeof folded.value === 'number' && !isIntScalar(elem)) {
      out = { op: 'lit', type: elem, value: folded.value };
    }
  }
  if (typeKey(out.type) !== typeKey(elem)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `array<${typeKey(elem)}${size === undefined ? '' : `, ${size}`}> element ${i} must be ${typeKey(elem)}, got ${typeKey(out.type)}. There is no implicit conversion; cast it.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  return out;
}

/** A number as written in the source — `1.`, `2`, `-3` — through parentheses and a leading
 *  minus. Not `i32(2)`, which states its own type. */
function isBareNumericLiteral(node: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(node)) return isBareNumericLiteral(node.expression);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    return isBareNumericLiteral(node.operand);
  }
  return ts.isNumericLiteral(node);
}

function isNumericScalar(t: ShaderType): boolean {
  const k = typeKey(t);
  return k === 'f32' || k === 'i32' || k === 'u32';
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
  const v = lowerExpression(node.arguments[0]!, sourceFile, scope, diagnostics);
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
        const decl = scope.liftArgument(arg, shape, name, sourceFile, diagnostics);
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
      const declared = declarationOf(arg);
      const local =
        declared !== undefined &&
        functionAround(declared) !== undefined &&
        declaresFunction(declared);
      if (decl && !local && intrinsicFirst(arg.text)) {
        // The precedence `lowerCall` applies, applied here too: a name that was a builtin
        // before #8 A6 stays the intrinsic even when the file declares a function of that
        // name, so a fold cannot hand the declaration to `unrollZip` and stamp a `declRef` on
        // the calls it builds. One stamped call would put the name in the emitter's per-module
        // set and redirect every plain `atan(y, x)` in the file to the declaration on GLSL
        // while the CPU oracle kept the intrinsic. There is no intrinsic-valued callback in a
        // fold today, so the honest answer is a diagnostic that names the rule.
        pushDiag(
          diagnostics,
          sourceFile,
          arg,
          `"${arg.text}" is a builtin, and a declared function of that name does not shadow it; ${name} takes a function declared in this file under another name.`,
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
  if (name === 'sum') {
    if (!first) {
      pushDiag(diagnostics, sourceFile, node, 'sum(xs) needs an array.', TS_CODES.ARITY_MISMATCH);
      return undefined;
    }
    const out = unrollSum(first);
    if (typeof out === 'string') {
      pushDiag(diagnostics, sourceFile, node, out, TS_CODES.TYPE_MISMATCH);
      return undefined;
    }
    return out;
  }
  if ((name === 'min' || name === 'max') && asArray && args.length === 1) {
    const out = unrollMinMax(name, first!);
    if (typeof out === 'string') {
      pushDiag(diagnostics, sourceFile, node, out, TS_CODES.TYPE_MISMATCH);
      return undefined;
    }
    return out;
  }
  if (name === 'any' || name === 'all' || name === 'none') {
    if (!first || predDecls.length !== 1) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `${name}(xs, pred) needs an array and a predicate function.`,
        TS_CODES.ARITY_MISMATCH,
      );
      return undefined;
    }
    const out = unrollPred(first, predDecls[0]!, name === 'all' ? '&&' : '||', leading);
    if (typeof out === 'string') {
      pushDiag(diagnostics, sourceFile, node, out, TS_CODES.TYPE_MISMATCH);
      return undefined;
    }
    return name === 'none' ? noneOf(out) : out;
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
  if (name === 'any' || name === 'all' || name === 'none') {
    const x = elem(arrays[0]);
    return x === undefined
      ? undefined
      : { params: [x], ret: boolT, text: `(x: ${typeKey(x)}) => bool` };
  }
  if (name === 'zip') {
    const a = elem(arrays[0]);
    const b = elem(arrays[1]);
    return a === undefined || b === undefined
      ? undefined
      : { params: [a, b], ret: undefined, text: `(a: ${typeKey(a)}, b: ${typeKey(b)}) => …` };
  }
  return undefined;
}

/** A builtin name a declaration does NOT win: every canonical math id and `mod`, except the
 *  names #8 A6 added, which resolve to the file's own function first (`USER_FIRST_BUILTINS`).
 *  Mirrors the order `lowerCall` checks in, so a fold and a plain call agree on what a name
 *  means. */
function intrinsicFirst(name: string): boolean {
  return !USER_FIRST_BUILTINS.has(name) && (name === 'mod' || isCanonicalMathFn(name));
}

function pushDiag(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code));
}
