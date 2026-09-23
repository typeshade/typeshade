// TypeShade map/reduce over array<T, N>. Unrolls to call + construct. No JS Array.

import ts from 'typescript';
import type { Expr, FuncDecl } from '../../core/ir/nodes.js';
import { arrayT, i32T, typeKey } from '../../core/ir/types.js';
import type { LoweringScope } from './context.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { makeDiagnostic } from './diagnostic.js';
import { TS_CODES, type TsCode } from './codes.js';

const MAX_UNROLL = 64;

export function isArrayHof(name: string): boolean {
  return name === 'map' || name === 'reduce';
}

export function lowerArrayHof(
  name: 'map' | 'reduce',
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  lowerExpression: (
    n: ts.Expression,
    sf: ts.SourceFile,
    sc: LoweringScope,
    d: TsCompilerDiagnostic[],
  ) => Expr | undefined,
): Expr | undefined {
  const args = node.arguments;
  const fnArg = name === 'map' ? args[1] : args[2];
  if (!fnArg) {
    diagnostics.push(
      err(
        sourceFile,
        node,
        name === 'map' ? 'map(xs, fn)' : 'reduce(xs, init, fn)',
        TS_CODES.ARITY_MISMATCH,
      ),
    );
    return undefined;
  }
  if (ts.isArrowFunction(fnArg) || ts.isFunctionExpression(fnArg)) {
    diagnostics.push(
      err(
        sourceFile,
        fnArg,
        `${name} does not take a lambda. Pass a function name: ${name}(xs, scale).`,
        TS_CODES.UNSUPPORTED,
      ),
    );
    return undefined;
  }
  if (!ts.isIdentifier(fnArg)) {
    diagnostics.push(
      err(sourceFile, fnArg, `${name} callback must be a function name.`, TS_CODES.UNSUPPORTED),
    );
    return undefined;
  }
  const decl = scope.resolveCallee(fnArg.text);
  if (!decl) {
    diagnostics.push(
      err(sourceFile, fnArg, `Unknown function "${fnArg.text}".`, TS_CODES.UNKNOWN_FN),
    );
    return undefined;
  }
  // What it returns, which its body says when it writes no return type (Rule 8.19).
  if (!scope.calleeReady(decl, fnArg, sourceFile, diagnostics)) return undefined;
  const xsNode = args[0];
  if (!xsNode) {
    diagnostics.push(
      err(
        sourceFile,
        node,
        `${name} needs an array as the first argument.`,
        TS_CODES.ARITY_MISMATCH,
      ),
    );
    return undefined;
  }
  const xs = lowerExpression(xsNode, sourceFile, scope, diagnostics);
  if (!xs) return undefined;
  if (xs.type.kind !== 'array' || typeof xs.type.size !== 'number') {
    diagnostics.push(
      err(
        sourceFile,
        xsNode,
        `${name} requires array<T, N> with a known N.`,
        TS_CODES.TYPE_MISMATCH,
      ),
    );
    return undefined;
  }
  const n = xs.type.size;
  const elem = xs.type.elem;
  if (n > MAX_UNROLL) {
    diagnostics.push(
      err(sourceFile, node, `${name} unrolls N=${n}; max is ${MAX_UNROLL}.`, TS_CODES.UNSUPPORTED),
    );
    return undefined;
  }
  if (name === 'map') return lowerMap(xs, n, elem, decl, node, sourceFile, diagnostics);
  const initNode = args[1];
  if (!initNode) {
    diagnostics.push(err(sourceFile, node, 'reduce(xs, init, fn)', TS_CODES.ARITY_MISMATCH));
    return undefined;
  }
  const init = lowerExpression(initNode, sourceFile, scope, diagnostics);
  if (!init) return undefined;
  return lowerReduce(xs, n, elem, init, decl, node, sourceFile, diagnostics);
}

function at(xs: Expr, i: number, elem: Expr['type']): Expr {
  return { op: 'index', type: elem, base: xs, idx: { op: 'lit', type: i32T, value: i } };
}

function lowerMap(
  xs: Expr,
  n: number,
  elem: Expr['type'],
  decl: FuncDecl,
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (decl.params.length !== 1) {
    diagnostics.push(
      err(
        sourceFile,
        node,
        `map fn "${decl.name}" must take one argument.`,
        TS_CODES.ARITY_MISMATCH,
      ),
    );
    return undefined;
  }
  if (typeKey(decl.params[0]!.type) !== typeKey(elem)) {
    diagnostics.push(
      err(
        sourceFile,
        node,
        `map fn "${decl.name}" param must be ${typeKey(elem)}.`,
        TS_CODES.TYPE_MISMATCH,
      ),
    );
    return undefined;
  }
  const args: Expr[] = [];
  for (let i = 0; i < n; i++) {
    args.push({
      op: 'call',
      type: decl.ret,
      fn: decl.name,
      args: [at(xs, i, elem)],
      declRef: decl,
    });
  }
  return { op: 'construct', type: arrayT(decl.ret, n), args };
}

function lowerReduce(
  xs: Expr,
  n: number,
  elem: Expr['type'],
  init: Expr,
  decl: FuncDecl,
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (decl.params.length !== 2) {
    diagnostics.push(
      err(
        sourceFile,
        node,
        `reduce fn "${decl.name}" must take (acc, elem).`,
        TS_CODES.ARITY_MISMATCH,
      ),
    );
    return undefined;
  }
  if (typeKey(decl.params[1]!.type) !== typeKey(elem)) {
    diagnostics.push(
      err(
        sourceFile,
        node,
        `reduce fn "${decl.name}" elem param must be ${typeKey(elem)}.`,
        TS_CODES.TYPE_MISMATCH,
      ),
    );
    return undefined;
  }
  if (
    typeKey(decl.params[0]!.type) !== typeKey(init.type) ||
    typeKey(decl.ret) !== typeKey(init.type)
  ) {
    diagnostics.push(
      err(sourceFile, node, `reduce acc/init/return must share a type.`, TS_CODES.TYPE_MISMATCH),
    );
    return undefined;
  }
  let acc: Expr = init;
  for (let i = 0; i < n; i++) {
    acc = {
      op: 'call',
      type: decl.ret,
      fn: decl.name,
      args: [acc, at(xs, i, elem)],
      declRef: decl,
    };
  }
  return acc;
}

function err(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode,
): TsCompilerDiagnostic {
  return makeDiagnostic(sourceFile, node, message, code);
}
