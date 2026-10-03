// Implements: Rule 5.1 (docs/language-design.md; traced in reqs/).
import ts from 'typescript';
import type { ShaderType } from '../../core/ir/types.js';
import { i32T, u32T } from '../../core/ir/types.js';
import { isIntegerLiteralNode } from './lit-coerce.js';
import { declarationOf, functionAround } from './lower/closures.js';

export interface LocalNumericInference {
  readonly type?: ShaderType;
  readonly conflict?: string;
}
const tables = new WeakMap<
  ts.SourceFile,
  ReadonlyMap<ts.VariableDeclaration, LocalNumericInference>
>();

function stripParens(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? stripParens(node.expression) : node;
}
function candidate(decl: ts.VariableDeclaration): boolean {
  if (decl.type !== undefined || decl.initializer === undefined || !ts.isIdentifier(decl.name))
    return false;
  if (!isIntegerLiteralNode(decl.initializer) || functionAround(decl) === undefined) return false;
  const list = decl.parent;
  return (
    ts.isVariableDeclarationList(list) &&
    ts.isVariableStatement(list.parent) &&
    (list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) !== 0
  );
}
/** Only a direct nongeneric function declaration with an implementation says a demand.
 * Reuse closure resolution so a shadowing variable or parameter cannot mean a module fn. */
function declaredParameter(call: ts.CallExpression, index: number): string | undefined {
  const callee = stripParens(call.expression);
  if (!ts.isIdentifier(callee)) return undefined;
  const decl = declarationOf(callee);
  if (
    decl === undefined ||
    !ts.isFunctionDeclaration(decl) ||
    decl.body === undefined ||
    (decl.typeParameters?.length ?? 0) !== 0
  )
    return undefined;
  const type = decl.parameters[index]?.type;
  if (
    type === undefined ||
    !ts.isTypeReferenceNode(type) ||
    !ts.isIdentifier(type.typeName) ||
    (type.typeArguments?.length ?? 0) !== 0
  )
    return undefined;
  const name = type.typeName.text;
  return name === 'i32' || name === 'u32' || name === 'f32' || name === 'f64' ? name : undefined;
}
function analyze(
  sourceFile: ts.SourceFile,
): ReadonlyMap<ts.VariableDeclaration, LocalNumericInference> {
  const demands = new Map<ts.VariableDeclaration, Set<string>>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      for (const [index, arg] of node.arguments.entries()) {
        const argument = stripParens(arg);
        if (!ts.isIdentifier(argument)) continue;
        const decl = declarationOf(argument);
        if (decl === undefined || !ts.isVariableDeclaration(decl) || !candidate(decl)) continue;
        const type = declaredParameter(node, index);
        if (type === undefined) continue;
        let types = demands.get(decl);
        if (types === undefined) demands.set(decl, (types = new Set()));
        types.add(type);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const result = new Map<ts.VariableDeclaration, LocalNumericInference>();
  for (const [decl, types] of demands) {
    const kinds = [...types].sort();
    if (types.size > 1) {
      const name = (decl.name as ts.Identifier).text;
      result.set(decl, {
        conflict: `Cannot infer "${name}": its declared uses require ${kinds.join(' and ')}. Write an explicit type annotation on "${name}" and cast the arguments that need another type.`,
      });
    } else if (types.has('i32')) result.set(decl, { type: i32T });
    else if (types.has('u32')) result.set(decl, { type: u32T });
  }
  return result;
}
export function localNumericInference(
  decl: ts.VariableDeclaration,
  sourceFile: ts.SourceFile,
): LocalNumericInference | undefined {
  if (!candidate(decl)) return undefined;
  let table = tables.get(sourceFile);
  if (table === undefined) tables.set(sourceFile, (table = analyze(sourceFile)));
  return table.get(decl);
}
