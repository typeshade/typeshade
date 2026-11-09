// #321 classes#14: a refused generic call has one type-argument count diagnostic.
// Verifies: Rule 12.4, Rule 12.5, Rule 12.7 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { compileTsSource } from '../compiler/ts/source-file.js';
import { checkDocuments } from './check.js';
import { mergeDiagnostics } from './diagnostics.js';
import { analyzeSourceFile, createTypeshadeLanguageServiceWith } from './service.js';
import type { TypeshadeDiagnostic } from './types.js';

const URI = '/generic-arity.shade.ts';
const shader = (body: string): string => `"use typeshade";\n${body}`;
const id = 'function id<T>(x: T): T { return x; }';
const plain = 'function plain(x: f32): f32 { return x; }';
const box = 'class Box<T> { value: T; constructor(value: T) { this.value = value; } }';
const run = (body: string, expression: string): string =>
  shader(`${body} export function run(): f32 { return ${expression}; }`);

function both(source: string, merge = true) {
  const service = createTypeshadeLanguageServiceWith({}, analyzeSourceFile, { merge });
  service.openDocument(URI, source);
  try {
    return { compiler: compile(source, { fileName: URI }), editor: service.getDiagnostics(URI) };
  } finally {
    service.closeDocument(URI);
  }
}

const cases = [
  ['function, too many', run(id, 'id<f32, i32>(1.)'), 'id<f32, i32>(1.)', 'id', '1', '2'],
  [
    'function, too few',
    run('function id<T, U>(x: T): T { return x; }', 'id<f32>(1.)'),
    'id<f32>(1.)',
    'id',
    '2',
    '1',
  ],
  [
    'class construction',
    run(box, 'new Box<f32, i32>(1.).value'),
    'new Box<f32, i32>(1.)',
    'Box',
    '1',
    '2',
  ],
  [
    'class with a default',
    run(
      'class Cell<T, U = i32> { value: T; constructor(value: T) { this.value = value; } }',
      'new Cell<f32, i32, u32>(1.).value',
    ),
    'new Cell<f32, i32, u32>(1.)',
    'Cell',
    '1 to 2',
    '3',
  ],
  [
    'namespace function',
    run('namespace N { export function id<T>(x: T): T { return x; } }', 'N.id<f32, i32>(1.)'),
    'N.id<f32, i32>(1.)',
    'id',
    '1',
    '2',
  ],
  [
    'commented type list',
    run(id, 'id< /* first */ f32, /* second */ i32 >(1.)'),
    'id< /* first */ f32, /* second */ i32 >(1.)',
    'id',
    '1',
    '2',
  ],
] as const;

describe('generic type-argument arity is merged only with its compiler refusal', () => {
  it.each(cases)(
    '%s keeps the compiler sentence and whole-call span',
    (_name, source, call, name, count, got) => {
      const { compiler, editor } = both(source);
      const expected = {
        code: 'TS8019',
        message: `"${name}" takes ${count} type argument(s), got ${got}.`,
        start: source.indexOf(call),
        length: call.length,
      };
      expect(
        compiler.diagnostics.map(({ code, message, start, length }) => ({
          code,
          message,
          start,
          length,
        })),
      ).toEqual([expected]);
      expect(editor.map(({ code, message, span }) => ({ code, message, ...span }))).toEqual([
        expected,
      ]);
      expect(editor[0]).toMatchObject({ severity: 'error', source: 'typeshade', uri: URI });
      const checked = checkDocuments([{ uri: URI, path: URI, text: source }]);
      expect(
        checked.diagnostics.map(({ code, message, offset, length }) => ({
          code,
          message,
          start: offset,
          length,
        })),
      ).toEqual([expected]);
    },
  );

  it.each(cases)('%s keeps TypeScript TS2558 when merging is disabled', (_name, source) => {
    const { editor } = both(source, false);
    expect(editor.filter((d) => d.source === 'typescript').map((d) => d.code)).toEqual([2558]);
    expect(editor.filter((d) => d.source === 'typeshade').map((d) => d.code)).toEqual(['TS8019']);
  });

  it('keeps a separate TypeScript-only type-argument mistake', () => {
    const source = shader(`${id} ${plain} export function run(): f32 {
      const x = id<f32, i32>(1.); return plain<f32>(1.);
    }`);
    const { compiler, editor } = both(source);
    expect(compiler.diagnostics.map((d) => d.code)).toEqual(['TS8019']);
    expect(editor.map((d) => d.code)).toEqual(['TS8019', 2558]);
    expect(editor[1]).toMatchObject({
      message: 'Expected 0 type arguments, but got 1.',
      span: { start: source.lastIndexOf('f32>'), length: 3 },
    });
  });

  it('keeps TypeScript TS2558 when the compiler accepts the call', () => {
    const { compiler, editor } = both(run(plain, 'plain<f32>(1.)'));
    expect(compiler.diagnostics).toEqual([]);
    expect(editor.map((d) => d.code)).toEqual([2558]);
  });

  it('keeps a type-argument mistake beside a value-argument count on the same call', () => {
    const { compiler, editor } = both(run(plain, 'plain<f32>()'));
    expect(compiler.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      { code: 'TS8019', message: '"plain" expects 1 argument(s), got 0.' },
    ]);
    expect(editor.map((d) => d.code)).toEqual(['TS8019', 2558]);
  });

  it.each([
    [
      'instance method',
      'class C { value<T>(x: T): T { return x; } }',
      'new C().value<f32, i32>(1.)',
    ],
    [
      'static method',
      'class C { static value<T>(x: T): T { return x; } }',
      'C.value<f32, i32>(1.)',
    ],
  ])('keeps TS2558 beside the distinct %s type mismatch', (_name, declaration, call) => {
    const { compiler, editor } = both(run(declaration!, call!));
    expect(compiler.diagnostics.map((d) => d.code)).toEqual(['TS8003']);
    expect(editor.map((d) => d.code)).toEqual(['TS8003', 2558]);
    expect(editor[0]?.message).toBe('Argument 1 of "C.value" type mismatch.');
  });

  it('keeps TS2558 beside an uninstantiated class refusal', () => {
    const { compiler, editor } = both(
      run(box.replace('Box<T>', 'Box<T, U>'), 'new Box<f32>(1.).value'),
    );
    expect(compiler.diagnostics.map((d) => d.code)).toEqual(['TS8035']);
    expect(editor.map((d) => d.code)).toEqual(['TS8035', 2558]);
  });

  it.each([run(id, 'id<f32>(2.)'), run(id, 'id(2.)'), run(box, 'new Box<f32>(2.).value')])(
    'keeps valid calls accepted and executable',
    (source) => {
      const { compiler, editor } = both(source);
      expect(compiler.diagnostics).toEqual([]);
      expect(editor).toEqual([]);
      expect(compiler.eval('run', [])).toBe(2);
      expect(compiler.wgsl).toBeDefined();
      expect(compiler.glsl).toBeDefined();
    },
  );
});

describe('generic arity merging requires the same error and exact call', () => {
  const source = run(id, 'id<f32, i32>(id<f32, i32>(1.))');
  const analysis = compileTsSource(source, { fileName: URI, emit: false });
  const make = (code: string | number, start: number, length: number): TypeshadeDiagnostic => ({
    uri: URI,
    range: {
      start: { line: 1, character: start - 17 },
      end: { line: 1, character: start + length - 17 },
    },
    span: { start, length },
    severity: 'error',
    message:
      typeof code === 'number'
        ? 'Expected 1 type arguments, but got 2.'
        : '"id" takes 1 type argument(s), got 2.',
    code,
    source: typeof code === 'number' ? 'typescript' : 'typeshade',
  });
  const typescript = make(2558, source.indexOf('f32, i32'), 'f32, i32'.length);
  const compiler = make(
    'TS8019',
    source.indexOf('id<f32'),
    'id<f32, i32>(id<f32, i32>(1.))'.length,
  );
  const merge = (t = typescript, c = compiler, a: typeof analysis | undefined = analysis) =>
    mergeDiagnostics(analysis.sourceFile, [t], [c], a, undefined);

  it('merges matching error codes at the type list and whole call', () => {
    expect(merge()).toEqual([compiler]);
  });
  it('keeps an inner call type-count mistake under an outer refusal', () => {
    expect(merge(make(2558, source.lastIndexOf('f32, i32'), 'f32, i32'.length))).toHaveLength(2);
  });
  it('keeps an outer call type-count mistake above an inner refusal', () => {
    expect(
      merge(typescript, make('TS8019', source.lastIndexOf('id<f32'), 'id<f32, i32>(1.)'.length)),
    ).toHaveLength(2);
  });
  it('keeps another TypeScript code', () => {
    expect(merge({ ...typescript, code: 2344 })).toHaveLength(2);
  });
  it('keeps a compiler error about a different mistake', () => {
    expect(merge(typescript, { ...compiler, code: 'TS8003' })).toHaveLength(2);
  });
  it('keeps a value-argument arity mistake at the same call', () => {
    expect(
      merge(typescript, { ...compiler, message: '"id" expects 1 argument(s), got 0.' }),
    ).toHaveLength(2);
  });
  it('keeps a TypeScript warning', () => {
    expect(merge({ ...typescript, severity: 'warning' })).toHaveLength(2);
  });
  it('does not use a compiler warning to hide a TypeScript error', () => {
    expect(merge(typescript, { ...compiler, severity: 'warning' })).toHaveLength(2);
  });
  it('keeps an error in another document', () => {
    expect(merge(typescript, { ...compiler, uri: '/other.shade.ts' })).toHaveLength(2);
  });
  it('requires the whole compiler call span', () => {
    expect(
      merge(typescript, {
        ...compiler,
        span: { ...compiler.span, length: compiler.span.length + 1 },
      }),
    ).toHaveLength(2);
  });
  it('requires the whole TypeScript type-argument list', () => {
    expect(merge({ ...typescript, span: { ...typescript.span, length: 3 } })).toHaveLength(2);
  });
  it('keeps diagnostics without compiler analysis', () => {
    expect(
      mergeDiagnostics(analysis.sourceFile, [typescript], [compiler], undefined, undefined),
    ).toHaveLength(2);
  });
  it('keeps diagnostics when the analysis is stale', () => {
    expect(
      merge(typescript, compiler, compileTsSource(source + '\n', { fileName: URI, emit: false })),
    ).toHaveLength(2);
  });
});
