// #321 classes#24: pin the remaining active class-member sentences in both readers.
// Verifies: Rule 12.4, Rule 12.5, Rule 12.7 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { compile } from './compile.js';
import { TS_CODES } from './codes.js';
import { makeDiagnostic } from './diagnostic.js';
import { parseParams } from './lower/function.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const FILE = '/class-member.shade.ts';
const shader = (body: string): string => `"use typeshade";\n${body}`;
const propertyMessage = (owner = 'A', name = 'x'): string =>
  `A decorator on the parameter property "${name}" decorates the parameter, not the ` +
  `field. Declare "${name}" as a field of "${owner}" to give it one.`;
const locationMessage =
  '"@location" does not apply to a parameter of a function that is not an entry: ' +
  "it marks an entry's input or output. Remove it.";

function paired(source: string, files: Readonly<Record<string, string>> = {}) {
  const documents: Record<string, string> = { ...files, [FILE]: source };
  const readDocument = (file: string) => documents[file];
  const result = compile(source, { fileName: FILE, readDocument });
  const service = createTypeshadeLanguageService({ readDocument });
  for (const [file, text] of Object.entries(documents)) service.openDocument(file, text);
  try {
    for (const file of Object.keys(documents)) {
      expect(
        service.getDiagnostics(file).map(({ code, message, span }) => ({ code, message, ...span })),
      ).toEqual(
        result.diagnostics
          .filter((d) => d.fileName === file)
          .map(({ code, message, start, length }) => ({ code, message, start, length })),
      );
    }
  } finally {
    for (const file of Object.keys(documents)) service.closeDocument(file);
  }
  return result;
}

function at(source: string, text: string, message: string, code = 'TS8035', fileName = FILE) {
  const start = source.indexOf(text);
  expect(start).toBeGreaterThanOrEqual(0);
  return { code, message, fileName, start, length: text.length };
}

function diagnostics(result: ReturnType<typeof compile>) {
  return result.diagnostics.map(({ code, message, fileName, start, length }) => ({
    code,
    message,
    fileName,
    start,
    length,
  }));
}

describe('class-member refusal sentences', () => {
  it('pins the index signature sentence and its whole signature span', () => {
    const source = shader(
      'class A { x!: f32; [k: string]: f32 } export function f(a: A): f32 { return a.x; }',
    );
    expect(diagnostics(paired(source))).toEqual([
      at(
        source,
        '[k: string]: f32',
        'An index signature has no layout; a struct is exactly the fields written here.',
      ),
    ]);
  });

  it('pins the mutating getter sentence at the destructured binding', () => {
    const source = shader(`class A { x: f32 = 1.; get next(): f32 { this.x += 1.; return this.x; } }
export function f(): f32 { const a = new A(); const { next: value } = a; return 1.; }`);
    expect(diagnostics(paired(source))).toEqual([
      at(
        source,
        'next: value',
        '"A.next" changes its object, and a pattern reads a copy of it that is dropped. Read it as a member instead, "const next = v.next".',
      ),
    ]);
  });

  it('keeps the former read-only super body accepted (#195)', () => {
    const source = shader(`class A { x: f32 = 1.; bump(): void { this.x += 1.; } }
class B extends A { bump(): void { super.bump(); this.x *= 2.; } }
export function f(): f32 { let b = new B(); b.bump(); return b.x; }`);
    const result = paired(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.eval('f', [])).toBe(4);
  });
});

describe('a decorated parameter property is refused once', () => {
  it.each([
    ['public', '@location(0)'],
    ['protected', '@location(0)'],
    ['private', '@bogus'],
    ['readonly', '@builtin("position")'],
    ['public readonly', '@location(0)'],
  ])('keeps the property sentence for %s %s', (modifier, decorator) => {
    const source = shader(`class A { y: f32 = 1.; constructor(${decorator} ${modifier} x: f32) {} }
export function f(a: A): f32 { return a.y; }`);
    expect(diagnostics(paired(source))).toEqual([at(source, decorator, propertyMessage())]);
  });

  it('keeps the generic property declaration origin', () => {
    const source = shader(`class A<T> { y!: T; constructor(@location(0) public x: T) {} }
export function f(a: A<f32>): f32 { return a.y; }`);
    expect(diagnostics(paired(source))).toEqual([
      at(source, '@location(0)', propertyMessage('A<f32>')),
    ]);
  });

  it('keeps the authored namespace class name', () => {
    const source =
      shader(`namespace N { export class A { y: f32 = 1.; constructor(@location(0) public x: f32) {} } }
export function f(a: N.A): f32 { return a.y; }`);
    expect(diagnostics(paired(source))).toEqual([
      at(source, '@location(0)', propertyMessage('N.A')),
    ]);
  });

  it('keeps the imported declaration file and span', () => {
    const library = shader(
      'export class A { y: f32 = 1.; constructor(@location(0) public x: f32) {} }',
    );
    const source = shader(
      'import { A } from "./lib.shade"; export function f(a: A): f32 { return a.y; }',
    );
    expect(diagnostics(paired(source, { '/lib.shade.ts': library }))).toEqual([
      at(library, '@location(0)', propertyMessage(), 'TS8035', '/lib.shade.ts'),
    ]);
  });

  it('keeps an independent decorator on the next ordinary constructor parameter', () => {
    const source =
      shader(`class A { y: f32 = 1.; constructor(@location(0) public x: f32, @location(1) z: f32) {} }
export function f(a: A): f32 { return a.y; }`);
    expect(diagnostics(paired(source))).toEqual([
      at(source, '@location(0)', propertyMessage()),
      at(source, '@location(1)', locationMessage, 'TS8028'),
    ]);
  });

  it.each([
    'class A { y: f32 = 1.; constructor(@location(0) x: f32) {} } export function f(a: A): f32 { return a.y; }',
    'class A { y: f32 = 1.; m(@location(0) x: f32): f32 { return x; } } export function f(a: A): f32 { return a.y; }',
    'export function f(@location(0) x: f32): f32 { return x; }',
  ])('still checks an ordinary parameter: %s', (body) => {
    const source = shader(body);
    expect(diagnostics(paired(source))).toEqual([
      at(source, '@location(0)', locationMessage, 'TS8028'),
    ]);
  });
});

describe('a signature skips only the property decorator already refused', () => {
  function signature() {
    const source = ts.createSourceFile(
      FILE,
      shader('class A { constructor(@location(0) public x: f32) {} }'),
      ts.ScriptTarget.Latest,
      true,
    );
    const cls = source.statements[1] as ts.ClassDeclaration;
    const ctor = cls.members[0] as ts.ConstructorDeclaration;
    const param = ctor.parameters[0]!;
    const decorator = ts.getDecorators(param)![0]!;
    return { source, param, decorator };
  }

  it('checks a property parameter when called without the struct collector', () => {
    const { source, param } = signature();
    const errors: ReturnType<typeof makeDiagnostic>[] = [];
    expect(parseParams([param], source, errors, [], undefined)).toBeDefined();
    expect(errors.map(({ code, message }) => ({ code, message }))).toEqual([
      { code: 'TS8028', message: locationMessage },
    ]);
  });

  it.each(['exact', 'other file', 'other span', 'short span', 'warning', 'other code'] as const)(
    'requires an exact existing refusal: %s',
    (kind) => {
      const { source, param, decorator } = signature();
      const original = makeDiagnostic(source, decorator, propertyMessage(), TS_CODES.CLASS_MEMBER);
      const primary: typeof original = {
        ...original,
        fileName: kind === 'other file' ? '/other.shade.ts' : original.fileName,
        start: original.start + (kind === 'other span' ? 1 : 0),
        length: original.length - (kind === 'short span' ? 1 : 0),
        category: kind === 'warning' ? 'warning' : original.category,
        code: kind === 'other code' ? TS_CODES.UNKNOWN_TYPE : original.code,
      };
      const errors = [primary];
      parseParams([param], source, errors, [], undefined);
      expect(errors).toEqual(
        kind === 'exact'
          ? [primary]
          : [primary, makeDiagnostic(source, decorator, locationMessage, TS_CODES.ATTRIBUTE_NAME)],
      );
    },
  );
});
