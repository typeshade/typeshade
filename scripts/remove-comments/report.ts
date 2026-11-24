import type { FileResult } from './remove-file.js';

const TEXT_CHARS = 160;

export function formatCandidates(result: FileResult): string[] {
  return result.candidates.map(
    (candidate) =>
      `candidate ${candidate.path}:${candidate.line} ${candidate.text.slice(0, TEXT_CHARS)}`,
  );
}

export function formatResult(result: FileResult, dryRun: boolean): string[] {
  const lines = [
    `${result.path}: banned lines ${result.bannedBefore} -> ${result.bannedAfter}, ` +
      `${result.removedComments} comments ${dryRun ? 'would be removed' : 'removed'}, ` +
      `${result.candidates.length} review candidates (${result.keptCandidates} kept), ` +
      `${result.keptProtected} protected kept.`,
  ];
  for (const problem of result.problems) lines.push(`PROBLEM ${problem}`);
  return lines;
}

export function jsonOf(results: readonly FileResult[], dryRun: boolean): string {
  return JSON.stringify(
    {
      dryRun,
      files: results.map(({ text: _text, ...rest }) => rest),
    },
    null,
    2,
  );
}
