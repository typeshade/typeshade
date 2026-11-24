import { isPolicedText, publicDefinitions } from '../comment-policy.js';
import { compareCommentFiles, type FileCommentReport } from './comment-removal.js';
import { finding, type Finding } from './finding.js';
import { lineCitationFindings } from './line-citations.js';
import {
  COMMENT_BASELINE,
  FORBIDDEN_PATHS,
  SIZE_BASELINE,
  isChecksPath,
  modeProblem,
  type DiffEntry,
  type OutsideEntry,
} from './outside-move.js';

export const SURFACE_PATH = 'src/__api__/surface.md';

export interface CommentReport {
  readonly pure: boolean;
  readonly changedPaths: number;
  readonly files: readonly Pick<
    FileCommentReport,
    'path' | 'removed' | 'removedLines' | 'uncountedLines'
  >[];
  readonly removedLines: number;
  readonly uncountedLines: number;
  readonly findings: Finding[];
  readonly outside: OutsideEntry[];
  readonly baseline: { readonly before: number; readonly after: number; readonly delta: number };
}

interface CommentOptions {
  readonly paths: readonly string[];
  readonly entries: readonly DiffEntry[];
}

const baselineOf = (text: string | undefined): Record<string, number> | undefined => {
  if (text === undefined) return {};
  try {
    return JSON.parse(text) as Record<string, number>;
  } catch {
    return undefined;
  }
};

const sumOf = (record: Record<string, number>): number =>
  Object.values(record).reduce((a, b) => a + b, 0);

function baselineProblem(
  before: Record<string, number> | undefined,
  after: Record<string, number> | undefined,
): string | undefined {
  if (before === undefined || after === undefined) return 'the baseline is not readable JSON';
  const added = Object.keys(after).find((key) => !(key in before));
  if (added !== undefined) return `the baseline gained an entry: ${added}`;
  const grown = Object.keys(after).find((key) => after[key]! > before[key]!);
  return grown === undefined ? undefined : `the baseline entry ${grown} grew`;
}

function entryProblems(entries: readonly DiffEntry[]): OutsideEntry[] {
  const outside: OutsideEntry[] = [];
  for (const entry of entries) {
    const added = entry.oldMode === '000000';
    const deleted = entry.newMode === '000000';
    const problem = modeProblem(entry) ?? (added ? 'an added file' : undefined);
    const reason = problem ?? (deleted ? 'a deleted file' : undefined);
    if (reason !== undefined) outside.push({ path: entry.path, reason });
  }
  return outside;
}

function pathProblem(path: string): string | undefined {
  if (path === COMMENT_BASELINE || path === SIZE_BASELINE) return undefined;
  if (isChecksPath(path)) return 'a comment removal may not change the checks path';
  if (FORBIDDEN_PATHS.includes(path)) return 'a comment removal never changes this file';
  if (!path.startsWith('src/') || !path.endsWith('.ts')) {
    return 'a comment removal may only change a .ts file of src/';
  }
  return undefined;
}

export function checkCommentRemoval(
  base: ReadonlyMap<string, string>,
  head: ReadonlyMap<string, string>,
  options: CommentOptions,
): CommentReport {
  const outside = entryProblems(options.entries);
  const findings: Finding[] = lineCitationFindings(head, options.paths);
  const files: FileCommentReport[] = [];
  const keys = publicDefinitions(base.get(SURFACE_PATH) ?? '');
  const before = baselineOf(base.get(COMMENT_BASELINE));
  const after = baselineOf(head.get(COMMENT_BASELINE));
  for (const path of options.paths) {
    const problem = pathProblem(path);
    if (problem !== undefined) {
      outside.push({ path, reason: problem });
      continue;
    }
    if (path === COMMENT_BASELINE || path === SIZE_BASELINE) {
      const growth =
        path === COMMENT_BASELINE
          ? baselineProblem(before, after)
          : baselineProblem(baselineOf(base.get(path)), baselineOf(head.get(path)));
      if (growth !== undefined) outside.push({ path, reason: growth });
      continue;
    }
    const was = base.get(path);
    const now = head.get(path);
    if (was === undefined || now === undefined) {
      if (!outside.some((entry) => entry.path === path)) {
        findings.push(finding('unreadable file path', path, ''));
      }
      continue;
    }
    if (!isPolicedText(path, was) || !isPolicedText(path, now)) {
      outside.push({ path, reason: 'the comment policy does not police this file' });
      continue;
    }
    const report = compareCommentFiles(path, was, now, keys);
    findings.push(...report.findings);
    files.push(report);
  }
  const totals = {
    before: sumOf(before ?? {}),
    after: sumOf(after ?? {}),
  };
  return {
    pure: findings.length === 0 && outside.length === 0,
    changedPaths: options.paths.length,
    files: files.map(({ path, removed, removedLines, uncountedLines }) => ({
      path,
      removed,
      removedLines,
      uncountedLines,
    })),
    removedLines: files.reduce((sum, file) => sum + file.removedLines, 0),
    uncountedLines: files.reduce((sum, file) => sum + file.uncountedLines, 0),
    findings,
    outside,
    baseline: { ...totals, delta: totals.before - totals.after },
  };
}
