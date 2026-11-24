import ts from 'typescript';
import { classifyComments, isAllowedText } from '../comment-policy.js';
import { fileComments } from './comments.js';
import { finding, type Finding } from './finding.js';
import { isProtectedComment } from './protected-comments.js';
import {
  firstSyntaxDifference,
  leafStarts,
  leavesBefore,
  syntaxStream,
  type SyntaxItem,
} from './syntax-stream.js';
import { analyzeSource, normalizeLineEndings } from './units.js';

export interface FileCommentReport {
  readonly path: string;
  readonly findings: Finding[];
  readonly removed: number;
  readonly removedLines: number;
  readonly uncountedLines: number;
}

const FIRST_CHARS = 60;

const normalized = (text: string): string =>
  normalizeLineEndings(text)
    .split('\n')
    .map((line, index) => (index === 0 ? line : line.trimStart()))
    .join('\n');

const shown = (text: string): string => text.replace(/\s+/g, ' ').slice(0, FIRST_CHARS);

const describeItem = (item: SyntaxItem | undefined): string =>
  item === undefined
    ? 'line end of file'
    : `line ${item.line} ${shown(item.text || ts.SyntaxKind[item.kind]!)}`;

function codeFindings(path: string, base: string, head: string): Finding[] {
  const difference = firstSyntaxDifference(syntaxStream(path, base), syntaxStream(path, head));
  if (difference === undefined) return [];
  const where = difference.base?.line ?? difference.head?.line ?? 1;
  const detail = `base ${describeItem(difference.base)} head ${describeItem(difference.head)}`;
  return [finding('code changed', path, detail, where)];
}

function preambleDifferences(path: string, base: string, head: string): Finding[] {
  const parse = (text: string) =>
    analyzeSource(ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true), path);
  const before = parse(base);
  const after = parse(head);
  const findings: Finding[] = [];
  if (before.directives.join('\0') !== after.directives.join('\0')) {
    findings.push(finding('directives changed', path, ''));
  }
  if (before.bom !== after.bom) findings.push(finding('preamble', path, 'byte order mark'));
  if (before.shebang !== after.shebang) findings.push(finding('preamble', path, 'shebang'));
  return findings;
}

export function compareCommentFiles(
  path: string,
  base: string,
  head: string,
  publicKeys: Set<string>,
): FileCommentReport {
  const findings = [...codeFindings(path, base, head), ...preambleDifferences(path, base, head)];
  const classes = new Map(
    classifyComments(path, base, publicKeys).map((comment) => [comment.pos, comment.kind]),
  );
  const parse = (text: string) =>
    fileComments(ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true), path);
  const before = parse(base);
  const after = parse(head);
  const baseStarts = leafStarts(path, base);
  const headStarts = leafStarts(path, head);
  const keyOf = (starts: readonly number[], comment: { text: string; pos: number }): string =>
    `${leavesBefore(starts, comment.pos)}\0${normalized(comment.text)}`;
  const baseKeys = before.map((comment) => keyOf(baseStarts, comment));
  const removed: typeof before = [];
  let at = 0;
  for (const comment of after) {
    const wanted = keyOf(headStarts, comment);
    let found = -1;
    for (let next = at; next < before.length && found < 0; next += 1) {
      if (baseKeys[next] === wanted) found = next;
    }
    if (found < 0) {
      findings.push(
        finding('comment added, edited or moved', path, shown(comment.text), comment.line),
      );
      continue;
    }
    removed.push(...before.slice(at, found));
    at = found + 1;
  }
  removed.push(...before.slice(at));
  let removedLines = 0;
  let uncountedLines = 0;
  for (const comment of removed) {
    const kind = classes.get(comment.pos);
    const counted = kind === 'banned';
    const removable =
      (counted || (kind === undefined && !isAllowedText(comment.text))) &&
      !isProtectedComment(comment.text);
    if (!removable) {
      findings.push(finding('allowed comment removed', path, shown(comment.text), comment.line));
    } else if (counted) {
      removedLines += comment.text.split('\n').length;
    } else {
      uncountedLines += comment.text.split('\n').length;
    }
  }
  return { path, findings, removed: removed.length, removedLines, uncountedLines };
}
