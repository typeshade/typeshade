// Ban host/JS surface inside "use typeshade" files.

import ts from 'typescript';
import type { TsCompilerDiagnostic } from './source-file.js';
import { TS_CODES, type TsCode } from './codes.js';
import { makeDiagnostic } from './diagnostic.js';
import { isEnableDirective } from './enables.js';
import { staticThisClass } from './class-names.js';
import { namespaceMemberName, refuseNamespaceStatement } from './namespaces.js';
import { mixinAppliedBy } from './mixins.js';

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
  const refused = REFUSED.get(sourceFile) ?? new Set<ts.Node>();
  refused.add(node);
  REFUSED.set(sourceFile, refused);
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
  // A statement the top level cannot hold was refused whole by analyzeSemantics, and nothing
  // under it is lowered, so neither its own form nor what it holds adds to that (Rule 12.4). A
  // `var` is read as the `let` it would have been, so what it holds is still read.
  if (node.parent === sourceFile && !ts.isVariableStatement(node) && refusedBySemantics(node)) {
    return;
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
  // to one read each (roadmap 0.3 item T7, #92); it says itself what it cannot spread. A spread
  // argument, `f(...args)`, needs an argument count known only at run time. A spread in a list,
  // `[...a, 3.]`, is refused here as well, so it is refused in a body no call lowers too; the
  // lowering, which knows what `a` is, names its elements in the sentence (expression-array.ts).
  // `...q` in a list that is assigned to, `[p, ...q] = a`, is a rest element, which collects
  // rather than spreads; the assignment's own refusal of that target is its one sentence.
  if (ts.isSpreadElement(node) && ts.isArrayLiteralExpression(node.parent)) {
    if (!isAssignedPattern(node.parent)) refuseListSpread(node, sourceFile, diagnostics);
  } else if (ts.isSpreadElement(node)) {
    push(diagnostics, sourceFile, node, 'Spread is a JS runtime operation.', TS_CODES.HOST_STMT);
  }
  // An async function or a generator, wherever it is written: a declaration, at the top level
  // or in a body (Rule 8.17), a function written as a value, or a class's method. Said here,
  // once, under the code its position has always had, so it is said in a body no call lowers
  // too; the lowering says nothing more about it.
  const asyncOrGenerator = asyncOrGeneratorRefusal(node);
  if (asyncOrGenerator !== undefined) {
    push(diagnostics, sourceFile, node, asyncOrGenerator.message, asyncOrGenerator.code);
  }
  // A `var` at the top level is analyzeSemantics' TS8014 below, and one in a namespace takes the
  // sentence a `let` there takes; this one is a body's. Each is the one sentence in both
  // compile paths, the multi-file one included, which walks no namespace.
  if (ts.isVariableStatement(node) && isVarStatement(node) && node.parent !== sourceFile) {
    if (ts.isModuleBlock(node.parent)) {
      const prefix = namespacePrefix(node.parent);
      if (prefix !== undefined) refuseNamespaceStatement(node, prefix, sourceFile, diagnostics);
    } else {
      push(
        diagnostics,
        sourceFile,
        node,
        '`var` is not allowed. Use `let` (mutable) or `const` (immutable).',
        TS_CODES.HOST_STMT,
      );
    }
  }
  if (holdsItsMistake(node)) return;
  ts.forEachChild(node, (child) => visit(child, sourceFile, diagnostics));
}

/** Whether a variable statement is a `var`. */
export function isVarStatement(node: ts.VariableStatement): boolean {
  return (node.declarationList.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0;
}

/** The flattened name the namespace walk gives the namespace a block belongs to, `N` or `A_B`;
 *  undefined for one it does not walk into, which is refused whole (namespaces.ts). */
function namespacePrefix(block: ts.ModuleBlock): string | undefined {
  let prefix: string | undefined;
  for (let at: ts.Node = block.parent; !ts.isSourceFile(at); at = at.parent) {
    if (ts.isModuleBlock(at)) continue;
    if (!ts.isModuleDeclaration(at) || !ts.isIdentifier(at.name)) return undefined;
    if (at.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) return undefined;
    prefix = prefix === undefined ? at.name.text : namespaceMemberName(at.name.text, prefix);
  }
  return prefix;
}

/** Whether what is under `node` is part of the one mistake refused at it, and is not read again
 *  (Rule 12.4): the operand of a `throw`, an `await` or a `yield`, the spans of a template
 *  string, what a spread spreads, and the whole of an async function or a generator refused
 *  above, so an `await` or a `yield` in it is not said again. `throw new Error("x")` is the
 *  `throw`. So is an object literal's async method or generator, which the literal refuses as
 *  a method (a literal holds fields). A `try` and a `for…in` hold statements of the author's
 *  own, and those are still read. */
function holdsItsMistake(node: ts.Node): boolean {
  return (
    ts.isThrowStatement(node) ||
    ts.isAwaitExpression(node) ||
    ts.isYieldExpression(node) ||
    ts.isTemplateExpression(node) ||
    ts.isTaggedTemplateExpression(node) ||
    ts.isSpreadElement(node) ||
    (ts.isFunctionLike(node) && refusedBySemantics(node)) ||
    (ts.isMethodDeclaration(node) &&
      ts.isObjectLiteralExpression(node.parent) &&
      isAsyncOrGenerator(node))
  );
}

/** Whether a list is the target of an assignment, `[p, ...q] = a`, or a part of one, or the
 *  head of a `for…of`: a pattern that takes values apart, where `...q` collects. */
function isAssignedPattern(node: ts.ArrayLiteralExpression): boolean {
  let at: ts.Node = node;
  while (
    ts.isParenthesizedExpression(at.parent) ||
    ts.isArrayLiteralExpression(at.parent) ||
    ts.isSpreadElement(at.parent) ||
    ts.isObjectLiteralExpression(at.parent) ||
    (ts.isPropertyAssignment(at.parent) && at.parent.initializer === at)
  ) {
    at = at.parent;
  }
  const holder = at.parent;
  return (
    (ts.isBinaryExpression(holder) &&
      holder.left === at &&
      holder.operatorToken.kind === ts.SyntaxKind.EqualsToken) ||
    ((ts.isForOfStatement(holder) || ts.isForInStatement(holder)) && holder.initializer === at)
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

/** The refusal of an async function or a generator, under the code its position has: a
 *  declaration is a host form (TS8013), a function written as a value a function shape (TS8020),
 *  and a class's method, or the function a class field holds, a class member (TS8035). An object
 *  literal's method is left to the literal, which has no form for a method at all. */
function asyncOrGeneratorRefusal(node: ts.Node): { message: string; code: TsCode } | undefined {
  if (!ts.isFunctionLike(node) || !isAsyncOrGenerator(node)) return undefined;
  if (ts.isFunctionDeclaration(node)) {
    return { message: asyncOrGeneratorMessage(node, node.name?.text), code: TS_CODES.HOST_STMT };
  }
  const member = ts.isMethodDeclaration(node)
    ? node
    : ts.isPropertyDeclaration(node.parent) && node.parent.initializer === node
      ? node.parent
      : undefined;
  if (member !== undefined) {
    if (!ts.isClassLike(member.parent)) return undefined;
    const written = member.name.getText();
    // A mixin's class has no name of its own; its method is the applying class's, `TD.m`.
    const owner = member.parent.name?.text ?? mixinAppliedBy(member.parent, node.getSourceFile());
    return {
      message: asyncOrGeneratorMessage(node, owner === undefined ? written : `${owner}.${written}`),
      code: TS_CODES.CLASS_MEMBER,
    };
  }
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return undefined;
  const named =
    node.name?.text ??
    (ts.isVariableDeclaration(node.parent) &&
    node.parent.initializer === node &&
    ts.isIdentifier(node.parent.name)
      ? node.parent.name.text
      : undefined);
  return { message: asyncOrGeneratorMessage(node, named), code: TS_CODES.FUNCTION_SHAPE };
}

/** The one sentence for an async function or a generator, named as written, or "This function"
 *  for one written with no name. The remedy names the return type to write when the one written
 *  is the wrapper an async function or a generator returns (`Promise<f32>`), which a plain
 *  function has no form for. */
function asyncOrGeneratorMessage(node: ts.SignatureDeclaration, name: string | undefined): string {
  const shown = name === undefined ? 'This function' : `"${name}"`;
  const isGenerator = (node as { asteriskToken?: ts.AsteriskToken }).asteriskToken !== undefined;
  const isAsync =
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false);
  const removed = [
    ...(isAsync ? ['"async"'] : []),
    ...(isGenerator ? ['the "*"'] : []),
    ...(isAsync && !isGenerator ? ['each "await"'] : []),
  ];
  const wrapped = wrappedReturn(node);
  if (wrapped === null) removed.push('its return type');
  const steps = [
    `Remove ${removed.slice(0, -1).join(', ')}${removed.length > 1 ? ' and ' : ''}${removed.at(-1)!}`,
    ...(typeof wrapped === 'string' ? [`write its return type as ${wrapped}`] : []),
    ...(isGenerator ? ['return one value'] : []),
  ];
  const remedy =
    steps.length === 1
      ? steps[0]!
      : steps.length === 2 && removed.length === 1
        ? `${steps[0]!} and ${steps[1]!}`
        : `${steps.slice(0, -1).join(', ')}, and ${steps.at(-1)!}`;
  const reason = isAsync ? 'there is no event loop to wait on' : 'nothing suspends it at a "yield"';
  const what = isAsync ? (isGenerator ? 'an async generator' : 'async') : 'a generator';
  return `${shown} is ${what}, and a shader function runs to completion in one call: ${reason}. ${remedy}.`;
}

/** The wrappers an async function or a generator is declared to return. */
const RETURN_WRAPPERS: ReadonlySet<string> = new Set([
  'Promise',
  'PromiseLike',
  'Generator',
  'Iterator',
  'Iterable',
  'IterableIterator',
  'AsyncGenerator',
  'AsyncIterator',
  'AsyncIterable',
  'AsyncIterableIterator',
]);

/** What an async function or a generator declares it hands back, once it is a plain function:
 *  `f32` for `Promise<f32>` or `Generator<f32>`, as written; `null` for a wrapper written with
 *  no type argument, which leaves nothing to write; undefined when no wrapper is written, and
 *  the return type stands as it is. */
function wrappedReturn(node: ts.SignatureDeclaration): string | null | undefined {
  const type = node.type;
  if (type === undefined || !ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName)) {
    return undefined;
  }
  if (!RETURN_WRAPPERS.has(type.typeName.text)) return undefined;
  return type.typeArguments?.[0]?.getText() ?? null;
}

/** The nodes `visit` and `analyzeSemantics` refused, per file: the lowering reads it where it
 *  has no form for a node, and says nothing more about one of these (Rule 12.4). Keyed by the
 *  file, so an edit, which the language service parses into a new one, starts from nothing. */
const REFUSED = new WeakMap<ts.SourceFile, Set<ts.Node>>();

/** Whether `analyzeSemantics` refused `node`, having said why. */
export function refusedBySemantics(node: ts.Node): boolean {
  return REFUSED.get(node.getSourceFile())?.has(node) ?? false;
}

/** Whether `analyzeSemantics` refused `node` or something written inside it that the lowering
 *  stops at. A body or a default the lowering could not finish for that reason has said why,
 *  though the lowering itself added nothing, so a call of it has nothing more to say (Rule
 *  12.4). A `var` is lowered as the `let` it would have been, so it stops nothing. */
export function refusalWithin(node: ts.Node): boolean {
  for (const refused of REFUSED.get(node.getSourceFile()) ?? []) {
    if (ts.isVariableStatement(refused)) continue;
    if (refused.pos >= node.pos && refused.end <= node.end) return true;
  }
  return false;
}

/** The nodes `analyzeSemantics` refused whole in `sourceFile`, having said why: a statement the
 *  top level cannot hold, and each node whose operand or body is part of its one mistake
 *  (`holdsItsMistake`). Nothing under one is read again, so a report of something inside it
 *  repeats that mistake; the editor's merged list drops TypeScript's (Rule 12.4). */
export function refusedWhole(sourceFile: ts.SourceFile): ts.Node[] {
  return [...(REFUSED.get(sourceFile) ?? [])].filter(
    (node) =>
      holdsItsMistake(node) || (node.parent === sourceFile && !ts.isVariableStatement(node)),
  );
}

/** The `var` statements `analyzeSemantics` refused in `sourceFile`: each is lowered as the
 *  `let` it would have been, so what TypeScript says of a `var` alone (a redeclaration, a read
 *  outside its block) belongs to that one mistake. */
export function refusedVars(sourceFile: ts.SourceFile): ts.VariableStatement[] {
  return [...(REFUSED.get(sourceFile) ?? [])].filter(ts.isVariableStatement);
}

/** A spread in a list `visit` refused, with the sentence that fits any operand, and where that
 *  diagnostic sits, so the lowering can put the one that names the operand's elements in its
 *  place. `named` is what every lowering of the list agreed the elements are; a generic body is
 *  lowered once per instance, and two instances that disagree leave the sentence that fits
 *  both. */
interface ListSpread {
  readonly diagnostics: TsCompilerDiagnostic[];
  said: TsCompilerDiagnostic;
  named: string | undefined;
  asked: boolean;
}

const LIST_SPREADS = new WeakMap<ts.SourceFile, Map<ts.SpreadElement, ListSpread>>();

function refuseListSpread(
  spread: ts.SpreadElement,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  push(diagnostics, sourceFile, spread, listSpreadMessage(spread, undefined), TS_CODES.HOST_STMT);
  const spreads = LIST_SPREADS.get(sourceFile) ?? new Map<ts.SpreadElement, ListSpread>();
  spreads.set(spread, { diagnostics, said: diagnostics.at(-1)!, named: undefined, asked: false });
  LIST_SPREADS.set(sourceFile, spreads);
}

/** `"...a" spreads a list into a list`, with the elements to write in its place when they are
 *  known (`a[0], a[1]`), and without them when they are not. */
function listSpreadMessage(spread: ts.SpreadElement, elements: string | undefined): string {
  const written = `"...${spread.expression.getText()}"`;
  return elements === undefined
    ? `${written} spreads into a list, which a shader array does not do: write the elements ` +
        `one by one.`
    : `${written} spreads a list into a list, which a shader array does not do: write its ` +
        `elements, ${elements}.`;
}

/** The lowering's word on a spread in a list: the elements its operand stands for, as the author
 *  writes them, or undefined when the operand is no list of known length. The sentence `visit`
 *  said is replaced by the one that names them; one `visit` did not say (a lowering run on its
 *  own) is said here, into `diagnostics`. */
export function nameListSpread(
  spread: ts.SpreadElement,
  elements: string | undefined,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  const said = LIST_SPREADS.get(sourceFile)?.get(spread);
  if (said === undefined) {
    diagnostics.push(
      makeDiagnostic(sourceFile, spread, listSpreadMessage(spread, elements), TS_CODES.HOST_STMT),
    );
    return;
  }
  const named = !said.asked || said.named === elements ? elements : undefined;
  said.asked = true;
  if (named === said.named) return;
  said.named = named;
  const at = said.diagnostics.indexOf(said.said);
  said.said = makeDiagnostic(
    sourceFile,
    spread,
    listSpreadMessage(spread, named),
    TS_CODES.HOST_STMT,
  );
  if (at >= 0) said.diagnostics[at] = said.said;
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
