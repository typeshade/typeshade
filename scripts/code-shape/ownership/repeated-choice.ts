import ts from 'typescript';
import type { Finding, ShapeContext } from '../types.js';
import { declaredTypeOf, lineOf } from './declared-type.js';

interface Member {
  objectText: string;
  object: ts.Expression;
  name: string;
}

type Choice = [Member, Member];

export interface ChoicePair {
  typeName: string;
  declaredAt: string | undefined;
  first: string;
  second: string;
  sites: string[];
  files: Set<string>;
}

function chainText(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (expression.kind === ts.SyntaxKind.ThisKeyword) return 'this';
  if (!ts.isPropertyAccessExpression(expression)) return undefined;
  const inner = chainText(expression.expression);
  return inner === undefined ? undefined : `${inner}.${expression.name.text}`;
}

function memberOf(expression: ts.Expression): Member | undefined {
  if (!ts.isPropertyAccessExpression(expression)) return undefined;
  const objectText = chainText(expression.expression);
  if (objectText === undefined) return undefined;
  return { objectText, object: expression.expression, name: expression.name.text };
}

const isAbsent = (expression: ts.Expression): boolean =>
  (ts.isIdentifier(expression) && expression.text === 'undefined') ||
  expression.kind === ts.SyntaxKind.NullKeyword;

function fromBinary(node: ts.BinaryExpression): Choice | undefined {
  const kind = node.operatorToken.kind;
  if (kind !== ts.SyntaxKind.QuestionQuestionToken && kind !== ts.SyntaxKind.BarBarToken) {
    return undefined;
  }
  const first = memberOf(node.left);
  const second = memberOf(node.right);
  return first === undefined || second === undefined ? undefined : [first, second];
}

function fromConditional(node: ts.ConditionalExpression): Choice | undefined {
  const test = node.condition;
  if (!ts.isBinaryExpression(test) || !isAbsent(test.right)) return undefined;
  const operator = test.operatorToken.kind;
  const present =
    operator === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    operator === ts.SyntaxKind.ExclamationEqualsToken;
  const absent =
    operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    operator === ts.SyntaxKind.EqualsEqualsToken;
  if (!present && !absent) return undefined;
  const kept = present ? node.whenTrue : node.whenFalse;
  const keptMember = memberOf(kept);
  const other = memberOf(present ? node.whenFalse : node.whenTrue);
  if (other === undefined || keptMember === undefined) return undefined;
  return kept.getText() === test.left.getText() ? [keptMember, other] : undefined;
}

function choiceOf(node: ts.Node): Choice | undefined {
  if (ts.isBinaryExpression(node)) return fromBinary(node);
  if (ts.isConditionalExpression(node)) return fromConditional(node);
  return undefined;
}

function record(
  ctx: ShapeContext,
  pairs: Map<string, ChoicePair>,
  source: ts.SourceFile,
  node: ts.Node,
  [first, second]: Choice,
): void {
  const type = ctx.checker.getNonNullableType(ctx.checker.getTypeAtLocation(first.object));
  const declared = declaredTypeOf(ctx, type);
  const named = declared !== undefined && !declared.anonymous;
  const key = `${named ? declared.at : '(anonymous)'}|${first.name}|${second.name}`;
  const pair = pairs.get(key) ?? {
    typeName: named ? declared.name : '(anonymous)',
    declaredAt: named ? declared.at : undefined,
    first: first.name,
    second: second.name,
    sites: [],
    files: new Set<string>(),
  };
  pair.sites.push(`${ctx.rel(source)}:${lineOf(node)}`);
  pair.files.add(ctx.rel(source));
  pairs.set(key, pair);
}

export function choicePairs(ctx: ShapeContext): Map<string, ChoicePair> {
  const pairs = new Map<string, ChoicePair>();
  for (const source of ctx.analysed) {
    const visit = (node: ts.Node): void => {
      const choice = choiceOf(node);
      if (
        choice !== undefined &&
        choice[0].objectText === choice[1].objectText &&
        choice[0].name !== choice[1].name
      ) {
        record(ctx, pairs, source, node, choice);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return pairs;
}

export function repeatedChoices(ctx: ShapeContext): Finding[] {
  const findings: Finding[] = [];
  for (const pair of choicePairs(ctx).values()) {
    if (pair.sites.length < 2) continue;
    const [file, line] = pair.sites[0]!.split(/:(?=\d+$)/);
    findings.push({
      signal: 'ownership',
      file: file!,
      line: Number(line),
      kind: 'repeated-choice',
      evidence: {
        type: pair.typeName,
        declaredAt: pair.declaredAt ?? 'anonymous type: member names only',
        first: pair.first,
        second: pair.second,
        siteCount: pair.sites.length,
        files: pair.files.size,
        sites: pair.sites,
      },
      remedy: 'give the rule to its owner',
    });
  }
  return findings;
}
