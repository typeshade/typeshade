import ts from 'typescript';
import type { SourceAnalysis, Usage } from './references.js';

export interface NameFact {
  readonly name: string;
  readonly hasValue: boolean;
  readonly exported: boolean;
}

const isValueKind = (node: ts.Node): boolean =>
  ts.isFunctionDeclaration(node) ||
  ts.isClassDeclaration(node) ||
  ts.isEnumDeclaration(node) ||
  ts.isVariableStatement(node);

export function nameFacts(analysis: SourceAnalysis, moved: ReadonlySet<number>): NameFact[] {
  const facts = new Map<string, { hasValue: boolean; exported: boolean }>();
  analysis.units.forEach((unit, index) => {
    if (!moved.has(index)) return;
    for (const name of unit.names) {
      const known = facts.get(name) ?? { hasValue: false, exported: false };
      known.hasValue ||= isValueKind(unit.node);
      known.exported ||= unit.exported;
      facts.set(name, known);
    }
  });
  return [...facts].map(([name, fact]) => ({ name, ...fact }));
}

export function neededUsage(analysis: SourceAnalysis, moved: ReadonlySet<number>) {
  const needed = new Map<string, Usage>();
  for (const reference of analysis.locals) {
    if (moved.has(reference.from) || !moved.has(reference.to)) continue;
    const usage = needed.get(reference.name) ?? { value: false, type: false };
    if (reference.typeOnly) usage.type = true;
    else usage.value = true;
    needed.set(reference.name, usage);
  }
  return needed;
}

export interface LinkBlock {
  readonly imports: readonly string[];
  readonly exports: readonly string[];
}

export function linkBlock(
  facts: readonly NameFact[],
  needed: ReadonlyMap<string, Usage>,
  specifier: string,
): LinkBlock {
  const back = facts.filter((fact) => needed.has(fact.name));
  const asValue = back.filter((fact) => fact.hasValue && needed.get(fact.name)!.value);
  const asType = back.filter((fact) => !asValue.includes(fact));
  const imports: string[] = [];
  if (asValue.length > 0) {
    const items = [...asValue.map((f) => f.name), ...asType.map((f) => `type ${f.name}`)];
    imports.push(`import { ${items.join(', ')} } from '${specifier}';`);
  } else if (asType.length > 0) {
    imports.push(`import type { ${asType.map((f) => f.name).join(', ')} } from '${specifier}';`);
  }
  const exported = facts.filter((fact) => fact.exported);
  const values = exported.filter((fact) => fact.hasValue).map((fact) => fact.name);
  const types = exported.filter((fact) => !fact.hasValue).map((fact) => fact.name);
  const exports: string[] = [];
  if (values.length > 0) exports.push(`export { ${values.join(', ')} } from '${specifier}';`);
  if (types.length > 0) exports.push(`export type { ${types.join(', ')} } from '${specifier}';`);
  return { imports, exports };
}
