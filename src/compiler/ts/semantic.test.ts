import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { TS_CODES } from './codes.js';

describe('Phase 12 semantic bans', () => {
  it('no longer bans console: the standard console is lowered, not refused', () => {
    // `console` left HOST_GLOBALS when the JavaScript Console API became part of the surface
    // (src/core/console.ts): a call is lowered to a `console.<method>` call statement that the
    // CPU path delivers to the host's console sink. console.test.ts pins what it lowers to and
    // which methods are refused; this pins only that the host-API ban is gone.
    const r = compileTsSource(`
      "use typeshade";
      export function f(): void {
        console.log(1.);
      }
    `);
    expect(r.diagnostics.filter((d) => d.code === TS_CODES.HOST_API)).toEqual([]);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  });

  it('rejects fetch', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): f32 {
        fetch("x");
        return 1.;
      }
    `);
    expect(r.diagnostics.some((d) => d.code === TS_CODES.HOST_API)).toBe(true);
  });

  it('rejects Date / new', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): f32 {
        const t = new Date();
        return 1.;
      }
    `);
    expect(
      r.diagnostics.some((d) => d.code === TS_CODES.HOST_API || d.code === TS_CODES.HOST_STMT),
    ).toBe(true);
  });

  it('rejects await and async', () => {
    const r = compileTsSource(`
      "use typeshade";
      export async function f(): Promise<f32> {
        return await 1.;
      }
    `);
    expect(r.diagnostics.some((d) => d.code === TS_CODES.HOST_STMT)).toBe(true);
  });

  it('rejects for-in, and for-of over what is not an array', () => {
    // for-of over an array is a counted loop (Rule 7.5, for-of.test.ts); over a vector it is
    // refused where it is lowered, and for-in has no meaning on a shader value at all.
    const r = compileTsSource(`
      "use typeshade";
      export function f(xs: vec3): f32 {
        for (const x of xs) { }
        for (const k in xs) { }
        return 0.;
      }
    `);
    expect(
      r.diagnostics.some(
        (d) => d.code === TS_CODES.TYPE_MISMATCH && /for-of iterates an array/.test(d.message),
      ),
    ).toBe(true);
    expect(
      r.diagnostics.some((d) => d.code === TS_CODES.HOST_STMT && /for-in/.test(d.message)),
    ).toBe(true);
  });

  it('rejects try/catch', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): f32 {
        try { return 1.; } catch { return 0.; }
      }
    `);
    expect(r.diagnostics.some((d) => d.code === TS_CODES.HOST_STMT)).toBe(true);
  });

  it('a top-level let is a per-invocation variable (§24); var stays refused', () => {
    const ok = compileTsSource(`
      "use typeshade";
      let acc: f32 = 0.;
      export function f(): f32 { return acc; }
    `);
    expect(ok.diagnostics.some((d) => d.code === TS_CODES.TOP_LEVEL)).toBe(false);
    expect(ok.wgsl).toContain('var<private> acc: f32 = 0.0;');
    const r = compileTsSource(`
      "use typeshade";
      var acc: f32 = 0.;
      export function f(): f32 { return acc; }
    `);
    expect(r.diagnostics.some((d) => d.code === TS_CODES.TOP_LEVEL)).toBe(true);
  });

  it('still compiles a pure helper', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function add(a: f32, b: f32): f32 {
        return a + b;
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.wgsl).toEqual(expect.any(String));
  });
});

describe('a statement at the top level is named by its keyword', () => {
  // Until proposal 0008 each of these was `Unsupported top-level "IfStatement". A TypeShade file
  // is directive + types + functions + imports.`: TypeScript's name for the node (a `debugger`
  // was "LastStatement"), and a list of what a file holds from before classes, enums,
  // namespaces and module variables (Rule 12.1).
  const HOLDS =
    'a shader file declares functions, classes, types, enums, namespaces, constants, module variables and resources.';
  const topLevel = (stmt: string): string[] =>
    compileTsSource(
      `"use typeshade";\n${stmt}\n@fragment\nexport function fs(): vec4 { return vec4(1.); }\n`,
    )
      .diagnostics.filter((d) => d.code === TS_CODES.TOP_LEVEL)
      .map((d) => `${d.code} ${d.message}`);
  const moves = (what: string): string =>
    `${TS_CODES.TOP_LEVEL} ${what} at the top level runs nowhere; ${HOLDS} Move it into a function.`;
  const stays = (what: string, fix = ''): string =>
    `${TS_CODES.TOP_LEVEL} ${what} at the top level runs nowhere; ${HOLDS}${fix}`;
  const cases: readonly (readonly [string, string])[] = [
    ['if (true) { }', moves('An "if" statement')],
    ['switch (1) { default: { break; } }', moves('A "switch" statement')],
    ['for (let i = 0; i < 4; i++) { }', moves('A "for" loop')],
    ['for (const x of [1., 2.]) { }', moves('A "for…of" loop')],
    ['while (false) { }', moves('A "while" loop')],
    ['{ }', moves('A block, "{ … }",')],
    ['return;', moves('A "return" statement')],
    // A function body refuses these too, each with its own sentence.
    ['do { } while (false);', stays('A "do…while" loop')],
    ['for (const k in {}) { }', stays('A "for…in" loop')],
    ['try { } catch { }', stays('A "try" statement')],
    ['throw 1;', stays('A "throw" statement')],
    ['break;', stays('A "break" statement')],
    ['continue;', stays('A "continue" statement')],
    ['outer: for (;;) { break outer; }', stays('A labelled statement, "outer:",')],
    ['debugger;', stays('A "debugger" statement', ' Remove it.')],
    ['function g(): f32 { return 1.; };', stays('An empty statement, ";",', ' Remove it.')],
    [
      'import x = require("./lib");',
      `${TS_CODES.TOP_LEVEL} "import x = require("./lib")" is a CommonJS import; a shader file imports each function by name, import { f } from "./lib".`,
    ],
    [
      'namespace N { export const k = 1.; }\nimport k = N.k;',
      `${TS_CODES.TOP_LEVEL} "import k = N.k" is an import alias; a shader file names "N.k" where it reads it.`,
    ],
    [
      'export as namespace Lib;',
      `${TS_CODES.TOP_LEVEL} "export as namespace Lib" has no place at the top level; ${HOLDS}`,
    ],
  ];

  it.each(cases)('%s', (stmt, expected) => {
    expect(topLevel(stmt)).toEqual([expected]);
  });

  it('and what it is told to move compiles in a function', () => {
    const r = compileTsSource(`"use typeshade";
declare const out: storage<array<f32>, "read_write">;
function g(): void {
  if (out[0] > 0.) { out[0] = 1.; }
  switch (u32(out[2])) { case 1: { out[3] = 1.; break; } default: { break; } }
  for (let i = 0; i < 4; i++) { out[i] = 2.; }
  const xs: array<f32, 2> = [1., 2.];
  for (const x of xs) { out[0] = x; }
  let k = 0;
  while (k < 3) { k++; }
  { out[1] = 3.; }
  return;
}
@compute([1])
export function main(): void { g(); }
`);
    expect(r.diagnostics).toEqual([]);
  });
});
