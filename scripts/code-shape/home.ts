import { couplingOf, TYPE_ONLY_WEIGHT, type Coupling } from './home/coupling.js';
import {
  ENTRY_NAMES,
  EXEMPT_RULES,
  FACADE_SHARE,
  exemptRuleOf,
  type ExemptRule,
} from './home/exempt.js';
import type { Finding, ShapeContext, Signal } from './types.js';

export { TYPE_ONLY_WEIGHT } from './home/coupling.js';

export const HOME_MIN_WEIGHT = 3;

interface Analysis {
  reported: Coupling[];
  removed: Record<ExemptRule, number>;
}

const analysisCache = new WeakMap<ShapeContext, Analysis>();

function analyse(ctx: ShapeContext): Analysis {
  const cached = analysisCache.get(ctx);
  if (cached !== undefined) return cached;
  const removed = Object.fromEntries(EXEMPT_RULES.map((rule) => [rule, 0])) as Record<
    ExemptRule,
    number
  >;
  const reported: Coupling[] = [];
  for (const entry of couplingOf(ctx)) {
    const pulledAway =
      entry.topDirectoryWeight >= HOME_MIN_WEIGHT &&
      entry.topDirectoryWeight > entry.ownDirectoryWeight;
    if (!pulledAway) continue;
    const rule = exemptRuleOf(ctx, entry.file);
    if (rule === undefined) reported.push(entry);
    else removed[rule] += 1;
  }
  const result = { reported, removed };
  analysisCache.set(ctx, result);
  return result;
}

const share = (entry: Coupling): number =>
  entry.totalWeight === 0 ? 0 : Math.round((entry.typeOnlyWeight / entry.totalWeight) * 100) / 100;

export const home: Signal = (ctx) =>
  analyse(ctx).reported.map((entry): Finding => ({
    signal: 'home',
    file: ctx.rel(entry.file),
    line: entry.firstImportLine,
    kind: 'wrong-directory',
    evidence: {
      ownDirectoryWeight: entry.ownDirectoryWeight,
      topDirectory: entry.topDirectory,
      topDirectoryWeight: entry.topDirectoryWeight,
      totalWeight: entry.totalWeight,
      imports: entry.importWeight,
      importers: entry.importerWeight,
      typeOnlyShare: share(entry),
    },
    remedy: 'move the file',
  }));

export function summariseHome(ctx: ShapeContext, findings: readonly Finding[]): string[] {
  const { removed } = analyse(ctx);
  return [
    `${findings.length} files couple more to one other directory than to their own directory.`,
    `Coupling of a file = its resolved imports plus its importers, counted by the directory of the other end. A value edge weighs 1 and a type-only edge weighs ${TYPE_ONLY_WEIGHT} (TYPE_ONLY_WEIGHT).`,
    `A file is reported when the top other directory outweighs its own directory and weighs at least ${HOME_MIN_WEIGHT} (reporting threshold, not a check).`,
    `Rule 1 (removed ${removed['entry name']} files): a file named ${ENTRY_NAMES.join(' or ')} lists other files, so it is not reported.`,
    `Rule 2 (removed ${removed['parent of its module directory']} files): the parent file of its own module directory (x.ts beside x/) is expected to couple toward x/.`,
    `Rule 3 (removed ${removed.facade} files): a facade or registry, where at least ${FACADE_SHARE * 100}% of the top-level statements are import or export-from statements with an export, is not reported.`,
  ];
}
