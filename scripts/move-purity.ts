import { checkMove, type MoveReport } from './move-purity/check-move.js';
import { formatReport } from './move-purity/format-report.js';
import {
  commitCount,
  declaresPureMove,
  diffEntries,
  diffPaths,
  mergeBase,
  needsText,
  readTexts,
  trackedPaths,
} from './move-purity/git-range.js';

export { checkMove, formatReport };
export type { MoveReport };

export interface RangeResult {
  readonly report: MoveReport;
  readonly commits: number;
}

export function checkRange(root: string, baseRef: string, headRef: string): RangeResult {
  const base = mergeBase(root, baseRef, headRef);
  const paths = diffPaths(root, base, headRef);
  const baseTracked = trackedPaths(root, base);
  const headTracked = trackedPaths(root, headRef);
  const wanted = (tracked: string[]): string[] => tracked.filter(needsText);
  const report = checkMove(
    readTexts(root, base, wanted(baseTracked)),
    readTexts(root, headRef, wanted(headTracked)),
    {
      paths,
      entries: diffEntries(root, base, headRef),
      tracked: new Set([...baseTracked, ...headTracked]),
      root,
    },
  );
  return { report, commits: commitCount(root, base, headRef) };
}

function flagValue(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : undefined;
}

export function runCli(args: string[], root: string): number {
  const baseRef = flagValue(args, '--base');
  if (baseRef === undefined) {
    console.error(
      'Usage: bun scripts/move-purity.ts --base <ref> [--head <ref>] [--require] [--json]',
    );
    return 2;
  }
  const headRef = flagValue(args, '--head') ?? 'HEAD';
  const base = mergeBase(root, baseRef, headRef);
  const required = args.includes('--require');
  if (!declaresPureMove(root, base, headRef) && !required) {
    const message =
      'This range declares no pure move (no commit message line `Move: pure`): the move-purity check did not run.';
    console.log(process.env.GITHUB_ACTIONS ? `::notice::${message}` : message);
    return 0;
  }
  const { report, commits } = checkRange(root, baseRef, headRef);
  if (required && (commits === 0 || report.changedPaths === 0)) {
    console.log(
      `The range ${base}..${headRef} has ${commits} commits and ${report.changedPaths} changed paths: nothing to check.`,
    );
    return 2;
  }
  console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report));
  return report.pure ? 0 : 1;
}

if (import.meta.main) process.exit(runCli(process.argv.slice(2), process.cwd()));
