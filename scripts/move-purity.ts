import { checkMove, type MoveReport } from './move-purity/check-move.js';
import { cleanReport, formatCleanReport } from './move-purity/clean-report.js';
import { formatReport } from './move-purity/format-report.js';
import { formatCommentReport } from './move-purity/format-comment-report.js';
import { checkCommentRange } from './move-purity/comment-range.js';
import {
  commitCount,
  commitLines,
  diffEntries,
  diffPaths,
  mergeBase,
  readTexts,
  trackedPaths,
} from './move-purity/git-range.js';
import { declaredKinds, malformedLines } from './move-purity/move-kinds.js';

export { checkMove, formatReport };
export type { MoveReport };

export interface RangeResult {
  readonly report: MoveReport;
  readonly commits: number;
}

export function checkRange(
  root: string,
  baseRef: string,
  headRef: string,
  allowTestMoves = false,
): RangeResult {
  const base = mergeBase(root, baseRef, headRef);
  const report = checkMove(
    readTexts(root, base, trackedPaths(root, base)),
    readTexts(root, headRef, trackedPaths(root, headRef)),
    {
      paths: diffPaths(root, base, headRef),
      entries: diffEntries(root, base, headRef),
      root,
      allowTestMoves,
    },
  );
  return { report, commits: commitCount(root, base, headRef) };
}

function flagValue(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : undefined;
}

function runCleanReport(args: string[], root: string): number {
  const paths = trackedPaths(root, 'HEAD').filter(
    (path) => path.endsWith('.ts') || path === 'package.json',
  );
  const report = cleanReport(root, readTexts(root, 'HEAD', paths));
  console.log(
    args.includes('--json') ? JSON.stringify(report, null, 2) : formatCleanReport(report),
  );
  return 0;
}

function runCommentRange(
  args: string[],
  range: { root: string; baseRef: string; headRef: string; required: boolean },
): number {
  const { report, commits } = checkCommentRange(range.root, range.baseRef, range.headRef);
  if (range.required && (commits === 0 || report.changedPaths === 0)) {
    console.log(
      `The range ${range.baseRef}..${range.headRef} has ${commits} commits and ${report.changedPaths} changed paths: nothing to check.`,
    );
    return 2;
  }
  console.log(
    args.includes('--json') ? JSON.stringify(report, null, 2) : formatCommentReport(report),
  );
  return report.pure ? 0 : 1;
}

export function runCli(args: string[], cwd: string): number {
  const root = flagValue(args, '--repo') ?? cwd;
  if (args.includes('--clean-report')) return runCleanReport(args, root);
  const baseRef = flagValue(args, '--base');
  if (baseRef === undefined) {
    console.error(
      'Usage: bun scripts/move-purity.ts --base <ref> [--head <ref>] [--require] [--title <text>] [--allow-test-moves] [--repo <path>] [--json]\n       bun scripts/move-purity.ts --clean-report [--json]',
    );
    return 2;
  }
  const headRef = flagValue(args, '--head') ?? 'HEAD';
  const base = mergeBase(root, baseRef, headRef);
  const lines = commitLines(root, base, headRef);
  const malformed = malformedLines(lines);
  if (malformed.length > 0) {
    for (const line of malformed)
      console.log(`Not a declaration of a pure move or a comment removal: "${line}"`);
    console.log(
      'Write exactly `Move: pure` or `Move: comments` on a line of its own, or remove the line.',
    );
    return 1;
  }
  const declared = declaredKinds(lines);
  if (declared.length > 1) {
    console.log('A range must not declare both `Move: pure` and `Move: comments`.');
    return 1;
  }
  const titled = /^\s*Move:/i.test(flagValue(args, '--title') ?? '');
  if (titled && declared.length === 0) {
    console.log(
      'a Move: pull request declares pure or comments (a commit message line `Move: pure` or `Move: comments`).',
    );
    return 1;
  }
  const required = args.includes('--require') || titled;
  if (declared.length === 0 && !required) {
    const message =
      'This range declares no pure move or comment removal (no commit message line `Move: pure` or `Move: comments`): the move-purity check did not run.';
    console.log(process.env.GITHUB_ACTIONS ? `::notice::${message}` : message);
    return 0;
  }
  if (declared[0] === 'comments')
    return runCommentRange(args, { root, baseRef, headRef, required });
  const { report, commits } = checkRange(
    root,
    baseRef,
    headRef,
    args.includes('--allow-test-moves'),
  );
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
