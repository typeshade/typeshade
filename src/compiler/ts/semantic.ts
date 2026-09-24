// Ban host/JS surface inside "use typeshade" files: host control flow and the runtime forms no
// shader has. A NAME is not judged here by its spelling. It is resolved where it is used, and one
// nothing declares is an unknown name of the code that owns its position (Rule 2.1). Three of
// those are said here, on the syntax, because the lowering reaches a body once per instance or
// not at all: a `new` that builds no class and a type name nothing declares, before the lowering,
// and a value or a callee nothing declares, after it ({@link reportUndeclaredValues}).

import ts from 'typescript';
import type { TsCompilerDiagnostic } from './source-file.js';
import { TS_CODES, type TsCode } from './codes.js';
import { makeDiagnostic } from './diagnostic.js';
import { isEnableDirective } from './enables.js';
import { LIBRARY_TYPE_NAMES, undeclaredTypeName, unknownTypeSentence } from './type-map.js';
import { declaredValueNamesOf, namesInScope } from './unknown-names.js';
import { newRefusal } from './lower/new-target.js';
import {
  builtinValueNames,
  unknownIdentifierSentence,
  unknownValueSentence,
} from './lower/expression.js';
import { unknownFunctionSentence } from './lower/expression-call.js';
import { ATTRIBUTE_NAMES } from './builtin-check.js';

function push(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code));
}

function visit(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  // What a `new` builds, and a type name nothing declares, are resolved here, once for the file:
  // in a body no call lowers, and once for a body lowered for every instance (Rule 2.1, Rule 12.4).
  if (ts.isNewExpression(node)) {
    const refused = newRefusal(node, sourceFile);
    if (refused !== undefined) push(diagnostics, sourceFile, node, refused.message, refused.code);
  }
  const unknownType = undeclaredTypeName(node, sourceFile);
  if (unknownType !== undefined) {
    const sentence = unknownTypeSentence(unknownType.text, namesInScope(node, 'type'));
    push(diagnostics, sourceFile, unknownType, sentence, TS_CODES.UNKNOWN_TYPE);
  }
  if (ts.isAwaitExpression(node)) {
    push(
      diagnostics,
      sourceFile,
      node,
      'await is host control flow. Shader functions are synchronous.',
      TS_CODES.HOST_STMT,
    );
  }
  if (ts.isYieldExpression(node)) {
    push(
      diagnostics,
      sourceFile,
      node,
      'yield is not valid in a TypeShade function.',
      TS_CODES.HOST_STMT,
    );
  }
  // `for…of` over an array is a counted loop (Rule 7.5) and is lowered in control.ts.
  // `for…in` enumerates an object's keys, which no shader value has.
  if (ts.isForInStatement(node)) {
    push(
      diagnostics,
      sourceFile,
      node,
      "for-in enumerates a JS object's keys, which a shader value does not have. Iterate an " +
        'array with `for (const x of xs)`, or count with `for (let i = 0; i < n; i++)`.',
      TS_CODES.HOST_STMT,
    );
  }
  if (ts.isTryStatement(node) || ts.isThrowStatement(node)) {
    push(
      diagnostics,
      sourceFile,
      node,
      'try/catch/throw are JS exceptions. TypeShade has no exception path.',
      TS_CODES.HOST_STMT,
    );
  }
  if (ts.isTaggedTemplateExpression(node) || ts.isTemplateExpression(node)) {
    push(
      diagnostics,
      sourceFile,
      node,
      'Template strings are JS. TypeShade has no string type.',
      TS_CODES.HOST_STMT,
    );
  }
  // `{ ...p }` in an object literal is the fields of `p`, which the literal lowering spreads
  // to one read each (roadmap 0.3 item T7, #92); it says itself what it cannot spread. Every
  // other spread is still a runtime operation this surface has no form for: `f(...args)`
  // needs an argument count known only at run time, and `[...xs]` a list that grows.
  if (ts.isSpreadElement(node)) {
    push(diagnostics, sourceFile, node, 'Spread is a JS runtime operation.', TS_CODES.HOST_STMT);
  }
  if (
    ts.isFunctionDeclaration(node) &&
    node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
  ) {
    push(
      diagnostics,
      sourceFile,
      node,
      'async functions are host. TypeShade functions are pure and synchronous.',
      TS_CODES.HOST_STMT,
    );
  }
  if (ts.isFunctionDeclaration(node) && node.asteriskToken) {
    push(
      diagnostics,
      sourceFile,
      node,
      'Generators are not TypeShade functions.',
      TS_CODES.HOST_STMT,
    );
  }
  if (
    ts.isVariableStatement(node) &&
    (node.declarationList.flags & ts.NodeFlags.Let) === 0 &&
    (node.declarationList.flags & ts.NodeFlags.Const) === 0
  ) {
    push(
      diagnostics,
      sourceFile,
      node,
      '`var` is not allowed. Use `let` (mutable) or `const` (immutable).',
      TS_CODES.HOST_STMT,
    );
  }
  ts.forEachChild(node, (child) => visit(child, sourceFile, diagnostics));
}

const ALLOWED_TOP = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ImportDeclaration,
  ts.SyntaxKind.ExportDeclaration,
  ts.SyntaxKind.ExportAssignment,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  // A numeric `enum` is a set of named integer constants, which `module-const.ts` collects
  // as the module constants `Enum_Member` (roadmap 0.3 item T1, #92).
  ts.SyntaxKind.EnumDeclaration,
  // A `namespace` is a named group of functions and constants, flattened to `Ns_member`
  // (roadmap 0.3 item T4, #92).
  ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.ExpressionStatement,
]);

export function analyzeSemantics(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  for (const stmt of sourceFile.statements) {
    if (ts.isExpressionStatement(stmt)) {
      const e = stmt.expression;
      if (ts.isStringLiteral(e) && (e.text === 'use typeshade' || e.text === 'use strict'))
        continue;
      // `"enable subgroups"` is a directive, not stray work (§50). `enables.ts` owns whether
      // the name is one WGSL has; saying "put work inside a function" here as well would be
      // two contradictory diagnostics on the one statement.
      if (isEnableDirective(stmt)) continue;
      push(
        diagnostics,
        sourceFile,
        stmt,
        'Top-level expressions are not a TypeShade program. Put work inside a function.',
        TS_CODES.TOP_LEVEL,
      );
      continue;
    }
    if (ts.isVariableStatement(stmt)) {
      const isConst = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
      const isLet = (stmt.declarationList.flags & ts.NodeFlags.Let) !== 0;
      // A top-level `let` is a module variable (§24): plain, the per-invocation one; with a
      // wrapper, the space the wrapper names. `module-vars.ts` collects it and owns its
      // refusals, and a `declare` is a binding, which is always const.
      if (!isLet && !isConst) {
        push(
          diagnostics,
          sourceFile,
          stmt,
          'Top-level var is not allowed. Use `let` for a per-invocation variable or `const` ' +
            'for a module constant.',
          TS_CODES.TOP_LEVEL,
        );
      }
      continue;
    }
    if (!ALLOWED_TOP.has(stmt.kind)) {
      push(
        diagnostics,
        sourceFile,
        stmt,
        `Unsupported top-level "${ts.SyntaxKind[stmt.kind]}". A TypeShade file is directive + types + functions + imports.`,
        TS_CODES.TOP_LEVEL,
      );
    }
  }
  visit(sourceFile, sourceFile, diagnostics);
}

/** The values the ambient library declares beyond the builtins a call reaches and the §9.3
 *  constants ({@link builtinValueNames}): the attributes, `discard`, `Symbol`, and the call-form
 *  bindings `uniform<T>()` and `storage<T>()`. TypeScript resolves each, so none is a name
 *  nothing declares; `ambient-parity.test.ts` holds the whole set to the library. */
export const LIBRARY_VALUES: ReadonlySet<string> = new Set([
  ...ATTRIBUTE_NAMES,
  'discard',
  'Symbol',
  'uniform',
  'storage',
]);

/** Whether the ambient library declares a value of `name`, which is then no name nothing
 *  declares ({@link LIBRARY_VALUES}). */
export const isLibraryValueName = (name: string): boolean =>
  LIBRARY_VALUES.has(name) || builtinValueNames().includes(name);

/** The names a body reads that are neither a value nor a callee of the program: WGSL's phony
 *  target `_` (§52), and the two TypeScript itself declares in a function, which the lowering
 *  says what it makes of. */
const NOT_READ: ReadonlySet<string> = new Set(['_', 'undefined', 'arguments']);

/** Whether an identifier is the root of a target written to, `x` in `x.a[i] = 1.` or `x++`. */
function assignedRoot(id: ts.Identifier): boolean {
  let at: ts.Node = id;
  while (
    (ts.isPropertyAccessExpression(at.parent) || ts.isElementAccessExpression(at.parent)) &&
    at.parent.expression === at
  ) {
    at = at.parent;
  }
  while (ts.isParenthesizedExpression(at.parent)) at = at.parent;
  const p = at.parent;
  if (ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) {
    return (
      p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken
    );
  }
  return (
    ts.isBinaryExpression(p) &&
    p.left === at &&
    p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    p.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  );
}

/** How `id` is used where it stands in a body, or undefined where it is no read of a name: a
 *  declaration's name, a member after a dot, a key, a label, and the operands another refusal
 *  covers whole (`await`, `throw`, `typeof`, a spread, a template, a shorthand). */
function useOf(id: ts.Identifier): 'value' | 'callee' | 'assigned' | undefined {
  const p = id.parent;
  if (ts.isCallExpression(p) && p.expression === id) return 'callee';
  if (ts.isPropertyAccessExpression(p)) {
    return p.expression === id ? (assignedRoot(id) ? 'assigned' : 'value') : undefined;
  }
  if (ts.isElementAccessExpression(p)) {
    return p.expression === id && assignedRoot(id) ? 'assigned' : 'value';
  }
  if (
    ts.isBinaryExpression(p) ||
    ts.isPrefixUnaryExpression(p) ||
    ts.isPostfixUnaryExpression(p) ||
    ts.isParenthesizedExpression(p)
  ) {
    return assignedRoot(id) ? 'assigned' : 'value';
  }
  if (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) {
    return p.initializer === id ? 'value' : undefined;
  }
  if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
    return p.arguments?.includes(id) === true ? 'value' : undefined;
  }
  if (
    ts.isReturnStatement(p) ||
    ts.isConditionalExpression(p) ||
    ts.isArrayLiteralExpression(p) ||
    ts.isIfStatement(p) ||
    ts.isWhileStatement(p) ||
    ts.isDoStatement(p) ||
    ts.isSwitchStatement(p) ||
    ts.isCaseClause(p) ||
    ts.isForOfStatement(p) ||
    ts.isAsExpression(p) ||
    ts.isSatisfiesExpression(p) ||
    ts.isNonNullExpression(p) ||
    ts.isExpressionStatement(p) ||
    (ts.isArrowFunction(p) && p.body === id)
  ) {
    return ts.isForOfStatement(p) && p.initializer === id ? undefined : 'value';
  }
  return undefined;
}

/**
 * Says each name read as a value, called, or assigned to in a body, where nothing declares it:
 * not the file, in any scope (`declaredValueNamesOf`), not the ambient library, and not a type
 * the library declares, which is said to be one. Run once the file is lowered: a body a call
 * lowers said it already, word for word at the same span, or covered it with a refusal of its
 * own, and either way says nothing more here; a body no call lowers (an uncalled generic, a
 * function that takes a function, a method of a class nothing builds) says it here, as the
 * editor's TS2304 does (Rule 2.1, Rule 12.7). A decorator, a type, a heritage clause and a
 * `new`'s target are said where they are read.
 */
export function reportUndeclaredValues(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  const declared = declaredValueNamesOf(sourceFile);
  const errors = diagnostics.filter(
    (d) => d.category === 'error' && d.fileName === sourceFile.fileName,
  );
  const covered = (node: ts.Node): boolean => {
    const start = node.getStart(sourceFile);
    const end = node.getEnd();
    return errors.some((d) => d.start <= start && d.start + d.length >= end);
  };
  const check = (id: ts.Identifier): void => {
    const name = id.text;
    if (declared.has(name) || NOT_READ.has(name)) return;
    if (isLibraryValueName(name) && !LIBRARY_TYPE_NAMES.has(name)) return;
    const use = useOf(id);
    if (use === undefined || covered(id)) return;
    const message =
      use === 'callee'
        ? unknownFunctionSentence(id)
        : use === 'assigned'
          ? unknownIdentifierSentence(id, `Cannot assign to unknown name "${name}".`)
          : unknownValueSentence(id);
    push(
      diagnostics,
      sourceFile,
      id,
      message,
      use === 'callee' ? TS_CODES.UNKNOWN_FN : TS_CODES.UNKNOWN_NAME,
    );
  };
  const walk = (node: ts.Node, inBody: boolean): void => {
    if (ts.isDecorator(node) || ts.isTypeNode(node) || ts.isHeritageClause(node)) return;
    if (ts.isNewExpression(node)) {
      for (const arg of node.arguments ?? []) walk(arg, inBody);
      return;
    }
    if (inBody && ts.isIdentifier(node)) {
      check(node);
      return;
    }
    if (ts.isFunctionLike(node)) {
      const body = (node as { readonly body?: ts.Node }).body;
      if (body !== undefined) walk(body, true);
      return;
    }
    // An instance field's initializer is a body too: the constructor runs it.
    if (ts.isPropertyDeclaration(node) && node.initializer !== undefined) {
      if (!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)) {
        walk(node.initializer, true);
      }
      return;
    }
    ts.forEachChild(node, (child) => walk(child, inBody));
  };
  walk(sourceFile, false);
}
