import ts from 'typescript';
import { referenceOf } from '../../compiler/ts/lower/references.js';
import type { DeclaredSymbol } from '../../compiler/ts/symbols.js';
import { wgslType } from '../../core/backends/wgsl.js';
import { nodeAt } from './node-at.js';
import type { StructNames } from './types.js';
import { spellShaderType } from './spell-type.js';

export function isReferenceParam(sourceFile: ts.SourceFile, param: DeclaredSymbol): boolean {
  let node: ts.Node | undefined = nodeAt(sourceFile, param.start);
  while (node !== undefined && !ts.isParameter(node)) node = node.parent;
  return (
    node !== undefined &&
    ts.isFunctionDeclaration(node.parent) &&
    referenceOf(node, sourceFile) !== undefined
  );
}

export function referenceLine(param: DeclaredSymbol): string {
  return (
    `The caller's object: this function writes it. Assigning to a field or an element of ` +
    `\`${param.name}\` changes the object the caller passed. WGSL takes it as a pointer, ` +
    `\`ptr<function, ${wgslType(param.type)}>\` for a local; GLSL ES 3.00 as an \`inout\` parameter.`
  );
}

export function ownerOf(quickInfo: ts.QuickInfo): string | undefined {
  const parts = quickInfo.displayParts ?? [];
  const name = parts.map((p) => p.kind).lastIndexOf('propertyName');
  const space = parts.findIndex((p) => p.kind === 'space');
  if (name < 2 || space < 0 || space >= name || parts[name - 1]?.text !== '.') return undefined;
  return ts.displayPartsToString(parts.slice(space + 1, name - 1));
}

export function declarationLine(
  symbol: DeclaredSymbol,
  moduleVar: boolean,
  struct: StructNames,
  params: readonly string[],
  owner: string | undefined,
): string | undefined {
  const type = spellShaderType(symbol.type, struct);
  switch (symbol.kind) {
    case 'local':
      return `${symbol.mutable === false ? 'const' : 'let'} ${symbol.name}: ${type}`;
    case 'param':
      return `(parameter) ${symbol.name}: ${type}`;
    case 'const':
      return `const ${symbol.name}: ${type}`;
    case 'override':
      return `const ${symbol.name}: ${type}`;
    case 'binding':
      return `${moduleVar ? 'let' : 'const'} ${symbol.name}: ${type}`;
    case 'function':
      return `function ${symbol.name}(${params.join(', ')}): ${type}`;
    case 'field':
      return `(property) ${owner ?? struct(symbol.struct ?? '')}.${symbol.name}: ${type}`;
    case 'struct':
      return undefined;
  }
}
