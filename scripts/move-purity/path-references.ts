import { basename } from 'node:path/posix';
import ts from 'typescript';
import type { FilePairs } from './file-pairs.js';
import { finding, type Finding } from './finding.js';
import type { Side } from './side-program.js';
import { analyzeSource } from './units.js';

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const FULL_PATH_BOUNDARY = '(^|[^\\w.-])';

interface RemovedPath {
  readonly path: string;
  readonly renamedTo: string | undefined;
}

const BASELINES = new Set(['scripts/file-size-baseline.json', 'scripts/comment-baseline.json']);

const patternsFor = ({ path, renamedTo }: RemovedPath): RegExp[] => {
  const stem = basename(path).replace(/\.ts$/, '');
  const keepsName = renamedTo !== undefined && basename(renamedTo) === basename(path);
  const lead = keepsName ? `['"\`]` : `[/'"\`]`;
  return [
    new RegExp(`${FULL_PATH_BOUNDARY}${escape(path)}`),
    ...[`${stem}.ts`, `${stem}.js`].map((name) => new RegExp(`(?:^|${lead})${escape(name)}`)),
  ];
};

const isScannedText = (path: string): boolean =>
  !path.endsWith('.md') && !path.endsWith('.ts') && !BASELINES.has(path);

function isSpecifier(literal: ts.Node): boolean {
  const parent = literal.parent;
  if (ts.isCallExpression(parent) && parent.arguments[0] === literal) {
    return (
      parent.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(parent.expression) && parent.expression.text === 'require')
    );
  }
  return ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent);
}

function literalsOf(node: ts.Node): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (current: ts.Node): void => {
    if (
      (ts.isStringLiteralLike(current) ||
        ts.isTemplateHead(current) ||
        ts.isTemplateMiddle(current) ||
        ts.isTemplateTail(current)) &&
      !isSpecifier(current)
    ) {
      found.push(current);
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

export function pathReferenceFindings(
  head: Side,
  texts: ReadonlyMap<string, string>,
  files: FilePairs,
): Finding[] {
  const findings: Finding[] = [];
  const removed: RemovedPath[] = [
    ...files.deletedFiles.map((path) => ({ path, renamedTo: undefined })),
    ...[...files.renames].map(([path, renamedTo]) => ({ path, renamedTo })),
  ];
  for (const gone of removed) {
    const patterns = patternsFor(gone);
    const mentions = (text: string): boolean => {
      const own = gone.renamedTo === undefined ? text : text.split(gone.renamedTo).join('');
      return patterns.some((pattern) => pattern.test(own));
    };
    const stem = basename(gone.path).replace(/\.ts$/, '');
    for (const [path, text] of texts) {
      if (!(path.endsWith('.ts') || isScannedText(path)) || !text.includes(stem)) continue;
      if (!path.endsWith('.ts')) {
        if (mentions(text))
          findings.push(finding('path reference to a removed file', path, gone.path));
        continue;
      }
      const source = head.sourceOf(path);
      if (!source) continue;
      for (const unit of analyzeSource(source, path).units) {
        for (const literal of literalsOf(unit.node)) {
          if (mentions((literal as ts.StringLiteralLike).text)) {
            const line = source.getLineAndCharacterOfPosition(literal.getStart(source)).line + 1;
            findings.push(finding('path reference to a removed file', path, gone.path, line));
          }
        }
      }
    }
  }
  return findings;
}
