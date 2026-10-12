// ═══ extractSeeds reads an issue body into the names, paths, codes, rules and refs it names ═══
//
// Step 1 of `bun run scope` turns an issue into seeds. This file pins the reader on the two
// owner issues the pack was built for (#498 and #484, kept as fixtures under scripts/scope/). It
// proves that the sections are keyed as written, that the identifiers, paths, rules, refs and
// commit of #498 are read, that no stopword and no `0x` token leaks into the seeds, and that a
// `#L26` inside a URL is not read as an issue reference. The inputs are real issue text, not a
// hand-made shape, so the reader is held to the bodies it will meet.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STOPWORDS, extractSeeds } from '../scripts/scope/seeds.js';

// A fixture holds the title on its first line as `# <title>`, then the body verbatim.
function loadIssue(name: string): { title: string; body: string } {
  const text = readFileSync(
    join(__dirname, '..', 'scripts', 'scope', '__fixtures__', name),
    'utf8',
  );
  const newline = text.indexOf('\n');
  const first = newline === -1 ? text : text.slice(0, newline);
  expect(first.startsWith('# ')).toBe(true);
  return { title: first.slice(2), body: text.slice(newline + 1) };
}

describe('extractSeeds reads issue #498 (fill emits untyped elements)', () => {
  const issue = loadIssue('issue-498.txt');
  const seeds = extractSeeds(issue.title, issue.body);

  it('keys the sections as written, in order, and keeps the title', () => {
    expect(seeds.title).toBe(issue.title);
    expect(Object.keys(seeds.sections)).toEqual([
      '## What happens',
      '## Why',
      '## What was expected',
      '## Rules',
      '## Tests owed',
      '## Pinned commit',
    ]);
  });

  it('names the identifiers of the Why section, from its code spans', () => {
    for (const name of ['lowerFill', 'typeArrayElement', 'fillArray']) {
      expect(seeds.identifiers).toContain(name);
    }
  });

  it('reads the path of the lowering file', () => {
    expect(seeds.paths).toContain('src/compiler/ts/lower/expression-array.ts');
  });

  it('reads the rules 1.3 and 11.3 from the Rules section', () => {
    expect(seeds.rules).toContain('1.3');
    expect(seeds.rules).toContain('11.3');
  });

  it('reads the issue and pull request numbers 495 and 496 as refs', () => {
    expect(seeds.refs).toContain(495);
    expect(seeds.refs).toContain(496);
  });

  it('reads the pinned commit c57fbdc', () => {
    expect(seeds.commits).toContain('c57fbdc');
  });

  it('reads no 0x-prefixed or 0x-style token as a commit', () => {
    expect(seeds.commits.some((c) => c.startsWith('0x'))).toBe(false);
    expect(seeds.commits).not.toContain('7fc00001');
  });

  it('keeps no stopword among the identifiers', () => {
    const stop = new Set<string>(STOPWORDS);
    expect(seeds.identifiers.length).toBeGreaterThan(0);
    expect(seeds.identifiers.filter((name) => stop.has(name))).toEqual([]);
  });
});

describe('extractSeeds reads issue #484 (GLSL storage emulation)', () => {
  const issue = loadIssue('issue-484.txt');
  const seeds = extractSeeds(issue.title, issue.body);

  it('keys the sections as written, in order', () => {
    expect(Object.keys(seeds.sections)).toEqual([
      '## What happens',
      '## What was expected',
      '## Rules',
      '## Tests owed',
      '## Pinned commit',
    ]);
  });

  it('reads no 0x-style bit pattern as a commit', () => {
    // The body names 0x00000001, 0x007fffff and 0x80000001. None may become a commit.
    expect(seeds.commits.some((c) => c.startsWith('0x'))).toBe(false);
    expect(seeds.commits).not.toContain('007fffff');
    expect(seeds.commits).not.toContain('00000001');
  });

  it('keeps no stopword among the identifiers', () => {
    const stop = new Set<string>(STOPWORDS);
    expect(seeds.identifiers.filter((name) => stop.has(name))).toEqual([]);
  });
});

describe('extractSeeds does not read a URL fragment as an issue reference', () => {
  it('reads the #495 after a URL and not the #L26 inside the URL', () => {
    const seeds = extractSeeds(
      'a title',
      'See https://github.com/typeshade/typeshade/blob/main/src/a.ts#L26 and #495.',
    );
    expect(seeds.refs).toContain(495);
    expect(seeds.refs).not.toContain(26);
  });
});
