import ts from 'typescript';
import { identifiersOf, type Keyer } from './binding-keys.js';
import type { Side } from './side-program.js';
import { isModuleLink, type Unit } from './units.js';

export interface Link {
  readonly kind: 'import' | 'export';
  readonly target: string;
  readonly attributes: string;
  readonly specifier: string;
  readonly entries: string[];
  readonly sideEffect: boolean;
  readonly valueLoad: boolean;
  readonly names: Map<string, boolean>;
}

export interface Links {
  of(path: string): Link[];
  targetOf(source: ts.SourceFile, specifier: string): string;
  referencedEntries(unit: Unit): Set<string>;
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
    const specifier = (node.moduleSpecifier as ts.StringLiteral).text;
    const target = targetOf(source, specifier);
    const clause = node.importClause;
    const names = new Map<string, boolean>();
    const entries: string[] = [];
    const attributes = node.attributes?.getText() ?? '';
    const made = { kind: 'import' as const, target, attributes, specifier, entries, names };
    if (!clause) {
      entries.push(`${specifier}||`);
      return { ...made, sideEffect: true, valueLoad: false };
    }
    if (clause.name) {
      names.set('default', clause.isTypeOnly);
      entries.push(`${specifier}|default|${clause.name.text}|${clause.isTypeOnly}`);
    }
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      names.set('*', clause.isTypeOnly);
      entries.push(`${specifier}|*|${bindings.name.text}|${clause.isTypeOnly}`);
    }
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const imported = (element.propertyName ?? element.name).text;
        const typeOnly = clause.isTypeOnly || element.isTypeOnly;
        names.set(imported, typeOnly);
        entries.push(`${specifier}|${imported}|${element.name.text}|${typeOnly}`);
      }
    }
    const valueLoad = [...names.values()].some((typeOnly) => !typeOnly);
    return { ...made, sideEffect: false, valueLoad };
  };

  const exportLink = (source: ts.SourceFile, node: ts.ExportDeclaration): Link => {
    const specifier = (node.moduleSpecifier as ts.StringLiteral).text;
    const target = targetOf(source, specifier);
    const names = new Map<string, boolean>();
    const entries: string[] = [];
    const clause = node.exportClause;
    if (!clause) {
      names.set('*', node.isTypeOnly);
      entries.push(`${specifier}|*||${node.isTypeOnly}`);
    } else if (ts.isNamespaceExport(clause)) {
      names.set(`*as ${clause.name.text}`, node.isTypeOnly);
      entries.push(`${specifier}|*|${clause.name.text}|${node.isTypeOnly}`);
    } else {
      for (const element of clause.elements) {
        const imported = (element.propertyName ?? element.name).text;
        const typeOnly = node.isTypeOnly || element.isTypeOnly;
        names.set(imported, typeOnly);
        entries.push(`${specifier}|${imported}|${element.name.text}|${typeOnly}`);
      }
    }
    const valueLoad = !node.isTypeOnly && [...names.values()].some((typeOnly) => !typeOnly);
    const attributes = node.attributes?.getText() ?? '';
    return {
      kind: 'export',
      target,
      attributes,
      specifier,
      entries,
      names,
      sideEffect: false,
      valueLoad,
    };
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
        const specifier = ts.isStringLiteral(reference.expression)
          ? reference.expression.text
          : '?';
        links.push({
          kind: 'import',
          target,
          attributes: '',
          specifier,
          entries: [`${specifier}|=||${statement.isTypeOnly}`],
          sideEffect: false,
          valueLoad: !statement.isTypeOnly,
          names,
        });
      }
    }
    return links;
  };

  const entryOf = (declaration: ts.Declaration): string | undefined => {
    const owner = ts.findAncestor(declaration, (n) => ts.isImportDeclaration(n));
    if (!owner || !ts.isImportDeclaration(owner)) return undefined;
    const specifier = (owner.moduleSpecifier as ts.StringLiteral).text;
    const typeOnly = owner.importClause?.isTypeOnly ?? false;
    if (ts.isImportSpecifier(declaration)) {
      const imported = (declaration.propertyName ?? declaration.name).text;
      return `${specifier}|${imported}|${declaration.name.text}|${typeOnly || declaration.isTypeOnly}`;
    }
    if (ts.isImportClause(declaration) && declaration.name) {
      return `${specifier}|default|${declaration.name.text}|${typeOnly}`;
    }
    if (ts.isNamespaceImport(declaration))
      return `${specifier}|*|${declaration.name.text}|${typeOnly}`;
    return undefined;
  };

  const referencedEntries = (unit: Unit): Set<string> => {
    const entries = new Set<string>();
    const source = unit.node.getSourceFile();
    for (const identifier of identifiersOf(unit.node)) {
      const symbol = keyer.symbolAt(identifier);
      const declaration =
        symbol && symbol.flags & ts.SymbolFlags.Alias ? symbol.declarations?.[0] : undefined;
      if (!declaration || declaration.getSourceFile() !== source) continue;
      const entry = entryOf(declaration);
      if (entry !== undefined) entries.add(entry);
    }
    return entries;
  };

  return { of, targetOf, referencedEntries };
}
