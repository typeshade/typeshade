import ts from 'typescript';
import type { CompileTsSourceResult } from '../../compiler/ts/source-file.js';

function topLevelVariableNamed(
  sourceFile: ts.SourceFile,
  name: string,
): ts.VariableDeclaration | undefined {
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === name) return decl;
    }
  }
  return undefined;
}

export function resourceBindingLine(
  analysis: CompileTsSourceResult,
  sourceFile: ts.SourceFile,
  uri: string,
  defs: readonly ts.DefinitionInfo[],
  node: ts.Node,
): string | undefined {
  if (!ts.isIdentifier(node)) return undefined;
  const binding = analysis.bindings.find((b) => b.name === node.text);
  if (binding === undefined) return undefined;
  const decl = topLevelVariableNamed(sourceFile, node.text);
  if (decl === undefined) return undefined;
  const declStart = decl.name.getStart(sourceFile);
  if (!defs.some((d) => d.fileName === uri && d.textSpan.start === declStart)) return undefined;
  return bindingLine(binding);
}

export function bindingLine(binding: CompileTsSourceResult['bindings'][number]): string {
  const mode = binding.space === 'storage' ? `${binding.access ?? 'read'} ` : '';
  const slot = `@group(${binding.group}) @binding(${binding.binding})`;
  return `${mode}${binding.space} resource at ${slot}`;
}
