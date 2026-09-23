// ═══ The traceability tree under reqs/ is the design rules as they are written, and every link holds ═══
//
// `scripts/reqs-sync.ts` derives reqs/ from docs/language-design.md and the surface document;
// Doorstop (CI's traceability job, and the commit hook when it is installed) checks fingerprints,
// suspect links and the references it can see. This file is the half that needs no Python:
//
//   1. reqs/ is not stale: a rule edited in the Markdown without `bun run reqs:sync` fails here,
//      before Doorstop ever sees the old text and calls it reviewed.
//   2. Every verifying file of every rule still names the rule, including the ones Doorstop
//      cannot see (`doorstopSees`): the same keyword search Doorstop runs, over all of them.
//
// SANITY FIRST (AGENTS.md#gate-discipline): the parser is asserted to have seen every
// `**Rule N.M.**` paragraph the document has, and a floor of surface sections and references,
// so a parser that silently stopped matching cannot pass the checks below on an empty tree.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../scripts/doc-refs.js';
import {
  appendixB,
  buildRules,
  buildSurface,
  doorstopSees,
  parseFront,
  ruleBlocks,
  ruleUid,
  stale,
  surfUid,
} from '../scripts/reqs-sync.js';

const design = readFileSync(join(ROOT, 'docs/language-design.md'), 'utf8');

describe('sanity: the tree reads the whole document', () => {
  it('parses every rule paragraph the document has', () => {
    const declared = [...design.matchAll(/^\*\*Rule (\d+\.\d+)\.\*\*/gm)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThanOrEqual(90);
    expect(ruleBlocks(design).map(([n]) => n)).toEqual(declared);
  });

  it('finds verifying files for most rules, and surface sections for many', () => {
    const rules = buildRules();
    expect(rules.filter((r) => r.verification === 'test').length).toBeGreaterThanOrEqual(80);
    expect(rules.flatMap((r) => [...r.references, ...r.evidence]).length).toBeGreaterThanOrEqual(
      130,
    );
    expect(buildSurface(rules).length).toBeGreaterThanOrEqual(20);
    expect(appendixB(design).size).toBeGreaterThanOrEqual(1);
  });

  it('numbers items so a rule and a section keep their UID', () => {
    expect(ruleUid('2.1')).toBe('RULE-0201');
    expect(ruleUid('8.12')).toBe('RULE-0812');
    expect(surfUid(13)).toBe('SURF-013');
  });

  it('reads the front matter Doorstop writes', () => {
    expect(
      parseFront(
        [
          'active: true',
          "level: '8.10'",
          'links:',
          '- RULE-0501: fX2q=',
          '- RULE-0502: null',
          'references:',
          "- keyword: 'Rule 1.1'",
          '  path: scripts/compile-gate.ts',
          '  type: file',
          'evidence:',
          '- .github/workflows/ci.yml',
          "ref: ''",
        ].join('\n'),
      ),
    ).toEqual({
      active: true,
      level: '8.10',
      links: [{ 'RULE-0501': 'fX2q=' }, { 'RULE-0502': null }],
      references: [{ keyword: 'Rule 1.1', path: 'scripts/compile-gate.ts', type: 'file' }],
      evidence: ['.github/workflows/ci.yml'],
      ref: '',
    });
  });

  it('models what Doorstop can see', () => {
    expect(doorstopSees('src/core/emit.ts')).toBe(true);
    expect(doorstopSees('.github/workflows/ci.yml')).toBe(false);
    // `.gitignore` has `coverage/`, which Doorstop reads as `*coverage*`.
    expect(doorstopSees('src/core/intrinsic-coverage.test.ts')).toBe(false);
  });
});

describe('reqs/ follows the Markdown', () => {
  it('is not stale', () => {
    expect(
      stale(),
      'Run `bun run reqs:sync`, then `doorstop -C` and review what it flags (reqs/README.md).',
    ).toEqual([]);
  });

  it('every verifying file still names the rule it verifies', () => {
    const broken: string[] = [];
    for (const r of buildRules()) {
      const keyword = new RegExp(`(\\b|\\W)Rule ${r.number.replace('.', '\\.')}(\\b|\\W)`);
      for (const f of [...r.references, ...r.evidence]) {
        if (!keyword.test(readFileSync(join(ROOT, f), 'utf8')))
          broken.push(`Rule ${r.number}: ${f}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
