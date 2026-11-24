import ts from 'typescript';
import type { Side } from './side-program.js';
import { analyzeSource, type Unit } from './units.js';

interface Bindings {
  readonly texts: string[];
  readonly keys: string[];
}

export interface Keyer {
  keyOfSymbol(symbol: ts.Symbol | undefined, text: string, self?: ts.Node): string;
  symbolAt(identifier: ts.Identifier): ts.Symbol | undefined;
  unitBindings(unit: Unit): Bindings;
  exportKeys(path: string): Map<string, string> | undefined;
}

const NODE_MODULES = '/node_modules/';

export function identifiersOf(node: ts.Node): ts.Identifier[] {
  const found: ts.Identifier[] = [];
  const visit = (current: ts.Node): void => {
    if (ts.isIdentifier(current)) found.push(current);
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function topLevelOf(node: ts.Node): ts.Node {
  let current = node;
  while (current.parent && !ts.isSourceFile(current.parent)) current = current.parent;
  return current;
}

function isTypeOnlyExport(declaration: ts.Declaration | undefined): boolean {
  if (!declaration) return false;
  if (ts.isExportSpecifier(declaration)) {
    return declaration.isTypeOnly || declaration.parent.parent.isTypeOnly;
  }
  if (ts.isNamespaceExport(declaration)) return declaration.parent.isTypeOnly;
  return false;
}

export function createKeyer(side: Side, instanceId: (unit: Unit) => string): Keyer {
  const { checker } = side;
  const resolve = (symbol: ts.Symbol): ts.Symbol => {
    let current = symbol;
    for (let step = 0; step < 32 && current.flags & ts.SymbolFlags.Alias; step += 1) {
      current = checker.getAliasedSymbol(current);
    }
    return current;
  };

  const externalName = (fileName: string): string => {
    const at = fileName.lastIndexOf(NODE_MODULES);
    if (at >= 0) return fileName.slice(at + NODE_MODULES.length);
    return fileName.startsWith(`${side.root}/`) ? fileName.slice(side.root.length + 1) : fileName;
  };

  const keyOfDeclaration = (declaration: ts.Declaration, name: string, self?: ts.Node): string => {
    const source = declaration.getSourceFile();
    const top = topLevelOf(declaration);
    if (self !== undefined && top === self) return 'self';
    const path = side.pathOf(source.fileName);
    if (path === undefined) return `ext:${externalName(source.fileName)}:${name}`;
    const unit = analyzeSource(source, path).byNode.get(top);
    return unit ? `${instanceId(unit)}:${name}` : `file:${path}:${name}`;
  };

  const unresolvedImportKey = (symbol: ts.Symbol): string | undefined => {
    if (!(symbol.flags & ts.SymbolFlags.Alias)) return undefined;
    const target = checker.getAliasedSymbol(symbol);
    if (target.declarations?.length || target.name !== 'unknown') return undefined;
    const declaration = symbol.declarations?.[0];
    if (!declaration) return undefined;
    const owner = ts.findAncestor(
      declaration,
      (n) => ts.isImportDeclaration(n) || ts.isExportDeclaration(n),
    );
    const specifier =
      owner && (ts.isImportDeclaration(owner) || ts.isExportDeclaration(owner))
        ? (owner.moduleSpecifier as ts.StringLiteral | undefined)?.text
        : undefined;
    if (specifier === undefined) return undefined;
    let imported = '*';
    if (ts.isImportSpecifier(declaration) || ts.isExportSpecifier(declaration)) {
      imported = (declaration.propertyName ?? declaration.name).text;
    } else if (ts.isImportClause(declaration)) imported = 'default';
    return `import:${specifier}#${imported}`;
  };

  const keyOfSymbol = (symbol: ts.Symbol | undefined, text: string, self?: ts.Node): string => {
    if (!symbol) return `global:${text}`;
    const unresolved = unresolvedImportKey(symbol);
    if (unresolved !== undefined) return unresolved;
    const resolved = resolve(symbol);
    const declaration = resolved.declarations?.[0];
    if (!declaration) {
      return resolved.name === 'unknown' ? `unresolved:${text}` : `nodecl:${resolved.name}`;
    }
    if (ts.isSourceFile(declaration)) {
      const names = checker.getExportsOfModule(resolved).map((e) => e.name);
      return `module:${names.sort().join(',')}`;
    }
    return keyOfDeclaration(declaration, resolved.name, self);
  };

  const symbolAt = (identifier: ts.Identifier): ts.Symbol | undefined => {
    const parent = identifier.parent;
    if (ts.isShorthandPropertyAssignment(parent) && parent.name === identifier) {
      return (
        checker.getShorthandAssignmentValueSymbol(parent) ?? checker.getSymbolAtLocation(identifier)
      );
    }
    if (ts.isExportSpecifier(parent) && !parent.parent.parent.moduleSpecifier) {
      return checker.getExportSpecifierLocalTargetSymbol(parent);
    }
    return checker.getSymbolAtLocation(identifier);
  };

  const unitBindings = (unit: Unit): Bindings => {
    const identifiers = identifiersOf(unit.node);
    return {
      texts: identifiers.map((id) => id.text),
      keys: identifiers.map((id) => keyOfSymbol(symbolAt(id), id.text, unit.node)),
    };
  };

  const exportKeys = (path: string): Map<string, string> | undefined => {
    const source = side.sourceOf(path);
    if (!source) return undefined;
    const surface = new Map<string, string>();
    const moduleSymbol = checker.getSymbolAtLocation(source);
    if (!moduleSymbol) return surface;
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const resolved = resolve(exported);
      const typeOnly = isTypeOnlyExport(exported.declarations?.[0]);
      const kind = [
        resolved.flags & ts.SymbolFlags.Value && !typeOnly ? 'v' : '',
        resolved.flags & ts.SymbolFlags.Type ? 't' : '',
        resolved.flags & ts.SymbolFlags.Namespace && !typeOnly ? 'n' : '',
      ].join('');
      surface.set(exported.name, `${kind}|${keyOfSymbol(exported, exported.name)}`);
    }
    return surface;
  };

  return { keyOfSymbol, symbolAt, unitBindings, exportKeys };
}
