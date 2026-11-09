// ═══ Rule 13.1: a pull request that changes what an author can write cites the rule it rests on ═══
//
// `scripts/rule-citation.ts` holds the pull-request half of Rule 13.1 in CI. This file holds its
// judge on hand-built verdict inputs, without git, and its reader of the design document on the
// tree, so that an empty rule set cannot pass every citation vacuously (AGENTS.md#gate-discipline).
//
// No `Verifies:` tag yet: Rule 13.1 says "Enforced by: review", and a tag would turn its Doorstop
// item to `verification: test` ahead of the rule text. The proposal that updates the rule's
// "Enforced by" line adds the tag (reqs/README.md).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, definedRules } from '../scripts/doc-refs.js';
import type { Touched } from '../scripts/changes.js';
import { citedRules, judgeCitation, rulesIn } from '../scripts/rule-citation.js';

const none: Touched = {
  rules: new Set(),
  surface: new Set(),
  exports: new Set(),
  exportsRemoved: new Set(),
  codes: new Set(),
  examples: new Set(),
  names: new Set(),
  namesRemoved: new Set(),
};
const defined = rulesIn(readFileSync(join(ROOT, 'docs/language-design.md'), 'utf8'));
// A rule the document does not define, built so that docs:refs does not read it as a reference.
const undefinedRule = ['Rule', '99.99'].join(' ');
const template = readFileSync(join(ROOT, '.github/pull_request_template.md'), 'utf8');

describe('the rules the design document defines', () => {
  it('sanity: reads the rules the tree carries, as doc-refs reads them', () => {
    expect(defined.has('13.1')).toBe(true);
    expect(defined.has('3.7')).toBe(true);
    expect([...defined].sort()).toEqual([...definedRules()].sort());
  });
});

describe('the citations a description makes', () => {
  it('reads `Rule N.M` and `Rules N.M`, each once', () => {
    expect([
      ...citedRules('Rests on Rule 6.7 and Rule 12.5; see Rules 2.1. Rule 6.7 again.'),
    ]).toEqual(['6.7', '12.5', '2.1']);
  });

  it('leaves HTML comments out, so the template placeholder cites nothing', () => {
    expect(citedRules('<!-- cite Rule 1.1 here -->\nnone').size).toBe(0);
    expect(citedRules(template).size).toBe(0);
  });

  it('reads no rule from a surface section or a bare number', () => {
    expect(citedRules('surface §28, TS8099, Rule12.5, 6.7').size).toBe(0);
  });
});

describe('Rule 13.1 over a pull request', () => {
  const body = (cites: string): string => `${template}\n${cites}\n`;

  it('asks nothing of a diff the proposal criteria do not catch', () => {
    expect(judgeCitation(none, '', defined).problems).toEqual([]);
  });

  for (const [kind, touched] of [
    ['a rule', { ...none, rules: new Set(['6.7']) }],
    ['a surface section', { ...none, surface: new Set([28]) }],
    ['an export', { ...none, exports: new Set(['compile']) }],
    ['a removed export', { ...none, exportsRemoved: new Set(['compile']) }],
    ['a diagnostic code', { ...none, codes: new Set(['TS8079']) }],
    ['an example', { ...none, examples: new Set(['new-example']) }],
    ['an author-facing name added', { ...none, names: new Set(['Math.fround']) }],
    ['an author-facing name removed', { ...none, namesRemoved: new Set(['Math.fround']) }],
  ] as const) {
    it(`fails ${kind} changed with no rule cited, and passes it with one`, () => {
      const missing = judgeCitation(touched, body(''), defined);
      expect(missing.problems).toHaveLength(1);
      expect(missing.problems[0]).toMatch(/Rule 13\.1/);
      expect(judgeCitation(touched, body('Rule 12.2'), defined).problems).toEqual([]);
    });
  }

  it('fails a citation of a rule the document does not define, and names it', () => {
    const v = judgeCitation({ ...none, codes: new Set(['TS8079']) }, undefinedRule, defined);
    expect(v.problems).toHaveLength(1);
    expect(v.problems[0]).toMatch(/Rule 99\.99, which the document does not define/);
  });

  it('passes when one cited rule exists beside one that does not', () => {
    const v = judgeCitation(
      { ...none, codes: new Set(['TS8079']) },
      `${undefinedRule}, Rule 12.2`,
      defined,
    );
    expect(v.problems).toEqual([]);
    expect(v.cited).toEqual(['12.2']);
  });

  it('does not take `Change: none` as an excuse: Rule 13.1 has no exception', () => {
    const v = judgeCitation({ ...none, rules: new Set(['6.7']) }, 'Change: none, a typo', defined);
    expect(v.problems).toHaveLength(1);
  });

  it('fails a citation hidden in an HTML comment', () => {
    const v = judgeCitation({ ...none, surface: new Set([28]) }, '<!-- Rule 12.2 -->', defined);
    expect(v.problems).toHaveLength(1);
  });
});
