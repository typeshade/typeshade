import { createKeyer } from './binding-keys.js';
import { compareTitles } from './compare-titles.js';
import { matchUnits, type UnitDiff } from './compare-units.js';
import { directiveViolations, type DirectiveViolation } from './directives.js';
import { surfaceFindings } from './export-surface.js';
import { filePairs } from './file-pairs.js';
import type { Finding } from './findings.js';
import { freeCommentFindings, preambleFindings } from './free-comments.js';
import { moduleEvaluationFindings } from './module-evaluation.js';
import { createLinks } from './module-links.js';
import {
  checkOutside,
  isComparedSource,
  type DiffEntry,
  type OutsideEntry,
} from './outside-move.js';
import { createSide } from './side-program.js';
import type { Title } from './titles.js';
import { movedUnitFindings, reboundFindings } from './unit-rules.js';

export interface MoveReport {
  readonly pure: boolean;
  readonly changedPaths: number;
  readonly units: UnitDiff;
  readonly titles: { readonly vanished: Title[]; readonly appeared: Title[] };
  readonly findings: Finding[];
  readonly directives: DirectiveViolation[];
  readonly outside: OutsideEntry[];
  readonly knownEdgesRemoved: string[];
  readonly surfacePathChanges: number;
}

export interface CheckOptions {
  readonly paths?: readonly string[];
  readonly entries?: readonly DiffEntry[];
  readonly tracked?: ReadonlySet<string>;
  readonly root?: string;
}

export const FIXTURE_ROOT = '/move-purity-fixture';

export function changedPaths(
  base: ReadonlyMap<string, string>,
  head: ReadonlyMap<string, string>,
): string[] {
  const paths = new Set([...base.keys(), ...head.keys()]);
  return [...paths].filter((path) => base.get(path) !== head.get(path)).sort();
}

const EMPTY_UNITS: UnitDiff = {
  vanished: [],
  appeared: [],
  changed: [],
  moved: [],
  reordered: [],
  exportsAdded: [],
  exportsRemoved: [],
};

export function checkMove(
  base: ReadonlyMap<string, string>,
  head: ReadonlyMap<string, string>,
  options: CheckOptions = {},
): MoveReport {
  const paths = options.paths ?? changedPaths(base, head);
  const sources = paths.filter(isComparedSource);
  const tracked = options.tracked ?? new Set([...base.keys(), ...head.keys()]);
  const { outside, knownEdgesRemoved, surfacePathChanges } = checkOutside(
    base,
    head,
    paths,
    options.entries ?? [],
    tracked,
  );
  let units = EMPTY_UNITS;
  let titles = { vanished: [] as Title[], appeared: [] as Title[] };
  let directives: DirectiveViolation[] = [];
  const findings: Finding[] = [];
  if (sources.length > 0) {
    const root = options.root ?? FIXTURE_ROOT;
    const baseSide = createSide(root, base);
    const headSide = createSide(root, head);
    const baseKeyer = createKeyer(baseSide);
    const headKeyer = createKeyer(headSide);
    const match = matchUnits(baseSide, headSide, sources);
    units = match.diff;
    titles = compareTitles(base, head, sources);
    directives = directiveViolations(baseSide, headSide, sources, match.diff.moved);
    const files = filePairs(baseSide, headSide, sources, match.moved);
    findings.push(
      ...reboundFindings([...match.kept, ...match.moved], baseKeyer, headKeyer),
      ...movedUnitFindings(match.moved),
      ...surfaceFindings(baseSide, headSide, baseKeyer, headKeyer),
      ...moduleEvaluationFindings({
        base: baseSide,
        head: headSide,
        baseLinks: createLinks(baseSide, baseKeyer),
        headLinks: createLinks(headSide, headKeyer),
        files,
        kept: match.kept,
        moved: match.moved,
      }),
      ...freeCommentFindings(baseSide, headSide, files),
      ...preambleFindings(baseSide, headSide, files),
    );
  }
  const pure =
    units.vanished.length === 0 &&
    units.appeared.length === 0 &&
    units.changed.length === 0 &&
    units.reordered.length === 0 &&
    directives.length === 0 &&
    titles.vanished.length === 0 &&
    titles.appeared.length === 0 &&
    findings.length === 0 &&
    outside.length === 0;
  return {
    pure,
    changedPaths: paths.length,
    units,
    titles,
    findings,
    directives,
    outside,
    knownEdgesRemoved,
    surfacePathChanges,
  };
}
