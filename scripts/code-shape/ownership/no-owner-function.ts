import ts from 'typescript';
import type { Finding, ShapeContext } from '../types.js';
import { declaredTypeOf, isObjectLike, lineOf } from './declared-type.js';
import { membersReadOnly, type FunctionNode } from './parameter-reads.js';

interface NamedFunction {
  name: string;
  node: FunctionNode;
}

function topLevelFunctions(source: ts.SourceFile): NamedFunction[] {
  const found: NamedFunction[] = [];
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      found.push({ name: statement.name.text, node: statement });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer;
        if (
          ts.isIdentifier(declaration.name) &&
          init !== undefined &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        ) {
          found.push({ name: declaration.name.text, node: init });
        }
      }
    }
  }
  return found;
}

function soleParameter(node: FunctionNode): ts.ParameterDeclaration | undefined {
  const [only, ...rest] = node.parameters;
  if (only === undefined || rest.length > 0) return undefined;
  const plain =
    only.dotDotDotToken === undefined &&
    only.questionToken === undefined &&
    only.initializer === undefined;
  const named = ts.isIdentifier(only.name) || ts.isObjectBindingPattern(only.name);
  return plain && named ? only : undefined;
}

function bodyLines(body: ts.Node): number {
  const source = body.getSourceFile();
  const start = source.getLineAndCharacterOfPosition(body.getStart(source)).line;
  const end = source.getLineAndCharacterOfPosition(body.getEnd()).line;
  return end - start + 1;
}

export function noOwnerFunctions(ctx: ShapeContext): Finding[] {
  const findings: Finding[] = [];
  for (const source of ctx.analysed) {
    for (const { name, node } of topLevelFunctions(source)) {
      const parameter = soleParameter(node);
      if (parameter === undefined || node.body === undefined) continue;
      const type = ctx.checker.getTypeAtLocation(parameter);
      if (!isObjectLike(ctx.checker, type)) continue;
      const members = membersReadOnly(ctx.checker, node, parameter);
      if (members === undefined) continue;
      const declared = declaredTypeOf(ctx, type);
      if (declared?.external === true) continue;
      findings.push({
        signal: 'ownership',
        file: ctx.rel(source),
        line: lineOf(node),
        kind: 'no-owner-function',
        evidence: {
          function: name,
          parameterType: declared?.name ?? '(anonymous)',
          declaredAt: declared?.at ?? `${ctx.rel(source)}:${lineOf(parameter)}`,
          members,
          bodyLines: bodyLines(node.body),
        },
        remedy: 'give the rule to its owner',
      });
    }
  }
  return findings;
}
