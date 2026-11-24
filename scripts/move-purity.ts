import { checkMove, type MoveReport } from './move-purity/check-move.js';
import { formatReport } from './move-purity/format-report.js';
import {
  declaresPureMove,
  diffPaths,
  mergeBase,
  needsText,
  readTexts,
} from './move-purity/git-range.js';

export { checkMove, formatReport };
export type { MoveReport };

export function checkRange(root: string, baseRef: string, headRef: string): MoveReport {
  const base = mergeBase(root, baseRef, headRef);
  const paths = diffPaths(root, base, headRef);
  const wanted = paths.filter(needsText);
  return checkMove(readTexts(root, base, wanted), readTexts(root, headRef, wanted), paths);
}

function valueOf(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : undefined;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const baseRef = valueOf(args, '--base');
  if (baseRef === undefined) {
    console.error(
      'Usage: bun scripts/move-purity.ts --base <ref> [--head <ref>] [--require] [--json]',
    );
    process.exit(2);
  }
  const headRef = valueOf(args, '--head') ?? 'HEAD';
  const root = process.cwd();
  const declared = declaresPureMove(root, mergeBase(root, baseRef, headRef), headRef);
  if (!declared && !args.includes('--require')) {
    console.log('This range declares no pure move (no `Move: pure` trailer): nothing to check.');
    process.exit(0);
  }
  const report = checkRange(root, baseRef, headRef);
  console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report));
  process.exit(report.pure ? 0 : 1);
}
