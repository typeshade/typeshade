import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const roots: string[] = [];
const checker = resolve(import.meta.dirname, '../scripts/doc-impact.ts');
const reqs = resolve(import.meta.dirname, '../scripts/reqs-sync.ts');
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'typeshade-policy-'));
  roots.push(root);
  const env = { ...process.env, TYPESHADE_DOCS_ROOT: root };
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: 'pipe' });
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  git('init', '-q');
  git('config', 'user.name', 'Policy test');
  git('config', 'user.email', 'policy@example.invalid');
  git('config', 'core.hooksPath', join(root, 'no-hooks'));
  for (const file of [
    'docs/language-design.md',
    'docs/use-typeshade-surface.md',
    'src/__api__/surface.md',
    'src/compiler/ts/codes.ts',
    'src/core/diagnostics/codes.ts',
  ])
    write(file, '');
  write('package.json', '{"scripts":{}}\n');
  write('scripts/doorstop-check.py', 'raise SystemExit(0)\n');
  write('README.md', 'The implementation is `src/widget.ts`.\n');
  write('src/widget.ts', 'export const value = 1;\n');
  git('add', '.');
  execFileSync('bun', [reqs], { cwd: root, env, stdio: 'pipe' });
  git('add', '.');
  git('commit', '-qm', 'baseline');
  const check = (phase: 'files' | 'message' | 'all', message = '') =>
    spawnSync(
      'bun',
      [
        '-e',
        `import {checkCommit,readDiff} from ${JSON.stringify(pathToFileURL(checker).href)}; process.exit(await checkCommit(readDiff('HEAD',true),process.env.TEST_MESSAGE ?? '',${JSON.stringify(phase)}));`,
      ],
      { cwd: root, env: { ...env, TEST_MESSAGE: message }, encoding: 'utf8' },
    );
  return { root, git, write, check };
}

describe('shared commit policy', () => {
  it('defers review trailers to the actual message without suppressing file checks', () => {
    const f = fixture();
    f.write('src/widget.ts', 'export const value = 2;\n');
    f.git('add', '.');
    expect(f.check('files').status).toBe(0);
    const refused = f.check('message', 'change widget');
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain('Docs-Impact:');
    expect(
      f.check('all', 'Change: none, internal\nDocs-Impact: reviewed, widget contract unchanged')
        .status,
    ).toBe(0);
    f.write('README.md', 'See `src/missing-file.ts`.\n');
    f.git('add', '.');
    const broken = f.check('files');
    expect(broken.status).toBe(2);
    expect(broken.stderr).toContain('missing-file.ts');
  });

  it('checks pending IfChange waivers in commit-msg', () => {
    const f = fixture();
    f.write('a.ts', '// LINT.IfChange(value)\nconst a = 1;\n// LINT.ThenChange(b.ts:value)\n');
    f.write('b.ts', '// LINT.IfChange(value)\nconst b = 1;\n// LINT.ThenChange()\n');
    f.git('add', '.');
    f.git('commit', '-qm', 'pair');
    f.write('a.ts', '// LINT.IfChange(value)\nconst a = 2;\n// LINT.ThenChange(b.ts:value)\n');
    f.git('add', '.');
    expect(f.check('files').status).toBe(0);
    expect(f.check('message', 'update').stderr).toContain('LINT.IfChange blocks this commit');
    expect(f.check('message', 'update\nNO_IFTTT=the paired value remains valid').status).toBe(0);
  });

  it('requires a proposal or explanation from this pending message', () => {
    const f = fixture();
    f.write('docs/language-design.md', '**Rule 1.1.** A rule.\n');
    f.git('add', '.');
    const refused = f.check('message', 'edit rule');
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain('Change proposal');
    expect(f.check('message', 'Change: none, fixture instrumentation').status).toBe(0);
  });

  it('rejects malformed Claude input and leaves unrelated tool calls alone', () => {
    const run = (input: string) =>
      spawnSync('bun', [checker, '--hook'], { input, encoding: 'utf8' });
    expect(run('not JSON').status).toBe(2);
    expect(run('{"tool_input":{"command":42}}').status).toBe(2);
    expect(run('{"tool_input":{"command":"git status"}}').status).toBe(0);
  });
});
