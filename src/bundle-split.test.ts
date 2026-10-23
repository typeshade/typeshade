// Verifies: Rule 11.11, Rule 11.13 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { splitProblems } from '../scripts/bundle-boundary.js';

const assets = (entry: string, executor = 'export const runPlan = () => 1;') =>
  new Map([
    ['entry.js', entry],
    ['executor.js', executor],
    ['shared.js', 'export const n = 1;'],
  ]);

describe('CSP and asset completeness of a split runtime (0085)', () => {
  it('accepts included local assets for static and deferred imports', () => {
    expect(
      splitProblems(
        assets(
          'import { n } from "./shared.js"; export const load = () => import("./executor.js");',
        ),
      ),
    ).toEqual([]);
  });

  it.each([
    'import("https://example.com/executor.js")',
    'import("//example.com/executor.js")',
    'import("/executor.js")',
    'import("executor")',
    'import("../executor.js")',
    'import("./missing.js")',
    'import("./executor.js?external")',
    'import(path)',
    'import("./" + name + ".js")',
  ])('refuses an external, missing or computed asset: %s', (source) => {
    expect(splitProblems(assets(source))).toEqual([expect.stringContaining('import(')]);
  });

  it('refuses missing static imports and re-exports', () => {
    expect(
      splitProblems(assets('import "./missing.js"; export * from "https://example.com/file.js";')),
    ).toHaveLength(2);
  });

  it.each(['new Function("return 1")', 'Function("return 1")', '(0,eval)("1")', 'import(path)'])(
    'sees forbidden code at the end of a deferred asset: %s',
    (source) => {
      expect(
        splitProblems(
          assets('import("./executor.js")', `export const runPlan = () => 1;\n${source}`),
        ),
      ).toEqual([expect.stringContaining('executor.js:')]);
    },
  );
});
