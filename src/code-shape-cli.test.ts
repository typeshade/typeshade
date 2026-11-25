import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../scripts/code-shape.js';

let output: string[] = [];
let errors: string[] = [];
let fixtures: string[] = [];

beforeEach(() => {
  output = [];
  errors = [];
  fixtures = [];
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    output.push(String(line));
  });
  vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
    errors.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const fixture of fixtures) rmSync(fixture, { recursive: true, force: true });
});

const SYM = 'export interface Sym {\n  emitted: string;\n  emittedGlsl?: string;\n}\n';
const choice = (name: string): string =>
  `import type { Sym } from './sym.js';\nexport const ${name} = (sym: Sym): string => sym.emittedGlsl ?? sym.emitted;\n`;

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'code-shape-'));
  fixtures.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const FILES = {
  'src/sym.ts': SYM,
  'src/one.ts': choice('one'),
  'src/two.ts': choice('two'),
  'src/one.test.ts': `export const t = 1;\n`,
};

interface JsonReport {
  allFiles: number;
  analysedFiles: number;
  unmatchedFiles: string[];
  signals: { name: string; findings: { kind: string; file: string }[] }[];
  definitions: { skipRules: unknown[] };
}

const jsonOf = (): JsonReport => JSON.parse(output.join('\n')) as JsonReport;

const findingsOf = (report: JsonReport, signal: string) =>
  report.signals.find((entry) => entry.name === signal)!.findings;

describe('the code-shape command on a small repository', () => {
  it('prints a Markdown report with each signal and the skipped rules', () => {
    const root = fixture(FILES);
    expect(runCli(['--repo', root], process.cwd())).toBe(0);
    const text = output.join('\n');
    for (const name of ['layer', 'breadth', 'home', 'cohesion', 'ownership']) {
      expect(text).toContain(`## Signal: ${name}`);
    }
    expect(text).toContain('Skipped files, by rule');
    expect(text).toContain('Files analysed: 3.');
  });

  it('resolves a relative --repo against the given working directory', () => {
    const root = fixture(FILES);
    expect(runCli(['--json', '--repo', basename(root)], dirname(root))).toBe(0);
    const report = jsonOf();
    expect(report.analysedFiles).toBe(3);
    expect(findingsOf(report, 'ownership').length).toBeGreaterThan(0);
  });

  it('prints JSON with the signals and the definitions', () => {
    const root = fixture(FILES);
    expect(runCli(['--json', '--repo', root], process.cwd())).toBe(0);
    const report = jsonOf();
    expect(report.signals.map((signal) => signal.name)).toEqual([
      'layer',
      'breadth',
      'home',
      'cohesion',
      'ownership',
    ]);
    expect(report.definitions.skipRules.length).toBeGreaterThan(0);
    expect(report.unmatchedFiles).toEqual([]);
  });

  it('takes several paths after one --file', () => {
    const root = fixture(FILES);
    expect(runCli(['--json', '--repo', root, '--file', 'src/one.ts', 'src/two.ts'], '/')).toBe(0);
    expect(jsonOf().analysedFiles).toBe(2);
  });

  it('keeps a repeated choice whose other site is outside the wanted files', () => {
    const root = fixture(FILES);
    expect(runCli(['--json', '--repo', root, '--file', 'src/one.ts'], '/')).toBe(0);
    const report = jsonOf();
    const repeated = findingsOf(report, 'ownership').filter(
      (finding) => finding.kind === 'repeated-choice',
    );
    expect(repeated).toHaveLength(1);
    expect(repeated[0]!.file).toBe('src/one.ts');
  });

  it('drops a repeated choice that has no site in the wanted files', () => {
    const root = fixture(FILES);
    expect(runCli(['--json', '--repo', root, '--file', 'src/sym.ts'], '/')).toBe(0);
    const kinds = findingsOf(jsonOf(), 'ownership').map((finding) => finding.kind);
    expect(kinds).not.toContain('repeated-choice');
  });

  it('names each --file path that matched nothing', () => {
    const root = fixture(FILES);
    const args = ['--repo', root, '--file', 'src/one.ts', 'src/one.test.ts', 'src/missing.ts'];
    expect(runCli(args, '/')).toBe(0);
    const text = output.join('\n');
    expect(text).toContain('No analysed file matches src/one.test.ts (skipped or missing).');
    expect(text).toContain('No analysed file matches src/missing.ts (skipped or missing).');
    expect(text).not.toContain('No analysed file matches src/one.ts');
    output = [];
    expect(runCli(['--json', ...args], '/')).toBe(0);
    expect(jsonOf().unmatchedFiles).toEqual(['src/one.test.ts', 'src/missing.ts']);
  });

  it('fails only on a usage error', () => {
    expect(runCli(['--unknown'], process.cwd())).toBe(2);
    expect(runCli(['--file'], process.cwd())).toBe(2);
    expect(runCli(['--repo'], process.cwd())).toBe(2);
    expect(errors.join('\n')).toContain('Usage');
  });
});

describe('the code-shape command on this repository', () => {
  it('prints a report for one file', { timeout: 120_000 }, () => {
    expect(runCli(['--file', 'src/core/registry.ts'], process.cwd())).toBe(0);
    expect(output.join('\n')).toContain('Files analysed: 1.');
  });
});
