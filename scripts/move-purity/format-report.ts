import type { MoveReport } from './check-move.js';
import type { UnitRef } from './compare-units.js';
import { describeFinding } from './findings.js';

const named = (ref: UnitRef): string =>
  `${ref.path}:${ref.line} ${ref.names.join(', ') || '(unnamed)'}`;

export function formatReport(report: MoveReport): string {
  const { units, titles } = report;
  const lines = [
    `Move purity: ${report.pure ? 'pure' : 'NOT pure'}. ${report.changedPaths} changed paths.`,
    `Units: ${units.changed.length} changed, ${units.appeared.length} appeared, ` +
      `${units.vanished.length} vanished, ${units.moved.length} moved, ${units.reordered.length} reordered.`,
    `Findings: ${report.findings.length} (bindings, surface, inert moves, module evaluation, comments, preamble).`,
    `Test titles: ${titles.appeared.length} appeared, ${titles.vanished.length} vanished.`,
    `Directives: ${report.directives.length} differ.`,
    `Outside the move: ${report.outside.length}.`,
    `Info: ${units.exportsAdded.length} export added, ${units.exportsRemoved.length} export removed, ` +
      `${report.knownEdgesRemoved.length} KNOWN edge removed, ` +
      `${report.surfacePathChanges} surface line changed.`,
  ];
  for (const { base, head } of units.changed) {
    lines.push(`changed  ${named(base)} -> ${head.path}:${head.line}`);
  }
  for (const d of report.directives) {
    lines.push(
      `directive ${d.path}: expected ${JSON.stringify(d.expected)} got ${JSON.stringify(d.got)}`,
    );
  }
  for (const ref of units.reordered) lines.push(`reordered ${named(ref)}`);
  for (const f of report.findings) lines.push(describeFinding(f));
  for (const ref of units.appeared) lines.push(`appeared ${named(ref)}`);
  for (const ref of units.vanished) lines.push(`vanished ${named(ref)}`);
  for (const t of titles.appeared) lines.push(`title appeared ${t.path}:${t.line} ${t.title}`);
  for (const t of titles.vanished) lines.push(`title vanished ${t.path}:${t.line} ${t.title}`);
  for (const entry of report.outside) lines.push(`outside  ${entry.path}: ${entry.reason}`);
  return lines.join('\n');
}
