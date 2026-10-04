// Implements: Rule 5.1 (docs/language-design.md; traced in reqs/).
import ts from 'typescript';
import type { ShaderType } from '../../core/ir/types.js';
import { i32T, u32T } from '../../core/ir/types.js';
import { isIntegerLiteralNode } from './lit-coerce.js';
import { declarationOf, functionAround } from './lower/closures.js';
import { newTargetOf, scopedDeclaration } from './lower/new-target.js';
import { namespaceMember } from './namespaces.js';
import { isStaticMember, writtenMemberName } from './class-names.js';

export interface LocalNumericInference {
  readonly type?: ShaderType;
  readonly conflict?: string;
}
const tables = new WeakMap<
  ts.SourceFile,
  ReadonlyMap<ts.VariableDeclaration, LocalNumericInference>
>();

function stripParens(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? stripParens(node.expression) : node;
}
function candidate(decl: ts.VariableDeclaration): boolean {
  if (decl.type !== undefined || decl.initializer === undefined || !ts.isIdentifier(decl.name))
    return false;
  if (!isIntegerLiteralNode(decl.initializer) || functionAround(decl) === undefined) return false;
  const list = decl.parent;
  return (
    ts.isVariableDeclarationList(list) &&
    ts.isVariableStatement(list.parent) &&
    (list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) !== 0
  );
}
/** Only a direct nongeneric function declaration with an implementation says a demand.
 * Reuse closure resolution so a shadowing variable or parameter cannot mean a module fn. */
function declaredParameter(call: ts.CallExpression, index: number): string | undefined {
  const callee = stripParens(call.expression);
  if (!ts.isIdentifier(callee)) return undefined;
  const decl = declarationOf(callee);
  if (
    decl === undefined ||
    !ts.isFunctionDeclaration(decl) ||
    decl.body === undefined ||
    (decl.typeParameters?.length ?? 0) !== 0
  )
    return undefined;
  return scalarAnnotation(decl.parameters[index]?.type);
}
function scalarAnnotation(type: ts.TypeNode | undefined): string | undefined {
  if (
    type === undefined ||
    !ts.isTypeReferenceNode(type) ||
    !ts.isIdentifier(type.typeName) ||
    (type.typeArguments?.length ?? 0) !== 0
  )
    return undefined;
  const name = type.typeName.text;
  return name === 'i32' || name === 'u32' || name === 'f32' || name === 'f64' ? name : undefined;
}

/** Source declarations are available before class lowering, including in the warning pass.
 * Resolve them through the same lexical/namespace authority as `new`, never emitted names. */
class DeclaredContexts {
  constructor(private readonly sourceFile: ts.SourceFile) {}

  private named(node: ts.Expression | ts.EntityName): ts.Node | undefined {
    if (ts.isIdentifier(node)) return scopedDeclaration(node);
    if (ts.isParenthesizedExpression(node)) return this.named(node.expression);
    if (ts.isPropertyAccessExpression(node) || ts.isQualifiedName(node)) {
      const parent = this.named(ts.isQualifiedName(node) ? node.left : node.expression);
      const name = ts.isQualifiedName(node) ? node.right : node.name;
      return parent !== undefined && ts.isModuleDeclaration(parent)
        ? namespaceMember(parent, name.text)
        : undefined;
    }
    return undefined;
  }

  private fromType(type: ts.TypeNode | undefined): ts.ClassLikeDeclaration | undefined {
    if (type === undefined || !ts.isTypeReferenceNode(type)) return undefined;
    const decl = this.named(type.typeName);
    return decl !== undefined && ts.isClassLike(decl) ? decl : undefined;
  }

  private enclosing(node: ts.Node): { cls: ts.ClassLikeDeclaration; static: boolean } | undefined {
    for (let at = node.parent; at !== undefined; at = at.parent) {
      if (ts.isArrowFunction(at)) continue;
      if (ts.isFunctionLike(at)) {
        return ts.isClassLike(at.parent)
          ? { cls: at.parent, static: isStaticMember(at) }
          : undefined;
      }
      if (ts.isPropertyDeclaration(at) && ts.isClassLike(at.parent)) {
        return { cls: at.parent, static: isStaticMember(at) };
      }
    }
    return undefined;
  }

  private base(cls: ts.ClassLikeDeclaration): ts.ClassLikeDeclaration | undefined {
    const expression = cls.heritageClauses?.find(
      (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
    )?.types[0]?.expression;
    const decl = expression === undefined ? undefined : this.named(expression);
    return decl !== undefined && ts.isClassLike(decl) ? decl : undefined;
  }

  private member(
    cls: ts.ClassLikeDeclaration,
    name: string,
    isStatic: boolean,
  ): ts.ClassElement | ts.ParameterDeclaration | undefined {
    const seen = new Set<ts.ClassLikeDeclaration>();
    for (let at: ts.ClassLikeDeclaration | undefined = cls; at !== undefined; at = this.base(at)) {
      if (seen.has(at)) return undefined;
      seen.add(at);
      const own = at.members.find(
        (member) =>
          member.name !== undefined &&
          writtenMemberName(member.name) === name &&
          isStaticMember(member) === isStatic,
      );
      if (own !== undefined) return own;
      if (!isStatic) {
        const ctor = at.members.find(ts.isConstructorDeclaration);
        const field = ctor?.parameters.find(
          (parameter) =>
            ts.isIdentifier(parameter.name) &&
            parameter.name.text === name &&
            ts.isParameterPropertyDeclaration(parameter, ctor!),
        );
        if (field !== undefined) return field;
      }
    }
    return undefined;
  }

  private receiver(
    expression: ts.Expression,
    seen: Set<ts.Node>,
  ): { cls: ts.ClassLikeDeclaration; static: boolean } | undefined {
    const node = stripParens(expression);
    if (node.kind === ts.SyntaxKind.ThisKeyword || node.kind === ts.SyntaxKind.SuperKeyword) {
      const owner = this.enclosing(node);
      if (owner === undefined) return undefined;
      const cls = node.kind === ts.SyntaxKind.SuperKeyword ? this.base(owner.cls) : owner.cls;
      return cls === undefined ? undefined : { cls, static: owner.static };
    }
    const named = this.named(node);
    if (named !== undefined && ts.isClassLike(named)) return { cls: named, static: true };
    if (ts.isNewExpression(node)) {
      const target = newTargetOf(node, this.sourceFile);
      return target.kind === 'class' ? { cls: target.decl, static: false } : undefined;
    }
    const cls = this.fromType(this.expressionType(node, seen));
    if (cls !== undefined) return { cls, static: false };
    if (ts.isIdentifier(node)) {
      const decl = declarationOf(node);
      if (
        decl !== undefined &&
        ts.isVariableDeclaration(decl) &&
        decl.type === undefined &&
        decl.initializer !== undefined &&
        !seen.has(decl)
      ) {
        seen.add(decl);
        const owner = this.receiver(decl.initializer, seen);
        seen.delete(decl);
        return owner;
      }
    }
    return undefined;
  }

  private accessed(
    node: ts.PropertyAccessExpression,
    seen: Set<ts.Node>,
  ): ts.ClassElement | ts.ParameterDeclaration | undefined {
    const owner = this.receiver(node.expression, seen);
    return owner === undefined ? undefined : this.member(owner.cls, node.name.text, owner.static);
  }

  private expressionType(expression: ts.Expression, seen: Set<ts.Node>): ts.TypeNode | undefined {
    const node = stripParens(expression);
    if (seen.has(node)) return undefined;
    seen.add(node);
    let type: ts.TypeNode | undefined;
    if (ts.isIdentifier(node)) {
      const decl = declarationOf(node);
      if (decl !== undefined && (ts.isVariableDeclaration(decl) || ts.isParameter(decl))) {
        type = decl.type;
        if (
          type === undefined &&
          ts.isVariableDeclaration(decl) &&
          decl.initializer !== undefined &&
          !seen.has(decl)
        ) {
          seen.add(decl);
          type = this.expressionType(decl.initializer, seen);
          seen.delete(decl);
        }
      }
    } else if (ts.isPropertyAccessExpression(node)) {
      const member = this.accessed(node, seen);
      if (
        member !== undefined &&
        (ts.isPropertyDeclaration(member) || ts.isGetAccessor(member) || ts.isParameter(member))
      ) {
        type = member.type;
      } else if (member !== undefined && ts.isSetAccessor(member)) {
        type = member.parameters[0]?.type;
      }
    } else if (ts.isCallExpression(node)) {
      type = this.callable(node, seen)?.type;
    } else if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      type = node.type;
    }
    seen.delete(node);
    return type;
  }

  private callable(
    node: ts.CallExpression,
    seen: Set<ts.Node>,
  ): ts.FunctionDeclaration | ts.MethodDeclaration | undefined {
    const callee = stripParens(node.expression);
    const decl = ts.isIdentifier(callee)
      ? declarationOf(callee)
      : ts.isPropertyAccessExpression(callee)
        ? this.accessed(callee, seen)
        : undefined;
    return decl !== undefined &&
      (ts.isFunctionDeclaration(decl) || ts.isMethodDeclaration(decl)) &&
      decl.body !== undefined
      ? decl
      : undefined;
  }

  parameter(node: ts.CallExpression | ts.NewExpression, index: number): string | undefined {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(stripParens(node.expression))) return declaredParameter(node, index);
      return scalarAnnotation(this.callable(node, new Set())?.parameters[index]?.type);
    }
    const target = newTargetOf(node, this.sourceFile);
    if (target.kind !== 'class') return undefined;
    const seen = new Set<ts.ClassLikeDeclaration>();
    for (
      let at: ts.ClassLikeDeclaration | undefined = target.decl;
      at !== undefined;
      at = this.base(at)
    ) {
      if (seen.has(at)) return undefined;
      seen.add(at);
      const ctor = at.members.find(ts.isConstructorDeclaration);
      if (ctor !== undefined)
        return ctor.body === undefined ? undefined : scalarAnnotation(ctor.parameters[index]?.type);
    }
    return undefined;
  }

  scalar(expression: ts.Expression): string | undefined {
    return scalarAnnotation(this.expressionType(expression, new Set()));
  }
}
function analyze(
  sourceFile: ts.SourceFile,
): ReadonlyMap<ts.VariableDeclaration, LocalNumericInference> {
  const demands = new Map<ts.VariableDeclaration, Set<string>>();
  const contexts = new DeclaredContexts(sourceFile);
  const demand = (expression: ts.Expression, type: string | undefined): void => {
    if (type === undefined) return;
    const argument = stripParens(expression);
    if (!ts.isIdentifier(argument)) return;
    const decl = declarationOf(argument);
    if (decl === undefined || !ts.isVariableDeclaration(decl) || !candidate(decl)) return;
    let types = demands.get(decl);
    if (types === undefined) demands.set(decl, (types = new Set()));
    types.add(type);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      for (const [index, arg] of (node.arguments ?? []).entries()) {
        demand(arg, contexts.parameter(node, index));
      }
    } else if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      demand(node.initializer, scalarAnnotation(node.type));
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      demand(node.right, contexts.scalar(node.left));
      demand(node.left, contexts.scalar(node.right));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const result = new Map<ts.VariableDeclaration, LocalNumericInference>();
  for (const [decl, types] of demands) {
    const kinds = [...types].sort();
    if (types.size > 1) {
      const name = (decl.name as ts.Identifier).text;
      result.set(decl, {
        conflict: `Cannot infer "${name}": its declared uses require ${kinds.join(' and ')}. Write an explicit type annotation on "${name}" and cast the arguments that need another type.`,
      });
    } else if (types.has('i32')) result.set(decl, { type: i32T });
    else if (types.has('u32')) result.set(decl, { type: u32T });
  }
  return result;
}
export function localNumericInference(
  decl: ts.VariableDeclaration,
  sourceFile: ts.SourceFile,
): LocalNumericInference | undefined {
  if (!candidate(decl)) return undefined;
  let table = tables.get(sourceFile);
  if (table === undefined) tables.set(sourceFile, (table = analyze(sourceFile)));
  return table.get(decl);
}
