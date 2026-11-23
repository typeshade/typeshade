import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { downstreamImpact } from '../scripts/downstream-impact.js';

const bake = (...names: string[]): string =>
  ['## `.` — exports', '```', ...names, '```'].join('\n');

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
      GIT_CONFIG_NOSYSTEM: '1',
      HOME: dirname(cwd),
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

const put = (dir: string, path: string, lines: readonly string[]): void => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), `${lines.join('\n')}\n`);
};

describe('a removed export whose name is an English word', () => {
  let root: string;
  let found: string[];

  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'downstream-prose-')));
    const compiler = join(root, 'compiler');
    mkdirSync(compiler);
    git(compiler, 'init', '-q', '-b', 'main');
    put(compiler, 'src/__api__/surface.md', bake('keptExport', 'Resident', 'resident').split('\n'));
    git(compiler, 'add', '-A');
    git(compiler, 'commit', '-q', '-m', 'old');
    const oldSha = git(compiler, 'rev-parse', 'HEAD').trim();
    put(compiler, 'src/__api__/surface.md', bake('keptExport').split('\n'));
    git(compiler, 'add', '-A');
    git(compiler, 'commit', '-q', '-m', 'new');
    const newSha = git(compiler, 'rev-parse', 'HEAD').trim();

    const repo = join(root, 'repo');
    mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    put(repo, 'README.md', [
      '# Resident arrays',
      'The resident plan stays on the GPU.',
      'Call `resident()` to keep it.',
      'Resident snapshot bytes are small.',
      '```ts',
      'const plan = Resident;',
      '```',
      'After the fence the resident word is prose again.',
      'Both `Resident` and `resident` are code here.',
    ]);
    put(repo, 'package.json', ['{"mode": "resident", "kind": "Resident"}']);
    put(repo, 'vitest.config.ts', [
      "import { Resident } from 'typeshade';",
      '// The resident plan is a comment.',
      '/**',
      ' * The resident plan, and `Resident` as code.',
      ' */',
      'export const x = resident(1);',
    ]);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');
    git(repo, 'checkout', '-q', '-b', 'pin');
    put(repo, 'AUTHORING.md', ['A new file.']);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'pin');

    found = downstreamImpact({
      root: repo,
      repo: 'repo',
      compiler: '../compiler',
      oldSha,
      newSha,
      base: 'main',
    }).mustFix.map((f) => `${f.subject.split('`')[1]} ${f.file}:${f.line}`);
  }, 60_000);

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reports the name in an import, an identifier, a code span and a code block', () => {
    expect(found).toEqual(
      [
        'Resident README.md:6',
        'Resident README.md:9',
        'Resident vitest.config.ts:1',
        'Resident vitest.config.ts:4',
        'resident README.md:3',
        'resident README.md:9',
        'resident vitest.config.ts:6',
      ].sort(),
    );
  });

  it('does not report it in prose, a heading, a comment or a data file', () => {
    for (const at of [
      'README.md:1',
      'README.md:2',
      'README.md:4',
      'README.md:8',
      'vitest.config.ts:2',
      'package.json',
    ])
      expect(
        found.some((f) => f.endsWith(at)),
        at,
      ).toBe(false);
  });
});
