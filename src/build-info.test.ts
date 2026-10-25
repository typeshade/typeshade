// Verifies: Rule 11.11 (docs/language-design.md; traced in reqs/).
import { afterEach, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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

function cliFixture(): { dir: string; script: string; built: string; receipt: string } {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade build receipt #한글 '));
  dirs.push(dir);
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'dist', 'src', 'core'), { recursive: true });
  const script = join(dir, 'scripts', 'build-info.ts');
  writeFileSync(script, readFileSync(new URL('../scripts/build-info.ts', import.meta.url)));
  const built = join(dir, 'dist', 'src', 'core', 'build-info.js');
  writeFileSync(built, 'export const buildInfo = { version: "0.1.0", revision: null };\n');
  return { dir, script, built, receipt: join(dir, 'dist', '.typeshade-build.json') };
}

it.each(['absolute', 'relative'] as const)(
  'the %s build-info command records the emitted tree from an escaped package path',
  (kind) => {
    const { dir, script, built, receipt } = cliFixture();
    const entry = kind === 'absolute' ? script : './scripts/build-info.ts';
    const run = (): void => {
      const result = spawnSync('bun', [entry], { cwd: dir, encoding: 'utf8' });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(
        existsSync(receipt),
        'a successful command must actually record build provenance',
      ).toBe(true);
    };
    const original = readFileSync(built, 'utf8');
    run();
    const first = JSON.parse(readFileSync(receipt, 'utf8')) as {
      revision: string | null;
      fingerprint: string;
    };
    expect(first.revision).toBeNull(); // An archive must not invent a clean repository revision.
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(built, 'utf8')).toBe(original);
    writeFileSync(built, original + '// changed emitted output\n');
    run();
    const second = JSON.parse(readFileSync(receipt, 'utf8')) as typeof first;
    expect(second.revision).toBeNull();
    expect(second.fingerprint).not.toBe(first.fingerprint);
  },
);

it('importing build-info without an entry argument writes no build receipt', () => {
  const { dir, script, built, receipt } = cliFixture();
  const original = readFileSync(built, 'utf8');
  const result = spawnSync(
    'bun',
    [
      '--eval',
      `process.argv = [process.execPath]; await import(${JSON.stringify(pathToFileURL(script).href)}); console.log('imported');`,
    ],
    { cwd: dir, encoding: 'utf8' },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe('imported');
  expect(result.stderr).toBe('');
  expect(existsSync(receipt)).toBe(false);
  expect(readFileSync(built, 'utf8')).toBe(original);
});

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
