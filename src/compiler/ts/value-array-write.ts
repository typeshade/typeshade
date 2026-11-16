// ═══ A write to a value array parameter (Rule 8.23, change 0138, Amendment A15, `TS8080`) ═══
//
// A parameter of an array with no qualifier is a value. The call passes a copy, so a write the body
// makes to it changes the copy and nothing else: the caller's array keeps its values, and the write
// is lost unless the function returns the parameter. Slice 2 of change 0138 refuses that write
// where it is made, path by path (`definite.ts` walks the paths; this file says what a write is
// and what the refusal says).
//
// What this file reads is the source only, as `definite.ts` does, so the compiler and the editor
// say one thing (Rule 12.7):
//
//   - a parameter is a value array when it has no `@inout` and no `@out` and its type is written
//     `array<T>`, an array with no size, or a type alias of the file that is. A fixed-size array
//     parameter, `array<T, N>`, is a value as before (Rule 8.8, change 0031): `TS8080` does not
//     read it (Amendment A16, decision 2);
//   - a write is `xs[i] = e`, `xs[i].f += e`, `xs[i]++`, `xs.fill(v)`, `xs = e`, and the argument
//     of a function of the file whose parameter is `@inout` or `@out`;
//   - a push is `xs.push(v)`, refused even when the function returns `xs`, and refused on a
//     declared `@out` array, which a push needs `@inout` for (Amendment A16, decision 1).

import ts from 'typescript';
import { qualifiersOf } from './lower/references.js';
import type { BindingDecl, FuncDecl, ModuleDecl, ModuleVarDecl } from '../../core/ir/nodes.js';
import { fnWrites } from '../../core/passes/effects.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { makeDiagnostic } from './diagnostic.js';
import { TS_CODES } from './codes.js';

/** The names of the array methods that change the array they are called on, other than `push`. */
const MUTATORS = new Set(['fill']);

/** Whether `type` is written as an array with no size: `array<T>`, or the name of a type alias of
 *  the file that is, followed through other aliases. `array<T, N>` is a fixed-size array, which
 *  `TS8080` does not read (Rule 8.8, Amendment A16, decision 2). */
export function writesAnUnsizedArray(
  type: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile,
): boolean {
  return arrayWritten(type, sourceFile, true);
}

/** Whether `type` is written as an array of any size, followed through aliases of the file. */
export function writesAnArray(type: ts.TypeNode | undefined, sourceFile: ts.SourceFile): boolean {
  return arrayWritten(type, sourceFile, false);
}

function arrayWritten(
  type: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile,
  unsizedOnly: boolean,
): boolean {
  const seen = new Set<string>();
  let at: ts.TypeNode | undefined = type;
  while (at !== undefined) {
    while (ts.isParenthesizedTypeNode(at)) at = at.type;
    if (!ts.isTypeReferenceNode(at) || !ts.isIdentifier(at.typeName)) return false;
    const name = at.typeName.text;
    if (name === 'array') return !unsizedOnly || (at.typeArguments?.length ?? 0) === 1;
    if (seen.has(name) || (at.typeArguments?.length ?? 0) > 0) return false;
    seen.add(name);
    let next: ts.TypeNode | undefined;
    for (const st of sourceFile.statements) {
      if (
        ts.isTypeAliasDeclaration(st) &&
        st.name.text === name &&
        (st.typeParameters?.length ?? 0) === 0
      )
        next = st.type;
    }
    at = next;
  }
  return false;
}

/** Whether `p` is a parameter of an array with no size and no qualifier: a value (Rule 8.23). */
export function isValueArrayParameter(
  p: ts.ParameterDeclaration,
  sourceFile: ts.SourceFile,
): boolean {
  return (
    ts.isIdentifier(p.name) &&
    qualifiersOf(p).length === 0 &&
    writesAnUnsizedArray(p.type, sourceFile)
  );
}

/** Whether `p` is an `@out` parameter of an array, which the call fills with zeros before the body
 *  runs (Rule 8.25, change 0138, Amendment A15, decision 2). */
export function isOutArrayParameter(
  p: ts.ParameterDeclaration,
  sourceFile: ts.SourceFile,
): boolean {
  return qualifiersOf(p).some((q) => q.name === 'out') && writesAnArray(p.type, sourceFile);
}

/** `e` without parentheses, a non-null assertion, or a type assertion around it. */
export function bare(e: ts.Expression): ts.Expression {
  let x = e;
  while (
    ts.isParenthesizedExpression(x) ||
    ts.isNonNullExpression(x) ||
    ts.isAsExpression(x) ||
    ts.isSatisfiesExpression(x)
  )
    x = x.expression;
  return x;
}

/** The identifier at the root of a place: `xs` of `xs`, `xs[i]` and `xs[i].f`. */
export function rootIdentifier(place: ts.Expression): ts.Identifier | undefined {
  let at = bare(place);
  for (;;) {
    if (ts.isIdentifier(at)) return at;
    if (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at))
      at = bare(at.expression);
    else return undefined;
  }
}

/** A write that `node` makes, if it makes one: the place it writes, and whether it is a push. The
 *  node is the assignment, the increment, the call of a method, or nothing else. The arguments of
 *  a call that a function of the file takes `@inout` or `@out` are the caller's to name. */
export function writeAt(node: ts.Node): { place: ts.Expression; push: boolean } | undefined {
  if (ts.isBinaryExpression(node)) {
    const k = node.operatorToken.kind;
    if (k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment)
      return { place: node.left, push: false };
    return undefined;
  }
  if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
    const k = node.operator;
    if (k === ts.SyntaxKind.PlusPlusToken || k === ts.SyntaxKind.MinusMinusToken)
      return { place: node.operand, push: false };
    return undefined;
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const callee = node.expression;
    const method = callee.name.text;
    const object = bare(callee.expression);
    if (method === 'push' && ts.isIdentifier(object)) return { place: object, push: true };
    if (MUTATORS.has(method) && ts.isIdentifier(object)) return { place: object, push: false };
  }
  return undefined;
}

/** What `TS8080` says of a write to the array parameter `param` of `fn`. `how` is a push to a
 *  value, any other write to a value, or a push to an `@out` array. `TS8080` is said in a kernel
 *  function only, which may return the parameter (Amendment A19, decision 3). */
export function lostWriteText(
  fn: string,
  param: string,
  how: 'push' | 'write' | 'out-push',
): string {
  if (how === 'out-push')
    return `${fn}(): parameter "${param}" is @out; a push to it needs @inout. Write @inout ${param}.`;
  if (how === 'push')
    return (
      `${fn}(): parameter "${param}" is a value; a push to it is lost. Write @inout ${param} to ` +
      `push into the caller's array.`
    );
  return (
    `${fn}(): parameter "${param}" is a value; its writes are lost. Write @inout ${param} to ` +
    `update the caller's array, or return ${param}.`
  );
}

/** The writes `definite.ts` cannot see in the source: a call of a method on an element that
 *  changes its object (`vs[i].tick(dt)`, Rule 8.10), which only the lowered body shows. A value
 *  array parameter that the effects of the lowered function say is written, and that the source
 *  walk found no write to, is refused on its declaration, unless every `return` of the function
 *  returns it (`returnsParam`, `array-return.ts`). */
export function checkValueArrayWritesByEffects(
  funcs: readonly FuncDecl[],
  bindings: readonly BindingDecl[],
  vars: readonly ModuleVarDecl[],
  nodeOf: (fn: string) => ts.Node | undefined,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  refused: ReadonlySet<ts.Node> = new Set(),
): void {
  const candidates = funcs.flatMap((f) => {
    const node = nodeOf(f.name);
    if (node === undefined || !ts.isFunctionDeclaration(node) || node.body === undefined) return [];
    // A function that cannot be a kernel has `TS8020` on the parameter, and one whose `return` was
    // refused has `TS8020` there: one mistake gets one diagnostic (Amendment A19, decisions 2, 3).
    if (f.kernel !== true || refused.has(node)) return [];
    const names = node.parameters.filter((p) => isValueArrayParameter(p, sourceFile));
    return names.length === 0 ? [] : [{ f, node, params: names }];
  });
  if (candidates.length === 0) return;
  const module = { funcs, bindings, vars, structs: [], consts: [] } as unknown as ModuleDecl;
  const writes = fnWrites(module);
  for (const { f, node, params } of candidates) {
    const written = writes.get(f.name);
    if (written === undefined) continue;
    const shown = node.name?.text ?? f.name;
    for (const p of params) {
      const name = (p.name as ts.Identifier).text;
      // Such a write is not found in the source to follow path by path, so it is kept only when
      // every `return` of the function returns the parameter (Amendment A19, decision 3).
      if (!written.has(name) || f.returnsParam === name) continue;
      const said = diagnostics.some(
        (d) =>
          d.code === TS_CODES.VALUE_ARRAY_WRITE_LOST &&
          d.message.startsWith(`${shown}(): parameter "${name}" `),
      );
      if (said) continue;
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          p,
          lostWriteText(shown, name, 'write'),
          TS_CODES.VALUE_ARRAY_WRITE_LOST,
        ),
      );
    }
  }
}
