import { compareComments } from './compare-comments.js';
import type { FileComment } from './comments.js';
import { compareTitles } from './compare-titles.js';
import { compareUnits, type UnitDiff } from './compare-units.js';
import { checkOutside, isComparedSource, type OutsideEntry } from './outside-move.js';
import type { Title } from './titles.js';

export interface MoveReport {
  readonly pure: boolean;
  readonly changedPaths: number;
  readonly units: UnitDiff;
  readonly titles: { readonly vanished: Title[]; readonly appeared: Title[] };
  readonly comments: { readonly vanished: FileComment[]; readonly appeared: FileComment[] };
  readonly outside: OutsideEntry[];
  readonly knownEdgesRemoved: string[];
  readonly surfacePathChanges: number;
}

export function changedPaths(
  base: ReadonlyMap<string, string>,
  head: ReadonlyMap<string, string>,
): string[] {
  const paths = new Set([...base.keys(), ...head.keys()]);
  return [...paths].filter((path) => base.get(path) !== head.get(path)).sort();
}

export function checkMove(
  base: ReadonlyMap<string, string>,
  head: ReadonlyMap<string, string>,
  paths: readonly string[] = changedPaths(base, head),
): MoveReport {
  const sources = paths.filter(isComparedSource);
  const units = compareUnits(base, head, sources);
  const titles = compareTitles(base, head, sources);
  const comments = compareComments(base, head, sources);
  const { outside, knownEdgesRemoved, surfacePathChanges } = checkOutside(base, head, paths);
  const pure =
    units.vanished.length === 0 &&
    units.appeared.length === 0 &&
    units.changed.length === 0 &&
    units.reordered.length === 0 &&
    comments.vanished.length === 0 &&
    comments.appeared.length === 0 &&
    titles.vanished.length === 0 &&
    titles.appeared.length === 0 &&
    outside.length === 0;
  return {
    pure,
    changedPaths: paths.length,
    units,
    titles,
    comments,
    outside,
    knownEdgesRemoved,
    surfacePathChanges,
  };
}
