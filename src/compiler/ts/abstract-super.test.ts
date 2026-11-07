// #321 names#19: an abstract intermediate class forwards its inherited constructor.
// Verifies: Rule 8.14, Rule 8.29, Rule 12.4, Rule 12.5, Rule 12.7 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { startDebugSession } from '../../core/debug/session.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const FILE = '/abstract-super.shade.ts';
const shader = (body: string): string => `"use typeshade";\n${body}`;
const base = 'class A { value: f32; constructor(value: f32 = 2.) { this.value = value; } }';
const forwarding = 'constructor(value: f32 = 2.) { super(value); }';
const middle = 'abstract class B extends A { /* forward */ }';
const leaf = 'class D extends B { constructor() { super(); } }';
const value = 'export function value(): f32 { return new D().value; }';

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

function runs(source: string, expected: number) {
  const result = paired(source);
  expect(result.diagnostics).toEqual([]);
  expect(result.wgsl).toBeDefined();
  expect(result.glsl).toBeDefined();
  expect(result.eval('value', [])).toBe(expected);
  expect(compileModuleJs(result.module).fns.value!()).toBe(expected);
  const debug = startDebugSession(result.module, 'value', []);
  debug.continue();
  expect(debug.done).toBe(true);
  expect(debug.result).toBe(expected);
  return result;
}

const cases = [
  ['default argument', `${base} ${middle} ${leaf} ${value}`, forwarding, 2],
  [
    'explicit argument',
    `${base} ${middle} ${leaf.replace('super()', 'super(3.)')} ${value}`,
    forwarding,
    3,
  ],
  [
    'required argument',
    `${base.replace(' = 2.', '')} ${middle} ${leaf.replace('super()', 'super(3.)')} ${value}`,
    forwarding.replace(' = 2.', ''),
    3,
  ],
  [
    'three-level chain',
    `${base} ${middle} abstract class C extends B { /* forward */ } ${leaf.replace('extends B', 'extends C')} ${value}`,
    forwarding,
    2,
  ],
  [
    'inherited derived constructor',
    `${base} ${middle} ${leaf} class E extends D {} ${value.replace('new D()', 'new E()')}`,
    forwarding,
    2,
  ],
  [
    'readonly parameter property',
    `class A { constructor(readonly value: f32 = 2.) {} } ${middle} ${leaf} ${value}`,
    forwarding,
    2,
  ],
  [
    'redeclared field initializer',
    `${base} abstract class B extends A { value: f32 = 5.; /* forward */ } ${leaf} ${value}`,
    forwarding,
    5,
  ],
  [
    'initializer order',
    `class A { value: f32 = 1.; constructor(value: f32 = 2.) { this.value = value * 2.; } }
    abstract class B extends A { b: f32 = this.value + 3.; /* forward */ }
    class D extends B { d: f32 = this.b + 5.; constructor() { super(); this.value += 4.; } }
    export function value(): f32 { const d = new D(); return d.value + d.b + d.d; }`,
    forwarding,
    27,
  ],
  [
    'generic ancestor',
    `class A<T> { value: T; constructor(value: T) { this.value = value; } }
    abstract class B extends A<f32> { /* forward */ }
    class D extends B { constructor() { super(3.); } } ${value}`,
    forwarding.replace(' = 2.', ''),
    3,
  ],
  [
    'namespace base',
    `namespace N { export ${base} export ${middle} export ${leaf} }
    ${value.replace('new D()', 'new N.D()')}`,
    forwarding,
    2,
  ],
] as const;

describe('an abstract intermediate class forwards its inherited constructor', () => {
  it.each(cases)(
    '%s matches an explicit forwarding constructor',
    (_name, body, forward, expected) => {
      runs(shader(body.replaceAll('/* forward */', forward)), expected);
      runs(shader(body), expected);
    },
  );

  it('keeps an imported inherited constructor available', () => {
    const library = '/base.shade.ts';
    const result = paired(shader(`import { B } from "./base.shade"; ${leaf} ${value}`), {
      [library]: shader(`${base} export ${middle}`),
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.eval('value', [])).toBe(2);
    expect(result.wgsl).toBeDefined();
  });

  it('does not add an unused abstract forwarding function', () => {
    const result = runs(
      shader(`${base} ${middle} export function value(): f32 { return new A().value; }`),
      2,
    );
    expect(result.module.funcs.some((fn) => fn.name === 'B_new')).toBe(false);
  });

  it('keeps abstract construction refused', () => {
    const source = shader(
      `${base} ${middle} export function value(): f32 { return new B().value; }`,
    );
    const result = paired(source);
    expect(result.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'TS8035',
        message:
          '"B" is abstract, so there is no instance of it to build. Construct a class that extends it.',
      },
    ]);
  });

  it('keeps the required argument refusal at super()', () => {
    const source = shader(`${base.replace(' = 2.', '')} ${middle} ${leaf} ${value}`);
    const result = paired(source);
    expect(
      result.diagnostics.map(({ code, message, start, length }) => ({
        code,
        message,
        start,
        length,
      })),
    ).toEqual([
      {
        code: 'TS8019',
        message: '"super" expects 1 argument(s), got 0.',
        start: source.indexOf('super()'),
        length: 7,
      },
    ]);
  });

  it('keeps a refused inherited signature at the original declaration', () => {
    const source = shader(
      `class A { value: f32 = 1.; constructor(...values: f32[]) {} } ${middle} ${leaf} ${value}`,
    );
    const result = paired(source);
    expect(
      result.diagnostics.map(({ code, message, start, length }) => ({
        code,
        message,
        start,
        length,
      })),
    ).toEqual([
      {
        code: 'TS8020',
        message: 'Rest parameter "values" is not supported.',
        start: source.indexOf('...values: f32[]'),
        length: '...values: f32[]'.length,
      },
    ]);
  });
});
