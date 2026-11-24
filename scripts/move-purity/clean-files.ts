import ts from 'typescript';
import { describeNode } from './evaluation-state.js';
import { unitsOfPath } from './compare-units.js';
import { contextOf } from './evaluation-context.js';
import { activeReason } from './evaluate-unit.js';
import { fileClassOf } from './file-class.js';
import { finding, type Finding } from './finding.js';
import type { ImportGraph } from './import-graph.js';
import type { Side } from './side-program.js';
import { isTestCall, testCallReason } from './test-calls.js';

const CYCLE_NODES_SHOWN = 6;
const TEXT_LIMIT = 60;

interface ActiveUnit {
  readonly line: number;
  readonly reason: string;
}

export function activeUnitsOf(side: Side, path: string): ActiveUnit[] {
  const ctx = contextOf(side);
  const isTest = fileClassOf(path) === 'test';
  const found: ActiveUnit[] = [];
  for (const unit of unitsOfPath(side, path)) {
    const reason =
      isTest && isTestCall(unit.node)
        ? testCallReason(unit.node, ctx)
        : activeReason(unit.node, ctx);
    if (reason !== undefined) found.push({ line: unit.line, reason });
  }
  const source = side.sourceOf(path);
  for (const statement of source?.statements ?? []) {
    if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference)
    ) {
      const line = source!.getLineAndCharacterOfPosition(statement.getStart(source)).line + 1;
      found.push({ line, reason: describeNode(statement) });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

export function describeCycle(cycle: readonly string[]): string {
  const shown = cycle.slice(0, CYCLE_NODES_SHOWN).join(' -> ');
  return cycle.length > CYCLE_NODES_SHOWN ? `${shown} -> ...` : shown;
}

function uncleanReason(side: Side, graph: ImportGraph, path: string): string | undefined {
  const cycle = graph.cycleThrough(path);
  if (cycle !== undefined) return `import cycle: ${describeCycle(cycle)}`;
  const active = activeUnitsOf(side, path);
  const first = active[0];
  if (first === undefined) return undefined;
  const count = active.length > 1 ? ` (${active.length} active units in the file)` : '';
  return `active unit at line ${first.line}: ${first.reason.slice(0, TEXT_LIMIT)}${count}`;
}

export function cleanTest(side: Side, graph: ImportGraph): (path: string) => boolean {
  const cache = new Map<string, boolean>();
  return (path) => {
    const known = cache.get(path);
    if (known !== undefined) return known;
    const clean = graph.componentSize(path) < 2 && activeUnitsOf(side, path).length === 0;
    cache.set(path, clean);
    return clean;
  };
}

interface CleanInput {
  readonly side: Side;
  readonly graph: ImportGraph;
  readonly paths: readonly string[];
  readonly label: 'base' | 'head';
}

export function cleanFileFindings({ side, graph, paths, label }: CleanInput): Finding[] {
  const findings: Finding[] = [];
  for (const path of paths) {
    if (side.sourceOf(path) === undefined) continue;
    const reason = uncleanReason(side, graph, path);
    if (reason !== undefined) {
      findings.push(finding('not a clean file path', path, `${label}: ${reason}`));
    }
  }
  return findings;
}
