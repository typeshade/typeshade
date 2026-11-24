import { describe, expect, it } from 'vitest';
import { applied, plan, refusal } from './core/testing/move-declarations-fixtures.js';
import { checkMove } from '../scripts/move-purity.js';

const PURE = `export function one(): number {\n  return 1;\n}\n\nexport function two(): number {\n  return 2;\n}\n`;

const refuseWith = (
  files: Record<string, string>,
  to: string,
  names: string,
  ...flags: string[]
): Promise<string> => refusal(plan(files, 'src/a.ts', to, names, ...flags));

describe('move-declarations refusals (docs/structure-refactoring-plan.md, S0 item b)', () => {
  it('names a name that is not a top-level declaration', async () => {
    expect(await refuseWith({ 'src/a.ts': PURE }, 'src/b.ts', 'three')).toContain(
      'name not found among the top-level declarations of src/a.ts: three',
    );
  });

  it('refuses a source that evidence strings cite by line', async () => {
    const rows = ['src', 'core', 'coverage', 'rows.ts'].join('/');
    const source = ['src', 'a.ts'].join('/');
    const files = {
      [source]: PURE,
      [rows]: `export const R = [{ evidence: '${source}:2' }];\n`,
    };
    const message = await refuseWith(files, 'src/b.ts', 'one');
    expect(message).toContain(`cited by line path ${source} 1 citing segment`);
  });

  it('refuses a target that exists, in the program or on disk', async () => {
    const files = { 'src/a.ts': PURE, 'src/b.ts': `export const B = 1;\n` };
    expect(await refuseWith(files, 'src/b.ts', 'one')).toContain('src/b.ts exists');
  });

  it('refuses a source that is not tracked and a source with uncommitted changes', async () => {
    expect(await refusal(plan({ 'src/b.ts': PURE }, 'src/a.ts', 'src/c.ts', 'one'))).toContain(
      'not tracked at HEAD',
    );
  });

  it('refuses a listed unit that runs code at load, with the reason of the checker', async () => {
    const files = {
      'src/a.ts': `export const stamp = Date.now();\n\nexport function two(): number {\n  return 2;\n}\n`,
    };
    const message = await refuseWith(files, 'src/b.ts', 'stamp');
    expect(message).toContain('stamp is not evaluation-free (line 1)');
  });

  it('refuses a source that holds an active unit that stays, with the reason of the checker', async () => {
    const files = {
      'src/a.ts': `${PURE}\nexport const stamp = Date.now();\n`,
    };
    const message = await refuseWith(files, 'src/b.ts', 'one');
    expect(message).toContain('is not a clean file');
    expect(message).toContain('active unit at line');
  });

  it('refuses a source that is in an import cycle, and prints the cycle', async () => {
    const files = {
      'src/a.ts': `import { back } from './c.js';\n\nexport function one(): number {\n  return back();\n}\n`,
      'src/c.ts': `import { one } from './a.js';\n\nexport function back(): number {\n  return one();\n}\n`,
    };
    const message = await refuseWith(files, 'src/b.ts', 'one');
    expect(message).toContain('is not a clean file');
    expect(message).toContain('import cycle: src/a.ts -> src/c.ts -> src/a.ts');
  });

  it('lists the staying private declarations a moved unit needs and suggests --closure', async () => {
    const files = {
      'src/a.ts': `const STEP = 2;\n\nfunction scale(x: number): number {\n  return x * STEP;\n}\n\nexport function grow(x: number): number {\n  return scale(x);\n}\n`,
    };
    const message = await refuseWith(files, 'src/b.ts', 'grow');
    expect(message).toContain('scale (private; used by grow)');
    expect(message).toContain('--closure');
  });

  it('keeps blocking a helper that a staying unit also uses, even with --closure', async () => {
    const files = {
      'src/a.ts': `function scale(x: number): number {\n  return x * 2;\n}\n\nexport function grow(x: number): number {\n  return scale(x);\n}\n\nexport function stay(x: number): number {\n  return scale(x) + 1;\n}\n`,
    };
    const message = await refuseWith(files, 'src/b.ts', 'grow', '--closure');
    expect(message).toContain('scale (private; used by grow; also used by stay which stay)');
    expect(message).toContain('List these names in --move');
  });

  it('refuses a value import that the move leaves with type uses only', async () => {
    const files = {
      'src/widget.ts': `export class Widget {\n  size = 1;\n}\n`,
      'src/a.ts': `import { Widget } from './widget.js';

export function make(): Widget {
  return new Widget();
}

export function size(w: Widget): number {
  return w.size;
}
`,
    };
    const message = await refuseWith(files, 'src/b.ts', 'make');
    expect(message).toContain('only as a type');
    expect(message).toContain('The units of the source that still use it: size.');
  });

  it('refuses a test file, a declaration file and a shade file as source or target', async () => {
    const files = {
      'src/a.ts': PURE,
      'src/a.test.ts': PURE,
      'src/d.d.ts': `export declare const D: number;\n`,
      'src/s.shade.ts': PURE,
    };
    expect(await refusal(plan(files, 'src/a.test.ts', 'src/b.ts', 'one'))).toContain(
      'is a test file',
    );
    expect(await refusal(plan(files, 'src/d.d.ts', 'src/b.ts', 'D'))).toContain('is a dts file');
    expect(await refusal(plan(files, 'src/s.shade.ts', 'src/b.ts', 'one'))).toContain(
      'is a shade file',
    );
    expect(await refuseWith(files, 'src/b.test.ts', 'one')).toContain(
      'the target src/b.test.ts is a test file',
    );
    expect(await refuseWith(files, 'src/b.shade.ts', 'one')).toContain('is a shade file');
  });

  it('refuses a source or target that a configuration file names by path', async () => {
    const files = { 'src/a.ts': PURE, 'package.json': `{ "files": ["src/a.ts"] }\n` };
    expect(await refuseWith(files, 'src/b.ts', 'one')).toContain(
      'path is named in package.json: src/a.ts',
    );
    const named = {
      'src/a.ts': PURE,
      'vitest.config.ts': `export default { include: ['src/b.ts'] };\n`,
    };
    expect(await refuseWith(named, 'src/b.ts', 'one')).toContain(
      'path is named in vitest.config.ts: src/b.ts',
    );
  });

  it('refuses a move between two top-level directories', async () => {
    expect(await refuseWith({ 'src/a.ts': PURE }, 'scripts/b.ts', 'one')).toContain(
      'different top-level directories',
    );
  });

  it('refuses units that read their location, and a relative path when the directory changes', async () => {
    const meta = { 'src/a.ts': `export const here = (): string => import.meta.url;\n` };
    expect(await refuseWith(meta, 'src/b.ts', 'here')).toContain(
      'location-dependent (import.meta)',
    );
    const relative = { 'src/a.ts': `export const DATA = './data.json';\n` };
    expect(await refuseWith(relative, 'src/deep/b.ts', 'DATA')).toContain(
      'the relative path "./data.json"',
    );
    const sameDirectory = await plan(relative, 'src/a.ts', 'src/b.ts', 'DATA');
    expect(sameDirectory.report.pure).toBe(true);
  });

  it('refuses units that carry banned comment lines and says how many', async () => {
    const files = {
      'src/a.ts': `// a note\n// another note\nexport function one(): number {\n  return 1;\n}\n`,
    };
    expect(await refuseWith(files, 'src/b.ts', 'one')).toBe(
      'moved units carry 2 banned comment lines; remove the comments first in an ordinary pull request (CLAUDE.md, Comments)',
    );
  });

  it('moves the comment kinds the policy allows: Why, markers and the doc comment of a public definition', async () => {
    const files = {
      'src/__api__/surface.md': 'src/a.ts#one  function  () => number\n',
      'src/a.ts': `/** Returns one. */\nexport function one(): number {\n  // Why: the specification fixes the value.\n  return 1;\n}\n\n// SPDX-License-Identifier: MIT\nexport const two = 2;\n`,
    };
    const result = await plan(files, 'src/a.ts', 'src/b.ts', 'one,two');
    expect(result.report.pure).toBe(true);
    expect(result.surfaceNames).toEqual(['one']);
  });

  it('refuses a default export given by its name or as default', async () => {
    const files = { 'src/a.ts': `export default 5;\n\nexport const KEEP = 1;\n` };
    expect(await refuseWith(files, 'src/b.ts', 'default')).toContain('default');
  });

  it('refuses a name that is not a declaration, such as a namespace', async () => {
    const files = { 'src/a.ts': `export namespace Space {\n  export type T = number;\n}\n` };
    expect(await refuseWith(files, 'src/b.ts', 'Space')).toContain('not a function, class');
  });

  it('moves the parts of a merged interface together', async () => {
    const files = {
      'src/a.ts': `export interface Box {\n  width: number;\n}\n\nexport interface Box {\n  height: number;\n}\n\nexport const KEEP = 1;\n`,
    };
    const result = await plan(files, 'src/a.ts', 'src/box.ts', 'Box');
    expect(result.moved).toHaveLength(2);
    expect(checkMove(new Map(Object.entries(files)), applied(files, result)).pure).toBe(true);
  });

  it('retries the position of the new statements when the order of loading would change', async () => {
    const files = {
      'src/x.ts': `export const x = Date.now();\n`,
      'src/y.ts': `export const y = Date.now();\n`,
      'src/a.ts': `import { y } from './y.js';\nimport { x } from './x.js';\n\nexport function useY(): number {\n  return y;\n}\n\nexport function useX(): number {\n  return x;\n}\n`,
    };
    const result = await plan(files, 'src/a.ts', 'src/b.ts', 'useY');
    expect(result.report.pure).toBe(true);
    expect(result.placement).toBe('before the first import');
  });

  it('refuses a move whose added export makes Prettier re-wrap a unit', async () => {
    const wide = `const isRenderEntry = (value: number): boolean => value > 100000 && value < 200000 && value !== 15;`;
    expect(wide.length).toBeLessThanOrEqual(100);
    expect(`export ${wide}`.length).toBeGreaterThan(100);
    const files = {
      'src/a.ts': `${wide}\n\nexport function stay(): boolean {\n  return isRenderEntry(1);\n}\n`,
    };
    const message = await refuseWith(files, 'src/b.ts', 'isRenderEntry');
    expect(message).toContain('adding `export` makes Prettier re-wrap isRenderEntry');
    expect(message).toContain('Export isRenderEntry in src/a.ts first');
  });

  it('writes a unit that Prettier would change as it is, and says so', async () => {
    const files = {
      'src/a.ts': `export function ugly( a:number ):number{return a+1}\n\nexport const KEEP = 1;\n`,
    };
    const result = await plan(files, 'src/a.ts', 'src/b.ts', 'ugly');
    expect(result.report.pure).toBe(true);
    expect(result.formatted.target).toBe(false);
    expect(result.texts.target).toBe(`export function ugly( a:number ):number{return a+1}\n`);
  });
});
