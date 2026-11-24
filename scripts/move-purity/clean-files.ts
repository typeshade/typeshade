import { unitsOfPath } from './compare-units.js';
import { contextOf } from './evaluation-context.js';
import { activeReason } from './evaluate-unit.js';
import { fileClassOf } from './file-class.js';
import { finding, type Finding } from './finding.js';
import type { ImportGraph } from './import-graph.js';
import type { Side } from './side-program.js';
import { isTestCall } from './test-moves.js';

const CYCLE_NODES_SHOWN = 6;
const TEXT_LIMIT = 60;

export interface ActiveUnit {
  readonly line: number;
  readonly reason: string;
}

export function activeUnitsOf(side: Side, path: string): ActiveUnit[] {
  const ctx = contextOf(side);
  const isTest = fileClassOf(path) === 'test';
  const found: ActiveUnit[] = [];
  for (const unit of unitsOfPath(side, path)) {
    if (isTest && isTestCall(unit.node)) continue;
    const reason = activeReason(unit.node, ctx);
    if (reason !== undefined) found.push({ line: unit.line, reason });
  }
  return found;
}

export function describeCycle(cycle: readonly string[]): string {
  const shown = cycle.slice(0, CYCLE_NODES_SHOWN).join(' -> ');
  return cycle.length > CYCLE_NODES_SHOWN ? `${shown} -> ...` : shown;
}

export function uncleanReason(side: Side, graph: ImportGraph, path: string): string | undefined {
  const cycle = graph.cycleThrough(path);
  if (cycle !== undefined) return `import cycle: ${describeCycle(cycle)}`;
  const active = activeUnitsOf(side, path);
  const first = active[0];
  if (first === undefined) return undefined;
  const count = active.length > 1 ? ` (${active.length} active units in the file)` : '';
  return `active unit at line ${first.line}: ${first.reason.slice(0, TEXT_LIMIT)}${count}`;
}

export interface CleanInput {
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
