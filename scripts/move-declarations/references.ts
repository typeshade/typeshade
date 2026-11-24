import ts from 'typescript';
import type { Side } from '../move-purity/side-program.js';
import { analyzeSource, type Unit } from '../move-purity/units.js';

export interface Usage {
  value: boolean;
  type: boolean;
}

interface LocalReference {
  readonly from: number;
  readonly to: number;
  readonly name: string;
  readonly typeOnly: boolean;
}

interface ImportReference {
  readonly from: number;
  readonly binding: ts.Declaration;
  readonly typeOnly: boolean;
}

export interface SourceAnalysis {
  readonly path: string;
  readonly source: ts.SourceFile;
  readonly units: readonly Unit[];
  readonly locals: readonly LocalReference[];
  readonly imports: readonly ImportReference[];
}

function isHeritageOfClass(clause: ts.Node): boolean {
  return (
    ts.isHeritageClause(clause) &&
    clause.token === ts.SyntaxKind.ExtendsKeyword &&
    ts.isClassLike(clause.parent)
  );
}

export function isTypePosition(identifier: ts.Identifier): boolean {
  let current: ts.Node = identifier;
  while (current.parent && !ts.isSourceFile(current.parent)) {
    const parent: ts.Node = current.parent;
    if (ts.isExpressionWithTypeArguments(parent)) return !isHeritageOfClass(parent.parent);
    if (ts.isExportSpecifier(parent)) return parent.isTypeOnly || parent.parent.parent.isTypeOnly;
    if (ts.isTypeNode(parent) || ts.isInterfaceDeclaration(parent)) return true;
    if (ts.isTypeAliasDeclaration(parent)) return true;
    current = parent;
  }
  return false;
}

function symbolOf(checker: ts.TypeChecker, identifier: ts.Identifier): ts.Symbol | undefined {
  const parent = identifier.parent;
  if (ts.isShorthandPropertyAssignment(parent) && parent.name === identifier) {
    return checker.getShorthandAssignmentValueSymbol(parent);
  }
  if (ts.isExportSpecifier(parent)) {
    const local = parent.propertyName ?? parent.name;
    return local === identifier ? checker.getExportSpecifierLocalTargetSymbol(parent) : undefined;
  }
  return checker.getSymbolAtLocation(identifier);
}

const isImportBinding = (declaration: ts.Declaration): boolean =>
  ts.isImportSpecifier(declaration) ||
  ts.isImportClause(declaration) ||
  ts.isNamespaceImport(declaration);

function statementOf(declaration: ts.Declaration, source: ts.SourceFile): ts.Node | undefined {
  if (declaration.parent === source) return declaration;
  if (
    ts.isVariableDeclaration(declaration) &&
    ts.isVariableDeclarationList(declaration.parent) &&
    declaration.parent.parent.parent === source
  ) {
    return declaration.parent.parent;
  }
  return undefined;
}

export function analyzeReferences(side: Side, path: string): SourceAnalysis {
  const source = side.sourceOf(path);
  if (source === undefined) throw new Error(`${path} is not in the program`);
  const { units } = analyzeSource(source, path);
  const indexOf = new Map<ts.Node, number>(units.map((unit, index) => [unit.node, index]));
  const locals: LocalReference[] = [];
  const imports: ImportReference[] = [];
  const visit = (node: ts.Node, from: number): void => {
    if (ts.isIdentifier(node)) {
      const symbol = symbolOf(side.checker, node);
      const typeOnly = isTypePosition(node);
      for (const declaration of symbol?.declarations ?? []) {
        if (declaration.getSourceFile() !== source) continue;
        if (isImportBinding(declaration)) {
          imports.push({ from, binding: declaration, typeOnly });
          continue;
        }
        const statement = statementOf(declaration, source);
        const to = statement === undefined ? undefined : indexOf.get(statement);
        if (to !== undefined) locals.push({ from, to, name: node.text, typeOnly });
      }
    }
    ts.forEachChild(node, (child) => visit(child, from));
  };
  units.forEach((unit, index) => visit(unit.node, index));
  return { path, source, units, locals, imports };
}
