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

/** What a file holds at the top level, for the sentence that refuses anything else there. */
const TOP_LEVEL_HOLDS =
  'a shader file declares functions, classes, types, enums, namespaces, constants, module ' +
  'variables and resources';

/** The sentence for a statement the top level cannot hold, naming it by the keyword it is
 *  written with (Rule 12.1): TypeScript's name for the node, `IfStatement` (or `LastStatement`
 *  for a `debugger`), is no word the author wrote. A statement a function body runs is told to
 *  move there; one a body refuses too says only why it is refused here. */
function topLevelRefusal(stmt: ts.Statement, sourceFile: ts.SourceFile): string {
  const runs = (what: string, fix = ' Move it into a function.'): string =>
    `${what} at the top level runs nowhere; ${TOP_LEVEL_HOLDS}.${fix}`;
  switch (stmt.kind) {
    case ts.SyntaxKind.IfStatement:
      return runs('An "if" statement');
    case ts.SyntaxKind.SwitchStatement:
      return runs('A "switch" statement');
    case ts.SyntaxKind.ForStatement:
      return runs('A "for" loop');
    case ts.SyntaxKind.ForOfStatement:
      return runs('A "for…of" loop');
    case ts.SyntaxKind.WhileStatement:
      return runs('A "while" loop');
    case ts.SyntaxKind.Block:
      return runs('A block, "{ … }",');
    case ts.SyntaxKind.ReturnStatement:
      return runs('A "return" statement');
    case ts.SyntaxKind.DoStatement:
      return runs('A "do…while" loop', '');
    case ts.SyntaxKind.ForInStatement:
      return runs('A "for…in" loop', '');
    case ts.SyntaxKind.TryStatement:
      return runs('A "try" statement', '');
    case ts.SyntaxKind.ThrowStatement:
      return runs('A "throw" statement', '');
    case ts.SyntaxKind.BreakStatement:
      return runs('A "break" statement', '');
    case ts.SyntaxKind.ContinueStatement:
      return runs('A "continue" statement', '');
    case ts.SyntaxKind.LabeledStatement:
      return runs(`A labelled statement, "${(stmt as ts.LabeledStatement).label.text}:",`, '');
    case ts.SyntaxKind.DebuggerStatement:
      return runs('A "debugger" statement', ' Remove it.');
    case ts.SyntaxKind.EmptyStatement:
      return runs('An empty statement, ";",', ' Remove it.');
  }
  const written = stmt.getText(sourceFile).replace(/\s+/g, ' ').replace(/;$/, '');
  const shown = written.length <= 60 ? written : `${written.slice(0, 60)}…`;
  if (ts.isImportEqualsDeclaration(stmt)) {
    const ref = stmt.moduleReference;
    return ts.isExternalModuleReference(ref)
      ? `"${shown}" is a CommonJS import; a shader file imports each function by name, ` +
          `import { f } from ${ref.expression.getText(sourceFile)}.`
      : `"${shown}" is an import alias; a shader file names "${ref.getText(sourceFile)}" ` +
          `where it reads it.`;
  }
  return `"${shown}" has no place at the top level; ${TOP_LEVEL_HOLDS}.`;
}

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
      push(diagnostics, sourceFile, stmt, topLevelRefusal(stmt, sourceFile), TS_CODES.TOP_LEVEL);
    }
  }
  visit(sourceFile, sourceFile, diagnostics);
}
