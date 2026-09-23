// Ban host/JS surface inside "use typeshade" files.

import ts from 'typescript';
import type { TsCompilerDiagnostic } from './source-file.js';
import { TS_CODES, type TsCode } from './codes.js';
import { makeDiagnostic } from './diagnostic.js';
import { isEnableDirective } from './enables.js';
import { staticThisClass } from './class-names.js';

export const HOST_GLOBALS: ReadonlySet<string> = new Set([
  'window',
  'document',
  'globalThis',
  'global',
  'self',
  'fetch',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'queueMicrotask',
  'requestAnimationFrame',
  'Promise',
  'Date',
  'JSON',
  'process',
  'require',
  'module',
  'exports',
  'eval',
  'Function',
  'Array',
  'Object',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Symbol',
  'Error',
  'Proxy',
  'Reflect',
  'Atomics',
  'SharedArrayBuffer',
  'WebAssembly',
  'navigator',
  'performance',
  'crypto',
  'GPU',
  'GPUBuffer',
  'localStorage',
  'sessionStorage',
  'XMLHttpRequest',
  'Worker',
  'SharedWorker',
  'MessageChannel',
  'TextDecoder',
  'TextEncoder',
  'URL',
  'Blob',
  'atob',
  'btoa',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'Number',
  'String',
  'Boolean',
  'RegExp',
]);

function push(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code));
  REFUSED.get(sourceFile)?.add(node);
}

/** What `new X(...)` names, so the refusal can say the real reason rather than blaming the
 *  allocation (#86, and the DX note on it). A class the file declares is built here, which is
 *  the ordinary case; the other three are each refused for their own reason, and TypeScript
 *  refuses two of them as well. */
function newTarget(
  node: ts.NewExpression,
  sourceFile: ts.SourceFile,
): 'class' | 'abstract' | 'type' | 'host' {
  // `new this()` in a static member builds the class that declares the member (Rule 8.13).
  if (node.expression.kind === ts.SyntaxKind.ThisKeyword) {
    const cls = staticThisClass(node.expression);
    if (cls === undefined) return 'host';
    return cls.modifiers?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword)
      ? 'abstract'
      : 'class';
  }
  const written = newTargetName(node.expression);
  if (written === undefined) return 'host';
  // The name as written, and the short name a dotted one ends in: `new N.P()` names the class
  // `P` inside `N`, which the class walk below finds under its own name (#107).
  const short = written.slice(written.lastIndexOf('_') + 1);
  let found: 'class' | 'abstract' | 'type' | undefined;
  const walk = (statements: readonly ts.Statement[], inNamespace: boolean): void => {
    for (const s of statements) {
      if (ts.isModuleDeclaration(s) && s.body) {
        if (ts.isModuleBlock(s.body)) walk(s.body.statements, true);
        else if (ts.isModuleDeclaration(s.body)) walk([s.body], true);
        continue;
      }
      // A namespace's class answers to its short name; a top-level one only to what was
      // written, so `new N.P()` never resolves to a top-level `P`.
      const want = inNamespace ? short : written;
      if (ts.isClassDeclaration(s) && s.name?.text === want) {
        found ??= s.modifiers?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword)
          ? 'abstract'
          : 'class';
      }
      if (ts.isInterfaceDeclaration(s) && s.name.text === want) found ??= 'type';
      if (ts.isTypeAliasDeclaration(s) && s.name.text === want) found ??= 'type';
    }
  };
  walk(sourceFile.statements, false);
  return found ?? 'host';
}

/** The name of the class a node stands inside, the innermost one. */
function enclosingClassName(node: ts.Node): string | undefined {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if (ts.isClassLike(at)) return at.name?.text;
  }
  return undefined;
}

/** The name a `new` writes, joined the way the module flattens it: `P`, `N_P`. */
function newTargetName(expr: ts.Expression): string | undefined {
  const parts: string[] = [];
  let node: ts.Expression = expr;
  for (;;) {
    if (ts.isIdentifier(node)) {
      parts.unshift(node.text);
      return parts.join('_');
    }
    if (!ts.isPropertyAccessExpression(node)) return undefined;
    parts.unshift(node.name.text);
    node = node.expression;
  }
}

function isPropertyName(node: ts.Identifier): boolean {
  const p = node.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p) && p.name === node) return true;
  if (ts.isQualifiedName(p) && p.right === node) return true;
  if (ts.isPropertyAssignment(p) && p.name === node) return true;
  if (ts.isPropertySignature(p) && p.name === node) return true;
  return false;
}

function visit(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  if (ts.isIdentifier(node) && HOST_GLOBALS.has(node.text) && !isPropertyName(node)) {
    push(
      diagnostics,
      sourceFile,
      node,
      `"${node.text}" is a host/JS API. "use typeshade" files cannot touch the JS runtime.`,
      TS_CODES.HOST_API,
    );
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
  // `new Ray(...)` on a class the file declares is that class's constructor (#86). The other
  // three each get their own reason: a message that leads with "`new` allocates a JS object"
  // reads as a ban on `new` itself, which it is not, and sends a reader looking for a
  // workaround they do not need.
  if (ts.isNewExpression(node)) {
    const shown = ts.isIdentifier(node.expression)
      ? node.expression.text
      : node.expression.kind === ts.SyntaxKind.ThisKeyword
        ? (staticThisClass(node.expression)?.name?.text ?? 'this')
        : node.expression.getText(sourceFile);
    switch (newTarget(node, sourceFile)) {
      case 'class':
        break;
      case 'abstract':
        push(
          diagnostics,
          sourceFile,
          node,
          `"${shown}" is abstract, so there is no instance of it to build. Construct a class ` +
            `that extends it.`,
          TS_CODES.HOST_STMT,
        );
        break;
      case 'type':
        push(
          diagnostics,
          sourceFile,
          node,
          `"${shown}" is a type, not a value: an interface and a type alias declare a shape and ` +
            `carry no constructor. Write the object literal, { field: value }, or declare ` +
            `"${shown}" as a class to give it one.`,
          TS_CODES.HOST_STMT,
        );
        break;
      default:
        push(
          diagnostics,
          sourceFile,
          node,
          node.expression.kind === ts.SyntaxKind.ThisKeyword
            ? `"this" here is an object, not a class, so "new" cannot build one from it. Name ` +
                `the class, "new ${enclosingClassName(node) ?? 'C'}(...)"; "new this()" builds ` +
                `the class in a static member.`
            : `A class this file declares is built with "new", and "${shown}" is not one of ` +
                `them. "new" on anything else allocates a JS object, which a shader has no heap ` +
                `for.`,
          TS_CODES.HOST_STMT,
        );
    }
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
  // to one read each (roadmap 0.3 item T7, #92); it says itself what it cannot spread, and so
  // does a list, `[...a, 3.]`, which knows the elements to name (expression-array.ts). What is
  // left is a spread argument, `f(...args)`, whose count is known only at run time.
  if (ts.isSpreadElement(node) && !ts.isArrayLiteralExpression(node.parent)) {
    push(diagnostics, sourceFile, node, 'Spread is a JS runtime operation.', TS_CODES.HOST_STMT);
  }
  // Wherever it stands, at the top level or in a body (Rule 8.17); the local-function collector
  // leaves a declaration to this one sentence.
  if (ts.isFunctionDeclaration(node) && isAsyncOrGenerator(node)) {
    push(diagnostics, sourceFile, node, asyncOrGeneratorMessage(node), TS_CODES.HOST_STMT);
  }
  // A `var` at the top level is analyzeSemantics' TS8014 below, and one in a namespace the
  // namespace walk's TS8014; this sentence is a body's.
  if (
    ts.isVariableStatement(node) &&
    !ts.isSourceFile(node.parent) &&
    !ts.isModuleBlock(node.parent) &&
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
  if (holdsItsMistake(node)) return;
  ts.forEachChild(node, (child) => visit(child, sourceFile, diagnostics));
}

/** Whether what is under `node` is part of the one mistake refused at it, and is not read again
 *  (Rule 12.4): the operand of a `throw`, an `await` or a `yield`, the spans of a template
 *  string, what a spread spreads, and the whole of an async function or a generator, which is
 *  refused once on the function wherever it is written (here, or as a local function, an
 *  argument or a method), so an `await` or a `yield` in it is not said again. `throw new
 *  Error("x")` is the `throw`. A `try` and a `for…in` hold statements of the author's own, and
 *  those are still read. */
function holdsItsMistake(node: ts.Node): boolean {
  return (
    ts.isThrowStatement(node) ||
    ts.isAwaitExpression(node) ||
    ts.isYieldExpression(node) ||
    ts.isTemplateExpression(node) ||
    ts.isTaggedTemplateExpression(node) ||
    ts.isSpreadElement(node) ||
    (ts.isFunctionLike(node) && isAsyncOrGenerator(node))
  );
}

/** Whether a function is `async` or a generator, which a shader function cannot be: it runs to
 *  completion in one call, with no event loop to wait on and nothing to suspend it. */
export function isAsyncOrGenerator(node: ts.SignatureDeclaration): boolean {
  return (
    (node as { asteriskToken?: ts.AsteriskToken }).asteriskToken !== undefined ||
    (ts.canHaveModifiers(node) &&
      (ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false))
  );
}

/** The one sentence for an async or generator function declaration. */
function asyncOrGeneratorMessage(node: ts.FunctionDeclaration): string {
  const shown = node.name === undefined ? 'This function' : `"${node.name.text}"`;
  const isAsync = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
  if (!isAsync) {
    return (
      `${shown} is a generator, and a shader function runs to completion in one call: nothing ` +
      `suspends it at a "yield". Remove the "*" and return one value.`
    );
  }
  return node.asteriskToken
    ? `${shown} is an async generator, and a shader function runs to completion in one call: ` +
        `there is no event loop to wait on. Remove "async" and the "*", and return one value.`
    : `${shown} is async, and a shader function runs to completion in one call: there is no ` +
        `event loop to wait on. Remove "async" and each "await".`;
}

/** The nodes `visit` refused, per file: the lowering reads it where it has no form for a node,
 *  and says nothing more about one of these (Rule 12.4). Replaced on each analysis, so a node
 *  the language service keeps across edits carries only the latest verdict. */
const REFUSED = new WeakMap<ts.SourceFile, Set<ts.Node>>();

/** Whether `analyzeSemantics` refused `node`, having said why. */
export function refusedBySemantics(node: ts.Node): boolean {
  return REFUSED.get(node.getSourceFile())?.has(node) ?? false;
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
  REFUSED.set(sourceFile, new Set());
  visit(sourceFile, sourceFile, diagnostics);
}
