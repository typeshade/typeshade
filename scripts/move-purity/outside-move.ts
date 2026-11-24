import { LAYER_POLICY_PATH, knownEdges } from './known-edges.js';

export const SIZE_BASELINE = 'scripts/file-size-baseline.json';
export const COMMENT_BASELINE = 'scripts/comment-baseline.json';
export const SURFACE_PATH = 'src/__api__/surface.md';

export interface OutsideEntry {
  readonly path: string;
  readonly reason: string;
}

export interface OutsideResult {
  readonly outside: OutsideEntry[];
  readonly knownEdgesRemoved: string[];
  readonly surfacePathChanges: number;
}

const DOCUMENT_PREFIXES = ['docs/', 'changes/'];

export const isComparedSource = (path: string): boolean =>
  path.startsWith('src/') && path.endsWith('.ts');

function sumOf(text: string | undefined): number {
  if (text === undefined) return 0;
  const record = JSON.parse(text) as Record<string, number>;
  return Object.values(record).reduce((a, b) => a + b, 0);
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

export function checkOutside(
  base: ReadonlyMap<string, string>,
  head: ReadonlyMap<string, string>,
  paths: readonly string[],
): OutsideResult {
  const outside: OutsideEntry[] = [];
  const knownEdgesRemoved: string[] = [];
  let surfacePathChanges = 0;
  for (const path of paths) {
    if (path === SIZE_BASELINE || path === COMMENT_BASELINE) {
      if (sumOf(head.get(path)) > sumOf(base.get(path))) {
        outside.push({ path, reason: 'the baseline grew: the sum of its numbers is higher' });
      }
    } else if (path === SURFACE_PATH) {
      const { same, changed } = surfaceCheck(base.get(path), head.get(path));
      surfacePathChanges = changed;
      if (!same) outside.push({ path, reason: 'a line changed more than its path' });
    } else if (path === LAYER_POLICY_PATH) {
      const before = knownEdges(base.get(path));
      const after = knownEdges(head.get(path));
      for (const edge of before) if (!after.has(edge)) knownEdgesRemoved.push(edge);
      for (const edge of after) {
        if (!before.has(edge)) outside.push({ path, reason: `KNOWN edge added: ${edge}` });
      }
    } else if (
      !isComparedSource(path) &&
      !DOCUMENT_PREFIXES.some((prefix) => path.startsWith(prefix))
    ) {
      outside.push({ path, reason: 'a pure move may not change this file' });
    }
  }
  return { outside, knownEdgesRemoved, surfacePathChanges };
}
