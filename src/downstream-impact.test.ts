// ═══ The downstream check reads a bake diff and a git diff the way the pin workflows hand them over ═══
//
// `scripts/downstream-impact.ts` runs in the site and editor repositories, on their compiler-pin
// pull requests, so its end-to-end behaviour is exercised there. Its two readers are pinned here,
// where a change to them is made: which exports a pin removes, and which lines a branch touched.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
