// #1204: a struct that holds itself is refused once, on the field that closes the cycle, in both
// readers, and nothing throws. Before the fix `compile()`, `getDiagnostics`, hover and
// `checkDocuments` overflowed the stack on it (`runtimeArrayWithin`, the constructor's zero
// values), and `array<R, 2>` compiled to WGSL that Tint refuses.
//
// Measured against Tint once (Rule 13.3), headless Chromium 156.0.8078.4 (SwiftShader WebGPU),
// 2026-11-10: each cycle below, an unused one included, is `cyclic dependency found: 'R' -> 'R'`
// (`'A' -> 'B' -> 'A'` for two structs); the neighbours (a struct holding another struct, a
// struct with a runtime array of another struct in storage) compile with no error.
// It reads both halves (Rule 12.7) and pins the one diagnostic and its text (Rules 12.4, 12.5).
// Verifies: Rule 12.6 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { TS_CODES } from './codes.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { checkDocuments } from '../../language-service/check.js';

const FILE = '/p/a.ts';
const H = '"use typeshade";\n';
const program = (decl: string, body = 'let r: R;'): string =>
  `${H}${decl}\n@compute([1]) export function main(): void { ${body} }\n`;

const cycle = (field: string, path: readonly string[]): string =>
  `Field "${field}" makes "${path[0]}" contain itself, through ` +
  `${path.map((n) => `"${n}"`).join(' -> ')}. A struct has a fixed size, so it cannot hold ` +
  `itself: hold an index into an array of "${path[0]}" instead, or remove the field.`;

const R_CYCLE = cycle('R.r', ['R', 'R']);

/** Both readers on one source: the compiler's diagnostics and the editor's, each as
 *  `code message`, after hovering every position of the file, which must not throw either. */
function bothHalves(
  source: string,
  files: Readonly<Record<string, string>> = {},
): { compiler: string[]; editor: string[]; compiled: ReturnType<typeof compile> } {
  const readDocument = (f: string): string | undefined => files[f];
  const compiled = compile(source, { fileName: FILE, readDocument });
  const service = createTypeshadeLanguageService({ readDocument });
  service.openDocument(FILE, source);
  const editor = service.getDiagnostics(FILE).map((d) => `${String(d.code)} ${d.message}`);
  const lines = source.split('\n');
  for (let line = 0; line < lines.length; line++)
    for (let character = 0; character <= lines[line]!.length; character++)
      service.getHover(FILE, { line, character });
  return {
    compiler: compiled.diagnostics.map((d) => `${d.code} ${d.message}`),
    editor,
    compiled,
  };
}

const ONE = (message: string): string[] => [`${TS_CODES.STRUCT_FIELD} ${message}`];

describe('a struct that holds itself (#1204)', () => {
  const refused: readonly (readonly [string, string, string])[] = [
    ['directly', program('interface R { a: f32; r: R; }'), R_CYCLE],
    ['as its only field', program('interface R { r: R; }'), R_CYCLE],
    [
      'through another struct, named from the one declared first',
      program('interface A { x: f32; b: B; }\ninterface B { y: f32; a: A; }', 'let r: A;'),
      cycle('B.a', ['A', 'B', 'A']),
    ],
    [
      'through another struct declared first',
      program('interface B { y: f32; a: A; }\ninterface A { x: f32; b: B; }', 'let r: A;'),
      cycle('A.b', ['B', 'A', 'B']),
    ],
    ['through an array with a size', program('interface R { a: f32; r: array<R, 2>; }'), R_CYCLE],
    // Only the cycle: before, a local of it was TS8099, an array with no size (Rule 12.4).
    ['through an array with no size', program('interface R { a: f32; r: array<R>; }'), R_CYCLE],
    // `T | undefined` is a struct that holds a `T` (Rule 7.10).
    ['through an optional', program('interface R { a: f32; r: R | undefined; }'), R_CYCLE],
    ['as a type over an object literal', program('type R = { a: f32; r: R; };'), R_CYCLE],
    // The initializer of the refused field says nothing more: no TS8031 for `new R()`.
    [
      'as a class with an initializer',
      program('class R { a: f32 = 0.; r: R = new R(); }'),
      R_CYCLE,
    ],
    [
      'as a class with a constructor',
      program('class R { a: f32; r: R; constructor(a: f32, r: R) { this.a = a; this.r = r; } }'),
      R_CYCLE,
    ],
    [
      'as a parameter property',
      program('class R { constructor(public a: f32, public r: R) {} }'),
      R_CYCLE,
    ],
    // A class is collected and emitted whether or not anything uses it, so it is checked.
    ['as a class nothing uses', program('class R { a: f32 = 0.; r: R = new R(); }', ''), R_CYCLE],
    [
      'through a field its base declares',
      program(
        'class B { a: f32 = 0.; d: array<D, 2> = array<D, 2>(); }\nclass D extends B { e: f32 = 0.; }',
        'let d = new D(); d.e = 1.;',
      ),
      cycle('D.d', ['D', 'D']),
    ],
    [
      'held only by a storage binding',
      `${H}interface R { a: f32; r: R; }\ndeclare const buf: storage<R, "read_write">;\n` +
        '@compute([1]) export function main(): void { buf.a = 1.; }\n',
      R_CYCLE,
    ],
    // A file that exports a struct is checked on its own, used or not.
    ['exported and unused', program('export interface R { a: f32; r: R; }', ''), R_CYCLE],
    [
      'exported by a clause and unused',
      program('interface R { a: f32; r: R; }\nexport { R };', ''),
      R_CYCLE,
    ],
    [
      'exported and unused, through a struct that is not exported',
      program('export interface A { x: f32; b: B; }\ninterface B { y: f32; a: A; }', ''),
      cycle('B.a', ['A', 'B', 'A']),
    ],
  ];

  for (const [name, source, message] of refused) {
    it(`is refused once, in both halves: ${name}`, () => {
      const { compiler, editor, compiled } = bothHalves(source);
      expect(compiler).toEqual(ONE(message));
      expect(editor).toEqual(ONE(message));
      expect(compiled.wgsl).toBeUndefined();
    });
  }

  it('is refused on the field that closes the cycle', () => {
    const source = program(
      'interface A { x: f32; b: B; }\ninterface B { y: f32; a: A; }',
      'let r: A;',
    );
    const [d] = compile(source, { fileName: FILE }).diagnostics;
    expect(source.slice(d!.start, d!.start + d!.length)).toBe('a: A;');
    const service = createTypeshadeLanguageService();
    service.openDocument(FILE, source);
    const [e] = service.getDiagnostics(FILE);
    expect(e!.range).toEqual({
      start: { line: 2, character: 22 },
      end: { line: 2, character: 27 },
    });
  });

  it('a read of the refused field says nothing more', () => {
    const { compiler, editor } = bothHalves(
      program('interface R { a: f32; r: R; }', 'let r: R = { a: 1. }; let q = r.r; q.a = 2.;'),
    );
    expect(compiler[0]).toBe(ONE(R_CYCLE)[0]);
    expect(compiler.filter((d) => d.includes('"r"') || d.includes('.r'))).toEqual(ONE(R_CYCLE));
    expect(editor[0]).toBe(ONE(R_CYCLE)[0]);
  });

  it('is refused in the file that declares it, when another file imports it', () => {
    const files = { '/p/r.ts': `${H}export interface R { a: f32; r: R; }\n` };
    const source = `${H}import { R } from './r.js';\n@compute([1]) export function main(): void { let r: R; }\n`;
    const { compiled, editor } = bothHalves(source, files);
    expect(compiled.diagnostics.map((d) => `${d.fileName} ${d.code} ${d.message}`)).toEqual([
      `/p/r.ts ${TS_CODES.STRUCT_FIELD} ${R_CYCLE}`,
    ]);
    expect(editor).toEqual([]);
    const service = createTypeshadeLanguageService({ readDocument: (f) => files[f as '/p/r.ts'] });
    service.openDocument('/p/r.ts', files['/p/r.ts']);
    expect(service.getDiagnostics('/p/r.ts').map((d) => `${String(d.code)} ${d.message}`)).toEqual(
      ONE(R_CYCLE),
    );
    const report = checkDocuments([{ path: 'a.ts', uri: FILE, text: source }], {
      readDocument: (f) => files[f as '/p/r.ts'],
    });
    expect(report.diagnostics.map((d) => `${d.file} ${String(d.code)}`)).toEqual([
      `r.ts ${TS_CODES.STRUCT_FIELD}`,
    ]);
  });

  it('tshc check reports it once and does not throw', () => {
    const source = program('interface R { a: f32; r: R; }');
    const report = checkDocuments([{ path: 'a.ts', uri: FILE, text: source }]);
    expect(report.diagnostics.map((d) => `${String(d.code)} ${d.message}`)).toEqual(ONE(R_CYCLE));
  });

  // Neither exported nor used: unchecked, as every other rule leaves such a declaration.
  it('an interface neither exported nor used stays unchecked', () => {
    const { compiler, editor } = bothHalves(program('interface R { a: f32; r: R; }', ''));
    expect(compiler).toEqual([]);
    expect(editor).toEqual([]);
  });

  const neighbours: readonly (readonly [string, string])[] = [
    [
      'a struct that holds another struct',
      program(
        'interface Q { a: f32; }\ninterface R { q: Q; b: f32; }',
        'let r: R = { q: { a: 1. }, b: 2. }; r.b = r.q.a;',
      ),
    ],
    [
      'a struct reached twice by two paths',
      program(
        'interface Q { a: f32; }\ninterface P { q: Q; }\ninterface R { p: P; q: Q; }',
        'let r: R = { p: { q: { a: 1. } }, q: { a: 2. } }; r.q.a = r.p.q.a;',
      ),
    ],
    [
      'a struct with a runtime array of another struct',
      `${H}interface Q { a: f32; }\ninterface R { n: u32; xs: array<Q>; }\n` +
        'declare const buf: storage<R, "read_write">;\n' +
        '@compute([1]) export function main(): void { buf.n = buf.xs.length; }\n',
    ],
  ];

  for (const [name, source] of neighbours) {
    it(`the neighbour compiles in both halves: ${name}`, () => {
      const { compiler, editor, compiled } = bothHalves(source);
      expect(compiler).toEqual([]);
      expect(editor).toEqual([]);
      expect(compiled.wgsl).toBeDefined();
    });
  }
});
