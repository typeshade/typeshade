// #321 misc#8: class fields share the opt-in integer-default warning, not a new type rule.
// Verifies: Rule 13.10 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { hostFace } from './host-face.js';
import { checkDocuments } from '../../language-service/check.js';

const FILE = '/app/field-deprecations.shade.ts';

function paired(source: string, deprecations = true) {
  const compiled = compile(source, { fileName: FILE, deprecations });
  const checked = checkDocuments([{ path: FILE, uri: FILE, text: source }], { deprecations });
  expect(
    checked.diagnostics.map(({ code, message, offset, length, severity }) => ({
      code,
      message,
      start: offset,
      length,
      category: severity,
    })),
  ).toEqual(
    compiled.diagnostics.map(({ code, message, start, length, category }) => ({
      code,
      message,
      start,
      length,
      category,
    })),
  );
  const off = compile(source, { fileName: FILE });
  expect(compiled.wgsl).toBe(off.wgsl);
  expect(compiled.glsl).toEqual(off.glsl);
  expect(compiled.module).toEqual(off.module);
  return compiled;
}

function fragment(declarations: string, value: string) {
  return `"use typeshade";
${declarations}
export const fs = fragment(function fs(): location<0, vec4> { return vec4(${value}); });`;
}

describe('integer-default deprecations on class fields', () => {
  it.each([
    ['instance', 'class C { x = 0; }', 'new C().x', 'x = 0;'],
    ['readonly', 'class C { readonly x = 0; }', 'new C().x', 'readonly x = 0;'],
    [
      'private',
      'class C { private x = 0; get(): f32 { return this.x; } }',
      'new C().get()',
      'private x = 0;',
    ],
    [
      'private name',
      'class C { #x = 0; get(): f32 { return this.#x; } }',
      'new C().get()',
      '#x = 0;',
    ],
    ['static', 'class C { static x = 0; }', 'C.x', 'static x = 0;'],
    ['static readonly', 'class C { static readonly x = 0; }', 'C.x', 'static readonly x = 0;'],
    [
      'written static',
      'class C { static x = 0; static get(): f32 { this.x += 1.; return this.x; } }',
      'C.get()',
      'static x = 0;',
    ],
    [
      'private static',
      'class C { static #x = 0; static get(): f32 { return this.#x; } }',
      'C.get()',
      'static #x = 0;',
    ],
    ['namespace', 'namespace N { export class C { x = 0; } }', 'new N.C().x', 'x = 0;'],
    ['generic', 'class C<T> { x = 0; }', 'new C<f32>().x', 'x = 0;'],
    ['inherited', 'class B { x = 0; } class C extends B {}', 'new C().x', 'x = 0;'],
    ['optional', 'class C { x? = 0; }', 'new C().x ?? 1.', 'x? = 0;'],
  ])(
    'warns once for the %s field without moving emitted bytes',
    (_name, declaration, value, span) => {
      const source = fragment(declaration, value);
      const result = paired(source);
      expect(result.diagnostics).toHaveLength(1);
      const name = span.includes('#x') ? '#x' : 'x';
      const writtenName = `${name}${span.includes('x?') ? '?' : ''}`;
      expect(result.diagnostics[0]).toMatchObject({
        code: 'TS8053',
        category: 'warning',
        start: source.indexOf(span),
        length: span.length,
        message:
          `"${name}" is written as an integer and types as f32 today; it will type as i32 ` +
          `(§13, #148). Write "${writtenName} = 0." to keep f32, or leave it and take i32.`,
      });
      expect(result.wgsl).toContain('@fragment');
      expect(result.glsl?.fragment).toContain('void main()');
      expect(paired(source, false).diagnostics).toEqual([]);
      const corrected = paired(source.replace(`${writtenName} = 0`, `${writtenName} = 0.`));
      expect(corrected.diagnostics).toEqual([]);
      expect(corrected.wgsl).toBe(result.wgsl);
      expect(corrected.glsl).toEqual(result.glsl);
    },
  );

  it('keeps an optional field optional when applying the radix annotation remedy', () => {
    const source = fragment('export class C { x? = 0x10; }', 'new C().x ?? 1.');
    const result = paired(source);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.message).toContain('Annotate it — "x?: f32 = 0x10"');
    const fixed = source.replace('x? = 0x10', 'x?: f32 = 0x10');
    const corrected = paired(fixed);
    expect(corrected.diagnostics).toEqual([]);
    expect(corrected.wgsl).toBe(result.wgsl);
    expect(corrected.glsl).toEqual(result.glsl);
    const originalFace = hostFace(source, { fileName: FILE });
    const correctedFace = hostFace(fixed, { fileName: FILE });
    expect(originalFace.diagnostics).toEqual([]);
    expect(correctedFace.diagnostics).toEqual([]);
    expect(correctedFace.view).toBe(originalFace.view);
  });

  it.each([
    ['negative', 'x = -2', '-2'],
    ['parenthesized', 'x = (2)', '(2)'],
    ['static arithmetic', 'static x = 2 + 3', '2 + 3'],
    ['hexadecimal', 'x = 0x10', '0x10'],
    ['octal', 'x = 0o10', '0o10'],
    ['binary private', '#x = 0b10', '0b10'],
  ])('offers a compiling annotation for the %s initializer', (_name, field, initializer) => {
    const name = field.includes('#x') ? '#x' : 'x';
    const isStatic = field.startsWith('static');
    const source = fragment(
      `class C { ${field}; ${isStatic ? 'static ' : ''}get(): f32 { return this.${name}; } }`,
      isStatic ? 'C.get()' : 'new C().get()',
    );
    const result = paired(source);
    expect(result.diagnostics).toHaveLength(1);
    const fix = `${name}: f32 = ${initializer}`;
    expect(result.diagnostics[0]!.message).toBe(
      `"${name}" is written as an integer and types as f32 today; it will type as i32 ` +
        `(§13, #148). Annotate it — "${fix}" — to keep f32, or leave it and take i32.`,
    );
    const corrected = paired(source.replace(`${name} = ${initializer}`, fix));
    expect(corrected.diagnostics).toEqual([]);
    expect(corrected.wgsl).toBe(result.wgsl);
    expect(corrected.glsl).toEqual(result.glsl);
  });

  it.each([
    ['annotated float', 'class C { x: f32 = 0; }', 'new C().x'],
    ['annotated integer', 'class C { x: u32 = 0; }', 'f32(new C().x)'],
    ['decimal float', 'class C { x = 0.; }', 'new C().x'],
    ['explicit float', 'class C { x = f32(0); }', 'new C().x'],
    ['explicit integer', 'class C { x = u32(0); }', 'f32(new C().x)'],
    ['static enum', 'enum E { X = 0 } class C { static x = E.X; }', 'f32(C.x)'],
    ['static reference', 'const K: f32 = 0.; class C { static x = K; }', 'C.x'],
    ['parameter property', 'class C { constructor(public x: f32 = 0) {} }', 'new C().x'],
    ['parameter default', 'class C { constructor(x: f32 = 0) {} }', '0.'],
  ])('leaves the %s declaration alone', (_name, declaration, value) => {
    const result = paired(fragment(declaration, value));
    expect(result.diagnostics).toEqual([]);
    expect(result.wgsl).toContain('@fragment');
  });

  it.each([
    ['arithmetic instance', 'class C { x = 2 + 3; }', 'TS8010'],
    ['nested signed parentheses', 'class C { x = -(2); }', 'TS8010'],
    [
      'nonconstant instance',
      'function value(): f32 { return 0.; } class C { x = value(); }',
      'TS8010',
    ],
    ['quoted', 'class C { "x" = 0; }', 'TS8010'],
    ['computed', 'class C { ["x"] = 0; }', 'TS8010'],
    ['static division by zero', 'class C { static x = 2 / 0; }', 'TS8003'],
    ['abstract initializer', 'abstract class C { abstract x = 0; }', 'TS8035'],
  ])('adds no warning to the refused %s field', (_name, declaration, code) => {
    const result = paired(fragment(declaration, '0.'));
    expect(result.diagnostics.map((d) => d.code)).toEqual([code]);
    expect(result.wgsl).toBeUndefined();
  });

  it('keeps the existing ambient-initializer refusal without adding a warning', () => {
    const source = fragment('declare class C { x = 0; }', '0.');
    expect(compile(source, { fileName: FILE, deprecations: true }).diagnostics).toEqual([]);
    const documents = [{ path: FILE, uri: FILE, text: source }];
    const off = checkDocuments(documents);
    const on = checkDocuments(documents, { deprecations: true });
    expect(on.diagnostics).toEqual(off.diagnostics);
    expect(on.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      { code: 'TS1039', message: 'Initializers are not allowed in ambient contexts.' },
    ]);
  });

  it('still warns for a valid field beside an independent error', () => {
    const source = fragment('class C { x = 0; }', 'missing');
    const result = paired(source);
    expect(result.diagnostics.map((d) => [d.code, d.category])).toEqual([
      ['TS8053', 'warning'],
      ['TS8022', 'error'],
    ]);
  });

  it('adds no warning to an initializer with a definite-assignment assertion', () => {
    const source = fragment('class C { x! = 0; }', 'new C().x');
    const off = compile(source, { fileName: FILE });
    const on = compile(source, { fileName: FILE, deprecations: true });
    expect(on.diagnostics).toEqual(off.diagnostics);
    expect(on.diagnostics).toEqual([]);
    const documents = [{ path: FILE, uri: FILE, text: source }];
    const before = checkDocuments(documents);
    const after = checkDocuments(documents, { deprecations: true });
    expect(after.diagnostics).toEqual(before.diagnostics);
    // The existing projection refuses this invalid declaration; the opt-in adds nothing.
    expect(after.diagnostics.map((d) => d.code)).toEqual(['TS17019', 'TS8002', 'TS8003', 'TS8019']);
    expect(on.wgsl).toBe(off.wgsl);
    expect(on.glsl).toEqual(off.glsl);
  });

  it('maps one warning to an imported field in both checks', () => {
    const library = '/app/fields.shade.ts';
    const source = fragment('import { C } from "./fields.shade";', 'new C().x');
    const text = '"use typeshade"; export class C { readonly x = 0x10; }';
    const files: Record<string, string> = { [FILE]: source, [library]: text };
    const readDocument = (uri: string) => files[uri];
    const on = compile(source, { fileName: FILE, readDocument, deprecations: true });
    const off = compile(source, { fileName: FILE, readDocument });
    expect(on.diagnostics).toHaveLength(1);
    expect(on.diagnostics[0]).toMatchObject({
      code: 'TS8053',
      fileName: library,
      start: text.indexOf('readonly'),
      length: 'readonly x = 0x10;'.length,
      category: 'warning',
    });
    const checked = checkDocuments(
      Object.entries(files).map(([uri, text]) => ({ path: uri, uri, text })),
      { deprecations: true, readDocument },
    );
    expect(
      checked.diagnostics.map(({ file, code, message, offset, length, severity }) => ({
        fileName: file,
        code,
        message,
        start: offset,
        length,
        category: severity,
      })),
    ).toEqual(
      on.diagnostics.map(({ fileName, code, message, start, length, category }) => ({
        fileName,
        code,
        message,
        start,
        length,
        category,
      })),
    );
    expect(off.diagnostics).toEqual([]);
    expect(on.wgsl).toBe(off.wgsl);
    expect(on.glsl).toEqual(off.glsl);
    expect(on.module).toEqual(off.module);
  });
});
