import { basename } from 'node:path/posix';
import ts from 'typescript';
import type { FilePairs } from './file-pairs.js';
import { finding, type Finding } from './finding.js';
import type { Side } from './side-program.js';
import { analyzeSource } from './units.js';

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const boundary = (name: string): RegExp => new RegExp(`(^|[^\\w.-])${escape(name)}`);

export const namesOf = (path: string): string[] => {
  const stem = basename(path).replace(/\.ts$/, '');
  return [`${stem}.ts`, `${stem}.js`, path];
};

export const isConfigurationText = (path: string): boolean =>
  path === 'package.json' ||
  /^tsconfig[^/]*\.json$/.test(path) ||
  path.endsWith('.mjs') ||
  path.endsWith('.yml') ||
  (path.startsWith('scripts/') && path.endsWith('.json'));

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
  const removed = [...files.deletedFiles, ...files.renames.keys()];
  for (const gone of removed) {
    const patterns = namesOf(gone).map((name) => ({ name, pattern: boundary(name) }));
    const mentions = (text: string): boolean => patterns.some(({ pattern }) => pattern.test(text));
    for (const [path, text] of texts) {
      if (!path.endsWith('.ts') && !isConfigurationText(path)) continue;
      if (!patterns.some(({ name }) => text.includes(name))) continue;
      if (!path.endsWith('.ts')) {
        if (mentions(text)) findings.push(finding('path reference to a removed file', path, gone));
        continue;
      }
      const source = head.sourceOf(path);
      if (!source) continue;
      for (const unit of analyzeSource(source, path).units) {
        for (const literal of literalsOf(unit.node)) {
          const value = (literal as ts.StringLiteralLike).text;
          if (mentions(value)) {
            const line = source.getLineAndCharacterOfPosition(literal.getStart(source)).line + 1;
            findings.push(finding('path reference to a removed file', path, gone, line));
          }
        }
      }
    }
  }
  return findings;
}
