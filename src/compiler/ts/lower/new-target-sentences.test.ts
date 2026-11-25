import { describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse } from '../../../core/testing/both-halves.js';

const HEAD = '"use typeshade"\n';

const inFragment = (declarations: string, body: string): string =>
  `${HEAD}${declarations}@fragment export function fs(): vec4 {\n${body}\n  return vec4(0.)\n}\n`;

const valueRows: readonly (readonly [string, string, string, string])[] = [
  [
    'a class in a namespace, read through the namespace',
    'namespace N { export class P { a: f32 = 1. } }\n',
    '  const q = N.P',
    '"N.P" is a class, not a value. Build one with "new N.P(...)".',
  ],
  [
    'a namespace in a namespace, read through the outer one',
    'namespace N { export namespace M { export const k: f32 = 1. } }\n',
    '  const q = N.M',
    '"N.M" is a namespace, not a value: its values are its members, N.M.k.',
  ],
  [
    'a static member a namespace class does not declare',
    'namespace N { export class P { static K: f32 = 1. } }\n',
    '  const q = N.P.K2',
    '"N.P" has no static member "K2".',
  ],
  [
    'a static member a namespace class declares',
    'namespace N { export class P { static K: f32 = 1. } }\n',
    '  const q = N.P.K',
    '"N.P" is a class inside a namespace, and a shader does not read the static members of one ' +
      '("N.P.K"). Declare "P" at the top level of the file and use "P.K".',
  ],
  [
    'a namespace class of statics, read whole, names its first static',
    'namespace N { export class P { static K: f32 = 1. } }\n',
    '  const q = N.P',
    '"N.P" is a class inside a namespace, and a shader does not read the static members of one ' +
      '("N.P.K"). Declare "P" at the top level of the file and use "P.K".',
  ],
  [
    'a static member a namespace class inherits',
    'class B { static J: f32 = 2. }\nnamespace N { export class P extends B { static K: f32 = 1. } }\n',
    '  const q = N.P.J',
    '"N.P" is a class inside a namespace, and a shader does not read the static members of one ' +
      '("N.P.J"). Declare "P" at the top level of the file and use "P.J".',
  ],
  [
    'a namespace class without statics, read whole',
    'namespace N { export class P { a: f32 = 1. } }\n',
    '  const q = N.P',
    '"N.P" is a class, not a value. Build one with "new N.P(...)".',
  ],
  [
    'an abstract class',
    'abstract class A { a: f32 = 1. }\n',
    '  const q = A',
    '"A" is an abstract class, not a value. Build a class that extends it.',
  ],
  [
    'a class of a static field',
    'class S { static K: f32 = 1. }\n',
    '  const q = S',
    '"S" is a class of static members, not a value: its values are its members, S.K.',
  ],
  [
    'a class of a static method',
    'class S { static g(): f32 { return 1. } }\n',
    '  const q = S',
    '"S" is a class of static members, not a value: its values are its members, S.g(...).',
  ],
  [
    'a namespace with an exported constant',
    'namespace N { export const k: f32 = 1. }\n',
    '  const q = N',
    '"N" is a namespace, not a value: its values are its members, N.k.',
  ],
  [
    'a namespace of functions only',
    'namespace N { export function g(): f32 { return 1. } }\n',
    '  const q = N',
    '"N" is a namespace, not a value.',
  ],
  [
    'a namespace whose first constant is not exported',
    'namespace N { const hidden: f32 = 1.\n export const k: f32 = 2. }\n',
    '  const q = N',
    '"N" is a namespace, not a value: its values are its members, N.k.',
  ],
  [
    'a class read in a function',
    'class C { a: f32 = 1. }\n',
    '  const q = C',
    '"C" is a class, not a value. Build one with "new C(...)".',
  ],
  ['an interface', 'interface I { a: f32 }\n', '  const q = I', '"I" is a type, not a value.'],
  [
    'an enum',
    'enum E { A, B }\n',
    '  const q = E',
    '"E" is an enum, whose values are its members: E.A.',
  ],
];

describe('a declared name read where a value is says what it is', () => {
  it.each(valueRows)('%s', (_name, declarations, body, sentence) => {
    bothRefuse(inFragment(declarations, body), 'TS8022', sentence);
  });

  it('a class read in a module constant gives no remedy that a function would', () => {
    bothRefuse(
      `${HEAD}class C { a: f32 = 1. }\nconst z = C\n@fragment export function fs(): vec4 { return vec4(0.) }\n`,
      'TS8022',
      '"C" is a class, not a value.',
    );
  });

  it('an enum read inside its own namespace adds nothing to the refusal where it is declared', () => {
    bothRefuse(
      inFragment('namespace N { export enum E { A, B }\n export const k = E }\n', ''),
      'TS8014',
      'A namespace holds functions, constants, classes and namespaces; an enum inside "N" has ' +
        'no flattened form. Declare it at the top level of the file.',
    );
  });

  it('a type parameter is not a value', () => {
    bothRefuse(
      `${HEAD}function f<T>(a: f32): f32 { return T }\n@fragment export function fs(): vec4 { return vec4(f<f32>(1.)) }\n`,
      'TS8022',
      '"T" is a type parameter, not a value.',
    );
  });

  it('an enum inside a namespace is refused where it is declared, and nowhere else', () => {
    bothRefuse(
      inFragment('namespace N { export enum E { A, B } }\n', '  const q = N.E'),
      'TS8014',
      'A namespace holds functions, constants, classes and namespaces; an enum inside "N" has ' +
        'no flattened form. Declare it at the top level of the file.',
    );
  });
});

describe('what a new resolves to is what TypeScript resolves from where the new is written', () => {
  it('a parameter or a local of a namespace block hides a class another block exports', () => {
    const exported = 'namespace N { export class P { y: f32 = 2. } }\n';
    bothRefuse(
      `${HEAD}${exported}namespace N { export function f(P: f32): f32 { const q = new P(); return 1. } }\n` +
        '@fragment export function fs(): vec4 { return vec4(N.f(1.)) }\n',
      'TS8035',
      '"P" is a value, not a class.',
    );
    bothRefuse(
      `${HEAD}${exported}namespace N { export function f(): f32 { const P = 1.; const q = new P(); return 1. } }\n` +
        '@fragment export function fs(): vec4 { return vec4(N.f()) }\n',
      'TS8035',
      '"P" is a value, not a class.',
    );
  });

  it('an interface in a block or in a namespace is a type, whatever else is refused there', () => {
    const sentence =
      '"I" is a type, not a value: an interface and a type alias declare a shape and carry no ' +
      'constructor. Write the object literal, { field: value }, or declare "I" as a class to ' +
      'give it one.';
    const inBlock = bothHalves(
      inFragment('', '  if (true) {\n    interface I { a: f32 }\n    const q = new I()\n  }'),
    );
    expect(inBlock.compiler).toContain(`typeshade TS8035: ${sentence}`);
    expect(inBlock.editor).toContain(`typeshade TS8035: ${sentence}`);
    const inNamespace = bothHalves(
      `${HEAD}namespace N { interface I { a: f32 }\n export function f(): f32 { const q = new I(); return 1. } }\n` +
        '@fragment export function fs(): vec4 { return vec4(N.f()) }\n',
    );
    expect(inNamespace.compiler).toContain(`typeshade TS8035: ${sentence}`);
    expect(inNamespace.editor).toContain(`typeshade TS8035: ${sentence}`);
  });

  it('the type arguments written on a new are written on the call that replaces it', () => {
    bothRefuse(
      inFragment('', '  const q = new vec3<f32>(1., 2., 3.)'),
      'TS8035',
      '"vec3" is a WGSL constructor, which is called without "new": vec3<f32>(1., 2., 3.).',
    );
    bothRefuse(
      inFragment('', '  const q = new array<f32, 2>(1., 2.)'),
      'TS8035',
      '"array" is a WGSL constructor, which is called without "new": array<f32, 2>(1., 2.).',
    );
    bothRefuse(
      inFragment('function pick<T>(a: T): T { return a }\n', '  const q = new pick<f32>(1.)'),
      'TS8035',
      '"pick" is a function, which is called without "new": pick<f32>(1.).',
    );
  });

  it('a function written as an expression and held in a constant is a function', () => {
    bothRefuse(
      inFragment('const mk = function (a: f32): f32 { return a }\n', '  const q = new mk(1.)'),
      'TS8035',
      '"mk" is a function, which is called without "new": mk(1.).',
    );
  });

  it('a member of a member of Math is not there, and the sentence names the member before it', () => {
    bothRefuse(
      inFragment('', '  const q = new Math.abs.x()'),
      'TS8022',
      '"Math.abs" has no member "x".',
    );
  });
  it.each(['random', 'fill', 'any', 'all', 'zip', 'select', 'workgroupUniformLoad'])(
    'the free function %s is called without new',
    (name) => {
      const halves = bothHalves(inFragment('', `  const q = new ${name}()`));
      const sentence = `typeshade TS8035: "${name}" is a function, which is called without "new": ${name}().`;
      expect(halves.compiler).toEqual([sentence]);
      expect(halves.editor).toContain(sentence);
    },
  );

  it.each([
    'sin',
    'mod',
    'cbrt',
    'atomicCompareExchangeWeak',
    'atomicAdd',
    'workgroupBarrier',
    'quantizeToF16',
    'pack4x8unorm',
    'textureSample',
    'subgroupAdd',
  ])(
    'the library function %s is called without new, or was removed with what replaces it',
    (name) => {
      const halves = bothHalves(inFragment('', `  const q = new ${name}()`));
      expect(halves.compiler).toHaveLength(1);
      expect(halves.compiler[0]).not.toContain('Unknown identifier');
      expect(halves.editor).toContain(halves.compiler[0]);
    },
  );

  it('a member of a value is part of the value the sentence names', () => {
    bothRefuse(
      inFragment('const k: f32 = 1.\n', '  const q = new k.x()'),
      'TS8035',
      '"k.x" is a value, not a class.',
    );
    bothRefuse(
      inFragment('enum E { A, B }\n', '  const q = new E.A.x()'),
      'TS8035',
      '"E.A" is a value, not a class.',
    );
    bothRefuse(
      inFragment('class C { static K: f32 = 1. }\n', '  const q = new C.K.x()'),
      'TS8035',
      '"C.K" is a value, not a class.',
    );
  });

  it('new this() outside a static member names the class around it, or C where there is none', () => {
    const sentence = (name: string): string =>
      `typeshade TS8035: "this" here is an object, not a class, so "new" cannot build one from it. ` +
      `Name the class, "new ${name}(...)"; "new this()" builds the class in a static member.`;
    const inMethod = bothHalves(
      `${HEAD}class A { a: f32 = 1.\n f(): f32 { const q = new this(); return 1. } }\n` +
        '@fragment export function fs(): vec4 { const o = new A(); return vec4(o.f()) }\n',
    );
    expect(inMethod.compiler).toEqual([sentence('A')]);
    expect(inMethod.editor).toContain(sentence('A'));
    const parenthesized = bothHalves(
      `${HEAD}class A { a: f32 = 1.\n f(): f32 { const q = new (this)(); return 1. } }\n` +
        '@fragment export function fs(): vec4 { const o = new A(); return vec4(o.f()) }\n',
    );
    expect(parenthesized.compiler).toEqual([sentence('A')]);
    expect(parenthesized.editor).toContain(sentence('A'));
    const inFunction = bothHalves(
      `${HEAD}function f(): f32 { const q = new this(); return 1. }\n` +
        '@fragment export function fs(): vec4 { return vec4(f()) }\n',
    );
    expect(inFunction.compiler).toEqual([sentence('C')]);
    expect(inFunction.editor).toContain(sentence('C'));
    const inAnonymous = bothHalves(
      `${HEAD}class A { a: f32 = 1.\n f(): f32 { const K = class { g(): f32 { const q = new this(); return 1. } }; return 1. } }\n` +
        '@fragment export function fs(): vec4 { const o = new A(); return vec4(o.f()) }\n',
    );
    expect(inAnonymous.compiler).toContain(sentence('C'));
    expect(inAnonymous.editor).toContain(sentence('C'));
  });
});
