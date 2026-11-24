export interface Match<T> {
  readonly kept: [T, T][];
  readonly moved: [T, T][];
  readonly vanished: T[];
  readonly appeared: T[];
}

export function matchGroups<T extends { readonly path: string }>(base: T[], head: T[]): Match<T> {
  const kept: [T, T][] = [];
  const unmatchedHead = [...head];
  const leftoverBase: T[] = [];
  for (const entry of base) {
    const at = unmatchedHead.findIndex((candidate) => candidate.path === entry.path);
    if (at >= 0) kept.push([entry, unmatchedHead.splice(at, 1)[0]!]);
    else leftoverBase.push(entry);
  }
  const moved: [T, T][] = [];
  while (leftoverBase.length > 0 && unmatchedHead.length > 0) {
    moved.push([leftoverBase.shift()!, unmatchedHead.shift()!]);
  }
  return { kept, moved, vanished: leftoverBase, appeared: unmatchedHead };
}

export function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}
