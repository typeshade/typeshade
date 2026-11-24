import type { MovedUnit } from './compare-units.js';
import type { Side } from './side-program.js';
import { analyzeSource } from './units.js';

export interface DirectiveViolation {
  readonly path: string;
  readonly expected: string[];
  readonly got: string[];
}

const same = (a: readonly string[], b: readonly string[]): boolean => a.join('\0') === b.join('\0');

const listOf = (side: Side, path: string): string[] | undefined => {
  const source = side.sourceOf(path);
  return source ? analyzeSource(source, path).directives : undefined;
};

export function directiveViolations(
  base: Side,
  head: Side,
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
    if (base.sourceOf(path) || after === undefined || after.length === 0 || movedInto.has(path)) {
      continue;
    }
    const known = paths
      .filter((other) => other !== path)
      .some((other) =>
        [listOf(base, other), listOf(head, other)].some((l) => l !== undefined && same(l, after)),
      );
    if (!known) report(path, [], after);
  }
  return violations;
}
