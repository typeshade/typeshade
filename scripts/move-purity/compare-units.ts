import { groupBy, matchGroups } from './multiset.js';
import { declarationUnits, normalizeLineEndings, type Unit } from './units.js';
import { LAYER_POLICY_PATH, withoutKnownEdges } from './known-edges.js';

export interface UnitRef {
  readonly path: string;
  readonly line: number;
  readonly names: readonly string[];
}

export interface ChangedUnit {
  readonly base: UnitRef;
  readonly head: UnitRef;
}

export interface MovedUnit {
  readonly from: UnitRef;
  readonly to: UnitRef;
}

export interface UnitDiff {
  readonly vanished: UnitRef[];
  readonly appeared: UnitRef[];
  readonly changed: ChangedUnit[];
  readonly moved: MovedUnit[];
  readonly exportsAdded: UnitRef[];
  readonly exportsRemoved: UnitRef[];
}

const refOf = (unit: Unit): UnitRef => ({ path: unit.path, line: unit.line, names: unit.names });

function unitsOf(files: ReadonlyMap<string, string>, paths: readonly string[]): Unit[] {
  const units: Unit[] = [];
  for (const path of paths) {
    const text = files.get(path);
    if (text === undefined) continue;
    const prepared =
      path === LAYER_POLICY_PATH ? withoutKnownEdges(normalizeLineEndings(text)) : text;
    units.push(...declarationUnits(path, prepared));
  }
  return units;
}

function pairByName(vanished: UnitRef[], appeared: UnitRef[]) {
  const changed: ChangedUnit[] = [];
  const stillAppeared = [...appeared];
  const stillVanished: UnitRef[] = [];
  for (const base of vanished) {
    const at = stillAppeared.findIndex((head) => head.names.some((n) => base.names.includes(n)));
    if (at >= 0) changed.push({ base, head: stillAppeared.splice(at, 1)[0]! });
    else stillVanished.push(base);
  }
  return { changed, vanished: stillVanished, appeared: stillAppeared };
}

export function compareUnits(
  base: ReadonlyMap<string, string>,
  head: ReadonlyMap<string, string>,
  paths: readonly string[],
): UnitDiff {
  const baseGroups = groupBy(unitsOf(base, paths), (u) => u.hash);
  const headGroups = groupBy(unitsOf(head, paths), (u) => u.hash);
  const moved: MovedUnit[] = [];
  const exportsAdded: UnitRef[] = [];
  const exportsRemoved: UnitRef[] = [];
  const vanished: UnitRef[] = [];
  const appeared: UnitRef[] = [];
  for (const hash of new Set([...baseGroups.keys(), ...headGroups.keys()])) {
    const match = matchGroups(baseGroups.get(hash) ?? [], headGroups.get(hash) ?? []);
    for (const [from, to] of match.moved) moved.push({ from: refOf(from), to: refOf(to) });
    for (const [from, to] of [...match.kept, ...match.moved]) {
      if (to.exported && !from.exported) exportsAdded.push(refOf(to));
      if (from.exported && !to.exported) exportsRemoved.push(refOf(from));
    }
    vanished.push(...match.vanished.map(refOf));
    appeared.push(...match.appeared.map(refOf));
  }
  const paired = pairByName(vanished, appeared);
  return {
    vanished: paired.vanished,
    appeared: paired.appeared,
    changed: paired.changed,
    moved,
    exportsAdded,
    exportsRemoved,
  };
}
