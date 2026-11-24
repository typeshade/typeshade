import { groupBy } from './group-match.js';
import type { Side } from './side-program.js';
import { unitsOfPath } from './compare-units.js';
import type { Unit } from './units.js';

const SPECIFIER = /(\b(?:from|import|require)\s*\(?\s*)(['"])[^'"\n]*\2/g;

const shapeOf = (text: string | undefined): string => (text ?? '').replace(SPECIFIER, '$1$2$2');

export interface FilePair {
  readonly base: string;
  readonly head: string;
}

export interface FilePairs {
  readonly pairs: FilePair[];
  readonly renames: Map<string, string>;
  readonly newFiles: string[];
  readonly deletedFiles: string[];
}

export function filePairs(
  base: Side,
  head: Side,
  sources: readonly string[],
  moved: readonly (readonly [Unit, Unit])[],
): FilePairs {
  const inBase = (path: string): boolean => base.sourceOf(path) !== undefined;
  const inHead = (path: string): boolean => head.sourceOf(path) !== undefined;
  const pairs: FilePair[] = sources
    .filter((path) => inBase(path) && inHead(path))
    .map((path) => ({ base: path, head: path }));
  const renames = new Map<string, string>();
  const groups = groupBy(moved, ([from, to]) => `${from.path}\0${to.path}`);
  for (const group of groups.values()) {
    const [from, to] = group[0]!;
    const whole =
      group.length > 0 &&
      group.length === unitsOfPath(base, from.path).length &&
      group.length === unitsOfPath(head, to.path).length;
    if (
      whole &&
      from.path !== to.path &&
      inBase(from.path) &&
      !inHead(from.path) &&
      !inBase(to.path)
    ) {
      renames.set(from.path, to.path);
      pairs.push({ base: from.path, head: to.path });
    }
  }
  const unitless = (side: Side, path: string): boolean => unitsOfPath(side, path).length === 0;
  const claimed = new Set<string>();
  for (const gone of sources.filter((p) => inBase(p) && !inHead(p) && !renames.has(p))) {
    if (!unitless(base, gone)) continue;
    const created = sources.find(
      (p) =>
        !inBase(p) &&
        inHead(p) &&
        !claimed.has(p) &&
        !new Set(renames.values()).has(p) &&
        unitless(head, p) &&
        shapeOf(base.texts.get(gone)) === shapeOf(head.texts.get(p)),
    );
    if (created === undefined) continue;
    claimed.add(created);
    renames.set(gone, created);
    pairs.push({ base: gone, head: created });
  }
  const renamedTargets = new Set(renames.values());
  return {
    pairs,
    renames,
    newFiles: sources.filter((p) => !inBase(p) && inHead(p) && !renamedTargets.has(p)),
    deletedFiles: sources.filter((p) => inBase(p) && !inHead(p) && !renames.has(p)),
  };
}
