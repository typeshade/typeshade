import { finding, type Finding } from './finding.js';
import type { FilePairs } from './file-pairs.js';
import type { Links, Link } from './module-links.js';

interface EvaluationInput {
  readonly baseLinks: Links;
  readonly headLinks: Links;
  readonly files: FilePairs;
}

const signatureOf = (links: Link[], map: (t: string) => string): Map<string, string> => {
  const signature = new Map<string, Set<string>>();
  for (const link of links) {
    for (const [name, typeOnly] of link.names) {
      const key = `${link.kind}|${map(link.target)}|${name}`;
      const set = signature.get(key) ?? new Set<string>();
      set.add(`${typeOnly ? 'type' : 'value'}${link.attributes ? ` ${link.attributes}` : ''}`);
      signature.set(key, set);
    }
  }
  return new Map([...signature].map(([key, set]) => [key, [...set].sort().join('+')]));
};

export function linkFindings({ baseLinks, headLinks, files }: EvaluationInput): Finding[] {
  const findings: Finding[] = [];
  const map = (target: string): string => files.renames.get(target) ?? target;
  for (const path of files.newFiles) {
    const effects = headLinks
      .of(path)
      .filter((link) => link.sideEffect)
      .map((link) => link.target);
    if (effects.length > 0) {
      findings.push(finding('side-effect import in a new file', path, effects.join(', ')));
    }
  }
  const starCount = (links: Link[]): number =>
    links.filter(
      (link) => link.kind === 'export' && [...link.names.keys()].some((n) => n[0] === '*'),
    ).length;
  for (const pair of files.pairs) {
    if (starCount(headLinks.of(pair.head)) > starCount(baseLinks.of(pair.base))) {
      findings.push(finding('export * added', pair.head, ''));
    }
  }
  for (const path of files.newFiles) {
    if (starCount(headLinks.of(path)) > 0) findings.push(finding('export * added', path, ''));
  }
  for (const path of [...files.pairs.map((pair) => pair.head), ...files.newFiles]) {
    for (const link of headLinks.of(path)) {
      if (link.names.size === 0 && !link.sideEffect) {
        findings.push(finding('empty import or export from path', path, link.specifier));
      }
      if (link.droppedAsType) {
        findings.push(finding('value import used only as a type path', path, link.specifier));
      }
    }
  }
  for (const pair of files.pairs) {
    const before = signatureOf(baseLinks.of(pair.base), map);
    for (const [key, flag] of signatureOf(headLinks.of(pair.head), (t) => t)) {
      const was = before.get(key);
      if (was !== undefined && was !== flag) {
        findings.push(finding('import flag changed', pair.head, `${key} base ${was} head ${flag}`));
      }
    }
  }
  return findings;
}
