import ts from 'typescript';
import { identifiersOf, type Keyer } from './binding-keys.js';
import type { Side } from './side-program.js';
import { isModuleLink, type Unit } from './units.js';

export interface Link {
  readonly kind: 'import' | 'export';
  readonly target: string;
  readonly sideEffect: boolean;
  readonly valueLoad: boolean;
  readonly names: Map<string, boolean>;
}

export interface Links {
  of(path: string): Link[];
  targetOf(source: ts.SourceFile, specifier: string): string;
  referencedTargets(unit: Unit): Set<string>;
}

const NODE_MODULES = '/node_modules/';

export function createLinks(side: Side, keyer: Keyer): Links {
  const cache = new Map<string, string>();
  const targetOf = (source: ts.SourceFile, specifier: string): string => {
    const key = `${source.fileName}\0${specifier}`;
    const known = cache.get(key);
    if (known !== undefined) return known;
    const resolved = ts.resolveModuleName(
      specifier,
      source.fileName,
      side.options,
      side.host,
    ).resolvedModule;
    let target = `unresolved:${specifier}`;
    if (resolved) {
      const name = resolved.resolvedFileName;
      const at = name.lastIndexOf(NODE_MODULES);
      target =
        side.pathOf(name) ??
        (at >= 0 ? `ext:${name.slice(at + NODE_MODULES.length)}` : `ext:${name}`);
    }
    cache.set(key, target);
    return target;
  };

  const importLink = (source: ts.SourceFile, node: ts.ImportDeclaration): Link => {
    const target = targetOf(source, (node.moduleSpecifier as ts.StringLiteral).text);
    const clause = node.importClause;
    const names = new Map<string, boolean>();
    if (!clause) return { kind: 'import', target, sideEffect: true, valueLoad: false, names };
    if (clause.name) names.set('default', clause.isTypeOnly);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) names.set('*', clause.isTypeOnly);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        names.set(
          (element.propertyName ?? element.name).text,
          clause.isTypeOnly || element.isTypeOnly,
        );
      }
    }
    const valueLoad = [...names.values()].some((typeOnly) => !typeOnly);
    return { kind: 'import', target, sideEffect: false, valueLoad, names };
  };

  const exportLink = (source: ts.SourceFile, node: ts.ExportDeclaration): Link => {
    const target = targetOf(source, (node.moduleSpecifier as ts.StringLiteral).text);
    const names = new Map<string, boolean>();
    const clause = node.exportClause;
    if (!clause) names.set('*', node.isTypeOnly);
    else if (ts.isNamespaceExport(clause)) names.set(`*as ${clause.name.text}`, node.isTypeOnly);
    else {
      for (const element of clause.elements) {
        names.set(
          (element.propertyName ?? element.name).text,
          node.isTypeOnly || element.isTypeOnly,
        );
      }
    }
    return { kind: 'export', target, sideEffect: false, valueLoad: !node.isTypeOnly, names };
  };

  const of = (path: string): Link[] => {
    const source = side.sourceOf(path);
    if (!source) return [];
    const links: Link[] = [];
    for (const statement of source.statements) {
      if (!isModuleLink(statement)) continue;
      if (ts.isImportDeclaration(statement)) links.push(importLink(source, statement));
      else if (ts.isExportDeclaration(statement)) links.push(exportLink(source, statement));
      else if (ts.isImportEqualsDeclaration(statement)) {
        const reference = statement.moduleReference as ts.ExternalModuleReference;
        const target = ts.isStringLiteral(reference.expression)
          ? targetOf(source, reference.expression.text)
          : 'unresolved:?';
        const names = new Map([['=', statement.isTypeOnly]]);
        links.push({
          kind: 'import',
          target,
          sideEffect: false,
          valueLoad: !statement.isTypeOnly,
          names,
        });
      }
    }
    return links;
  };

  const referencedTargets = (unit: Unit): Set<string> => {
    const targets = new Set<string>();
    const source = unit.node.getSourceFile();
    for (const identifier of identifiersOf(unit.node)) {
      const symbol = keyer.symbolAt(identifier);
      const declaration =
        symbol && symbol.flags & ts.SymbolFlags.Alias ? symbol.declarations?.[0] : undefined;
      if (!declaration || declaration.getSourceFile() !== source) continue;
      const owner = ts.findAncestor(declaration, (n) => ts.isImportDeclaration(n));
      if (owner && ts.isImportDeclaration(owner)) {
        targets.add(targetOf(source, (owner.moduleSpecifier as ts.StringLiteral).text));
      } else if (ts.isImportEqualsDeclaration(declaration)) {
        const reference = declaration.moduleReference;
        if (ts.isExternalModuleReference(reference) && ts.isStringLiteral(reference.expression)) {
          targets.add(targetOf(source, reference.expression.text));
        }
      }
    }
    return targets;
  };

  return { of, targetOf, referencedTargets };
}
