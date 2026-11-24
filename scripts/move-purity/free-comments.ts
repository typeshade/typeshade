import { fileComments, type FileComment } from './comments.js';
import { finding, type Finding } from './finding.js';
import type { FilePairs } from './file-pairs.js';
import { groupBy, matchGroups } from './group-match.js';
import type { Side } from './side-program.js';
import { analyzeSource } from './units.js';

export function freeComments(side: Side, path: string): FileComment[] {
  const source = side.sourceOf(path);
  if (!source) return [];
  const { units } = analyzeSource(source, path);
  return fileComments(source, path).filter(
    (comment) => !units.some((unit) => comment.pos >= unit.from && comment.pos < unit.to),
  );
}

const firstLine = (text: string): string => text.split('\n')[0]!;

export function freeCommentFindings(base: Side, head: Side, files: FilePairs): Finding[] {
  const findings: Finding[] = [];
  const sides: { before: string | undefined; after: string | undefined }[] = [
    ...files.pairs.map((p) => ({ before: p.base, after: p.head })),
    ...files.newFiles.map((p) => ({ before: undefined, after: p })),
    ...files.deletedFiles.map((p) => ({ before: p, after: undefined })),
  ];
  const sequences: { was: FileComment[]; now: FileComment[]; path: string }[] = [];
  for (const { before, after } of sides) {
    const was = before === undefined ? [] : freeComments(base, before);
    const now = after === undefined ? [] : freeComments(head, after);
    if (before !== undefined && after !== undefined) sequences.push({ was, now, path: after });
    const baseGroups = groupBy(was, (c) => c.text);
    const headGroups = groupBy(now, (c) => c.text);
    for (const text of new Set([...baseGroups.keys(), ...headGroups.keys()])) {
      const match = matchGroups(baseGroups.get(text) ?? [], headGroups.get(text) ?? []);
      for (const c of match.vanished) {
        findings.push(finding('free comment vanished', c.path, firstLine(c.text), c.line));
      }
      for (const c of match.appeared) {
        findings.push(finding('free comment appeared', c.path, firstLine(c.text), c.line));
      }
    }
  }
  if (findings.length === 0) {
    for (const { was, now, path } of sequences) {
      if (was.map((c) => c.text).join('\0') !== now.map((c) => c.text).join('\0')) {
        findings.push(finding('free comments reordered', path, ''));
      }
    }
  }
  return findings;
}

export function preambleFindings(base: Side, head: Side, files: FilePairs): Finding[] {
  const findings: Finding[] = [];
  for (const pair of files.pairs) {
    const before = base.sourceOf(pair.base);
    const after = head.sourceOf(pair.head);
    if (!before || !after) continue;
    const was = analyzeSource(before, pair.base);
    const now = analyzeSource(after, pair.head);
    if (was.bom !== now.bom) {
      findings.push(
        finding('preamble', pair.head, `byte order mark base ${was.bom} head ${now.bom}`),
      );
    }
    if (was.shebang !== now.shebang) {
      findings.push(
        finding(
          'preamble',
          pair.head,
          `shebang base ${was.shebang ?? 'none'} head ${now.shebang ?? 'none'}`,
        ),
      );
    }
  }
  return findings;
}
