// #321 classes#14: a call names the identifier the author wrote, not its lifted function.
// Verifies: Rule 12.5, Rule 12.7 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { checkDocuments } from '../../language-service/check.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const FILE = '/app/local-call.shade.ts';
const shader = (body: string): string => `"use typeshade";\n${body}`;
const functionOf = (declaration: string, call = 'local()'): string =>
  shader(`export function run(): f32 { ${declaration} return ${call}; }`);
const local = 'function local(x: f32): f32 { return x; }';
const missing = '"local" expects 1 argument(s), got 0.';

function paired(source: string, other: Readonly<Record<string, string>> = {}) {
  const files: Record<string, string> = { ...other, [FILE]: source };
  const readDocument = (uri: string) => files[uri];
  const result = compile(source, { fileName: FILE, readDocument });
  const checked = checkDocuments(
    Object.entries(files).map(([uri, text]) => ({ path: uri, uri, text })),
    { readDocument },
  );
  const compiler = result.diagnostics.map(
    ({ fileName, code, category, message, start, length }) => ({
      file: fileName,
      code,
      severity: category,
      message,
      start,
      length,
    }),
  );
  expect(
    checked.diagnostics.map(({ file, code, severity, message, offset, length }) => ({
      file,
      code,
      severity,
      message,
      start: offset,
      length,
    })),
  ).toEqual(compiler);
  const service = createTypeshadeLanguageService({ readDocument });
  for (const [uri, text] of Object.entries(files)) service.openDocument(uri, text);
  try {
    for (const file of Object.keys(files)) {
      expect(
        service.getDiagnostics(file).map(({ code, severity, message, span }) => ({
          file,
          code,
          severity,
          message,
          start: span.start,
          length: span.length,
        })),
      ).toEqual(compiler.filter((d) => d.file === file));
    }
  } finally {
    for (const file of Object.keys(files)) service.closeDocument(file);
  }
  return result;
}

const cases = [
  ['function declaration', functionOf(local), 'local()', missing],
  ['arrow', functionOf('const local = (x: f32): f32 => x;'), 'local()', missing],
  [
    'function expression',
    functionOf('const local = function (x: f32): f32 { return x; };'),
    'local()',
    missing,
  ],
  [
    'block-scoped function',
    shader(`export function run(): f32 { if (true) { ${local} return local(); } return 0.; }`),
    'local()',
    missing,
  ],
  [
    'nested function',
    shader(`export function run(): f32 {
      function middle(): f32 { ${local} return local(); }
      return middle();
    }`),
    'local()',
    missing,
  ],
  [
    'instance method',
    shader(`class C { value(): f32 { ${local} return local(); } }
      export function run(): f32 { return new C().value(); }`),
    'local()',
    missing,
  ],
  [
    'static method',
    shader(`class C { static value(): f32 { ${local} return local(); } }
      export function run(): f32 { return C.value(); }`),
    'local()',
    missing,
  ],
  [
    'namespace',
    shader(`namespace N { export function value(): f32 { ${local} return local(); } }
      export function run(): f32 { return N.value(); }`),
    'local()',
    missing,
  ],
  [
    'generic enclosing function',
    shader(`function value<T>(unused: T): f32 { ${local} return local(); }
      export function run(): f32 { return value(1.); }`),
    'local()',
    missing,
  ],
  [
    'too many arguments',
    functionOf(local, 'local(1., 2.)'),
    'local(1., 2.)',
    '"local" expects 1 argument(s), got 2.',
  ],
  [
    'defaulted parameter',
    functionOf('function local(x: f32, y: f32 = 1.): f32 { return x + y; }'),
    'local()',
    '"local" expects 2 argument(s), got 0.',
  ],
  [
    'argument type mismatch',
    functionOf(local, 'local(i32(1))'),
    'local(i32(1))',
    'Argument 1 of "local" type mismatch.',
  ],
] as const;

describe('a local call diagnostic keeps the authored name', () => {
  it.each(cases)(
    '%s has the same name and source span in compiler and editor',
    (_name, source, call, message) => {
      const result = paired(source);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]).toMatchObject({
        fileName: FILE,
        code: _name === 'argument type mismatch' ? 'TS8003' : 'TS8019',
        category: 'error',
        message,
        start: source.lastIndexOf(call),
        length: call.length,
      });
      expect(result.wgsl).toBeUndefined();
      expect(result.glsl).toBeUndefined();
    },
  );

  it('keeps the imported origin and call span of a lifted function', () => {
    const library = '/app/library.shade.ts';
    const body = shader(`export function value(): f32 { ${local} return local(); }`);
    const source = shader(
      'import { value } from "./library.shade"; export function run(): f32 { return value(); }',
    );
    const result = paired(source, { [library]: body });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      fileName: library,
      code: 'TS8019',
      category: 'error',
      message: missing,
      start: body.lastIndexOf('local()'),
      length: 'local()'.length,
    });
  });

  it('keeps capture parameters out of the written arity and keeps its existing name', () => {
    const source = shader(`export function run(n: f32): f32 {
      function local(x: f32): f32 { return x + n; }
      return local();
    }`);
    const result = paired(source);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'TS8019',
      message: missing,
      start: source.lastIndexOf('local()'),
      length: 'local()'.length,
    });
  });

  it('keeps an independent unknown name beside the authored call diagnostic', () => {
    const source = shader(`export function run(): f32 {
      ${local}
      const bad: f32 = absent;
      const value = local();
      return value;
    }`);
    const result = paired(source);
    expect(result.diagnostics.map((d) => d.code)).toEqual(['TS8022', 'TS8019']);
    expect(result.diagnostics[1]!.message).toBe(missing);
    expect(result.diagnostics[0]!.message).toContain('"absent"');
  });

  it('keeps a call before its captured declaration refused with its existing remedy', () => {
    const source = shader(`export function run(): f32 {
      const first = local();
      let n: f32 = 2.;
      function local(): f32 { return n; }
      return first;
    }`);
    const result = paired(source);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'TS8022',
      message:
        '"local" reads "n", which is not declared yet where "local" is called: ' +
        'a let or a const is not there before its declaration, and TypeScript throws. ' +
        'Call "local" after "n" is declared.',
      start: source.indexOf('local()'),
      length: 'local()'.length,
    });
  });

  it.each([
    functionOf(local, 'local(2.)'),
    functionOf('const local = (x: f32): f32 => x;', 'local(2.)'),
    shader(`export function run(): f32 {
      let n: f32 = 1.;
      function local(x: f32): f32 { n += x; return n; }
      return local(1.);
    }`),
  ])('keeps valid calls and read/write captures executable', (source) => {
    const result = paired(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.eval('run', [])).toBe(2);
    expect(result.wgsl).toBeDefined();
    expect(result.glsl).toBeDefined();
  });
});
