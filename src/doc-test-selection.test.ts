// A path contract may exclude a document reader only while its audited code stays the same.
// The failure arm runs the selected files in Vitest, so a broken document must still be caught.
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  CONTROL_FILES,
  fingerprint,
  selectDocuments,
  type DocumentContract,
} from '../scripts/doc-test-selection.js';

const repository = resolve(import.meta.dirname, '..');
const roots: string[] = [];
const env = { ...process.env };
for (const key of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'VITEST', 'VITEST_WORKER_ID'])
  delete env[key];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const config = `import { defineConfig } from 'vitest/config';
export default defineConfig({ cacheDir: '.cache', test: { include: ['src/**/*.test.ts'], maxWorkers: 1 } });
`;
const reader = `import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { expected } from './bridge.js';
it('reads the document', () => expect(readFileSync('docs/input.md', 'utf8').trim()).toBe(expected));
`;
const unknownReader = `import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('unregistered document input', () => expect(readFileSync('notes/other.md', 'utf8').trim()).toBe('valid'));
`;

function fixture(files: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'typeshade document contracts '));
  roots.push(root);
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  execFileSync('git', ['init', '--quiet'], { cwd: root, env, stdio: 'pipe' });
  for (const file of CONTROL_FILES)
    write(file, file.endsWith('.ts') ? 'export {};\n' : 'fixture baseline\n');
  write('package.json', '{"type":"module","private":true}\n');
  write('tsconfig.json', '{}\n');
  write('tsconfig.base.json', '{}\n');
  write('tsconfig.tests.json', '{}\n');
  write('vitest.config.ts', config);
  write('.gitignore', 'node_modules\n.cache\n.vitest\n');
  write('src/reader.test.ts', reader);
  write('src/bridge.ts', "export { expected } from './expected.js';\n");
  write('src/expected.ts', "export const expected = 'valid';\n");
  write('src/unregistered.test.ts', unknownReader);
  write(
    'src/pure.test.ts',
    "import { expect, it } from 'vitest'; it('pure', () => expect(1).toBe(1));\n",
  );
  write('docs/input.md', 'valid\n');
  write('notes/other.md', 'valid\n');
  for (const [file, text] of Object.entries(files)) write(file, text);
  symlinkSync(join(repository, 'node_modules'), join(root, 'node_modules'), 'junction');
  const contract = (
    test = 'src/reader.test.ts',
    inputs = ['docs/input.md'],
    sources: string[] = [],
  ): DocumentContract => ({
    test,
    inputs,
    sources,
    fingerprint: fingerprint(root, test, inputs, sources),
  });
  const run = (files: string[]) => {
    return spawnSync(
      'node',
      [
        join(repository, 'node_modules/vitest/vitest.mjs'),
        'run',
        ...files.map((file) => join(root, file)),
      ],
      { cwd: root, env, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 << 20 },
    );
  };
  return { root, write, contract, run };
}

describe('reviewed document input contracts', () => {
  it('shares audited helpers within a selection but rereads them on the next call', () => {
    const f = fixture({ 'src/second.test.ts': reader });
    const contracts = [f.contract(), f.contract('src/second.test.ts')];
    const before = selectDocuments(f.root, ['notes/other.md'], contracts);
    expect(before.scoped).toEqual(['src/reader.test.ts', 'src/second.test.ts']);
    expect(before.files).toEqual(['src/unregistered.test.ts']);
    f.write('src/expected.ts', "export const expected = 'changed';\n");
    const after = selectDocuments(f.root, ['notes/other.md'], contracts);
    expect(after.scoped).toEqual([]);
    expect(after.fallback).toContain('src/reader.test.ts');
    expect(after.fallback).toContain('src/second.test.ts');
  });

  it('narrows only the registered reader and keeps unregistered document tests', () => {
    const f = fixture();
    const contract = f.contract();
    const unrelated = selectDocuments(f.root, ['notes/other.md'], [contract]);
    expect(unrelated.total).toBe(2);
    expect(unrelated.files).toEqual(['src/unregistered.test.ts']);
    expect(unrelated.scoped).toContain(contract.test);
    const changed = selectDocuments(f.root, ['docs/input.md'], [contract]);
    expect(changed.files).toEqual(['src/reader.test.ts', 'src/unregistered.test.ts']);
  });

  it('keeps the contract stable when only document contents or unrelated source change', () => {
    const f = fixture();
    const before = f.contract();
    f.write('docs/input.md', 'a different document\n');
    f.write('src/unrelated.ts', 'export const unrelated = 2;\n');
    expect(fingerprint(f.root, before.test, before.inputs)).toBe(before.fingerprint);
    expect(selectDocuments(f.root, ['notes/other.md'], [before]).files).toEqual([
      'src/unregistered.test.ts',
    ]);
  });

  it.each(['src/reader.test.ts', 'src/bridge.ts', 'src/expected.ts'])(
    'keeps the reader after audited test or transitive source drift: %s',
    (file) => {
      const f = fixture();
      const contract = f.contract();
      // Preserve the filesystem import in the entry so it remains in the existing candidate set.
      f.write(
        file,
        file === contract.test
          ? `${reader}\n// changed audit baseline\n`
          : 'export const expected = 2;\n',
      );
      expect(fingerprint(f.root, contract.test, contract.inputs)).not.toBe(contract.fingerprint);
      const selected = selectDocuments(f.root, ['notes/other.md'], [contract]);
      expect(selected.files).toContain(contract.test);
      expect(selected.fallback.length).toBeGreaterThan(0);
    },
  );

  it.each(['package.json', 'bun.lock', 'vitest.config.ts', '.node-version'])(
    'invalidates the contract when a control changes: %s',
    (file) => {
      const f = fixture();
      const contract = f.contract();
      f.write(file, file.endsWith('.ts') ? `${config}\n// changed control\n` : 'changed control\n');
      const selected = selectDocuments(f.root, ['notes/other.md'], [contract]);
      expect(selected.files).toContain(contract.test);
      expect(selected.fallback.length).toBeGreaterThan(0);
    },
  );

  it('keeps a stale registered reader after its filesystem access leaves the basic classifier', () => {
    const f = fixture();
    const contract = f.contract();
    f.write(
      contract.test,
      `import { expect, it } from 'vitest';
const { readFileSync } = process.getBuiltinModule('fs');
it('reads a new document indirectly', () => expect(readFileSync('notes/other.md', 'utf8').trim()).toBe('valid'));
`,
    );
    expect(fingerprint(f.root, contract.test, contract.inputs)).not.toBe(contract.fingerprint);
    const selected = selectDocuments(f.root, ['notes/other.md'], [contract]);
    expect(selected.files).toContain(contract.test);
    expect(selected.fallback).toContain(contract.test);
  });

  it.each(['src/expected.ts', 'bun.lock'])(
    'keeps the reader when a dependency or control is missing: %s',
    (file) => {
      const f = fixture();
      const contract = f.contract();
      rmSync(join(f.root, file));
      const selected = selectDocuments(f.root, ['notes/other.md'], [contract]);
      expect(selected.files).toContain(contract.test);
      expect(selected.fallback.length).toBeGreaterThan(0);
    },
  );

  it('invalidates the contract when a transitive control dependency changes', () => {
    const f = fixture({
      'scripts/doc-tests.ts': "export { marker } from './control-helper.js';\n",
      'scripts/control-helper.ts': 'export const marker = 1;\n',
    });
    const contract = f.contract();
    f.write('scripts/control-helper.ts', 'export const marker = 2;\n');
    const selected = selectDocuments(f.root, ['notes/other.md'], [contract]);
    expect(selected.files).toContain(contract.test);
    expect(selected.fallback.length).toBeGreaterThan(0);
  });

  it('keeps the reader when a new JavaScript file can shadow a resolved TypeScript dependency', () => {
    const f = fixture();
    const contract = f.contract();
    f.write('src/expected.js', "export const expected = 'changed resolution';\n");
    const selected = selectDocuments(f.root, ['notes/other.md'], [contract]);
    expect(selected.files).toContain(contract.test);
    expect(selected.fallback.length).toBeGreaterThan(0);
  });

  it('matches only direct children of a reviewed directory pattern', () => {
    const f = fixture();
    const contract = f.contract('src/reader.test.ts', ['docs/*.md']);
    expect(selectDocuments(f.root, ['docs/new.md'], [contract]).files).toContain(contract.test);
    expect(selectDocuments(f.root, ['docs/nested/new.md'], [contract]).files).not.toContain(
      contract.test,
    );
    expect(selectDocuments(f.root, ['docs/input.txt'], [contract]).files).not.toContain(
      contract.test,
    );
    expect(selectDocuments(f.root, ['other-docs/new.md'], [contract]).files).not.toContain(
      contract.test,
    );
  });

  it('keeps the reader for added, removed and renamed document inputs', () => {
    const f = fixture();
    const contract = f.contract('src/reader.test.ts', ['docs/*.md']);
    f.write('docs/new.md', 'valid\n');
    expect(selectDocuments(f.root, ['docs/new.md'], [contract]).files).toContain(contract.test);
    rmSync(join(f.root, 'docs/new.md'));
    expect(selectDocuments(f.root, ['docs/new.md'], [contract]).files).toContain(contract.test);
    renameSync(join(f.root, 'docs/input.md'), join(f.root, 'notes/moved.md'));
    expect(
      selectDocuments(f.root, ['docs/input.md', 'notes/moved.md'], [contract]).files,
    ).toContain(contract.test);
  });

  it.each([
    { inputs: [] },
    { inputs: ['docs/**/*.md'] },
    { inputs: ['../outside.md'] },
    { inputs: ['docs/input.md'], fingerprint: 'invalid' },
  ])('keeps the candidate when its contract is malformed: %j', (override) => {
    const f = fixture();
    const contract = { ...f.contract(), ...override };
    if (override.fingerprint === undefined)
      expect(() => fingerprint(f.root, contract.test, contract.inputs)).toThrow();
    expect(selectDocuments(f.root, ['notes/other.md'], [contract]).files).toContain(contract.test);
  });

  it('does not let conflicting duplicate contracts exclude a reader', () => {
    const f = fixture();
    const contract = f.contract();
    const duplicate = f.contract('src/reader.test.ts', ['notes/other.md']);
    const selected = selectDocuments(f.root, ['README.md'], [contract, duplicate]);
    expect(selected.files).toContain(contract.test);
    expect(selected.fallback.length).toBeGreaterThan(0);
  });

  it('keeps the reader when its input mapping changes without a new audit fingerprint', () => {
    const f = fixture();
    const contract = { ...f.contract(), inputs: ['docs/different.md'] };
    const selected = selectDocuments(f.root, ['docs/input.md'], [contract]);
    expect(selected.files).toContain(contract.test);
    expect(selected.fallback.length).toBeGreaterThan(0);
  });

  it('includes declared filesystem data dependencies in the audit fingerprint', () => {
    const f = fixture({ 'data/readers.json': '{"document":"docs/input.md"}\n' });
    const contract = f.contract('src/reader.test.ts', ['docs/input.md'], ['data/readers.json']);
    f.write('data/readers.json', '{"document":"notes/other.md"}\n');
    const selected = selectDocuments(f.root, ['notes/other.md'], [contract]);
    expect(selected.files).toContain(contract.test);
    expect(selected.fallback.length).toBeGreaterThan(0);
  });

  it('keeps the reader when its declared filesystem data dependency is missing', () => {
    const f = fixture({ 'data/readers.json': '{"document":"docs/input.md"}\n' });
    const contract = f.contract('src/reader.test.ts', ['docs/input.md'], ['data/readers.json']);
    rmSync(join(f.root, 'data/readers.json'));
    const selected = selectDocuments(f.root, ['notes/other.md'], [contract]);
    expect(selected.files).toContain(contract.test);
    expect(selected.fallback.length).toBeGreaterThan(0);
  });

  it('guards relative imports from declared TypeScript data sources', () => {
    const f = fixture({
      'data/input.shade.ts': "export { marker } from './dependency.js';\n",
      'data/dependency.ts': 'export const marker = 1;\n',
    });
    const contract = f.contract('src/reader.test.ts', ['docs/input.md'], ['data/input.shade.ts']);
    f.write('data/dependency.ts', 'export const marker = 2;\n');
    const selected = selectDocuments(f.root, ['notes/other.md'], [contract]);
    expect(selected.files).toContain(contract.test);
    expect(selected.fallback.length).toBeGreaterThan(0);
  });

  it('keeps the reader when its source declaration changes without a new audit fingerprint', () => {
    const f = fixture({ 'data/readers.json': '{"document":"docs/input.md"}\n' });
    const contract = f.contract('src/reader.test.ts', ['docs/input.md'], ['data/readers.json']);
    const selected = selectDocuments(f.root, ['README.md'], [{ ...contract, sources: [] }]);
    expect(selected.files).toContain(contract.test);
    expect(selected.fallback.length).toBeGreaterThan(0);
  });

  it('rejects a source declaration outside the repository without dropping the reader', () => {
    const f = fixture();
    const contract = { ...f.contract(), sources: ['../outside.json'] };
    expect(() => fingerprint(f.root, contract.test, contract.inputs, contract.sources)).toThrow();
    expect(selectDocuments(f.root, ['README.md'], [contract]).files).toContain(contract.test);
  });

  it('keeps the reader when a document input is a symbolic link', () => {
    const f = fixture();
    const contract = f.contract();
    rmSync(join(f.root, 'docs/input.md'));
    symlinkSync('../notes/other.md', join(f.root, 'docs/input.md'));
    const selected = selectDocuments(f.root, ['notes/other.md'], [contract]);
    expect(selected.files).toContain(contract.test);
    expect(selected.fallback.length).toBeGreaterThan(0);
  });

  it('keeps the reader when an imported source gains a symbolic-link ancestor', () => {
    const f = fixture({
      'src/reader.test.ts': `import { expect, it } from 'vitest';
import { document } from './case/helper.js';
it('reads the document relative to its helper', () => expect(document.trim()).toBe('valid'));
`,
      'src/case/helper.ts': `import { readFileSync } from 'node:fs';
export const document = readFileSync(new URL('../../docs/input.md', import.meta.url), 'utf8');
`,
    });
    const contract = f.contract();
    mkdirSync(join(f.root, 'alternate/nested'), { recursive: true });
    renameSync(join(f.root, 'src/case'), join(f.root, 'alternate/nested/case'));
    symlinkSync('../alternate/nested/case', join(f.root, 'src/case'), 'dir');
    f.write('alternate/docs/input.md', 'planted document fault\n');
    // Identical helper bytes now have a different import.meta.url after realpath resolution.
    // Inspecting only the leaf file would preserve its digest and omit this document change.
    expect(() => fingerprint(f.root, contract.test, contract.inputs)).toThrow();
    const selected = selectDocuments(f.root, ['alternate/docs/input.md'], [contract]);
    expect(selected.files).toContain(contract.test);
    expect(selected.fallback).toContain(contract.test);
  });

  it.each(['', '/a/different/document/root'])(
    'keeps the reader when the document root is overridden with %j',
    (root) => {
      const f = fixture();
      const contract = f.contract();
      const previous = process.env.TYPESHADE_DOCS_ROOT;
      try {
        process.env.TYPESHADE_DOCS_ROOT = root;
        const selected = selectDocuments(f.root, ['notes/other.md'], [contract]);
        expect(selected.files).toContain(contract.test);
        expect(selected.fallback.length).toBeGreaterThan(0);
      } finally {
        if (previous === undefined) delete process.env.TYPESHADE_DOCS_ROOT;
        else process.env.TYPESHADE_DOCS_ROOT = previous;
      }
    },
  );

  it('keeps all document readers when no contracts are supplied', () => {
    const f = fixture();
    expect(selectDocuments(f.root, ['README.md'], []).files).toEqual([
      'src/reader.test.ts',
      'src/unregistered.test.ts',
    ]);
  });

  it('keeps readers when Node options can load an unaudited preload', () => {
    const f = fixture();
    const contract = f.contract();
    const previous = process.env.NODE_OPTIONS;
    try {
      process.env.NODE_OPTIONS = '--import ./preload.js';
      expect(selectDocuments(f.root, ['notes/other.md'], [contract]).fallback).toContain(
        contract.test,
      );
    } finally {
      if (previous === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previous;
    }
  });

  it('selects a broken document and catches its failure through Vitest with a spaced path', () => {
    const file = 'src/reader with spaces.test.ts';
    const f = fixture({
      [file]: reader.replace('docs/input.md', 'docs/input with spaces.md'),
      'docs/input with spaces.md': 'valid\n',
    });
    const contract = f.contract(file, ['docs/input with spaces.md']);
    const baseline = f.run(
      selectDocuments(f.root, ['docs/input with spaces.md'], [contract]).files,
    );
    expect(baseline.error, baseline.stderr).toBeUndefined();
    expect(baseline.status, baseline.stdout + baseline.stderr).toBe(0);
    f.write('docs/input with spaces.md', 'planted document fault\n');
    const selected = selectDocuments(f.root, ['docs/input with spaces.md'], [contract]);
    expect(selected.files).toContain(file);
    const result = f.run(selected.files);
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('planted document fault');
  });
});
