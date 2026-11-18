import ts from 'typescript';
import { isResourceCall } from '../bindings.js';
import { isOverrideType } from '../overrides.js';

export const STRICT_MODE_NAMES: ReadonlySet<string> = new Set(['eval', 'arguments']);

export function strictModeBinding(
  node: ts.Node,
): { name: ts.Identifier; message: string } | undefined {
  const name =
    ts.isParameter(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isBindingElement(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node)
      ? node.name
      : undefined;
  if (name === undefined || !ts.isIdentifier(name) || !STRICT_MODE_NAMES.has(name.text)) {
    return undefined;
  }
  const noun = bindingNoun(node);
  return {
    name,
    message:
      `"${name.text}" is reserved in ECMAScript's strict mode, which every "use typeshade" ` +
      `file is in, so ${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun} of that name cannot be ` +
      `declared. Rename it.`,
  };
}

function bindingNoun(node: ts.Node): string {
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) return 'function';
  let at = node;
  while (ts.isBindingElement(at) || ts.isObjectBindingPattern(at) || ts.isArrayBindingPattern(at)) {
    at = at.parent;
  }
  if (ts.isParameter(at)) return 'parameter';
  const statement = at.parent.parent;
  if (
    !ts.isVariableDeclaration(at) ||
    !ts.isVariableStatement(statement) ||
    !(ts.isSourceFile(statement.parent) || ts.isModuleBlock(statement.parent))
  ) {
    return 'local';
  }
  if ((at.parent.flags & ts.NodeFlags.Const) === 0) return 'module variable';
  const declared = statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword);
  if (declared === true || (at.initializer !== undefined && isResourceCall(at.initializer))) {
    return 'binding';
  }
  return isOverrideType(at.type) ? 'override' : 'module constant';
}
