// Verifies: Rule 12.4, Rule 12.5, Rule 12.7 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { compileTsSource } from '../compiler/ts/source-file.js';
import { mergeDiagnostics } from './diagnostics.js';
import { analyzeSourceFile, createTypeshadeLanguageServiceWith } from './service.js';
import type { TypeshadeDiagnostic } from './types.js';

const URI = '/module-variable.shade.ts';
const shader = (body: string): string => `"use typeshade";\n${body}`;
const removed =
  'perInvocation<T> was removed: a top-level let is already the per-invocation variable. ';

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
  {
    name: 'retired wrapper with an argument',
    body: 'let seed: perInvocation<u32> = 7;',
    at: 'perInvocation<u32>',
    typescript: 2304,
    message: `${removed}Drop the wrapper and write let seed: u32.`,
  },
  {
    name: 'retired wrapper without an argument',
    body: 'let seed: perInvocation;',
    at: 'perInvocation',
    typescript: 2304,
    message: `${removed}Drop the wrapper and write let seed: T.`,
  },
  {
    name: 'retired wrapper on a parameter',
    body: 'export function f(x: perInvocation<f32>): f32 { return x; }',
    at: 'perInvocation<f32>',
    typescript: 2304,
    message: `${removed}Drop the wrapper and write let name: T.`,
  },
  {
    name: 'workgroup declared const',
    body: 'const tile: workgroup<array<f32, 4>>;',
    at: 'tile: workgroup<array<f32, 4>>',
    typescript: 1155,
    message:
      '"tile" is a module variable and is declared with let, not const: let tile: workgroup<T>. ' +
      'A const is a module constant (§12).',
  },
  {
    name: 'workgroup without its type',
    body: 'let tile: workgroup;',
    at: 'workgroup',
    typescript: 2314,
    message: 'workgroup<T> needs a type argument.',
  },
] as const;

describe('module-variable mistakes have one diagnostic (#321 control#18)', () => {
  it.each(cases)('$name keeps the compiler text and exact source span', ({ body, at, message }) => {
    const source = shader(body);
    const { compiler, editor } = both(source);
    const expected = {
      code: 'TS8033',
      message,
      start: source.indexOf(at),
      length: at.length,
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
    expect(editor[0]?.severity).toBe('error');
    expect(editor[0]?.uri).toBe(URI);
  });

  it.each(cases)('$name keeps both halves when merging is disabled', ({ body, typescript }) => {
    expect(both(shader(body), false).editor.map((d) => d.code)).toEqual([typescript, 'TS8033']);
  });

  it('keeps each separate module-variable mistake', () => {
    const source = shader('let first: workgroup; let second: workgroup;');
    const { compiler, editor } = both(source);
    expect(compiler.diagnostics.map((d) => d.code)).toEqual(['TS8033', 'TS8033']);
    expect(editor.map((d) => d.code)).toEqual(['TS8033', 'TS8033']);
    expect(editor.map((d) => d.span.start)).toEqual([
      source.indexOf('workgroup'),
      source.lastIndexOf('workgroup'),
    ]);
  });

  it('keeps an independently unknown type inside the refused wrapper', () => {
    const source = shader('let seed: perInvocation<Missing>;');
    const { compiler, editor } = both(source);
    expect(compiler.diagnostics.map((d) => d.code)).toEqual(['TS8033', 'TS8002']);
    expect(editor.map((d) => d.code)).toEqual(['TS8033', 'TS8002']);
    expect(editor[1]?.message).toBe(compiler.diagnostics[1]?.message);
    expect(editor[1]?.message).toContain('Unknown type "Missing".');
    expect(editor[1]?.span).toEqual({ start: source.indexOf('Missing'), length: 7 });
  });

  it('keeps an independent unknown value after the refused declaration', () => {
    const { compiler, editor } = both(
      shader('let seed: perInvocation<u32>; export function f(): f32 { return missing; }'),
    );
    const expected = ['TS8033', 'TS8022'];
    expect(compiler.diagnostics.map((d) => d.code)).toEqual(expected);
    expect(editor.map((d) => d.code)).toEqual(expected);
    expect(editor[1]?.message).toBe('Unknown identifier "missing".');
  });

  it('keeps an unrelated generic arity error', () => {
    const source = shader('type Cell<T> = T; export function f(x: Cell): f32 { return 1.; }');
    const { compiler, editor } = both(source);
    expect(compiler.diagnostics).toEqual([]);
    expect(editor.map((d) => d.code)).toEqual([2314]);
    expect(editor[0]?.span).toEqual({ start: source.lastIndexOf('Cell'), length: 4 });
  });

  it.each([
    'let tile: workgroup<array<f32, 4>>; export const main = compute([1], function main() { tile[0] = 1.; });',
    'let seed: u32 = 7; export function f(): u32 { return seed; }',
  ])('keeps valid module variables accepted: %s', (body) => {
    const { compiler, editor } = both(shader(body));
    expect(compiler.diagnostics).toEqual([]);
    expect(editor).toEqual([]);
    expect(compiler.wgsl?.length).toBeGreaterThan(0);
  });
});

describe('module-variable merging requires the exact code, declaration and location', () => {
  const source = shader('let seed: perInvocation<u32>; let other: perInvocation<u32>;');
  const analysis = compileTsSource(source, { fileName: URI, emit: false });
  const nameStart = source.indexOf('perInvocation');
  const make = (code: string | number, start: number, length: number): TypeshadeDiagnostic => ({
    uri: URI,
    range: {
      start: { line: 1, character: start - 17 },
      end: { line: 1, character: start + length - 17 },
    },
    span: { start, length },
    severity: 'error',
    message: 'Independent merge boundary witness.',
    code,
    source: typeof code === 'number' ? 'typescript' : 'typeshade',
  });
  const typescript = make(2304, nameStart, 'perInvocation'.length);
  const compiler = make('TS8033', nameStart, 'perInvocation<u32>'.length);
  const merge = (t = typescript, c = compiler, a: typeof analysis | undefined = analysis) =>
    mergeDiagnostics(analysis.sourceFile, [t], [c], a, undefined);

  it('merges matching error codes at the wrapper and its name', () => {
    expect(merge()).toEqual([compiler]);
  });
  it('keeps a different TypeScript code', () => {
    expect(merge({ ...typescript, code: 2344 })).toHaveLength(2);
  });
  it('keeps a different compiler code', () => {
    expect(merge(typescript, { ...compiler, code: 'TS8003' })).toHaveLength(2);
  });
  it('keeps a TypeScript warning', () => {
    expect(merge({ ...typescript, severity: 'warning' })).toHaveLength(2);
  });
  it('does not use a compiler warning to hide an error', () => {
    expect(merge(typescript, { ...compiler, severity: 'warning' })).toHaveLength(2);
  });
  it('keeps diagnostics without compiler analysis', () => {
    expect(
      mergeDiagnostics(analysis.sourceFile, [typescript], [compiler], undefined, undefined),
    ).toHaveLength(2);
  });
  it('keeps diagnostics when the analysis is stale', () => {
    const stale = compileTsSource(source + '\n', { fileName: URI, emit: false });
    expect(merge(typescript, compiler, stale)).toHaveLength(2);
  });
  it('keeps an error at a different declaration', () => {
    expect(
      merge(make(2304, source.lastIndexOf('perInvocation'), 'perInvocation'.length)),
    ).toHaveLength(2);
  });
  it('keeps an error from a different document', () => {
    expect(merge(typescript, { ...compiler, uri: '/other.shade.ts' })).toHaveLength(2);
  });
  it('keeps an error when only the start, not the wrapper span, matches', () => {
    expect(merge(typescript, make('TS8033', nameStart, source.length - nameStart))).toHaveLength(2);
  });
  it('keeps an error when the compiler span covers only the name', () => {
    expect(merge(typescript, make('TS8033', nameStart, 'perInvocation'.length))).toHaveLength(2);
  });

  it.each([
    [2304, 'let missing: f32;', 'missing'],
    [1155, 'const ordinary: f32;', 'ordinary'],
    [2314, 'type Cell<T> = T; let value: Cell;', 'Cell'],
  ] as const)(
    'does not pair TS%s with an unrelated TS8033 at the same name',
    (code, body, name) => {
      const text = shader(body);
      const a = compileTsSource(text, { fileName: URI, emit: false });
      const start = text.lastIndexOf(name);
      const t = make(code, start, name.length);
      const c = make('TS8033', start, name.length);
      expect(mergeDiagnostics(a.sourceFile, [t], [c], a, undefined)).toEqual([t, c]);
    },
  );
});
