// #975: one mistake in an abstract class body is not one mistake per derived class.
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

function errors(source: string): string[] {
  const compiler = compile(source).diagnostics.filter((d) => d.category === 'error');
  const service = createTypeshadeLanguageService();
  service.openDocument('inherited.ts', source);
  expect(
    service
      .getDiagnostics('inherited.ts')
      .filter((d) => d.severity === 'error')
      .map((d) => `${d.code} ${d.message}`),
  ).toEqual(compiler.map((d) => `${d.code} ${d.message}`));
  return compiler.map((d) => `${d.code} ${d.message}`);
}

describe('diagnostics shared by inherited bodies', () => {
  it('names all classes once for one missing field, including an unused method', () => {
    expect(
      errors(`"use typeshade";
abstract class Base { value: f32 = 0.; read(): f32 { return this.vaule; } }
class A extends Base {}
class B extends Base {}
class C extends B {}
`),
    ).toEqual(['TS8022 Unknown field "vaule" on A, B and C. Did you mean "value"?']);
  });

  it('retains the written namespace names', () => {
    expect(
      errors(`"use typeshade";
namespace Shapes {
  export abstract class Base { value: f32 = 0.; read(): f32 { return this.vaule; } }
  export class A extends Base {}
  export class B extends Base {}
}
`),
    ).toEqual(['TS8022 Unknown field "vaule" on Shapes.A and Shapes.B. Did you mean "value"?']);
  });

  it('keeps different remedies at the same position separate', () => {
    expect(
      errors(`"use typeshade";
abstract class Base { read(): f32 { return this.incc; } }
class A extends Base { inc: f32 = 0.; }
class B extends Base { incc2: f32 = 0.; }
`),
    ).toEqual([
      'TS8022 Unknown field "incc" on A. Did you mean "inc"?',
      'TS8022 Unknown field "incc" on B. Did you mean "incc2"?',
    ]);
  });

  it('does not name a class where the field exists', () => {
    expect(
      errors(`"use typeshade";
abstract class Base { read(): f32 { return this.value; } }
class A extends Base { value: f32 = 0.; }
class B extends Base {}
`),
    ).toEqual(['TS8022 Unknown field "value" on B.']);
  });

  it('keeps two source occurrences separate', () => {
    expect(
      errors(`"use typeshade";
abstract class Base { read(): f32 { const x = this.missing; return this.missing; } }
class A extends Base {}
class B extends Base {}
`),
    ).toEqual([
      'TS8022 Unknown field "missing" on A and B.',
      'TS8022 Unknown field "missing" on A and B.',
    ]);
  });
});
