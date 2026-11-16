// ═══ A kernel function that returns an array (Rule 8.22, change 0138, Amendment A19) ═══
//
// A kernel function may return one of its parameters of an array with no size and no qualifier,
// and the same one on every path that returns. The call copies the argument first and writes the
// copy, so the result is a new array of the argument's length and class, and the caller's array
// keeps its values (Amendment A10, Q-A and Q-F).
//
// The one accepted form is `return ps`, with `ps` the name of such a parameter. Every other return
// of an array with no size is refused with `TS8020`, each with its own text:
//
//   - an expression that is no parameter (`return tmp`, `return k ? ps : qs`);
//   - an `@inout` or `@out` parameter, whose argument the call already writes in place, so the
//     result would be a second name of the caller's array;
//   - two parameters on different paths, since the result has one argument's length.
//
// What this file reads is the source only, so the compiler and the editor say one thing (Rule
// 12.7). One function gets one refusal, at the first `return` that is wrong (Rule 12.4).

import ts from 'typescript';
import type { FuncDecl } from '../../core/ir/nodes.js';
import { TS_CODES } from './codes.js';
import { makeDiagnostic } from './diagnostic.js';
import { qualifiersOf } from './lower/references.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { bare, isValueArrayParameter, writesAnUnsizedArray } from './value-array-write.js';

/** The `return` statements of `body` that return a value, outside every function written in it. */
function returnsOf(body: ts.Node): ts.ReturnStatement[] {
  const found: ts.ReturnStatement[] = [];
  const walk = (n: ts.Node): void => {
    if (ts.isFunctionLike(n)) return;
    if (ts.isReturnStatement(n) && n.expression !== undefined) found.push(n);
    ts.forEachChild(n, walk);
  };
  ts.forEachChild(body, walk);
  return found;
}

/** The names `body` declares as locals, outside every function written in it: a `return` of one
 *  of them names the local, not a parameter it shadows. */
function localsOf(body: ts.Node): Set<string> {
  const names = new Set<string>();
  const walk = (n: ts.Node): void => {
    if (ts.isFunctionLike(n)) return;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) names.add(n.name.text);
    ts.forEachChild(n, walk);
  };
  ts.forEachChild(body, walk);
  return names;
}

/**
 * Check each kernel function whose result is an array with no size, and record the parameter it
 * returns as `returnsParam` on its declaration. Returns the names of the functions it refused, so
 * that no `TS8080` is said beside the `TS8020` (Amendment A19, decision 2).
 */
export function checkArrayReturns(
  funcs: readonly FuncDecl[],
  nodeOf: (fn: string) => ts.Node | undefined,
  shownAs: (fn: string) => string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Set<ts.Node> {
  const refused = new Set<ts.Node>();
  for (const f of funcs) {
    if (f.kernel !== true || f.ret.kind !== 'array' || f.ret.size !== undefined) continue;
    const node = nodeOf(f.name);
    if (node === undefined || !ts.isFunctionDeclaration(node) || node.body === undefined) continue;
    const fn = shownAs(f.name);
    const params = node.parameters.filter(
      (p): p is ts.ParameterDeclaration & { name: ts.Identifier } => ts.isIdentifier(p.name),
    );
    const locals = localsOf(node.body);
    const values = params.filter((p) => isValueArrayParameter(p, sourceFile));
    const refuse = (at: ts.Node, message: string): void => {
      refused.add(node);
      diagnostics.push(makeDiagnostic(sourceFile, at, message, TS_CODES.FUNCTION_SHAPE));
    };
    let first: string | undefined;
    for (const r of returnsOf(node.body)) {
      const e = bare(r.expression!);
      const text = r.expression!.getText(sourceFile);
      const param =
        ts.isIdentifier(e) && !locals.has(e.text)
          ? params.find((p) => p.name.text === e.text)
          : undefined;
      if (param === undefined || !writesAnUnsizedArray(param.type, sourceFile)) {
        const remedy = values[0] === undefined ? '' : ` Write "return ${values[0].name.text}".`;
        refuse(
          r.expression!,
          `${fn}(): "return ${text}" returns an array that is no parameter. A kernel returns one ` +
            `of its array parameters, and the result has that argument's length.${remedy}`,
        );
        break;
      }
      const name = param.name.text;
      const qualifier = qualifiersOf(param)[0]?.name;
      if (qualifier !== undefined) {
        refuse(
          r.expression!,
          qualifier === 'inout'
            ? `${fn}(): parameter "${name}" is @inout, so the call already updates the caller's ` +
                `array. Remove "return ${name}", or remove @inout to return a new array.`
            : `${fn}(): parameter "${name}" is @out, so the call already fills the caller's ` +
                `array. Remove "return ${name}".`,
        );
        break;
      }
      if (first === undefined) first = name;
      else if (first !== name) {
        refuse(
          r.expression!,
          `${fn}(): returns "${first}" on one path and "${name}" on another. A kernel returns ` +
            `one array parameter on every path.`,
        );
        break;
      }
    }
    if (!refused.has(node) && first !== undefined)
      (f as { returnsParam?: string }).returnsParam = first;
  }
  return refused;
}
