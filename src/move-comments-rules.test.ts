import { describe, expect, it } from 'vitest';
import { checkCommentRemoval } from '../scripts/move-purity/check-comments.js';
import type { DiffEntry } from '../scripts/move-purity/outside-move.js';
import { tree } from './core/testing/move-purity-fixtures.js';

const NORMAL = '100644';
const ABSENT = '000000';
const SURFACE = 'src/__api__/surface.md';
const BASELINE = 'scripts/comment-baseline.json';
const SIZES = 'scripts/file-size-baseline.json';

const check = (
  before: Record<string, string>,
  after: Record<string, string>,
  modes: Record<string, [string, string]> = {},
) => {
  const base = tree(before);
  const head = tree(after);
  const paths = [...new Set([...base.keys(), ...head.keys()])]
    .filter((path) => base.get(path) !== head.get(path) || path in modes)
    .sort();
  const entries: DiffEntry[] = paths.map((path) => {
    const [oldMode, newMode] = modes[path] ?? [
      base.has(path) ? NORMAL : ABSENT,
      head.has(path) ? NORMAL : ABSENT,
    ];
    return { path, oldMode, newMode };
  });
  return checkCommentRemoval(base, head, { paths, entries });
};

const kinds = (report: ReturnType<typeof check>): string[] => report.findings.map((f) => f.kind);
const reasons = (report: ReturnType<typeof check>): string[] =>
  report.outside.map((o) => `${o.path}: ${o.reason}`);

const marker = (name: string, rule: string): string => `// ${[name, rule].join(': ')}\n`;
const lint = (name: string): string => `// ${['LINT', name].join('.')}\n`;

const CODE = 'export const a = 1;\n';

describe('rule 1: only comments of src/ files and a shrinking baseline change', () => {
  const plain = { 'src/a.ts': `// note\n${CODE}` };
  const bare = { 'src/a.ts': CODE };

  it('passes a removal in a src file', () => {
    expect(check(plain, bare).pure).toBe(true);
  });

  it('refuses a document, a file outside src and a file of the checks', () => {
    for (const path of ['README.md', 'scripts/a.ts', 'scripts/move-purity/a.ts', 'package.json']) {
      const report = check({ ...plain, [path]: 'x\n' }, { ...bare, [path]: 'y\n' });
      expect(report.pure, path).toBe(false);
      expect(reasons(report).join('\n'), path).toContain(path);
    }
  });

  it('refuses a change of the surface file and of the owner documents', () => {
    expect(check({ ...plain, [SURFACE]: 'a\n' }, { ...bare, [SURFACE]: 'b\n' }).pure).toBe(false);
    expect(check({ ...plain, 'CLAUDE.md': 'a\n' }, { ...bare, 'CLAUDE.md': 'b\n' }).pure).toBe(
      false,
    );
  });

  it('refuses an added, a deleted and a renamed file', () => {
    expect(reasons(check(plain, { ...bare, 'src/b.ts': CODE }))).toEqual([
      'src/b.ts: an added file',
    ]);
    expect(reasons(check({ ...plain, 'src/b.ts': CODE }, bare))).toEqual([
      'src/b.ts: a deleted file',
    ]);
    const renamed = check({ 'src/a.ts': CODE }, { 'src/c.ts': CODE });
    expect(reasons(renamed)).toEqual(['src/a.ts: a deleted file', 'src/c.ts: an added file']);
  });

  it('refuses a mode change', () => {
    const report = check(plain, bare, { 'src/a.ts': [NORMAL, '100755'] });
    expect(reasons(report)).toEqual(['src/a.ts: a mode change 100644 -> 100755']);
  });

  it('refuses a shade file', () => {
    const report = check({ 'src/a.shade.ts': `// n\n${CODE}` }, { 'src/a.shade.ts': CODE });
    expect(reasons(report)).toEqual([
      'src/a.shade.ts: the comment policy does not police this file',
    ]);
  });

  it('passes a baseline entry that shrinks or goes, and refuses one that grows or appears', () => {
    const base = { ...plain, [BASELINE]: JSON.stringify({ 'src/a.ts': 3, 'src/b.ts': 1 }) };
    const shrunk = { ...bare, [BASELINE]: JSON.stringify({ 'src/a.ts': 2 }) };
    expect(check(base, shrunk).pure).toBe(true);
    const raised = { ...bare, [BASELINE]: JSON.stringify({ 'src/a.ts': 4, 'src/b.ts': 1 }) };
    expect(reasons(check(base, raised))).toEqual([`${BASELINE}: the baseline entry src/a.ts grew`]);
    const added = { ...bare, [BASELINE]: JSON.stringify({ 'src/a.ts': 3, 'src/c.ts': 1 }) };
    expect(reasons(check(base, added))).toEqual([
      `${BASELINE}: the baseline gained an entry: src/c.ts`,
    ]);
    const broken = { ...bare, [BASELINE]: '{' };
    expect(reasons(check(base, broken))).toEqual([
      `${BASELINE}: the baseline is not readable JSON`,
    ]);
  });
});

describe('the size baseline follows the shorter files', () => {
  const base = {
    'src/a.ts': `// note\n${CODE}`,
    [SIZES]: JSON.stringify({ 'src/a.ts': 9, 'src/b.ts': 5 }),
  };

  it('passes an entry that shrinks or goes', () => {
    const head = { 'src/a.ts': CODE, [SIZES]: JSON.stringify({ 'src/a.ts': 8 }) };
    expect(check(base, head).pure).toBe(true);
  });

  it('refuses an entry that grows or appears', () => {
    const grown = { 'src/a.ts': CODE, [SIZES]: JSON.stringify({ 'src/a.ts': 10, 'src/b.ts': 5 }) };
    expect(reasons(check(base, grown))).toEqual([`${SIZES}: the baseline entry src/a.ts grew`]);
    const added = { 'src/a.ts': CODE, [SIZES]: JSON.stringify({ 'src/c.ts': 1 }) };
    expect(reasons(check(base, added))).toEqual([
      `${SIZES}: the baseline gained an entry: src/c.ts`,
    ]);
  });
});

describe('rule 3: a comment may be removed and never added, edited or moved', () => {
  const base = { 'src/a.ts': `// one\nexport const a = 1;\n// two\nexport const b = 2;\n` };

  it('passes the removal of any subset', () => {
    const body = 'export const a = 1;\nexport const b = 2;\n';
    expect(check(base, { 'src/a.ts': body }).pure).toBe(true);
    expect(check(base, { 'src/a.ts': `// one\n${body}` }).pure).toBe(true);
    expect(
      check(base, { 'src/a.ts': 'export const a = 1;\n// two\nexport const b = 2;\n' }).pure,
    ).toBe(true);
  });

  it('refuses a comment that is added', () => {
    const report = check(base, { 'src/a.ts': `${base['src/a.ts']}// three\n` });
    expect(kinds(report)).toEqual(['comment added, edited or moved']);
  });

  it('refuses a comment that is reworded', () => {
    const report = check(base, { 'src/a.ts': base['src/a.ts'].replace('one', 'uno') });
    expect(kinds(report)).toContain('comment added, edited or moved');
  });

  it('refuses a comment that moved above another', () => {
    const swapped = '// two\nexport const a = 1;\n// one\nexport const b = 2;\n';
    expect(kinds(check(base, { 'src/a.ts': swapped }))).toContain('comment added, edited or moved');
  });

  it('refuses a kept comment that moved past a token', () => {
    const moved = '// one\n// two\nexport const a = 1;\nexport const b = 2;\n';
    const report = check(base, { 'src/a.ts': moved });
    expect(kinds(report)).toEqual(['comment added, edited or moved']);
  });

  it('refuses a Why: comment that is added in this mode', () => {
    const report = check(base, { 'src/a.ts': `// Why: a target forces it.\n${base['src/a.ts']}` });
    expect(kinds(report)).toEqual(['comment added, edited or moved']);
  });

  it('accepts a kept comment that Prettier indents differently', () => {
    const wide = { 'src/a.ts': 'export const a = [\n  /*\n     one\n  */\n  1,\n];\n' };
    const narrow = { 'src/a.ts': 'export const a = [\n  /*\n  one\n  */\n  1,\n];\n' };
    expect(check(wide, narrow).pure).toBe(true);
  });
});

describe('rule 4: a comment of an allowed kind is never removed', () => {
  const removed = (comment: string) =>
    check({ 'src/a.ts': `${comment}${CODE}` }, { 'src/a.ts': CODE });

  const allowed: Record<string, string> = {
    'a traceability marker': marker('Verifies', 'Rule 1.1'),
    'an implementation marker': marker('Implements', 'Rule 2.3'),
    'an if-change marker': lint('IfChange(label)'),
    'a then-change marker': lint('ThenChange(other.ts)'),
    'an eslint directive': '// eslint-disable-next-line no-console\n',
    'a ts expect error': '// @ts-expect-error because\n',
    'a vitest environment': '// @vitest-environment node\n',
    'a license line': '// SPDX-License-Identifier: Apache-2.0\n',
    'a Why comment': '// Why: a target forces it.\n',
    'a bundler hint': '/* @vite-ignore */\n',
    'a reference directive': '/// <reference types="node" />\n',
  };

  for (const [name, comment] of Object.entries(allowed)) {
    it(`refuses the removal of ${name}`, () => {
      const report = removed(comment);
      expect(kinds(report), name).toEqual(['allowed comment removed']);
      expect(report.findings[0]?.detail.length).toBeLessThanOrEqual(60);
      expect(report.findings[0]?.line).toBe(1);
    });
  }

  it('refuses the removal of the lines that continue a Why: comment', () => {
    const report = removed('// Why: a target\n// forces it.\n');
    expect(kinds(report)).toEqual(['allowed comment removed', 'allowed comment removed']);
  });

  it('refuses the doc comment of a public definition and passes that of a private one', () => {
    const surface = tree({ [SURFACE]: 'src/a.ts#shown — function\n' });
    const text = (doc: string): string =>
      `${doc}export function shown(): number {\n  return 1;\n}\n`;
    const privateText = (doc: string): string =>
      `${doc}function hidden(): number {\n  return 1;\n}\n`;
    const run = (before: string, after: string) =>
      checkCommentRemoval(
        new Map([...surface, ['src/a.ts', before]]),
        new Map([...surface, ['src/a.ts', after]]),
        { paths: ['src/a.ts'], entries: [{ path: 'src/a.ts', oldMode: NORMAL, newMode: NORMAL }] },
      );
    const doc = '/** Shown to a consumer. */\n';
    expect(kinds(run(text(doc), text('')))).toEqual(['allowed comment removed']);
    expect(run(privateText(doc), privateText('')).pure).toBe(true);
  });

  it('counts a plain comment that the policy does not see apart, and refuses a marker there', () => {
    const plainInside = 'export const a = f(/* inline */ 1);\n';
    const bareInside = 'export const a = f(1);\n';
    const report = check({ 'src/a.ts': plainInside }, { 'src/a.ts': bareInside });
    expect(report.pure).toBe(true);
    expect([report.removedLines, report.uncountedLines]).toEqual([0, 1]);
    const guarded = 'export const a = f(/* eslint-disable */ 1);\n';
    expect(kinds(check({ 'src/a.ts': guarded }, { 'src/a.ts': bareInside }))).toEqual([
      'allowed comment removed',
    ]);
  });

  it('passes the removal of a plain comment next to an allowed one that stays', () => {
    const before = `// plain\n${marker('Verifies', 'Rule 1.1')}${CODE}`;
    const after = `${marker('Verifies', 'Rule 1.1')}${CODE}`;
    expect(check({ 'src/a.ts': before }, { 'src/a.ts': after }).pure).toBe(true);
  });
});

describe('rules 5 and 6: blank lines are free, and the report counts', () => {
  it('passes a blank line that appears or goes', () => {
    const before = { 'src/a.ts': `export const a = 1;\n// x\n\nexport const b = 2;\n` };
    expect(check(before, { 'src/a.ts': 'export const a = 1;\nexport const b = 2;\n' }).pure).toBe(
      true,
    );
    expect(
      check(before, { 'src/a.ts': 'export const a = 1;\n\n\nexport const b = 2;\n' }).pure,
    ).toBe(true);
  });

  it('refuses a changed code token', () => {
    const report = check({ 'src/a.ts': `// x\n${CODE}` }, { 'src/a.ts': 'export const a = 2;\n' });
    expect(kinds(report)).toEqual(['code changed']);
  });

  it('counts the removed lines of each file and the baseline delta', () => {
    const report = check(
      {
        'src/a.ts': `/* one\n   two */\n${CODE}`,
        'src/b.ts': `// x\n// y\n// z\n${CODE}`,
        [BASELINE]: JSON.stringify({ 'src/a.ts': 2, 'src/b.ts': 3 }),
      },
      {
        'src/a.ts': CODE,
        'src/b.ts': `// z\n${CODE}`,
        [BASELINE]: JSON.stringify({ 'src/b.ts': 1 }),
      },
    );
    expect(report.pure).toBe(true);
    expect(report.files).toEqual([
      { path: 'src/a.ts', removed: 1, removedLines: 2, uncountedLines: 0 },
      { path: 'src/b.ts', removed: 2, removedLines: 2, uncountedLines: 0 },
    ]);
    expect(report.removedLines).toBe(4);
    expect(report.baseline).toEqual({ before: 5, after: 1, delta: 4 });
  });
});
