import { contextOf } from './evaluation-context.js';
import { evaluateUnit } from './evaluation-free.js';
import { finding, type Finding } from './finding.js';
import type { FilePairs } from './file-pairs.js';
import { unitsOfPath } from './compare-units.js';
import type { ImportGraph } from './import-graph.js';
import { buildImportGraph } from './import-graph.js';
import type { Links } from './module-links.js';
import type { Side } from './side-program.js';

const ROOT_REPORT_CAP = 10;

function effectfulIn(side: Side, links: Links): (path: string) => boolean {
  const ctx = contextOf(side);
  const memo = new Map<string, boolean>();
  return (path) => {
    const known = memo.get(path);
    if (known !== undefined) return known;
    const active =
      unitsOfPath(side, path).some((unit) => evaluateUnit(unit.node, ctx).reason !== undefined) ||
      links.of(path).some((link) => link.sideEffect && !side.texts.has(link.target));
    memo.set(path, active);
    return active;
  };
}

export interface EvaluationOrder {
  readonly headGraph: ImportGraph;
  readonly findings: Finding[];
}

export function evaluationOrderFindings(
  base: Side,
  head: Side,
  baseLinks: Links,
  headLinks: Links,
  files: FilePairs,
): EvaluationOrder {
  const baseGraph = buildImportGraph(base, baseLinks);
  const headGraph = buildImportGraph(head, headLinks);
  const baseEffect = effectfulIn(base, baseLinks);
  const headEffect = effectfulIn(head, headLinks);
  const rename = (path: string): string => files.renames.get(path) ?? path;
  const findings: Finding[] = [];
  let differing = 0;
  for (const root of [...base.texts.keys()].filter((p) => p.endsWith('.ts')).sort()) {
    const headRoot = rename(root);
    if (!head.texts.has(headRoot)) continue;
    const before = baseGraph.orderFrom(root).filter(baseEffect).map(rename);
    const after = headGraph.orderFrom(headRoot).filter(headEffect);
    const at = Array.from({ length: Math.max(before.length, after.length) }, (_, i) => i).find(
      (i) => before[i] !== after[i],
    );
    if (at === undefined) continue;
    differing += 1;
    if (differing > ROOT_REPORT_CAP) continue;
    findings.push(
      finding(
        'evaluation order from',
        headRoot,
        `first difference at position ${at}: base ${before[at] ?? 'end'} head ${after[at] ?? 'end'}`,
      ),
    );
  }
  if (differing > ROOT_REPORT_CAP) {
    findings.push(
      finding('evaluation order from', '(more roots)', `${differing - ROOT_REPORT_CAP} more`),
    );
  }
  return { headGraph, findings };
}
