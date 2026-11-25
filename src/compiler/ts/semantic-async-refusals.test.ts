import { describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse } from '../../core/testing/both-halves.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const USE = '"use typeshade"\n';

const inBody = (body: string): string =>
  `${USE}export function f(): f32 {
${body}
}
@fragment export function fs(): vec4 { return vec4(f()) }`;

const WHY_ASYNC = 'is async, and a shader function runs to completion in one call:';
const NO_LOOP = 'there is no event loop to wait on.';

describe('an async function or a generator is refused once, under the code of its position', () => {
  it.each([
    ['a declaration', 'export async function g(): Promise<f32> { return 1. }', 'TS8013', '"g"'],
    [
      'a local declaration',
      inBody('async function h(): Promise<f32> { return 1. } return 1.').slice(USE.length),
      'TS8013',
      '"h"',
    ],
    [
      'a function written as a value',
      inBody('const h = async (): Promise<f32> => 1.; return 1.').slice(USE.length),
      'TS8020',
      '"h"',
    ],
    ['a method of a class', 'class C { async m(): Promise<f32> { return 1. } }', 'TS8035', '"C.m"'],
    [
      'the function a class field holds',
      'class C { m = async (): Promise<f32> => 1. }',
      'TS8035',
      '"C.m"',
    ],
  ])('says it for %s', (_position, source, code, name) => {
    bothRefuse(
      `${USE}${source}`,
      code,
      `${name} ${WHY_ASYNC} ${NO_LOOP} Remove "async" and each "await", and write its return type as f32.`,
    );
  });

  it('says nothing more about an await inside an async function', () => {
    bothRefuse(
      `${USE}export async function g(): Promise<f32> { const x = await Foo; return 1. }`,
      'TS8013',
      `"g" ${WHY_ASYNC} ${NO_LOOP} Remove "async" and each "await", and write its return type as f32.`,
    );
  });

  it('names a mixin method by the class that applies it', () => {
    const halves = bothHalves(`${USE}class Particle { pos: vec3 }
function Aged<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    async m(): Promise<f32> { return 1. }
  }
}
class Body extends Aged(Particle) { x: f32 }`);
    const line = `typeshade TS8035: "Body.m" ${WHY_ASYNC} ${NO_LOOP} Remove "async" and each "await", and write its return type as f32.`;
    expect(halves.compiler).toEqual([line]);
    expect(halves.editor).toEqual([line]);
  });

  it('leaves the async method of an object literal to the literal', () => {
    bothRefuse(
      inBody('const o = { async m() { return 1. } }; return 1.'),
      'TS8099',
      'Object literals must use identifier fields, e.g. { pos: vec4(...) }.',
    );
  });
});

describe('the remedy of an async function or a generator follows what it is and what it returns', () => {
  const refused = (source: string, code: string, said: string): void => {
    bothRefuse(`${USE}${source}`, code, said);
  };

  it('writes the type argument of the wrapper as the return type', () => {
    refused(
      'export async function g(): Promise<f32> { return 1. }',
      'TS8013',
      `"g" ${WHY_ASYNC} ${NO_LOOP} Remove "async" and each "await", and write its return type as f32.`,
    );
    refused(
      'export function* g(): Generator<f32> { yield 1. }',
      'TS8013',
      '"g" is a generator, and a shader function runs to completion in one call: nothing ' +
        'suspends it at a "yield". Remove the "*", write its return type as f32, and return one value.',
    );
    refused(
      'export async function* g(): AsyncGenerator<f32> { yield 1. }',
      'TS8013',
      '"g" is an async generator, and a shader function runs to completion in one call: ' +
        `${NO_LOOP} Remove "async" and the "*", write its return type as f32, and return one value.`,
    );
  });

  it('writes no return type where none is written', () => {
    refused(
      'export async function g() { return 1. }',
      'TS8013',
      `"g" ${WHY_ASYNC} ${NO_LOOP} Remove "async" and each "await".`,
    );
  });

  it('asks to remove a wrapper that has no type argument', () => {
    refused(
      'export async function g(): Promise { return 1. }',
      'TS8013',
      `"g" ${WHY_ASYNC} ${NO_LOOP} Remove "async", each "await" and its return type.`,
    );
  });

  it('writes a type parameter of a generic function as written', () => {
    refused(
      'export async function g<T>(a: T): Promise<T> { return a }',
      'TS8013',
      `"g" ${WHY_ASYNC} ${NO_LOOP} Remove "async" and each "await", and write its return type as T.`,
    );
  });

  it('calls a function with no name "This function"', () => {
    const halves = bothHalves(
      inBody('const h = async function () { return 1. }; const k = [async () => 1.]; return 1.'),
    );
    expect(halves.compiler.filter((d) => d.includes('This function ' + WHY_ASYNC))).toHaveLength(1);
    expect(halves.compiler.filter((d) => d.includes('"h" ' + WHY_ASYNC))).toHaveLength(1);
  });
});

describe('what a file refused is read again from nothing after an edit', () => {
  it('clears a refusal once the edit removes the mistake', () => {
    const service = createTypeshadeLanguageService();
    const bad = `${USE}export function f(): f32 { try { return 1. } catch (e) { return 2. } }`;
    const good = `${USE}export function f(): f32 { return 1. }`;
    service.openDocument('a.shade.ts', bad);
    expect(service.getDiagnostics('a.shade.ts').map((d) => d.code)).toContain('TS8013');
    service.updateDocument('a.shade.ts', good);
    expect(service.getDiagnostics('a.shade.ts')).toEqual([]);
    service.updateDocument('a.shade.ts', bad);
    expect(service.getDiagnostics('a.shade.ts').map((d) => d.code)).toContain('TS8013');
  });
});
