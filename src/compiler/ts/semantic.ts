// Ban host/JS surface inside "use typeshade" files.

import ts from 'typescript';
import type { TsCompilerDiagnostic } from './source-file.js';
import { TS_CODES, type TsCode } from './codes.js';
import { makeDiagnostic } from './diagnostic.js';
import { isEnableDirective } from './enables.js';

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
  if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
    push(
      diagnostics,
      sourceFile,
      node,
      'for-of / for-in iterate JS objects. Use a counted `for (let i: i32 = 0; i < N; i++)`.',
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
          `A class this file declares is built with "new", and "${shown}" is not one of them. ` +
            `"new" on anything else allocates a JS object, which a shader has no heap for.`,
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
      // refusals, and a `declare let` is a binding.
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
