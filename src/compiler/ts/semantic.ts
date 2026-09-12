// Ban host/JS surface inside "use typeshade" files.

import ts from 'typescript'
import type { TsCompilerDiagnostic } from './source-file.js'
import { TS_CODES } from './codes.js'

const HOST_GLOBALS = new Set([
  'console', 'window', 'document', 'globalThis', 'global', 'self',
  'fetch', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'queueMicrotask', 'requestAnimationFrame', 'Promise', 'Date', 'JSON',
  'process', 'require', 'module', 'exports', 'eval', 'Function',
  'Array', 'Object', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'Error',
  'Proxy', 'Reflect', 'Atomics', 'SharedArrayBuffer', 'WebAssembly',
  'navigator', 'performance', 'crypto', 'GPU', 'GPUBuffer',
  'localStorage', 'sessionStorage', 'XMLHttpRequest', 'Worker', 'SharedWorker',
  'MessageChannel', 'TextDecoder', 'TextEncoder', 'URL', 'Blob',
  'atob', 'btoa', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'Number', 'String', 'Boolean', 'RegExp',
])

function spanOf(sourceFile: ts.SourceFile, node: ts.Node): { line: number; character: number } {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return { line: line + 1, character: character + 1 }
}

function push(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: string,
): void {
  const { line, character } = spanOf(sourceFile, node)
  diagnostics.push({ message, fileName: sourceFile.fileName, line, character, category: 'error', code })
}

function isPropertyName(node: ts.Identifier): boolean {
  const p = node.parent
  if (!p) return false
  if (ts.isPropertyAccessExpression(p) && p.name === node) return true
  if (ts.isQualifiedName(p) && p.right === node) return true
  if (ts.isPropertyAssignment(p) && p.name === node) return true
  if (ts.isPropertySignature(p) && p.name === node) return true
  return false
}

function visit(node: ts.Node, sourceFile: ts.SourceFile, diagnostics: TsCompilerDiagnostic[]): void {
  if (ts.isIdentifier(node) && HOST_GLOBALS.has(node.text) && !isPropertyName(node)) {
    push(
      diagnostics,
      sourceFile,
      node,
      `"${node.text}" is a host/JS API. "use typeshade" files cannot touch the JS runtime.`,
      TS_CODES.HOST_API,
    )
  }
  if (ts.isAwaitExpression(node)) {
    push(diagnostics, sourceFile, node, 'await is host control flow. Shader functions are synchronous.', TS_CODES.HOST_STMT)
  }
  if (ts.isYieldExpression(node)) {
    push(diagnostics, sourceFile, node, 'yield is not valid in a TypeShade function.', TS_CODES.HOST_STMT)
  }
  if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
    push(
      diagnostics,
      sourceFile,
      node,
      'for-of / for-in iterate JS objects. Use a counted `for (let i: i32 = 0; i < N; i++)`.',
      TS_CODES.HOST_STMT,
    )
  }
  if (ts.isTryStatement(node) || ts.isThrowStatement(node)) {
    push(diagnostics, sourceFile, node, 'try/catch/throw are JS exceptions. TypeShade has no exception path.', TS_CODES.HOST_STMT)
  }
  if (ts.isNewExpression(node)) {
    push(diagnostics, sourceFile, node, '`new` allocates a JS object. Use struct types and vec constructors.', TS_CODES.HOST_STMT)
  }
  if (ts.isTaggedTemplateExpression(node) || ts.isTemplateExpression(node)) {
    push(diagnostics, sourceFile, node, 'Template strings are JS. TypeShade has no string type.', TS_CODES.HOST_STMT)
  }
  if (ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) {
    push(diagnostics, sourceFile, node, 'Spread is a JS runtime operation.', TS_CODES.HOST_STMT)
  }
  if (ts.isFunctionDeclaration(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
    push(diagnostics, sourceFile, node, 'async functions are host. TypeShade functions are pure and synchronous.', TS_CODES.HOST_STMT)
  }
  if (ts.isFunctionDeclaration(node) && node.asteriskToken) {
    push(diagnostics, sourceFile, node, 'Generators are not TypeShade functions.', TS_CODES.HOST_STMT)
  }
  if (
    ts.isVariableStatement(node) &&
    (node.declarationList.flags & ts.NodeFlags.Let) === 0 &&
    (node.declarationList.flags & ts.NodeFlags.Const) === 0
  ) {
    push(diagnostics, sourceFile, node, '`var` is not allowed. Use `let` (mutable) or `const` (immutable).', TS_CODES.HOST_STMT)
  }
  ts.forEachChild(node, (child) => visit(child, sourceFile, diagnostics))
}

const ALLOWED_TOP = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ImportDeclaration,
  ts.SyntaxKind.ExportDeclaration,
  ts.SyntaxKind.ExportAssignment,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.ExpressionStatement,
])

export function analyzeSemantics(sourceFile: ts.SourceFile, diagnostics: TsCompilerDiagnostic[]): void {
  for (const stmt of sourceFile.statements) {
    if (ts.isExpressionStatement(stmt)) {
      const e = stmt.expression
      if (ts.isStringLiteral(e) && (e.text === 'use typeshade' || e.text === 'use strict')) continue
      push(
        diagnostics,
        sourceFile,
        stmt,
        'Top-level expressions are not a TypeShade program. Put work inside a function.',
        TS_CODES.TOP_LEVEL,
      )
      continue
    }
    if (ts.isVariableStatement(stmt)) {
      const isConst = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0
      const isLet = (stmt.declarationList.flags & ts.NodeFlags.Let) !== 0
      if (isLet) {
        push(
          diagnostics,
          sourceFile,
          stmt,
          'Top-level let is not a shader global. Use `const` or put the value inside a function.',
          TS_CODES.TOP_LEVEL,
        )
      } else if (!isConst) {
        push(
          diagnostics,
          sourceFile,
          stmt,
          'Top-level var is not allowed. Use `const` for a module constant.',
          TS_CODES.TOP_LEVEL,
        )
      }
      continue
    }
    if (!ALLOWED_TOP.has(stmt.kind)) {
      push(
        diagnostics,
        sourceFile,
        stmt,
        `Unsupported top-level "${ts.SyntaxKind[stmt.kind]}". A TypeShade file is directive + types + functions + imports.`,
        TS_CODES.TOP_LEVEL,
      )
    }
  }
  visit(sourceFile, sourceFile, diagnostics)
}
