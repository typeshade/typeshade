import { areaOf, areasNest } from './areas.js';
import { importEdges } from './imports.js';
import type { Finding, ShapeContext, Signal } from './types.js';
import type ts from 'typescript';

export const BREADTH_REPORT_FROM = 4;

export interface Breadth {
  file: ts.SourceFile;
  valueAreas: string[];
  typeAreas: string[];
  modules: string[];
}

export function breadthOf(ctx: ShapeContext): Breadth[] {
  return ctx.analysed.map((file) => {
    const own = areaOf(ctx.rel(file));
    const value = new Set<string>();
    const type = new Set<string>();
    const modules = new Set<string>();
    for (const edge of importEdges(ctx.checker, file)) {
      const targetRel = ctx.rel(edge.target);
      if (!targetRel.startsWith('src/')) continue;
      const area = areaOf(targetRel);
      if (areasNest(area, own)) continue;
      modules.add(targetRel);
      (edge.typeOnly ? type : value).add(area);
    }
    const typeOnly = [...type].filter((area) => !value.has(area));
    return {
      file,
      valueAreas: [...value].sort(),
      typeAreas: typeOnly.sort(),
      modules: [...modules].sort(),
    };
  });
}

export const breadth: Signal = (ctx) => {
  const findings: Finding[] = [];
  for (const entry of breadthOf(ctx)) {
    const areaList = [...entry.valueAreas, ...entry.typeAreas].sort();
    if (areaList.length < BREADTH_REPORT_FROM) continue;
    findings.push({
      signal: 'breadth',
      file: ctx.rel(entry.file),
      line: 1,
      kind: 'wide-imports',
      evidence: {
        valueAreas: entry.valueAreas.length,
        typeAreas: entry.typeAreas.length,
        modules: entry.modules.length,
        areaList,
      },
      remedy: 'none (report)',
    });
  }
  return findings;
};

export function summariseBreadth(ctx: ShapeContext, findings: readonly Finding[]): string[] {
  const counts = breadthOf(ctx).map((entry) => entry.valueAreas.length + entry.typeAreas.length);
  const narrow = counts.filter((count) => count <= 2).length;
  const widest = [...findings].sort(
    (a, b) => Number(b.evidence.modules) - Number(a.evidence.modules),
  )[0];
  return [
    `${narrow} of ${counts.length} files import from 0 to 2 other areas.`,
    `${findings.length} files import from ${BREADTH_REPORT_FROM} or more other areas (reporting threshold, not a check).`,
    'valueAreas counts other areas reached by a value import; typeAreas counts other areas reached only by type-only imports; modules counts distinct imported files of other areas.',
    'To choose the cut of a wide file, read signal 4 (cohesion).',
    ...(widest === undefined
      ? []
      : [
          `Widest by modules: ${widest.file} with ${(widest.evidence.areaList as readonly string[]).length} areas and ${widest.evidence.modules} modules.`,
        ]),
  ];
}
