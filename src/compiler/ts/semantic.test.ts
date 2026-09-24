import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { TS_CODES } from './codes.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

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
  // Every diagnostic, not those of one code: a statement refused whole is one sentence, and
  // what it is and holds adds nothing (Rule 12.4). A `try`, a `throw` and a `for…in` were also
  // told they are host forms, `TS8013`, on the same span.
  // The editor shows the same list: TypeScript refuses a `return`, a `break`, a `continue`, an
  // `import x = require(...)`, an `export as namespace` and a `with` there too, and its report
  // is merged into the compiler's sentence.
  const topLevel = (stmt: string): string[] => {
    const src = `"use typeshade";\n${stmt}\n@fragment\nexport function fs(): vec4 { return vec4(1.); }\n`;
    const said = compileTsSource(src).diagnostics.map((d) => `${d.code} ${d.message}`);
    const service = createTypeshadeLanguageService();
    // The module a CommonJS import below names, so that the editor finds it.
    service.openDocument(
      '/p/lib.ts',
      '"use typeshade";\nexport function f(): f32 { return 1.; }\n',
    );
    service.openDocument('/p/a.ts', src);
    const editor = service.getDiagnostics('/p/a.ts').map((d) => `${d.code} ${d.message}`);
    expect(editor.sort(), 'the editor').toEqual([...said].sort());
    return said;
  };
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
    [
      'with ({}) { }',
      `${TS_CODES.TOP_LEVEL} "with ({}) { }" has no place at the top level; ${HOLDS}`,
    ],
  ];

  it.each(cases)('%s', (stmt, expected) => {
    expect(topLevel(stmt)).toEqual([expected]);
  });

  // In a namespace a statement was `A namespace holds functions, constants, classes and
  // namespaces; this inside "N" has no flattened form. Declare it at the top level of the
  // file.`, which named nothing, and whose remedy the top level refuses.
  const NS = 'a namespace holds functions, constants, classes and namespaces.';
  const inside = (what: string, ns = 'N', fix = ' Move it into a function.'): string =>
    `${TS_CODES.TOP_LEVEL} ${what} inside "${ns}" runs nowhere; ${NS}${fix}`;
  const F = 'export function f(): f32 { return 1.; }';
  const inNamespace: readonly (readonly [string, string])[] = [
    ['namespace N { if (true) { } }', inside('An "if" statement')],
    ['namespace N { for (let i = 0; i < 2; i++) { } }', inside('A "for" loop')],
    [`namespace N { ${F} { } }`, inside('A block, "{ … }",')],
    [`namespace N { ${F} f(); }`, inside('"f()"')],
    ['namespace A { namespace B { while (false) { } } }', inside('A "while" loop', 'A.B')],
    ['namespace N { debugger; }', inside('A "debugger" statement', 'N', ' Remove it.')],
    [
      'namespace M { export const k = 1.; }\nnamespace N { import k = M.k; }',
      `${TS_CODES.TOP_LEVEL} "import k = M.k" is an import alias; a shader file names "M.k" where it reads it.`,
    ],
    // Refused wherever it stands, and in a namespace that sentence is the one.
    [
      'namespace N { try { } catch { } }',
      `${TS_CODES.HOST_STMT} try/catch/throw are JS exceptions. TypeShade has no exception path.`,
    ],
    // A statement refused whole is one sentence here too: what it holds, and a `var` it
    // declares, add nothing (Rule 12.4).
    ['namespace N { if (true) { try { } catch { } } }', inside('An "if" statement')],
    [
      'namespace N { var v = 1.; }',
      `${TS_CODES.TOP_LEVEL} A namespace holds functions, constants, classes and namespaces; a variable inside "N" has no flattened form. Declare it at the top level of the file.`,
    ],
  ];

  it.each(inNamespace)('%s', (stmt, expected) => {
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
namespace N {
  export function h(): f32 {
    let s = 0.;
    for (let i = 0; i < 2; i++) { s += 1.; }
    { s += 1.; }
    return s;
  }
}
@compute([1])
export function main(): void { g(); out[4] = N.h(); }
`);
    expect(r.diagnostics).toEqual([]);
  });
});
