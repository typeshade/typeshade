import { groupBy, matchGroups } from './multiset.js';
import { orderViolations } from './order.js';
import type { Side } from './side-program.js';
import { analyzeSource, type Unit } from './units.js';

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
  readonly reordered: UnitRef[];
  readonly exportsAdded: UnitRef[];
  readonly exportsRemoved: UnitRef[];
}

export interface UnitMatch {
  readonly diff: UnitDiff;
  readonly kept: [Unit, Unit][];
  readonly moved: [Unit, Unit][];
}

export const refOf = (unit: Unit): UnitRef => ({
  path: unit.path,
  line: unit.line,
  names: unit.names,
});

export function unitsOfPath(side: Side, path: string): Unit[] {
  const source = side.sourceOf(path);
  return source ? analyzeSource(source, path).units : [];
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

export function matchUnits(base: Side, head: Side, paths: readonly string[]): UnitMatch {
  const baseGroups = groupBy(
    paths.flatMap((p) => unitsOfPath(base, p)),
    (u) => u.hash,
  );
  const headGroups = groupBy(
    paths.flatMap((p) => unitsOfPath(head, p)),
    (u) => u.hash,
  );
  const kept: [Unit, Unit][] = [];
  const moved: [Unit, Unit][] = [];
  const exportsAdded: UnitRef[] = [];
  const exportsRemoved: UnitRef[] = [];
  const vanished: UnitRef[] = [];
  const appeared: UnitRef[] = [];
  for (const hash of new Set([...baseGroups.keys(), ...headGroups.keys()])) {
    const match = matchGroups(baseGroups.get(hash) ?? [], headGroups.get(hash) ?? []);
    kept.push(...match.kept);
    moved.push(...match.moved);
    for (const [from, to] of [...match.kept, ...match.moved]) {
      if (to.exported && !from.exported) exportsAdded.push(refOf(to));
      if (from.exported && !to.exported) exportsRemoved.push(refOf(from));
    }
    vanished.push(...match.vanished.map(refOf));
    appeared.push(...match.appeared.map(refOf));
  }
  const paired = pairByName(vanished, appeared);
  const diff: UnitDiff = {
    vanished: paired.vanished,
    appeared: paired.appeared,
    changed: paired.changed,
    moved: moved.map(([from, to]) => ({ from: refOf(from), to: refOf(to) })),
    reordered: orderViolations([...kept, ...moved]).map(refOf),
    exportsAdded,
    exportsRemoved,
  };
  return { diff, kept, moved };
}
