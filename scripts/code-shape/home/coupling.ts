import { posix } from 'node:path';
import type ts from 'typescript';
import { edgesByTarget, importEdges, type ImportEdge } from '../imports.js';
import type { ShapeContext } from '../types.js';

export const TYPE_ONLY_WEIGHT = 0.5;

export interface Coupling {
  file: ts.SourceFile;
  ownDirectoryWeight: number;
  topDirectory: string;
  topDirectoryWeight: number;
  totalWeight: number;
  importWeight: number;
  importerWeight: number;
  typeOnlyWeight: number;
  firstImportLine: number;
}

const weightOf = (edge: ImportEdge): number => (edge.typeOnly ? TYPE_ONLY_WEIGHT : 1);

const directoryOf = (rel: string): string => posix.dirname(rel);

const cache = new WeakMap<ShapeContext, Coupling[]>();

export function couplingOf(ctx: ShapeContext): Coupling[] {
  const cached = cache.get(ctx);
  if (cached !== undefined) return cached;
  const incoming = new Map<ts.SourceFile, ImportEdge[]>();
  const outgoing = new Map<ts.SourceFile, ImportEdge[]>();
  const inProduct = new Set(ctx.product);
  for (const source of ctx.product) {
    const edges = edgesByTarget(
      importEdges(ctx.checker, source).filter(
        (edge) => edge.target !== source && inProduct.has(edge.target),
      ),
    );
    outgoing.set(source, edges);
    for (const edge of edges) {
      incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
    }
  }
  const result = ctx.analysed.map((file): Coupling => {
    const byDirectory = new Map<string, number>();
    let importWeight = 0;
    let importerWeight = 0;
    let typeOnlyWeight = 0;
    const add = (other: ts.SourceFile, edge: ImportEdge, importer: boolean): void => {
      const weight = weightOf(edge);
      const directory = directoryOf(ctx.rel(other));
      byDirectory.set(directory, (byDirectory.get(directory) ?? 0) + weight);
      if (importer) importerWeight += weight;
      else importWeight += weight;
      if (edge.typeOnly) typeOnlyWeight += weight;
    };
    const own = outgoing.get(file) ?? [];
    for (const edge of own) add(edge.target, edge, false);
    for (const edge of incoming.get(file) ?? []) add(edge.from, edge, true);
    const ownDirectory = directoryOf(ctx.rel(file));
    const others = [...byDirectory].filter(([directory]) => directory !== ownDirectory);
    others.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const top = others[0];
    return {
      file,
      ownDirectoryWeight: byDirectory.get(ownDirectory) ?? 0,
      topDirectory: top?.[0] ?? '',
      topDirectoryWeight: top?.[1] ?? 0,
      totalWeight: importWeight + importerWeight,
      importWeight,
      importerWeight,
      typeOnlyWeight,
      firstImportLine: own.length === 0 ? 1 : Math.min(...own.map((edge) => edge.line)),
    };
  });
  cache.set(ctx, result);
  return result;
}
