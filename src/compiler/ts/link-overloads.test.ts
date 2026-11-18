import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { linkProgram } from './link.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import type { TypeshadeDiagnostic } from '../../language-service/types.js';

/** A program: file path to text, the entry first. */
type Files = Readonly<Record<string, string>>;

const D = '"use typeshade";\n';

const entryOf = (files: Files): string => Object.keys(files)[0]!;

/** `compile()` of the entry, reading the rest of the program from `files`. */
const compiled = (files: Files) => {
  const entry = entryOf(files);
  return compile(files[entry]!, { fileName: entry, readDocument: (f) => files[f] });
};

/** The editor's merged list for the entry, the other files read through the host. */
const edited = (files: Files, uri = entryOf(files)) => {
  const service = createTypeshadeLanguageService({ readDocument: (u) => files[u] });
  service.openDocument(uri, files[uri]!);
  return service.getDiagnostics(uri);
};

const errorsOf = (files: Files): string[] =>
  compiled(files)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.fileName}:${d.line}:${d.character} ${d.code} ${d.message}`);

describe('an overloaded function is imported whole (Rule 3.9, Rule 12.7, #1195)', () => {
  // A function's overload signatures are statements of their own above the one with the body.
  // The linker kept the first statement that declares the name, a signature, and left out the
  // implementation, so the front end read a function with no body (TS8020). Each program here
  // is the one-file program split in two, read by both halves on the same files.
  const LUM =
    'export function lum(c: vec3): f32;\n' +
    'export function lum(c: vec3): f32;\n' +
    'export function lum(c: vec3): f32 {\n  return dot(c, vec3(0.2126, 0.7152, 0.0722));\n}\n';
  const FS =
    '@fragment export function fs(): vec4 {\n  return vec4(lum(vec3(1., 0., 0.)), 0., 0., 1.);\n}\n';
  const ONE: Files = { '/p/main.shade.ts': `${D}${LUM}${FS}` };
  const LIB = `${D}${LUM}`;
  const editedEach = (files: Files): string[] =>
    Object.keys(files).flatMap((uri) =>
      edited(files, uri).map((d) => `${uri} ${d.source} ${d.code} ${d.message}`),
    );
  const linkedSource = (files: Files): string =>
    linkProgram([{ fileName: entryOf(files), text: files[entryOf(files)]! }], {
      readDocument: (f) => files[f],
    }).source;

  const SPLIT: readonly (readonly [string, Files])[] = [
    [
      'a named import',
      {
        '/p/main.shade.ts': `${D}import { lum } from "./lib.shade.ts";\n${FS}`,
        '/p/lib.shade.ts': LIB,
      },
    ],
    [
      'a module namespace',
      {
        '/p/main.shade.ts': `${D}import * as lib from "./lib.shade.ts";\n@fragment export function fs(): vec4 {\n  return vec4(lib.lum(vec3(1., 0., 0.)), 0., 0., 1.);\n}\n`,
        '/p/lib.shade.ts': LIB,
      },
    ],
    [
      'a re-export by name',
      {
        '/p/main.shade.ts': `${D}import { lum } from "./mid.shade.ts";\n${FS}`,
        '/p/mid.shade.ts': `${D}export { lum } from "./lib.shade.ts";\n`,
        '/p/lib.shade.ts': LIB,
      },
    ],
    [
      '`export *`',
      {
        '/p/main.shade.ts': `${D}import { lum } from "./mid.shade.ts";\n${FS}`,
        '/p/mid.shade.ts': `${D}export * from "./lib.shade.ts";\n`,
        '/p/lib.shade.ts': LIB,
      },
    ],
    [
      'the entry exporting it again',
      {
        '/p/main.shade.ts': `${D}import { lum } from "./lib.shade.ts";\nexport { lum } from "./lib.shade.ts";\n${FS}`,
        '/p/lib.shade.ts': LIB,
      },
    ],
  ];
  for (const [name, files] of SPLIT) {
    it(`through ${name}: both halves accept it, and the emit is the one-file program's`, () => {
      expect(errorsOf(files)).toEqual([]);
      expect(editedEach(files)).toEqual([]);
      const one = compiled(ONE);
      expect(errorsOf(ONE)).toEqual([]);
      expect(editedEach(ONE)).toEqual([]);
      expect(one.module.funcs.map((f) => f.name)).toEqual(['lum', 'fs']);
      const r = compiled(files);
      expect(r.wgsl).toBe(one.wgsl);
      expect(r.glsl).toEqual(one.glsl);
      expect(r.module.funcs.map((f) => f.name)).toEqual(['lum', 'fs']);
      // Every statement of the function is in the linked source, and each keeps `export` only
      // where the entry exports the function again, as TypeScript requires of overloads.
      const kept = name === 'the entry exporting it again' ? 'export ' : '';
      expect(linkedSource(files)).toContain(
        `${kept}function lum(c: vec3): f32;\n${kept}function lum(c: vec3): f32;\n` +
          `${kept}function lum(c: vec3): f32 {`,
      );
    });
  }

  it('a function of the same name in a file the program does not reach stays out', () => {
    const files: Files = {
      '/p/main.shade.ts': `${D}import { g } from "./lib.shade.ts";\nimport { x } from "./other.shade.ts";\nexport function f(): f32 {\n  return g() + x;\n}\n`,
      '/p/lib.shade.ts': `${D}function lum(c: vec3): f32;\nfunction lum(c: vec3): f32 {\n  return c.x;\n}\nexport function g(): f32 {\n  return lum(vec3(1.));\n}\n`,
      '/p/other.shade.ts': `${D}export function lum(c: vec3): f32;\nexport function lum(c: vec3): f32 {\n  return c.y;\n}\nexport const x: f32 = 2.;\n`,
    };
    expect(errorsOf(files)).toEqual([]);
    expect(editedEach(files)).toEqual([]);
    const r = compiled(files);
    expect(r.module.funcs.map((fn) => fn.name)).toEqual(['lum', 'g', 'f']);
    expect(r.eval('f', [])).toBe(3);
  });

  it('only function declarations are overloads: a constant named like an interface stays out', () => {
    const files: Files = {
      '/p/main.shade.ts': `${D}import { g } from "./lib.shade.ts";\nexport function f(): f32 {\n  return g({ x: 1. });\n}\n`,
      '/p/lib.shade.ts': `${D}interface P {\n  x: f32;\n}\nconst P: f32 = 2.;\nexport function unused(): f32 {\n  return P;\n}\nexport function g(p: P): f32 {\n  return p.x;\n}\n`,
    };
    expect(errorsOf(files)).toEqual([]);
    expect(editedEach(files)).toEqual([]);
    const r = compiled(files);
    expect(r.module.consts.map((c) => c.name)).toEqual([]);
    expect(r.module.funcs.map((fn) => fn.name)).toEqual(['g', 'f']);
  });

  it('two implementations of one name in an imported file are TS8023, as they are in one file', () => {
    // Before the fix the module held the first one alone, and the program compiled.
    const twice =
      'export function lum(c: vec3): f32 {\n  return c.x;\n}\n' +
      'export function lum(c: vec3): f32 {\n  return c.y;\n}\n';
    const files: Files = {
      '/p/main.shade.ts': `${D}import { lum } from "./lib.shade.ts";\n${FS}`,
      '/p/lib.shade.ts': `${D}${twice}`,
    };
    const one: Files = { '/p/main.shade.ts': `${D}${twice}${FS}` };
    const said = (list: readonly string[]): string[] =>
      list.map((line) => line.slice(line.indexOf(' ') + 1));
    expect(said(errorsOf(one))).toEqual(['TS8023 Duplicate function "lum".']);
    expect(said(errorsOf(files))).toEqual(['TS8023 Duplicate function "lum".']);
    expect(errorsOf(files)[0]).toMatch(/^\/p\/lib\.shade\.ts:5:/);
    expect(compiled(files).wgsl).toBeUndefined();
    const typeshade = (list: readonly TypeshadeDiagnostic[]): string[] =>
      list.filter((d) => d.source === 'typeshade').map((d) => `${d.code} ${d.message}`);
    expect(typeshade(edited(one))).toEqual(['TS8023 Duplicate function "lum".']);
    expect(typeshade(edited(files, '/p/lib.shade.ts'))).toEqual([
      'TS8023 Duplicate function "lum".',
    ]);
  });

  it('renames every signature with the implementation when the name is taken (Rule 3.2)', () => {
    const files: Files = {
      '/p/main.shade.ts': `${D}import { lum as weighted } from "./lib.shade.ts";\nfunction lum(c: vec3): f32 {\n  return c.x;\n}\nexport function f(c: vec3): f32 {\n  return weighted(c) + weighted(c, 2.) + lum(c);\n}\n`,
      '/p/lib.shade.ts': `${D}export function lum(c: vec3): f32;\nexport function lum(c: vec3, k: f32): f32;\nexport function lum(c: vec3, k: f32 = 1.): f32 {\n  return c.y * k;\n}\n`,
    };
    expect(errorsOf(files)).toEqual([]);
    expect(editedEach(files)).toEqual([]);
    const r = compiled(files);
    expect(r.module.funcs.map((fn) => fn.name)).toEqual(['lib_lum', 'lum', 'f']);
    expect(r.eval('f', [[5, 3, 0]])).toBe(3 + 6 + 5);
  });

  it('keeps an overloaded helper the import reaches, and leaves out one it does not', () => {
    const files: Files = {
      '/p/main.shade.ts': `${D}import { g } from "./lib.shade.ts";\nexport function f(x: f32): f32 {\n  return g(x);\n}\n`,
      '/p/lib.shade.ts': `${D}function twice(x: f32): f32;\nfunction twice(x: f32): f32 {\n  return x * 2.;\n}\nexport function unused(x: f32): f32;\nexport function unused(x: f32): f32 {\n  return x;\n}\nexport function g(x: f32): f32 {\n  return twice(x);\n}\n`,
    };
    expect(errorsOf(files)).toEqual([]);
    expect(editedEach(files)).toEqual([]);
    const r = compiled(files);
    expect(r.module.funcs.map((fn) => fn.name)).toEqual(['twice', 'g', 'f']);
    expect(r.eval('f', [4])).toBe(8);
  });

  it("drops `export` from every signature of an entry's function the module renames", () => {
    // `lib` calls the builtin `fract`, so the entry's own `fract` is emitted under another name
    // and exported by the name the host reads.
    const files: Files = {
      '/p/main.shade.ts': `${D}import { g } from "./lib.shade.ts";\nexport function fract(x: f32): f32;\nexport function fract(x: f32): f32 {\n  return x + g();\n}\n`,
      '/p/lib.shade.ts': `${D}export function g(): f32 {\n  return fract(1.5);\n}\n`,
    };
    expect(errorsOf(files)).toEqual([]);
    expect(editedEach(files)).toEqual([]);
    const linked = linkProgram(
      [{ fileName: '/p/main.shade.ts', text: files['/p/main.shade.ts']! }],
      {
        readDocument: (f) => files[f],
      },
    );
    expect(linked.source).toContain(
      'function main_fract(x: f32): f32;\nfunction main_fract(x: f32): f32 {',
    );
    expect(linked.source).not.toContain('export function');
    expect(linked.exports).toEqual([
      { name: 'fract', emitted: 'main_fract', file: '/p/main.shade.ts' },
    ]);
    expect(compiled(files).eval('main_fract', [2])).toBe(2.5);
  });

  // The neighbours stay refused, with the code and the sentence of the one-file program
  // (Rule 12.5), in `compile()` and in the editor on the file that declares the function.
  const SENTENCE = 'Function "lum" needs a body (no ambient declarations).';
  const typeshadeOf = (list: readonly TypeshadeDiagnostic[]): string[] =>
    list.filter((d) => d.source === 'typeshade').map((d) => `${d.code} ${d.message}`);
  const NO_BODY: readonly (readonly [string, string, number])[] = [
    ['a signature and no body', 'export function lum(c: vec3): f32;\n', 1],
    [
      'two signatures and no body',
      'export function lum(c: vec3): f32;\nexport function lum(c: vec3): f32;\n',
      2,
    ],
    ['an ambient declaration', 'export declare function lum(c: vec3): f32;\n', 1],
  ];
  for (const [name, lum, count] of NO_BODY) {
    it(`an imported function with ${name} stays refused, in both halves`, () => {
      const files: Files = {
        '/p/main.shade.ts': `${D}import { lum } from "./lib.shade.ts";\n${FS}`,
        '/p/lib.shade.ts': `${D}${lum}`,
      };
      const one: Files = { '/p/main.shade.ts': `${D}${lum}${FS}` };
      const expected = Array.from({ length: count }, () => `TS8020 ${SENTENCE}`);
      const said = (list: readonly string[]): string[] =>
        list.map((line) => line.slice(line.indexOf(' ') + 1));
      expect(said(errorsOf(one))).toEqual(expected);
      expect(said(errorsOf(files))).toEqual(expected);
      expect(errorsOf(files).every((line) => line.startsWith('/p/lib.shade.ts:'))).toBe(true);
      expect(compiled(files).wgsl).toBeUndefined();
      expect(typeshadeOf(edited(one))).toEqual(expected);
      expect(typeshadeOf(edited(files, '/p/lib.shade.ts'))).toEqual(expected);
    });
  }
});
