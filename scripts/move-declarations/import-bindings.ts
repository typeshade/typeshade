import { dirname, join, relative } from 'node:path/posix';
import ts from 'typescript';
import type { SourceAnalysis, Usage } from './references.js';

export interface Binding {
  readonly decl: ts.Declaration;
  readonly kind: 'default' | 'namespace' | 'named';
  readonly imported: string;
  readonly local: string;
  readonly typeOnly: boolean;
  readonly inlineType: boolean;
}

export interface ImportStatement {
  readonly node: ts.ImportDeclaration;
  readonly specifier: string;
  readonly typeOnly: boolean;
  readonly bindings: readonly Binding[];
}

export type UsageMap = Map<ts.Declaration, Usage>;

export function importStatements(source: ts.SourceFile): ImportStatement[] {
  const found: ImportStatement[] = [];
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    const clause = node.importClause;
    if (clause === undefined) continue;
    const typeOnly = clause.isTypeOnly;
    const bindings: Binding[] = [];
    if (clause.name) {
      const local = clause.name.text;
      bindings.push({
        decl: clause,
        kind: 'default',
        imported: 'default',
        local,
        typeOnly,
        inlineType: false,
      });
    }
    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named)) {
      const local = named.name.text;
      bindings.push({
        decl: named,
        kind: 'namespace',
        imported: '*',
        local,
        typeOnly,
        inlineType: false,
      });
    }
    if (named && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        bindings.push({
          decl: element,
          kind: 'named',
          imported: (element.propertyName ?? element.name).text,
          local: element.name.text,
          typeOnly: typeOnly || element.isTypeOnly,
          inlineType: element.isTypeOnly,
        });
      }
    }
    found.push({ node, specifier: node.moduleSpecifier.text, typeOnly, bindings });
  }
  return found;
}

export function usageOf(analysis: SourceAnalysis, units: ReadonlySet<number>): UsageMap {
  const usage: UsageMap = new Map();
  for (const reference of analysis.imports) {
    if (!units.has(reference.from)) continue;
    const entry = usage.get(reference.binding) ?? { value: false, type: false };
    if (reference.typeOnly) entry.type = true;
    else entry.value = true;
    usage.set(reference.binding, entry);
  }
  return usage;
}

export function respecify(specifier: string, fromPath: string, toPath: string): string {
  if (!specifier.startsWith('.')) return specifier;
  const target = relative(dirname(toPath), join(dirname(fromPath), specifier));
  return target.startsWith('.') ? target : `./${target}`;
}

const bindingText = (binding: Binding, withType: boolean): string => {
  const name =
    binding.imported === binding.local ? binding.local : `${binding.imported} as ${binding.local}`;
  return withType && binding.inlineType ? `type ${name}` : name;
};

function typeStatements(kept: readonly Binding[], specifier: string): string[] {
  const statements: string[] = [];
  for (const binding of kept.filter((b) => b.kind === 'default')) {
    statements.push(`import type ${binding.local} from '${specifier}';`);
  }
  for (const binding of kept.filter((b) => b.kind === 'namespace')) {
    statements.push(`import type * as ${binding.local} from '${specifier}';`);
  }
  const named = kept.filter((b) => b.kind === 'named');
  if (named.length > 0) {
    statements.push(
      `import type { ${named.map((b) => bindingText(b, false)).join(', ')} } from '${specifier}';`,
    );
  }
  return statements;
}

function valueStatement(kept: readonly Binding[], specifier: string): string {
  const parts: string[] = [];
  for (const binding of kept.filter((b) => b.kind === 'default')) parts.push(binding.local);
  for (const binding of kept.filter((b) => b.kind === 'namespace'))
    parts.push(`* as ${binding.local}`);
  const named = kept.filter((b) => b.kind === 'named');
  if (named.length > 0) parts.push(`{ ${named.map((b) => bindingText(b, true)).join(', ')} }`);
  return `import ${parts.join(', ')} from '${specifier}';`;
}

export function loadsValue(kept: readonly Binding[], usage: UsageMap): boolean {
  return kept.some((binding) => !binding.typeOnly && usage.get(binding.decl)?.value === true);
}

export function renderImport(
  kept: readonly Binding[],
  usage: UsageMap,
  specifier: string,
): string[] {
  if (kept.length === 0) return [];
  return loadsValue(kept, usage)
    ? [valueStatement(kept, specifier)]
    : typeStatements(kept, specifier);
}

export function renderKept(
  statement: ImportStatement,
  kept: readonly Binding[],
  specifier: string,
): string[] {
  if (kept.length === 0) return [];
  return statement.typeOnly ? typeStatements(kept, specifier) : [valueStatement(kept, specifier)];
}
