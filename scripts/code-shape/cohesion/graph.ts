import ts from 'typescript';
import type { Declaration } from './declarations.js';

export const HUB_SHARE = 0.3;

export const HUB_MIN_DECLARATIONS = 8;

export interface ReferenceGraph {
  references: Set<number>[];
  imports: Set<string>[];
}

function importSpecifierOf(symbol: ts.Symbol): string | undefined {
  if ((symbol.flags & ts.SymbolFlags.Alias) === 0) return undefined;
  for (const declaration of symbol.declarations ?? []) {
    let node: ts.Node | undefined = declaration;
    while (node !== undefined && !ts.isImportDeclaration(node)) node = node.parent;
    if (node !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      return node.moduleSpecifier.text;
    }
  }
  return undefined;
}

function symbolOf(checker: ts.TypeChecker, identifier: ts.Identifier): ts.Symbol | undefined {
  const parent = identifier.parent;
  if (ts.isShorthandPropertyAssignment(parent) && parent.name === identifier) {
    return checker.getShorthandAssignmentValueSymbol(parent);
  }
  return checker.getSymbolAtLocation(identifier);
}

export function referenceGraph(
  checker: ts.TypeChecker,
  declarations: readonly Declaration[],
): ReferenceGraph {
  const index = new Map<ts.Symbol, number>();
  declarations.forEach((declaration, at) => {
    if (declaration.symbol !== undefined) index.set(declaration.symbol, at);
  });
  const references = declarations.map(() => new Set<number>());
  const imports = declarations.map(() => new Set<string>());
  declarations.forEach((declaration, from) => {
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        const symbol = symbolOf(checker, node);
        const target = symbol === undefined ? undefined : index.get(symbol);
        if (target !== undefined && target !== from) references[from]!.add(target);
        const specifier = symbol === undefined ? undefined : importSpecifierOf(symbol);
        if (specifier !== undefined) imports[from]!.add(specifier);
      }
      ts.forEachChild(node, visit);
    };
    declaration.nodes.forEach(visit);
  });
  return { references, imports };
}

export function hubsOf(graph: ReferenceGraph): Set<number> {
  const count = graph.references.length;
  const hubs = new Set<number>();
  if (count < HUB_MIN_DECLARATIONS) return hubs;
  const referencedBy = new Array<number>(count).fill(0);
  for (const targets of graph.references) {
    for (const target of targets) referencedBy[target] = (referencedBy[target] ?? 0) + 1;
  }
  referencedBy.forEach((total, at) => {
    if (total / (count - 1) > HUB_SHARE) hubs.add(at);
  });
  return hubs;
}
