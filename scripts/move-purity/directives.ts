import type { MovedUnit } from './compare-units.js';
import { analyzeSource } from './units.js';

export interface DirectiveViolation {
  readonly path: string;
  readonly expected: string[];
  readonly got: string[];
}

const same = (a: readonly string[], b: readonly string[]): boolean => a.join('\0') === b.join('\0');

const listOf = (files: ReadonlyMap<string, string>, path: string): string[] | undefined => {
  const text = files.get(path);
  return text === undefined ? undefined : analyzeSource(path, text).directives;
};

export function directiveViolations(
  base: ReadonlyMap<string, string>,
  head: ReadonlyMap<string, string>,
  paths: readonly string[],
  moved: readonly MovedUnit[],
): DirectiveViolation[] {
  const violations: DirectiveViolation[] = [];
  const report = (path: string, expected: string[], got: string[]): void => {
    if (
      !violations.some((v) => v.path === path && same(v.expected, expected) && same(v.got, got))
    ) {
      violations.push({ path, expected, got });
    }
  };
  const movedInto = new Set(moved.map((unit) => unit.to.path));
  for (const path of paths) {
    const before = listOf(base, path);
    const after = listOf(head, path);
    if (before !== undefined && after !== undefined && !same(before, after)) {
      report(path, before, after);
    }
  }
  for (const { from, to } of moved) {
    const expected = listOf(base, from.path) ?? [];
    const got = listOf(head, to.path) ?? [];
    if (!same(expected, got)) report(to.path, expected, got);
  }
  for (const path of paths) {
    const after = listOf(head, path);
    if (base.has(path) || after === undefined || after.length === 0 || movedInto.has(path))
      continue;
    const others = paths.filter((other) => other !== path);
    const known = others.some((other) =>
      [listOf(base, other), listOf(head, other)].some((l) => l !== undefined && same(l, after)),
    );
    if (!known) report(path, [], after);
  }
  return violations;
}
