// Implements: Rule 8.22 (docs/language-design.md; traced in reqs/).
// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
// ═══ A kernel function's Map and Set (change 0080; Rules 8.22 and 8.23) ═══
//
// A kernel function may take ECMAScript's `Set<K>` or `Map<K, V>` as a parameter, the caller's,
// passed by reference. Its members lower to five builtins every tier reads:
//
//   s.add(k)      collectionAdd(s, k)       a statement, in a loop
//   m.set(k, v)   collectionSet(m, k, v)    a statement, in a loop
//   c.has(k)      collectionHas(c, k)       a bool
//   m.get(k)      collectionGet(m, k)       a V, where an `m.has(k)` guards it
//   c.size        collectionSize(c)         a u32
//
// The CPU tier runs them over JavaScript's own `Map` and `Set` (`core/cpu-runtime.ts`), and it is
// the oracle. Rule 8.22 accepts an `add` or a `set` in a candidate loop as R3's append form, and
// refuses a read of the collection in a loop that adds to it.

import { logicalTypeKey as typeKey } from '../optional.js';
import ts from 'typescript';
import type { Expr } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { boolT, u32T, voidT } from '../../../core/ir/types.js';
import { TS_CODES, type TsCode } from '../codes.js';
import { authorTypeText, type LoweringScope } from '../context.js';
import { makeDiagnostic } from '../diagnostic.js';
import { retargetDeclaredIntLit } from '../lit-coerce.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { lowerExpression } from './expression.js';
import { collectionKeyOf } from '../key-types.js';

/** The builtins a Map's or a Set's members lower to (change 0080). */
export const COLLECTION_BUILTINS = [
  'collectionAdd',
  'collectionSet',
  'collectionHas',
  'collectionGet',
  'collectionSize',
] as const;

type Collection = Extract<ShaderType, { kind: 'collection' }>;

const spell = (t: Collection): string =>
  t.value === undefined ? `Set<${t.key}>` : `Map<${t.key}, ${authorTypeText(t.value)}>`;

const MEMBERS = {
  set: ['add', 'has', 'size'],
  map: ['set', 'has', 'get', 'size'],
} as const;

function diag(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode = TS_CODES.UNSUPPORTED,
): undefined {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code));
  return undefined;
}

/** The members of a `Map` or a `Set` this change takes, for a refusal's remedy. */
function membersOf(t: Collection): string {
  return (t.value === undefined ? MEMBERS.set : MEMBERS.map).join(', ');
}

/** The receiver of a member call or read, when it is a kernel function's Map or Set parameter
 *  itself. A collection anywhere else (a local that holds one) is refused here. */
function receiverOf(
  recv: Expr,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): (Expr & { type: Collection }) | undefined {
  if (recv.type.kind !== 'collection') return undefined;
  if (recv.op !== 'param')
    return diag(
      diagnostics,
      sourceFile,
      node,
      `A ${spell(recv.type)} is read through the kernel function's parameter only. Name the parameter itself.`,
    );
  return recv as Expr & { type: Collection };
}

/** The key argument, lowered to the collection's key type. */
function keyOf(
  arg: ts.Expression,
  t: Collection,
  what: string,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const keyT: ShaderType = collectionKeyOf(t) ?? { kind: 'scalar', scalar: t.key };
  return valueOf(arg, keyT, `${what} takes a key of`, sourceFile, scope, diagnostics);
}

function valueOf(
  arg: ts.Expression,
  want: ShaderType,
  saying: string,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const lowered = lowerExpression(arg, sourceFile, scope, diagnostics, want);
  if (lowered === undefined) return undefined;
  const value = retargetDeclaredIntLit(lowered, arg, want);
  if (typeKey(value.type) !== typeKey(want))
    return diag(
      diagnostics,
      sourceFile,
      arg,
      `${saying} ${authorTypeText(want)}; got a ${authorTypeText(value.type)}.`,
      TS_CODES.TYPE_MISMATCH,
    );
  return value;
}

/**
 * `s.add(k)`, `m.set(k, v)`, `c.has(k)` and `m.get(k)` on a kernel function's Map or Set
 * parameter (change 0080), or `'not-a-collection'` when `recv` is none.
 */
export function lowerCollectionCall(
  node: ts.CallExpression,
  callee: ts.PropertyAccessExpression,
  recv: Expr,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined | 'not-a-collection' {
  if (recv.type.kind !== 'collection') return 'not-a-collection';
  const c = receiverOf(recv, node, sourceFile, diagnostics);
  if (c === undefined) return undefined;
  const t = c.type;
  const name = callee.name.text;
  const at = `"${callee.expression.getText(sourceFile)}.${name}"`;
  const args = node.arguments;
  const isMap = t.value !== undefined;
  const known = (isMap ? MEMBERS.map : MEMBERS.set) as readonly string[];
  if (!known.includes(name) || name === 'size')
    return diag(
      diagnostics,
      sourceFile,
      callee.name,
      `A ${spell(t)} in a kernel function has ${membersOf(t)} (change 0080); "${name}" is not one of them.`,
    );
  const arity = name === 'set' ? 2 : 1;
  if (args.length !== arity)
    return diag(
      diagnostics,
      sourceFile,
      node,
      `${at} takes ${arity} argument${arity === 1 ? '' : 's'}; got ${args.length}.`,
      TS_CODES.TYPE_MISMATCH,
    );
  const key = keyOf(args[0]!, t, at, sourceFile, scope, diagnostics);
  if (key === undefined) return undefined;
  if (name === 'add' || name === 'set') {
    // A sequential run's entries, in the order of its iterations (Rule 8.22): only a loop says
    // which writes come first, and only a statement leaves nothing to read back.
    if (!scope.inLoop() || !ts.isExpressionStatement(node.parent))
      return diag(
        diagnostics,
        sourceFile,
        node,
        `${at} is a statement in a loop of the kernel function (change 0080). Write it on a line of its own inside a for loop.`,
      );
    if (name === 'add') return { op: 'call', type: voidT, fn: 'collectionAdd', args: [c, key] };
    const value = valueOf(
      args[1]!,
      t.value!,
      `${at} takes a value of`,
      sourceFile,
      scope,
      diagnostics,
    );
    if (value === undefined) return undefined;
    return { op: 'call', type: voidT, fn: 'collectionSet', args: [c, key, value] };
  }
  if (name === 'has') return { op: 'call', type: boolT, fn: 'collectionHas', args: [c, key] };
  // `m.get(k)`: a shader value has no `undefined`, so the key must be there (decision 4).
  if (!guarded(node, sourceFile))
    return diag(
      diagnostics,
      sourceFile,
      node,
      `${at} gives no value for a key the map does not hold, and a shader value has no undefined (change 0080). Read it where "${callee.expression.getText(sourceFile)}.has(${args[0]!.getText(sourceFile)})" is true: inside if (...) or before ? in a conditional.`,
    );
  return { op: 'call', type: t.value!, fn: 'collectionGet', args: [c, key] };
}

/** `c.size` on a kernel function's Map or Set parameter, a `u32`, or `'not-a-collection'`. */
export function lowerCollectionSize(
  node: ts.PropertyAccessExpression,
  base: Expr,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined | 'not-a-collection' {
  if (base.type.kind !== 'collection') return 'not-a-collection';
  const c = receiverOf(base, node, sourceFile, diagnostics);
  if (c === undefined) return undefined;
  if (node.name.text !== 'size')
    return diag(
      diagnostics,
      sourceFile,
      node.name,
      `A ${spell(c.type)} in a kernel function has ${membersOf(c.type)} (change 0080); "${node.name.text}" is not one of them.`,
    );
  return { op: 'call', type: u32T, fn: 'collectionSize', args: [c] };
}

// ─── The guard of a `get` ─────────────────────────────────────────────────────────────────────

/** The operands of a chain of `&&`, through parentheses. */
function conjuncts(e: ts.Expression): ts.Expression[] {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
    return [...conjuncts(e.left), ...conjuncts(e.right)];
  return [e];
}

/** Whether a key expression names the same value wherever it is read: names, members, elements,
 *  literals and arithmetic over them, and no call. */
function stable(e: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(e)) return stable(e.expression);
  if (ts.isIdentifier(e) || ts.isNumericLiteral(e) || ts.isStringLiteral(e)) return true;
  if (ts.isPropertyAccessExpression(e)) return stable(e.expression);
  if (ts.isElementAccessExpression(e)) return stable(e.expression) && stable(e.argumentExpression);
  if (ts.isPrefixUnaryExpression(e))
    return (
      e.operator !== ts.SyntaxKind.PlusPlusToken &&
      e.operator !== ts.SyntaxKind.MinusMinusToken &&
      stable(e.operand)
    );
  if (ts.isBinaryExpression(e))
    return !isAssignment(e.operatorToken.kind) && stable(e.left) && stable(e.right);
  return false;
}

function isAssignment(k: ts.SyntaxKind): boolean {
  return k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment;
}

/** The names a key expression reads. */
function namesIn(e: ts.Node, out = new Set<string>()): Set<string> {
  if (ts.isIdentifier(e)) out.add(e.text);
  ts.forEachChild(e, (c) => {
    // `a.b` reads `a`; the member name is no variable.
    if (ts.isPropertyAccessExpression(e) && c === e.name) return;
    namesIn(c, out);
  });
  return out;
}

/** Whether `region` assigns any of `names`. */
function assignsAny(region: ts.Node, names: ReadonlySet<string>): boolean {
  let found = false;
  // An assignment changes the name at the root of its target: `out[i] = v` changes `out`.
  const target = (t: ts.Expression): void => {
    let e = t;
    while (
      ts.isParenthesizedExpression(e) ||
      ts.isElementAccessExpression(e) ||
      ts.isPropertyAccessExpression(e) ||
      ts.isNonNullExpression(e)
    )
      e = e.expression;
    if (ts.isIdentifier(e) && names.has(e.text)) found = true;
  };
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isBinaryExpression(n) && isAssignment(n.operatorToken.kind)) target(n.left);
    if (
      (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
      (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)
    )
      target(n.operand);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && names.has(n.name.text))
      found = true;
    ts.forEachChild(n, visit);
  };
  visit(region);
  return found;
}

/** Whether `cond` holds `recv.has(key)` as one of its `&&` operands. */
function holdsHas(cond: ts.Expression, recv: string, key: string, sf: ts.SourceFile): boolean {
  return conjuncts(cond).some((c) => {
    if (!ts.isCallExpression(c) || c.arguments.length !== 1) return false;
    const f = c.expression;
    return (
      ts.isPropertyAccessExpression(f) &&
      f.name.text === 'has' &&
      f.expression.getText(sf) === recv &&
      c.arguments[0]!.getText(sf) === key
    );
  });
}

/**
 * Whether `m.get(k)` is read where `m.has(k)` is true (change 0080, decision 4): inside the
 * `then` of an `if`, after the `?` of a conditional, or right of an `&&`, whose condition holds
 * `m.has(k)` for the same `m` and the same `k`. The key reads no call, and nothing between the
 * guard and the read assigns a name it reads.
 */
function guarded(node: ts.CallExpression, sf: ts.SourceFile): boolean {
  const callee = node.expression as ts.PropertyAccessExpression;
  const keyNode = node.arguments[0]!;
  if (!stable(keyNode)) return false;
  const recv = callee.expression.getText(sf);
  const key = keyNode.getText(sf);
  const names = namesIn(keyNode);
  let child: ts.Node = node;
  for (let n = node.parent; n !== undefined; child = n, n = n.parent) {
    if (ts.isFunctionLike(n)) return false;
    const region =
      ts.isIfStatement(n) && child === n.thenStatement && holdsHas(n.expression, recv, key, sf)
        ? n.thenStatement
        : ts.isConditionalExpression(n) &&
            child === n.whenTrue &&
            holdsHas(n.condition, recv, key, sf)
          ? n.whenTrue
          : ts.isBinaryExpression(n) &&
              n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
              child === n.right &&
              holdsHas(n.left, recv, key, sf)
            ? n.right
            : undefined;
    if (region !== undefined) return !assignsAny(region, names);
  }
  return false;
}
