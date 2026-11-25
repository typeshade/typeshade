import { describe, expect, it } from 'vitest';
import { bothHalves } from '../../core/testing/both-halves.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';

const program = (...lines: string[]): string => `"use typeshade"\n${lines.join('\n')}`;

describe('emit: false lowers the program and writes no shader text', () => {
  const source = program('export function f(): f32 { return 1.; }');

  it('keeps the functions and drops the WGSL', () => {
    const emitted = compileTsSource(source);
    const lowered = compileTsSource(source, { emit: false });
    expect(emitted.wgsl).toContain('fn f()');
    expect(lowered.wgsl).toBeUndefined();
    expect(lowered.funcs.map((f) => f.name)).toEqual(emitted.funcs.map((f) => f.name));
  });

  it('reports the diagnostics that emitting reports', () => {
    const refused = program('export function f(): u32 { return 4294967296; }');
    const halves = bothHalves(refused);
    const lowered = compileTsSource(refused, { emit: false });
    expect(lowered.diagnostics.map((d) => `typeshade ${d.code}: ${d.message}`)).toEqual([
      ...halves.compiler,
    ]);
    expect(lowered.wgsl).toBeUndefined();
  });
});

describe('a directive that is not the first statement of a file the program keeps', () => {
  const D = '"use typeshade";\n';
  const LATE =
    'TS8069 "use typeshade" must be the file\'s first statement: here it follows a variable declaration, so TypeScript reads it as an ordinary string and not as a directive. Move it to the top of the file.';
  const MAIN = '/p/main.shade.ts';
  const LATE_FILE = '/p/late.shade.ts';
  const files = (body: string): Record<string, string> => ({
    [MAIN]: `${D}import { used } from "./used.shade.ts";\nimport { unused } from "./late.shade.ts";\nexport function f(): f32 { return ${body}; }\n`,
    '/p/used.shade.ts': `${D}export function used(): f32 { return 1.; }\n`,
    [LATE_FILE]: `export const x = 1;\n"use typeshade";\nexport function unused(): f32 { return 2.; }\n`,
  });
  const compiled = (all: Record<string, string>): string[] =>
    compile(all[MAIN]!, { fileName: MAIN, readDocument: (f) => all[f] }).diagnostics.map(
      (d) => `${d.fileName} ${d.code} ${d.message}`,
    );
  const edited = (all: Record<string, string>, uri: string): string[] => {
    const service = createTypeshadeLanguageService({ readDocument: (u) => all[u] });
    service.openDocument(uri, all[uri]!);
    return service.getDiagnostics(uri).map((d) => `${d.code} ${d.message}`);
  };

  it('is reported in that file, where the editor reports it too', () => {
    const all = files('used() + unused()');
    expect(compiled(all)).toEqual([`${LATE_FILE} ${LATE}`]);
    expect(edited(all, LATE_FILE)).toEqual([LATE]);
  });

  it('is not reported in a file no used declaration reaches', () => {
    expect(compiled(files('used()'))).toEqual([]);
  });
});

describe('a chain of functions that decide each other past the most passes', () => {
  const chain = Array.from({ length: 17 }, (_, i) =>
    i === 16 ? `function g${i}() { return 3; }` : `function g${i}() { return g${i + 1}(); }`,
  ).join('\n');
  const source = program(
    chain,
    'function k() { return 7; }',
    'export function t(vi: u32): u32 { return vi + g0() + k(); }',
    'export function bad(): u32 { return 4294967296; }',
  );

  it('names the f32 it kept at the one call, and leaves any other refusal as it stands', () => {
    const halves = bothHalves(source);
    const lines = [
      'typeshade TS8003: Function "g15" returns u32 where its calls use it and f32 at a "return"; a function returns one type (Rule 8.19): make them agree, or write the return type. "g16" returns the f32 the compiler chose: its result passes through more functions whose calls decide it than the compiler follows. Write its result type, for example "function g16(): u32".',
      'typeshade TS8003: The value has to fit: 4294967296 is outside u32, which holds 0 to 4294967295 (§13).',
    ];
    expect(halves.compiler).toEqual(lines);
    expect(halves.editor).toEqual(lines);
  });
});
