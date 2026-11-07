// #321 names#19: super() does not repeat a base constructor's signature refusal.
// Verifies: Rule 12.4 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 12.7 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const FILE = '/super.shade.ts';
const REST = 'Rest parameter "values" is not supported.';
const UNKNOWN =
  'Unknown type "Missing". Declare it in this file, or import it from another shader module.';
type Expected = { code: string; message: string; text: string; fileName?: string };

function paired(source: string, expected: Expected[], files: Record<string, string> = {}) {
  const documents: Record<string, string> = { ...files, [FILE]: source };
  const readDocument = (name: string) => documents[name];
  const result = compile(source, { fileName: FILE, readDocument });
  const wanted = expected.map(({ code, message, text, fileName = FILE }) => {
    const start = documents[fileName]!.indexOf(text);
    expect(start).toBeGreaterThanOrEqual(0);
    return { code, message, fileName, start, length: text.length };
  });
  expect(
    result.diagnostics.map(({ code, message, fileName, start, length }) => ({
      code,
      message,
      fileName,
      start,
      length,
    })),
  ).toEqual(wanted);
  const service = createTypeshadeLanguageService({ readDocument });
  for (const [name, text] of Object.entries(documents)) service.openDocument(name, text);
  try {
    const editor = Object.keys(documents).flatMap((name) => service.getDiagnostics(name));
    expect(
      editor.map(({ code, message, uri, span }) => ({
        code,
        message,
        fileName: uri,
        start: span.start,
        length: span.length,
      })),
    ).toEqual(wanted);
    if (expected.length === 0) expect(result.wgsl).toBeDefined();
    else expect(result.wgsl).toBeUndefined();
    return result;
  } finally {
    for (const name of Object.keys(documents)) service.closeDocument(name);
  }
}

const restBase = 'class B { x!: f32; constructor(...values: f32[]) { this.x = 1.; } }';
const derived = 'class D extends B { constructor() { super(); } }';
const useDerived = 'export function value(): f32 { return new D().x; }';
const restError: Expected = { code: 'TS8020', message: REST, text: '...values: f32[]' };

describe('a refused base constructor is diagnosed once', () => {
  it.each([
    ['concrete base', `${restBase}\n${derived}\n${useDerived}`],
    ['abstract base', `abstract ${restBase}\n${derived}\n${useDerived}`],
    [
      'namespace base',
      `namespace N { export ${restBase}\nexport ${derived} }\nexport function value(): f32 { return new N.D().x; }`,
    ],
    [
      'inherited constructor body',
      `${restBase}\n${derived}\nclass E extends D {}\nexport function value(): f32 { return new E().x; }`,
    ],
    [
      'two derived constructors',
      `${restBase}\n${derived}\nclass E extends B { constructor() { super(); } }\n${useDerived}`,
    ],
    [
      'new and super together',
      `${restBase}\n${derived}\n${useDerived}\nexport function base(): f32 { return new B().x; }`,
    ],
  ])('keeps the rest-parameter refusal for a %s', (_name, body) => {
    paired(`"use typeshade";\n${body}`, [restError]);
  });

  it('uses the instantiated generic base refusal', () => {
    paired(
      `"use typeshade";
class B<T> { x!: T; constructor(...values: T[]) {} }
class D extends B<f32> { constructor() { super(); } }
${useDerived}`,
      [{ ...restError, text: '...values: T[]' }],
    );
  });

  it('keeps an unknown constructor parameter type at its declaration', () => {
    paired(
      `"use typeshade";
class B { x!: f32; constructor(value: Missing) { this.x = 1.; } }
class D extends B { constructor() { super(1.); } }
${useDerived}`,
      [{ code: 'TS8002', message: UNKNOWN, text: 'Missing' }],
    );
  });

  it('keeps an imported base refusal in the declaring document', () => {
    paired(
      `"use typeshade";
import { B } from "./base.shade.ts";
${derived}
${useDerived}`,
      [{ ...restError, fileName: '/base.shade.ts' }],
      { '/base.shade.ts': `"use typeshade";\nexport ${restBase}` },
    );
  });

  it('still reports an independent unknown name beside the refused call', () => {
    paired(
      `"use typeshade";
${restBase}
${derived}
export function value(): f32 { return missing; }`,
      [restError, { code: 'TS8022', message: 'Unknown identifier "missing".', text: 'missing' }],
    );
  });
});

describe('a valid base constructor still checks and executes super()', () => {
  const base = 'class B { x!: f32; constructor(value: f32 = 2.) { this.x = value; } }';
  it.each([
    ['the default', '', 2],
    ['an explicit argument', '3.', 3],
  ] as const)('executes %s', (_name, argument, expected) => {
    const result = paired(
      `"use typeshade";\n${base}\nclass D extends B { constructor() { super(${argument}); } }\n${useDerived}`,
      [],
    );
    expect(result.eval('value', [])).toBe(expected);
  });

  it('reports a required argument at the authored super call', () => {
    paired(`"use typeshade";\n${base.replace(' = 2.', '')}\n${derived}\n${useDerived}`, [
      { code: 'TS8019', message: '"super" expects 1 argument(s), got 0.', text: 'super()' },
    ]);
  });

  it('reports an unknown argument to an available constructor', () => {
    paired(
      `"use typeshade";\n${base}\nclass D extends B { constructor() { super(missing); } }\n${useDerived}`,
      [{ code: 'TS8022', message: 'Unknown identifier "missing".', text: 'missing' }],
    );
  });
});
