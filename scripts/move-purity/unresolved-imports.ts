import { dirname } from 'node:path/posix';
import type { FilePairs } from './file-pairs.js';
import { finding, type Finding } from './finding.js';
import type { Links } from './module-links.js';
import type { Unit } from './units.js';

export interface UnresolvedInput {
  readonly baseLinks: Links;
  readonly headLinks: Links;
  readonly files: FilePairs;
  readonly moved: readonly (readonly [Unit, Unit])[];
}

const entriesOf = (links: Links, path: string): string[] =>
  links
    .of(path)
    .filter((link) => link.target.startsWith('unresolved:'))
    .flatMap((link) => link.entries);

function difference(left: readonly string[], right: readonly string[]): string[] {
  const rest = [...right];
  return left.filter((entry) => {
    const at = rest.indexOf(entry);
    if (at < 0) return true;
    rest.splice(at, 1);
    return false;
  });
}

export function unresolvedImportFindings(input: UnresolvedInput): Finding[] {
  const { baseLinks, headLinks, files, moved } = input;
  const findings: Finding[] = [];
  const sameDirectory = (from: Unit, to: Unit): boolean => dirname(from.path) === dirname(to.path);
  const usedBy = (links: Links, unit: Unit, path: string): string[] => {
    const known = entriesOf(links, path);
    return [...links.referencedEntries(unit)].filter((entry) => known.includes(entry));
  };
  for (const pair of files.pairs) {
    const before = entriesOf(baseLinks, pair.base);
    const after = entriesOf(headLinks, pair.head);
    for (const entry of difference(before, after)) {
      const justified = moved.some(
        ([from, to]) =>
          from.path === pair.base &&
          sameDirectory(from, to) &&
          usedBy(baseLinks, from, from.path).includes(entry) &&
          entriesOf(headLinks, to.path).includes(entry),
      );
      if (!justified)
        findings.push(finding('unresolved import changed', pair.head, `removed ${entry}`));
    }
    for (const entry of difference(after, before)) {
      const justified = moved.some(
        ([from, to]) =>
          to.path === pair.head &&
          sameDirectory(from, to) &&
          usedBy(headLinks, to, to.path).includes(entry) &&
          entriesOf(baseLinks, from.path).includes(entry),
      );
      if (!justified)
        findings.push(finding('unresolved import changed', pair.head, `added ${entry}`));
    }
  }
  for (const [from, to] of moved) {
    if (from.path === to.path) continue;
    for (const entry of usedBy(baseLinks, from, from.path)) {
      if (!sameDirectory(from, to) || !entriesOf(headLinks, to.path).includes(entry)) {
        findings.push(
          finding('unresolved import moved', to.path, `${to.names.join(', ')}: ${entry}`, to.line),
        );
      }
    }
  }
  return findings;
}
