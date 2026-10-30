// Prove that selecting a smaller suite still catches defects outside a recorded import graph.
// Vitest's node API runs in child processes, separate from the Vitest instance running this file.
// Document plans use the local API; CLI probes still execute their real child processes.
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONTROL_FILES, fingerprint } from '../scripts/doc-test-selection.js';
import { selectTests } from '../scripts/affected-tests.js';

const repository = resolve(import.meta.dirname, '..');
const selector = join(repository, 'scripts/affected-tests.ts');
const vitest = join(repository, 'node_modules/vitest/vitest.mjs');
const roots: string[] = [];
const gitContext = ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE'] as const;
const env = { ...process.env };
for (const key of [...gitContext, 'VITEST', 'VITEST_WORKER_ID']) delete env[key];

interface Selection {
  mode: 'full' | 'affected';
  reason: string;
  files: string[];
  total: number;
  changed: string[];
}

interface FixtureSelectionOptions {
  base?: string;
  typescript?: boolean;
  documents?: boolean;
  config?: string;
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
  test: {
    include: ['src/**/*.test.ts'], maxWorkers: 1,
    // Dependencies are shared through a symlink; transformed-module caches are fixture-local.
    fsModuleCachePath: '.cache/vitest-modules',
    experimental: { recordDependencies: true },
  },
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
  const request = (options: FixtureSelectionOptions = { base }) =>
    run('bun', [
      '-e',
      `import { selectTests } from ${JSON.stringify(pathToFileURL(selector).href)};
const result = await selectTests(${JSON.stringify({ root, ...(options.documents ? {} : { config: join(root, 'vitest.config.ts') }), ...options })});
console.log('SELECTION ' + JSON.stringify(result));`,
    ]);
  const select = (options: FixtureSelectionOptions = { base }) => {
    const result = request(options);
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
  return { root, base, write, git, commit, request, select, run, runSelected };
}

const unrelated = `import { expect, it } from 'vitest';
it('unrelated', () => expect(1).toBe(1));\n`;

const documentReader = 'src/document reader with spaces.test.ts';
const unregisteredReader = 'src/unregistered.test.ts';
const documentFiles = [documentReader, unregisteredReader];
const allDocumentFixtureFiles = [
  documentReader,
  'src/unrelated.test.ts',
  unregisteredReader,
].sort();

function documentFixture(
  files: Record<string, string> = {},
  inputs = ['docs/input with spaces.md'],
  includeUnregistered = true,
) {
  const controls = Object.fromEntries(
    CONTROL_FILES.filter((file) => file !== 'package.json' && file !== 'vitest.config.ts').map(
      (file) => [file, file.endsWith('.ts') ? 'export {};\n' : '{}\n'],
    ),
  );
  const reader = (path: string) => `import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
it('document input', () => expect(readFileSync(${JSON.stringify(path)}, 'utf8').trim()).toBe('valid'));\n`;
  const f = fixture({
    ...controls,
    [documentReader]: reader('docs/input with spaces.md'),
    ...(includeUnregistered ? { [unregisteredReader]: reader('notes/other.md') } : {}),
    'src/unrelated.test.ts': unrelated,
    'docs/input with spaces.md': 'valid\n',
    'notes/other.md': 'valid\n',
    ...files,
  });
  f.write(
    'scripts/doc-test-inputs.json',
    JSON.stringify([
      { test: documentReader, inputs, fingerprint: fingerprint(f.root, documentReader, inputs) },
    ]),
  );
  const base = f.commit();
  const select = async (
    options: Omit<FixtureSelectionOptions, 'documents' | 'typescript'> = {},
  ) => {
    // Document selection returns before Vitest's node API. Keep the child helper when the
    // caller has a Git context, since it strips that context without changing this worker.
    if (gitContext.some((key) => process.env[key] !== undefined))
      return f.select({ base, documents: true, ...options });
    return selectTests({ root: f.root, base, documents: true, ...options });
  };
  const runDocuments = (withBase = true) =>
    f.run('bun', [
      selector,
      '--root',
      f.root,
      '--documents',
      ...(withBase ? ['--base', base] : []),
      '--run',
    ]);
  return { ...f, base, select, runDocuments };
}

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
  fsModuleCachePath: '.cache/vitest-modules',
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
  fsModuleCachePath: '.cache/vitest-modules',
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

describe('document selection through the affected-test entry point', () => {
  it('keeps the no-base document scope and propagates a selected document failure through the CLI', async () => {
    const f = documentFixture({
      'src/unrelated.test.ts': "throw new Error('non-document test must not execute');\n",
    });
    const baseline = await f.select({ base: undefined });
    expect(baseline.mode).toBe('full');
    expect(baseline.files).toEqual(documentFiles);
    const initialRun = f.runDocuments(false);
    expect(initialRun.error, initialRun.stderr).toBeUndefined();
    expect(initialRun.status, initialRun.stdout + initialRun.stderr).toBe(0);
    f.write('docs/input with spaces.md', 'planted document fault\n');
    f.commit();
    expect((await f.select()).files).toEqual(documentFiles);
    const failingRun = f.runDocuments();
    expect(failingRun.error, failingRun.stderr).toBeUndefined();
    expect(failingRun.status).not.toBe(0);
    expect(failingRun.stdout + failingRun.stderr).toContain('planted document fault');
    expect(failingRun.stdout + failingRun.stderr).not.toContain(
      'non-document test must not execute',
    );
  });

  it.each(['README.md', 'docs/nested/page.md', 'reqs/RULE001.yml', 'reqs/nested/.doorstop.yml'])(
    'uses the reviewed document scope for a CI document input: %s',
    async (file) => {
      const f = documentFixture();
      f.write(file, 'changed document input\n');
      f.commit();
      const selected = await f.select();
      expect(selected.mode).toBe('affected');
      expect(selected.total).toBe(2);
      expect(selected.files).toEqual([unregisteredReader]);
      expect(selected.changed).toContain(file);
    },
  );

  it.each(['src/notes.md', 'docs/config.yml', 'README.MD', '.github/workflows/check.yml'])(
    'retains the full unit scope when a document diff also includes %s',
    async (file) => {
      const f = documentFixture();
      f.write('README.md', 'changed documentation\n');
      f.write(file, 'changed non-document input\n');
      f.commit();
      const selected = await f.select();
      expect(selected.mode).toBe('full');
      expect(selected.files).toEqual(allDocumentFixtureFiles);
    },
  );

  it.each(['dirty', 'missing base'])(
    'retains every unit test when a document selection has a %s boundary',
    async (boundary) => {
      const f = documentFixture();
      f.write('README.md', 'changed documentation\n');
      if (boundary === 'missing base') f.commit();
      const selected = await f.select(
        boundary === 'missing base' ? { base: 'refs/heads/missing-document-base' } : {},
      );
      expect(selected.mode).toBe('full');
      expect(selected.files).toEqual(allDocumentFixtureFiles);
    },
  );

  it.each([false, true])(
    'retains every unit test for a custom document configuration (base: %s)',
    async (withBase) => {
      const f = documentFixture();
      f.write('README.md', 'changed documentation\n');
      f.commit();
      const selected = await f.select({
        base: withBase ? f.base : undefined,
        config: join(f.root, 'vitest.config.ts'),
      });
      expect(selected.mode).toBe('full');
      expect(selected.files).toEqual(allDocumentFixtureFiles);
    },
  );

  it.each(['add', 'delete', 'rename'])(
    'retains a directory reader for a document %s without broadening to unrelated unit tests',
    async (operation) => {
      const f = documentFixture({}, ['docs/*.md']);
      const original = 'docs/input with spaces.md';
      if (operation === 'add') f.write('docs/new page.md', 'new document\n');
      else if (operation === 'delete') rmSync(join(f.root, original));
      else renameSync(join(f.root, original), join(f.root, 'notes/moved page.md'));
      f.commit();
      const selected = await f.select();
      expect(selected.total).toBe(2);
      expect(selected.files).toEqual(documentFiles);
      if (operation === 'rename') {
        expect(selected.changed).toContain(original);
        expect(selected.changed).toContain('notes/moved page.md');
      }
    },
  );

  it.each(['into documents', 'out of documents'])(
    'checks both sides of a rename %s before narrowing the unit scope',
    async (direction) => {
      const f = documentFixture({ 'src/value.ts': 'export const value = 1;\n' });
      const [from, to] =
        direction === 'into documents'
          ? ['src/value.ts', 'docs/value.md']
          : ['docs/input with spaces.md', 'src/moved.md'];
      renameSync(join(f.root, from!), join(f.root, to!));
      f.commit();
      const selected = await f.select();
      expect(selected.mode).toBe('full');
      expect(selected.files).toEqual(allDocumentFixtureFiles);
      expect(selected.changed).toContain(from);
      expect(selected.changed).toContain(to);
    },
  );

  it('rejects combined document and TypeScript selection in both the API and CLI', () => {
    const f = documentFixture();
    const api = f.request({ documents: true, typescript: true });
    const cli = f.run('bun', [selector, '--root', f.root, '--documents', '--typescript']);
    for (const result of [api, cli]) {
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(result.stdout + result.stderr).toMatch(/cannot be combined/);
    }
  });

  it('does not execute an unfiltered suite when every audited document reader is unrelated', async () => {
    const f = documentFixture(
      { 'src/unrelated.test.ts': "throw new Error('unrelated unit test must not execute');\n" },
      ['docs/input with spaces.md'],
      false,
    );
    f.write('README.md', 'an unrelated document\n');
    f.commit();
    const selected = await f.select();
    expect(selected.files).toEqual([]);
    expect(selected.total).toBe(1);
    const result = f.runDocuments();
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stderr).toContain('0/1 files (affected)');
    expect(result.stdout + result.stderr).not.toContain('unrelated unit test must not execute');
  });
});
