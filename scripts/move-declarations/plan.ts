import { dirname, relative } from 'node:path/posix';
import { checkMove, type MoveReport } from '../move-purity/check-move.js';
import { createSide } from '../move-purity/side-program.js';
import { LINE_LIMIT, lineCount } from '../file-size-policy.js';
import type { MoveOptions } from './arguments.js';
import { checkComments, surfaceNames } from './comment-ban.js';
import { composeSource } from './compose-source.js';
import { composeTarget } from './compose-target.js';
import { formatKeepingUnits } from './format-text.js';
import { planImports } from './import-plan.js';
import { linkBlock, nameFacts, neededUsage } from './link-block.js';
import { checkPaths } from './path-guards.js';
import { candidateGaps } from './placement.js';
import { analyzeReferences } from './references.js';
import { segmentsOf } from './segments.js';
import { selectUnits } from './selection.js';
import {
  checkBlockers,
  checkClean,
  checkLocations,
  checkReflow,
  checkReportClean,
} from './source-guards.js';
import type { Workspace } from './workspace.js';
import ts from 'typescript';

export interface PlannedUnit {
  readonly names: readonly string[];
  readonly kind: string;
  readonly line: number;
  readonly lines: number;
  readonly pulled: boolean;
}

interface SizeInfo {
  readonly before: number;
  readonly after: number;
  readonly withinLimit: boolean;
}

export interface MovePlan {
  readonly source: string;
  readonly target: string;
  readonly moved: readonly PlannedUnit[];
  readonly targetImports: readonly string[];
  readonly sourceImports: readonly string[];
  readonly sourceReexports: readonly string[];
  readonly sourceImportsRewritten: readonly string[];
  readonly sourceImportsRemoved: readonly string[];
  readonly exportsAdded: readonly string[];
  readonly sourceLines: SizeInfo;
  readonly targetLines: SizeInfo;
  readonly placement: string;
  readonly formatted: { readonly source: boolean; readonly target: boolean };
  readonly surfaceNames: readonly string[];
  readonly report: MoveReport;
  readonly texts: { readonly source: string; readonly target: string };
}

const moduleSpecifier = (source: string, target: string): string => {
  const path = relative(dirname(source), target).replace(/\.ts$/, '.js');
  return path.startsWith('.') ? path : `./${path}`;
};

function onlyOrderFindings(report: MoveReport): boolean {
  return (
    report.findings.length > 0 &&
    report.findings.every((f) => f.kind.startsWith('evaluation order')) &&
    report.units.changed.length + report.units.vanished.length + report.units.appeared.length ===
      0 &&
    report.units.reordered.length + report.directives.length + report.outside.length === 0
  );
}

export async function planMove(workspace: Workspace, options: MoveOptions): Promise<MovePlan> {
  const { source, target } = checkPaths(workspace, options);
  const side = createSide(workspace.root, workspace.base);
  const analysis = analyzeReferences(side, source);
  const selection = selectUnits(analysis, options.names, options.closure);
  checkClean(side, analysis, selection);
  checkBlockers(selection, source);
  checkLocations(analysis, selection, source, target);
  const { moved } = selection;
  const facts = nameFacts(analysis, moved);
  const needed = neededUsage(analysis, moved);
  const addExport = new Set(
    [...moved].filter((i) => {
      const unit = analysis.units[i]!;
      return !unit.exported && unit.names.some((name) => needed.has(name));
    }),
  );
  const imports = planImports(analysis, moved, source, target);
  const links = linkBlock(facts, needed, moduleSpecifier(source, target));
  const rawTarget = composeTarget(analysis, moved, addExport, imports.targetHeader);
  const names = facts.map((fact) => fact.name);
  checkComments(workspace.base, source, target, rawTarget, names);
  const targetText = await formatKeepingUnits(workspace, target, rawTarget);
  checkReflow(analysis, moved, addExport, targetText.reflowed, source);
  const segmented = segmentsOf(analysis.source);
  const block = [...links.imports, ...links.exports].join('\n');
  const edit = { moved, importEdits: imports.sourceEdits, block };
  let chosen: { text: string; formatted: boolean; report: MoveReport; label: string } | undefined;
  for (const gap of candidateGaps(analysis.source, segmented)) {
    const sourceText = await formatKeepingUnits(
      workspace,
      source,
      composeSource(analysis, segmented, edit, gap),
    );
    const head = new Map(workspace.base);
    head.set(source, sourceText.text);
    head.set(target, targetText.text);
    const report = checkMove(workspace.base, head, {
      paths: [source, target],
      root: workspace.root,
    });
    const attempt = { ...sourceText, report, label: gap.label };
    if (chosen === undefined || report.pure) chosen = attempt;
    if (report.pure || !onlyOrderFindings(report)) break;
  }
  const final = chosen!;
  checkReportClean(final.report, source);
  const lineOf = (index: number): number => {
    const unit = analysis.units[index]!;
    return lineCount(analysis.source.text.slice(unit.from, unit.to).replace(/^(?:[ \t]*\n)+/, ''));
  };
  const size = (before: number, after: number): SizeInfo => ({
    before,
    after,
    withinLimit: after <= LINE_LIMIT,
  });
  return {
    source,
    target,
    moved: [...moved]
      .sort((a, b) => a - b)
      .map((index) => ({
        names: analysis.units[index]!.names,
        kind: ts.SyntaxKind[analysis.units[index]!.node.kind]!,
        line: analysis.units[index]!.line,
        lines: lineOf(index),
        pulled: selection.pulled.has(index),
      })),
    targetImports: imports.targetHeader,
    sourceImports: links.imports,
    sourceReexports: links.exports,
    sourceImportsRewritten: [...imports.sourceEdits.values()].flat(),
    sourceImportsRemoved: imports.removed,
    exportsAdded: [...addExport].flatMap((i) => analysis.units[i]!.names),
    sourceLines: size(lineCount(analysis.source.text), lineCount(final.text)),
    targetLines: size(0, lineCount(targetText.text)),
    placement: final.label,
    formatted: { source: final.formatted, target: targetText.formatted },
    surfaceNames: surfaceNames(workspace.base, source, names),
    report: final.report,
    texts: { source: final.text, target: targetText.text },
  };
}
