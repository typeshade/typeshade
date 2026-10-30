// Prove that selecting a smaller suite still catches defects outside a recorded import graph.
// Vitest's node API runs in child processes, separate from the Vitest instance running this file.
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repository = resolve(import.meta.dirname, '..');
const selector = join(repository, 'scripts/affected-tests.ts');
const vitest = join(repository, 'node_modules/vitest/vitest.mjs');
const roots: string[] = [];
const env = { ...process.env };
for (const key of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'VITEST', 'VITEST_WORKER_ID'])
  delete env[key];

interface Selection {
  mode: 'full' | 'affected';
  reason: string;
  files: string[];
  total: number;
  changed: string[];
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'typeshade affected tests '));
  roots.push(root);
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.name', 'Affected test fixture');
  git('config', 'user.email', 'affected@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.autocrlf', 'false');
  git('config', 'core.hooksPath', join(root, 'no-hooks'));
  symlinkSync(join(repository, 'node_modules'), join(root, 'node_modules'), 'junction');
  write('.gitignore', 'node_modules\n.cache\n.vitest\n*.receipt\n');
  write('package.json', '{"type":"module","private":true}\n');
  write(
    'vitest.config.ts',
    `import { defineConfig } from 'vitest/config';
export default defineConfig({
  cacheDir: '.cache',
  test: { include: ['src/**/*.test.ts'], maxWorkers: 1, experimental: { recordDependencies: true } },
});
`,
  );
  for (const [file, text] of Object.entries(files)) write(file, text);
  const commit = () => {
    git('add', '.');
    git('commit', '--quiet', '-m', 'fixture revision');
    return git('rev-parse', 'HEAD');
  };
  const base = commit();
  const run = (command: string, args: string[], overrides: NodeJS.ProcessEnv = {}) =>
    spawnSync(command, args, {
      cwd: root,
      env: { ...env, ...overrides },
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 4 << 20,
    });
  const select = (options: { base?: string; typescript?: boolean } = { base }) => {
    const result = run('bun', [
      '-e',
      `import { selectTests } from ${JSON.stringify(pathToFileURL(selector).href)};
const result = await selectTests(${JSON.stringify({ root, config: join(root, 'vitest.config.ts'), ...options })});
console.log('SELECTION ' + JSON.stringify(result));`,
    ]);
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const line = result.stdout.split('\n').find((value) => value.startsWith('SELECTION '));
    expect(line, result.stdout).toBeDefined();
    return JSON.parse(line!.slice('SELECTION '.length)) as Selection;
  };
  const runSelected = (overrides: NodeJS.ProcessEnv = {}) =>
    run(
      'bun',
      [
        selector,
        '--root',
        root,
        '--config',
        join(root, 'vitest.config.ts'),
        '--base',
        base,
        '--run',
      ],
      overrides,
    );
  return { root, base, write, git, commit, select, run, runSelected };
}

const unrelated = `import { expect, it } from 'vitest';
it('unrelated', () => expect(1).toBe(1));\n`;

describe('affected test selection', () => {
  it('finds a conditional literal import that the last complete run never loaded', () => {
    const f = fixture({
      'src/optional.ts': 'export const value = 1;\n',
      'src/conditional path.test.ts': `import { expect, it } from 'vitest';
it('optional branch', async () => {
  if (process.env.USE_OPTIONAL === '1') expect((await import('./optional.js')).value).toBe(1);
});\n`,
      'src/unrelated.test.ts': unrelated,
    });
    const baseline = f.run('node', [vitest, 'run', '--root', f.root], { USE_OPTIONAL: '0' });
    expect(baseline.status, baseline.stderr).toBe(0);
    f.write('src/optional.ts', 'export const value = 2;\n');
    f.commit();
    const selected = f.select();
    expect(selected.mode).toBe('affected');
    expect(selected.files).toEqual(['src/conditional path.test.ts']);
    const result = f.runSelected({ USE_OPTIONAL: '1' });
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('expected 2 to be 1');
  });

  it('selects a newly added test without requiring dependency records', () => {
    const f = fixture({
      'src/value.ts': 'export const value = 1;\n',
      'src/unrelated.test.ts': unrelated,
    });
    f.write(
      'src/new.test.ts',
      `import { expect, it } from 'vitest'; import { value } from './value.js';
it('new', () => expect(value).toBe(1));\n`,
    );
    f.commit();
    expect(f.select().files).toEqual(['src/new.test.ts']);
  });

  it('keeps a filesystem reader when the changed input is not an imported module', () => {
    const f = fixture({
      'src/payload.ts': 'export const value = 1;\n',
      'src/reader.test.ts': `import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
it('file input', () => expect(readFileSync('src/payload.ts', 'utf8')).toContain('value = 1'));\n`,
      'src/unrelated.test.ts': unrelated,
    });
    f.write('src/payload.ts', 'export const value = 2;\n');
    f.commit();
    expect(f.select().files).toEqual(['src/reader.test.ts']);
    const result = f.runSelected();
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('value = 1');
  });

  it.each(['delete', 'rename'])('runs the full scope for a %s', (operation) => {
    const f = fixture({
      'src/value.ts': 'export const value = 1;\n',
      'src/uses-value.test.ts': `import { value } from './value.js';
import { expect, it } from 'vitest'; it('value', () => expect(value).toBe(1));\n`,
      'src/unrelated.test.ts': unrelated,
    });
    if (operation === 'delete') rmSync(join(f.root, 'src/value.ts'));
    else renameSync(join(f.root, 'src/value.ts'), join(f.root, 'src/renamed.ts'));
    f.commit();
    const selected = f.select();
    expect(selected.mode).toBe('full');
    expect(selected.files).toEqual(['src/unrelated.test.ts', 'src/uses-value.test.ts']);
  });

  it.each(['bun.lock', 'src/shader.shade.ts', 'unknown.txt'])(
    'runs the full scope for an unproven input: %s',
    (path) => {
      const f = fixture({ 'src/one.test.ts': unrelated, 'src/two.test.ts': unrelated });
      f.write(path, 'changed\n');
      f.commit();
      const selected = f.select();
      expect(selected.mode).toBe('full');
      expect(selected.files).toHaveLength(2);
    },
  );

  it('uses the full scope without a base, with a missing base, or with uncommitted edits', () => {
    const f = fixture({
      'src/value.ts': 'export const value = 1;\n',
      'src/one.test.ts': unrelated,
      'src/two.test.ts': unrelated,
    });
    expect(f.select({}).mode).toBe('full');
    expect(f.select({ base: 'refs/heads/missing-fixture-base' }).mode).toBe('full');
    f.write('src/value.ts', 'export const value = 2;\n');
    expect(f.select().mode).toBe('full');
  });

  it('does not turn an empty selection into an unfiltered Vitest run', () => {
    const f = fixture({
      'src/unobserved.ts': 'export const value = 1;\n',
      'src/must-not-run.test.ts': `throw new Error('unrelated test must not execute');\n`,
    });
    f.write('src/unobserved.ts', 'export const value = 2;\n');
    f.commit();
    const selected = f.select();
    expect(selected.mode).toBe('affected');
    expect(selected.files).toEqual([]);
    const result = f.runSelected();
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout + result.stderr).not.toContain('unrelated test must not execute');
  });

  it('fails back to the full scope when Vitest cannot load the selection configuration', () => {
    const f = fixture({
      'src/value.ts': 'export const value = 1;\n',
      'src/one.test.ts': unrelated,
      'src/two.test.ts': unrelated,
      'vitest.config.ts': `throw new Error('broken fixture configuration');\n`,
    });
    f.write('src/value.ts', 'export const value = 2;\n');
    f.commit();
    const selected = f.select();
    expect(selected.mode).toBe('full');
    expect(selected.files).toHaveLength(2);
    expect(selected.reason).toMatch(/config|selection|static|failed|error/i);
  });

  it('limits a TypeScript leg to its existing candidate scope', () => {
    const f = fixture({
      'src/value.ts': 'export const value = 1;\n',
      'src/compiler.test.ts': `import ts from 'typescript';
import { expect, it } from 'vitest';
it('parser', () => expect(ts.ScriptTarget.Latest).toBeDefined());\n`,
      'src/ordinary.test.ts': "throw new Error('non-TypeScript test must not execute');\n",
    });
    f.write('src/value.ts', 'export const value = 2;\n');
    f.commit();
    const selected = f.select({ base: f.base, typescript: true });
    expect(selected.files).toEqual(['src/compiler.test.ts']);
    const result = f.run('bun', [
      selector,
      '--root',
      f.root,
      '--config',
      join(f.root, 'vitest.config.ts'),
      '--typescript',
      '--run',
    ]);
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout + result.stderr).not.toContain('non-TypeScript test must not execute');
  });

  it.each(['config dependency', 'setupFiles', 'globalSetup'])(
    'retains every project when a %s source changes',
    (kind) => {
      const configImport =
        kind === 'config dependency' ? "import value from './src/input.js';" : '';
      const testOptions =
        kind === 'config dependency' ? 'testTimeout: value,' : `${kind}: ['./src/input.ts'],`;
      const before =
        kind === 'config dependency' ? 'export default 5000;\n' : 'export default () => {};\n';
      const after =
        kind === 'config dependency'
          ? 'export default 6000;\n'
          : 'export default () => undefined;\n';
      const f = fixture({
        'src/input.ts': before,
        'src/value.ts': 'export const value = 1;\n',
        'src/shared.test.ts': `import { expect, inject, it } from 'vitest';
import { value } from './value.js';
it('shared', () => { expect(value).toBe(1); expect(inject('scope')).toBe('shared'); });\n`,
        'src/mocked.test.ts': `import { expect, inject, it, vi } from 'vitest';
import { value } from './value.js';
vi.mock('./value.js', () => ({ value: 2 }));
it('mocked', () => { expect(value).toBe(2); expect(inject('scope')).toBe('mocks'); });\n`,
        'vitest.config.ts': `import { defineConfig } from 'vitest/config';
${configImport}
export default defineConfig({ cacheDir: '.cache', test: {
  ${testOptions}
  maxWorkers: 1,
  experimental: { recordDependencies: true },
  projects: [
    { extends: true, test: { name: 'shared', include: ['src/shared.test.ts'], isolate: false, provide: { scope: 'shared' } } },
    { extends: true, test: { name: 'mocks', include: ['src/mocked.test.ts'], isolate: true, provide: { scope: 'mocks' } } },
  ],
}});\n`,
      });
      f.write('src/input.ts', after);
      f.commit();
      const selected = f.select();
      expect(selected.mode).toBe('full');
      expect(selected.files).toEqual(['src/mocked.test.ts', 'src/shared.test.ts']);
      if (kind === 'config dependency') {
        const result = f.runSelected();
        expect(result.error, result.stderr).toBeUndefined();
        expect(result.status, result.stdout + result.stderr).toBe(0);
      }
    },
  );

  it('keeps every test when a setup file reads the changed input outside the import graph', () => {
    const reader = `import { expect, it } from 'vitest';
it('setup input', () => expect(globalThis.fixtureInput).toContain('value = 1'));\n`;
    const f = fixture({
      'src/payload.ts': 'export const value = 1;\n',
      'src/setup.ts': `import { readFileSync } from 'node:fs';
globalThis.fixtureInput = readFileSync('src/payload.ts', 'utf8');\n`,
      'src/one.test.ts': reader,
      'src/two.test.ts': reader,
      'vitest.config.ts': `import { defineConfig } from 'vitest/config';
export default defineConfig({ cacheDir: '.cache', test: {
  include: ['src/**/*.test.ts'], maxWorkers: 1, setupFiles: ['./src/setup.ts'],
  experimental: { recordDependencies: true },
}});\n`,
    });
    f.write('src/payload.ts', 'export const value = 2;\n');
    f.commit();
    const selected = f.select();
    expect(selected.mode).toBe('full');
    expect(selected.files).toEqual(['src/one.test.ts', 'src/two.test.ts']);
    const result = f.runSelected();
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('value = 1');
  });
});
