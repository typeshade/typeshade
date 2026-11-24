import { dirname } from 'node:path/posix';
import type { MoveReport } from '../move-purity/check-move.js';
import { activeUnitsOf } from '../move-purity/clean-files.js';
import { describeFinding } from '../move-purity/finding.js';
import { locationReason } from '../move-purity/moved-unit-findings.js';
import type { Side } from '../move-purity/side-program.js';
import { refuse } from './refusal.js';
import type { SourceAnalysis } from './references.js';
import type { Blocker, Selection } from './selection.js';

const nameOf = (analysis: SourceAnalysis, index: number): string =>
  analysis.units[index]!.names.join(', ') || '(unnamed)';

export function checkClean(side: Side, analysis: SourceAnalysis, selection: Selection): void {
  const active = activeUnitsOf(side, analysis.path);
  for (const index of selection.moved) {
    const unit = analysis.units[index]!;
    const found = active.find((entry) => entry.line === unit.line);
    if (found) {
      refuse(
        `${nameOf(analysis, index)} is not evaluation-free (line ${unit.line}): ${found.reason}`,
      );
    }
  }
}

export function checkReportClean(report: MoveReport, source: string): void {
  const findings = report.findings.filter(
    (found) => found.kind === 'not a clean file path' && found.detail.startsWith('base:'),
  );
  if (findings.length > 0) {
    refuse(
      `the source ${source} is not a clean file (the move-purity check refuses it)`,
      ...findings.map(describeFinding),
    );
  }
}

const describeBlocker = (blocker: Blocker): string => {
  const kind = blocker.exported ? 'exported' : 'private';
  const also =
    blocker.alsoUsedBy.length > 0
      ? `; also used by ${blocker.alsoUsedBy.join(', ')} which stay`
      : '';
  return `${blocker.names.join(', ')} (${kind}; used by ${blocker.usedBy.join(', ')}${also})`;
};

export function checkBlockers(selection: Selection, source: string): void {
  if (selection.blockers.length === 0) return;
  refuse(
    `the moved declarations use declarations that stay in ${source}; the target would have to import them from ${source}, which makes an import cycle:`,
    ...selection.blockers.map((blocker) => `  ${describeBlocker(blocker)}`),
    'List these names in --move to move them too, or add --closure to move the private helpers that only the moved group uses.',
  );
}

export function checkLocations(
  analysis: SourceAnalysis,
  selection: Selection,
  source: string,
  target: string,
): void {
  const changed = dirname(source) !== dirname(target);
  for (const index of selection.moved) {
    const reason = locationReason(analysis.units[index]!.node, changed);
    if (reason !== undefined) {
      refuse(`${nameOf(analysis, index)} is location-dependent (${reason}); it does not move`);
    }
  }
}

export function checkReflow(
  analysis: SourceAnalysis,
  moved: ReadonlySet<number>,
  addExport: ReadonlySet<number>,
  reflowed: readonly number[],
  source: string,
): void {
  const ordered = [...moved].sort((a, b) => a - b);
  const names = reflowed
    .filter((at) => addExport.has(ordered[at]!))
    .map((at) => nameOf(analysis, ordered[at]!));
  if (names.length === 0) return;
  refuse(
    `adding \`export\` makes Prettier re-wrap ${names.join(', ')}; the new file cannot be both pure and Prettier-clean`,
    `Export ${names.join(', ')} in ${source} first, in an ordinary pull request that formats them. Then move them.`,
  );
}
