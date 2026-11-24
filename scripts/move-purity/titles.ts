import ts from 'typescript';
import { normalizeLineEndings } from './units.js';

export interface Title {
  readonly title: string;
  readonly path: string;
  readonly line: number;
}

const SUITES = new Set(['describe', 'it', 'test']);
const MEMBERS = new Set(['each', 'skip', 'only', 'todo', 'concurrent', 'fails', 'skipIf', 'runIf']);

export function isSuiteCallee(expression: ts.Expression): boolean {
  if (ts.isCallExpression(expression)) return isSuiteCallee(expression.expression);
  if (ts.isIdentifier(expression)) return SUITES.has(expression.text);
  if (ts.isPropertyAccessExpression(expression)) {
    return MEMBERS.has(expression.name.text) && isSuiteCallee(expression.expression);
  }
  return false;
}

function titleText(argument: ts.Expression, source: ts.SourceFile): string | undefined {
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
    return argument.text;
  }
  if (ts.isTemplateExpression(argument)) return argument.getText(source);
  return undefined;
}

export function testTitles(path: string, rawText: string): Title[] {
  const text = normalizeLineEndings(rawText);
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const titles: Title[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isSuiteCallee(node.expression) && node.arguments.length > 0) {
      const title = titleText(node.arguments[0]!, source);
      if (title !== undefined) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        titles.push({ title, path, line });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return titles;
}
