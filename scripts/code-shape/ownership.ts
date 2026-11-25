import { noOwnerFunctions } from './ownership/no-owner-function.js';
import { choicePairs, repeatedChoices } from './ownership/repeated-choice.js';
import { tinyFileFindings, tinyFiles } from './ownership/tiny-file.js';
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
  const repeated = findings
    .filter((finding) => finding.kind === 'repeated-choice')
    .sort((a, b) => Number(b.evidence.siteCount) - Number(a.evidence.siteCount))[0];
  return [
    `${countOf(findings, 'no-owner-function')} top-level functions read only members of their one object parameter.`,
    `${siteTotal} choice sites between two members of one object, in ${pairs.length} (type, member, member) pairs; ${single} pairs occur at a single site and are not findings.`,
    `${countOf(findings, 'repeated-choice')} pairs occur at two or more sites.`,
    `${tinyFiles(ctx).length} non-facade files hold one declaration in at most 12 lines; ${countOf(findings, 'tiny-file')} of them have exactly one importer.`,
    ...(repeated === undefined
      ? []
      : [
          `Most repeated: ${repeated.evidence.type}.${repeated.evidence.first} ?? ${repeated.evidence.second} at ${repeated.evidence.siteCount} sites in ${repeated.evidence.files} files.`,
        ]),
  ];
}
