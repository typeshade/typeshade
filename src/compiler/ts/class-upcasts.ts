// Implements: Rule 8.9 (docs/language-design.md; traced in reqs/).
import ts from 'typescript';
import type { Expr } from '../../core/ir/nodes.js';
import type { ShaderType } from '../../core/ir/types.js';
import { structT, typeKey } from '../../core/ir/types.js';
import type { LoweringScope } from './context.js';
import { mapTsTypeToShaderType } from './type-map.js';
import { classFunctionOf, type ClassFunction } from './lower/class-methods.js';
import { declarationOf } from './lower/closures.js';

function strip(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)
    ? strip(node.expression)
    : node;
}

/** The source type needed by the mutation proof. Unknown receivers are not evidence of safety. */
function sourceType(
  input: ts.Expression,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
  seen = new Set<ts.Node>(),
): ShaderType | undefined {
  const node = strip(input);
  if (seen.has(node)) return undefined;
  seen.add(node);
  if (ts.isIdentifier(node)) {
    const decl = declarationOf(node);
    if (decl !== undefined && (ts.isVariableDeclaration(decl) || ts.isParameter(decl))) {
      if (decl.type !== undefined) return mapTsTypeToShaderType(decl.type, sourceFile, []);
      if (decl.initializer !== undefined)
        return sourceType(decl.initializer, scope, sourceFile, seen);
    }
  }
  if (node.kind === ts.SyntaxKind.ThisKeyword) {
    for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
      if (ts.isClassDeclaration(at)) {
        const origin = scope.classOrigins().find((s) => s.classNode === at);
        return origin === undefined ? undefined : structT(origin.decl.name);
      }
    }
  }
  if (ts.isNewExpression(node)) {
    const text = node.expression.getText(sourceFile);
    const origins = scope
      .classOrigins()
      .filter((s) => s.classNode?.name?.text === text || s.decl.name === text.replaceAll('.', '_'));
    if (origins.length === 1) return structT(origins[0]!.decl.name);
  }
  if (ts.isPropertyAccessExpression(node)) {
    const base = sourceType(node.expression, scope, sourceFile, seen);
    if (base?.kind === 'struct') return scope.fieldType(base.name, node.name.text);
  }
  if (ts.isElementAccessExpression(node)) {
    const base = sourceType(node.expression, scope, sourceFile, seen);
    if (base?.kind === 'array') return base.elem;
  }
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node))
    return mapTsTypeToShaderType(node.type, sourceFile, []);
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    const decl = declarationOf(node.expression);
    if (decl !== undefined && ts.isFunctionDeclaration(decl) && decl.type !== undefined)
      return mapTsTypeToShaderType(decl.type, sourceFile, []);
  }
  return undefined;
}

function writtenTarget(node: ts.Node): ts.Expression | undefined {
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  )
    return node.left;
  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken)
  )
    return node.operand;
  return undefined;
}

/** A direct `this.field = value` initializes the fresh receiver, not an escaped argument. */
function constructorInitialization(node: ts.PropertyAccessExpression): boolean {
  if (strip(node.expression).kind !== ts.SyntaxKind.ThisKeyword) return false;
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (ts.isConstructorDeclaration(at)) return true;
    if (ts.isFunctionLike(at)) return false;
  }
  return false;
}

/** Reject any observable write to the projected hierarchy after construction, aliases included.
 * Resolve receiver declarations, never their spelling; an unknown receiver may alias the value. */
function projectedWrites(
  base: string,
  fields: ReadonlySet<string>,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
): boolean {
  let unsafe = false;
  const related = (name: string): boolean => name === base || scope.extendsStruct(name, base);
  const aliasesField = (input: ts.Expression, seen = new Set<ts.Node>()): boolean => {
    const node = strip(input);
    if (seen.has(node)) return false;
    seen.add(node);
    if (ts.isIdentifier(node)) {
      const decl = declarationOf(node);
      return decl !== undefined && ts.isVariableDeclaration(decl) && decl.initializer !== undefined
        ? aliasesField(decl.initializer, seen)
        : false;
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (fields.has(node.name.text)) {
        const receiver = sourceType(node.expression, scope, sourceFile);
        if (receiver === undefined || (receiver.kind === 'struct' && related(receiver.name)))
          return true;
      }
      return aliasesField(node.expression, seen);
    }
    return ts.isElementAccessExpression(node) && aliasesField(node.expression, seen);
  };
  const inspectTarget = (target: ts.Expression): void => {
    let at = strip(target);
    if (
      (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at)) &&
      aliasesField(at.expression)
    )
      unsafe = true;
    while (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at)) {
      if (ts.isPropertyAccessExpression(at) && fields.has(at.name.text)) {
        const receiver = sourceType(at.expression, scope, sourceFile);
        if (receiver === undefined || (receiver.kind === 'struct' && related(receiver.name))) {
          if (at !== strip(target) || !constructorInitialization(at)) unsafe = true;
        }
      }
      at = strip(at.expression);
    }
  };
  const visit = (node: ts.Node): void => {
    if (unsafe) return;
    const target = writtenTarget(node);
    if (target !== undefined) inspectTarget(target);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return unsafe;
}

/** All base-visible bodies must be the same source bodies on the concrete class. Reject all
 * receiver mutation and receiver escape, so transitive calls cannot detach identity or writes. */
function equivalentMethods(base: string, derived: string, scope: LoweringScope): boolean {
  const functions = scope
    .allCallees()
    .map(classFunctionOf)
    .filter((f): f is ClassFunction => f !== undefined);
  const methods = (name: string): ClassFunction[] =>
    functions.filter((f) => f.struct.decl.name === name && f.kind === 'method');
  const wanted = methods(base);
  const actual = methods(derived);
  if (scope.classOrigins().find((s) => s.decl.name === base)?.abstract) return false;
  for (const fn of wanted) {
    const match = actual.find((f) => f.member === fn.member && f.accessor === fn.accessor);
    if (
      match === undefined ||
      fn.node !== match.node ||
      fn.mutates ||
      match.mutates ||
      fn.returnsThis
    )
      return false;
  }
  for (const fn of actual) {
    // A derived-only method may still modify a base field through an alias.
    if (fn.mutates) return false;
    if (fn.node === undefined) continue;
    let escapes = false;
    const visit = (node: ts.Node): void => {
      if (node.kind === ts.SyntaxKind.ThisKeyword) {
        let parent: ts.Node = node.parent;
        while (ts.isParenthesizedExpression(parent)) parent = parent.parent;
        if (!ts.isPropertyAccessExpression(parent) || parent.expression !== node) escapes = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(fn.node);
    if (escapes) return false;
  }
  return true;
}

/** One contextual conversion authority. The generated function's one parameter guarantees
 * one evaluation of a factory/constructor argument, independently of optimization settings. */
export function readonlyClassUpcast(
  expr: Expr,
  want: ShaderType | undefined,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
): Expr {
  if (want?.kind !== 'struct' || expr.type.kind !== 'struct' || expr.type.name === want.name)
    return expr;
  const derived = expr.type.name;
  const base = want.name;
  if (!scope.extendsStruct(derived, base)) return expr;
  const origin = scope.classOrigins().find((s) => s.decl.name === base);
  const concrete = scope.classOrigins().find((s) => s.decl.name === derived);
  if (origin?.spelling !== 'class' || concrete?.spelling !== 'class') return expr;
  if (!equivalentMethods(base, derived, scope)) return expr;
  const fields = scope.structByName(base)?.fields;
  if (
    fields === undefined ||
    fields.some((f) => typeKey(scope.fieldType(derived, f.name) ?? want) !== typeKey(f.type))
  )
    return expr;
  if (projectedWrites(base, new Set(fields.map((f) => f.name)), scope, sourceFile)) return expr;
  const from = expr.type;
  const helper = scope.buildFunction(
    `class-upcast:${derived}:${base}`,
    `${derived}_as_${base}`,
    `${derived} as ${base}`,
    [],
    (name) => ({
      name,
      params: [{ name: 'value', type: from }],
      ret: want,
      body: [
        {
          s: 'return',
          expr: {
            op: 'construct',
            type: want,
            args: fields.map((f) => ({
              op: 'member',
              type: f.type,
              field: f.name,
              base: { op: 'param', name: 'value', type: from },
            })),
          },
        },
      ],
    }),
  );
  return helper === undefined
    ? expr
    : { op: 'call', type: want, fn: helper.name, declRef: helper, args: [expr] };
}
