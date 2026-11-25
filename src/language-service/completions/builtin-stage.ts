import ts from 'typescript';
import { nodeAtPosition } from '../positions.js';

function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  if (ts.canHaveDecorators(node)) return ts.getDecorators(node) ?? [];
  const modifiers = (node as { modifiers?: readonly ts.ModifierLike[] }).modifiers ?? [];
  return modifiers.filter(ts.isDecorator);
}

export function enclosingStage(
  sourceFile: ts.SourceFile,
  offset: number,
): 'vertex' | 'fragment' | 'compute' | undefined {
  let node: ts.Node | undefined = nodeAtPosition(sourceFile, offset);
  while (node !== undefined && !ts.isParameter(node)) node = node.parent;
  const fn = node?.parent;
  if (fn === undefined || !ts.isFunctionDeclaration(fn)) return undefined;
  for (const d of decoratorsOf(fn)) {
    const text = d.getText(sourceFile);
    if (/^@vertex\b/.test(text)) return 'vertex';
    if (/^@fragment\b/.test(text)) return 'fragment';
    if (/^@compute\b/.test(text)) return 'compute';
  }
  return undefined;
}
