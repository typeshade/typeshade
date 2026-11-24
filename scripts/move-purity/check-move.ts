import type ts from 'typescript';
import { createKeyer } from './binding-keys.js';
import { compareTitles } from './compare-titles.js';
import { matchUnits, type UnitDiff } from './compare-units.js';
import { directiveViolations, type DirectiveViolation } from './directives.js';
import { surfaceFindings } from './export-surface.js';
import { filePairs } from './file-pairs.js';
import { finding, type Finding } from './finding.js';
import { freeCommentFindings, preambleFindings } from './free-comments.js';
import { VITEST_CONFIG_PATH, listedPaths } from './vitest-config.js';
import { linkFindings } from './module-evaluation.js';
import { cleanFileFindings } from './clean-files.js';
import { configPathFindings } from './config-paths.js';
import { typeReexportFindings } from './type-exports.js';
import { evaluationOrderFindings } from './evaluation-order.js';
import { pathReferenceFindings } from './path-references.js';
import { unresolvedImportFindings } from './unresolved-imports.js';
import { createLinks } from './module-links.js';
import {
  checkOutside,
  isComparedSource,
  type DiffEntry,
  type OutsideEntry,
} from './outside-move.js';
import { createSide } from './side-program.js';
import type { Title } from './titles.js';
import { movedUnitFindings } from './moved-unit-findings.js';
import { reboundFindings } from './rebound-findings.js';

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

interface CheckOptions {
  readonly paths?: readonly string[];
  readonly entries?: readonly DiffEntry[];
  readonly root?: string;
  readonly allowTestMoves?: boolean;
}

const FIXTURE_ROOT = '/move-purity-fixture';

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
  let units = EMPTY_UNITS;
  let titles = { vanished: [] as Title[], appeared: [] as Title[] };
  let directives: DirectiveViolation[] = [];
  let renames: ReadonlyMap<string, string> = new Map();
  const findings: Finding[] = [];
  for (const entry of options.entries ?? []) {
    const lacksHead = entry.newMode !== '000000' && !head.has(entry.path);
    const lacksBase = entry.oldMode !== '000000' && !base.has(entry.path);
    if (isComparedSource(entry.path) && (lacksHead || lacksBase)) {
      findings.push(finding('unreadable file path', entry.path, ''));
    }
  }
  if (sources.length > 0) {
    const root = options.root ?? FIXTURE_ROOT;
    const baseSide = createSide(root, base);
    const headSide = createSide(root, head);
    const match = matchUnits(baseSide, headSide, sources);
    units = match.diff;
    const changedSet = new Set(sources);
    const headIds = new Map<ts.Node, string>();
    for (const [from, to] of [...match.kept, ...match.moved]) {
      headIds.set(to.node, `${from.path}#${from.index}`);
    }
    const baseKeyer = createKeyer(baseSide, (unit) => `${unit.path}#${unit.index}`);
    const headFileId = (path: string): string => {
      const from = [...renames].find(([, to]) => to === path)?.[0];
      if (from !== undefined) return from;
      return changedSet.has(path) && baseSide.sourceOf(path) === undefined ? `new:${path}` : path;
    };
    const headKeyer = createKeyer(
      headSide,
      (unit) =>
        headIds.get(unit.node) ??
        `${changedSet.has(unit.path) ? 'new:' : ''}${unit.path}#${unit.index}`,
      headFileId,
    );
    titles = compareTitles(base, head, sources);
    directives = directiveViolations(baseSide, headSide, sources, match.diff.moved);
    const files = filePairs(baseSide, headSide, sources, match.moved);
    renames = files.renames;
    const baseLinks = createLinks(baseSide, baseKeyer);
    const headLinks = createLinks(headSide, headKeyer);
    const order = evaluationOrderFindings(baseSide, headSide, baseLinks, headLinks, files);
    findings.push(
      ...reboundFindings([...match.kept, ...match.moved], baseKeyer, headKeyer),
      ...movedUnitFindings(
        match.moved,
        baseSide,
        headSide,
        listedPaths(base.get(VITEST_CONFIG_PATH), head.get(VITEST_CONFIG_PATH)),
        options.allowTestMoves === true,
      ),
      ...cleanFileFindings({
        side: baseSide,
        graph: order.baseGraph,
        paths: sources,
        label: 'base',
      }),
      ...cleanFileFindings({
        side: headSide,
        graph: order.headGraph,
        paths: sources,
        label: 'head',
      }),
      ...order.findings,
      ...typeReexportFindings(headSide, [
        ...files.pairs.map((pair) => pair.head),
        ...files.newFiles,
      ]),
      ...sources
        .filter((path) => path.endsWith('.shade.ts'))
        .map((path) => finding('shade files do not take part in a pure move', path, '')),
      ...configPathFindings(baseSide, headSide, sources),
      ...surfaceFindings(baseSide, headSide, baseKeyer, headKeyer),
      ...linkFindings({ baseLinks, headLinks, files }),
      ...unresolvedImportFindings({ baseLinks, headLinks, files, moved: match.moved }),
      ...pathReferenceFindings(headSide, head, files),
      ...freeCommentFindings(baseSide, headSide, files),
      ...preambleFindings(baseSide, headSide, files),
    );
  }
  const { outside, knownEdgesRemoved, surfacePathChanges } = checkOutside(
    base,
    head,
    paths,
    options.entries ?? [],
    renames,
  );
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
