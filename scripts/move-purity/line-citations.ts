import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describeFinding, finding, type Finding } from './finding.js';

export const COVERAGE_DIR = 'src/core/coverage/';
export const LINE_CITATION_KIND = 'cited by line path';

const SEGMENT_SEPARATOR = '; ';
const SEGMENT_PATH = /^[\w@./-]+/;
const LINE_LIST = /^:\d/;

export interface Citation {
  readonly segments: number;
  readonly example: string;
}

export type Citations = ReadonlyMap<string, Citation>;

export const isCoveragePath = (path: string): boolean =>
  path.startsWith(COVERAGE_DIR) && path.endsWith('.ts') && !path.endsWith('.test.ts');

function stringValue(node: ts.Expression): string | undefined {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return stringValue(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = stringValue(node.left);
    const right = stringValue(node.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
}

function evidenceStrings(path: string, text: string): { value: string; line: number }[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false);
  const found: { value: string; line: number }[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'evidence'
    ) {
      const value = stringValue(node.initializer);
      if (value !== undefined) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        found.push({ value, line });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

export function lineCitedPaths(texts: ReadonlyMap<string, string>): Citations {
  const counts = new Map<string, { segments: number; example: string }>();
  for (const [path, text] of texts) {
    if (!isCoveragePath(path)) continue;
    for (const { value, line } of evidenceStrings(path, text)) {
      for (const segment of value.split(SEGMENT_SEPARATOR)) {
        const cited = SEGMENT_PATH.exec(segment)?.[0];
        if (cited === undefined || !LINE_LIST.test(segment.slice(cited.length))) continue;
        const known = counts.get(cited);
        if (known) known.segments += 1;
        else counts.set(cited, { segments: 1, example: `${path}:${line}` });
      }
    }
  }
  return counts;
}

export function citationFinding(path: string, citation: Citation): Finding {
  const count =
    citation.segments === 1 ? '1 citing segment' : `${citation.segments} citing segments`;
  return finding(
    LINE_CITATION_KIND,
    path,
    `${count}, for example in the row at ${citation.example}; a move shifts the lines, so change the citations to symbol anchors first`,
  );
}

export function lineCitationFindings(
  texts: ReadonlyMap<string, string>,
  paths: readonly string[],
): Finding[] {
  const cited = lineCitedPaths(texts);
  return paths
    .filter((path) => path.endsWith('.ts') && cited.has(path))
    .map((path) => citationFinding(path, cited.get(path)!));
}

export function workingCoverageTexts(root: string): Map<string, string> {
  const dir = join(root, COVERAGE_DIR);
  const texts = new Map<string, string>();
  if (!existsSync(dir)) return texts;
  for (const name of readdirSync(dir)) {
    const path = `${COVERAGE_DIR}${name}`;
    if (isCoveragePath(path)) texts.set(path, readFileSync(join(root, path), 'utf8'));
  }
  return texts;
}

export function lineCitationRefusals(texts: ReadonlyMap<string, string>, path: string): string[] {
  return lineCitationFindings(texts, [path]).map(describeFinding);
}
