import type { MoveReport } from './check-move.js';
import type { UnitRef } from './compare-units.js';

const named = (ref: UnitRef): string =>
  `${ref.path}:${ref.line} ${ref.names.join(', ') || '(unnamed)'}`;

export function formatReport(report: MoveReport): string {
  const { units, titles } = report;
  const lines = [
    `Move purity: ${report.pure ? 'pure' : 'NOT pure'}. ${report.changedPaths} changed paths.`,
    `Units: ${units.changed.length} changed, ${units.appeared.length} appeared, ` +
      `${units.vanished.length} vanished, ${units.moved.length} moved.`,
    `Test titles: ${titles.appeared.length} appeared, ${titles.vanished.length} vanished.`,
    `Outside the move: ${report.outside.length}.`,
    `Info: ${units.exportsAdded.length} export added, ${units.exportsRemoved.length} export removed, ` +
      `${report.knownEdgesRemoved.length} KNOWN edge removed, ` +
      `${report.surfacePathChanges} surface line changed.`,
  ];
  for (const { base, head } of units.changed) {
    lines.push(`changed  ${named(base)} -> ${head.path}:${head.line}`);
  }
  for (const ref of units.appeared) lines.push(`appeared ${named(ref)}`);
  for (const ref of units.vanished) lines.push(`vanished ${named(ref)}`);
  for (const t of titles.appeared) lines.push(`title appeared ${t.path}:${t.line} ${t.title}`);
  for (const t of titles.vanished) lines.push(`title vanished ${t.path}:${t.line} ${t.title}`);
  for (const entry of report.outside) lines.push(`outside  ${entry.path}: ${entry.reason}`);
  return lines.join('\n');
}
