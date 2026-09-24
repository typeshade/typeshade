// ═══ CHANGELOG.md's version headings say what each release promised (Rule 13.9) ═══
//
// Rule 13.9: a published version follows Semantic Versioning 2.0.0, and before 1.0.0 the minor
// is the breaking position. The CHANGELOG is where that is readable, so this test holds its
// headings to it:
//
//   - the first version heading is `## [Unreleased]`, and every other is `## [X.Y.Z] - YYYY-MM-DD`;
//   - released versions descend, each strictly below the one above it;
//   - a released version whose section has a `### Changed` or `### Removed` entry (the two
//     Keep a Changelog headings a breaking entry is filed under) bumps the breaking position
//     over the version below it: the minor before 1.0.0, the major from 1.0.0.
//
// What counts as breaking is review's to judge; this test holds the number to what the entries
// say. The check runs over synthetic changelogs first, so a reader that saw no headings cannot
// pass (AGENTS.md#gate-discipline, "prove the instrument").
//
// Verifies: Rule 13.9 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../scripts/doc-refs.js';

type Version = readonly [number, number, number];

interface Release {
  readonly line: number;
  readonly version: Version | 'unreleased';
  readonly breaking: boolean;
}

const RELEASED = /^## \[(\d+)\.(\d+)\.(\d+)\] - \d{4}-\d{2}-\d{2}$/;

/** The `## ` headings of a changelog, each with whether its section files a breaking entry. */
function releases(text: string): { releases: Release[]; problems: string[] } {
  const out: { line: number; version: Version | 'unreleased'; breaking: boolean }[] = [];
  const problems: string[] = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.trimEnd();
    if (line.startsWith('## ')) {
      const m = RELEASED.exec(line);
      if (line === '## [Unreleased]')
        out.push({ line: i + 1, version: 'unreleased', breaking: false });
      else if (m) out.push({ line: i + 1, version: [+m[1]!, +m[2]!, +m[3]!], breaking: false });
      else
        problems.push(
          `line ${i + 1}: "${line}" is neither ## [Unreleased] nor ## [X.Y.Z] - YYYY-MM-DD`,
        );
    } else if (/^### (Changed|Removed)\b/.test(line) && out.length > 0) {
      out[out.length - 1]!.breaking = true;
    }
  });
  return { releases: out, problems };
}

const cmp = (a: Version, b: Version) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const show = (v: Version) => v.join('.');

/** Everything wrong with a changelog's headings under Rule 13.9. */
function check(text: string): string[] {
  const { releases: rs, problems } = releases(text);
  if (rs.length === 0) return [...problems, 'no version heading at all'];
  if (rs[0]!.version !== 'unreleased')
    problems.push(`line ${rs[0]!.line}: the first version heading is not ## [Unreleased]`);
  rs.slice(1).forEach((r) => {
    if (r.version === 'unreleased') problems.push(`line ${r.line}: a second ## [Unreleased]`);
  });
  const released = rs.filter(
    (r): r is Release & { version: Version } => r.version !== 'unreleased',
  );
  released.forEach((r, i) => {
    const below = released[i + 1];
    if (below === undefined) return;
    if (cmp(r.version, below.version) <= 0)
      problems.push(
        `line ${r.line}: ${show(r.version)} is not above ${show(below.version)}, the release below it`,
      );
    else if (r.breaking) {
      const bumped =
        r.version[0] >= 1
          ? r.version[0] > below.version[0]
          : r.version[0] > below.version[0] || r.version[1] > below.version[1];
      if (!bumped)
        problems.push(
          `line ${r.line}: ${show(r.version)} files a ### Changed or ### Removed entry but does not bump the ` +
            `${r.version[0] >= 1 ? 'major' : 'minor'} over ${show(below.version)} (Rule 13.9)`,
        );
    }
  });
  return problems;
}

const doc = (...sections: string[]) => ['# Changelog', '', ...sections].join('\n');

describe('the changelog check sees a bad changelog (the instrument)', () => {
  it('refuses a changelog with no version heading', () => {
    expect(check('# Changelog\n\nNothing here.')).toEqual(['no version heading at all']);
  });

  it('refuses a released heading without its date, and a first heading that is not [Unreleased]', () => {
    expect(check(doc('## [0.1.0]', '### Added', '- x'))).toEqual([
      'line 3: "## [0.1.0]" is neither ## [Unreleased] nor ## [X.Y.Z] - YYYY-MM-DD',
      'no version heading at all',
    ]);
    expect(check(doc('## [0.1.0] - 2026-10-01'))).toEqual([
      'line 3: the first version heading is not ## [Unreleased]',
    ]);
  });

  it('refuses versions out of order', () => {
    expect(
      check(doc('## [Unreleased]', '## [0.1.0] - 2026-10-01', '## [0.2.0] - 2026-11-01')),
    ).toEqual(['line 4: 0.1.0 is not above 0.2.0, the release below it']);
  });

  it('refuses a 0.x patch that files a breaking entry, and a 1.x minor that does', () => {
    expect(
      check(
        doc(
          '## [Unreleased]',
          '## [0.2.1] - 2026-12-01',
          '### Changed',
          '- y',
          '## [0.2.0] - 2026-11-01',
        ),
      ),
    ).toEqual([
      'line 4: 0.2.1 files a ### Changed or ### Removed entry but does not bump the minor over 0.2.0 (Rule 13.9)',
    ]);
    expect(
      check(
        doc(
          '## [Unreleased]',
          '## [1.1.0] - 2027-02-01',
          '### Removed',
          '- z',
          '## [1.0.0] - 2027-01-01',
        ),
      ),
    ).toEqual([
      'line 4: 1.1.0 files a ### Changed or ### Removed entry but does not bump the major over 1.0.0 (Rule 13.9)',
    ]);
  });

  it('accepts what Rule 13.9 allows', () => {
    expect(
      check(
        doc(
          '## [Unreleased]',
          '### Changed',
          '- a break waiting for 0.3.0',
          '## [0.2.1] - 2026-12-01',
          '### Fixed',
          '- f',
          '## [0.2.0] - 2026-11-01',
          '### Changed',
          '- the flip',
          '## [0.1.0] - 2026-10-01',
          '### Changed',
          '- the first release has nothing below it',
        ),
      ),
    ).toEqual([]);
  });
});

describe('CHANGELOG.md', () => {
  const text = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');

  it('opens with ## [Unreleased], dates every release, and bumps the breaking position (Rule 13.9)', () => {
    expect(releases(text).releases.length, 'the reader found no version heading').toBeGreaterThan(
      0,
    );
    expect(check(text)).toEqual([]);
  });
});
