import ts from 'typescript';
import { declaresEntry, stageCallOf } from '../stage-call.js';
import type { Unit } from './types.js';

const ENTRY_DECORATORS = new Set(['vertex', 'fragment', 'compute']);

export function topStatementOf(node: ts.Node): ts.Statement | undefined {
  let n: ts.Node = node;
  while (n.parent !== undefined && !ts.isSourceFile(n.parent)) n = n.parent;
  return n.parent !== undefined && ts.isSourceFile(n.parent) ? (n as ts.Statement) : undefined;
}

export function isTopLevelDeclaration(decl: ts.Node): boolean {
  if (ts.isVariableDeclaration(decl) || ts.isBindingElement(decl)) {
    const stmt = topStatementOf(decl);
    return stmt !== undefined && ts.isVariableStatement(stmt);
  }
  return decl.parent !== undefined && ts.isSourceFile(decl.parent);
}

export function declaredNames(stmt: ts.Statement): ts.Identifier[] {
  if (
    (ts.isFunctionDeclaration(stmt) ||
      ts.isClassDeclaration(stmt) ||
      ts.isInterfaceDeclaration(stmt) ||
      ts.isTypeAliasDeclaration(stmt) ||
      ts.isEnumDeclaration(stmt) ||
      ts.isModuleDeclaration(stmt)) &&
    stmt.name !== undefined &&
    ts.isIdentifier(stmt.name)
  ) {
    return [stmt.name];
  }
  if (ts.isVariableStatement(stmt)) {
    const out: ts.Identifier[] = [];
    const visit = (name: ts.BindingName): void => {
      if (ts.isIdentifier(name)) out.push(name);
      else for (const e of name.elements) if (!ts.isOmittedExpression(e)) visit(e.name);
    };
    for (const d of stmt.declarationList.declarations) visit(d.name);
    return out;
  }
  return [];
}

export const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((m) => m.kind === kind) ?? false);

export function fixedNameOf(stmt: ts.Statement): Unit['fixedName'] {
  if (ts.isFunctionDeclaration(stmt)) {
    // Why: a decorator on a function declaration is not TypeScript's grammar, so the parser
    // leaves it among the modifiers rather than where `getDecorators` looks.
    for (const m of stmt.modifiers ?? []) {
      if (!ts.isDecorator(m)) continue;
      const e = ts.isCallExpression(m.expression) ? m.expression.expression : m.expression;
      if (ts.isIdentifier(e) && ENTRY_DECORATORS.has(e.text)) return 'entry point';
    }
    return undefined;
  }
  if (!ts.isVariableStatement(stmt)) return undefined;
  const stage = stageCallOf(stmt);
  if (stage !== undefined) return declaresEntry(stage.callee) ? 'entry point' : undefined;
  const declared = hasModifier(stmt, ts.SyntaxKind.DeclareKeyword);
  for (const d of stmt.declarationList.declarations) {
    const t = d.type;
    if (
      t !== undefined &&
      ts.isTypeReferenceNode(t) &&
      ts.isIdentifier(t.typeName) &&
      t.typeName.text === 'override'
    ) {
      return 'override';
    }
    const init = d.initializer;
    if (
      init !== undefined &&
      ts.isCallExpression(init) &&
      ts.isIdentifier(init.expression) &&
      (init.expression.text === 'uniform' || init.expression.text === 'storage')
    ) {
      return 'binding';
    }
    const brand =
      t !== undefined && ts.isTypeOperatorNode(t) && t.operator === ts.SyntaxKind.UniqueKeyword;
    if (declared && t !== undefined && !brand) return 'binding';
  }
  return undefined;
}
