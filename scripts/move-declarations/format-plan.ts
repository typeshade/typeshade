import { formatReport } from '../move-purity/format-report.js';
import type { MovePlan } from './plan.js';

const formattedNote = (formatted: boolean): string =>
  formatted ? 'formatted' : 'NOT formatted (Prettier would change a unit)';

const limitNote = (within: boolean): string => (within ? 'within 400' : 'ABOVE 400');

export function planJson(plan: MovePlan): string {
  const { texts: _texts, report, ...rest } = plan;
  return JSON.stringify({ ...rest, pure: report.pure, report }, null, 2);
}

export function formatPlan(plan: MovePlan): string {
  const lines = [`Move plan: ${plan.source} -> ${plan.target}`, 'Units moved:'];
  for (const unit of plan.moved) {
    const pulled = unit.pulled ? ' (pulled by --closure)' : '';
    lines.push(
      `  ${unit.names.join(', ') || '(unnamed)'}  ${unit.kind}  line ${unit.line}, ${unit.lines} lines${pulled}`,
    );
  }
  const section = (title: string, items: readonly string[]): void => {
    if (items.length === 0) return;
    lines.push(title, ...items.map((item) => `  ${item}`));
  };
  section('Imports of the new file:', plan.targetImports);
  section('Imports the source gets from the new file:', plan.sourceImports);
  section('Re-exports the source gets:', plan.sourceReexports);
  section('Imports of the source rewritten:', plan.sourceImportsRewritten);
  section('Imports removed from the source:', plan.sourceImportsRemoved);
  if (plan.exportsAdded.length > 0) {
    lines.push(`Exports added in the new file: ${plan.exportsAdded.join(', ')}`);
  }
  lines.push(
    `Source: ${plan.sourceLines.before} -> ${plan.sourceLines.after} lines (${limitNote(plan.sourceLines.withinLimit)})`,
    `Target: ${plan.targetLines.after} lines (${limitNote(plan.targetLines.withinLimit)})`,
    `Placement of the new statements: ${plan.placement}`,
    `Formatting: source ${formattedNote(plan.formatted.source)}, target ${formattedNote(plan.formatted.target)}`,
  );
  if (plan.surfaceNames.length > 0) {
    lines.push(
      `src/__api__/surface.md names ${plan.surfaceNames.join(', ')} by the old path: run \`bun run bake:api-surface\` (decision D6, path-only change).`,
    );
  }
  lines.push(formatReport(plan.report));
  return lines.join('\n');
}

export const COMMIT_HINT = [
  'Next:',
  '  1. bun run bake:api-surface, when the plan names src/__api__/surface.md. Then bun run bake:file-size-baseline. (Run the tool with --bake to do both.)',
  '  2. Add the line `Move: pure` to the commit message, and `Change: none, <reason>`.',
  '  3. bun scripts/move-purity.ts --base HEAD~1 --head HEAD --require',
].join('\n');
