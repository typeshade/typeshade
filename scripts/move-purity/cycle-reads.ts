import { contextOf } from './evaluation-context.js';
import { evaluateUnit } from './evaluation-free.js';
import { finding, type Finding } from './finding.js';
import type { ImportGraph } from './import-graph.js';
import type { Side } from './side-program.js';
import type { Unit } from './units.js';

export function cycleReadFindings(
  moved: readonly (readonly [Unit, Unit])[],
  head: Side,
  graph: ImportGraph,
): Finding[] {
  const findings: Finding[] = [];
  const ctx = contextOf(head);
  for (const [from, to] of moved) {
    if (from.path === to.path) continue;
    const component = graph.componentOf(to.path);
    for (const declaration of evaluateUnit(to.node, ctx).reads) {
      const owner = head.pathOf(declaration.getSourceFile().fileName);
      if (owner === undefined || owner === to.path || graph.componentOf(owner) !== component)
        continue;
      findings.push(
        finding(
          'evaluation read across an import cycle',
          to.path,
          `${to.names.join(', ') || '(unnamed)'} -> ${owner}`,
          to.line,
        ),
      );
    }
  }
  return findings;
}
