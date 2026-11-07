// #321 types#12: fields use the same integer range sentence as other declared positions.
// Verifies: Rule 5.4, Rule 12.5, Rule 12.7 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const FILE = '/field-ranges.shade.ts';

function paired(source: string) {
  const compiled = compile(source, { fileName: FILE });
  const service = createTypeshadeLanguageService();
  service.openDocument(FILE, source);
  expect(
    service.getDiagnostics(FILE).map(({ code, message, severity, span }) => ({
      code,
      message,
      category: severity,
      start: span.start,
      length: span.length,
    })),
  ).toEqual(
    compiled.diagnostics.map(({ code, message, category, start, length }) => ({
      code,
      message,
      category,
      start,
      length,
    })),
  );
  return compiled;
}

function sourceFor(type: string, initializer: string) {
  return `"use typeshade";
class C { x: ${type} = ${initializer}; }
export function read(): ${type} { return new C().x; }`;
}

const U32 = 'u32, which holds 0 to 4294967295 (§13).';
const I32 = 'i32, which holds -2147483648 to 2147483647 (§13).';

describe('class field initializer diagnostics', () => {
  it.each([
    ['u32', '-1', '-1', '-1', U32],
    ['u32', '4294967296', '4294967296', '4294967296', U32],
    ['i32', '2147483648', '2147483648', '2147483648', I32],
    ['i32', '-2147483649', '-2147483649', '-2147483649', I32],
    ['u32', '((4294967296))', '4294967296', '4294967296', U32],
    ['u32', '0xffffffff + 1', '4294967296', '0xffffffff + 1', U32],
    ['u32', 'true ? 1 : -1', '-1', '-1', U32],
    ['i32', '0x80000000', '2147483648', '0x80000000', I32],
  ])('reports the range for %s = %s', (type, initializer, value, span, range) => {
    const source = sourceFor(type, initializer);
    const result = paired(source);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'TS8003',
        category: 'error',
        message: `The value has to fit: ${value} is outside ${range}`,
        start: source.indexOf(span),
        length: span.length,
      }),
    ]);
    expect(result.wgsl).toBeUndefined();
    expect(result.glsl).toBeUndefined();
  });

  it.each([
    ['readonly', 'class C { readonly x: u32 = -1; }', 'new C().x'],
    ['private', 'class C { private x: u32 = -1; get(): u32 { return this.x; } }', 'new C().get()'],
    ['private name', 'class C { #x: u32 = -1; get(): u32 { return this.#x; } }', 'new C().get()'],
    ['inherited', 'class B { x: u32 = -1; } class C extends B {}', 'new C().x'],
    ['namespace', 'namespace N { export class C { x: u32 = -1; } }', 'new N.C().x'],
    ['alias', 'type Count = u32; class C { x: Count = -1; }', 'new C().x'],
    ['generic', 'class C<T> { x: u32 = -1; }', 'new C<f32>().x'],
  ])('reports the %s field at the written initializer', (_label, declaration, value) => {
    const source = `"use typeshade";\n${declaration}\nexport function read(): u32 { return ${value}; }`;
    const result = paired(source);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'TS8003',
        category: 'error',
        message: `The value has to fit: -1 is outside ${U32}`,
        start: source.indexOf('-1'),
        length: 2,
      }),
    ]);
  });

  it.each(['1.', '1.5', '1e0', 'floor(1.5)'])(
    'keeps %s a float and supplies a working cast',
    (value) => {
      const source = sourceFor('u32', value);
      const result = paired(source);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: 'TS8003',
          category: 'error',
          message:
            'Type mismatch: cannot assign f32 to u32 — no implicit int/float conversion. ' +
            'Cast explicitly: f32(intVal) or i32(floatVal) / u32(floatVal).',
          start: source.indexOf(value),
          length: value.length,
        }),
      ]);
      const fixed = paired(sourceFor('u32', `u32(${value})`));
      expect(fixed.diagnostics).toEqual([]);
      expect(fixed.wgsl).toBeDefined();
    },
  );

  it.each([
    ['u32', '0'],
    ['u32', '4294967295'],
    ['u32', '0xffffffff'],
    ['i32', '-2147483648'],
    ['i32', '2147483647'],
    ['f32', '1'],
    ['f32', '1.5'],
  ])('keeps the valid neighbor %s = %s', (type, value) => {
    const result = paired(sourceFor(type, value));
    expect(result.diagnostics).toEqual([]);
    expect(result.wgsl).toBeDefined();
  });
});
