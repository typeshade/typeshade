// Verifies: Rule 11.11 (docs/language-design.md; traced in reqs/).
import { afterEach, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordBuildInfo, sourceRevision, stampBuildInfo } from '../scripts/build-info.js';
import { buildInfo } from './core/build-info.js';
import { VERSION } from './core/version.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function setup(): { dir: string; git: (...args: string[]) => string; built: string } {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-build-info-'));
  dirs.push(dir);
  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Build test');
  git('config', 'user.email', 'build@example.invalid');
  writeFileSync(join(dir, '.gitignore'), 'dist/\n');
  writeFileSync(join(dir, 'source.ts'), 'original');
  git('add', '.');
  git('commit', '-qm', 'baseline');
  mkdirSync(join(dir, 'dist/src/core'), { recursive: true });
  const built = join(dir, 'dist/src/core/build-info.js');
  writeFileSync(
    built,
    'export const buildInfo = Object.freeze({ version: "0.1.0", revision: null });\n',
  );
  recordBuildInfo(dir);
  return { dir, git, built };
}

it('keeps the public source version equal to the manifest, with an unstamped revision', () => {
  expect(buildInfo).toEqual({
    version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version,
    revision: null,
  });
  expect(buildInfo.version).toBe(VERSION);
  expect(Object.isFrozen(buildInfo)).toBe(true);
});

it('stamps a clean exact revision, then clears it for modified, staged and untracked sources', () => {
  const { dir, git, built } = setup();
  const head = git('rev-parse', 'HEAD');
  expect(stampBuildInfo(dir)).toBe(head);
  expect(readFileSync(built, 'utf8')).toContain(`revision: "${head}"`);
  writeFileSync(join(dir, 'source.ts'), 'modified');
  expect(stampBuildInfo(dir)).toBeNull();
  expect(readFileSync(built, 'utf8')).toContain('revision: null');
  git('add', 'source.ts');
  expect(sourceRevision(dir)).toBeNull();
  git('reset', '--hard', '-q', 'HEAD');
  writeFileSync(join(dir, 'new.ts'), 'untracked');
  expect(sourceRevision(dir)).toBeNull();
});

it('does not invent a revision for an archive or a directory in another repository', () => {
  const { dir } = setup();
  const nested = join(dir, 'dist');
  expect(sourceRevision(nested)).toBeNull();
  rmSync(join(dir, '.git'), { recursive: true });
  expect(stampBuildInfo(dir)).toBeNull();
});

it('refuses missing receipts, stale builds and modified build output even with clean sources', () => {
  const { dir, git, built } = setup();
  writeFileSync(built, readFileSync(built, 'utf8') + '// modified output\n');
  expect(stampBuildInfo(dir)).toBeNull();
  recordBuildInfo(dir);
  expect(stampBuildInfo(dir)).not.toBeNull();
  writeFileSync(join(dir, 'source.ts'), 'new source');
  git('add', 'source.ts');
  git('commit', '-qm', 'new source revision');
  expect(stampBuildInfo(dir)).toBeNull();
  recordBuildInfo(dir);
  expect(stampBuildInfo(dir)).not.toBeNull();
  rmSync(join(dir, 'dist/.typeshade-build.json'));
  expect(stampBuildInfo(dir)).toBeNull();
});

it('stamps a staging copy without modifying source and refuses an unknown output shape', () => {
  const { dir, built } = setup();
  const stage = join(dir, 'dist/stage');
  mkdirSync(join(stage, 'dist/src/core'), { recursive: true });
  const staged = join(stage, 'dist/src/core/build-info.js');
  writeFileSync(staged, readFileSync(built));
  writeFileSync(
    join(stage, 'dist/.typeshade-build.json'),
    readFileSync(join(dir, 'dist/.typeshade-build.json')),
  );
  expect(stampBuildInfo(dir, stage)).not.toBeNull();
  expect(readFileSync(built, 'utf8')).toContain('revision: null');
  writeFileSync(staged, 'not a build');
  expect(() => stampBuildInfo(dir, stage)).toThrow('Unexpected built buildInfo shape');
});
