import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../scripts/code-shape.js';

let output: string[] = [];
let errors: string[] = [];

beforeEach(() => {
  output = [];
  errors = [];
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    output.push(String(line));
  });
  vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
    errors.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ROOT = process.cwd();
const SMALL_FILE = 'src/core/registry.ts';

describe('the code-shape command', () => {
  it('prints a Markdown report with each signal and the skipped rules', () => {
    expect(runCli(['--file', SMALL_FILE], ROOT)).toBe(0);
    const text = output.join('\n');
    expect(text).toContain('## Signal: layer');
    expect(text).toContain('## Signal: breadth');
    expect(text).toContain('Skipped files, by rule');
    expect(text).toContain('Files analysed: 1.');
  });

  it('prints JSON with the signals and the definitions', () => {
    expect(runCli(['--json', '--file', SMALL_FILE], ROOT)).toBe(0);
    const report = JSON.parse(output.join('\n')) as {
      analysedFiles: number;
      signals: { name: string }[];
      definitions: { skipRules: unknown[] };
    };
    expect(report.analysedFiles).toBe(1);
    expect(report.signals.map((signal) => signal.name)).toEqual(['layer', 'breadth', 'home']);
    expect(report.definitions.skipRules.length).toBeGreaterThan(0);
  });

  it('takes several paths after one --file', () => {
    expect(runCli(['--file', SMALL_FILE, 'src/index.ts'], ROOT)).toBe(0);
    expect(output.join('\n')).toMatch(/Files analysed: [12]\./);
  });

  it('fails only on a usage error', () => {
    expect(runCli(['--unknown'], ROOT)).toBe(2);
    expect(runCli(['--file'], ROOT)).toBe(2);
    expect(runCli(['--repo'], ROOT)).toBe(2);
    expect(errors.join('\n')).toContain('Usage');
  });
});
