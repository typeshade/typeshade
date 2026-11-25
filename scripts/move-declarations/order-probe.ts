import ts from 'typescript';
import type { OrderEvidence } from '../move-purity/check-move.js';
import { cleanTest } from '../move-purity/clean-files.js';
import type { Link } from '../move-purity/module-links.js';
import { isModuleLink } from '../move-purity/units.js';

export interface OrderProbe {
  admits(sourceText: string): boolean;
}

function linkTexts(path: string, text: string): string[] {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  return file.statements.filter(isModuleLink).map((statement) => statement.getText(file));
}

export function createOrderProbe(
  evidence: OrderEvidence,
  source: string,
  firstText: string,
): OrderProbe | undefined {
  const { baseSide, headSide, headLinks, baseGraph, headGraph, files } = evidence;
  const rename = (path: string): string => files.renames.get(path) ?? path;
  const firstLinks = headLinks.of(source);
  const firstTexts = linkTexts(source, firstText);
  if (rename(source) !== source || firstLinks.length !== firstTexts.length) return undefined;
  const known = headSide.texts;
  const edgesOf = (links: readonly Link[]): string[] =>
    links
      .filter((link) => link.sideEffect || link.valueLoad)
      .map((link) => link.target)
      .filter((target) => known.has(target));
  const edges = new Map<string, string[]>();
  const stack = [source];
  while (stack.length > 0) {
    const path = stack.pop()!;
    if (edges.has(path)) continue;
    const next = edgesOf(headLinks.of(path));
    edges.set(path, next);
    stack.push(...next);
  }
  const renamedTargets = new Set(files.renames.values());
  const baseClean = cleanTest(baseSide, baseGraph);
  const headClean = cleanTest(headSide, headGraph);
  const before = baseGraph
    .orderFrom(source)
    .filter((path) => !baseClean(path))
    .map(rename)
    .filter((path) => known.has(path));
  const kept = new Set(
    [...edges.keys()].filter(
      (path) => (baseSide.texts.has(path) || renamedTargets.has(path)) && !headClean(path),
    ),
  );
  const orderWith = (sourceEdges: readonly string[]): string[] => {
    const seen = new Set<string>();
    const order: string[] = [];
    const visit = (path: string): void => {
      seen.add(path);
      const next = path === source ? sourceEdges : (edges.get(path) ?? []);
      for (const target of next) if (!seen.has(target)) visit(target);
      order.push(path);
    };
    visit(source);
    return order;
  };
  return {
    admits(sourceText) {
      const pool = new Map<string, Link[]>();
      firstTexts.forEach((text, index) => {
        pool.set(text, [...(pool.get(text) ?? []), firstLinks[index]!]);
      });
      const links = linkTexts(source, sourceText).map((text) => pool.get(text)?.shift());
      const unmatched = links.some((link) => link === undefined);
      if (unmatched || [...pool.values()].some((left) => left.length > 0)) return true;
      const after = orderWith(edgesOf(links as Link[])).filter((path) => kept.has(path));
      return before.length === after.length && before.every((path, i) => path === after[i]);
    },
  };
}
