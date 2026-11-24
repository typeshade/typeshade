import { groupBy } from './multiset.js';
import type { Unit } from './units.js';

export function orderViolations(pairs: readonly (readonly [Unit, Unit])[]): Unit[] {
  const groups = groupBy(pairs, ([from, to]) => `${from.path}\0${to.path}`);
  const violations: Unit[] = [];
  for (const group of groups.values()) {
    const inBaseOrder = [...group].sort((a, b) => a[0].index - b[0].index);
    let highest = -1;
    for (const [, to] of inBaseOrder) {
      if (to.index < highest) violations.push(to);
      else highest = to.index;
    }
  }
  return violations;
}
