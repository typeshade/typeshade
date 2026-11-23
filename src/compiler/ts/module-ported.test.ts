import { describe, expect, it } from 'vitest';
import { compileTsSources } from './module.js';
import { bothHalves } from '../../core/testing/both-halves.js';

describe('compileTsSources — ported from sources.test.ts', () => {
  it('PORTED: resolves relative named imports into one WGSL module', () => {
    const r = compileTsSources(
      [
        {
          fileName: 'math.ts',
          source: `
          "use typeshade";
          export function square(x: f32): f32 { return x * x; }
        `,
        },
        {
          fileName: 'app.ts',
          source: `
          "use typeshade";
          import { square } from "./math";
          export function foo(x: f32): f32 { return square(x) + 1.; }
        `,
        },
      ],
      'app.ts',
    );
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.funcs.map((f) => f.name).sort()).toEqual(['foo', 'square']);
    expect(r.wgsl).toMatch(/fn square/);
    expect(r.wgsl).toMatch(/fn foo/);
    expect(r.wgsl).toMatch(/square\(/);
  });

  it('PORTED: refuses a package the files it is handed do not hold (change 0024)', () => {
    const r = compileTsSources(
      [
        {
          fileName: 'app.ts',
          source: `
          "use typeshade";
          import { sin } from "some-pkg";
          export function f(x: f32): f32 { return x; }
        `,
        },
      ],
      'app.ts',
    );
    expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
      'TS8072 Cannot find the package "some-pkg" (looked in node_modules from "." up).',
    ]);
    expect(
      bothHalves(
        `"use typeshade";\nimport { sin } from "some-pkg";\nexport function f(x: f32): f32 { return x; }`,
        { fileName: 'app.ts' },
      ).editor,
    ).toEqual([
      'typeshade TS8072: Cannot find the package "some-pkg" (looked in node_modules from "." up).',
    ]);
  });
});
