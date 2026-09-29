// The `tshc` command over an in-memory host: argument handling, the directory walk and
// the exit status. One test runs the real Node host (`bin.ts`) end to end.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, USAGE, type CliHost } from './run.js';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const GOOD = `"use typeshade";
export function f(x: f32): f32 {
  return x * 2.;
}
`;
const BAD = `"use typeshade";
export function f(x: f32): f32 {
  return colr;
}
`;

/** A host over `files` (absolute path → text); directories are implied by the paths. */
function memoryHost(files: Record<string, string>, cwd = '/p') {
  const out: string[] = [];
  const err: string[] = [];
  const host: CliHost = {
    cwd,
    readFile: (path) => files[path],
    writeFile: (path, text) => void (files[path] = text),
    kind(path) {
      if (files[path] !== undefined) return 'file';
      return Object.keys(files).some((f) => f.startsWith(`${path}/`)) ? 'directory' : undefined;
    },
    list(path) {
      const names = new Set<string>();
      for (const f of Object.keys(files))
        if (f.startsWith(`${path}/`)) names.add(f.slice(path.length + 1).split('/')[0]!);
      return [...names];
    },
    stdout: (text) => void out.push(text),
    stderr: (text) => void err.push(text),
  };
  return { host, out, err, stdout: () => out.join(''), stderr: () => err.join('') };
}

const run = (argv: string[], files: Record<string, string>, cwd?: string) => {
  const m = memoryHost(files, cwd);
  const status = runCli(argv, m.host, { version: '9.9.9' });
  return { status, stdout: m.stdout(), stderr: m.stderr() };
};

describe('tshc (command line)', () => {
  it('exits 0 on a clean tree and 1 when an error is found', () => {
    expect(run(['check'], { '/p/src/a.shade.ts': GOOD })).toMatchObject({
      status: 0,
      stdout: 'No problems found in 1 file.\n',
    });
    const bad = run(['check', '--format', 'short'], {
      '/p/src/a.shade.ts': GOOD,
      '/p/src/b.shade.ts': BAD,
    });
    expect(bad.status).toBe(1);
    expect(bad.stdout).toBe(
      [
        'src/b.shade.ts:3:10 - error TS8022: Unknown identifier "colr".',
        'Found 1 error in 1 file (2 files checked).',
        '',
      ].join('\n'),
    );
  });

  it('walks directories for *.shade.ts, skipping node_modules, dist and .git', () => {
    const files = {
      '/p/src/a.shade.ts': GOOD,
      '/p/src/nested/deep/b.shade.ts': GOOD,
      '/p/src/helper.ts': BAD,
      '/p/node_modules/pkg/c.shade.ts': BAD,
      '/p/dist/d.shade.ts': BAD,
      '/p/.git/e.shade.ts': BAD,
    };
    expect(run(['check'], files)).toMatchObject({
      status: 0,
      stdout: 'No problems found in 2 files.\n',
    });
    // A file named on the command line is checked whatever its name.
    expect(run(['check', 'src/helper.ts', '--format=short'], files).status).toBe(1);
  });

  it("checks a module that imports a package's shader module, and the package's files once each", () => {
    const files = {
      '/p/node_modules/shade-lib/package.json': JSON.stringify({
        name: 'shade-lib',
        version: '1.0.0',
        exports: { '.': { typeshade: './src/index.shade.ts' } },
      }),
      '/p/node_modules/shade-lib/src/index.shade.ts': `"use typeshade";\nexport { f } from "./f.shade.ts";\n`,
      '/p/node_modules/shade-lib/src/f.shade.ts': GOOD,
      '/p/src/a.shade.ts': `"use typeshade";\nimport { f } from "shade-lib";\nexport function g(x: f32): f32 {\n  return f(x);\n}\n`,
    };
    expect(run(['check'], files)).toMatchObject({
      status: 0,
      stdout: 'No problems found in 3 files.\n',
    });
    const refused = run(['check', '--format', 'short'], {
      ...files,
      '/p/src/a.shade.ts': `"use typeshade";\nimport { f } from "shade-lib/f";\nexport function g(x: f32): f32 {\n  return f(x);\n}\n`,
    });
    expect(refused.status).toBe(1);
    expect(refused.stdout).toBe(
      [
        'src/a.shade.ts:2:19 - error TS8072: "shade-lib" does not export "./f": its package.json "exports" names no module for it.',
        'Found 1 error in 1 file (1 file checked).',
        '',
      ].join('\n'),
    );
  });

  it('resolves paths on a Windows drive: relative, D:/ and D:\\ arguments, imports and sync (#384)', () => {
    // bin.ts hands runCli the working directory with slashes, D:/work; a path there keeps its
    // drive, where it once became /D:/work, which names nothing on Windows.
    const files = {
      'D:/work/src/a.shade.ts': `"use typeshade";\nimport { f } from "./lib/f.shade.ts";\nexport function g(x: f32): f32 {\n  return f(x);\n}\n`,
      'D:/work/src/lib/f.shade.ts': GOOD,
    };
    const clean = { status: 0, stdout: 'No problems found in 2 files.\n' };
    for (const given of [
      'src',
      'src/',
      'src\\',
      'D:/work/src',
      'D:\\work\\src',
      'd:/work/src',
      '/work/src',
    ])
      expect(run(['check', given], files, 'D:/work'), given).toMatchObject(clean);
    expect(run(['check'], files, 'D:/work')).toMatchObject(clean);
    // A drive's letter is one drive whatever its case, and paths print relative to it.
    const bad = run(
      ['check', '--format', 'short', 'src\\lib'],
      { ...files, 'D:/work/src/lib/b.shade.ts': BAD },
      'd:/work',
    );
    expect(bad.status).toBe(1);
    expect(bad.stdout).toBe(
      [
        'src/lib/b.shade.ts:3:10 - error TS8022: Unknown identifier "colr".',
        'Found 1 error in 1 file (2 files checked).',
        '',
      ].join('\n'),
    );
    expect(run(['check', 'D:\\elsewhere'], files, 'D:/work')).toMatchObject({
      status: 2,
      stderr: 'tshc: no file or directory at D:\\elsewhere.\n',
    });

    const m = memoryHost({ 'D:/work/src/lib/f.shade.ts': GOOD }, 'D:/work');
    expect(runCli(['sync', 'src'], m.host, { version: '9.9.9' })).toBe(0);
    expect(m.stdout()).toBe(
      'wrote src/lib/f.shade.typeshade.ts\n1 host view written, 0 up to date.\n',
    );
    expect(runCli(['sync', '--check', 'D:\\work\\src'], m.host, { version: '9.9.9' })).toBe(0);
  });

  it('keeps a backslash in a name off a drive, as POSIX does', () => {
    expect(run(['check', 'we\\ird.shade.ts'], { '/p/we\\ird.shade.ts': GOOD })).toMatchObject({
      status: 0,
      stdout: 'No problems found in 1 file.\n',
    });
  });

  it('exits 2 when it cannot run, and says why', () => {
    expect(run(['check', 'nope'], { '/p/a.shade.ts': GOOD })).toMatchObject({
      status: 2,
      stderr: 'tshc: no file or directory at nope.\n',
    });
    expect(run(['check'], { '/p/readme.md': '' })).toMatchObject({
      status: 2,
      stderr: 'tshc: no .shade.ts files under the working directory.\n',
    });
    const badFormat = run(['check', '--format', 'xml'], { '/p/a.shade.ts': GOOD });
    expect(badFormat.status).toBe(2);
    expect(badFormat.stderr).toContain('--format takes one of text, short, json; got "xml".');
    expect(run(['check', '--frob'], {}).stderr).toContain('tshc: Unknown option --frob.');
    expect(run(['lint'], {}).stderr).toContain('tshc: unknown command "lint".');
    expect(run([], {})).toMatchObject({ status: 2, stderr: USAGE });
  });

  it('names itself tshc, the command the typeshade package installs (change 0023)', () => {
    expect(USAGE.split('\n').slice(0, 2)).toEqual([
      'Usage: tshc check [options] [paths...]',
      '       tshc sync [--check] [paths...]',
    ]);
    expect(USAGE).not.toMatch(/\btypeshade (check|sync)\b/);
  });

  it('answers --help and --version on stdout', () => {
    expect(run(['--help'], {})).toMatchObject({ status: 0, stdout: USAGE });
    expect(run(['check', '-h'], {})).toMatchObject({ status: 0, stdout: USAGE });
    expect(run(['--version'], {})).toMatchObject({ status: 0, stdout: '9.9.9\n' });
  });

  it('runs end to end on the Node host (bin.ts) against a real directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tshc-check-'));
    try {
      mkdirSync(join(dir, 'src'));
      writeFileSync(join(dir, 'src', 'b.shade.ts'), BAD);
      const r = spawnSync('bun', [join(PKG_DIR, 'src/cli/bin.ts'), 'check', '--format', 'json'], {
        cwd: dir,
        encoding: 'utf8',
      });
      expect(r.error, 'could not start bun').toBeUndefined();
      expect(r.status, r.stderr).toBe(1);
      const report = JSON.parse(r.stdout) as { files: string[]; summary: Record<string, number> };
      expect(report.files).toEqual(['src/b.shade.ts']);
      expect(report.summary).toEqual({ errors: 1, warnings: 0, files: 1 });
      const version = spawnSync('bun', [join(PKG_DIR, 'src/cli/bin.ts'), '--version'], {
        encoding: 'utf8',
      });
      const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')) as {
        version: string;
      };
      expect(version.stdout).toBe(`${pkg.version}\n`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
