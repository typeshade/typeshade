import { analyseFile } from './cohesion/components.js';
import { HUB_SHARE } from './cohesion/graph.js';
import {
  findingOf,
  GIANT_MIN_FILE_LINES,
  GIANT_SHARE,
  MIN_COMPONENT_LINES,
} from './cohesion/report.js';
import type { Finding, ShapeContext, Signal } from './types.js';

export { HUB_SHARE } from './cohesion/graph.js';
export { MIN_DECLARATIONS } from './cohesion/components.js';
export { GIANT_SHARE, MIN_COMPONENT_LINES } from './cohesion/report.js';

export const cohesion: Signal = (ctx) => {
  const findings: Finding[] = [];
  for (const source of ctx.analysed) {
    const entry = analyseFile(ctx.checker, source);
    const finding = entry === undefined ? undefined : findingOf(ctx.rel(source), entry);
    if (finding !== undefined) findings.push(finding);
  }
  return findings;
};

export function summariseCohesion(ctx: ShapeContext, findings: readonly Finding[]): string[] {
  const entries = ctx.analysed.flatMap((source) => analyseFile(ctx.checker, source) ?? []);
  const single = entries.filter((entry) => entry.allComponents.length === 1).length;
  const count = (kind: string): number => findings.filter((f) => f.kind === kind).length;
  return [
    `${entries.length} files have 4 or more declarations; ${single} of them are one component.`,
    `${count('cut-line')} files have a cut-line: after the hubs are removed, 2 or more components of ${MIN_COMPONENT_LINES} lines or more share only hubs.`,
    `${count('giant-declaration')} files have a giant declaration: one component, one declaration of ${GIANT_SHARE * 100}% of the file lines or more, file of ${GIANT_MIN_FILE_LINES} lines or more. A split by moving declarations cannot help; the cut is inside the declaration, a design change.`,
    `A hub is a declaration that more than ${HUB_SHARE * 100}% of the other declarations reference. A type-only reference counts as an edge.`,
    'A finding is evidence and a pointed remedy, not a verdict.',
  ];
}
