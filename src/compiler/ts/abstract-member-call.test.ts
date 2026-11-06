// #1008: a declared method on an abstract receiver is not a missing method.
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

function errors(source: string): string[] {
  const compiler = compile(source)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);
  const service = createTypeshadeLanguageService();
  service.openDocument('abstract-member.ts', source);
  expect(
    service
      .getDiagnostics('abstract-member.ts')
      .filter((d) => d.severity === 'error')
      .map((d) => `${d.code} ${d.message}`),
  ).toEqual(compiler);
  return compiler;
}

describe('a call on an abstract receiver', () => {
  it.each(['area(): f32 { return this.size; }', 'abstract area(): f32;'])(
    'explains why the declared member cannot run: %s',
    (method) => {
      expect(
        errors(`"use typeshade";
abstract class Shape { size: f32 = 1.; ${method} }
export function measure(s: Shape): f32 { return s.area(); }
`),
      ).toEqual([
        'TS8035 "Shape" is abstract, so there is no instance of it on which "area" could run. Construct a concrete class that extends it and call "area" on that value.',
      ]);
    },
  );

  it('names a namespace class as written', () => {
    expect(
      errors(`"use typeshade";
namespace Geometry {
  export abstract class Shape { size: f32 = 1.; area(): f32 { return this.size; } }
}
export function measure(s: Geometry.Shape): f32 { return s.area(); }
`),
    ).toEqual([
      'TS8035 "Geometry.Shape" is abstract, so there is no instance of it on which "area" could run. Construct a concrete class that extends it and call "area" on that value.',
    ]);
  });

  it('keeps a missing member distinct from a declared abstract member', () => {
    expect(
      errors(`"use typeshade";
abstract class Shape { size: f32 = 1.; area(): f32 { return this.size; } }
export function measure(s: Shape): f32 { return s.missing(); }
`)[0],
    ).toContain('"Shape" has no method "missing".');
  });

  it('accepts the remedy, a call on a concrete derived value', () => {
    expect(
      errors(`"use typeshade";
abstract class Shape { size: f32 = 1.; abstract area(): f32; }
class Square extends Shape { area(): f32 { return this.size * this.size; } }
export function measure(s: Square): f32 { return s.area(); }
`),
    ).toEqual([]);
  });
});
