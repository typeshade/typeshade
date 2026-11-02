// ═══ The downstream check reads a bake diff and a git diff the way the pin workflows hand them over ═══
//
// `scripts/downstream-impact.ts` runs in the downstream repositories, on their compiler-pin pull
// requests. Its two readers are pinned here, where a change to them is made: which exports a pin
// removes, and which lines a branch touched. Its run is pinned here too, on throwaway repositories,
// for each kind of pin: a git submodule inside the repository, and a compiler checkout that lies
// beside a repository that installs a source tarball (#1000).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { removedExports, touchedLines } from '../scripts/downstream-impact.js';

const bake = (...names: string[]): string =>
  ['## `.` — exports', '```', ...names, '```'].join('\n');

describe('downstream impact', () => {
  it('lists the exports a pin removes, and not the ones it keeps or adds', () => {
    expect(
      removedExports(
        bake('compile', 'createTypeshadeLanguageService', 'emitWgsl'),
        bake('compile', 'emitWgsl', 'emitGlsl'),
      ),
    ).toEqual(['createTypeshadeLanguageService']);
  });

  it('reads the head-side lines a diff adds', () => {
    const diff = [
      'diff --git a/docs/design.md b/docs/design.md',
      '--- a/docs/design.md',
      '+++ b/docs/design.md',
      '@@ -20,2 +20,3 @@',
      '-old',
      '+new one',
      '+new two',
      '@@ -40 +41 @@',
      '+later',
    ].join('\n');
    expect([...(touchedLines(diff).get('docs/design.md') ?? [])]).toEqual([20, 21, 41]);
  });
});

describe('what a repository downstream runs from the pin', () => {
  // The site and the editor run `downstream-impact.ts` and `ifchange.ts` from the pinned sources
  // with nothing installed. A top-level import of the compiler (which imports `typescript`)
  // anywhere in their module graph fails every such run before it reads a line: #298 imported
  // the ambient library into doc-impact.ts, and vscode-typeshade's compiler bump failed on it.
  it('imports nothing from src/ at the top level of the scripts it loads', () => {
    for (const f of [
      'downstream-impact',
      'ifchange',
      'doc-impact',
      'doc-refs',
      'changes',
      'reqs-sync',
    ]) {
      const text = readFileSync(join(__dirname, '..', 'scripts', `${f}.ts`), 'utf8');
      expect(text.match(/^import[^;]*from '\.\.\/src\/[^']*';/gm) ?? [], f).toEqual([]);
    }
  });
});

// ─── the run, on throwaway repositories ─────────────────────────────────────────────────────
//
// The compiler repository has two commits, the old pin and the new pin. The new pin removes the
// export `goneExport` and the file `src/gone-file.ts`, changes a `LINT.IfChange` block whose
// `ThenChange` names `//typeaudio/docs/mirror.md`, and implements proposal 0007, which names
// `typeaudio` under `downstream`. The repository `typeaudio` still names the export and the file
// on lines its branch does not touch, does not change `docs/mirror.md`, and does not record 0007
// in `compiler-changes.md`. A correct run reports those four, and nothing for the line its branch
// wrote. The same two repositories are read through each way of naming the compiler checkout.

const SCRIPT = join(__dirname, '..', 'scripts', 'downstream-impact.ts');

const FINDINGS = [
  'export goneExport removed from the compiler',
  'compiler src/gone-file.ts deleted',
  'compiler src/mirror.ts:1 (mirror) changed; its ThenChange names this repository',
  'compiler change 0007 (changes/0007-sample.md) owes this repository work',
];

const gitEnv = (home: string): NodeJS.ProcessEnv => ({
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_NOSYSTEM: '1',
  HOME: home,
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd,
    env: gitEnv(dirname(cwd)),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function put(dir: string, path: string, lines: readonly string[]): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), `${lines.join('\n')}\n`);
}

const mirror = (n: number): string[] => [
  '// LINT.IfChange(mirror)',
  `export const mirrored = ${n};`,
  '// LINT.ThenChange(//typeaudio/docs/mirror.md)',
];

const PROPOSAL = [
  '---',
  "id: '0007'",
  'title: A sample',
  'status: implemented',
  'downstream:',
  '  - repo: typeaudio',
  '    what: Adopt the sample.',
  '---',
  '',
  'A sample proposal.',
];

interface Pins {
  readonly oldSha: string;
  readonly newSha: string;
}

function buildCompiler(dir: string): Pins {
  git(dir, 'init', '-q', '-b', 'main');
  put(dir, 'src/__api__/surface.md', bake('keptExport', 'goneExport').split('\n'));
  put(dir, 'src/gone-file.ts', ['export const gone = 1;']);
  put(dir, 'src/mirror.ts', mirror(1));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'the old pin');
  const oldSha = git(dir, 'rev-parse', 'HEAD').trim();
  put(dir, 'src/__api__/surface.md', bake('keptExport', 'newExport').split('\n'));
  rmSync(join(dir, 'src', 'gone-file.ts'));
  put(dir, 'src/mirror.ts', mirror(2));
  put(dir, 'changes/0007-sample.md', PROPOSAL);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'the new pin');
  return { oldSha, newSha: git(dir, 'rev-parse', 'HEAD').trim() };
}

// The repository `typeaudio` on its branch `pin`, cut from `main`. With `vendored`, the compiler is
// a checkout at `vendor/typeshade` that the repository records as a gitlink (what a submodule
// is), at the old pin on `main` and at the new pin on `pin`.
function buildDownstream(dir: string, compiler: string, pins: Pins, vendored: boolean): void {
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  put(dir, 'docs/notes.md', [
    '# Notes',
    'The engine starts a voice with goneExport.',
    'It reads the level with keptExport.',
    'The old helper lives in src/gone-file.ts of the compiler.',
  ]);
  put(dir, 'docs/mirror.md', ['This page mirrors src/mirror.ts.']);
  put(dir, 'compiler-changes.md', ['# Compiler changes this repository has handled']);
  const checkout = join(dir, 'vendor', 'typeshade');
  if (vendored) {
    git(dir, 'clone', '-q', compiler, 'vendor/typeshade');
    git(checkout, 'checkout', '-q', pins.oldSha);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'the base');
  git(dir, 'checkout', '-q', '-b', 'pin');
  const notes = join(dir, 'docs', 'notes.md');
  writeFileSync(notes, `${readFileSync(notes, 'utf8')}Retired: goneExport is gone from here.\n`);
  if (vendored) git(checkout, 'checkout', '-q', pins.newSha);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'move the pin');
}

describe('the compiler checkout the script reads', () => {
  let root: string;
  let compiler: string;
  let tarball: string;
  let submodule: string;
  let pins: Pins;

  const run = (cwd: string, ...args: string[]) =>
    spawnSync('bun', [SCRIPT, ...args], { cwd, encoding: 'utf8', env: gitEnv(root) });

  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'downstream-impact-')));
    compiler = join(root, 'typeshade-pinref');
    mkdirSync(compiler);
    pins = buildCompiler(compiler);
    tarball = join(root, 'typeaudio');
    buildDownstream(tarball, compiler, pins, false);
    submodule = join(root, 'typeaudio-vendored');
    buildDownstream(submodule, compiler, pins, true);
  }, 60_000);

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // Each run must report the four findings, the two lines they name, and not the line the branch
  // wrote, with nothing on stderr: a crash exits 1, as a finding does.
  const reportsTheFindings = (result: ReturnType<typeof run>): void => {
    expect(result.stderr).toBe('');
    for (const finding of FINDINGS) expect(result.stdout, finding).toContain(finding);
    expect(result.stdout).toContain('docs/notes.md:2');
    expect(result.stdout).toContain('docs/notes.md:4');
    expect(result.stdout).not.toContain('docs/notes.md:5');
    expect(result.status).toBe(1);
  };

  it('reads a checkout inside the repository, a git submodule, named by --submodule', () => {
    reportsTheFindings(
      run(
        submodule,
        '--repo',
        'typeaudio',
        '--submodule',
        'vendor/typeshade',
        '--base',
        'main',
        '--check',
      ),
    );
  }, 60_000);

  // The pins of a tarball are the two commits of the checkout, named on the command line: a
  // tarball has no gitlink to read the old one from.
  const tarballRun = (...checkout: string[]) =>
    run(
      tarball,
      ...['--repo', 'typeaudio', ...checkout],
      ...['--old', pins.oldSha, '--new', pins.newSha, '--base', 'main', '--check'],
    );

  it('reads a checkout beside a repository that installs a tarball, named by --compiler', () => {
    reportsTheFindings(tarballRun('--compiler', '../typeshade-pinref'));
  }, 60_000);

  it('reads the same checkout named by an absolute --compiler path', () => {
    reportsTheFindings(tarballRun('--compiler', compiler));
  }, 60_000);

  it('reads the same checkout named by --submodule with a path outside the repository', () => {
    reportsTheFindings(tarballRun('--submodule', '../typeshade-pinref'));
  }, 60_000);
});
