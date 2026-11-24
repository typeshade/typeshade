import type { CommentReport } from './check-comments.js';
import { describeFinding } from './finding.js';

export function formatCommentReport(report: CommentReport): string {
  const { baseline } = report;
  const lines = [
    `Comment removal: ${report.pure ? 'pure' : 'NOT pure'}. ${report.changedPaths} changed paths.`,
    `Files: ${report.files.length} changed, ${report.removedLines} banned comment lines removed, ${report.uncountedLines} lines the policy does not count.`,
    `Findings: ${report.findings.length} (code tokens, comments added or edited, allowed comments removed).`,
    `Outside the removal: ${report.outside.length}.`,
    `Baseline: ${baseline.before} -> ${baseline.after} (${baseline.delta} fewer).`,
  ];
  for (const file of report.files) {
    lines.push(`file     ${file.path}: ${file.removed} comments, ${file.removedLines} lines`);
  }
  for (const f of report.findings) lines.push(describeFinding(f));
  for (const entry of report.outside) lines.push(`outside  ${entry.path}: ${entry.reason}`);
  return lines.join('\n');
}
