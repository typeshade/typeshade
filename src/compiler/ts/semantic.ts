// Ban host/JS surface inside "use typeshade" files: host control flow and the runtime forms no
// shader has. A NAME is not judged here by its spelling, except `eval` and `arguments`, which
// strict mode lets no declaration bind, and `require("./x")`, an import as `import("./x")` is
// (Rule 3.9). It is resolved where it is used, and one nothing declares is an unknown name of
// the code that owns its position (Rule 2.1). Three of those are
// said here, on the syntax, because the lowering reaches a body once per instance or not at
// all: a `new` that builds no class and a type name nothing declares, before the lowering, and a
// value or a callee nothing declares, after it ({@link reportUndeclaredValues}).

import ts from 'typescript';
import type { TsCompilerDiagnostic } from './source-file.js';
import { ATTRIBUTE_NAMES, checkDeclarationDecorators } from './builtin-check.js';
import { isResourceCall } from './bindings.js';
import { isOverrideType } from './overrides.js';
import { TS_CODES, type TsCode } from './codes.js';
import { makeDiagnostic } from './diagnostic.js';
import { isEnableDirective } from './enables.js';
import {
  namespaceMemberName,
  refusedInNamespace,
  refuseNamespaceStatement,
  statementRefusal,
} from './namespaces.js';
import { mixinAppliedBy } from './mixins.js';
import { foreignNameRemedy } from './foreign-names.js';
import {
  LIBRARY_TYPE_NAMES,
  undeclaredGenericBase,
  undeclaredTypeName,
  unknownTypeSentence,
} from './type-map.js';
import { declaredValueNamesOf, namesInScope } from './unknown-names.js';
import { declarationOf } from './lower/closures.js';
import { newRefusal } from './lower/new-target.js';
import {
  builtinValueNames,
  unknownIdentifierSentence,
  unknownValueSentence,
} from './lower/expression.js';
import { unknownFunctionSentence } from './lower/expression-call.js';

function push(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code));
  markRefused(sourceFile, node);
}

function markRefused(sourceFile: ts.SourceFile, node: ts.Node): void {
  const refused = REFUSED.get(sourceFile) ?? new Set<ts.Node>();
  refused.add(node);
  REFUSED.set(sourceFile, refused);
}

/** Whether `node` is written directly as an argument of `console.<method>(...)`. */
export function isConsoleArgument(node: ts.Node): boolean {
  const call = node.parent;
  return (
    call !== undefined &&
    ts.isCallExpression(call) &&
    call.arguments.some((a) => a === node) &&
    ts.isPropertyAccessExpression(call.expression) &&
    ts.isIdentifier(call.expression.expression) &&
    call.expression.expression.text === 'console'
  );
}

/** The argument list a template becomes: its text as labels and each hole as a value. */
function consoleRemedy(node: ts.TemplateExpression, sourceFile: ts.SourceFile): string {
  const parts: string[] = [];
  const text = (t: string): void => {
    if (t.trim() !== '') parts.push(JSON.stringify(t.trim()));
  };
  text(node.head.text);
  for (const span of node.templateSpans) {
    parts.push(span.expression.getText(sourceFile));
    text(span.literal.text);
  }
  return parts.join(', ');
}

/** A dynamic import, `import("./x")`, or a `require("./x")`: the call, and the node its refusal
 *  goes on: the specifier for `import(...)`, where TypeScript reports an unresolved one, and
 *  `require`, where TypeScript reports a name it cannot find. */
function dynamicImportOf(
  node: ts.Node,
): { call: ts.CallExpression; at: ts.Node; specifier: string } | undefined {
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const arg = node.arguments[0];
    return arg !== undefined && ts.isStringLiteralLike(arg)
      ? { call: node, at: arg, specifier: arg.text }
      : { call: node, at: node, specifier: './file.shade.ts' };
  }
  const call = node.parent;
  if (
    ts.isIdentifier(node) &&
    node.text === 'require' &&
    call !== undefined &&
    ts.isCallExpression(call) &&
    call.expression === node
  ) {
    const arg = call.arguments[0];
    if (arg !== undefined && ts.isStringLiteralLike(arg)) {
      return { call, at: node, specifier: arg.text };
    }
  }
  return undefined;
}

function visit(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  // A statement a namespace does not hold is refused whole where the namespace is walked
  // (namespaces.ts): what it is and what it holds add nothing to that sentence (Rule 12.4).
  if (ts.isModuleBlock(node)) {
    for (const stmt of node.statements) {
      if (!refusedInNamespace(stmt)) visit(stmt, sourceFile, diagnostics);
    }
    return;
  }
  // A declaration that binds `eval` or `arguments`, which strict mode forbids (Rule 2.1). The
  // declaration still lowers, so nothing is marked refused and a use of the name says nothing.
  const strict = strictModeBinding(node);
  if (strict !== undefined) {
    diagnostics.push(
      makeDiagnostic(sourceFile, strict.name, strict.message, TS_CODES.RESERVED_NAME),
    );
  }
  // `import("./x")` and `require("./x")`: a shader module is imported statically (Rule 3.9).
  // On the specifier and on `require`, where TypeScript reports the same mistake (Rule 12.4),
  // and the call is refused whole, so its string and an unknown `require` say nothing more.
  const imported = dynamicImportOf(node);
  if (imported !== undefined) {
    push(
      diagnostics,
      sourceFile,
      imported.at,
      `A shader module is imported by an import declaration at the top of the file: ` +
        `import { name } from "${imported.specifier}".`,
      TS_CODES.IMPORT,
    );
    markRefused(sourceFile, imported.call);
  }
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
  if (ts.isTaggedTemplateExpression(node) || ts.isTemplateExpression(node)) {
    push(
      diagnostics,
      sourceFile,
      node,
      ts.isTemplateExpression(node) && isConsoleArgument(node)
        ? // A label is text the host keeps (Rule 7.8), so a literal one is fine; the holes are
          // what a shader cannot build, and each is an argument of its own.
          `A template with a value in it builds text at run time, which a shader has no string ` +
            `for. Pass the text and the value as two arguments: console.log(${consoleRemedy(node, sourceFile)}).`
        : 'Template strings are JS. TypeShade has no string type.',
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
      // Refused whole, as a `let` there is (namespaces.ts): what it holds adds nothing.
      return;
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

/** The two names ECMAScript's strict mode lets no declaration bind. Every `"use typeshade"` file
 *  is strict code, so TypeScript refuses such a binding (TS1215, TS1210 in a class, TS1100),
 *  and the JavaScript the host import generates from the file would not load. */
export const STRICT_MODE_NAMES: ReadonlySet<string> = new Set(['eval', 'arguments']);

/**
 * The binding `node` makes of a {@link STRICT_MODE_NAMES} name, where TypeScript refuses it, and
 * the one sentence for it: a parameter, a function's name, and a variable, which is a local in a
 * body and a module constant, a module variable, a binding or an override at the top level or
 * in a namespace. A class, an enum, a namespace or a type of the name is a declaration
 * TypeScript takes, and so does this front end (Rule 2.1).
 */
function strictModeBinding(node: ts.Node): { name: ts.Identifier; message: string } | undefined {
  const name =
    ts.isParameter(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isBindingElement(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node)
      ? node.name
      : undefined;
  if (name === undefined || !ts.isIdentifier(name) || !STRICT_MODE_NAMES.has(name.text)) {
    return undefined;
  }
  const noun = bindingNoun(node);
  return {
    name,
    message:
      `"${name.text}" is reserved in ECMAScript's strict mode, which every "use typeshade" ` +
      `file is in, so ${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun} of that name cannot be ` +
      `declared. Rename it.`,
  };
}

/** What the author calls what `node` declares, in the words `reserved-names.ts` uses. A name in
 *  a pattern is what the pattern declares. */
function bindingNoun(node: ts.Node): string {
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) return 'function';
  let at = node;
  while (ts.isBindingElement(at) || ts.isObjectBindingPattern(at) || ts.isArrayBindingPattern(at)) {
    at = at.parent;
  }
  if (ts.isParameter(at)) return 'parameter';
  const statement = at.parent.parent;
  if (
    !ts.isVariableDeclaration(at) ||
    !ts.isVariableStatement(statement) ||
    !(ts.isSourceFile(statement.parent) || ts.isModuleBlock(statement.parent))
  ) {
    return 'local';
  }
  if ((at.parent.flags & ts.NodeFlags.Const) === 0) return 'module variable';
  const declared = statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword);
  if (declared === true || (at.initializer !== undefined && isResourceCall(at.initializer))) {
    return 'binding';
  }
  return isOverrideType(at.type) ? 'override' : 'module constant';
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

/** Carries what `analyzeSemantics` refused in a linked source (Rule 3.9, `link.ts`) to a file it
 *  was linked from: each refused node that `map` places in `to` marks the node of the same kind
 *  at that span there. The editor reads the refusals of the file it shows off that file. */
export function carryRefusals(
  from: ts.SourceFile,
  to: ts.SourceFile,
  map: (start: number, end: number) => { readonly start: number; readonly end: number } | undefined,
): void {
  for (const node of REFUSED.get(from) ?? []) {
    const at = map(node.getStart(from), node.getEnd());
    if (at === undefined) continue;
    let found: ts.Node | undefined;
    const find = (n: ts.Node): void => {
      if (found !== undefined || n.getStart(to) > at.start || n.getEnd() < at.end) return;
      if (n.kind === node.kind && n.getStart(to) === at.start && n.getEnd() === at.end) found = n;
      else ts.forEachChild(n, find);
    };
    ts.forEachChild(to, find);
    if (found !== undefined) markRefused(to, found);
  }
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

/** What a file holds at the top level, for the sentence that refuses anything else there. */
const TOP_LEVEL_HOLDS =
  'a shader file declares functions, classes, types, enums, namespaces, constants, module ' +
  'variables and resources';

export function analyzeSemantics(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  // A decorator nothing reads (Rule 6.7): on a binding, an override, a constant, a variable, an
  // enum, an interface, a type alias, a namespace, a local function or class, a static field, a
  // constructor, an overload signature, an abstract member or a mixin, beside whatever else the
  // declaration is refused for.
  checkDeclarationDecorators(diagnostics, sourceFile);
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
      const said = statementRefusal(stmt, sourceFile, 'at the top level', TOP_LEVEL_HOLDS);
      push(diagnostics, sourceFile, stmt, said, TS_CODES.TOP_LEVEL);
    }
  }
  // A statement the loop above refuses by its kind is refused whole: what it is and what it holds
  // add nothing to that sentence, so a `try`, a `throw` or a `for…in` there is not told again
  // that it is a host form (Rule 12.4).
  for (const stmt of sourceFile.statements) {
    if (ALLOWED_TOP.has(stmt.kind) || ts.isVariableStatement(stmt)) {
      visit(stmt, sourceFile, diagnostics);
    }
  }
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

/** The sentence and the code for `id`, a name nothing declares, read as `use`: what a value, a
 *  callee and an assignment target each say, with the remedy in the one order (Rule 12.1).
 *  Undefined where the declaration the name resolves to said it (Rule 12.4). */
function undeclaredValueReport(
  id: ts.Identifier,
  use: 'value' | 'callee' | 'assigned',
): { readonly message: string; readonly code: TsCode } | undefined {
  const message =
    use === 'callee'
      ? unknownFunctionSentence(id)
      : use === 'assigned'
        ? unknownIdentifierSentence(id, `Cannot assign to unknown name "${id.text}".`)
        : unknownValueSentence(id);
  // No sentence: the declaration's own refusal is the one diagnostic (Rule 12.4).
  if (message === undefined) return undefined;
  return { message, code: use === 'callee' ? TS_CODES.UNKNOWN_FN : TS_CODES.UNKNOWN_NAME };
}

/**
 * What the compiler says of `id`, a GLSL or HLSL name nothing declares (`FOREIGN_NAMES`, #218),
 * wherever it stands: the sentence of its place and TypeShade's spelling (Rule 12.1), under the
 * code of its place (`TS8004` for a callee, `TS8022` for a value or a target, `TS8002` for a
 * type). Undefined for any other name, for one a declaration gives, and for a place the
 * sentence does not fit: a decorator, whose own refusal says what the attribute is, and a
 * position that is no read of a name.
 *
 * The lowering reads a name where it lowers the construct that holds it, and a construct the
 * compiler refuses is not always lowered: an `fmod` in a `try`, or in a list with no type
 * annotation, is said by no one but TypeScript, whose guess for it is `mod`, which floors where
 * `fmod` truncates. The editor puts this sentence in place of TypeScript's there, so it shows
 * the one remedy the compiler gives (`mergeDiagnostics`, Rule 12.7).
 */
export function foreignNameReport(
  id: ts.Identifier,
): { readonly message: string; readonly code: TsCode } | undefined {
  if (foreignNameRemedy(id.text) === undefined || ts.findAncestor(id, ts.isDecorator)) {
    return undefined;
  }
  const reference = id.parent;
  if (ts.isTypeReferenceNode(reference) && reference.typeName === id) {
    // Said where the compiler says a type nothing declares, bare or the base of a generic, and
    // nowhere else: an argument the generic around it takes the sentence of (`vec3<float>`) is
    // that one diagnostic (Rule 12.4).
    const file = id.getSourceFile();
    return (undeclaredTypeName(reference, file) ?? undeclaredGenericBase(reference, file)) === id
      ? {
          message: unknownTypeSentence(id.text, namesInScope(id, 'type')),
          code: TS_CODES.UNKNOWN_TYPE,
        }
      : undefined;
  }
  const use = declarationOf(id) === undefined ? useOf(id) : undefined;
  return use === undefined ? undefined : undeclaredValueReport(id, use);
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
    const report = undeclaredValueReport(id, use);
    if (report !== undefined) push(diagnostics, sourceFile, id, report.message, report.code);
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
