import ts from 'typescript';
import { LAYER_POLICY_PATH, knownEdges } from './known-edges.js';
import { renamingOnlyMarkdown } from './markdown.js';

export const SIZE_BASELINE = 'scripts/file-size-baseline.json';
export const COMMENT_BASELINE = 'scripts/comment-baseline.json';
const SURFACE_PATH = 'src/__api__/surface.md';
const FORBIDDEN_PATHS: readonly string[] = ['docs/owner-decisions.md', 'CLAUDE.md'];

export interface OutsideEntry {
  readonly path: string;
  readonly reason: string;
}

export interface DiffEntry {
  readonly path: string;
  readonly oldMode: string;
  readonly newMode: string;
}

interface OutsideResult {
  readonly outside: OutsideEntry[];
  readonly knownEdgesRemoved: string[];
  readonly surfacePathChanges: number;
}

export const isComparedSource = (path: string): boolean => path.endsWith('.ts');

function entriesOf(text: string | undefined): Record<string, number> {
  return text === undefined ? {} : (JSON.parse(text) as Record<string, number>);
}

const sumOf = (record: Record<string, number>): number =>
  Object.values(record).reduce((a, b) => a + b, 0);

function baselineGrowth(
  base: string | undefined,
  head: string | undefined,
  newEntriesAllowed: boolean,
): string | undefined {
  const before = entriesOf(base);
  const after = entriesOf(head);
  if (sumOf(after) > sumOf(before)) return 'the sum of its numbers grew';
  if (!newEntriesAllowed && Object.keys(after).length > Object.keys(before).length) {
    return 'it has more entries';
  }
  const grown = Object.keys(after).find((key) => key in before && after[key]! > before[key]!);
  return grown === undefined ? undefined : `the entry ${grown} grew`;
}

const surfaceKey = (line: string): string => line.replace(/^src\/[^#\s]+#/, '');

function countLines(lines: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  return counts;
}

function surfaceCheck(base: string | undefined, head: string | undefined) {
  const baseLines = (base ?? '').split('\n');
  const headLines = (head ?? '').split('\n');
  const baseKeys = countLines(baseLines.map(surfaceKey));
  const headKeys = countLines(headLines.map(surfaceKey));
  const same =
    baseKeys.size === headKeys.size && [...baseKeys].every(([k, n]) => headKeys.get(k) === n);
  const baseRaw = countLines(baseLines);
  const changed = headLines.filter((line) => {
    const left = baseRaw.get(line) ?? 0;
    if (left > 0) baseRaw.set(line, left - 1);
    return left === 0;
  }).length;
  return { same, changed };
}

const parse = (text: string | undefined): ts.SourceFile | undefined =>
  text === undefined
    ? undefined
    : ts.createSourceFile(LAYER_POLICY_PATH, text, ts.ScriptTarget.Latest, true);

function modeProblem(entry: DiffEntry): string | undefined {
  if (entry.oldMode === '120000' || entry.newMode === '120000') return 'a symbolic link';
  if (entry.oldMode !== '000000' && entry.newMode !== '000000' && entry.oldMode !== entry.newMode) {
    return `a mode change ${entry.oldMode} -> ${entry.newMode}`;
  }
  return undefined;
}

export function checkOutside(
  base: ReadonlyMap<string, string>,
  head: ReadonlyMap<string, string>,
  paths: readonly string[],
  entries: readonly DiffEntry[],
  renames: ReadonlyMap<string, string>,
): OutsideResult {
  const outside: OutsideEntry[] = [];
  const knownEdgesRemoved: string[] = [];
  let surfacePathChanges = 0;
  for (const entry of entries) {
    const problem = modeProblem(entry);
    if (problem !== undefined) outside.push({ path: entry.path, reason: problem });
  }
  for (const path of paths) {
    if (FORBIDDEN_PATHS.includes(path)) {
      outside.push({ path, reason: 'a pure move never changes this file' });
    } else if (path === SIZE_BASELINE || path === COMMENT_BASELINE) {
      const growth = baselineGrowth(base.get(path), head.get(path), path === COMMENT_BASELINE);
      if (growth !== undefined) outside.push({ path, reason: `the baseline grew: ${growth}` });
    } else if (path === SURFACE_PATH) {
      const { same, changed } = surfaceCheck(base.get(path), head.get(path));
      surfacePathChanges = changed;
      if (!same) outside.push({ path, reason: 'a line changed more than its path' });
    } else if (path === LAYER_POLICY_PATH) {
      const before = knownEdges(parse(base.get(path)));
      const after = knownEdges(parse(head.get(path)));
      for (const edge of before) if (!after.has(edge)) knownEdgesRemoved.push(edge);
      for (const edge of after) {
        if (!before.has(edge)) outside.push({ path, reason: `KNOWN edge added: ${edge}` });
      }
    } else if (isComparedSource(path)) {
      continue;
    } else if (path.endsWith('.md')) {
      if (!renamingOnlyMarkdown(path, base.get(path), head.get(path), renames)) {
        outside.push({ path, reason: 'a document may only follow a renamed path' });
      }
    } else {
      outside.push({ path, reason: 'a pure move may not change this file' });
    }
  }
  return { outside, knownEdgesRemoved, surfacePathChanges };
}
