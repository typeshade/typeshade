import { cleanTest } from './clean-files.js';
import { finding, type Finding } from './finding.js';
import type { FilePairs } from './file-pairs.js';
import type { ImportGraph } from './import-graph.js';
import { buildImportGraph } from './import-graph.js';
import type { Links } from './module-links.js';
import type { Side } from './side-program.js';

const ROOT_REPORT_CAP = 10;

interface EvaluationOrder {
  readonly baseGraph: ImportGraph;
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
  const rename = (path: string): string => files.renames.get(path) ?? path;
  const renamedTargets = new Set(files.renames.values());
  const inBoth = (path: string): boolean => base.texts.has(path) || renamedTargets.has(path);
  const baseClean = cleanTest(base, baseGraph);
  const headClean = cleanTest(head, headGraph);
  const findings: Finding[] = [];
  let differing = 0;
  for (const root of [...base.texts.keys()].filter((p) => p.endsWith('.ts')).sort()) {
    const headRoot = rename(root);
    if (!head.texts.has(headRoot)) continue;
    const before = baseGraph
      .orderFrom(root)
      .filter((path) => !baseClean(path))
      .map(rename)
      .filter((path) => head.texts.has(path));
    const after = headGraph
      .orderFrom(headRoot)
      .filter(inBoth)
      .filter((path) => !headClean(path));
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
  return { baseGraph, headGraph, findings };
}
