import { describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse, bothTake } from '../../core/testing/both-halves.js';

const USE = '"use typeshade"\n';
const SUPPORTED =
  'Supported attributes: @vertex, @fragment, @compute, @builtin, @location, @interpolate, @invariant, @blend_src.';
const BINDING_SLOT =
  "is WGSL's attribute, and is not applied: reflect() reports the group and slot each binding " +
  'gets. Remove it, and read the slot from reflect() on the host.';

const refusedOnce = (source: string, code: string, sentence: string): void => {
  const halves = bothHalves(source);
  const line = `typeshade ${code}: ${sentence}`;
  expect(halves.compiler.filter((d) => d === line)).toEqual([line]);
  expect(halves.editor.filter((d) => d === line)).toEqual([line]);
};

const sayingNothingOf = (source: string, needle: string): void => {
  const halves = bothHalves(source);
  expect(halves.compiler.filter((d) => d.includes(needle))).toEqual([]);
  expect(halves.editor.filter((d) => d.includes(needle))).toEqual([]);
};

describe('a removed qualifier is refused once, by TS8073, on a parameter', () => {
  it('refuses @inout on a parameter with the removal sentence alone', () => {
    bothRefuse(
      `${USE}@vertex export function vs(@inout a: f32): vec4 { return vec4(0.) }`,
      'TS8073',
      '"@inout" was removed (change 0142): a number, a bool, a vector and a matrix are values. ' +
        'Return the value, and write [a, b] = f(a, b) for more than one.',
    );
  });

  it('refuses @inout on a parameter of an overload signature with the removal sentence alone', () => {
    bothRefuse(
      `${USE}export function f(@inout a: f32): f32;
export function f(a: f32): f32 { return a }
@fragment export function fs(): vec4 { return vec4(f(1.)) }`,
      'TS8073',
      '"@inout" was removed (change 0142): a number, a bool, a vector and a matrix are values. ' +
        'Return the value, and write [a, b] = f(a, b) for more than one.',
    );
  });

  it('says "unknown attribute" for the same name written on a field', () => {
    bothRefuse(
      `${USE}class C { @inout a!: f32 }`,
      'TS8028',
      `Unknown attribute "@inout". ${SUPPORTED}`,
    );
  });

  it('says "unknown attribute" for @out written on a class', () => {
    bothRefuse(
      `${USE}@out class C { a!: f32 }`,
      'TS8028',
      `Unknown attribute "@out". ${SUPPORTED}`,
    );
  });
});

describe('an attribute the compiler refuses with its own sentence is not also unknown', () => {
  it('leaves @std140 on a class to the struct sentence', () => {
    bothRefuse(`${USE}@std140 class C { a!: f32 }`, 'TS8010', '@std140 on a class is not applied.');
  });

  it('leaves @align on a class and on a field to the struct sentence', () => {
    bothRefuse(
      `${USE}@align(16) class C { a!: f32 }`,
      'TS8010',
      '@align on a class is not applied.',
    );
    bothRefuse(
      `${USE}class C { @align(16) a!: f32 }`,
      'TS8010',
      '@align on a field is not applied.',
    );
  });

  it('leaves a stage attribute on a class to the struct sentence', () => {
    bothRefuse(
      `${USE}@vertex class C { a!: f32 }`,
      'TS8010',
      '@vertex does not belong on a data class.',
    );
  });

  it('names @std140 on a field as the layout it is, not as unknown', () => {
    bothRefuse(
      `${USE}class C { @std140 a!: f32 }`,
      'TS8028',
      '"@std140" is not applied: WGSL lays out a struct by its own rules, which reflect() ' +
        'reports. Remove it.',
    );
  });

  it('names @align on a parameter as a struct field attribute', () => {
    bothRefuse(
      `${USE}@vertex export function vs(@align(16) a: f32): vec4 { return vec4(0.) }`,
      'TS8028',
      `"@align" is WGSL's attribute for a struct field, not a parameter. Remove it.`,
    );
  });
});

describe('an attribute written where nothing reads it is refused, once', () => {
  it('refuses a name WGSL has with the sentence that says where its intent goes', () => {
    bothRefuse(
      `${USE}class C { @size(16) a!: f32 }`,
      'TS8028',
      `"@size" is WGSL's attribute, and is not applied: a field takes the size WGSL's layout ` +
        'gives its type, which reflect() reports. Add a field where you need padding.',
    );
    bothRefuse(
      `${USE}@id(7) declare const o: override<f32>`,
      'TS8028',
      `"@id" is WGSL's attribute, and is not applied: the host sets an override by its name, ` +
        'which reflect() lists. Remove it.',
    );
  });

  it('refuses @group and @binding on a declaration, each with the same reason', () => {
    const halves = bothHalves(`${USE}@group(2) @binding(5) declare const u: uniform<f32>`);
    for (const name of ['group', 'binding']) {
      const line = `typeshade TS8028: "@${name}" ${BINDING_SLOT}`;
      expect(halves.compiler).toContain(line);
      expect(halves.editor).toContain(line);
    }
  });

  it('refuses a name nothing has, on each position that drops it', () => {
    const unknown = `Unknown attribute "@bogus". ${SUPPORTED}`;
    bothRefuse(`${USE}@bogus const k = 1.`, 'TS8028', unknown);
    bothRefuse(
      `${USE}export function g(): f32 { @bogus function h(): f32 { return 1. } return h() }`,
      'TS8028',
      unknown,
    );
    bothRefuse(`${USE}class C { @bogus static x = 1. }`, 'TS8028', unknown);
    bothRefuse(`${USE}class C { x!: f32; @bogus constructor() {} }`, 'TS8028', unknown);
  });

  it('refuses a misspelled stage with a suggestion', () => {
    bothRefuse(
      `${USE}@vertx export function vs(): vec4 { return vec4(0.) }`,
      'TS8028',
      'Unknown attribute "@vertx". Did you mean "@vertex"?',
    );
  });

  it('refuses a decorator that is not a name at all', () => {
    const halves = bothHalves(
      `${USE}declare const N: { k: any }\n@N.k export function vs(): vec4 { return vec4(0.) }`,
    );
    const line =
      'typeshade TS8028: "@N.k" is not applied: an attribute is written "@name" or "@name(...)". Remove it.';
    expect(halves.compiler).toContain(line);
    expect(halves.editor).toContain(line);
  });

  it('refuses a stage attribute on an overload signature and says where to write it', () => {
    bothRefuse(
      `${USE}@fragment export function f(): vec4;\n@fragment export function f(): vec4 { return vec4(1.) }`,
      'TS8028',
      '"@fragment" does not apply to an overload signature: it marks an entry function. ' +
        'Write it on the implementation.',
    );
  });

  it('refuses an attribute on a parameter of a function that is not an entry', () => {
    bothRefuse(
      `${USE}export function g(@vertex a: f32): f32 { return a }`,
      'TS8028',
      '"@vertex" does not apply to a parameter of a function that is not an entry: it marks an ' +
        'entry function. Remove it.',
    );
    bothRefuse(
      `${USE}@location(0) export function f(): vec4 { return vec4(0.) }`,
      'TS8028',
      `"@location" does not apply to a function: it marks an entry's input or output. Remove it.`,
    );
  });
});

describe('one decorator is one refusal, however often a declaration is lowered', () => {
  const sentence =
    '"@location" does not apply to a parameter of a function that is not an entry: it marks ' +
    "an entry's input or output. Remove it.";

  it('refuses a decorator of a generic function once for two instances', () => {
    refusedOnce(
      `${USE}export function f<T>(@location(0) a: T): T { return a }
@fragment export function fs(): vec4 { return vec4(f(1.), f(vec2(1., 2.)).x, 0., 0.) }`,
      'TS8028',
      sentence,
    );
  });

  it('refuses a decorator of a function that takes a function once for two callbacks', () => {
    refusedOnce(
      `${USE}export function ap(@location(0) a: f32, g: (x: f32) => f32): f32 { return g(a) }
@fragment export function fs(): vec4 { return vec4(ap(1., (x) => x), ap(2., (x) => x + 1.), 0., 0.) }`,
      'TS8028',
      sentence,
    );
  });

  it('leaves a decorated parameter property to the field sentence alone', () => {
    bothRefuse(
      `${USE}class C { constructor(@location(0) public x: f32) {} }`,
      'TS8035',
      'A decorator on the parameter property "x" decorates the parameter, not the field. ' +
        'Declare "x" as a field of "C" to give it one.',
    );
  });

  it('refuses a malformed @location of a generic struct field once for two instances', () => {
    refusedOnce(
      `${USE}class Out<T> { @builtin("position") pos!: vec4; @location("x") v!: T }
@vertex export function a(): Out<f32> { return { pos: vec4(0.), v: 1. } }
@vertex export function b(): Out<f32> { return { pos: vec4(0.), v: 2. } }`,
      'TS8028',
      '@location takes one non-negative integer literal: @location(0).',
    );
  });
});

describe('the two entry IO attributes are read through one argument check', () => {
  it.each([['-1'], ['"x"'], ['1.5'], ['a']])('refuses @location(%s)', (argument) => {
    refusedOnce(
      `${USE}@vertex export function vs(@location(${argument}) a: f32): vec4 { return vec4(0.) }`,
      'TS8028',
      '@location takes one non-negative integer literal: @location(0).',
    );
  });

  it.each([['3'], ['"vertex_index", "x"'], ['']])('refuses @builtin(%s)', (argument) => {
    refusedOnce(
      `${USE}@vertex export function vs(@builtin(${argument}) a: u32): vec4 { return vec4(0.) }`,
      'TS8024',
      '@builtin takes one name as a string: @builtin("position").',
    );
  });

  it('does not read a malformed attribute as an unattributed input', () => {
    sayingNothingOf(
      `${USE}@vertex export function vs(@location(-1) a: f32): vec4 { return vec4(0.) }`,
      'has no location',
    );
  });

  it('takes an invariant on the position, which WGSL lets it mark', () => {
    bothTake(
      `${USE}@fragment export function fs(p: builtin<"position", { invariant: true }>): vec4 { return p }`,
    );
  });
});
