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
  readonly droppedAsType: boolean;
  readonly names: Map<string, boolean>;
}

export interface Links {
  of(path: string): Link[];
  targetOf(source: ts.SourceFile, specifier: string): string;
  referencedEntries(unit: Unit): Set<string>;
}

const NODE_MODULES = '/node_modules/';

const transpiled = new Map<string, Map<string, number>>();

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

  const retainedCounts = (path: string): Map<string, number> => {
    const text = side.texts.get(path) ?? '';
    const key = `${path}\0${text}`;
    const known = transpiled.get(key);
    if (known !== undefined) return known;
    const counts = new Map<string, number>();
    if (path.endsWith('.d.ts')) {
      transpiled.set(key, counts);
      return counts;
    }
    const output = ts.transpileModule(text, {
      fileName: path,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        isolatedModules: true,
        verbatimModuleSyntax: false,
      },
    }).outputText;
    const emitted = ts.createSourceFile(path, output, ts.ScriptTarget.ES2022);
    for (const statement of emitted.statements) {
      if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
      const specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
      counts.set(specifier, (counts.get(specifier) ?? 0) + 1);
    }
    transpiled.set(key, counts);
    return counts;
  };

  const importLink = (source: ts.SourceFile, node: ts.ImportDeclaration): Link => {
    const specifier = (node.moduleSpecifier as ts.StringLiteral).text;
    const target = targetOf(source, specifier);
    const clause = node.importClause;
    const names = new Map<string, boolean>();
    const entries: string[] = [];
    const attributes = node.attributes?.getText() ?? '';
    const made = {
      kind: 'import' as const,
      target,
      attributes,
      specifier,
      entries,
      names,
      droppedAsType: false,
    };
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
    const nonType = [...names.values()].some((typeOnly) => !typeOnly);
    return { ...made, sideEffect: false, valueLoad: nonType, droppedAsType: false };
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
    const valueLoad =
      !node.isTypeOnly &&
      (clause === undefined || ts.isNamespaceExport(clause)
        ? true
        : clause.elements.some((element) => !element.isTypeOnly && hasValueMeaning(element)));
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
      droppedAsType: false,
    };
  };

  const hasValueMeaning = (element: ts.ExportSpecifier): boolean => {
    const symbol = side.checker.getExportSpecifierLocalTargetSymbol(element);
    if (symbol === undefined) return true;
    let current = symbol;
    for (let step = 0; step < 32 && current.flags & ts.SymbolFlags.Alias; step += 1) {
      current = side.checker.getAliasedSymbol(current);
    }
    return current.flags === ts.SymbolFlags.Alias || (current.flags & ts.SymbolFlags.Value) !== 0;
  };

  const computed = new Map<string, Link[]>();
  const of = (path: string): Link[] => {
    const known = computed.get(path);
    if (known !== undefined) return known;
    const result = linksOf(path);
    computed.set(path, result);
    return result;
  };

  const linksOf = (path: string): Link[] => {
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
          droppedAsType: false,
          names,
        });
      }
    }
    const counts = retainedCounts(path);
    const declared = new Map<string, number>();
    for (const link of links) {
      if (link.kind === 'import' && link.valueLoad && !link.names.has('=')) {
        declared.set(link.specifier, (declared.get(link.specifier) ?? 0) + 1);
      }
    }
    return links.map((link) => {
      if (link.kind !== 'import' || !link.valueLoad || link.names.has('=')) {
        return link;
      }
      const kept = counts.get(link.specifier) ?? 0;
      return {
        ...link,
        valueLoad: kept > 0,
        droppedAsType: kept < (declared.get(link.specifier) ?? 0),
      };
    });
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
