import { noOwnerFunctions } from './ownership/no-owner-function.js';
import { choicePairs, repeatedChoices } from './ownership/repeated-choice.js';
import { TINY_FILE_LINES, tinyFileFindings, tinyFiles } from './ownership/tiny-file.js';
import type { Finding, ShapeContext, Signal } from './types.js';

export const ownership: Signal = (ctx) => [
  ...noOwnerFunctions(ctx),
  ...repeatedChoices(ctx),
  ...tinyFileFindings(ctx),
];

const countOf = (findings: readonly Finding[], kind: string): number =>
  findings.filter((finding) => finding.kind === kind).length;

export function summariseOwnership(ctx: ShapeContext, findings: readonly Finding[]): string[] {
  const pairs = [...choicePairs(ctx).values()];
  const single = pairs.filter((pair) => pair.sites.length < 2).length;
  const siteTotal = pairs.reduce((sum, pair) => sum + pair.sites.length, 0);
  const anonymous = pairs.filter(
    (pair) => pair.sites.length >= 2 && pair.declaredAt === undefined,
  ).length;
  const repeated = findings
    .filter((finding) => finding.kind === 'repeated-choice')
    .sort((a, b) => Number(b.evidence.siteCount) - Number(a.evidence.siteCount))[0];
  return [
    `${countOf(findings, 'no-owner-function')} top-level functions read only members of their one object parameter.`,
    `${siteTotal} choice sites between two members of one object, in ${pairs.length} (type, member, member) pairs; ${single} pairs occur at a single site and are not findings.`,
    `${countOf(findings, 'repeated-choice') + countOf(findings, 'repeated-choice-anonymous')} pairs occur at two or more sites, ${anonymous} of them on an anonymous type (kind repeated-choice-anonymous, no remedy). A logical-or choice counts only between two members that are not boolean.`,
    `${tinyFiles(ctx).length} non-facade files hold one declaration in at most ${TINY_FILE_LINES} lines (TINY_FILE_LINES); ${countOf(findings, 'tiny-file')} of them have exactly one product importer. A finding names whether that importer is a facade or the parent file of its module directory; it does not hide the file.`,
    ...(repeated === undefined
      ? []
      : [
          `Most repeated: ${repeated.evidence.type}.${repeated.evidence.first} ?? ${repeated.evidence.second} at ${repeated.evidence.siteCount} sites in ${repeated.evidence.files} files.`,
        ]),
  ];
}
