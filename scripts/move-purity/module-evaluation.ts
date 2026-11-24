import { finding, type Finding } from './findings.js';
import type { FilePairs } from './file-pairs.js';
import type { Links, Link } from './module-links.js';
import type { Side } from './side-program.js';
import type { Unit } from './units.js';
import { unitsOfPath } from './compare-units.js';

export interface EvaluationInput {
  readonly base: Side;
  readonly head: Side;
  readonly baseLinks: Links;
  readonly headLinks: Links;
  readonly files: FilePairs;
  readonly kept: readonly (readonly [Unit, Unit])[];
  readonly moved: readonly (readonly [Unit, Unit])[];
}

const signatureOf = (links: Link[], map: (t: string) => string): Map<string, string> => {
  const signature = new Map<string, Set<string>>();
  for (const link of links) {
    for (const [name, typeOnly] of link.names) {
      const key = `${link.kind}|${map(link.target)}|${name}`;
      const set = signature.get(key) ?? new Set<string>();
      set.add(typeOnly ? 'type' : 'value');
      signature.set(key, set);
    }
  }
  return new Map([...signature].map(([key, set]) => [key, [...set].sort().join('+')]));
};

const sideEffects = (links: Link[], map: (t: string) => string): string[] =>
  links.filter((l) => l.sideEffect).map((l) => map(l.target));

const valueTargets = (links: Link[], map: (t: string) => string): Set<string> =>
  new Set(links.filter((l) => l.valueLoad).map((l) => map(l.target)));

export function moduleEvaluationFindings(input: EvaluationInput): Finding[] {
  const { base, head, baseLinks, headLinks, files, kept, moved } = input;
  const findings: Finding[] = [];
  const map = (target: string): string => files.renames.get(target) ?? target;
  const identity = (target: string): string => target;
  const stayNodes = new Set<Unit>();
  for (const [from, to] of kept) stayNodes.add(from).add(to);
  for (const [from, to] of moved) {
    if (files.renames.get(from.path) === to.path) stayNodes.add(from).add(to);
  }
  for (const path of files.newFiles) {
    const effects = sideEffects(headLinks.of(path), identity);
    if (effects.length > 0) {
      findings.push(finding('side-effect import in a new file', path, effects.join(', ')));
    }
  }
  for (const pair of files.pairs) {
    const before = baseLinks.of(pair.base);
    const after = headLinks.of(pair.head);
    const here = (kind: string, detail: string): void => {
      findings.push(finding(kind, pair.head, detail));
    };
    const beforeEffects = sideEffects(before, map).join('\0');
    if (beforeEffects !== sideEffects(after, identity).join('\0')) {
      here('side-effect imports changed', sideEffects(after, identity).join(', ') || '(none)');
    }
    const beforeSignature = signatureOf(before, map);
    for (const [key, flag] of signatureOf(after, identity)) {
      const was = beforeSignature.get(key);
      if (was !== undefined && was !== flag)
        here('type-only flag changed', `${key} base ${was} head ${flag}`);
    }
    const beforeTargets = valueTargets(before, map);
    const afterTargets = valueTargets(after, identity);
    const baseUnits = unitsOfPath(base, pair.base);
    const headUnits = unitsOfPath(head, pair.head);
    const refsOf = (units: Unit[], links: Links, stay: boolean): Set<string> => {
      const targets = new Set<string>();
      for (const unit of units.filter((u) => stayNodes.has(u) === stay)) {
        for (const t of links.referencedTargets(unit)) targets.add(t);
      }
      return targets;
    };
    const baseStay = new Set([...refsOf(baseUnits, baseLinks, true)].map(map));
    const baseAway = new Set([...refsOf(baseUnits, baseLinks, false)].map(map));
    const headIn = refsOf(headUnits, headLinks, false);
    const sentTo = new Set(
      moved.filter(([from]) => from.path === pair.base).map(([, to]) => to.path),
    );
    for (const target of beforeTargets) {
      if (afterTargets.has(target)) continue;
      if (baseStay.has(target) || !baseAway.has(target)) {
        here('value import removed', target);
      }
    }
    for (const target of afterTargets) {
      if (beforeTargets.has(target)) continue;
      const isNew = head.sourceOf(target) !== undefined && base.sourceOf(target) === undefined;
      if (!isNew && !sentTo.has(target) && !headIn.has(target)) here('value import added', target);
    }
  }
  return findings;
}
