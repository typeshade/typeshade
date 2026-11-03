// The `.gitignore` reader of the `tshc` directory walk (#1001): each pattern form of gitignore(5)
// it reads, the order that decides, the rules from above a directory, and the forms it leaves
// alone. The walk itself is held in run.test.ts; here the matcher stands alone, on paths as the
// walk spells them.

import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { inheritedRules, isIgnored, parseIgnoreFile, type IgnoreHost } from './ignore.js';

/** Whether a `.gitignore` of `text` in `/p` ignores `path`, a file unless `directory` says not. */
const ignores = (text: string, path: string, directory = false): boolean =>
  isIgnored(parseIgnoreFile(text, '/p'), `/p/${path}`, directory);

// [gitignore text, path, is a directory, ignored]. A row that is true proves the reader can see an
// ignore at all, so a reader that ignored nothing could not pass the rows that are false. Git
// itself gives the last column (the second describe below).
const rows: [string, string, boolean, boolean][] = [
  // a name with no slash: at any depth, a file or a directory
  ['build', 'build', false, true],
  ['build', 'build', true, true],
  ['build', 'src/build', true, true],
  ['build', 'src/builder', true, false],
  ['build', 'rebuild', false, false],
  // a trailing slash: a directory only
  ['build/', 'build', true, true],
  ['build/', 'src/build', true, true],
  ['build/', 'build', false, false],
  // a slash at the start or in the middle: fixed to the directory of the .gitignore
  ['/build', 'build', true, true],
  ['/build', 'src/build', true, false],
  ['src/gen', 'src/gen', true, true],
  ['src/gen', 'a/src/gen', true, false],
  ['src/gen/', 'src/gen', true, true],
  // wildcards: `*` and `?` stop at a slash
  ['*.log', 'a.log', false, true],
  ['*.log', 'x/y/a.log', false, true],
  ['*.log', 'a.logx', false, false],
  ['a*b', 'ab', false, true],
  ['a*b', 'axxb', false, true],
  ['a*b', 'a/b', false, false],
  ['?x', 'ax', false, true],
  ['?x', 'x', false, false],
  ['?x', 'a/x', false, false],
  ['src/*.ts', 'src/a.ts', false, true],
  ['src/*.ts', 'src/deep/a.ts', false, false],
  // brackets
  ['[ab].ts', 'a.ts', false, true],
  ['[ab].ts', 'b.ts', false, true],
  ['[ab].ts', 'c.ts', false, false],
  ['[a-c].ts', 'b.ts', false, true],
  ['[!ab].ts', 'c.ts', false, true],
  ['[!ab].ts', 'a.ts', false, false],
  ['[^ab].ts', 'c.ts', false, true],
  ['a[!b]c', 'a/c', false, false],
  ['a[!b]c', 'axc', false, true],
  ['x[', 'x[', false, false],
  ['x[a', 'x[a', false, false],
  ['x[a]', 'xa', false, true],
  // two asterisks
  ['**/gen', 'gen', true, true],
  ['**/gen', 'a/gen', true, true],
  ['**/gen', 'a/b/gen', true, true],
  ['a/**/gen', 'a/gen', true, true],
  ['a/**/gen', 'a/x/y/gen', true, true],
  ['a/**/gen', 'b/gen', true, false],
  ['gen/**', 'gen/x', false, true],
  ['gen/**', 'gen/x/y', false, true],
  ['gen/**', 'gen', true, false],
  ['a**b', 'axb', false, true],
  ['a**b', 'a/b', false, false],
  // escapes
  ['\\#x', '#x', false, true],
  ['\\!x', '!x', false, true],
  ['a\\ ', 'a ', false, true],
  ['a\\*', 'a*', false, true],
  ['a\\*', 'ab', false, false],
  // characters a regular expression would read as its own
  ['a.b', 'a.b', false, true],
  ['a.b', 'axb', false, false],
  ['a+b', 'a+b', false, true],
  ['(a)', '(a)', false, true],
  ['a|b', 'a', false, false],
  // more than one line: the last rule that matches decides
  ['*.shade.ts\n!keep.shade.ts', 'a.shade.ts', false, true],
  ['*.shade.ts\n!keep.shade.ts', 'keep.shade.ts', false, false],
  ['*.shade.ts\n!keep.shade.ts', 'x/keep.shade.ts', false, false],
  ['/*\n!/src', 'src', true, false],
  ['/*\n!/src', 'lib', true, true],
  ['*\n!*/\n!*.shade.ts', 'a.shade.ts', false, false],
  ['*\n!*/\n!*.shade.ts', 'a.txt', false, true],
  ['*\n!*/\n!*.shade.ts', 'd/e.shade.ts', false, false],
  ['foo/*\n!foo/bar', 'foo/bar', true, false],
  ['foo/*\n!foo/bar', 'foo/baz', true, true],
  ['x\r\nbuild/\r\n', 'build', true, true],
  ['build   ', 'build', false, true],
  ['a\\  ', 'a ', false, true],
  ['a\\  ', 'a', false, false],
];

describe('which paths a pattern ignores', () => {
  it.each(rows)('%j ignores %j (directory: %j): %j', (pattern, path, directory, expected) => {
    expect(ignores(pattern, path, directory)).toBe(expected);
  });

  it('reads no rule from a comment, a blank line or a line of spaces', () => {
    for (const text of ['# build', '', '   ', '\n\n', '#', '# a\n# b\n']) {
      expect(parseIgnoreFile(text, '/p'), JSON.stringify(text)).toEqual([]);
    }
  });

  it('drops trailing spaces unless a backslash quotes them, and reads CRLF and a byte mark', () => {
    expect(ignores('build   ', 'build')).toBe(true);
    expect(ignores('build\t', 'build')).toBe(true);
    expect(ignores('a\\  ', 'a ')).toBe(true);
    expect(ignores('a\\  ', 'a')).toBe(false);
    expect(ignores('x\r\nbuild/\r\n', 'build', true)).toBe(true);
    expect(ignores('\uFEFFbuild', 'build')).toBe(true);
  });
});

describe('which rule decides', () => {
  it('lets the last rule that matches decide, and `!` include again', () => {
    const text = '*.shade.ts\n!keep.shade.ts\nkeep.shade.ts/\n';
    expect(ignores(text, 'a.shade.ts')).toBe(true);
    expect(ignores(text, 'keep.shade.ts')).toBe(false);
    expect(ignores(text, 'x/keep.shade.ts')).toBe(false);
    // The last rule is for a directory, so a file of that name is still included.
    expect(ignores(text, 'keep.shade.ts', true)).toBe(true);
    expect(ignores('!a\nA', 'a')).toBe(false);
    expect(ignores('a\n!a', 'a')).toBe(false);
  });

  it('applies a deeper .gitignore after a shallower one, below its own directory only', () => {
    const rules = [
      ...parseIgnoreFile('*.shade.ts\n', '/p'),
      ...parseIgnoreFile('!keep.shade.ts\ngen/\n', '/p/src'),
    ];
    expect(isIgnored(rules, '/p/a.shade.ts', false)).toBe(true);
    expect(isIgnored(rules, '/p/src/keep.shade.ts', false)).toBe(false);
    expect(isIgnored(rules, '/p/keep.shade.ts', false)).toBe(true);
    expect(isIgnored(rules, '/p/src/gen', true)).toBe(true);
    expect(isIgnored(rules, '/p/gen', true)).toBe(false);
    expect(isIgnored(rules, '/p/srcx/gen', true)).toBe(false);
  });

  it('ignores nothing without a rule', () => {
    expect(isIgnored([], '/p/build', true)).toBe(false);
  });
});

/** A host over `files` (absolute path to text); a directory is implied by the paths under it. */
const hostOf = (files: Record<string, string>): IgnoreHost => ({
  readFile: (path) => files[path],
  kind: (path) =>
    files[path] !== undefined
      ? 'file'
      : Object.keys(files).some((f) => f.startsWith(`${path}/`))
        ? 'directory'
        : undefined,
});

describe('the rules from above the directory a walk starts in', () => {
  const files = {
    '/r/.git/HEAD': '',
    '/r/.gitignore': 'one\n',
    '/r/pkg/.gitignore': 'two\n',
    '/r/pkg/app/.gitignore': 'three\n',
    '/r/pkg/app/src/a.shade.ts': '',
  };
  const names = (start: string, f: Record<string, string> = files): string[] =>
    inheritedRules(hostOf(f), start).map((r) => `${r.base}:${r.pattern.source}`);

  it('reads the .gitignore files from the repository root down to the parent, root first', () => {
    expect(names('/r/pkg/app/src')).toEqual([
      '/r:^(?:.*\\/)?one$',
      '/r/pkg:^(?:.*\\/)?two$',
      '/r/pkg/app:^(?:.*\\/)?three$',
    ]);
    expect(names('/r/pkg')).toEqual(['/r:^(?:.*\\/)?one$']);
  });

  it('leaves the .gitignore of the start itself to the walk', () => {
    expect(names('/r')).toEqual([]);
    expect(names('/r/pkg/app').includes('/r/pkg/app:^(?:.*\\/)?three$')).toBe(false);
  });

  it('reads none when no repository is around, since no file above is a project ignore file', () => {
    const { '/r/.git/HEAD': _head, ...bare } = files;
    expect(names('/r/pkg/app/src', bare)).toEqual([]);
  });

  it('stops at the nearest repository: a repository inside another reads its own files only', () => {
    expect(
      names('/r/pkg/app/src', { ...files, '/r/pkg/.git': 'gitdir: ../.git/worktrees/x' }),
    ).toEqual(['/r/pkg:^(?:.*\\/)?two$', '/r/pkg/app:^(?:.*\\/)?three$']);
    expect(names('/r/pkg', { ...files, '/r/pkg/.git/HEAD': '' })).toEqual([]);
  });

  it('reads a root on a Windows drive, and stops at the top', () => {
    const win = { 'D:/w/.git/HEAD': '', 'D:/w/.gitignore': 'one\n', 'D:/w/app/a.shade.ts': '' };
    expect(names('D:/w/app', win)).toEqual(['D:/w:^(?:.*\\/)?one$']);
    expect(names('D:/w/app', { 'D:/w/.gitignore': 'one\n' })).toEqual([]);
  });
});

// Git is the authority on what a .gitignore means (AGENTS.md#gate-discipline, one authority), so
// the rows above are put to `git check-ignore` as well, each in a directory of its own with the
// text as its .gitignore. A reader that agreed with the table alone could agree on a wrong answer.
// A file system that cannot hold a name such as `a*` (Windows) cannot run this.
const gitReady = process.platform !== 'win32' && spawnSync('git', ['--version']).status === 0;

describe.runIf(gitReady)('the rows are what git check-ignore says', () => {
  it('gives the verdict of Git on every row', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tshc-ignore-git-'));
    const env = {
      ...process.env,
      HOME: dir,
      XDG_CONFIG_HOME: dir,
      GIT_CONFIG_NOSYSTEM: '1',
    };
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir, env });
      const paths = rows.map(([text, path, directory], k) => {
        const full = join(dir, `r${k}`, path);
        mkdirSync(directory ? full : dirname(full), { recursive: true });
        writeFileSync(join(dir, `r${k}`, '.gitignore'), `${text}\n`);
        if (!directory) writeFileSync(full, '');
        return `r${k}/${path}`;
      });
      // Status 0: a path is ignored. 1: none is. Anything else is an error.
      const out = spawnSync('git', ['check-ignore', '-z', '--stdin'], {
        cwd: dir,
        env,
        input: `${paths.join('\0')}\0`,
        encoding: 'utf8',
      });
      expect([0, 1], out.stderr).toContain(out.status);
      const ignored = new Set(out.stdout.split('\0').filter(Boolean));
      rows.forEach(([text, path, directory, expected], k) => {
        const why = JSON.stringify([text, path, directory]);
        expect(ignored.has(paths[k]!), `git, ${why}`).toBe(expected);
        expect(ignores(text, path, directory), `reader, ${why}`).toBe(expected);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
