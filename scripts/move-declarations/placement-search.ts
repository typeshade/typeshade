import { checkMove, type MoveReport, type OrderEvidence } from '../move-purity/check-move.js';
import { composeSource, type SourceEdit } from './compose-source.js';
import { formatKeepingUnits } from './format-text.js';
import { createOrderProbe, type OrderProbe } from './order-probe.js';
import { candidateGaps } from './placement.js';
import type { SourceAnalysis } from './references.js';
import { refuse } from './refusal.js';
import type { SegmentedSource } from './segments.js';
import type { Workspace } from './workspace.js';

export interface SearchLimits {
  readonly maxChecks: number;
  readonly probe: boolean;
}

export const DEFAULT_SEARCH: SearchLimits = { maxChecks: 12, probe: true };

export interface PlacementInput {
  readonly workspace: Workspace;
  readonly analysis: SourceAnalysis;
  readonly segmented: SegmentedSource;
  readonly edit: SourceEdit;
  readonly source: string;
  readonly target: string;
  readonly targetText: string;
}

export interface Placement {
  readonly text: string;
  readonly formatted: boolean;
  readonly report: MoveReport;
  readonly label: string;
}

function onlyOrderFindings(report: MoveReport): boolean {
  return (
    report.findings.length > 0 &&
    report.findings.every((f) => f.kind.startsWith('evaluation order')) &&
    report.units.changed.length + report.units.vanished.length + report.units.appeared.length ===
      0 &&
    report.units.reordered.length + report.directives.length + report.outside.length === 0
  );
}

export async function choosePlacement(
  input: PlacementInput,
  limits: SearchLimits = DEFAULT_SEARCH,
): Promise<Placement> {
  const { workspace, analysis, segmented, edit, source, target } = input;
  let evidence: OrderEvidence | undefined;
  let probe: OrderProbe | undefined;
  let chosen: Placement | undefined;
  let checks = 0;
  const gaps = candidateGaps(analysis.source, segmented);
  for (const [position, gap] of gaps.entries()) {
    const raw = composeSource(analysis, segmented, edit, gap);
    if (position > 0 && probe !== undefined && !probe.admits(raw)) continue;
    if (checks === limits.maxChecks) {
      refuse(
        `no placement of the new import in ${source} kept the module evaluation order after ${limits.maxChecks} full move checks (${gaps.length} placements exist).`,
        'Each full check builds two TypeScript programs of the repository. The search stops here so that it does not run without end.',
        'Move fewer or other declarations, so that the imports of the new file keep their order relative to the other imports of the source.',
      );
    }
    checks += 1;
    const sourceText = await formatKeepingUnits(workspace, source, raw);
    const head = new Map(workspace.base);
    head.set(source, sourceText.text);
    head.set(target, input.targetText);
    const report = checkMove(workspace.base, head, {
      paths: [source, target],
      root: workspace.root,
      observe: (found) => {
        if (position === 0) evidence = found;
      },
    });
    if (evidence !== undefined && limits.probe) probe = createOrderProbe(evidence, source, raw);
    evidence = undefined;
    const attempt = { ...sourceText, report, label: gap.label };
    if (chosen === undefined || report.pure) chosen = attempt;
    if (report.pure || !onlyOrderFindings(report)) break;
  }
  return chosen!;
}
