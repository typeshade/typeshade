import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSources } from './module.js';
import { linkProgram } from './link.js';
import { TS_CODES } from './codes.js';

const D = '"use typeshade";\n';

type Files = Readonly<Record<string, string>>;

const entryOf = (files: Files): string => Object.keys(files)[0]!;

const compiled = (files: Files) =>
  compile(files[entryOf(files)]!, { fileName: entryOf(files), readDocument: (f) => files[f] });

const linked = (files: Files) =>
  linkProgram([{ fileName: entryOf(files), text: files[entryOf(files)]! }], {
    readDocument: (f) => files[f],
  });

describe('the stem of a generated name is a name', () => {
  const helperIn = (file: string): Files => ({
    '/p/main.shade.ts': `${D}import { g } from "${file}";\nfunction hash(): f32 {\n  return 1.;\n}\nexport function f(): f32 {\n  return hash() + g();\n}\n`,
    [`/p${file.slice(1)}`]: `${D}function hash(): f32 {\n  return 2.;\n}\nexport function g(): f32 {\n  return hash();\n}\n`,
  });

  it.each([
    ['./1.shade.ts', 'm1_hash'],
    ['./_b.shade.ts', 'b_hash'],
    ['./_.shade.ts', 'module_hash'],
    ['./a-b.shade.ts', 'a_b_hash'],
  ])('%s gives %s', (file, name) => {
    const result = compiled(helperIn(file));
    expect(result.diagnostics).toEqual([]);
    expect(result.wgsl).toContain(`fn ${name}()`);
  });
});

describe('a local keeps its name when its own file already holds the top-level name', () => {
  it('leaves a parameter alone beside the top-level name of its file', () => {
    const result = compiled({
      '/p/main.shade.ts': `${D}import { g, h } from "./lib.shade.ts";\nconst u: f32 = 1.;\nexport function f(): f32 {\n  return u + g(2.) + h();\n}\n`,
      '/p/lib.shade.ts': `${D}const u: f32 = 5.;\nexport function g(u: f32): f32 {\n  return u * 2.;\n}\nexport function h(): f32 {\n  return u;\n}\n`,
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.wgsl).toContain('fn g(u: f32)');
    expect(result.wgsl).toContain('const lib_u: f32');
  });
});

describe('a name the host does not read is renamed freely', () => {
  it('declares a brand key in two files without a duplicate binding', () => {
    const result = compiled({
      '/p/main.shade.ts': `${D}import { g } from "./lib.shade.ts";\ndeclare const brand: unique symbol;\ntype M = f32 & { readonly [brand]: 'm' };\nexport function f(m: M): f32 {\n  return g(2.) + m;\n}\n`,
      '/p/lib.shade.ts': `${D}declare const brand: unique symbol;\ntype K = f32 & { readonly [brand]: 'k' };\nexport function g(k: K): f32 {\n  return k;\n}\n`,
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.module.bindings).toEqual([]);
  });
});

describe('a refused stage call still holds its entry point name', () => {
  it('reports two of one name as one entry point declared twice', () => {
    const result = compileTsSources([
      { fileName: 'a.ts', source: `${D}export const fs = fragment((): vec4 => vec4(1.));\n` },
      { fileName: 'b.ts', source: `${D}export const fs = fragment((): vec4 => vec4(0.));\n` },
    ]);
    const duplicate = result.diagnostics.filter((d) => d.code === TS_CODES.DUPLICATE_SYMBOL);
    expect(duplicate.map((d) => d.fileName)).toEqual(['b.ts']);
  });
});

describe('a span of the linked source maps back to the file it was written in', () => {
  const files: Files = {
    '/p/main.shade.ts': `${D}import { g } from "./lib.shade.ts";\nexport function f(x: f32): f32 {\n  return g(x);\n}\n`,
    '/p/lib.shade.ts': `${D}export function g(x: f32): f32 {\n  return x;\n}\n`,
  };

  it('ends a span that runs into the next file where its own file ends', () => {
    const program = linked(files);
    const start = program.source.indexOf('function g');
    const end = program.source.indexOf('return g') + 3;
    const span = program.map(start, end)!;
    expect(span.file.name).toBe('/p/lib.shade.ts');
    expect(span.end).toBe(files['/p/lib.shade.ts']!.indexOf('}') + 1);
  });
});

describe('a host name another file reads without an import', () => {
  it('is unknown to the file that reads it, and stays the host name', () => {
    const result = compiled({
      '/p/main.shade.ts': `${D}import { g } from "./lib.shade.ts";\nexport function f(): f32 {\n  return gain + g();\n}\n`,
      '/p/lib.shade.ts': `${D}const gain: override<f32> = 2.;\nexport function g(): f32 {\n  return gain;\n}\n`,
    });
    const unknown = result.diagnostics.filter((d) => d.code === TS_CODES.UNKNOWN_NAME);
    expect(unknown.map((d) => `${d.fileName}:${d.line}`)).toEqual(['/p/main.shade.ts:4']);
  });
});
